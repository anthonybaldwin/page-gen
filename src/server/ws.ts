import type { WsMessage } from "../shared/types.ts";

let serverRef: { publish(topic: string, data: string): void } | null = null;

export function setServer(server: { publish(topic: string, data: string): void }) {
  serverRef = server;
}

export function broadcast(message: WsMessage) {
  if (!serverRef) return;
  serverRef.publish("agents", JSON.stringify(message));
}

export function broadcastAgentStatus(agentName: string, status: string, details?: Record<string, unknown>) {
  broadcast({
    type: "agent_status",
    payload: { agentName, status, ...details },
  });
}

export function broadcastAgentStream(agentName: string, chunk: string) {
  broadcast({
    type: "agent_stream",
    payload: { agentName, chunk },
  });
}

export function broadcastAgentError(agentName: string, error: string) {
  broadcast({
    type: "agent_error",
    payload: { agentName, error },
  });
}

export function broadcastAgentThinking(
  agentName: string,
  displayName: string,
  status: "started" | "streaming" | "completed" | "failed",
  extra?: { chunk?: string; summary?: string }
) {
  broadcast({
    type: "agent_thinking",
    payload: { agentName, displayName, status, ...extra },
  });
}

export function broadcastFilesChanged(projectId: string, files: string[]) {
  broadcast({
    type: "files_changed",
    payload: { projectId, files },
  });
}

export function broadcastTokenUsage(payload: {
  chatId: string;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
}) {
  broadcast({
    type: "token_usage",
    payload,
  });
}
