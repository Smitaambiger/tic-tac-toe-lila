// use-nakama-match.ts — Real Nakama WebSocket multiplayer hook
// Works across ANY device on ANY network

import { useState, useCallback, useEffect, useRef } from "react";
import { sessionManager } from "@/lib/session-manager";
import * as nk from "@/lib/nakama-client";

export type Player = {
  id: "local" | "remote" | "bot";
  name: string;
  avatar: string;
  symbol: "X" | "O";
};

export type GameState = {
  board: (string | null)[];
  currentPlayerIndex: number;  // 0 = my turn, 1 = opponent turn
  status: "waiting" | "playing" | "finished";
  winner: string | null;
  winningLine: number[] | null;
  oppLeft: boolean;
  turnTimeLeft: number;
  rematchFrom: string | null;
  rematchRequested: boolean;
  rematchDeniedBy: string | null;
};

const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWin(b: (string|null)[]): {winner:string;line:number[]}|null {
  for (const [a,c,d] of WIN_LINES)
    if (b[a] && b[a]===b[c] && b[a]===b[d]) return {winner:b[a]!,line:[a,c,d]};
  if (b.every(Boolean)) return {winner:"draw",line:[]};
  return null;
}

function fresh(): GameState {
  return {
    board: Array(9).fill(null), currentPlayerIndex: 0,
    status: "waiting", winner: null, winningLine: null,
    oppLeft: false, turnTimeLeft: 30,
    rematchFrom: null, rematchRequested: false, rematchDeniedBy: null,
  };
}

function updateStats(r: "win"|"loss"|"draw") {
  try {
    const raw = sessionStorage.getItem("sessionStats");
    const s = raw ? JSON.parse(raw) : {wins:0,losses:0,draws:0,rating:1000};
    if (r==="win")  { s.wins++;   s.rating = Math.min(3000, s.rating+25); }
    if (r==="loss") { s.losses++; s.rating = Math.max(100,  s.rating-20); }
    if (r==="draw") { s.draws++;  s.rating = Math.min(3000, s.rating+5);  }
    s._updatedAt = Date.now();
    sessionStorage.setItem("sessionStats", JSON.stringify(s));
    const name = sessionManager.getPlayerName()||"Player";
    const av   = sessionManager.getPlayerAvatar()||"x";
    const lb: any[] = JSON.parse(localStorage.getItem("leaderboard")||"[]");
    const idx = lb.findIndex((e:any)=>e.name===name);
    const entry = {name,avatar:av,...s};
    if (idx>=0) lb[idx]=entry; else lb.push(entry);
    localStorage.setItem("leaderboard", JSON.stringify(lb));
  } catch {}
}

// Compute currentPlayerIndex from local player's perspective
// 0 = it's MY turn, 1 = opponent's turn
function myTurnIndex(currentSymbol: string, mySymbol: "X"|"O"): number {
  return currentSymbol === mySymbol ? 0 : 1;
}

export function useNakamaMatch(enabled: boolean, matchIdProp?: string) {
  const myName   = sessionManager.getPlayerName()   || "Player";
  const myAvatar = sessionManager.getPlayerAvatar() || "x";

  const mySymRef  = useRef<"X"|"O">("X");
  const matchRef  = useRef<string>(matchIdProp || "");
  const timerRef  = useRef<any>(null);
  const unsubRef  = useRef<(()=>void)|null>(null);
  const statsDone = useRef(false);

  const [localSymbol, setLocalSymbol] = useState<"X"|"O">("X");
  const [gameState,   setGameState]   = useState<GameState>(fresh);
  const [players,     setPlayers]     = useState<Player[]>([
    { id:"local",  name:myName,   avatar:myAvatar, symbol:"X" },
    { id:"remote", name:"Opponent", avatar:"x",    symbol:"O" },
  ]);
  const [connected, setConnected] = useState(false);

  // ── Timer (driven by TICK from server) ───────────────────────────
  // We use TICK from Nakama server as the authoritative timer
  // Local timer is fallback only
  const startLocalTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setGameState(prev => {
        if (prev.status !== "playing") { clearInterval(timerRef.current); return prev; }
        const t = Math.max(0, prev.turnTimeLeft - 1);
        return { ...prev, turnTimeLeft: t };
      });
    }, 1000);
  }, []);

  // ── Handle Nakama messages ────────────────────────────────────────
  const handleMsg = useCallback((msg: any) => {
    if (!msg.match_data) return;
    let data: any;
    try { data = JSON.parse(atob(msg.match_data.data)); } catch { return; }

    const myId = nk.getSession()?.userId;

    switch (data.type) {
      case "GAME_START":
      case "WAITING": {
        const s = data.state;
        if (!s?.players) return;
        const myEntry  = Object.entries(s.players).find(([id]) => id === myId);
        const oppEntry = Object.entries(s.players).find(([id]) => id !== myId);
        if (!myEntry) return;

        const mySym = (myEntry[1] as any).symbol as "X"|"O";
        const oppInfo = oppEntry ? (oppEntry[1] as any) : null;

        mySymRef.current = mySym;
        setLocalSymbol(mySym);
        setPlayers([
          { id:"local",  name:myName,  avatar:myAvatar, symbol:mySym },
          { id:"remote", name:oppInfo?.name||"Opponent", avatar:"remote", symbol:mySym==="X"?"O":"X" },
        ]);

        if (data.type === "GAME_START") {
          statsDone.current = false;
          setGameState({
            ...fresh(),
            board: s.board || Array(9).fill(null),
            currentPlayerIndex: myTurnIndex(s.currentSymbol || "X", mySym),
            status: "playing",
            turnTimeLeft: s.timeLeft || 30,
          });
          startLocalTimer();
        }
        break;
      }

      case "MOVE": {
        const s = data.state;
        setGameState(prev => ({
          ...prev,
          board: s.board,
          currentPlayerIndex: myTurnIndex(s.currentSymbol, mySymRef.current),
          turnTimeLeft: s.timeLeft || 30,
        }));
        startLocalTimer();
        break;
      }

      case "GAME_OVER": {
        clearInterval(timerRef.current);
        const s = data.state;
        const winnerId = s.winner;
        const isDraw   = winnerId === "draw";
        const winnerEntry = winnerId && !isDraw
          ? Object.entries(s.players || {}).find(([id]) => id === winnerId)
          : null;
        const winnerSym = winnerEntry ? (winnerEntry[1] as any).symbol : null;
        const iWon = !isDraw && winnerSym === mySymRef.current;

        if (!statsDone.current) {
          statsDone.current = true;
          updateStats(isDraw ? "draw" : iWon ? "win" : "loss");
        }

        setGameState(prev => ({
          ...prev,
          board: s.board || prev.board,
          status: "finished",
          winner: isDraw ? "draw" : (iWon ? mySymRef.current : (mySymRef.current==="X"?"O":"X")),
          winningLine: s.winningLine || null,
          rematchFrom: null, rematchRequested: false,
        }));
        break;
      }

      case "TIMEOUT": {
        clearInterval(timerRef.current);
        const s = data.state;
        const winnerId = data.winner;
        const iWon = winnerId === myId;
        if (!statsDone.current) {
          statsDone.current = true;
          updateStats(iWon ? "win" : "loss");
        }
        setGameState(prev => ({
          ...prev, status: "finished",
          winner: iWon ? mySymRef.current : (mySymRef.current==="X"?"O":"X"),
          rematchFrom: null, rematchRequested: false,
        }));
        break;
      }

      case "TICK":
        setGameState(prev => prev.status==="playing"
          ? { ...prev, turnTimeLeft: data.timeLeft ?? prev.turnTimeLeft,
              currentPlayerIndex: myTurnIndex(data.currentSymbol, mySymRef.current) }
          : prev);
        break;

      case "REMATCH_REQUESTED":
        // Only show popup to the OPPONENT — not to the person who requested
        if (data.fromName !== myName) {
          setGameState(prev => ({ ...prev, rematchFrom: data.fromName }));
        }
        break;

      case "REMATCH_WAITING":
        setGameState(prev => ({ ...prev, rematchRequested: true, rematchFrom: null }));
        break;

      case "REMATCH_DENIED":
        // Styled banner — NO alert()
        setGameState(prev => ({
          ...prev, rematchFrom: null, rematchRequested: false,
          rematchDeniedBy: data.fromName || "Opponent",
        }));
        setTimeout(() => setGameState(prev => ({ ...prev, rematchDeniedBy: null })), 4000);
        break;

      case "REMATCH_START": {
        const s = data.state;
        const myEntry = s.players && Object.entries(s.players).find(([id]) => id === myId);
        if (myEntry) {
          const sym = (myEntry[1] as any).symbol as "X"|"O";
          mySymRef.current = sym;
          setLocalSymbol(sym);
          setPlayers(prev => prev.map(p =>
            p.id === "local" ? { ...p, symbol: sym } : { ...p, symbol: sym==="X"?"O":"X" }
          ));
        }
        statsDone.current = false;
        setGameState({
          ...fresh(),
          board: s.board || Array(9).fill(null),
          currentPlayerIndex: myTurnIndex(s.currentSymbol || "X", mySymRef.current),
          status: "playing",
          turnTimeLeft: s.timeLeft || 30,
        });
        startLocalTimer();
        break;
      }

      case "OPP_LEFT":
      case "PLAYER_LEFT":
        clearInterval(timerRef.current);
        if (!statsDone.current) {
          statsDone.current = true;
          updateStats("win");
        }
        setGameState(prev => ({ ...prev, status:"finished", oppLeft:true, winner:"forfeit",
          rematchFrom:null, rematchRequested:false }));
        break;
    }
  }, [myName, myAvatar, startLocalTimer]);

  // ── Connect to Nakama & join match ────────────────────────────────
  const startMultiplayer = useCallback(async (matchId?: string) => {
    if (!enabled) return;
    try {
      const session = await nk.authenticate(myName);
      await nk.connectSocket(session);
      setConnected(true);

      const mid = matchId || matchIdProp || "";
      matchRef.current = mid;

      // Remove old handler and register new one
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = nk.onMessage(handleMsg);

      nk.joinNakamaMatch(mid);

      // Send display name + avatar to server
      setTimeout(() => {
        nk.sendMatchData(mid, 3, { type:"SET_META", name:myName, avatar:myAvatar });
      }, 600);
    } catch(e) {
      console.error("[Nakama] connect failed:", e);
    }
  }, [enabled, matchIdProp, myName, myAvatar, handleMsg]);

  // ── Moves ─────────────────────────────────────────────────────────
  const makeMove = useCallback((idx: number) => {
    setGameState(prev => {
      if (prev.status !== "playing") return prev;
      if (prev.currentPlayerIndex !== 0) return prev; // not my turn
      if (prev.board[idx]) return prev;

      const board = [...prev.board];
      board[idx] = mySymRef.current;
      nk.sendMatchData(matchRef.current, 3, { type:"MOVE", index:idx });

      const result = checkWin(board);
      if (result) {
        clearInterval(timerRef.current);
        if (!statsDone.current) {
          statsDone.current = true;
          updateStats(result.winner==="draw"?"draw":result.winner===mySymRef.current?"win":"loss");
        }
        return { ...prev, board, status:"finished", winner:result.winner, winningLine:result.line };
      }
      return { ...prev, board, currentPlayerIndex:1, turnTimeLeft:30 };
    });
  }, []);

  // ── Rematch ───────────────────────────────────────────────────────
  const requestRematch = useCallback(() => {
    nk.sendMatchData(matchRef.current, 3, { type:"REMATCH_REQUEST" });
    setGameState(prev => ({ ...prev, rematchRequested:true, rematchFrom:null }));
  }, []);

  const acceptRematch = useCallback(() => {
    nk.sendMatchData(matchRef.current, 3, { type:"REMATCH_REQUEST" });
    setGameState(prev => ({ ...prev, rematchFrom:null, rematchRequested:false }));
  }, []);

  const denyRematch = useCallback(() => {
    nk.sendMatchData(matchRef.current, 3, { type:"REMATCH_DENY" });
    setGameState(prev => ({ ...prev, rematchFrom:null, rematchRequested:false }));
  }, []);

  const notifyLeave = useCallback(() => {
    if (matchRef.current) nk.leaveNakamaMatch(matchRef.current);
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  return {
    gameState, players, localSymbol, makeMove, connected,
    requestRematch, acceptRematch, denyRematch, notifyLeave,
    startMultiplayer, matchRef,
  };
}