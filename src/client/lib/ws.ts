import type { WsMessage } from "../../shared/types.ts";

type WsHandler = (message: WsMessage) => void;

let ws: WebSocket | null = null;
let handlers: WsHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // In development, Vite runs on :5173 but the backend is on :3000.
  // Connect directly to the backend to avoid Vite's proxy (Bun compat issue).
  const host = window.location.port === "5173" ? "localhost:3000" : window.location.host;
  ws = new WebSocket(`${protocol}//${host}/ws`);

  ws.onopen = () => {
    console.log("[ws] connected");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as WsMessage;
      handlers.forEach((handler) => handler(message));
    } catch {
      console.warn("[ws] failed to parse message:", event.data);
    }
  };

  ws.onclose = () => {
    console.log("[ws] disconnected, reconnecting in 3s...");
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error("[ws] error:", err);
    ws?.close();
  };
}

export function onWsMessage(handler: WsHandler) {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export function sendWsMessage(message: WsMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
