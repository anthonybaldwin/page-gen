import type { WsMessage } from "../shared/types.ts";

let serverRef: { publish(topic: string, data: string): void } | null = null;

export function setServer(server: { publish(topic: string, data: string): void }) {
  serverRef = server;
}

export function broadcast(message: WsMessage) {
  if (!serverRef) return;
  serverRef.publish("agents", JSON.stringify(message));
}

export function broadcastAgentStatus(chatId: string, agentName: string, status: string, details?: Record<string, unknown>) {
  broadcast({
    type: "agent_status",
    payload: { chatId, agentName, status, ...details },
  });
}

export function broadcastAgentStream(chatId: string, agentName: string, chunk: string) {
  broadcast({
    type: "agent_stream",
    payload: { chatId, agentName, chunk },
  });
}

export function broadcastAgentError(chatId: string, agentName: string, error: string) {
  broadcast({
    type: "agent_error",
    payload: { chatId, agentName, error },
  });
}

export function broadcastAgentThinking(
  chatId: string,
  agentName: string,
  displayName: string,
  status: "started" | "streaming" | "completed" | "failed",
  extra?: { chunk?: string; summary?: string }
) {
  broadcast({
    type: "agent_thinking",
    payload: { chatId, agentName, displayName, status, ...extra },
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
  projectId?: string;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costEstimate: number;
}) {
  broadcast({
    type: "token_usage",
    payload,
  });
}

export function broadcastTestResults(payload: {
  chatId: string;
  projectId: string;
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: Array<{ name: string; error: string }>;
  testDetails?: Array<{ suite: string; name: string; status: "passed" | "failed" | "skipped"; error?: string; duration?: number }>;
  skipped?: boolean;
  skipReason?: string;
}) {
  broadcast({
    type: "test_results",
    payload,
  });
}

export function broadcastTestResultIncremental(payload: {
  chatId: string;
  projectId: string;
  suite: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  duration?: number;
}) {
  broadcast({
    type: "test_result_incremental",
    payload,
  });
}
