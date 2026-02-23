import type { OrchestratorIntent } from "./types.ts";

// --- Flow Node Types ---

export type FlowNodeType = "agent" | "condition" | "checkpoint" | "action" | "version";

// --- Upstream Source Configuration ---

export type UpstreamTransform =
  | "raw"              // Pass through as-is (default)
  | "design-system"    // Extract design_system from architect JSON → markdown
  | "file-manifest"    // Extract file paths from write_file tool calls
  | "project-source";  // Fresh read from disk (not cached agent output)

export const UPSTREAM_TRANSFORMS: UpstreamTransform[] = ["raw", "design-system", "file-manifest", "project-source"];

export const WELL_KNOWN_SOURCES = ["vibe-brief", "mood-analysis", "project-source"] as const;
export type WellKnownSource = typeof WELL_KNOWN_SOURCES[number];

export interface UpstreamSource {
  sourceKey: string;           // Node ID or well-known key ("vibe-brief", "mood-analysis")
  alias?: string;              // Key name in "Previous Agent Outputs" (defaults to sourceKey)
  transform?: UpstreamTransform;
}

export interface AgentNodeData {
  type: "agent";
  agentName: string;
  inputTemplate: string;
  maxOutputTokens?: number;  // per-node override
  maxToolSteps?: number;     // per-node override
  upstreamSources?: UpstreamSource[];
  toolOverrides?: string[];  // per-node tool override (replaces global agent tools when set)
  systemPrompt?: string;     // per-node system prompt override (falls back to agent default)
}

export interface ConditionNodeData {
  type: "condition";
  /** "predefined" uses a known dropdown; "expression" allows freeform boolean expression */
  mode: "predefined" | "expression";
  predefined?: string; // e.g. "needsBackend", "scopeIncludes:frontend"
  expression?: string; // e.g. "scope === 'backend' || scope === 'full'"
  /** Label shown on the diamond node */
  label: string;
}

export interface CheckpointNodeData {
  type: "checkpoint";
  label: string;
  /** If true, this checkpoint is skipped in YOLO mode */
  skipInYolo: boolean;
  /** The type of checkpoint interaction */
  checkpointType?: "approve" | "design_direction";
  /** Message shown to the user in the checkpoint card */
  message?: string;
  /** Timeout in milliseconds before auto-resolving (0 = no timeout) */
  timeoutMs?: number;
}

export type ActionKind = "build-check" | "test-run" | "remediation" | "summary" | "vibe-intake" | "mood-analysis" | "answer";

export interface ActionNodeData {
  type: "action";
  kind: ActionKind;
  label: string;
  // Per-node overrides (optional — falls back to Pipeline Defaults)
  timeoutMs?: number;       // build-check, test-run
  maxAttempts?: number;     // remediation (cycles), build-check (fix attempts)
  maxTestFailures?: number; // test-run
  maxUniqueErrors?: number; // build-check, test-run
  // LLM configuration (for agentic action kinds: summary, mood-analysis)
  systemPrompt?: string;       // custom system prompt override
  maxOutputTokens?: number;    // max output tokens for the LLM call
  // Remediation-specific configuration
  remediationFixAgents?: string[];     // agents to use for fixes (default: auto-detect via routing hints)
  remediationReviewerKeys?: string[];  // result keys to scan for issues (default: ["code-review", "qa", "security"])
  // Build/test command overrides
  buildCommand?: string;   // build-check: custom build command (default: "bunx vite build --mode development")
  testCommand?: string;    // test-run: custom test command (default: "bunx vitest run")
}

export interface VersionNodeData {
  type: "version";
  label: string;
}

export type FlowNodeData = AgentNodeData | ConditionNodeData | CheckpointNodeData | ActionNodeData | VersionNodeData;

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  data: FlowNodeData;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** For condition nodes: "true" or "false" branch */
  sourceHandle?: string;
  label?: string;
}

// --- Flow Template ---

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  intent: OrchestratorIntent;
  version: number;
  enabled: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: number;
  updatedAt: number;
  isDefault: boolean;
}

// --- Flow Resolution Context ---

export interface FlowResolutionContext {
  intent: OrchestratorIntent;
  scope: string;
  needsBackend: boolean;
  hasFiles: boolean;
  userMessage: string;
}

// --- Predefined Conditions ---

export const PREDEFINED_CONDITIONS = [
  { id: "needsBackend", label: "Needs Backend?", description: "True when the project requires a backend server" },
  { id: "scopeIncludes:frontend", label: "Scope includes frontend", description: "True when scope is 'frontend' or 'full'" },
  { id: "scopeIncludes:backend", label: "Scope includes backend", description: "True when scope is 'backend' or 'full'" },
  { id: "scopeIncludes:styling", label: "Scope is styling", description: "True when scope is 'styling'" },
  { id: "hasFiles", label: "Has existing files", description: "True when the project already has files on disk" },
] as const;

export const CONDITION_VARIABLES = ["intent", "scope", "needsBackend", "hasFiles"] as const;
export type ConditionVariable = typeof CONDITION_VARIABLES[number];
