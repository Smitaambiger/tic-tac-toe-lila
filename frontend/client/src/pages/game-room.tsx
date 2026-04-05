import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Clock, RefreshCw, Copy, CheckCircle, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useMockMatch, sendGameEvent } from "@/hooks/use-mock-match";
import confetti from "canvas-confetti";
import { sessionManager } from "@/lib/session-manager";
import { roomManager } from "@/lib/room-manager";

// ─── Lobby sync channel ──────────────────────────────────────────────────────
const LOBBY_BC = "ttt_lobby_bc_v4";
const LOBBY_LS = "ttt_lobby_ev_v4";

type LobbyEvent =
  | { type:"HOST_HERE";       roomId:string; name:string; avatar:string; _ts:number }
  | { type:"GUEST_HERE";      roomId:string; name:string; avatar:string; _ts:number }
  | { type:"BOTH_READY";      roomId:string; _ts:number }
  | { type:"REMATCH_ACCEPTED"; roomId:string; _ts:number };

function sendLobby(ev: Omit<LobbyEvent,"_ts">) {
  const e = { ...ev, _ts: Date.now() } as LobbyEvent;
  try { const bc = new BroadcastChannel(LOBBY_BC); bc.postMessage(e); bc.close(); } catch {}
  try { localStorage.setItem(LOBBY_LS, JSON.stringify(e)); } catch {}
}

// ─── Cross-device lobby via Nakama storage ────────────────────────────────────
const NAKAMA_HOST = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_NAKAMA_HOST) || "tic-tac-toe-8a0o.onrender.com";
const USE_SSL = NAKAMA_HOST !== "localhost";
const HTTP_PROTO = USE_SSL ? "https" : "http";
const NAKAMA_PORT = USE_SSL ? "443" : "7350";
const NAK_KEY = "defaultkey";

function getNakDeviceId(): string {
  let id = sessionStorage.getItem("nakama_device");
  if (!id) { id = "dev_" + Math.random().toString(36).slice(2) + "_" + Date.now(); sessionStorage.setItem("nakama_device", id); }
  return id;
}

async function nakAuth(): Promise<string | null> {
  try {
    const creds = btoa(NAK_KEY + ":");
    const res = await fetch(`${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/account/authenticate/device?create=true`, {
      method: "POST",
      headers: { "Authorization": "Basic " + creds, "Content-Type": "application/json" },
      body: JSON.stringify({ id: getNakDeviceId() }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.token || null;
  } catch { return null; }
}

// Write a lobby event to Nakama storage so cross-device players can see it
async function nakWriteLobbyEvent(roomId: string, eventType: string, payload: object) {
  const token = await nakAuth();
  if (!token) return;
  try {
    await fetch(`${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/storage`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([{
        collection: "lobby_events",
        key: `${roomId}_${eventType}`,
        value: { roomId, eventType, _ts: Date.now(), ...payload },
        permission_read: 2,  // public read
        permission_write: 1, // owner write
      }]),
    });
  } catch {}
}

// Read lobby events from Nakama storage for this room
async function nakReadLobbyEvents(roomId: string): Promise<any[]> {
  const token = await nakAuth();
  if (!token) return [];
  try {
    const res = await fetch(
      `${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/storage?collection=lobby_events&limit=20`,
      { headers: { "Authorization": "Bearer " + token } }
    );
    if (!res.ok) return [];
    const d = await res.json();
    return (d.objects || d.records || [])
      .map((r: any) => r.value || r)
      .filter((v: any) => v.roomId === roomId);
  } catch { return []; }
}

// Write a game move event to Nakama storage so cross-device sync works
async function nakWriteGameEvent(roomId: string, event: object) {
  const token = await nakAuth();
  if (!token) return;
  const key = `${roomId}_ev_${Date.now()}`;
  try {
    await fetch(`${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/storage`, {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([{
        collection: "game_events",
        key,
        value: event,
        permission_read: 2,
        permission_write: 1,
      }]),
    });
  } catch {}
}

export default function GameRoom() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const isBot = id === "bot";

  const [hasProfile, setHasProfile] = useState(sessionManager.hasProfile());
  const [tempName,   setTempName]   = useState("Guest_" + Math.floor(Math.random()*1000));
  const [tempAvatar, setTempAvatar] = useState(sessionManager.generateAvatarSeed());
  const [copied,     setCopied]     = useState(false);

  const [lobbyPhase, setLobbyPhase] = useState<"waiting"|"both_ready"|"playing">("waiting");
  const [isCreator,  setIsCreator]  = useState(false);
  const [hostInfo,   setHostInfo]   = useState<{name:string;avatar:string}|null>(null);
  const [guestInfo,  setGuestInfo]  = useState<{name:string;avatar:string}|null>(null);
  const [postStats,  setPostStats]  = useState<{wins:number;losses:number;rating:number}|null>(null);
  const [rematchFrom,       setRematchFrom]       = useState<string|null>(null);
  const [rematchSent,       setRematchSent]        = useState(false);
  const [rematchDeclinedBy, setRematchDeclinedBy] = useState<string|null>(null);
  const [oppLeftMsg,        setOppLeftMsg]         = useState<string|null>(null);

  const inRematchFlow  = useRef(false);
  const bothReadyFired = useRef(false);
  const lobbySeenTs    = useRef(0);
  const nakLobbySeenTs = useRef(0);

  const myName   = sessionManager.getPlayerName()   || "Player";
  const myAvatar = sessionManager.getPlayerAvatar() || "x";

  // ── Use mock match for ALL scenarios (bot + multiplayer) ─────────────────
  const {
    players, setPlayers, gameState, setGameState, localSymbol, makeMove,
    requestRematch: _doRematch, acceptRematch: _doAccept, denyRematch: _doDeny,
    notifyLeave,
  } = useMockMatch(isBot, id && !isBot ? id : undefined);

  const myIndexRef = useRef<number>(0);
  useEffect(() => {
    myIndexRef.current = players.findIndex(p => p.id === "me" || p.id === "local");
  }, [players]);

  // ── Determine role on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (isBot || !id || !hasProfile) return;
    const room = roomManager.getRoom(id);
    if (!room) { setLocation("/matchmaking"); return; }
    const fp  = sessionManager.getFingerprint();
    const iAm = room.creatorFingerprint === fp;
    setIsCreator(iAm);

    if (iAm) {
      setHostInfo({ name:myName, avatar:myAvatar });
      sendLobby({ type:"HOST_HERE", roomId:id, name:myName, avatar:myAvatar });
      // Also write to Nakama so cross-device guests can see host
      nakWriteLobbyEvent(id, "HOST_HERE", { name:myName, avatar:myAvatar });
    } else {
      setGuestInfo({ name:myName, avatar:myAvatar });
      setHostInfo({ name:room.creatorName, avatar:room.creatorAvatar });
      if (room.status === "waiting") roomManager.joinRoom(id);
      sendLobby({ type:"GUEST_HERE", roomId:id, name:myName, avatar:myAvatar });
      // Also write to Nakama so cross-device host can see guest
      nakWriteLobbyEvent(id, "GUEST_HERE", { name:myName, avatar:myAvatar });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, id, hasProfile]);

  // ── Re-announce presence every 2s until both_ready ───────────────────────
  useEffect(() => {
    if (isBot || !id || !hasProfile || lobbyPhase !== "waiting") return;
    const t = setInterval(() => {
      if (isCreator) {
        sendLobby({ type:"HOST_HERE", roomId:id, name:myName, avatar:myAvatar });
        nakWriteLobbyEvent(id, "HOST_HERE", { name:myName, avatar:myAvatar });
      } else {
        sendLobby({ type:"GUEST_HERE", roomId:id, name:myName, avatar:myAvatar });
        nakWriteLobbyEvent(id, "GUEST_HERE", { name:myName, avatar:myAvatar });
      }
    }, 2000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, id, hasProfile, lobbyPhase, isCreator]);

  // ── Handle lobby events (same-browser via BroadcastChannel) ──────────────
  const handleLobbyEvent = useCallback((raw: unknown) => {
    const e = raw as LobbyEvent;
    if (!e?.type || !id || e.roomId !== id) return;
    if (e._ts && e._ts <= lobbySeenTs.current) return;
    if (e._ts) lobbySeenTs.current = e._ts;

    if (e.type === "HOST_HERE" && !isCreator) {
      setHostInfo({ name:(e as any).name, avatar:(e as any).avatar });
      sendLobby({ type:"GUEST_HERE", roomId:id, name:myName, avatar:myAvatar });
      if (inRematchFlow.current) { bothReadyFired.current = true; setLobbyPhase("playing"); }
      else setLobbyPhase("both_ready");
    }
    if (e.type === "GUEST_HERE" && isCreator) {
      setGuestInfo({ name:(e as any).name, avatar:(e as any).avatar });
      if (inRematchFlow.current) { bothReadyFired.current = true; setLobbyPhase("playing"); }
      else { setLobbyPhase("both_ready"); sendLobby({ type:"BOTH_READY", roomId:id }); }
    }
    if (e.type === "BOTH_READY") {
      if (inRematchFlow.current) { bothReadyFired.current = true; setLobbyPhase("playing"); }
      else setLobbyPhase("both_ready");
    }
    if (e.type === "REMATCH_ACCEPTED") {
      inRematchFlow.current = true;
      bothReadyFired.current = true;
      setLobbyPhase("playing");
      setRematchSent(false);
      setRematchFrom(null);
    }
  }, [id, isCreator, myName, myAvatar]);

  // ── Nakama lobby polling (cross-device over internet) ─────────────────────
  useEffect(() => {
    if (isBot || !id || !hasProfile) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      const events = await nakReadLobbyEvents(id);
      for (const ev of events) {
        if (!ev._ts || ev._ts <= nakLobbySeenTs.current) continue;
        nakLobbySeenTs.current = ev._ts;

        if (ev.eventType === "HOST_HERE" && !isCreator) {
          setHostInfo({ name: ev.name, avatar: ev.avatar });
          if (!inRematchFlow.current) setLobbyPhase("both_ready");
          else { bothReadyFired.current = true; setLobbyPhase("playing"); }
          // Write back our presence
          nakWriteLobbyEvent(id, "GUEST_HERE", { name: myName, avatar: myAvatar });
        }
        if (ev.eventType === "GUEST_HERE" && isCreator) {
          setGuestInfo({ name: ev.name, avatar: ev.avatar });
          if (!inRematchFlow.current) setLobbyPhase("both_ready");
          else { bothReadyFired.current = true; setLobbyPhase("playing"); }
        }
        if (ev.eventType === "BOTH_READY") {
          if (!inRematchFlow.current) setLobbyPhase("both_ready");
          else { bothReadyFired.current = true; setLobbyPhase("playing"); }
        }
      }
    };

    poll(); // immediate
    const iv = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBot, id, hasProfile, isCreator]);

  // ── BroadcastChannel lobby listener (same-browser instant) ───────────────
  useEffect(() => {
    if (isBot || !id) return;
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel(LOBBY_BC); bc.onmessage = ev => handleLobbyEvent(ev.data); } catch {}
    const poll = setInterval(() => {
      try { const raw = localStorage.getItem(LOBBY_LS); if (raw) handleLobbyEvent(JSON.parse(raw)); } catch {}
    }, 400);
    return () => { try { bc?.close(); } catch {}; clearInterval(poll); };
  }, [isBot, id, handleLobbyEvent]);

  // ── Sync oppLeft message ──────────────────────────────────────────────────
  useEffect(() => {
    if (isBot || !id || !gameState.oppLeft || oppLeftMsg) return;
    const opp = players.find(p => p.id !== "me" && p.id !== "local");
    setOppLeftMsg((opp?.name || "Opponent") + " left the game. You win!");
  }, [isBot, id, gameState.oppLeft, players, oppLeftMsg]);

  useEffect(() => {
    if (gameState.rematchFrom) setRematchFrom(gameState.rematchFrom);
  }, [gameState.rematchFrom]);

  useEffect(() => {
    if (gameState.rematchDeniedBy) {
      setRematchDeclinedBy(gameState.rematchDeniedBy);
      const t = setTimeout(() => setLocation("/matchmaking"), 4000);
      return () => clearTimeout(t);
    }
  }, [gameState.rematchDeniedBy, setLocation]);

  // ── Both ready → start in 1.5s ───────────────────────────────────────────
  useEffect(() => {
    if (lobbyPhase !== "both_ready" || bothReadyFired.current) return;
    bothReadyFired.current = true;
    const t = setTimeout(() => setLobbyPhase("playing"), 1500);
    return () => clearTimeout(t);
  }, [lobbyPhase]);

  // ── Sync game status → lobbyPhase ────────────────────────────────────────
  useEffect(() => {
    if (isBot || !id) return;
    if (gameState.status === "playing" && lobbyPhase !== "playing" &&
        !gameState.winner && gameState.board.every(c => c === null)) {
      inRematchFlow.current = true;
      bothReadyFired.current = true;
      setLobbyPhase("playing");
      setRematchSent(false);
      setRematchFrom(null);
    }
  }, [isBot, id, gameState.status, lobbyPhase, gameState.winner, gameState.board]);

  // ── When room transitions to "playing" mid-lobby ──────────────────────────
  useEffect(() => {
    if (isBot || !id || lobbyPhase === "playing" || inRematchFlow.current) return;
    const room = roomManager.getRoom(id);
    if (room?.status === "playing") { bothReadyFired.current = true; setLobbyPhase("playing"); }
  }, [isBot, id, lobbyPhase]);

  // ── Post-game: confetti + cleanup ─────────────────────────────────────────
  useEffect(() => {
    if (gameState.status !== "finished") return;
    const myIdx = players.findIndex(p => p.id === "me" || p.id === "local");
    const iWon = gameState.winner === "forfeit" || (
      !!gameState.winner && gameState.winner !== "draw" &&
      ((gameState.winner === "X" && myIdx === 0) || (gameState.winner === "O" && myIdx === 1))
    );
    if (iWon) {
      const dur = 3000, end = Date.now() + dur;
      const iv: any = setInterval(() => {
        const left = end - Date.now();
        if (left <= 0) return clearInterval(iv);
        confetti({ startVelocity:30, spread:360, ticks:60, zIndex:0,
          particleCount:50*(left/dur), origin:{x:Math.random()*0.5+0.25,y:Math.random()-0.2},
          colors:["#a855f7","#06b6d4","#fff"] });
      }, 250);
    }
    try { const r = sessionStorage.getItem("sessionStats"); if (r) setPostStats(JSON.parse(r)); } catch {}
    if (!isBot && id) roomManager.updateRoom(id, { status:"finished" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.status]);

  useEffect(() => { roomManager.cleanupOldRooms(); }, []);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/game/${id}`);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  }, [id]);

  const handleLeave = () => {
    notifyLeave();
    if (!isBot && id) roomManager.leaveRoom(id);
    setLocation("/matchmaking");
  };

  const handleRematchRequest = () => {
    if (isBot) { _doRematch(); return; }
    inRematchFlow.current = true;
    setRematchSent(true);
    _doRematch();
  };

  const handleRematchAccept = () => {
    setRematchFrom(null);
    setOppLeftMsg(null);
    setRematchDeclinedBy(null);
    if (id) roomManager.updateRoom(id, { status:"playing" });
    sendLobby({ type:"REMATCH_ACCEPTED", roomId:id! });
    sendGameEvent({ type:"REMATCH_ACC", roomId:id! });
    inRematchFlow.current = true;
    bothReadyFired.current = true;
    setLobbyPhase("playing");
    setGameState((prev: any) => ({
      ...prev, status:"playing", winner:null, winningLine:null,
      board:Array(9).fill(null), currentPlayerIndex:0,
      turnTimeLeft:30, rematchRequested:false, rematchFrom:null, oppLeft:false,
    }));
    _doAccept();
    setRematchSent(false);
  };

  const handleRematchDeny = () => {
    setRematchFrom(null);
    setRematchSent(false);
    _doDeny();
    setTimeout(() => setLocation("/matchmaking"), 100);
  };

  // ── Profile gate ──────────────────────────────────────────────────────────
  if (!hasProfile) {
    const save = () => {
      if (!tempName.trim()) return;
      sessionManager.setPlayerName(tempName.trim());
      sessionManager.setPlayerAvatar(tempAvatar);
      window.location.reload();
    };
    return (
      <div className="w-full max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <h2 className="text-3xl font-bold uppercase tracking-widest text-primary">Join Match</h2>
        <p className="text-muted-foreground font-mono text-center">
          Set your name to enter room <span className="text-foreground font-bold">{id}</span>
        </p>
        <div className="p-8 rounded-xl bg-card border border-border w-full flex flex-col items-center gap-6 shadow-xl">
          <Avatar className="w-32 h-32 border-4 border-primary cursor-pointer"
            onClick={() => setTempAvatar(Math.random().toString(36).substring(7))}>
            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${tempAvatar}`}/>
          </Avatar>
          <Button variant="outline" size="sm" onClick={() => setTempAvatar(Math.random().toString(36).substring(7))}>
            <RefreshCw className="w-4 h-4 mr-2"/>Randomize Avatar
          </Button>
          <div className="w-full space-y-2">
            <label className="text-sm font-bold uppercase text-muted-foreground">Your Name</label>
            <Input value={tempName} onChange={e => setTempName(e.target.value)}
              className="text-lg py-6 bg-background text-center font-bold"
              onKeyDown={e => e.key==="Enter" && save()}/>
          </div>
          <Button className="w-full py-6 text-lg font-bold uppercase tracking-widest" onClick={save}>Join Room</Button>
        </div>
      </div>
    );
  }

  // ── LOBBY: waiting for opponent ───────────────────────────────────────────
  if (!isBot && lobbyPhase === "waiting") {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-8 py-8">
        <div className="w-full flex justify-between items-center">
          <Button variant="ghost" size="icon" onClick={handleLeave}><ArrowLeft className="w-6 h-6"/></Button>
          <div className="text-center">
            <h2 className="text-xl font-bold uppercase tracking-widest text-primary">Game Lobby</h2>
            <p className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded mt-1">ID: {id}</p>
          </div>
          <div className="w-10"/>
        </div>
        <div className="w-full p-8 rounded-2xl bg-card border border-primary/30 flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse"/>
            <span className="font-mono text-secondary uppercase tracking-widest text-sm">
              {isCreator ? "Waiting for opponent..." : "Connected — waiting for host..."}
            </span>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="w-20 h-20 border-2 border-primary shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${hostInfo?.avatar || "host"}`}/>
                <AvatarFallback>X</AvatarFallback>
              </Avatar>
              <p className="font-bold uppercase tracking-wider">
                {hostInfo?.name || "Host"}
                {isCreator && <span className="ml-1 text-xs text-primary">(You)</span>}
              </p>
              <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded font-mono">X · Host</span>
            </div>
            <div className="text-3xl font-black text-muted-foreground/40">VS</div>
            <div className="flex flex-col items-center gap-3 opacity-50">
              <div className="w-20 h-20 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                {guestInfo
                  ? <Avatar className="w-20 h-20 border-2 border-secondary">
                      <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${guestInfo.avatar}`}/>
                    </Avatar>
                  : <Users className="w-8 h-8 text-muted-foreground"/>
                }
              </div>
              <p className="font-bold uppercase tracking-wider text-muted-foreground text-sm">
                {guestInfo ? guestInfo.name : (isCreator ? "Joining..." : myName)}
              </p>
              <span className="text-xs bg-muted/20 text-muted-foreground px-2 py-1 rounded font-mono">O · Guest</span>
            </div>
          </div>
          {isCreator && (
            <div className="w-full space-y-3">
              <p className="text-sm text-center text-muted-foreground font-mono">Share this link with your opponent:</p>
              <div className="flex gap-2">
                <Input readOnly value={`${window.location.origin}/game/${id}`} className="text-xs h-10 bg-background/80"/>
                <Button size="icon" className="h-10 w-10 shrink-0 bg-primary/20 hover:bg-primary/40 text-primary border border-primary/30" onClick={copyLink}>
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500"/> : <Copy className="w-4 h-4"/>}
                </Button>
              </div>
              <p className="text-xs text-center text-muted-foreground/60 font-mono">Room ID: <strong>{id}</strong></p>
              {copied && <p className="text-xs text-center text-green-400 font-mono">✓ Link copied! Send to opponent.</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── LOBBY: both ready ─────────────────────────────────────────────────────
  if (!isBot && lobbyPhase === "both_ready") {
    const h = hostInfo  || { name:"Host",  avatar:"x" };
    const g = guestInfo || { name:"Guest", avatar:"y" };
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-8 py-8">
        <div className="w-full flex justify-between items-center">
          <Button variant="ghost" size="icon" onClick={handleLeave}><ArrowLeft className="w-6 h-6"/></Button>
          <h2 className="text-xl font-bold uppercase tracking-widest text-primary">Game Lobby</h2>
          <div className="w-10"/>
        </div>
        <div className="w-full p-8 rounded-2xl bg-card border border-primary/30 flex flex-col items-center gap-6 shadow-[0_0_30px_rgba(168,85,247,0.2)]">
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-3">
              <Avatar className="w-20 h-20 border-2 border-primary shadow-[0_0_15px_rgba(168,85,247,0.5)]">
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${h.avatar}`}/>
                <AvatarFallback>X</AvatarFallback>
              </Avatar>
              <p className="font-bold uppercase tracking-wider">
                {h.name}{isCreator && <span className="ml-1 text-xs text-primary">(You)</span>}
              </p>
              <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded font-mono">X · Ready</span>
            </div>
            <div className="text-3xl font-black text-muted-foreground">VS</div>
            <div className="flex flex-col items-center gap-3">
              <Avatar className="w-20 h-20 border-2 border-secondary shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${g.avatar}`}/>
                <AvatarFallback>O</AvatarFallback>
              </Avatar>
              <p className="font-bold uppercase tracking-wider">
                {g.name}{!isCreator && <span className="ml-1 text-xs text-secondary">(You)</span>}
              </p>
              <span className="text-xs bg-secondary/20 text-secondary px-2 py-1 rounded font-mono">O · Ready</span>
            </div>
          </div>
          <p className="text-secondary font-mono text-sm animate-pulse">✓ Both players ready! Starting…</p>
        </div>
      </div>
    );
  }

  // ── GAME BOARD ────────────────────────────────────────────────────────────
  const getResultLabel = () => {
    if (oppLeftMsg || gameState.winner === "forfeit")
      return <span className="text-primary drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">VICTORY</span>;
    if (!gameState.winner) return null;
    if (gameState.winner === "draw") return <span className="text-muted-foreground">DRAW</span>;
    const myIdx = players.findIndex(p => p.id === "me" || p.id === "local");
    const iWon = (gameState.winner === "X" && myIdx === 0) || (gameState.winner === "O" && myIdx === 1);
    return iWon
      ? <span className="text-primary   drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">VICTORY</span>
      : <span className="text-destructive drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">DEFEAT</span>;
  };

  const mePlayer  = players.find(p => p.id === "me" || p.id === "local") || players[0];
  const oppPlayer = players.find(p => p.id !== "me" && p.id !== "local") || players[1];
  const xPlayer   = players.find(p => p.symbol === "X") || players[0];
  const oPlayer   = players.find(p => p.symbol === "O") || players[1];
  const isMyTurn  = gameState.status === "playing" &&
    players.findIndex(p => p.id === "me" || p.id === "local") === gameState.currentPlayerIndex;

  const renderCell = (idx: number) => {
    const val = gameState.board[idx];
    const isWin = gameState.winningLine?.includes(idx) ?? false;
    const cellPlayer = val === "X" ? players.find(p => p.symbol === "X")
      : val === "O" ? players.find(p => p.symbol === "O") : null;
    const myIdx = players.findIndex(p => p.id === "me" || p.id === "local");
    const canClick = gameState.status === "playing" && !val && myIdx === gameState.currentPlayerIndex;
    return (
      <button key={idx} onClick={() => canClick && makeMove(idx)} disabled={!canClick}
        className={`
          aspect-square rounded-xl flex items-center justify-center overflow-hidden
          transition-all duration-200 border-2
          ${!val&&canClick?"border-primary/40 bg-primary/5 hover:bg-primary/15 hover:border-primary cursor-pointer hover:scale-105":"cursor-default"}
          ${!val&&!canClick&&gameState.status==="playing"?"border-border/30 bg-card/20":""}
          ${val&&!isWin?"border-border/40 bg-card/40":""}
          ${isWin&&val==="X"?"border-primary bg-primary/25 shadow-[0_0_20px_rgba(168,85,247,0.5)] scale-105":""}
          ${isWin&&val==="O"?"border-secondary bg-secondary/25 shadow-[0_0_20px_rgba(6,182,212,0.5)] scale-105":""}
        `}>
        <AnimatePresence>
          {val && cellPlayer && (
            <motion.div initial={{scale:0,opacity:0,rotate:-20}} animate={{scale:1,opacity:1,rotate:0}}
              transition={{type:"spring",bounce:0.5}} className="w-3/4 h-3/4">
              <Avatar className="w-full h-full shadow-lg">
                <AvatarImage src={`https://api.dicebear.com/7.x/${cellPlayer.id==="bot"?"bottts":"avataaars"}/svg?seed=${cellPlayer.avatar}`}/>
                <AvatarFallback className="text-2xl font-black">{val}</AvatarFallback>
              </Avatar>
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-6 py-2">
      <div className="w-full flex justify-between items-center">
        <Button variant="ghost" size="icon" onClick={handleLeave}><ArrowLeft className="w-6 h-6"/></Button>
        <div className="text-center">
          <h2 className="text-xl font-bold uppercase tracking-widest text-primary">
            {isBot ? "Practice Arena" : "Ranked Match"}
          </h2>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">ID: {id}</span>
            {!isBot && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyLink}>
                {copied ? <CheckCircle className="w-3 h-3 text-green-400"/> : <Copy className="w-3 h-3"/>}
              </Button>
            )}
          </div>
        </div>
        <div className="w-10"/>
      </div>

      <AnimatePresence>
        {oppLeftMsg && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}
            className="w-full max-w-lg flex items-center gap-3 bg-destructive/15 border border-destructive/40 rounded-xl px-5 py-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0"/>
            <p className="font-bold text-destructive text-sm uppercase tracking-wider">{oppLeftMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rematchDeclinedBy && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0}}
            className="w-full max-w-lg flex items-center gap-3 bg-muted/20 border border-border rounded-xl px-5 py-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0"/>
            <p className="font-bold text-muted-foreground text-sm uppercase tracking-wider">
              {rematchDeclinedBy} declined the rematch
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rematchFrom && !rematchSent && (
          <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}}
            className="w-full max-w-sm bg-card border-2 border-primary/50 rounded-2xl p-6 flex flex-col items-center gap-4 shadow-[0_0_30px_rgba(168,85,247,0.2)]">
            <p className="text-base font-bold text-center">
              <span className="text-primary">{rematchFrom}</span> wants a rematch!
            </p>
            <div className="flex gap-3 w-full">
              <Button className="flex-1 bg-primary text-primary-foreground font-bold uppercase" onClick={handleRematchAccept}>✓ Accept</Button>
              <Button variant="outline" className="flex-1 font-bold uppercase hover:bg-destructive/10 hover:border-destructive" onClick={handleRematchDeny}>✗ Decline</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rematchSent && !rematchFrom && gameState.status === "finished" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}}
            className="w-full max-w-sm bg-card border border-border/50 rounded-xl px-5 py-3 text-center">
            <p className="text-sm font-mono text-muted-foreground animate-pulse">
              Waiting for {oppPlayer.name} to respond…
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Players row */}
      <div className="w-full flex justify-between items-center px-2 md:px-8">
        <div className={`flex flex-col items-center gap-2 transition-all duration-300 ${gameState.currentPlayerIndex===0&&gameState.status==="playing"?"scale-110 opacity-100":"opacity-60"}`}>
          <div className="relative">
            <Avatar className={`w-16 h-16 md:w-20 md:h-20 border-2 transition-all ${gameState.currentPlayerIndex===0?"border-primary shadow-[0_0_15px_rgba(168,85,247,0.5)]":"border-border"}`}>
              <AvatarImage src={`https://api.dicebear.com/7.x/${xPlayer.id==="bot"?"bottts":"avataaars"}/svg?seed=${xPlayer.avatar}`}/>
              <AvatarFallback>X</AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-2 -right-2 bg-background border-2 border-primary text-primary font-black w-8 h-8 flex items-center justify-center rounded-full shadow-lg text-sm">X</span>
          </div>
          <p className="font-bold uppercase tracking-wide text-sm">
            {xPlayer.name}{xPlayer.symbol === mePlayer.symbol && <span className="ml-1 text-xs text-primary">(You)</span>}
          </p>
          {gameState.currentPlayerIndex===0&&gameState.status==="playing"&&(
            <span className="text-xs font-mono animate-pulse text-primary">{myIndexRef.current===0?"YOUR TURN":"THEIR TURN"}</span>
          )}
        </div>

        <div className="flex flex-col items-center gap-1 min-w-[100px]">
          {gameState.status === "playing" && (
            <div className={`flex items-center gap-2 text-3xl font-mono font-bold ${gameState.turnTimeLeft<=10?"text-destructive animate-pulse":"text-foreground"}`}>
              <Clock className="w-5 h-5"/>{gameState.turnTimeLeft}s
            </div>
          )}
          {gameState.status === "playing" && (
            <p className="text-xs font-mono text-muted-foreground">{isMyTurn?"YOUR MOVE":"Waiting..."}</p>
          )}
          {gameState.status === "finished" && (
            <div className="text-center font-bold uppercase tracking-widest text-2xl">{getResultLabel()}</div>
          )}
        </div>

        <div className={`flex flex-col items-center gap-2 transition-all duration-300 ${gameState.currentPlayerIndex===1&&gameState.status==="playing"?"scale-110 opacity-100":"opacity-60"}`}>
          <div className="relative">
            <Avatar className={`w-16 h-16 md:w-20 md:h-20 border-2 transition-all ${gameState.currentPlayerIndex===1?"border-secondary shadow-[0_0_15px_rgba(6,182,212,0.5)]":"border-border"}`}>
              <AvatarImage src={`https://api.dicebear.com/7.x/${oPlayer.id==="bot"?"bottts":"avataaars"}/svg?seed=${oPlayer.avatar}`}/>
              <AvatarFallback>O</AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-2 -left-2 bg-background border-2 border-secondary text-secondary font-black w-8 h-8 flex items-center justify-center rounded-full shadow-lg text-sm">O</span>
          </div>
          <p className="font-bold uppercase tracking-wide text-sm">
            {oPlayer.name}{oPlayer.symbol === mePlayer.symbol && <span className="ml-1 text-xs text-secondary">(You)</span>}
          </p>
          {gameState.currentPlayerIndex===1&&gameState.status==="playing"&&(
            <span className="text-xs font-mono animate-pulse text-secondary">{isBot?"THINKING…":myIndexRef.current===1?"YOUR TURN":"THEIR TURN"}</span>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="p-3 md:p-5 bg-card/60 backdrop-blur-sm rounded-2xl border-2 border-primary/30 shadow-[0_0_40px_rgba(168,85,247,0.15)] mt-2">
        <div className="grid grid-cols-3 gap-3 md:gap-4 w-[280px] h-[280px] md:w-[420px] md:h-[420px]">
          {Array(9).fill(null).map((_,i) => renderCell(i))}
        </div>
      </div>

      {/* Post-game */}
      <AnimatePresence>
        {gameState.status === "finished" && (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
            className="flex flex-col items-center gap-4 w-full max-w-sm">
            {postStats && (
              <div className="flex gap-8 justify-center bg-card/60 border border-border/50 rounded-xl px-8 py-4 w-full">
                <div className="text-center"><p className="text-primary font-black text-2xl">{postStats.wins}</p><p className="text-xs text-muted-foreground uppercase font-mono">Wins</p></div>
                <div className="text-center"><p className="text-destructive font-black text-2xl">{postStats.losses}</p><p className="text-xs text-muted-foreground uppercase font-mono">Losses</p></div>
                <div className="text-center"><p className="text-secondary font-black text-2xl">{postStats.rating}</p><p className="text-xs text-muted-foreground uppercase font-mono">Rating</p></div>
              </div>
            )}
            <div className="flex gap-3 w-full">
              {!rematchSent && !rematchFrom && (
                <Button size="lg" onClick={handleRematchRequest}
                  className="flex-1 bg-primary text-primary-foreground font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                  {isBot ? "Rematch" : "Request Rematch"}
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={handleLeave} className="flex-1 font-bold uppercase tracking-widest">
                Leave Room
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}