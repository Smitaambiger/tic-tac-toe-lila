import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Gamepad2, Users, Trophy, RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sessionManager } from "@/lib/session-manager";

export default function Home() {
  const [, setLocation] = useLocation();
  const [hasProfile, setHasProfile] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempAvatar, setTempAvatar] = useState(sessionManager.generateAvatarSeed());

  useEffect(() => {
    const savedName = sessionManager.getPlayerName();
    if (savedName) {
      setHasProfile(true);
    } else {
      setTempName("Guest_" + Math.floor(Math.random() * 1000));
    }
  }, []);

  const saveProfile = () => {
    if (!tempName.trim()) return;
    sessionManager.setPlayerName(tempName.trim());
    sessionManager.setPlayerAvatar(tempAvatar);
    setHasProfile(true);
  };

  if (!hasProfile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <h1 className="text-4xl md:text-6xl font-black uppercase text-transparent bg-clip-text bg-gradient-to-br from-primary via-white to-secondary tracking-widest mb-2">
            WELCOME TO <br/> TIC-TAC-TOE
          </h1>
          <p className="text-muted-foreground font-mono">Create your profile to start playing.</p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="w-full max-w-md p-8 rounded-xl bg-card border border-border flex flex-col items-center gap-6 shadow-xl"
        >
          <div className="relative group cursor-pointer" onClick={() => setTempAvatar(Math.random().toString(36).substring(7))}>
            <Avatar className="w-32 h-32 border-4 border-primary shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-transform group-hover:scale-105">
              <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${tempAvatar}`} />
            </Avatar>
            <div className="absolute -bottom-2 -right-2 bg-background border border-primary p-2 rounded-full shadow-lg group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <RefreshCw className="w-5 h-5" />
            </div>
          </div>
          
          <div className="w-full space-y-2 mt-4">
            <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground ml-1">Player Name</label>
            <Input 
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              className="text-lg py-6 bg-background/50 border-primary/30 focus-visible:border-primary text-center font-bold tracking-wider"
              placeholder="Enter your name"
              onKeyDown={(e) => e.key === 'Enter' && saveProfile()}
            />
          </div>
          
          <Button 
            className="w-full py-6 text-lg font-bold uppercase tracking-widest mt-2 hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-shadow" 
            onClick={saveProfile}
            disabled={!tempName.trim()}
          >
            Enter Arena
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-12">
      <div className="absolute top-6 right-6 flex items-center gap-3">
        <span className="font-bold font-mono text-sm">{sessionManager.getPlayerName()}</span>
        <Avatar className="w-10 h-10 border border-primary cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setHasProfile(false)} title="Edit Profile">
          <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${sessionManager.getPlayerAvatar()}`} />
        </Avatar>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center space-y-4"
      >
        <h1 className="text-6xl md:text-8xl font-black uppercase text-transparent bg-clip-text bg-gradient-to-br from-primary via-white to-secondary tracking-[0.2em] mb-4">
          TIC-TAC-TOE
        </h1>
        <p className="text-xl text-muted-foreground font-mono max-w-md mx-auto">
          Multiplayer arena. Master the grid. Defeat your opponents.
        </p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl"
      >
        <Button 
          variant="outline" 
          className="h-32 flex flex-col gap-3 bg-card/50 backdrop-blur-sm border-primary/30 hover:border-primary hover:bg-primary/10 transition-all duration-300 group shadow-[0_0_15px_rgba(168,85,247,0.0)] hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]"
          onClick={() => {
            if (!sessionManager.hasProfile()) {
               setHasProfile(false);
            } else {
               setLocation("/game/bot");
            }
          }}
        >
          <Gamepad2 className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
          <span className="text-lg font-bold tracking-widest uppercase">Play vs Bot</span>
          <span className="text-xs text-muted-foreground font-mono">Practice Mode</span>
        </Button>

        <Button 
          variant="outline"
          className="h-32 flex flex-col gap-3 bg-card/50 backdrop-blur-sm border-secondary/30 hover:border-secondary hover:bg-secondary/10 transition-all duration-300 group shadow-[0_0_15px_rgba(6,182,212,0.0)] hover:shadow-[0_0_15px_rgba(6,182,212,0.2)]"
          onClick={() => setLocation("/matchmaking")}
        >
          <Users className="w-8 h-8 text-secondary group-hover:scale-110 transition-transform" />
          <span className="text-lg font-bold tracking-widest uppercase">Find Match</span>
          <span className="text-xs text-muted-foreground font-mono">Multiplayer Arena</span>
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <Button 
          variant="ghost" 
          className="text-muted-foreground hover:text-accent font-mono gap-2"
          onClick={() => setLocation("/leaderboard")}
        >
          <Trophy className="w-4 h-4" />
          View Global Rankings
        </Button>
      </motion.div>
    </div>
  );
}