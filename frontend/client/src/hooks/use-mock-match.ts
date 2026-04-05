// use-mock-match.ts — Complete game hook
// Bot game: local only, instant
// Multiplayer: BroadcastChannel (same browser) + localStorage polling (cross-device same WiFi)

import { useState, useEffect, useCallback, useRef } from "react";
import { sessionManager } from "@/lib/session-manager";

// ─── Types ────────────────────────────────────────────────────────────────────
export type Player = {
  id: string;
  name: string;
  avatar: string;
  symbol: "X" | "O";
};

export type GameState = {
  board: (string | null)[];
  currentPlayerIndex: number; // 0 = X's turn, 1 = O's turn
  winner: string | null;
  winningLine: number[] | null;
  status: "waiting" | "playing" | "finished";
  turnTimeLeft: number;
  rematchRequested: boolean;
  rematchFrom: string | null;
  rematchDeniedBy: string | null;
  oppLeft: boolean;
};

// ─── Win detection ────────────────────────────────────────────────────────────
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(b: (string|null)[]): { symbol: string; line: number[] } | null {
  for (const [a,x,c] of WIN_LINES)
    if (b[a] && b[a] === b[x] && b[a] === b[c]) return { symbol: b[a]!, line: [a,x,c] };
  if (b.every(v => v !== null)) return { symbol: "draw", line: [] };
  return null;
}

// ─── Bot AI (50% smart, 50% random so player can win) ─────────────────────────
function minimax(b: (string|null)[], d: number, max: boolean): number {
  const r = checkWinner(b);
  if (r?.symbol === "O") return 10 - d;
  if (r?.symbol === "X") return d - 10;
  if (r?.symbol === "draw") return 0;
  const emp = b.reduce<number[]>((a,v,i) => v===null ? [...a,i] : a, []);
  if (!emp.length) return 0;
  if (max) {
    let best = -Infinity;
    for (const i of emp) { b[i]="O"; best=Math.max(best,minimax(b,d+1,false)); b[i]=null; }
    return best;
  } else {
    let best = Infinity;
    for (const i of emp) { b[i]="X"; best=Math.min(best,minimax(b,d+1,true)); b[i]=null; }
    return best;
  }
}

function getBotMove(b: (string|null)[]): number {
  const emp = b.reduce<number[]>((a,v,i) => v===null ? [...a,i] : a, []);
  if (!emp.length) return -1;
  if (Math.random() < 0.5) return emp[Math.floor(Math.random()*emp.length)]; // random 50%
  let best = -Infinity, mv = emp[0];
  const cp = [...b];
  for (const i of emp) { cp[i]="O"; const s=minimax(cp,0,false); cp[i]=null; if(s>best){best=s;mv=i;} }
  return mv;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
const NAKAMA_HOST = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_NAKAMA_HOST) || "tic-tac-toe-8a0o.onrender.com";
const USE_SSL_NAK = NAKAMA_HOST !== "localhost";
const HTTP_NAK    = USE_SSL_NAK ? "https" : "http";
const PORT_NAK    = USE_SSL_NAK ? "443" : "7350";
const NAK_KEY     = "defaultkey";

function getNakDeviceId(): string {
  let id = sessionStorage.getItem("nakama_device");
  if (!id) { id = "dev_" + Math.random().toString(36).slice(2) + "_" + Date.now(); sessionStorage.setItem("nakama_device", id); }
  return id;
}

async function nakWriteStats(s: {wins:number;losses:number;draws:number;rating:number}, name: string, avatar: string) {
  try {
    const deviceId = getNakDeviceId();
    const creds = btoa(NAK_KEY + ":");
    const url = `${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/account/authenticate/device?create=true`;
    const authRes = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/json" },
      body: JSON.stringify({ id: deviceId }),
    });
    if (!authRes.ok) return;
    const authData = await authRes.json();
    const token = authData.token;
    // Write to Nakama storage (shared across all browsers/devices)
    const writeRes = await fetch(`${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/storage`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([{
        collection: "player_stats",
        key: deviceId,
        value: { name, avatar, ...s },
        version: "*",
      }]),
    });
    if (!writeRes.ok) console.warn("[Nakama] storage write failed:", writeRes.status);
  } catch (e) { console.warn("[Nakama] storage write error:", e); }
}

async function nakReadAllStats(): Promise<any[]> {
  try {
    const deviceId = getNakDeviceId();
    const creds = btoa(NAK_KEY + ":");
    const url = `${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/account/authenticate/device?create=true`;
    const authRes = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/json" },
      body: JSON.stringify({ id: deviceId }),
    });
    if (!authRes.ok) throw new Error("auth failed");
    const authData = await authRes.json();
    const token = authData.token;
    // List all records in player_stats collection
    const listRes = await fetch(`${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/storage?collection=player_stats&limit=100`, {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!listRes.ok) throw new Error("storage list failed");
    const listData = await listRes.json();
    return (listData.records || []).map((r: any) => r.value);
  } catch (e) { console.warn("[Nakama] storage read error:", e); return []; }
}

function getStats() {
  try { const r = sessionStorage.getItem("sessionStats"); if (r) return JSON.parse(r); } catch {}
  return { wins:0, losses:0, draws:0, rating:1000 };
}

function saveStats(s: {wins:number;losses:number;draws:number;rating:number}) {
  sessionStorage.setItem("sessionStats", JSON.stringify(s));
  const name = sessionManager.getPlayerName() || "Player";
  const avatar = sessionManager.getPlayerAvatar() || "x";
  // Also write to Nakama storage (cross-device sync)
  nakWriteStats(s, name, avatar).catch(() => {});
  // Fallback: localStorage
  try {
    const lb: any[] = JSON.parse(localStorage.getItem("leaderboard") || "[]");
    const idx = lb.findIndex((e:any) => e.name === name);
    const entry = { name, avatar, ...s };
    if (idx >= 0) lb[idx] = entry; else lb.push(entry);
    lb.sort((a:any,b:any) => b.rating - a.rating);
    localStorage.setItem("leaderboard", JSON.stringify(lb));
  } catch {}
}

export { nakReadAllStats };

export function recordResult(r: "win"|"loss"|"draw") {
  const s = getStats();
  if (r==="win")  { s.wins++;   s.rating = Math.min(3000, s.rating+25); }
  if (r==="loss") { s.losses++; s.rating = Math.max(100,  s.rating-20); }
  if (r==="draw") { s.draws++;  s.rating = Math.min(3000, s.rating+5);  }
  saveStats(s);
}

// ─── Cross-tab/cross-device event bus ─────────────────────────────────────────
// BroadcastChannel: instant, same browser only
// localStorage polling: works across devices on same network (via a shared backend room state)
const BC_NAME  = "ttt_game_bc_v3";
const LS_KEY   = "ttt_game_ev_v3";

export type GameEvent =
  | { type:"PLAYER_JOIN";  roomId:string; name:string; avatar:string;     _ts:number }
  | { type:"START_GAME";   roomId:string; xName:string; xAvatar:string; oName:string; oAvatar:string; _ts:number }
  | { type:"MOVE";         roomId:string; board:(string|null)[]; nextIdx:number; _ts:number }
  | { type:"GAME_OVER";    roomId:string; winner:string|null; winLine:number[]|null; board:(string|null)[]; _ts:number }
  | { type:"TICK";         roomId:string; timeLeft:number; currentIdx:number; _ts:number }
  | { type:"TIMEOUT";      roomId:string; loserSym:string; _ts:number }
  | { type:"OPP_LEFT";     roomId:string; name:string; _ts:number }
  | { type:"REMATCH_REQ";  roomId:string; name:string; _ts:number }
  | { type:"REMATCH_ACC";  roomId:string; _ts:number }
  | { type:"REMATCH_DEN";  roomId:string; name:string; _ts:number };

export function sendGameEvent(ev: Omit<GameEvent, "_ts">) {
  const stamped = { ...ev, _ts: Date.now() } as GameEvent;
  try { const bc = new BroadcastChannel(BC_NAME); bc.postMessage(stamped); bc.close(); } catch {}
  try { localStorage.setItem(LS_KEY, JSON.stringify(stamped)); } catch {}

  // Also write to Nakama storage for cross-device sync (fire-and-forget)
  writeEventToNakama(stamped).catch(() => {});
}

async function writeEventToNakama(stamped: GameEvent) {
  try {
    const deviceId = getNakDeviceId();
    const creds = btoa(NAK_KEY + ":");
    const url = `${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/account/authenticate/device?create=true`;
    const authRes = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/json" },
      body: JSON.stringify({ id: deviceId }),
    });
    if (authRes.ok) {
      const authData = await authRes.json();
      const token = authData.token;
      // Store game event in Nakama storage with room ID as key prefix
      const eventKey = `game_event_${stamped.roomId}_${stamped._ts}`;
      await fetch(`${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/storage`, {
        method: "PUT",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify([{
          collection: "game_events",
          key: eventKey,
          value: stamped,
          version: "*",
        }]),
      });
    }
  } catch (e) { console.warn("[Nakama] event write error:", e); }
}

// ─── Fresh state helper ───────────────────────────────────────────────────────
function freshState(status: GameState["status"] = "waiting"): GameState {
  return {
    board: Array(9).fill(null),
    currentPlayerIndex: 0,
    winner: null,
    winningLine: null,
    status,
    turnTimeLeft: 30,
    rematchRequested: false,
    rematchFrom: null,
    rematchDeniedBy: null,
    oppLeft: false,
  };
}

// ─── Main hook ────────────────────────────────────────────────────────────────
export function useMockMatch(isBot: boolean, roomId?: string) {
  const myName   = sessionManager.getPlayerName()   || "Player";
  const myAvatar = sessionManager.getPlayerAvatar() || "x";

  // Am I the room creator (X) or joiner (O)?
  const isCreatorRef = useRef<boolean>(true); // default true for bot
  const resultDone   = useRef(false);
  const seenTs       = useRef(0);
  // Always-refresh symbol for move validation (avoids stale localSymbol closure)
  const mySymbolRef = useRef<"X"|"O">("X");
  // Store opponent info for rematch
  const opponentRef = useRef<{name: string; avatar: string}>({name: "Opponent", avatar: "remote"});

  // localSymbol: which symbol this tab plays
  const [localSymbol, setLocalSymbol] = useState<"X"|"O">("X");

  // Keep mySymbolRef in sync with localSymbol (avoids stale closure in makeMove)
  useEffect(() => { mySymbolRef.current = localSymbol; }, [localSymbol]);

  const [players, setPlayers] = useState<Player[]>([
    { id:"me",  name:myName,  avatar:myAvatar, symbol:"X" },
    isBot
      ? { id:"bot",      name:"Bot",          avatar:"robot",   symbol:"O" }
      : { id:"opponent", name:"Waiting...",    avatar:"unknown", symbol:"O" },
  ]);

  const [gameState, setGameState] = useState<GameState>(
    freshState(isBot ? "playing" : "waiting")
  );

  // ── Resolve creator/joiner on mount ───────────────────────────────────────
  useEffect(() => {
    if (isBot || !roomId) return;
    import("@/lib/room-manager").then(({ roomManager }) => {
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const fp = sessionManager.getFingerprint();
      const iAm = room.creatorFingerprint === fp;
      isCreatorRef.current = iAm;

      if (iAm) {
        // I am X (host)
        setLocalSymbol("X");
        setPlayers([
          { id:"me",       name:myName,         avatar:myAvatar,         symbol:"X" },
          { id:"opponent", name:"Waiting...",    avatar:"unknown",        symbol:"O" },
        ]);
      } else {
        // I am O (joiner) — send JOIN event so host knows I'm here
        setLocalSymbol("O");
        setPlayers([
          { id:"opponent", name:room.creatorName, avatar:room.creatorAvatar, symbol:"X" },
          { id:"me",       name:myName,            avatar:myAvatar,           symbol:"O" },
        ]);
        sendGameEvent({ type:"PLAYER_JOIN", roomId, name:myName, avatar:myAvatar });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, roomId]);

  // ── Process incoming event ─────────────────────────────────────────────────
  const handleEvent = useCallback((raw: unknown) => {
    if (!roomId) return;
    const e = raw as GameEvent;
    if (!e?.type || e.roomId !== roomId) return;
    // Deduplicate by timestamp
    if (e._ts && e._ts <= seenTs.current) return;
    if (e._ts) seenTs.current = e._ts;

    switch (e.type) {

      case "PLAYER_JOIN":
        if (!isCreatorRef.current) return; // only host processes this
        // Store opponent info for rematch
        opponentRef.current = { name: e.name, avatar: e.avatar };
        // Update opponent name and start game
        setPlayers([
          { id:"me",       name:myName, avatar:myAvatar, symbol:"X" },
          { id:"opponent", name:e.name, avatar:e.avatar, symbol:"O" },
        ]);
        setGameState(prev => ({ ...prev, status:"playing" }));
        // Tell the joiner to start as well
        sendGameEvent({ type:"START_GAME", roomId, xName:myName, xAvatar:myAvatar, oName:e.name, oAvatar:e.avatar });
        break;

      case "START_GAME":
        if (isCreatorRef.current) return; // host already started
        // Store opponent info for rematch
        opponentRef.current = { name: e.xName, avatar: e.xAvatar };
        setPlayers([
          { id:"opponent", name:e.xName, avatar:e.xAvatar, symbol:"X" },
          { id:"me",       name:e.oName, avatar:e.oAvatar, symbol:"O" },
        ]);
        setGameState(prev => ({ ...prev, status:"playing" }));
        break;

      case "MOVE":
        setGameState(prev => ({
          ...prev,
          board: e.board,
          currentPlayerIndex: e.nextIdx,
          turnTimeLeft: 30,
        }));
        break;

      case "GAME_OVER": {
        if (!resultDone.current) {
          resultDone.current = true;
          const mySym = isCreatorRef.current ? "X" : "O";
          if (e.winner === "draw")   recordResult("draw");
          else if (e.winner===mySym) recordResult("win");
          else                       recordResult("loss");
        }
        setGameState(prev => ({
          ...prev,
          board: e.board,
          status: "finished",
          winner: e.winner,
          winningLine: e.winLine,
          turnTimeLeft: 0,
        }));
        break;
      }

      case "TICK":
        if (isCreatorRef.current) return; // host drives the timer
        setGameState(prev => ({
          ...prev,
          turnTimeLeft: e.timeLeft,
          currentPlayerIndex: e.currentIdx,
        }));
        break;

      case "TIMEOUT": {
        const mySym = isCreatorRef.current ? "X" : "O";
        const winSym: "X"|"O" = e.loserSym === "X" ? "O" : "X";
        if (!resultDone.current) {
          resultDone.current = true;
          recordResult(e.loserSym === mySym ? "loss" : "win");
        }
        setGameState(prev => ({
          ...prev,
          status: "finished",
          winner: winSym,
          turnTimeLeft: 0,
        }));
        break;
      }

      case "OPP_LEFT":
        setGameState(prev => ({ ...prev, oppLeft:true, status:"finished", winner:"forfeit" }));
        break;

      case "REMATCH_REQ":
        if (e.name !== myName) {
          setGameState(prev => ({ ...prev, rematchFrom:e.name }));
        }
        break;

      case "REMATCH_ACC":
        resultDone.current = false;
        // Reset the board and game state for both players
        // This fires on BOTH requestor and acceptor sides when acceptor sends REMATCH_ACC
        const fresh = freshState("playing");
        setGameState(fresh);
        // Reset players - keep original roles AND opponent info (creator=X, joiner=O)
        if (isCreatorRef.current) {
          // I am the creator (host) - I'm X, keep real opponent name/avatar
          setPlayers([
            { id: "me", name: myName, avatar: myAvatar, symbol: "X" as const },
            { id: "opponent", name: opponentRef.current.name, avatar: opponentRef.current.avatar, symbol: "O" as const },
          ]);
          mySymbolRef.current = "X";
        } else {
          // I am the joiner (guest) - I'm O, keep real opponent name/avatar
          setPlayers([
            { id: "opponent", name: opponentRef.current.name, avatar: opponentRef.current.avatar, symbol: "X" as const },
            { id: "me", name: myName, avatar: myAvatar, symbol: "O" as const },
          ]);
          mySymbolRef.current = "O";
        }
        break;

      case "REMATCH_DEN":
        // Show declined message to the player who requested
        setGameState(prev => ({
          ...prev,
          rematchRequested: false,
          rematchFrom: null,
          rematchDeniedBy: e.name,
        }));
        break;
    }
  }, [roomId, myName, myAvatar]);

  // ── BroadcastChannel listener (same browser, instant) ─────────────────────
  useEffect(() => {
    if (isBot || !roomId) return;
    let bc: BroadcastChannel;
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = (ev) => handleEvent(ev.data);
    } catch {}
    return () => { try { bc?.close(); } catch {} };
  }, [isBot, roomId, handleEvent]);

  // ── localStorage polling (cross-device on same WiFi via shared room state) ─
  useEffect(() => {
    if (isBot || !roomId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY || !e.newValue) return;
      try { handleEvent(JSON.parse(e.newValue)); } catch {}
    };
    window.addEventListener("storage", onStorage);
    // Poll every 250ms for events we may have missed
    const poll = setInterval(() => {
      try { const raw = localStorage.getItem(LS_KEY); if (raw) handleEvent(JSON.parse(raw)); } catch {}
    }, 250);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(poll); };
  }, [isBot, roomId, handleEvent]);

  // ── Nakama storage polling (cross-device over internet) ────────────────────
  useEffect(() => {
    if (isBot || !roomId) return;
    const processedKeys = new Set<string>();
    const pollNakamaEvents = async () => {
      try {
        const deviceId = getNakDeviceId();
        const creds = btoa(NAK_KEY + ":");
        const url = `${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/account/authenticate/device?create=true`;
        const authRes = await fetch(url, {
          method: "POST",
          headers: { "Authorization": "Basic " + creds, "Content-Type": "application/json" },
          body: JSON.stringify({ id: deviceId }),
        });
        if (!authRes.ok) return;
        const authData = await authRes.json();
        const token = authData.token;
        // List all game events for this room
        const listRes = await fetch(`${HTTP_NAK}://${NAKAMA_HOST}:${PORT_NAK}/v2/storage?collection=game_events&limit=100`, {
          headers: { "Authorization": "Bearer " + token },
        });
        if (!listRes.ok) return;
        const listData = await listRes.json();
        // Filter events for this room and process them in order
        const roomEvents = (listData.records || [])
          .filter((r: any) => r.value.roomId === roomId && !processedKeys.has(r.storageObjectId))
          .sort((a: any, b: any) => (a.value._ts || 0) - (b.value._ts || 0));
        for (const record of roomEvents) {
          processedKeys.add(record.storageObjectId);
          handleEvent(record.value);
        }
      } catch (e) { console.warn("[Nakama] event poll error:", e); }
    };
    // Poll every 500ms for Nakama events
    const poll = setInterval(pollNakamaEvents, 500);
    pollNakamaEvents(); // Initial poll
    return () => clearInterval(poll);
  }, [isBot, roomId, handleEvent]);

  // ── Authoritative timer (host/bot drives it; non-host follows TICK) ────────
  useEffect(() => {
    if (gameState.status !== "playing") return;
    // Non-host in multiplayer: only follow TICK events, don't drive timer
    if (!isBot && !isCreatorRef.current) return;

    const t = setInterval(() => {
      setGameState(prev => {
        if (prev.status !== "playing") return prev;
        const left = prev.turnTimeLeft - 1;
        // Broadcast tick to the other player
        if (!isBot && roomId) {
          sendGameEvent({ type:"TICK", roomId, timeLeft:left, currentIdx:prev.currentPlayerIndex });
        }
        if (left <= 0) {
          const loserSym = prev.currentPlayerIndex === 0 ? "X" : "O";
          const winSym: "X"|"O" = loserSym === "X" ? "O" : "X";
          if (!isBot && roomId) {
            sendGameEvent({ type:"TIMEOUT", roomId, loserSym });
          }
          if (!resultDone.current) {
            resultDone.current = true;
            const mySym = isBot ? "X" : (isCreatorRef.current ? "X" : "O");
            recordResult(loserSym === mySym ? "loss" : "win");
          }
          return { ...prev, status:"finished", winner:winSym, turnTimeLeft:0 };
        }
        return { ...prev, turnTimeLeft:left };
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.status, isBot, roomId]);

  // ── Bot AI trigger ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isBot || gameState.status !== "playing" || gameState.currentPlayerIndex !== 1) return;
    const delay = setTimeout(() => {
      const mv = getBotMove(gameState.board);
      if (mv !== -1) makeMove(mv);
    }, 800 + Math.random() * 1200);
    return () => clearTimeout(delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, gameState.status, gameState.currentPlayerIndex, gameState.board]);

  // ── Make move ──────────────────────────────────────────────────────────────
  const makeMove = useCallback((index: number) => {
    setGameState(prev => {
      if (prev.status !== "playing" || prev.board[index] !== null) return prev;

      // For multiplayer: check it's my turn using fresh mySymbolRef (avoids stale localSymbol closure)
      if (!isBot && roomId) {
        const currentSym = prev.currentPlayerIndex === 0 ? "X" : "O";
        if (mySymbolRef.current !== currentSym) return prev; // not my turn — block
      }

      const sym = prev.currentPlayerIndex === 0 ? "X" : "O";
      const newBoard = [...prev.board];
      newBoard[index] = sym;
      const nextIdx = prev.currentPlayerIndex === 0 ? 1 : 0;
      const result = checkWinner(newBoard);

      if (result) {
        const winner = result.symbol === "draw" ? "draw" : result.symbol;
        const winLine = result.line.length > 0 ? result.line : null;
        if (!isBot && roomId) {
          sendGameEvent({ type:"GAME_OVER", roomId, winner, winLine, board:newBoard });
        }
        if (!resultDone.current) {
          resultDone.current = true;
          // Use mySymbolRef.current (fresh, not stale) for stats
          const mySym = isBot ? "X" : mySymbolRef.current;
          if (winner === "draw")      recordResult("draw");
          else if (winner === mySym)  recordResult("win");
          else                        recordResult("loss");
        }
        return { ...prev, board:newBoard, status:"finished", winner, winningLine:winLine, turnTimeLeft:0 };
      }

      if (!isBot && roomId) {
        sendGameEvent({ type:"MOVE", roomId, board:newBoard, nextIdx });
      }
      return { ...prev, board:newBoard, currentPlayerIndex:nextIdx, turnTimeLeft:30 };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, roomId]);

  // ── Rematch ────────────────────────────────────────────────────────────────
  const requestRematch = useCallback(() => {
    if (isBot) {
      // Bot: always keep player at index 0 as X, bot at index 1 as O
      // This way currentPlayerIndex=0 always means "my turn" regardless of which game it is
      setPlayers([
        { id:"me",  name:myName,  avatar:myAvatar, symbol:"X" },
        { id:"bot", name:"Bot",   avatar:"robot",  symbol:"O" },
      ]);
      resultDone.current = false;
      setGameState({ ...freshState("playing"), currentPlayerIndex: 0 });
      return;
    }
    if (!roomId) return;
    // Reset room status so both players can re-enter for rematch
    import("@/lib/room-manager").then(({ roomManager }) => {
      roomManager.updateRoom(roomId, { status: "playing" });
    });
    sendGameEvent({ type:"REMATCH_REQ", roomId, name:myName });
    setGameState(prev => ({ ...prev, rematchRequested:true }));
  }, [isBot, roomId, myName, myAvatar]);

  const acceptRematch = useCallback(() => {
    if (!roomId) return;
    // Reset room status so both players can re-enter
    import("@/lib/room-manager").then(({ roomManager }) => {
      roomManager.updateRoom(roomId, { status: "playing" });
    });
    // Send REMATCH_ACC event - this will reset BOTH players' game state
    sendGameEvent({ type:"REMATCH_ACC", roomId });
    resultDone.current = false;
    // Reset our own state immediately
    setGameState(freshState("playing"));
  }, [roomId]);

  const denyRematch = useCallback(() => {
    if (!roomId) return;
    sendGameEvent({ type:"REMATCH_DEN", roomId, name:myName });
    setGameState(prev => ({ ...prev, rematchFrom:null }));
  }, [roomId, myName]);

  const notifyLeave = useCallback(() => {
    if (isBot || !roomId) return;
    sendGameEvent({ type:"OPP_LEFT", roomId, name:myName });
  }, [isBot, roomId, myName]);

  return {
    players, setPlayers, gameState, setGameState, localSymbol,
    makeMove, requestRematch, acceptRematch, denyRematch, notifyLeave,
    nakReadAllStats,
  };
}