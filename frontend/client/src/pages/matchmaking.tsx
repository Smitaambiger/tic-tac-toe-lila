import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Wifi, Users, ArrowLeft, Copy, CheckCircle, Link } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sessionManager } from "@/lib/session-manager";
import { roomManager, type Room } from "@/lib/room-manager";

function getRankLabel(rating: number) {
  if (rating >= 2000) return "Diamond";
  if (rating >= 1500) return "Platinum";
  if (rating >= 1200) return "Gold";
  if (rating >= 1000) return "Silver";
  return "Bronze III";
}

export default function Matchmaking() {
  const [, setLocation] = useLocation();

  const [isSearching, setIsSearching] = useState(false);
  const [searchTime,  setSearchTime]  = useState(0);
  const searchRef = useRef(false);

  const [allRooms,      setAllRooms]      = useState<Room[]>([]);
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);
  const [joinId,        setJoinId]        = useState("");

  const playerName   = sessionManager.getPlayerName()   || "Player";
  const playerAvatar = sessionManager.getPlayerAvatar() || "default";

  // Read stats from sessionStorage (current session) not localStorage
  const [stats, setStats] = useState({ wins: 0, losses: 0, rating: 1000 });
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sessionStats");
      if (raw) setStats(JSON.parse(raw));
    } catch {}
  }, []);

  // ── Load & subscribe to all rooms (including own) ─────────────────────────
  useEffect(() => {
    if (!sessionManager.hasProfile()) { setLocation("/"); return; }
    setAllRooms(roomManager.getRooms());
    const unsub = roomManager.subscribe(rooms => setAllRooms([...rooms]));
    return unsub;
  }, [setLocation]);

  // Rooms visible in the Open Rooms panel = waiting rooms NOT created by me
  const joinableRooms = allRooms.filter(r =>
    r.status === "waiting" &&
    r.players < r.maxPlayers &&
    r.creatorFingerprint !== sessionManager.getFingerprint()
  );

  // ── Quick Match ────────────────────────────────────────────────────────────
  // Behavior:
  //   1. Check for any joinable open room → join & navigate immediately
  //   2. If none, create a room and enter lobby (waiting for someone to join)
  const handleQuickMatch = () => {
    if (isSearching) { setIsSearching(false); return; }

    // Instant: is there already an open room to join?
    const available = roomManager.getJoinableRooms();
    if (available.length > 0) {
      const target = available[0];
      roomManager.joinRoom(target.id);
      setLocation(`/game/${target.id}`);
      return;
    }

    // None found: create our own room and go to lobby
    const room = roomManager.createRoom();
    setLocation(`/game/${room.id}`);
  };

  // Keep searching for 5 s then auto-create (fallback, triggered if isSearching=true)
  useEffect(() => {
    searchRef.current = isSearching;
    if (!isSearching) { setSearchTime(0); return; }

    const iv = setInterval(() => {
      if (!searchRef.current) return;
      setSearchTime(t => {
        const next = t + 1;
        const available = roomManager.getJoinableRooms();
        if (available.length > 0) {
          clearInterval(iv);
          setIsSearching(false);
          const target = available[0];
          roomManager.joinRoom(target.id);
          setLocation(`/game/${target.id}`);
          return 0;
        }
        if (next >= 5) {
          clearInterval(iv);
          setIsSearching(false);
          // Auto-create room and go to lobby
          const room = roomManager.createRoom();
          setLocation(`/game/${room.id}`);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [isSearching, setLocation]);

  // ── Create Custom Room ─────────────────────────────────────────────────────
  const handleCreateRoom = () => {
    const room = roomManager.createRoom();
    setCreatedRoomId(room.id);
  };

  const copyLink = () => {
    if (!createdRoomId) return;
    navigator.clipboard.writeText(`${window.location.origin}/game/${createdRoomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ── Join by ID / Link ──────────────────────────────────────────────────────
  const handleJoinById = () => {
    const raw = joinId.trim();
    if (!raw) return;
    let matchId = raw;
    const m = raw.match(/\/game\/(.+)$/);
    if (m) matchId = m[1];

    // Join if it's still waiting; navigate regardless (game-room handles edge cases)
    const room = roomManager.getRoom(matchId);
    if (room && room.status === "waiting" && room.players < room.maxPlayers &&
        room.creatorFingerprint !== sessionManager.getFingerprint()) {
      roomManager.joinRoom(matchId);
    }
    setLocation(`/game/${matchId}`);
  };

  const handleJoinRoom = (roomId: string) => {
    const room = roomManager.getRoom(roomId);
    if (room && room.status === "waiting" && room.players < room.maxPlayers) {
      roomManager.joinRoom(roomId);
    }
    setLocation(`/game/${roomId}`);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}><ArrowLeft className="w-6 h-6"/></Button>
        <h2 className="text-3xl font-bold uppercase tracking-widest text-primary">Matchmaking</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* ── Left: Profile + Actions ──────────────────────────────────────── */}
        <div className="col-span-1 space-y-6">

          {/* Profile card */}
          <div className="p-6 rounded-xl bg-card border border-border/50 flex flex-col items-center text-center gap-4 relative">
            <Button variant="ghost" size="sm"
              className="absolute top-2 right-2 text-xs text-muted-foreground"
              onClick={() => { sessionManager.clearProfile(); setLocation("/"); }}>
              Edit
            </Button>
            <Avatar className="w-24 h-24 border-2 border-primary ring-2 ring-primary/20">
              <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${playerAvatar}`}/>
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-xl font-bold uppercase tracking-wider">{playerName}</h3>
              <p className="text-sm text-secondary font-mono">Rank: {getRankLabel(stats.rating)}</p>
              <p className="text-xs text-muted-foreground font-mono mt-1">Wins: {stats.wins} | Losses: {stats.losses}</p>
            </div>
          </div>

          <div className="space-y-4">

            {/* Quick Match */}
            <div className="space-y-1">
              <Button
                className={`w-full py-8 text-lg font-bold uppercase tracking-wider transition-all duration-300 ${
                  isSearching
                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
                onClick={handleQuickMatch}
              >
                {isSearching ? (
                  <span className="flex items-center gap-2">
                    <Wifi className="w-5 h-5 animate-pulse"/>Searching... {searchTime}s
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Search className="w-5 h-5"/>Quick Match
                  </span>
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground font-mono">
                Finds an open room instantly, or creates one if none found.
              </p>
            </div>

            {/* Create Custom Room */}
            {!createdRoomId ? (
              <Button variant="outline"
                className="w-full py-6 font-mono gap-2 border-primary/30 hover:border-primary/60 hover:bg-primary/5"
                onClick={handleCreateRoom}>
                <Plus className="w-4 h-4"/>Create Custom Room
              </Button>
            ) : (
              <div className="p-4 border border-primary bg-primary/5 rounded-xl space-y-3 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
                <p className="text-sm font-bold text-center text-primary uppercase tracking-wider">🎮 Room Created!</p>
                <p className="text-xs text-center text-muted-foreground font-mono">Share this link with a friend:</p>
                <div className="flex gap-2">
                  <Input readOnly value={`${window.location.origin}/game/${createdRoomId}`}
                    className="text-xs h-9 bg-background/80"/>
                  <Button size="icon" className="h-9 w-9 shrink-0 bg-primary/20 hover:bg-primary/40 text-primary border border-primary/30"
                    onClick={copyLink}>
                    {copied ? <CheckCircle className="w-4 h-4 text-green-500"/> : <Copy className="w-4 h-4"/>}
                  </Button>
                </div>
                {copied && <p className="text-xs text-center text-green-400 font-mono">Link copied!</p>}
                <Button className="w-full h-10 font-bold tracking-widest uppercase"
                  onClick={() => setLocation(`/game/${createdRoomId}`)}>
                  Enter Lobby
                </Button>
              </div>
            )}

            {/* Join by ID / Link */}
            <div className="pt-4 border-t border-border/50 space-y-2">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Join by ID / Link</p>
              <div className="flex gap-2">
                <Input placeholder="Paste match link or room ID"
                  value={joinId} onChange={e => setJoinId(e.target.value)}
                  className="bg-background text-sm"
                  onKeyDown={e => e.key==="Enter"&&handleJoinById()}/>
                <Button variant="secondary" onClick={handleJoinById} disabled={!joinId.trim()}>
                  <Link className="w-4 h-4"/>
                </Button>
              </div>
            </div>

          </div>
        </div>

        {/* ── Right: Open Rooms ────────────────────────────────────────────── */}
        <div className="col-span-1 md:col-span-2 flex flex-col gap-4">
          <div className="flex justify-between items-center pb-2 border-b border-border/50">
            <h3 className="text-xl font-bold uppercase tracking-wider flex items-center gap-2">
              <Wifi className="w-5 h-5 text-secondary"/>Open Rooms
            </h3>
            <span className="text-xs font-mono text-muted-foreground">
              {joinableRooms.length} room{joinableRooms.length!==1?"s":""} waiting for players
            </span>
          </div>

          <div className="space-y-3 overflow-y-auto pr-1 max-h-[500px]">
            <AnimatePresence>
              {joinableRooms.length === 0 ? (
                <motion.div key="empty" initial={{opacity:0}} animate={{opacity:1}}
                  className="text-center py-12 flex flex-col items-center text-muted-foreground border border-dashed border-border/50 rounded-lg bg-card/20">
                  <Wifi className="w-12 h-12 mb-4 opacity-20"/>
                  <p className="font-bold uppercase tracking-widest text-lg opacity-60">No Open Rooms</p>
                  <p className="text-sm mt-2 max-w-[260px]">
                    Use Quick Match or Create a Custom Room, then share the link.
                  </p>
                </motion.div>
              ) : joinableRooms.map((room, i) => (
                <motion.div key={room.id}
                  initial={{opacity:0,x:20}} animate={{opacity:1,x:0}}
                  exit={{opacity:0,x:-20}} transition={{delay:i*0.05}}
                  className="p-4 rounded-lg border border-secondary/50 bg-card/50 flex justify-between items-center
                    hover:border-secondary cursor-pointer
                    hover:shadow-[inset_0_0_20px_rgba(6,182,212,0.12)] transition-all"
                  onClick={() => handleJoinRoom(room.id)}>
                  <div>
                    <h4 className="font-bold uppercase tracking-wider">{room.name}</h4>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">ID: {room.id}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-sm font-mono text-secondary">
                      <Users className="w-4 h-4"/>
                      <span>{room.players}/{room.maxPlayers}</span>
                    </div>
                    <Button size="sm" variant="secondary" className="font-bold uppercase tracking-wider">
                      Join
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </div>
  );
}