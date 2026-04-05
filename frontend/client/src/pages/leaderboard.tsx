import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Trophy, Medal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sessionManager } from "@/lib/session-manager";

type Entry = {
  rank: number;
  name: string;
  avatar: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  isMe?: boolean;
};

function getRankLabel(r: number) {
  if (r >= 2000) return "Diamond";
  if (r >= 1500) return "Platinum";
  if (r >= 1200) return "Gold";
  if (r >= 1000) return "Silver";
  return "Bronze";
}

export default function Leaderboard() {
  const [, setLocation] = useLocation();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const myName = sessionManager.getPlayerName() || "";

  useEffect(() => {
    // Read from localStorage (source of truth for local player's stats)
    // Leaderboard reflects stats from the current browser session
    try {
      const raw = localStorage.getItem("leaderboard");
      const lb: any[] = raw ? JSON.parse(raw) : [];
      lb.sort((a, b) => (b.rating || 1000) - (a.rating || 1000));
      setEntries(lb.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        avatar: e.avatar || "x",
        rating: e.rating || 1000,
        wins:   e.wins   || 0,
        losses: e.losses || 0,
        draws:  e.draws  || 0,
        isMe:   e.name === myName,
      })));
    } catch {}
    setLoading(false);
  }, [myName]);

  const rankColors = ["text-yellow-400", "text-gray-300", "text-amber-600"];

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <h2 className="text-3xl font-bold uppercase tracking-widest text-accent">Leaderboard</h2>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground font-mono animate-pulse">
          Loading rankings…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center text-muted-foreground border border-dashed border-border/50 rounded-lg bg-card/20">
          <Trophy className="w-16 h-16 mb-4 opacity-20" />
          <p className="font-bold uppercase tracking-widest text-lg opacity-60">No Rankings Yet</p>
          <p className="text-sm mt-2 max-w-[300px]">Play ranked matches to appear on the leaderboard!</p>
        </div>
      ) : (
        <>
          {/* Podium */}
          {entries.length >= 2 && (
            <div className="flex justify-center items-end gap-4 mb-2">
              {[entries[1], entries[0], entries[2]].map((p, pi) => {
                if (!p) return <div key={pi} className="w-24"/>;
                const heights = ["h-24","h-32","h-20"];
                return (
                  <div key={p.rank} className="flex flex-col items-center gap-2">
                    <Avatar className={`border-2 ${p.isMe?"border-primary":"border-border"} ${pi===1?"w-16 h-16":"w-12 h-12"}`}>
                      <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.avatar}`}/>
                      <AvatarFallback>{p.name[0]}</AvatarFallback>
                    </Avatar>
                    <p className="text-xs font-bold uppercase truncate max-w-[80px] text-center">{p.name}</p>
                    <div className={`${heights[pi]} w-20 flex flex-col items-center justify-center rounded-t-lg ${pi===1?"bg-yellow-500/20 border border-yellow-500/40":"bg-card border border-border"}`}>
                      <Medal className={`w-5 h-5 ${rankColors[p.rank-1]||"text-muted-foreground"}`}/>
                      <span className={`text-lg font-black ${rankColors[p.rank-1]||"text-muted-foreground"}`}>#{p.rank}</span>
                      <span className="text-xs font-mono text-muted-foreground">{p.rating}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Table */}
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 p-4 border-b border-border/50 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-4">Player</div>
              <div className="col-span-2 text-right">Rating</div>
              <div className="col-span-2 text-right">Rank</div>
              <div className="col-span-1 text-right text-primary">W</div>
              <div className="col-span-1 text-right text-muted-foreground">D</div>
              <div className="col-span-1 text-right text-destructive">L</div>
            </div>
            {entries.map(p => (
              <div key={p.rank}
                className={`grid grid-cols-12 gap-2 p-4 items-center border-b border-border/30 last:border-0 hover:bg-white/5 transition-colors
                  ${p.isMe?"bg-primary/10 border-l-2 border-l-primary":""}`}>
                <div className={`col-span-1 text-center font-mono font-bold ${rankColors[p.rank-1]||"text-muted-foreground"}`}>
                  {p.rank}
                </div>
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <Avatar className="w-8 h-8 border border-border shrink-0">
                    <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${p.avatar}`}/>
                    <AvatarFallback>{p.name[0]}</AvatarFallback>
                  </Avatar>
                  <span className={`font-bold truncate text-sm ${p.isMe?"text-primary":""}`}>
                    {p.name}{p.isMe&&<span className="ml-1 text-xs font-normal text-muted-foreground">(You)</span>}
                  </span>
                </div>
                <div className="col-span-2 text-right font-mono text-sm">{p.rating}</div>
                <div className="col-span-2 text-right font-mono text-xs text-secondary">{getRankLabel(p.rating)}</div>
                <div className="col-span-1 text-right font-mono text-primary/80">{p.wins}</div>
                <div className="col-span-1 text-right font-mono text-muted-foreground">{p.draws}</div>
                <div className="col-span-1 text-right font-mono text-destructive/80">{p.losses}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}