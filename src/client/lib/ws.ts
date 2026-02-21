import type { WsMessage } from "../../shared/types.ts";
import { WS_FLUSH_INTERVAL, WS_RECONNECT_DELAY } from "../config.ts";

type WsHandler = (message: WsMessage) => void;

let ws: WebSocket | null = null;
let handlers: WsHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Message coalescing: buffer messages and process in batch
let messageBuffer: WsMessage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushMessages() {
  const batch = messageBuffer;
  messageBuffer = [];
  flushTimer = null;
  for (const msg of batch) {
    handlers.forEach((handler) => handler(msg));
  }
}

export function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

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
      messageBuffer.push(message);
      if (!flushTimer) {
        flushTimer = setTimeout(flushMessages, WS_FLUSH_INTERVAL);
      }
    } catch {
      console.warn("[ws] failed to parse message:", event.data);
    }
  };

  ws.onclose = () => {
    console.log("[ws] disconnected, reconnecting in 3s...");
    reconnectTimer = setTimeout(connectWebSocket, WS_RECONNECT_DELAY);
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
