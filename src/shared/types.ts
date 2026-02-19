export type AgentStatus = "pending" | "running" | "completed" | "failed" | "retrying";
export type MessageRole = "user" | "assistant" | "system";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  agentName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface AgentExecution {
  id: string;
  chatId: string;
  agentName: string;
  status: AgentStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  retryCount: number;
  startedAt: number;
  completedAt: number | null;
}

export interface TokenUsage {
  id: string;
  executionId: string;
  chatId: string;
  agentName: string;
  provider: string;
  model: string;
  apiKeyHash: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  projectId: string;
  chatId: string | null;
  label: string;
  fileManifest: Record<string, string>;
  createdAt: number;
}

export interface ProviderConfig {
  apiKey: string;
  proxyUrl?: string;
}

export interface ApiKeyHeaders {
  anthropic?: ProviderConfig;
  openai?: ProviderConfig;
  google?: ProviderConfig;
}

export type AgentName =
  | "orchestrator"
  | "research"
  | "architect"
  | "frontend-dev"
  | "backend-dev"
  | "styling"
  | "code-review"
  | "qa"
  | "security";

export interface AgentConfig {
  name: AgentName;
  displayName: string;
  provider: string;
  model: string;
  description: string;
}

export interface WsMessage {
  type: "agent_status" | "agent_stream" | "agent_complete" | "agent_error" | "chat_message" | "agent_thinking" | "token_usage" | "files_changed" | "preview_ready";
  payload: Record<string, unknown>;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}
