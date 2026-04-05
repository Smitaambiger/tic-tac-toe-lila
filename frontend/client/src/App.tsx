import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Matchmaking from "@/pages/matchmaking";
import GameRoom from "@/pages/game-room";
import Leaderboard from "@/pages/leaderboard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/matchmaking" component={Matchmaking} />
      <Route path="/game/:id" component={GameRoom} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
          <header className="w-full max-w-4xl p-6 flex justify-between items-center z-10">
            <a href="/" className="text-3xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary tracking-widest uppercase">
              TIC-TAC-TOE
            </a>
            <nav className="flex gap-4">
              <a href="/matchmaking" className="text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider font-semibold text-sm">Play</a>
              <a href="/leaderboard" className="text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider font-semibold text-sm">Leaderboard</a>
            </nav>
          </header>
          
          <main className="flex-1 w-full max-w-4xl flex flex-col justify-center p-4 z-10">
            <Router />
          </main>
          
          <footer className="w-full max-w-4xl p-6 text-center text-muted-foreground text-sm z-10">
            <p className="font-mono opacity-50">&copy; 2026 LILA Engineering - Tic-Tac-Toe Assignment.</p>
          </footer>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;