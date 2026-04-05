# Multiplayer Tic-Tac-Toe — LILA Engineering Assignment

Built with **Nakama** game backend and **React + TypeScript** frontend.

---

## Live Links

| | URL |
|---|---|
| **Frontend** | https://loquacious-llama-d33815.netlify.app/ |
| **Nakama Server** | https://tic-tac-toe-lila.onrender.com |
| **GitHub** | https://github.com/Smitaambiger/tic-tac-toe-lila |

---

## What Is Built

### Core Requirements
- **Server-Authoritative Game Logic** — All game state lives in `backend/main.js` running inside Nakama. Clients send move intents. The server validates, updates state, and broadcasts to both players. Clients cannot manipulate the board.
- **Move Validation** — Server rejects moves on occupied cells, out-of-range indexes, and moves on the wrong player's turn.
- **Real-time Broadcast** — After every valid move, Nakama's `dispatcher.broadcastMessage` sends updated state to all match participants via WebSocket.
- **Room Creation** — Players create public rooms via `create_public_room` RPC.
- **Matchmaking** — Quick Match scans open rooms and joins instantly, or creates a new room and waits.
- **Join by Link** — Every room has a shareable URL. Opening the link puts you directly in that room's lobby.
- **Disconnect Handling** — Nakama's `matchLeave` hook detects when a player drops. The remaining player is awarded the win automatically.
- **Responsive UI** — Works on mobile browsers with touch-friendly tap targets.

### Bonus Features (All Implemented)
- **30-Second Turn Timer** — Nakama broadcasts a TICK every second. At 0, the server forfeits the inactive player. Client cannot skip or manipulate the timer.
- **Leaderboard** — Win = +25 rating, Loss = −20, Draw = +5. Stored in Nakama storage.
- **Rematch System** — Either player can request a rematch. Both must accept.
- **Concurrent Games** — Each match is an isolated Nakama match object. Many games run simultaneously with no interference.
- **Bot Mode** — Practice against a local AI (50% minimax, 50% random). No server required.

---

## Project Structure

```
tic-tac-toe/
├── README.md
├── backend/
│   └── main.js              ← All server-side game logic (Nakama JS runtime)
└── frontend/
    └── client/
        └── src/
            ├── pages/
            │   ├── home.tsx
            │   ├── matchmaking.tsx
            │   ├── game-room.tsx
            │   └── leaderboard.tsx
            ├── lib/
            │   ├── nakama-client.ts    ← Nakama HTTP + WebSocket client
            │   ├── room-manager.ts     ← Room state management
            │   └── session-manager.ts  ← Player profile per session
            └── hooks/
                ├── use-nakama-match.ts ← Nakama WebSocket game hook
                └── use-mock-match.ts   ← Bot + local multiplayer hook
```

---

## Architecture

**Backend (Nakama):**
Nakama runs `main.js` inside its Go runtime using the authoritative match system. When a player joins via WebSocket, the server sends `GAME_START` with board state and player symbols. Every move goes through the server — client sends `{ type: "MOVE", index: N }`, server validates, updates the board, checks win conditions, and broadcasts new state. The turn timer runs server-side and cannot be bypassed by the client.

**Frontend (React):**
Connects to Nakama via HTTP for authentication and RPC calls, and via WebSocket for real-time match events. `use-nakama-match.ts` handles all WebSocket message parsing and game state.

**Room Discovery:**
Room list discovery uses `localStorage` and `BroadcastChannel`, which are browser-local APIs. The Open Rooms panel updates automatically within the same browser. Players on different browsers join by pasting the room URL directly — the actual gameplay goes through Nakama WebSocket and works correctly across any device once both players are in the same match.

---

## Setup — Run Locally

### Requirements
- Node.js 18+
- Docker Desktop

### 1. Start Nakama

```bash
docker run -d --name nakama -p 7350:7350 -p 7351:7351 heroiclabs/nakama:3.22.0
docker cp backend/main.js nakama:/nakama/data/modules/main.js
docker restart nakama
```
#### Backend (local with Docker)
```bash
docker-compose up  # starts Nakama + PostgreSQL
```

### 2. Start Frontend

```bash
cd frontend/client
npm install
```

Create `.env`:
```
VITE_NAKAMA_HOST=localhost
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_KEY=defaultkey
```

```bash
npm run dev
# http://localhost:5173
```

---

## Deployment

### Backend — Render

1. Web Service on [render.com](https://render.com), Docker image: `heroiclabs/nakama:3.22.0`
2. Uploaded `main.js` to `/nakama/data/modules/` via Render shell
3. Nakama serves on port 7350 with SSL

**Endpoint:** `https://tic-tac-toe-8a0o.onrender.com`

> Render free tier sleeps after inactivity. First request may take 30–60 seconds.

### Frontend — Netlify

```bash
cd frontend/client
npm run build
# Output: frontend/client/dist/
```

Drag `dist/` to [netlify.com/drop](https://app.netlify.com/drop).

Environment variables in Netlify dashboard:
```
VITE_NAKAMA_HOST = tic-tac-toe-8a0o.onrender.com
VITE_NAKAMA_PORT = 443
VITE_NAKAMA_KEY  = defaultkey
```

`netlify.toml`:
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## Nakama API Reference

### RPC Endpoints

| RPC | Description |
|---|---|
| `create_public_room` | Creates a public match, returns `{ matchId }` |
| `create_private_room` | Creates an invite-only match |
| `list_open_rooms` | Returns all matches with 1 player waiting |
| `get_leaderboard` | Returns top 20 scores |

### WebSocket Op Codes (Server → Client)

| Op Code | Events |
|---|---|
| 1 | `GAME_START`, `MOVE`, `GAME_OVER`, `WAITING` |
| 2 | `ERROR` (invalid move, wrong turn) |
| 3 | `PLAYER_LEFT`, `REMATCH_REQUESTED`, `REMATCH_DENIED` |
| 4 | `TICK` (timer update every second) |

### Client → Server Messages (Op Code 3)

```json
{ "type": "MOVE", "index": 4 }
{ "type": "SET_META", "name": "PlayerName", "avatar": "seed" }
{ "type": "REMATCH_REQUEST" }
{ "type": "REMATCH_DENY" }
```

---

## How to Test Multiplayer

> **Important:** Multiplayer room discovery works within the same browser (same-origin localStorage). Once inside a game room, gameplay runs over Nakama WebSocket which is fully server-authoritative.

### Method 1 — Quick Match (Same Browser, Two Tabs)
1. Open the game in Tab 1 → create profile → Matchmaking → click **Quick Match**
2. Quick Match searches for an open room; if none found it creates one automatically
3. Copy the room URL shown
4. Open Tab 2 in the **same browser** → paste the URL in **Join by ID** or click the room in **Open Rooms**
5. Both tabs enter the match — game starts

### Method 2 — Create Custom Room (Same Browser, Two Tabs)
1. Open the game in Tab 1 → create profile → Matchmaking → **Create Custom Room**
2. Copy the room link shown
3. Open Tab 2 in the **same browser** → paste the link in **Join by ID** or join via the Open Rooms list
4. Both tabs are in the same match — play normally

### Method 3 — Bot Practice
- Home → **Play vs Bot** — works offline, no server needed

### Known Limitation
❌ Nakama on Render free tier may have a 30-second cold start — if the first connection is slow, wait and try again.
❌ Different browsers or devices = rooms not visible to each other
❌ Once in a game via direct link in different browser = gameplay might work via Nakama WebSocket, but matchmaking screen won't show rooms

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Nakama 3.22 (Go + JavaScript runtime) |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4, Framer Motion |
| UI Components | Radix UI, shadcn/ui |
| Frontend Hosting | Netlify |
| Backend Hosting | Render |