export type AgentStatus = "pending" | "running" | "completed" | "failed" | "retrying" | "stopped";
export type MessageRole = "user" | "assistant" | "system";

export interface VibeBrief {
  adjectives: string[];       // 3-6 vibe words
  targetUser: string;         // 1-2 sentences about the intended user
  antiReferences: string;     // what it should NOT feel like
  metaphor: string;           // studio|workshop|library|arcade|cabin|cockpit|gallery|campsite or custom string
  customMetaphor?: string;    // only when metaphor === "custom"
  additionalNotes?: string;   // freeform overflow
}

export interface DesignOption {
  name: string;               // e.g. "Warm Analog"
  description: string;        // 1-2 sentences
  design_system: Record<string, unknown>;
  colorPreview: string[];     // 4-6 hex values for swatch strip
}

export interface PipelineCheckpoint {
  chatId: string;
  checkpointId: string;
  nodeId: string;             // flow node ID that triggered this checkpoint
  label: string;
  checkpointType: "approve" | "design_direction";
  message: string;
  options?: DesignOption[];   // for design_direction type; undefined for approve
  timeoutMs: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  vibeBrief: VibeBrief | null;
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
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costEstimate: number;
  createdAt: number;
}

export interface ProviderConfig {
  apiKey: string;
  proxyUrl?: string;
}

export const BUILTIN_AGENT_NAMES = [
  "orchestrator", "orchestrator:classify", "orchestrator:title",
  "orchestrator:question", "orchestrator:summary",
  "research", "architect", "frontend-dev", "backend-dev",
  "styling", "code-review", "qa", "security",
] as const;
export type BuiltinAgentName = typeof BUILTIN_AGENT_NAMES[number];

/** Agent name — string to allow custom agents alongside built-in ones. */
export type AgentName = string;

export type AgentGroup = "planning" | "development" | "quality" | "custom";

export interface AgentConfig {
  name: AgentName;
  displayName: string;
  provider: string;
  model: string;
  description: string;
  group: AgentGroup;
  allowedCategories?: string[];  // ModelCategory values; undefined = all categories
}

export interface ResolvedAgentConfig extends AgentConfig {
  isOverridden: boolean;
  isBuiltIn: boolean;
}

export interface ModelPricing {
  input: number;
  output: number;
  isOverridden: boolean;
  isKnown: boolean;
  category?: string;
}

export interface CacheMultiplierInfo {
  provider: string;
  create: number;
  read: number;
  isOverridden: boolean;
  isKnown: boolean;
}

export type OrchestratorIntent = "build" | "fix" | "question";

export type IntentScope = "frontend" | "backend" | "styling" | "full";

export interface IntentClassification {
  intent: OrchestratorIntent;
  scope: IntentScope;
  needsBackend: boolean;
  reasoning: string;
}

export interface WsMessage {
  type: "agent_status" | "agent_stream" | "agent_error" | "chat_message" | "agent_thinking" | "token_usage" | "files_changed" | "preview_ready" | "pipeline_plan" | "pipeline_interrupted" | "pipeline_checkpoint" | "pipeline_checkpoint_resolved" | "test_results" | "test_result_incremental" | "chat_renamed" | "backend_ready" | "backend_error" | "preview_exited";
  payload: Record<string, unknown>;
}

export interface TestDetail {
  suite: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  duration?: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export interface ContentSearchMatch {
  line: number;
  content: string;
}

export interface ContentSearchResult {
  path: string;
  matches: ContentSearchMatch[];
}

export const BUILTIN_TOOL_NAMES = ["write_file", "write_files", "read_file", "list_files", "save_version"] as const;
export type BuiltinToolName = typeof BUILTIN_TOOL_NAMES[number];

/** Tool name — string to allow custom tools alongside built-in ones. */
export type ToolName = string;

/** All built-in tool names. */
export const ALL_TOOLS: string[] = [...BUILTIN_TOOL_NAMES];
/** File-ops tools only (excludes save_version). */
export const FILE_TOOLS: string[] = ["write_file", "write_files", "read_file", "list_files"];

export interface AgentToolConfig {
  name: AgentName;
  displayName: string;
  group: AgentGroup;
  tools: ToolName[];
  defaultTools: ToolName[];
  isOverridden: boolean;
  isReadOnly: boolean;
}

export interface AgentLimitsConfig {
  name: AgentName;
  displayName: string;
  group: AgentGroup;
  maxOutputTokens: number;
  maxToolSteps: number;
  defaultMaxOutputTokens: number;
  defaultMaxToolSteps: number;
  isOverridden: boolean;
}
