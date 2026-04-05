// nakama-client.ts — Single Nakama WebSocket connection
// Connects to the deployed Nakama server for real cross-device multiplayer

const NAKAMA_HOST = import.meta.env.VITE_NAKAMA_HOST || "tic-tac-toe-8a0o.onrender.com";
const NAKAMA_PORT = import.meta.env.VITE_NAKAMA_PORT || "443";
const NAKAMA_KEY  = import.meta.env.VITE_NAKAMA_KEY  || "defaultkey";
const USE_SSL     = NAKAMA_HOST !== "localhost";
const HTTP_PROTO  = USE_SSL ? "https" : "http";
const WS_PROTO    = USE_SSL ? "wss"   : "ws";

export interface NakamaSession {
  token: string;
  userId: string;
  username: string;
}

let _session: NakamaSession | null = null;
let _socket: WebSocket | null = null;
let _messageHandlers: Array<(data: any) => void> = [];
let _openHandlers: Array<() => void> = [];
let _closeHandlers: Array<() => void> = [];

function getDeviceId(): string {
  let id = sessionStorage.getItem("nakama_device");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + "_" + Date.now();
    sessionStorage.setItem("nakama_device", id);
  }
  return id;
}

export async function authenticate(displayName?: string): Promise<NakamaSession> {
  if (_session) return _session;

  const deviceId = getDeviceId();
  const creds = btoa(NAKAMA_KEY + ":");
  const url = `${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/account/authenticate/device?create=true`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + creds,
    },
    body: JSON.stringify({ id: deviceId }),
  });

  if (!resp.ok) throw new Error("Nakama auth failed: " + resp.status);
  const data = await resp.json();
  _session = { token: data.token, userId: data.account?.user?.id || "", username: data.account?.user?.username || deviceId };
  return _session;
}

export function connectSocket(session: NakamaSession): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (_socket && _socket.readyState === WebSocket.OPEN) { resolve(_socket); return; }

    const wsUrl = `${WS_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/ws?token=${session.token}&format=json`;
    const ws = new WebSocket(wsUrl);
    _socket = ws;

    ws.onopen = () => {
      _openHandlers.forEach(h => h());
      resolve(ws);
    };
    ws.onerror = (e) => reject(e);
    ws.onclose = () => {
      _socket = null;
      _closeHandlers.forEach(h => h());
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        _messageHandlers.forEach(h => h(data));
      } catch {}
    };
  });
}

export function onMessage(handler: (data: any) => void): () => void {
  _messageHandlers.push(handler);
  return () => { _messageHandlers = _messageHandlers.filter(h => h !== handler); };
}

export function onOpen(handler: () => void): () => void {
  _openHandlers.push(handler);
  return () => { _openHandlers = _openHandlers.filter(h => h !== handler); };
}

export function sendRaw(data: object) {
  if (_socket?.readyState === WebSocket.OPEN) {
    _socket.send(JSON.stringify(data));
  }
}

export async function createNakamaMatch(session: NakamaSession): Promise<string> {
  const url = `${HTTP_PROTO}://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/rpc/create_match`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + session.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error("create_match RPC failed: " + resp.status);
  const data = await resp.json();
  const payload = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
  return payload.matchId;
}

export function joinNakamaMatch(matchId: string) {
  sendRaw({ match_join: { match_id: matchId } });
}

export function leaveNakamaMatch(matchId: string) {
  sendRaw({ match_leave: { match_id: matchId } });
}

export function sendMatchData(matchId: string, opCode: number, payload: object) {
  const encoded = btoa(JSON.stringify(payload));
  sendRaw({ match_data_send: { match_id: matchId, op_code: opCode, data: encoded } });
}

export function getSession() { return _session; }
export function getSocket() { return _socket; }
export function isConnected() { return _socket?.readyState === WebSocket.OPEN; }

export function disconnect() {
  _socket?.close();
  _socket = null;
  _session = null;
}