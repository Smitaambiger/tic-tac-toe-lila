var WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
var TURN_SECONDS = 30;
var LEADERBOARD_ID = "global_leaderboard";
var OP_GAME = 1, OP_ERROR = 2, OP_EVENT = 3, OP_TICK = 4;

function checkWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var l = WIN_LINES[i];
    if (board[l[0]] && board[l[0]] === board[l[1]] && board[l[0]] === board[l[2]])
      return { winner: board[l[0]], line: [l[0],l[1],l[2]] };
  }
  var full = true;
  for (var j = 0; j < 9; j++) { if (!board[j]) { full = false; break; } }
  if (full) return { winner: "draw", line: null };
  return { winner: null, line: null };
}

function writeLeaderboard(nk, logger, state, winnerId, loserId) {
  try {
    var wn = state.players[winnerId] ? state.players[winnerId].name : winnerId;
    var ln = state.players[loserId]  ? state.players[loserId].name  : loserId;
    nk.leaderboardRecordWrite(LEADERBOARD_ID, winnerId, wn, 25, 0, {});
    nk.leaderboardRecordWrite(LEADERBOARD_ID, loserId,  ln,  0, 20, {});
  } catch(e) { logger.error("LB write failed: " + e); }
}

function matchInit(ctx, logger, nk, params) {
  var isPrivate = params && params.private === "true";
  var state = {
    board: [null,null,null,null,null,null,null,null,null],
    players: {}, currentSymbol: "X", winner: null, winningLine: null,
    status: "waiting", turnDeadline: 0, timeLeft: TURN_SECONDS,
    isPrivate: !!isPrivate, rematchVotes: []
  };
  var label = isPrivate
    ? JSON.stringify({ open: false, private: true })
    : JSON.stringify({ open: true,  private: false });
  return { state: state, tickRate: 1, label: label };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  var count = Object.keys(state.players).length;
  var allow = count < 2 && state.status !== "finished";
  return { state: state, accept: allow };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var sym = Object.keys(state.players).length === 0 ? "X" : "O";
    state.players[p.userId] = { symbol: sym, name: p.username };
  }
  if (Object.keys(state.players).length === 2) {
    state.status = "playing";
    state.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    state.timeLeft = TURN_SECONDS;
    state.rematchVotes = [];
    dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "GAME_START", state: state }));
    dispatcher.matchLabelUpdate(JSON.stringify({ open: false, private: state.isPrivate }));
  } else {
    dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "WAITING", state: state }), presences);
  }
  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var leaverName = state.players[p.userId] ? state.players[p.userId].name : "Opponent";
    if (state.status === "playing") {
      var ids = Object.keys(state.players);
      var wid = null;
      for (var j = 0; j < ids.length; j++) { if (ids[j] !== p.userId) { wid = ids[j]; break; } }
      if (wid) {
        state.winner = wid; state.status = "finished";
        writeLeaderboard(nk, logger, state, wid, p.userId);
        dispatcher.broadcastMessage(OP_EVENT, JSON.stringify({ type: "PLAYER_LEFT", leaverName: leaverName, winner: wid, state: state }));
      }
    }
    delete state.players[p.userId];
  }
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  for (var m = 0; m < messages.length; m++) {
    var msg = messages[m];
    var uid = msg.sender.userId;
    var player = state.players[uid];
    if (!player) continue;
    var data;
    try { data = JSON.parse(nk.binaryToString(msg.data)); } catch(e) { continue; }

    if (data.type === "REMATCH_REQUEST") {
      if (state.status !== "finished") continue;
      if (state.rematchVotes.indexOf(uid) === -1) state.rematchVotes.push(uid);
      if (state.rematchVotes.length >= 2) {
        state.board = [null,null,null,null,null,null,null,null,null];
        state.status = "playing"; state.winner = null; state.winningLine = null;
        state.currentSymbol = "X";
        state.turnDeadline = Date.now() + TURN_SECONDS * 1000;
        state.timeLeft = TURN_SECONDS; state.rematchVotes = [];
        var rids = Object.keys(state.players);
        for (var ri = 0; ri < rids.length; ri++)
          state.players[rids[ri]].symbol = state.players[rids[ri]].symbol === "X" ? "O" : "X";
        dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "REMATCH_START", state: state }));
      } else {
        dispatcher.broadcastMessage(OP_EVENT, JSON.stringify({ type: "REMATCH_REQUESTED", fromName: player.name }));
      }
      continue;
    }

    if (data.type === "REMATCH_DENY") {
      state.rematchVotes = [];
      dispatcher.broadcastMessage(OP_EVENT, JSON.stringify({ type: "REMATCH_DENIED", fromName: player.name }));
      continue;
    }

    if (data.type === "MOVE" || typeof data.index === "number") {
      if (state.status !== "playing") continue;
      if (player.symbol !== state.currentSymbol) {
        dispatcher.broadcastMessage(OP_ERROR, JSON.stringify({ type: "ERROR", message: "Not your turn" }), [msg.sender]);
        continue;
      }
      var idx = data.index;
      if (typeof idx !== "number" || idx < 0 || idx > 8 || state.board[idx] !== null) {
        dispatcher.broadcastMessage(OP_ERROR, JSON.stringify({ type: "ERROR", message: "Invalid move" }), [msg.sender]);
        continue;
      }
      state.board[idx] = player.symbol;
      state.currentSymbol = player.symbol === "X" ? "O" : "X";
      state.turnDeadline = Date.now() + TURN_SECONDS * 1000;
      state.timeLeft = TURN_SECONDS;
      var res = checkWinner(state.board);
      if (res.winner) {
        state.status = "finished"; state.winningLine = res.line; state.rematchVotes = [];
        if (res.winner === "draw") {
          state.winner = "draw";
          var dids = Object.keys(state.players);
          for (var di = 0; di < dids.length; di++)
            try { nk.leaderboardRecordWrite(LEADERBOARD_ID, dids[di], state.players[dids[di]].name, 5, 0, {}); } catch(e) {}
        } else {
          var gids = Object.keys(state.players), gw = null, gl = null;
          for (var gi = 0; gi < gids.length; gi++) {
            if (state.players[gids[gi]].symbol === res.winner) gw = gids[gi]; else gl = gids[gi];
          }
          state.winner = gw;
          if (gw && gl) writeLeaderboard(nk, logger, state, gw, gl);
        }
        dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "GAME_OVER", state: state }));
        return { state: state };
      }
      dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "MOVE", state: state }));
    }
  }

  if (state.status === "playing") {
    state.timeLeft = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
    dispatcher.broadcastMessage(OP_TICK, JSON.stringify({ type: "TICK", timeLeft: state.timeLeft, currentSymbol: state.currentSymbol }));
    if (state.timeLeft <= 0) {
      var tids = Object.keys(state.players), tw = null, tl = null;
      for (var ti = 0; ti < tids.length; ti++) {
        if (state.players[tids[ti]].symbol !== state.currentSymbol) tw = tids[ti]; else tl = tids[ti];
      }
      if (tw && tl) {
        state.winner = tw; state.status = "finished"; state.rematchVotes = [];
        writeLeaderboard(nk, logger, state, tw, tl);
        dispatcher.broadcastMessage(OP_GAME, JSON.stringify({ type: "TIMEOUT", winner: tw, state: state }));
      }
    }
  }
  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state) {
  return { state: state };
}

// ── RPC handlers must be named top-level functions ────────────────────────────
// Nakama forbids inline anonymous functions in registerRpc calls.

function rpcCreatePrivateRoom(ctx, logger, nk, payload) {
  var matchId = nk.matchCreate("tictactoe", { private: "true" });
  logger.info("Private room: " + matchId);
  return JSON.stringify({ matchId: matchId });
}

function rpcCreatePublicRoom(ctx, logger, nk, payload) {
  var matchId = nk.matchCreate("tictactoe", { private: "false" });
  logger.info("Public room: " + matchId);
  return JSON.stringify({ matchId: matchId });
}

function rpcListOpenRooms(ctx, logger, nk, payload) {
  try {
    var matches = nk.matchList(10, true, null, 1, 1, "");
    var rooms = [];
    for (var i = 0; i < matches.length; i++)
      rooms.push({ matchId: matches[i].matchId, size: matches[i].size });
    return JSON.stringify({ rooms: rooms });
  } catch(e) { return JSON.stringify({ rooms: [] }); }
}

function rpcGetLeaderboard(ctx, logger, nk, payload) {
  try {
    var res = nk.leaderboardRecordsList(LEADERBOARD_ID, [], 20, null, 0);
    return JSON.stringify({ records: res.records || [] });
  } catch(e) { return JSON.stringify({ records: [] }); }
}

// ── InitModule — called by Nakama on startup ──────────────────────────────────
function InitModule(ctx, logger, nk, initializer) {
  logger.info("TIC-TAC-TOE Loading...");
  try { nk.leaderboardCreate(LEADERBOARD_ID, false, "desc", "incr", 0, {}); } catch(e) {}

  initializer.registerMatch("tictactoe", {
    matchInit:        matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin:        matchJoin,
    matchLeave:       matchLeave,
    matchLoop:        matchLoop,
    matchTerminate:   matchTerminate,
    matchSignal:      matchSignal
  });

  // Pass function NAMES (references), not inline anonymous functions
  initializer.registerRpc("create_private_room", rpcCreatePrivateRoom);
  initializer.registerRpc("create_public_room",  rpcCreatePublicRoom);
  initializer.registerRpc("list_open_rooms",     rpcListOpenRooms);
  initializer.registerRpc("get_leaderboard",     rpcGetLeaderboard);

  logger.info("TIC-TAC-TOE InitModule complete");
}