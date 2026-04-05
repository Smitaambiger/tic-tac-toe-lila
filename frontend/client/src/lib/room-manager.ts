// room-manager.ts — Cross-browser room sharing using BroadcastChannel + localStorage
import { sessionManager } from "./session-manager";

export type Room = {
  id: string;
  name: string;
  creatorName: string;
  creatorAvatar: string;
  creatorFingerprint: string;
  joinerFingerprint?: string;
  players: number;
  maxPlayers: number;
  status: "waiting" | "playing" | "finished";
  createdAt: number;
};

type RoomData = { rooms: Record<string, Room> };

const ROOM_KEY = "tictactoe_rooms";
const CHAN_NAME = "tictactoe_rooms_channel";

function getStored(): RoomData {
  try { const d = localStorage.getItem(ROOM_KEY); if (d) return JSON.parse(d); } catch {}
  return { rooms: {} };
}

function save(data: RoomData) {
  try {
    localStorage.setItem(ROOM_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event("storage"));
  } catch {}
}

let channel: BroadcastChannel | null = null;
const listeners: Set<(rooms: Room[]) => void> = new Set();

function getChannel(): BroadcastChannel | null {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHAN_NAME);
    channel.onmessage = (e) => {
      if (e.data?.type === "ROOMS_UPDATED")
        listeners.forEach(l => l(Object.values(e.data.rooms)));
    };
  }
  return channel;
}

function broadcast(rooms: Record<string, Room>) {
  getChannel()?.postMessage({ type: "ROOMS_UPDATED", rooms });
  localStorage.setItem(ROOM_KEY + "_t", Date.now().toString());
}

export const roomManager = {
  getRooms(): Room[] {
    const data = getStored();
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
    return Object.values(data.rooms)
      .filter(r => r.createdAt > cutoff || r.status === "playing")
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  getJoinableRooms(): Room[] {
    const fp = sessionManager.getFingerprint();
    return this.getRooms().filter(
      r => r.status === "waiting" && r.players < r.maxPlayers && r.creatorFingerprint !== fp
    );
  },

  createRoom(roomId?: string): Room {
    const name   = sessionManager.getPlayerName()   || "Anonymous";
    const avatar = sessionManager.getPlayerAvatar() || "x";
    const fp     = sessionManager.getFingerprint();
    const id = roomId || "match-" + Math.floor(Math.random() * 100000);

    const room: Room = {
      id, name: `${name}'s Room`,
      creatorName: name, creatorAvatar: avatar,
      creatorFingerprint: fp,
      players: 1, maxPlayers: 2,
      status: "waiting",
      createdAt: Date.now(),
    };

    const data = getStored();
    data.rooms[id] = room;
    save(data); broadcast(data.rooms);
    return room;
  },

  getRoom(id: string): Room | null {
    return getStored().rooms[id] || null;
  },

  isMyRoom(id: string): boolean {
    const r = this.getRoom(id);
    return !!r && r.creatorFingerprint === sessionManager.getFingerprint();
  },

  updateRoom(id: string, updates: Partial<Room>): Room | null {
    const data = getStored();
    if (!data.rooms[id]) return null;
    data.rooms[id] = { ...data.rooms[id], ...updates };
    save(data); broadcast(data.rooms);
    return data.rooms[id];
  },

  joinRoom(id: string): Room | null {
    const data = getStored();
    const room = data.rooms[id];
    if (!room || room.players >= room.maxPlayers || room.status !== "waiting") return null;
    const fp = sessionManager.getFingerprint();
    if (room.creatorFingerprint === fp) return null;
    room.players = 2;
    room.status = "playing";
    room.joinerFingerprint = fp;
    save(data); broadcast(data.rooms);
    return room;
  },

  leaveRoom(id: string): void {
    const data = getStored();
    const room = data.rooms[id];
    if (!room) return;
    const fp = sessionManager.getFingerprint();
    if (room.players <= 1 || room.creatorFingerprint === fp) {
      delete data.rooms[id];
    } else {
      room.players = 1;
      room.status = "waiting";
      room.joinerFingerprint = undefined;
    }
    save(data); broadcast(data.rooms);
  },

  deleteRoom(id: string): void {
    const data = getStored();
    delete data.rooms[id];
    save(data); broadcast(data.rooms);
  },

  // Removes rooms created before today (midnight local time) OR rooms that finished over 5 min ago
  cleanupOldRooms(): void {
    const data = getStored();
    const midnight = new Date(); midnight.setHours(0,0,0,0);
    const cutoff = midnight.getTime();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let changed = false;
    Object.entries(data.rooms).forEach(([id, room]) => {
      // Delete: old rooms (before today, not currently playing) OR finished rooms older than 5 minutes
      const isOld = room.createdAt < cutoff && room.status !== "playing";
      const isStaleFinished = room.status === "finished" && room.createdAt < fiveMinAgo;
      if (isOld || isStaleFinished) {
        delete data.rooms[id];
        changed = true;
      }
    });
    if (changed) { save(data); broadcast(data.rooms); }
  },

  subscribe(listener: (rooms: Room[]) => void): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROOM_KEY || e.key === ROOM_KEY + "_t") listener(roomManager.getRooms());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};

if (typeof window !== "undefined") roomManager.cleanupOldRooms();