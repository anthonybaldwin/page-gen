import { generateText } from "ai";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq, inArray, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AgentName, IntentClassification, OrchestratorIntent, IntentScope } from "../../shared/types.ts";
import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfigResolved, getAgentTools } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";
import { trackTokenUsage, trackProvisionalUsage, finalizeTokenUsage, countProvisionalRecords } from "../services/token-tracker.ts";
import { estimateCost } from "../services/pricing.ts";
import { checkCostLimit, getMaxAgentCalls, checkDailyCostLimit, checkProjectCostLimit } from "../services/cost-limiter.ts";
import { broadcastAgentStatus, broadcastAgentError, broadcastTokenUsage, broadcastFilesChanged, broadcastAgentThinking, broadcastTestResults, broadcastTestResultIncremental } from "../ws.ts";
import { broadcast } from "../ws.ts";
import { existsSync, writeFileSync, readdirSync } from "fs";
import { writeFile, listFiles, readFile } from "../tools/file-ops.ts";
import { prepareProjectForPreview, invalidateProjectDeps } from "../preview/vite-server.ts";
import { createAgentTools } from "./tools.ts";
import { log, logError, logWarn, logBlock, logLLMInput, logLLMOutput } from "../services/logger.ts";

const MAX_RETRIES = 3;
const MAX_UNIQUE_ERRORS = 10;
const MAX_TEST_FAILURES = 5;
const MAX_OUTPUT_CHARS = 15_000;
const MAX_PROJECT_SOURCE_CHARS = 40_000;
const MAX_BUILD_FIX_ATTEMPTS = 3;

/** Build-fix agents get reduced token/step caps to prevent runaway costs */
const BUILD_FIX_MAX_OUTPUT_TOKENS = 16_000;
const BUILD_FIX_MAX_TOOL_STEPS = 4;

/**
 * Detect non-retriable API errors that should immediately halt the pipeline
 * instead of wasting retries. Covers credit exhaustion, auth failures,
 * invalid API keys, and billing issues.
 */
export function isNonRetriableApiError(err: unknown): { nonRetriable: boolean; reason: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // HTTP 402 Payment Required / credit exhaustion
  if (/402|payment.?required|credit|insufficient.?funds|billing|out of credit/i.test(message)) {
    return { nonRetriable: true, reason: "API credits exhausted (402). Pipeline halted to prevent further charges." };
  }

  // HTTP 401 Unauthorized / invalid key
  if (/401|unauthorized|invalid.?api.?key|authentication.?failed|invalid.*x-api-key/i.test(message)) {
    return { nonRetriable: true, reason: "API authentication failed (401). Check your API key." };
  }

  // HTTP 403 Forbidden / permission denied
  if (/403|forbidden|access.?denied|permission.?denied/i.test(message)) {
    return { nonRetriable: true, reason: "API access forbidden (403). Check your API key permissions." };
  }

  // Anthropic-specific: overloaded is retriable, but "invalid_request" is not
  if (/invalid_request_error/i.test(message) && !/overloaded/i.test(message)) {
    return { nonRetriable: true, reason: "Invalid API request — not retriable." };
  }

  return { nonRetriable: false, reason: "" };
}

/**
 * Deduplicate build error lines by stripping file paths and grouping by core error pattern.
 * Returns formatted string with counts, e.g., "[3x] Cannot find module '@/utils'"
 * Caps at MAX_UNIQUE_ERRORS unique patterns.
 */
export function deduplicateErrors(errorLines: string[]): string {
  if (errorLines.length === 0) return "";
  const counts = new Map<string, { count: number; example: string }>();
  for (const line of errorLines) {
    // Strip file path prefix to get core error pattern
    const core = line.replace(/^[^\s]*:\d+:\d+\s*[-–]\s*/, "").replace(/^.*?:\s*(error|Error|ERR_)/i, "$1").trim();
    const key = core || line.trim();
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { count: 1, example: line.trim() });
    }
  }
  const entries = [...counts.entries()].slice(0, MAX_UNIQUE_ERRORS);
  const lines = entries.map(([, { count, example }]) =>
    count > 1 ? `[${count}x] ${example}` : example
  );
  const omitted = counts.size - MAX_UNIQUE_ERRORS;
  if (omitted > 0) lines.push(`(and ${omitted} more unique errors)`);
  return lines.join("\n");
}

/**
 * Format test failures for agent consumption. Caps at MAX_TEST_FAILURES to prevent prompt bloat.
 */
export function formatTestFailures(failures: Array<{ name: string; error: string }>): string {
  const capped = failures.slice(0, MAX_TEST_FAILURES);
  const lines = capped.map((f) => `- ${f.name}: ${f.error}`);
  if (failures.length > MAX_TEST_FAILURES) {
    lines.push(`(and ${failures.length - MAX_TEST_FAILURES} more failures — fix the above first)`);
  }
  return `Test failures:\n${lines.join("\n")}`;
}

/** Resolve a provider model instance from a config, respecting the configured provider. */
function resolveProviderModel(config: { provider: string; model: string }, providers: ProviderInstance) {
  switch (config.provider) {
    case "anthropic": return providers.anthropic?.(config.model);
    case "openai": return providers.openai?.(config.model);
    case "google": return providers.google?.(config.model);
    default: return null;
  }
}

/**
 * Determine which agents will actually run for a given intent/scope combination.
 * Used for plan-scoped preflight validation.
 */
export function getPlannedAgents(intent: OrchestratorIntent, scope: IntentScope, hasFiles: boolean): AgentName[] {
  if (intent === "question") return [];
  if (intent === "fix" && !hasFiles) return []; // will fall through to build

  if (intent === "fix") {
    // Quick-edit paths (styling, frontend) skip reviewers
    if (scope === "styling") return ["styling"];
    if (scope === "frontend") return ["frontend-dev"];
    // Backend/full fixes get dev + reviewers
    if (scope === "backend") return ["backend-dev", "code-review", "security", "qa"];
    // full scope
    return ["frontend-dev", "backend-dev", "code-review", "security", "qa"];
  }

  // Build mode: research + architect + dev + styling + reviewers
  const agents: AgentName[] = ["research", "architect", "frontend-dev", "styling", "code-review", "security", "qa"];
  return agents;
}

/**
 * Validate that all planned agents can resolve a provider model.
 * Returns an array of error messages (empty = all OK).
 */
export function preflightValidatePlan(agentNames: AgentName[], providers: ProviderInstance): string[] {
  const errors: string[] = [];
  for (const agentName of agentNames) {
    const agentConfig = getAgentConfigResolved(agentName);
    if (!agentConfig) continue;
    const model = resolveProviderModel(agentConfig, providers);
    if (!model) {
      errors.push(`${agentName} requires "${agentConfig.provider}" provider but no API key is configured`);
    }
  }
  return errors;
}

/**
 * Build a fix-mode execution plan for backend/full scopes.
 * Skips the testing agent (finishPipeline runs actual build+tests).
 * Includes reviewers for backend/full scopes (higher risk).
 */
export function buildFixPlan(userMessage: string, scope: IntentScope): ExecutionPlan {
  const steps: ExecutionPlan["steps"] = [];

  // Dev agent(s) based on scope
  if (scope === "backend") {
    steps.push({
      agentName: "backend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
    });
  } else {
    // "full" scope
    steps.push({
      agentName: "frontend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
    });
    steps.push({
      agentName: "backend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
      dependsOn: ["frontend-dev"],
    });
  }

  // Reviewers for backend/full (higher risk)
  const lastDevAgent = steps[steps.length - 1]!.agentName;
  steps.push(
    {
      agentName: "code-review",
      input: `Review all code changes made by dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastDevAgent],
    },
    {
      agentName: "security",
      input: `Security review all code changes (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastDevAgent],
    },
    {
      agentName: "qa",
      input: `Validate the fix against the original request (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastDevAgent],
    },
  );

  return { steps };
}

/**
 * Extract the design_system JSON from the architect's output and format it
 * as a readable section for downstream agents. Mutates the result object
 * by adding a "design-system" key if the architect output contains one.
 */
function injectDesignSystem(result: Record<string, string>): void {
  const architectOutput = result["architect"];
  if (!architectOutput) return;

  try {
    const parsed = JSON.parse(architectOutput);
    if (parsed.design_system) {
      const ds = parsed.design_system;
      const lines: string[] = ["## Design System (from architect)"];

      if (ds.colors) {
        const colorEntries = Object.entries(ds.colors).map(([k, v]) => `${k}: ${v}`).join(" | ");
        lines.push(`Colors: ${colorEntries}`);
      }
      if (ds.typography) {
        const typoEntries = Object.entries(ds.typography).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`Typography: ${typoEntries}`);
      }
      if (ds.spacing) lines.push(`Spacing: ${ds.spacing}`);
      if (ds.radius) lines.push(`Radius: ${ds.radius}`);
      if (ds.shadows) lines.push(`Shadows: ${ds.shadows}`);

      result["design-system"] = lines.join("\n");
    }
  } catch {
    // Architect output not valid JSON — skip design system injection
  }
}

/**
 * Smart truncation: keeps start and end, elides middle.
 * Used to cap upstream outputs without losing critical content at boundaries.
 */
export function truncateOutput(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const keepEach = Math.floor(maxChars / 2) - 30;
  const start = content.slice(0, keepEach);
  const end = content.slice(-keepEach);
  const elided = content.length - keepEach * 2;
  return `${start}\n\n... [${elided.toLocaleString()} chars elided] ...\n\n${end}`;
}

/**
 * Build a compact file manifest from a tool-using agent's output.
 * Extracts just file paths from write_file tool calls and lists them.
 * Tool-using agents wrote code to disk — downstream agents can read_file if needed.
 */
export function buildFileManifest(agentOutput: string): string {
  const files: string[] = [];

  // Extract file paths from native tool calls in output text
  const toolCallRegex = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(agentOutput)) !== null) {
    try {
      const json = JSON.parse(match[1]!.trim());
      if (json.name === "write_file" && json.parameters?.path) {
        files.push(json.parameters.path);
      }
    } catch {
      const pathMatch = match[1]!.match(/"path"\s*:\s*"([^"]+)"/);
      if (pathMatch?.[1]) files.push(pathMatch[1]);
    }
  }

  // Also detect files from write_file tool results (logged by AI SDK)
  const writeFileResultRegex = /write_file.*?"path"\s*:\s*"([^"]+)"/g;
  while ((match = writeFileResultRegex.exec(agentOutput)) !== null) {
    if (!files.includes(match[1]!)) files.push(match[1]!);
  }

  if (files.length === 0) return truncateOutput(agentOutput, MAX_OUTPUT_CHARS);

  return `Files written (${files.length}):\n${files.map(f => `- ${f}`).join("\n")}\n\n(Agent has tools — use read_file to inspect any file above)`;
}

/**
 * For review/re-review phases, read fresh project source from disk.
 * Returns truncated source capped at MAX_PROJECT_SOURCE_CHARS.
 */
function getFreshProjectSource(projectPath: string): string {
  const source = readProjectSource(projectPath);
  return truncateOutput(source, MAX_PROJECT_SOURCE_CHARS);
}

/**
 * Apply truncation to all values in a result object.
 * project-source gets a higher cap; all others get the default.
 */
function truncateAllOutputs(result: Record<string, string>): Record<string, string> {
  const truncated: Record<string, string> = {};
  for (const [k, v] of Object.entries(result)) {
    const cap = k === "project-source" ? MAX_PROJECT_SOURCE_CHARS : MAX_OUTPUT_CHARS;
    truncated[k] = truncateOutput(v, cap);
  }
  return truncated;
}

/** Check if an agent is a tool-using dev agent (writes files to disk). */
function isToolUsingAgent(name: string): boolean {
  return name === "frontend-dev" || name === "backend-dev" || name === "styling";
}

/**
 * Convert tool-using agent outputs to file manifests.
 * Review agents and non-tool agents keep their output as-is.
 */
function manifestifyDevOutputs(result: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(result)) {
    out[k] = isToolUsingAgent(k) ? buildFileManifest(v) : v;
  }
  return out;
}


/**
 * Filter upstream outputs so each agent only receives relevant data.
 * Reduces prompt size significantly — agents don't need outputs from unrelated agents.
 * Tool-using agents' outputs are replaced with file manifests (they wrote to disk).
 * Review agents get fresh project source from disk instead of dev outputs.
 */
export function filterUpstreamOutputs(
  agentName: string,
  instanceId: string | undefined,
  agentResults: Map<string, string>,
  phase?: string,
  projectPath?: string,
): Record<string, string> {
  const all = Object.fromEntries(agentResults);

  const pick = (keys: string[]) => {
    const result: Record<string, string> = {};
    for (const k of keys) {
      if (all[k] !== undefined) result[k] = all[k];
    }
    // Also include project-source if present (used in fix mode)
    if (all["project-source"]) result["project-source"] = all["project-source"];
    return result;
  };

  // --- Remediation phase: targeted filtering instead of sending everything ---
  if (phase === "remediation" || phase === "build-fix") {
    // Remediation/fix agents have tools (read_file, list_files) — they only need
    // review findings + architect. Explicitly skip project-source to save ~15K tokens.
    const reviewKeys = Object.keys(all).filter(k =>
      k === "code-review" || k === "security" || k === "qa"
    );
    const result: Record<string, string> = {};
    for (const k of ["architect", ...reviewKeys]) {
      if (all[k] !== undefined) result[k] = all[k];
    }
    return truncateAllOutputs(result);
  }

  if (phase === "re-review") {
    // Re-review agents need fresh source from disk + architect
    const result: Record<string, string> = {};
    if (all["architect"]) result["architect"] = all["architect"];
    if (projectPath) {
      result["project-source"] = getFreshProjectSource(projectPath);
    } else if (all["project-source"]) {
      result["project-source"] = all["project-source"];
    }
    return truncateAllOutputs(result);
  }

  // frontend-dev → architect + research
  if (agentName === "frontend-dev") {
    const result = pick(["architect", "research"]);
    injectDesignSystem(result);
    return truncateAllOutputs(result);
  }

  // backend-dev → architect + research
  if (agentName === "backend-dev") {
    return truncateAllOutputs(pick(["architect", "research"]));
  }

  // styling → architect only (design system injected for easy consumption)
  if (agentName === "styling") {
    const result = pick(["architect"]);
    injectDesignSystem(result);
    return truncateAllOutputs(result);
  }

  // Review agents (code-review, security, qa) → architect + changed-file manifest (not full source)
  if (agentName === "code-review" || agentName === "security" || agentName === "qa") {
    const result: Record<string, string> = {};
    if (all["architect"]) result["architect"] = all["architect"];

    // Build changed-file manifest from dev agent outputs instead of sending full project source
    const devAgentKeys = ["frontend-dev", "backend-dev", "styling"];
    const changedFiles: string[] = [];
    for (const devKey of devAgentKeys) {
      if (all[devKey]) {
        const manifest = buildFileManifest(all[devKey]);
        if (manifest) changedFiles.push(`### ${devKey} output\n${manifest}`);
      }
    }

    if (changedFiles.length > 0) {
      result["changed-files"] = changedFiles.join("\n\n");
      // Also provide fresh project source for context, but with a tighter cap
      if (projectPath) {
        const REVIEWER_SOURCE_CAP = 30_000;
        const source = readProjectSource(projectPath);
        result["project-source"] = truncateOutput(source, REVIEWER_SOURCE_CAP);
      }
    } else if (projectPath) {
      // No dev agent outputs (e.g., fix mode) — fall back to project source
      result["project-source"] = getFreshProjectSource(projectPath);
    } else if (all["project-source"]) {
      result["project-source"] = all["project-source"];
    }
    return truncateAllOutputs(result);
  }

  // architect → research (sequential: research runs first, architect consumes its requirements)
  if (agentName === "architect") {
    return truncateAllOutputs(pick(["research"]));
  }

  // testing → architect + project-source
  if (agentName === "testing") {
    return truncateAllOutputs(pick(["architect"]));
  }

  // Default: return everything, truncated
  return truncateAllOutputs(all);
}

// Abort registry — keyed by chatId
const abortControllers = new Map<string, AbortController>();

export function abortOrchestration(chatId: string) {
  const controller = abortControllers.get(chatId);
  if (controller) {
    controller.abort();
    abortControllers.delete(chatId);
  }
}

export function isOrchestrationRunning(chatId: string): boolean {
  return abortControllers.has(chatId);
}

/**
 * Mark all "running" and "retrying" agent executions as "failed" on server startup.
 * This handles the case where the server was restarted mid-pipeline — those executions
 * will never complete because in-memory state (abortControllers) was lost.
 * Also inserts a system message into each affected chat so the user knows what happened.
 */
export async function cleanupStaleExecutions(): Promise<number> {
  const staleStatuses = ["running", "retrying"];
  const now = Date.now();

  // Find all stale executions
  const stale = await db
    .select({ id: schema.agentExecutions.id, chatId: schema.agentExecutions.chatId })
    .from(schema.agentExecutions)
    .where(inArray(schema.agentExecutions.status, staleStatuses))
    .all();

  if (stale.length === 0) return 0;

  // Mark them all as failed
  await db
    .update(schema.agentExecutions)
    .set({
      status: "failed",
      error: "Server restarted — pipeline interrupted",
      completedAt: now,
    })
    .where(inArray(schema.agentExecutions.status, staleStatuses));

  // Insert a system message into each affected chat (deduplicated)
  const affectedChats = [...new Set(stale.map((s) => s.chatId))];
  for (const chatId of affectedChats) {
    await db.insert(schema.messages).values({
      id: nanoid(),
      chatId,
      role: "system",
      content: "Pipeline was interrupted by a server restart. You can retry your last message.",
      agentName: "orchestrator",
      metadata: null,
      createdAt: now,
    });
  }

  // Also mark any running pipeline_runs as interrupted
  await db
    .update(schema.pipelineRuns)
    .set({
      status: "interrupted",
      completedAt: now,
    })
    .where(eq(schema.pipelineRuns.status, "running"));

  // Log any provisional billing records from interrupted pipelines
  const provisionalCount = countProvisionalRecords();
  if (provisionalCount > 0) {
    log("orchestrator", `Found ${provisionalCount} provisional (estimated) billing records from interrupted pipelines`);
  }

  log("orchestrator", `Cleaned up ${stale.length} stale executions across ${affectedChats.length} chats`);
  return stale.length;
}

export interface OrchestratorInput {
  chatId: string;
  projectId: string;
  projectPath: string;
  userMessage: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

export interface ExecutionPlan {
  steps: Array<{
    agentName: AgentName;
    input: string;
    dependsOn?: string[];
    instanceId?: string;
  }>;
}

// Shared mutable counters — passed by reference so all call sites share the same count
interface CallCounter { value: number; }
interface BuildFixCounter { value: number; }

interface PipelineStepContext {
  step: { agentName: AgentName; input: string; instanceId?: string };
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  buildFixCounter: BuildFixCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
  /** When true, skip build checks and tests — caller will handle them after the batch completes */
  skipPostProcessing?: boolean;
}

/**
 * Execute a single pipeline step with retries, token tracking, file extraction,
 * and build checks. Returns the agent's output content, or null on failure/abort.
 */
async function runPipelineStep(ctx: PipelineStepContext): Promise<string | null> {
  const { step, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal, skipPostProcessing } = ctx;

  // Use instanceId for keying/broadcasting, base agentName for config lookup
  const stepKey = step.instanceId ?? step.agentName;

  if (signal.aborted) return null;

  // Hard cap — prevent runaway costs
  const maxCalls = getMaxAgentCalls();
  if (callCounter.value >= maxCalls) {
    broadcastAgentError(chatId, "orchestrator", `Agent call limit reached (${maxCalls}). Stopping to prevent runaway costs.`);
    return null;
  }
  callCounter.value++;

  const config = getAgentConfigResolved(step.agentName);
  if (!config) {
    broadcastAgentError(chatId, "orchestrator", `Unknown agent: ${step.agentName}`);
    return null;
  }

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId,
    agentName: stepKey,
    status: "running",
    input: JSON.stringify({ message: step.input }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  // Pre-flight cost estimate: estimate input tokens before calling agent
  const preflightUpstream = filterUpstreamOutputs(step.agentName, step.instanceId, agentResults, undefined, projectPath);
  const estimatedPromptChars = step.input.length
    + Object.values(preflightUpstream).reduce((sum, v) => sum + v.length, 0)
    + chatHistory.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedInputTokens = Math.ceil(estimatedPromptChars / 4);

  const preflightCheck = checkCostLimit(chatId);
  if (preflightCheck.allowed && preflightCheck.limit > 0) {
    const currentTokens = preflightCheck.currentTokens || 0;
    if (currentTokens + estimatedInputTokens > preflightCheck.limit * 0.95) {
      log("orchestrator", `Pre-flight skip: ${stepKey} estimated ${estimatedInputTokens.toLocaleString()} tokens would exceed 95% of limit (${currentTokens.toLocaleString()}/${preflightCheck.limit.toLocaleString()})`);
      broadcastAgentError(chatId, "orchestrator", `Skipping ${stepKey}: estimated token usage would exceed limit`);
      return null;
    }
  }

  let result: AgentOutput | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) break;

    try {
      const agentInput: AgentInput = {
        userMessage: step.input,
        chatHistory,
        projectPath,
        context: {
          projectId,
          originalRequest: userMessage,
          upstreamOutputs: preflightUpstream,
        },
      };

      // Create native tools based on agent's tool config
      const enabledToolNames = getAgentTools(step.agentName);
      let agentTools: ReturnType<typeof createAgentTools> | undefined;
      if (enabledToolNames.length > 0) {
        agentTools = createAgentTools(projectPath, projectId);
      }
      const toolSubset = agentTools
        ? Object.fromEntries(
            enabledToolNames
              .filter((t) => t in agentTools!.tools)
              .map((t) => [t, agentTools!.tools[t as keyof typeof agentTools.tools]])
          )
        : undefined;

      // Write-ahead: track provisional usage before the LLM call
      const providerKey = apiKeys[config.provider];
      let provisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;
      if (providerKey) {
        provisionalIds = trackProvisionalUsage({
          executionId, chatId,
          agentName: stepKey,
          provider: config.provider,
          model: config.model,
          apiKey: providerKey,
          estimatedInputTokens: estimatedInputTokens,
          projectId, projectName, chatTitle,
        });
      }

      result = await runAgent(config, providers, agentInput, toolSubset, signal, chatId, step.instanceId);

      // Fix: Detect silent API failures (0-token empty responses from rate limiting)
      const emptyOutputTokens = result.tokenUsage?.outputTokens || 0;
      const hasContent = result.content.length > 0 || (result.filesWritten && result.filesWritten.length > 0);
      if (emptyOutputTokens === 0 && !hasContent) {
        log("orchestrator", `Agent ${stepKey} returned empty response (0 tokens) — treating as retriable failure`);
        throw new Error(`Agent returned empty response (possible API rate limit or timeout)`);
      }

      if (result.tokenUsage && providerKey && provisionalIds) {
        // Finalize provisional record with actual token counts
        finalizeTokenUsage(provisionalIds, {
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
          cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
        }, config.provider, config.model);

        const totalTokens = result.tokenUsage.inputTokens + result.tokenUsage.outputTokens
          + (result.tokenUsage.cacheCreationInputTokens || 0) + (result.tokenUsage.cacheReadInputTokens || 0);
        const costEst = estimateCost(
          config.provider, config.model,
          result.tokenUsage.inputTokens, result.tokenUsage.outputTokens,
          result.tokenUsage.cacheCreationInputTokens || 0, result.tokenUsage.cacheReadInputTokens || 0,
        );
        broadcastTokenUsage({
          chatId,
          projectId,
          agentName: stepKey,
          provider: config.provider,
          model: config.model,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          totalTokens,
          costEstimate: costEst,
        });
      }

      await db.update(schema.agentExecutions)
        .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, executionId));

      agentResults.set(stepKey, result.content);
      completedAgents.push(stepKey);

      // Hybrid file tracking: native tools write files mid-stream,
      // fallback extraction catches models that don't use tools properly
      const nativeFiles = result.filesWritten || [];
      const alreadyWritten = new Set(nativeFiles);
      const fallbackFiles = extractAndWriteFiles(step.agentName, result.content, projectPath, projectId, alreadyWritten);
      if (fallbackFiles.length > 0) {
        logWarn("orchestrator", `${step.agentName} used text fallback for ${fallbackFiles.length} files`);
      }
      const filesWritten = [...nativeFiles, ...fallbackFiles];

      // Diagnostic: warn when file-writing agent produces tokens but no files (possible truncation)
      const diagOutputTokens = result.tokenUsage?.outputTokens || 0;
      if (filesWritten.length === 0 && agentHasFileTools(step.agentName) && diagOutputTokens > 1000) {
        logWarn("orchestrator", `${stepKey} produced ${diagOutputTokens} output tokens but wrote 0 files — possible tool call truncation`);
      }

      if (filesWritten.length > 0 && agentHasFileTools(step.agentName) && !signal.aborted && !skipPostProcessing) {
        // All file-producing agents get build check (skipped for parallel batches — caller handles it)
        const buildErrors = await checkProjectBuild(projectPath);
        if (buildErrors && !signal.aborted) {
          const fixResult = await runBuildFix({
            buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
            userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal,
          });
          if (fixResult) {
            agentResults.set(`${stepKey}-build-fix`, fixResult);
            completedAgents.push(`${stepKey} (build fix)`);
          }
          const recheckErrors = await checkProjectBuild(projectPath);
          if (!recheckErrors) {
            broadcast({ type: "preview_ready", payload: { projectId } });
          }
        } else {
          broadcast({ type: "preview_ready", payload: { projectId } });
        }

        // After dev agents (not testing itself), run tests if test files exist
        if (step.agentName !== "testing" && !signal.aborted) {
          const hasTestFiles = testFilesExist(projectPath);
          if (hasTestFiles) {
            const testResult = await runProjectTests(projectPath, chatId, projectId);
            if (testResult && testResult.failed > 0 && !signal.aborted) {
              // Route test failures to dev agent for one fix attempt
              const testFixResult = await runBuildFix({
                buildErrors: formatTestFailures(testResult.failures),
                chatId, projectId, projectPath, projectName, chatTitle,
                userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal,
              });
              if (testFixResult) {
                agentResults.set(`${stepKey}-test-fix`, testFixResult);
                completedAgents.push(`${stepKey} (test fix)`);
              }
              // Smart re-run: only re-run failed test files, not the full suite
              if (!signal.aborted) {
                const failedFiles = testResult.testDetails
                  ?.filter((t) => t.status === "failed")
                  .map((t) => t.suite)
                  .filter((v, i, a) => a.indexOf(v) === i); // unique
                await runProjectTests(projectPath, chatId, projectId, failedFiles);
              }
            }
          }
        }
      }

      break;
    } catch (err) {
      if (signal.aborted) break;
      lastError = err instanceof Error ? err : new Error(String(err));
      logError("orchestrator", `Agent ${stepKey} attempt ${attempt} error: ${lastError.message}`, err);

      // Check for non-retriable API errors (credit exhaustion, auth failure, etc.)
      const apiCheck = isNonRetriableApiError(err);
      if (apiCheck.nonRetriable) {
        log("orchestrator", `Non-retriable API error for ${stepKey}: ${apiCheck.reason}`);
        await db.update(schema.agentExecutions)
          .set({ status: "failed", error: apiCheck.reason, completedAt: Date.now() })
          .where(eq(schema.agentExecutions.id, executionId));
        broadcastAgentError(chatId, stepKey, apiCheck.reason);
        broadcast({
          type: "agent_error",
          payload: { chatId, agentName: "orchestrator", error: apiCheck.reason, errorType: "credit_exhaustion" },
        });
        return null; // Halt immediately — no retries
      }

      if (attempt < MAX_RETRIES) {
        await db.update(schema.agentExecutions)
          .set({ status: "retrying", retryCount: attempt + 1 })
          .where(eq(schema.agentExecutions.id, executionId));
        broadcastAgentStatus(chatId, stepKey, "retrying", { attempt: attempt + 1 });
      }
    }
  }

  if (signal.aborted) return null;

  if (!result) {
    const errorMsg = lastError?.message || "Unknown error";
    log("orchestrator", `Agent ${stepKey} failed after ${MAX_RETRIES} retries. Last error: ${errorMsg}`);
    await db.update(schema.agentExecutions)
      .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));
    broadcastAgentError(chatId, stepKey, errorMsg);
    broadcastAgentError(chatId, "orchestrator", `Pipeline halted: ${stepKey} failed after ${MAX_RETRIES} retries — ${errorMsg}`);
    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "system",
      content: `Agent ${stepKey} failed: ${errorMsg}`,
      agentName: stepKey, metadata: null, createdAt: Date.now(),
    });
    return null;
  }

  return result.content;
}

export async function runOrchestration(input: OrchestratorInput): Promise<void> {
  const { chatId, projectId, projectPath, userMessage, providers, apiKeys } = input;

  // Create abort controller for this orchestration
  const controller = new AbortController();
  abortControllers.set(chatId, controller);
  const { signal } = controller;

  // Check cost limits before starting
  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
    abortControllers.delete(chatId);
    broadcastAgentError(chatId, "orchestrator", `Token limit reached (${costCheck.currentTokens}/${costCheck.limit}). Please increase your limit to continue.`);
    return;
  }

  if (costCheck.warning) {
    broadcastAgentStatus(chatId, "orchestrator", "warning", {
      message: `Token usage at ${Math.round(costCheck.percentUsed * 100)}% of limit`,
    });
  }

  // Check daily cost limit
  const dailyCheck = checkDailyCostLimit();
  if (!dailyCheck.allowed) {
    abortControllers.delete(chatId);
    broadcastAgentError(chatId, "orchestrator", `Daily cost limit reached ($${dailyCheck.currentCost.toFixed(2)}/$${dailyCheck.limit.toFixed(2)}). Adjust your daily limit in Settings to continue.`);
    return;
  }

  // Check per-project cost limit
  const projectCheck = checkProjectCostLimit(projectId);
  if (!projectCheck.allowed) {
    abortControllers.delete(chatId);
    broadcastAgentError(chatId, "orchestrator", `Project cost limit reached ($${projectCheck.currentCost.toFixed(2)}/$${projectCheck.limit.toFixed(2)}). Adjust your project limit in Settings to continue.`);
    return;
  }

  // Load project name and chat title for billing ledger
  const projectRow = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  const chatRow = await db.select({ title: schema.chats.title }).from(schema.chats).where(eq(schema.chats.id, chatId)).get();
  const projectName = projectRow?.name || "Unknown";
  const chatTitle = chatRow?.title || "Unknown";

  // Load chat history
  const chatMessages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .all();

  const chatHistory = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  broadcastAgentStatus(chatId, "orchestrator", "running");

  // Clean up stale "running" agent executions from previous interrupted pipelines for this chat
  // Prevents ghost "running" records when a user stopped a pipeline or it crashed
  try {
    const staleStatuses = ["running", "retrying"];
    const staleExecs = db
      .select({ id: schema.agentExecutions.id })
      .from(schema.agentExecutions)
      .where(and(
        eq(schema.agentExecutions.chatId, chatId),
        inArray(schema.agentExecutions.status, staleStatuses),
      ))
      .all();
    if (staleExecs.length > 0) {
      log("orchestrator", `Cleaning up ${staleExecs.length} stale "running" executions for chat ${chatId}`);
      db.update(schema.agentExecutions)
        .set({ status: "interrupted", error: "Cleaned up: new pipeline started", completedAt: Date.now() })
        .where(and(
          eq(schema.agentExecutions.chatId, chatId),
          inArray(schema.agentExecutions.status, staleStatuses),
        ))
        .run();
    }
  } catch (cleanupErr) {
    logWarn("orchestrator", `Stale execution cleanup failed (non-critical): ${cleanupErr}`);
  }

  // Auto-title: if chat has a generic title and this is the first real message, generate a title
  if (chatTitle === "New Chat" || chatTitle === "Unknown") {
    const autoTitle = userMessage.length <= 60
      ? userMessage
      : userMessage.slice(0, 57).replace(/\s+\S*$/, "") + "...";
    try {
      db.update(schema.chats)
        .set({ title: autoTitle, updatedAt: Date.now() })
        .where(eq(schema.chats.id, chatId))
        .run();
      broadcast({ type: "chat_renamed", payload: { chatId, title: autoTitle } });
    } catch {
      // Non-critical — don't block pipeline
    }
  }

  // --- Auto-resume: check for interrupted pipeline before classifying intent ---
  // Prevents "Continue?" from being classified as a new build request
  const interruptedId = findInterruptedPipelineRun(chatId);
  if (interruptedId) {
    log("orchestrator", `Found interrupted pipeline ${interruptedId} — auto-resuming`);
    abortControllers.delete(chatId);
    return resumeOrchestration({ ...input, pipelineRunId: interruptedId });
  }

  // Collect agent outputs internally — only the final summary is shown to user
  const agentResults = new Map<string, string>();
  const completedAgents: string[] = [];
  const callCounter: CallCounter = { value: 0 };
  const buildFixCounter: BuildFixCounter = { value: 0 };

  // --- Intent classification ---
  const hasFiles = projectHasFiles(projectPath);
  const classification = await classifyIntent(userMessage, hasFiles, providers);
  log("orchestrator", `Intent: ${classification.intent} (scope: ${classification.scope}) — ${classification.reasoning}`);

  // --- Preflight: verify only planned agents can resolve a provider model ---
  {
    const plannedAgents = getPlannedAgents(classification.intent as OrchestratorIntent, classification.scope as IntentScope, hasFiles);
    const preflightErrors = preflightValidatePlan(plannedAgents, providers);
    if (preflightErrors.length > 0) {
      abortControllers.delete(chatId);
      broadcastAgentError(chatId, "orchestrator", `Preflight check failed:\n${preflightErrors.join("\n")}`);
      return;
    }
  }

  // Track classifyIntent token usage
  if (classification.tokenUsage) {
    const providerKey = apiKeys[classification.tokenUsage.provider];
    if (providerKey) {
      const classifyExecId = nanoid();
      await db.insert(schema.agentExecutions).values({
        id: classifyExecId, chatId,
        agentName: "orchestrator:classify",
        status: "completed",
        input: JSON.stringify({ type: "classify", userMessage }),
        output: JSON.stringify(classification),
        error: null, retryCount: 0,
        startedAt: Date.now(), completedAt: Date.now(),
      });
      trackTokenUsage({
        executionId: classifyExecId,
        chatId,
        agentName: "orchestrator:classify",
        provider: classification.tokenUsage.provider,
        model: classification.tokenUsage.model,
        apiKey: providerKey,
        inputTokens: classification.tokenUsage.inputTokens,
        outputTokens: classification.tokenUsage.outputTokens,
        projectId, projectName, chatTitle,
      });
    }
  }

  // --- Question mode: direct answer, no pipeline ---
  if (classification.intent === "question") {
    broadcast({
      type: "pipeline_plan",
      payload: { chatId, agents: [] },
    });

    const answer = await handleQuestion({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, providers, apiKeys,
    });

    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "assistant",
      content: answer,
      agentName: "orchestrator", metadata: null, createdAt: Date.now(),
    });

    broadcast({
      type: "chat_message",
      payload: { chatId, agentName: "orchestrator", content: answer },
    });

    broadcastAgentStatus(chatId, "orchestrator", "completed");
    abortControllers.delete(chatId);
    return;
  }

  // --- Fix mode: tiered pipeline based on scope ---
  // styling/frontend = quick-edit (single agent, no reviewers)
  // backend/full = dev agent(s) + reviewers (no testing agent — finishPipeline runs actual tests)
  if (classification.intent === "fix" && hasFiles) {
    const projectSource = readProjectSource(projectPath);
    if (projectSource) {
      agentResults.set("project-source", projectSource);
    }

    const scope = classification.scope as IntentScope;
    const isQuickEdit = scope === "styling" || scope === "frontend";

    let quickPlan: ExecutionPlan | null = null;
    if (isQuickEdit) {
      const agentName: AgentName = scope === "styling" ? "styling" : "frontend-dev";
      log("orchestrator", `Quick-edit mode (${scope}): routing directly to ${agentName} agent`);
      quickPlan = {
        steps: [{
          agentName,
          input: `Fix the following ${scope === "styling" ? "styling " : ""}issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
        }],
      };
    }

    const plan = quickPlan ?? buildFixPlan(userMessage, scope);

    // Persist pipeline run
    const pipelineRunId = nanoid();
    await db.insert(schema.pipelineRuns).values({
      id: pipelineRunId,
      chatId,
      intent: "fix",
      scope: classification.scope,
      userMessage,
      plannedAgents: JSON.stringify(plan.steps.map((s) => s.agentName)),
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
    });

    // Broadcast pipeline plan so client knows which agents to display
    broadcast({
      type: "pipeline_plan",
      payload: { chatId, agents: plan.steps.map((s) => s.agentName) },
    });

    // Execute fix pipeline
    const pipelineOk = await executePipelineSteps({
      plan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
      providers, apiKeys, signal,
    });
    if (!pipelineOk) {
      const postCheck = checkCostLimit(chatId);
      const pipelineStatus = !postCheck.allowed ? "interrupted" : "failed";
      await db.update(schema.pipelineRuns).set({ status: pipelineStatus, completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
      if (!postCheck.allowed) {
        broadcastAgentStatus(chatId, "orchestrator", "failed");
      } else {
        broadcastAgentError(chatId, "orchestrator", "Pipeline failed — one or more agents encountered errors.");
        broadcastAgentStatus(chatId, "orchestrator", "failed");
      }
      abortControllers.delete(chatId);
      return;
    }

    // Remediation + final build + summary (shared with build mode)
    await finishPipeline({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
      providers, apiKeys, signal,
    });

    await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  // --- Build mode: full pipeline (research → architect → parallel dev → styling → review) ---

  // Phase 1: Run research first so architect gets structured requirements
  log("orchestrator", "Running research agent");
  const researchResult = await runPipelineStep({
    step: {
      agentName: "research",
      input: `Analyze this request and produce structured requirements: ${userMessage}`,
    },
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal,
  });

  if (signal.aborted) {
    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "system",
      content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
      agentName: "orchestrator", metadata: null, createdAt: Date.now(),
    });
    broadcastAgentStatus(chatId, "orchestrator", "stopped");
    abortControllers.delete(chatId);
    return;
  }

  // Phase 2: Run architect with research output available in agentResults
  log("orchestrator", "Running architect agent");
  const architectResult = await runPipelineStep({
    step: {
      agentName: "architect",
      input: `Design the component architecture, design system, and test plan for this request. Use the research agent's structured requirements from Previous Agent Outputs. Original request: ${userMessage}`,
    },
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal,
  });

  if (!architectResult && !researchResult) {
    abortControllers.delete(chatId);
    return;
  }

  if (signal.aborted) {
    await db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "system",
      content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
      agentName: "orchestrator", metadata: null, createdAt: Date.now(),
    });
    broadcastAgentStatus(chatId, "orchestrator", "stopped");
    abortControllers.delete(chatId);
    return;
  }

  // If architect failed but research succeeded, we can still try the fallback single-dev pipeline
  if (!architectResult) {
    log("orchestrator", "Architect failed but research succeeded — using fallback pipeline");
  }

  // Phase 3: Build single frontend-dev pipeline (research + architect already completed)
  const researchOutput = agentResults.get("research") || "";

  log("orchestrator", "Building single frontend-dev pipeline");
  const plan = buildExecutionPlan(userMessage, researchOutput, "build", classification.scope);
  // Remove architect step since it already ran
  plan.steps = plan.steps.filter((s) => s.agentName !== "architect");
  // Rewrite deps that pointed to "architect" to point to nothing (already completed)
  for (const step of plan.steps) {
    if (step.dependsOn) {
      step.dependsOn = step.dependsOn.filter((d) => d !== "architect");
    }
  }

  // Persist pipeline run
  const pipelineRunId = nanoid();
  const allStepIds = plan.steps.map((s) => s.instanceId ?? s.agentName);
  await db.insert(schema.pipelineRuns).values({
    id: pipelineRunId,
    chatId,
    intent: "build",
    scope: classification.scope,
    userMessage,
    plannedAgents: JSON.stringify(["research", "architect", ...allStepIds]),
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
  });

  broadcast({
    type: "pipeline_plan",
    payload: { chatId, agents: ["research", "architect", ...allStepIds] },
  });

  // Execute build pipeline (research + architect already completed)
  const pipelineOk = await executePipelineSteps({
    plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal,
  });
  if (!pipelineOk) {
    const postCheck = checkCostLimit(chatId);
    const pipelineStatus = !postCheck.allowed ? "interrupted" : "failed";
    await db.update(schema.pipelineRuns).set({ status: pipelineStatus, completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  // Remediation + final build + summary
  await finishPipeline({
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal,
  });

  await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  abortControllers.delete(chatId);
}

/**
 * Resume a previously interrupted pipeline from the last completed step.
 * Reconstructs agentResults from DB, filters the execution plan to skip
 * completed agents, then continues from where it left off.
 */
export async function resumeOrchestration(input: OrchestratorInput & { pipelineRunId: string }): Promise<void> {
  const { chatId, projectId, projectPath, userMessage, providers, apiKeys, pipelineRunId } = input;

  // Load the pipeline run
  const pipelineRun = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, pipelineRunId)).get();
  if (!pipelineRun) {
    broadcastAgentError(chatId, "orchestrator", "Pipeline run not found — starting fresh.");
    return runOrchestration(input);
  }

  const controller = new AbortController();
  abortControllers.set(chatId, controller);
  const { signal } = controller;

  // Check cost limits — if still over limit after resume, abort with clear message
  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
    log("orchestrator", `Resume blocked: cost limit (${costCheck.currentTokens}/${costCheck.limit})`);
    abortControllers.delete(chatId);
    broadcast({
      type: "agent_error",
      payload: {
        chatId,
        agentName: "orchestrator",
        error: `Token limit still exceeded (${costCheck.currentTokens}/${costCheck.limit}). Increase your limit in Settings before resuming.`,
        errorType: "cost_limit",
      },
    });
    return;
  }

  // Load project name and chat title
  const projectRow = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  const chatRow = await db.select({ title: schema.chats.title }).from(schema.chats).where(eq(schema.chats.id, chatId)).get();
  const projectName = projectRow?.name || "Unknown";
  const chatTitle = chatRow?.title || "Unknown";

  // Load chat history
  const chatMessages = await db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all();
  const chatHistory = chatMessages.map((m) => ({ role: m.role, content: m.content }));

  // Reconstruct agentResults from completed executions
  const agentResults = new Map<string, string>();
  const completedAgents: string[] = [];
  const callCounter: CallCounter = { value: 0 };
  const buildFixCounter: BuildFixCounter = { value: 0 };

  const completedExecs = await db.select()
    .from(schema.agentExecutions)
    .where(and(eq(schema.agentExecutions.chatId, chatId), eq(schema.agentExecutions.status, "completed")))
    .all();

  for (const exec of completedExecs) {
    if (exec.output) {
      try {
        const parsed = JSON.parse(exec.output);
        if (parsed.content) {
          agentResults.set(exec.agentName, parsed.content);
          completedAgents.push(exec.agentName);
        }
      } catch {
        // skip unparseable
      }
    }
  }

  const intent = pipelineRun.intent as OrchestratorIntent;
  const scope = pipelineRun.scope as IntentScope;
  const originalMessage = pipelineRun.userMessage;

  broadcastAgentStatus(chatId, "orchestrator", "running");

  // Mark pipeline as running again
  await db.update(schema.pipelineRuns).set({ status: "running" }).where(eq(schema.pipelineRuns.id, pipelineRunId));

  // For fix mode, inject project source if not already in results
  if (intent === "fix" && !agentResults.has("project-source")) {
    const projectSource = readProjectSource(projectPath);
    if (projectSource) agentResults.set("project-source", projectSource);
  }

  // Rebuild execution plan
  const researchOutput = agentResults.get("research") || "";

  // For build mode, if research hasn't completed, we can't resume — start fresh
  if (intent === "build" && !agentResults.has("research")) {
    log("orchestrator", "Research not completed — cannot resume, starting fresh");
    await db.update(schema.pipelineRuns).set({ status: "failed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return runOrchestration(input);
  }

  let plan: ExecutionPlan;
  if (intent === "fix") {
    if (scope === "styling" || scope === "frontend") {
      const agentName: AgentName = scope === "styling" ? "styling" : "frontend-dev";
      plan = {
        steps: [{
          agentName,
          input: `Fix the following ${scope === "styling" ? "styling " : ""}issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${originalMessage}`,
        }],
      };
    } else {
      plan = buildFixPlan(originalMessage, scope);
    }
  } else {
    // Build mode: single frontend-dev pipeline
    plan = buildExecutionPlan(originalMessage, researchOutput, "build", scope);
    // Remove architect step since it already ran
    plan.steps = plan.steps.filter((s) => s.agentName !== "architect");
    for (const step of plan.steps) {
      if (step.dependsOn) step.dependsOn = step.dependsOn.filter((d) => d !== "architect");
    }
  }

  // Filter plan to only remaining steps
  const completedAgentNames = new Set(completedAgents);
  const remainingSteps = plan.steps.filter((s) => !completedAgentNames.has(s.agentName));

  if (remainingSteps.length === 0) {
    // All agents completed — just run finish pipeline
    log("orchestrator", "All agents already completed — running finish pipeline");
  } else {
    // Broadcast pipeline plan showing all agents (completed + remaining)
    const allStepIds = plan.steps.map((s) => s.instanceId ?? s.agentName);
    const allAgentNames = intent === "build"
      ? ["research", "architect", ...allStepIds]
      : allStepIds;
    broadcast({ type: "pipeline_plan", payload: { chatId, agents: allAgentNames } });

    // Broadcast completed status for already-done agents
    for (const name of completedAgents) {
      broadcastAgentStatus(chatId, name, "completed");
    }

    // Execute remaining steps
    const remainingPlan: ExecutionPlan = { steps: remainingSteps };
    const pipelineOk = await executePipelineSteps({
      plan: remainingPlan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage: originalMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
      providers, apiKeys, signal,
    });
    if (!pipelineOk) {
      await db.update(schema.pipelineRuns).set({ status: "failed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
      broadcastAgentError(chatId, "orchestrator", "Pipeline failed — one or more agents encountered errors.");
      broadcastAgentStatus(chatId, "orchestrator", "failed");
      abortControllers.delete(chatId);
      return;
    }
  }

  // Remediation + final build + summary
  await finishPipeline({
    chatId, projectId, projectPath, projectName, chatTitle,
    userMessage: originalMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal,
  });

  await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
  abortControllers.delete(chatId);
}

/**
 * Find the most recent interrupted pipeline run for a chat.
 * Returns the pipeline run ID, or null if none found.
 */
export function findInterruptedPipelineRun(chatId: string): string | null {
  const row = db.select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(and(eq(schema.pipelineRuns.chatId, chatId), eq(schema.pipelineRuns.status, "interrupted")))
    .orderBy(desc(schema.pipelineRuns.startedAt))
    .get();
  return row?.id || null;
}

/**
 * Execute pipeline steps with dependency-aware parallelism.
 * Steps whose `dependsOn` are all in the completed set run concurrently as a batch.
 * Halts on first failure. Checks cost limit after each batch.
 */
async function executePipelineSteps(ctx: {
  plan: ExecutionPlan;
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  buildFixCounter: BuildFixCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<boolean> {
  const { plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal } = ctx;

  const completedSet = new Set<string>(
    agentResults.keys()
  );
  const remaining = [...plan.steps];

  // Log plan structure for parallel execution diagnosis
  log("orchestrator", `executePipelineSteps: ${remaining.length} steps, completedSet: [${[...completedSet].join(", ")}]`);
  for (const s of remaining) {
    log("orchestrator", `  step: ${s.instanceId ?? s.agentName} (agent=${s.agentName}) dependsOn=[${(s.dependsOn || []).join(", ")}]`);
  }

  while (remaining.length > 0) {
    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
      return false;
    }

    // Find steps whose dependencies are all satisfied
    const ready: typeof remaining = [];
    const notReady: typeof remaining = [];
    for (const step of remaining) {
      const deps = step.dependsOn || [];
      if (deps.every((d) => completedSet.has(d))) {
        ready.push(step);
      } else {
        notReady.push(step);
      }
    }

    if (ready.length === 0) {
      // Deadlock — remaining steps have unmet deps that will never resolve
      log("orchestrator", `Pipeline deadlock: ${remaining.map((s) => s.instanceId ?? s.agentName).join(", ")} have unmet deps. completedSet=[${[...completedSet].join(", ")}]`);
      broadcastAgentError(chatId, "orchestrator", `Pipeline deadlock: ${remaining.map((s) => s.instanceId ?? s.agentName).join(", ")} have unmet dependencies`);
      return false;
    }

    // For parallel batches (size > 1), skip per-agent build checks — run one after the batch
    const isParallelBatch = ready.length > 1;
    const readyNames = ready.map((s) => s.instanceId ?? s.agentName);
    log("orchestrator", `Running batch of ${ready.length} step(s): ${readyNames.join(", ")}${isParallelBatch ? " [PARALLEL]" : ""}`);

    // Stagger parallel launches to avoid API rate-limit bursts
    const STAGGER_MS = 1000;
    const results = await Promise.all(
      ready.map((step, i) =>
        new Promise<{ stepKey: string; result: string | null }>((resolve) =>
          setTimeout(async () => {
            const result = await runPipelineStep({
              step, chatId, projectId, projectPath, projectName, chatTitle,
              userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
              providers, apiKeys, signal,
              skipPostProcessing: isParallelBatch,
            });
            resolve({ stepKey: step.instanceId ?? step.agentName, result });
          }, i * STAGGER_MS)
        )
      )
    );

    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
      return false;
    }

    // Check for failures
    const failed = results.find((r) => r.result === null);
    if (failed) {
      log("orchestrator", `Pipeline halted: agent ${failed.stepKey} failed`);
      return false; // HALT — runPipelineStep already handled error broadcasting
    }

    // Mark completed
    for (const r of results) {
      completedSet.add(r.stepKey);
    }

    // Consolidated build check after parallel batch — only if file-writing agents were in the batch
    if (isParallelBatch && !signal.aborted) {
      const hasFileAgents = ready.some((s) => agentHasFileTools(s.agentName));
      if (hasFileAgents) {
        log("orchestrator", `Running consolidated build check after parallel batch (file-writing agents present)`);
        broadcastAgentThinking(chatId, "orchestrator", "Build System", "started");
        broadcastAgentThinking(chatId, "orchestrator", "Build System", "streaming", { chunk: "Checking build..." });
        const buildErrors = await checkProjectBuild(projectPath);
        if (buildErrors && !signal.aborted) {
          broadcastAgentThinking(chatId, "orchestrator", "Build System", "streaming", { chunk: "Build errors found — attempting fix..." });
          const fixResult = await runBuildFix({
            buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
            userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal,
          });
          if (fixResult) {
            agentResults.set("parallel-batch-build-fix", fixResult);
            completedAgents.push("parallel batch (build fix)");
          }
          const recheckErrors = await checkProjectBuild(projectPath);
          if (!recheckErrors) {
            broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed", { summary: "Build passed" });
            broadcast({ type: "preview_ready", payload: { projectId } });
          } else {
            broadcastAgentThinking(chatId, "orchestrator", "Build System", "failed");
          }
        } else if (!buildErrors) {
          broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed", { summary: "Build passed" });
          broadcast({ type: "preview_ready", payload: { projectId } });
        } else {
          broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed");
          broadcast({ type: "preview_ready", payload: { projectId } });
        }
      }
    }

    // Cost check after each batch — per-chat, daily, and project limits
    const midCheck = checkCostLimit(chatId);
    const midDailyCheck = checkDailyCostLimit();
    const midProjectCheck = checkProjectCostLimit(projectId);

    const costExceeded = !midCheck.allowed || !midDailyCheck.allowed || !midProjectCheck.allowed;
    if (costExceeded) {
      const reason = !midCheck.allowed
        ? `Token limit reached (${midCheck.currentTokens.toLocaleString()}/${midCheck.limit.toLocaleString()})`
        : !midDailyCheck.allowed
        ? `Daily cost limit reached ($${midDailyCheck.currentCost.toFixed(2)}/$${midDailyCheck.limit.toFixed(2)})`
        : `Project cost limit reached ($${midProjectCheck.currentCost.toFixed(2)}/$${midProjectCheck.limit.toFixed(2)})`;

      log("orchestrator", `Pipeline interrupted: ${reason} after batch: ${readyNames.join(", ")}`);
      broadcastAgentStatus(chatId, "orchestrator", "paused");
      broadcast({
        type: "agent_error",
        payload: {
          chatId,
          agentName: "orchestrator",
          error: `${reason}. Completed through batch: ${readyNames.join(", ")}.`,
          errorType: "cost_limit",
        },
      });
      broadcast({
        type: "pipeline_interrupted",
        payload: {
          chatId,
          reason: "cost_limit",
          completedAgents: [...completedSet],
          skippedAgents: notReady.map((s) => s.instanceId ?? s.agentName),
          tokens: { current: midCheck.currentTokens, limit: midCheck.limit },
        },
      });
      return false;
    }

    // Continue with remaining steps
    remaining.length = 0;
    remaining.push(...notReady);
  }

  return true;
}

/**
 * Shared pipeline finish: remediation loop, final build check, summary generation.
 * Used by both build and fix modes.
 */
async function finishPipeline(ctx: {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  buildFixCounter: BuildFixCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<void> {
  const { chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal } = ctx;

  // Remediation loop
  if (!signal.aborted) {
    await runRemediationLoop({
      chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter,
      providers, apiKeys, signal,
    });
  }

  // Final build check
  if (!signal.aborted) {
    const finalBuildErrors = await checkProjectBuild(projectPath);
    if (finalBuildErrors && !signal.aborted) {
      const fixResult = await runBuildFix({
        buildErrors: finalBuildErrors, chatId, projectId, projectPath, projectName, chatTitle,
        userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal,
      });
      if (fixResult) {
        agentResults.set("final-build-fix", fixResult);
        completedAgents.push("frontend-dev (final build fix)");
      }
      const finalRecheck = await checkProjectBuild(projectPath);
      if (!finalRecheck) {
        broadcast({ type: "preview_ready", payload: { projectId } });
      }
    } else {
      broadcast({ type: "preview_ready", payload: { projectId } });
    }
  }

  // Generate summary
  const summary = await generateSummary({
    userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys,
  });

  await db.insert(schema.messages).values({
    id: nanoid(), chatId, role: "assistant",
    content: summary,
    agentName: "orchestrator", metadata: null, createdAt: Date.now(),
  });

  broadcast({
    type: "chat_message",
    payload: { chatId, agentName: "orchestrator", content: summary },
  });

  broadcastAgentStatus(chatId, "orchestrator", "completed");
}

const QUESTION_SYSTEM_PROMPT = `You are a helpful assistant for a React + TypeScript + Tailwind CSS page builder.
Answer the user's question based on the project source code provided.
Keep answers to 2-3 short paragraphs max. Be direct — answer the question, don't restate it.
If the project has no files yet, say so in one sentence and suggest they describe what they'd like to build.`;

/**
 * Handle a "question" intent by answering directly with the orchestrator model.
 * No agent pipeline — just one Opus call with project context.
 */
async function handleQuestion(ctx: {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}): Promise<string> {
  const { chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, providers, apiKeys } = ctx;

  const questionConfig = getAgentConfigResolved("orchestrator:question");
  if (!questionConfig) return "I couldn't process your question. Please try again.";
  const questionModel = resolveProviderModel(questionConfig, providers);
  if (!questionModel) return "No model available to answer questions. Please check your API keys.";

  const projectSource = readProjectSource(projectPath);

  // Detect incomplete pipeline: if App.tsx is missing and pipeline was interrupted,
  // make sure the LLM doesn't say "everything looks complete"
  let pipelineWarning = "";
  const interruptedPipeline = findInterruptedPipelineRun(chatId);
  if (interruptedPipeline) {
    const hasAppTsx = existsSync(join(projectPath, "src", "App.tsx"));
    if (!hasAppTsx) {
      pipelineWarning = "\n\nIMPORTANT: The previous build pipeline was interrupted before completion. The project is missing its root App.tsx and has not been styled or reviewed. Do NOT say the project is complete. Inform the user the pipeline needs to be resumed.\n";
    }
  }

  const prompt = projectSource
    ? `## Project Source\n${projectSource}${pipelineWarning}\n\n## Question\n${userMessage}`
    : `## Question\n${userMessage}\n\n(This project has no files yet.)`;

  try {
    logLLMInput("orchestrator", "orchestrator-question", QUESTION_SYSTEM_PROMPT, prompt);
    const result = await generateText({
      model: questionModel,
      system: QUESTION_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 2048,
    });
    logLLMOutput("orchestrator", "orchestrator-question", result.text);

    // Track token usage
    if (result.usage) {
      const providerKey = apiKeys[questionConfig.provider];
      if (providerKey) {
        const execId = nanoid();
        db.insert(schema.agentExecutions).values({
          id: execId, chatId,
          agentName: "orchestrator:question",
          status: "completed",
          input: JSON.stringify({ type: "question", userMessage }),
          output: JSON.stringify({ answer: result.text }),
          error: null, retryCount: 0,
          startedAt: Date.now(), completedAt: Date.now(),
        }).run();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qAnthropicMeta = (result as any)?.providerMetadata?.anthropic;
        const cacheCreation = Number(qAnthropicMeta?.cacheCreationInputTokens ?? qAnthropicMeta?.cache_creation_input_tokens) || 0;
        const cacheRead = Number(qAnthropicMeta?.cacheReadInputTokens ?? qAnthropicMeta?.cache_read_input_tokens) || 0;

        // SDK inputTokens includes cache tokens — subtract to get non-cached count
        const qRawInput = result.usage.inputTokens || 0;
        const qInputTokens = Math.max(0, qRawInput - cacheCreation - cacheRead);

        const record = trackTokenUsage({
          executionId: execId, chatId,
          agentName: "orchestrator:question",
          provider: questionConfig.provider,
          model: questionConfig.model,
          apiKey: providerKey,
          inputTokens: qInputTokens,
          outputTokens: result.usage.outputTokens || 0,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
          projectId, projectName, chatTitle,
        });

        broadcastTokenUsage({
          chatId, projectId,
          agentName: "orchestrator:question",
          provider: questionConfig.provider,
          model: questionConfig.model,
          inputTokens: qInputTokens,
          outputTokens: result.usage.outputTokens || 0,
          totalTokens: qRawInput + (result.usage.outputTokens || 0),
          costEstimate: record.costEstimate,
        });

        log("orchestrator:question", "answered", {
          model: questionConfig.model,
          promptChars: prompt.length,
          tokens: { input: result.usage.inputTokens || 0, output: result.usage.outputTokens || 0, cacheCreate: cacheCreation, cacheRead },
        });
      }
    }
    logBlock("orchestrator:question", "response", result.text);

    return result.text;
  } catch (err) {
    logError("orchestrator", "Question handling failed", err);
    return "I encountered an error processing your question. Please try again.";
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are the orchestrator for a page builder. Present the finished result to the user.
Write a clean, confident, conversational markdown response. Include:
- What was built (brief overview of the working product)
- Key files created or modified
- How to use it or interact with it
Keep it concise — 2-5 short paragraphs max. Use headings, bullet points, and code references where helpful.

IMPORTANT rules:
- Present the work as DONE, not as a draft with open issues.
- Do NOT expose internal QA findings, security scan details, or agent-level diagnostics to the user.
- Do NOT list "Suggested Next Steps" or "Issues Found" — the agents already handled those internally.
- Do NOT include raw JSON, tool calls, or internal agent data.
- If QA or security flagged minor issues, silently note them as areas for future improvement at most — never as a prominent section.
- EXCEPTION: If security found CRITICAL vulnerabilities (XSS, injection, credential exposure), you MUST mention them briefly: "Before publishing, you'll want to address [brief description]." Do not hide critical security issues.
- The tone should be: "Here's what we built for you" — not "Here's a report of what went wrong."

Example of a great summary:
---
## Your landing page is ready!

Here's what we built:
- **Hero section** with headline, subtext, and a signup CTA button
- **Features grid** showcasing 6 product highlights with icons
- **Contact form** with email validation and success confirmation
- **Responsive design** — looks great on mobile, tablet, and desktop

Key files: \`src/components/Hero.tsx\`, \`src/components/Features.tsx\`, \`src/components/ContactForm.tsx\`, \`src/App.tsx\`

Try clicking the signup button or submitting the contact form to see it in action!
---`;

interface SummaryInput {
  userMessage: string;
  agentResults: Map<string, string>;
  chatId: string;
  projectId: string;
  projectName: string;
  chatTitle: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
}

async function generateSummary(input: SummaryInput): Promise<string> {
  const { userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys } = input;

  const fallback = () => Array.from(agentResults.entries())
    .map(([agent, output]) => `**${agent}:** ${output}`)
    .join("\n\n");

  const summaryConfig = getAgentConfigResolved("orchestrator:summary");
  if (!summaryConfig) return fallback();
  const summaryModel = resolveProviderModel(summaryConfig, providers);
  if (!summaryModel) return fallback();

  // Truncate each agent's output to 500 chars — summary only needs high-level view
  const digest = Array.from(agentResults.entries())
    .map(([agent, output]) => {
      const truncated = output.length > 500 ? output.slice(0, 500) + "\n... (truncated)" : output;
      return `### ${agent}\n${truncated}`;
    })
    .join("\n\n");

  const prompt = `## User Request\n${userMessage}\n\n## Agent Outputs\n${digest}`;

  logLLMInput("orchestrator", "orchestrator-summary", SUMMARY_SYSTEM_PROMPT, prompt);
  const result = await generateText({
    model: summaryModel,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 1024,
  });
  logLLMOutput("orchestrator", "orchestrator-summary", result.text);

  // Track token usage for the summary call
  if (result.usage) {
    const providerKey = apiKeys[summaryConfig.provider];
    if (providerKey) {
      const sRawInput = result.usage.inputTokens || 0;
      const outputTokens = result.usage.outputTokens || 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sAnthropicMeta = (result as any)?.providerMetadata?.anthropic;
      const summaryCacheCreation = Number(sAnthropicMeta?.cacheCreationInputTokens ?? sAnthropicMeta?.cache_creation_input_tokens) || 0;
      const summaryCacheRead = Number(sAnthropicMeta?.cacheReadInputTokens ?? sAnthropicMeta?.cache_read_input_tokens) || 0;
      // SDK inputTokens includes cache tokens — subtract to get non-cached count
      const inputTokens = Math.max(0, sRawInput - summaryCacheCreation - summaryCacheRead);

      const summaryExecId = nanoid();
      db.insert(schema.agentExecutions).values({
        id: summaryExecId, chatId,
        agentName: "orchestrator:summary",
        status: "completed",
        input: JSON.stringify({ type: "summary", userMessage }),
        output: JSON.stringify({ summary: result.text }),
        error: null, retryCount: 0,
        startedAt: Date.now(), completedAt: Date.now(),
      }).run();

      const record = trackTokenUsage({
        executionId: summaryExecId, chatId,
        agentName: "orchestrator:summary",
        provider: summaryConfig.provider,
        model: summaryConfig.model,
        apiKey: providerKey,
        inputTokens, outputTokens,
        cacheCreationInputTokens: summaryCacheCreation,
        cacheReadInputTokens: summaryCacheRead,
        projectId, projectName, chatTitle,
      });

      broadcastTokenUsage({
        chatId, projectId,
        agentName: "orchestrator:summary",
        provider: summaryConfig.provider,
        model: summaryConfig.model,
        inputTokens, outputTokens,
        totalTokens: sRawInput + outputTokens,
        costEstimate: record.costEstimate,
      });

      log("orchestrator:summary", "generated", {
        model: summaryConfig.model,
        promptChars: prompt.length,
        tokens: { input: inputTokens, output: outputTokens, cacheCreate: summaryCacheCreation, cacheRead: summaryCacheRead },
      });
    }
  }
  logBlock("orchestrator:summary", "response", result.text);

  return result.text;
}

export interface ReviewFindings {
  hasIssues: boolean;
  codeReviewFindings: string | null;
  qaFindings: string | null;
  securityFindings: string | null;
  routingHints: {
    frontendIssues: boolean;
    backendIssues: boolean;
    stylingIssues: boolean;
  };
}

/** Fail signals that indicate a review agent found real issues. */
const FAIL_SIGNALS = [
  '"status": "fail"',
  '"status":"fail"',
  "[FAIL]",
  "critical issue",
  "must fix",
  "must be fixed",
  "needs to be fixed",
  "severity: critical",
  "severity: high",
  '"severity": "critical"',
  '"severity": "high"',
];

/** Check if review output contains explicit failure indicators. */
export function outputHasFailSignals(output: string): boolean {
  if (!output || output.trim() === "") return false;
  const lower = output.toLowerCase();
  return FAIL_SIGNALS.some((signal) => lower.includes(signal.toLowerCase()));
}

export function detectIssues(agentResults: Map<string, string>): ReviewFindings {
  const codeReviewOutput = agentResults.get("code-review") || "";
  const qaOutput = agentResults.get("qa") || "";
  const securityOutput = agentResults.get("security") || "";

  // Inverted logic: treat output as clean UNLESS it contains explicit fail signals.
  // This is far more robust — LLMs vary in how they say "pass" but are consistent about flagging problems.
  const codeReviewClean = !outputHasFailSignals(codeReviewOutput);
  const qaClean = !outputHasFailSignals(qaOutput);
  const securityClean = !outputHasFailSignals(securityOutput);

  // Parse routing hints from code-review and QA findings
  const allFindings = codeReviewOutput + "\n" + qaOutput;
  const routingHints = {
    frontendIssues: /\[frontend\]/i.test(allFindings),
    backendIssues: /\[backend\]/i.test(allFindings),
    stylingIssues: /\[styling\]/i.test(allFindings),
  };

  return {
    hasIssues: !codeReviewClean || !qaClean || !securityClean,
    codeReviewFindings: codeReviewClean ? null : codeReviewOutput,
    qaFindings: qaClean ? null : qaOutput,
    securityFindings: securityClean ? null : securityOutput,
    routingHints,
  };
}

/**
 * Determine which dev agents should fix the identified issues.
 * Routes based on [frontend]/[backend]/[styling] tags from code-review and QA findings.
 * Defaults to frontend-dev when no clear routing (backward compatible).
 */
export function determineFixAgents(findings: ReviewFindings): AgentName[] {
  const agents: AgentName[] = [];
  const { routingHints } = findings;

  if (routingHints.frontendIssues) agents.push("frontend-dev");
  if (routingHints.backendIssues) agents.push("backend-dev");
  if (routingHints.stylingIssues) agents.push("styling");

  // Default to frontend-dev if no clear routing
  if (agents.length === 0) agents.push("frontend-dev");

  return agents;
}

/**
 * Determine which agent should fix build errors based on error content.
 * Routes to backend-dev if errors reference server files, otherwise frontend-dev.
 */
export function determineBuildFixAgent(buildErrors: string): AgentName {
  if (/server\/|api\/|backend\/|\.server\.|routes\//i.test(buildErrors)) {
    return "backend-dev";
  }
  return "frontend-dev";
}

// --- Remediation loop helpers ---

interface RemediationContext {
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  completedAgents: string[];
  callCounter: CallCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}

const MAX_REMEDIATION_CYCLES = 2;

/**
 * Iterative remediation loop: detects code-review/QA/security issues,
 * routes fixes to the correct dev agent(s) based on finding categories,
 * then re-runs code-review, security, and QA to verify. Repeats up to
 * MAX_REMEDIATION_CYCLES times or until all issues are resolved.
 */
async function runRemediationLoop(ctx: RemediationContext): Promise<void> {
  let previousIssueCount = Infinity;

  for (let cycle = 0; cycle < MAX_REMEDIATION_CYCLES; cycle++) {
    if (ctx.signal.aborted) return;

    // 1. Check for issues in current code-review/QA/security output
    const findings = detectIssues(ctx.agentResults);
    if (!findings.hasIssues) return; // All clean — exit loop

    // Count current issues — break if not improving (prevents ping-pong loops)
    const currentIssueCount =
      (findings.codeReviewFindings ? 1 : 0) +
      (findings.qaFindings ? 1 : 0) +
      (findings.securityFindings ? 1 : 0);
    if (currentIssueCount >= previousIssueCount) {
      log("orchestrator", `Remediation not improving (${currentIssueCount} >= ${previousIssueCount}). Breaking loop.`);
      return;
    }
    previousIssueCount = currentIssueCount;

    // 2. Check cost limit before each cycle
    const costCheck = checkCostLimit(ctx.chatId);
    if (!costCheck.allowed) return;

    const cycleLabel = cycle + 1;

    // 3. Determine which agent(s) should fix the findings
    const fixAgents = determineFixAgents(findings);

    // 4. Run each fix agent
    let totalFilesWritten = 0;
    for (const fixAgentName of fixAgents) {
      if (ctx.signal.aborted) return;

      const fixResult = await runFixAgent(fixAgentName, cycleLabel, findings, ctx);
      if (!fixResult) return; // Fix agent failed — can't continue
      totalFilesWritten += fixResult.filesWritten;
    }

    if (ctx.signal.aborted) return;

    // Skip re-review if fix agents wrote 0 files — no point re-reviewing unchanged code
    if (totalFilesWritten === 0) {
      log("orchestrator", `Remediation cycle ${cycleLabel}: fix agents wrote 0 files — skipping re-review`);
      return;
    }

    // 5. Only re-run the review agents that had issues (not all three)
    const reviewsToRerun: Array<"code-review" | "security" | "qa"> = [];
    if (findings.codeReviewFindings) reviewsToRerun.push("code-review");
    if (findings.securityFindings) reviewsToRerun.push("security");
    if (findings.qaFindings) reviewsToRerun.push("qa");

    if (reviewsToRerun.length > 0) {
      const reviewResults = await Promise.all(
        reviewsToRerun.map((agent) => runReviewAgent(agent, cycleLabel, ctx)),
      );
      if (reviewResults.some((r) => !r) || ctx.signal.aborted) return;
    }

    // Loop continues — detectIssues() at top checks the fresh output
  }
}

/**
 * Run a dev agent to fix remediation findings.
 * Returns the agent's output content and files-written count, or null on failure.
 */
async function runFixAgent(
  agentName: AgentName,
  cycle: number,
  findings: ReviewFindings,
  ctx: RemediationContext,
): Promise<{ content: string; filesWritten: number } | null> {
  const maxCallsRem = getMaxAgentCalls();
  if (ctx.callCounter.value >= maxCallsRem) {
    broadcastAgentError(ctx.chatId, "orchestrator", `Agent call limit reached (${maxCallsRem}). Stopping remediation.`);
    return null;
  }
  ctx.callCounter.value++;

  const config = getAgentConfigResolved(agentName);
  if (!config) return null;

  const displayConfig = {
    ...config,
    displayName: `${config.displayName} (remediation${cycle > 1 ? ` #${cycle}` : ""})`,
  };

  broadcastAgentStatus(ctx.chatId, agentName, "running", { phase: "remediation", cycle });

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId: ctx.chatId,
    agentName,
    status: "running",
    input: JSON.stringify({ phase: "remediation", cycle }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const parts: string[] = [];
  parts.push(`Fix the following issues found during review of: ${ctx.userMessage}`);
  if (findings.codeReviewFindings) parts.push(`\n## Code Review Findings\n${findings.codeReviewFindings}`);
  if (findings.qaFindings) parts.push(`\n## QA Findings\n${findings.qaFindings}`);
  if (findings.securityFindings) parts.push(`\n## Security Findings\n${findings.securityFindings}`);
  parts.push(`\nReview the original code in Previous Agent Outputs and output corrected versions of any files with issues.`);
  parts.push(`\nIMPORTANT: Only reference and modify files that exist in Previous Agent Outputs. Do not create new files unless necessary to fix the issue.`);

  try {
    const agentInput: AgentInput = {
      userMessage: parts.join("\n"),
      chatHistory: ctx.chatHistory,
      projectPath: ctx.projectPath,
      context: {
        projectId: ctx.projectId,
        originalRequest: ctx.userMessage,
        upstreamOutputs: filterUpstreamOutputs(agentName, undefined, ctx.agentResults, "remediation", ctx.projectPath),
        phase: "remediation",
        cycle,
      },
    };

    // Apply same tool subset filtering as normal step execution (Fix C)
    const enabledRemTools = getAgentTools(agentName);
    let remediationToolSubset: ReturnType<typeof createAgentTools>["tools"] | undefined;
    if (enabledRemTools.length > 0) {
      const allRemTools = createAgentTools(ctx.projectPath, ctx.projectId);
      remediationToolSubset = Object.fromEntries(
        enabledRemTools
          .filter((t) => t in allRemTools.tools)
          .map((t) => [t, allRemTools.tools[t as keyof typeof allRemTools.tools]])
      ) as typeof allRemTools.tools;
    }

    // Write-ahead: provisional tracking before LLM call
    const remProviderKey = ctx.apiKeys[config.provider];
    let remProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;
    if (remProviderKey) {
      const upstreamSize = Object.values(agentInput.context?.upstreamOutputs as Record<string, string> || {}).reduce((s, v) => s + v.length, 0);
      remProvisionalIds = trackProvisionalUsage({
        executionId, chatId: ctx.chatId, agentName,
        provider: config.provider, model: config.model, apiKey: remProviderKey,
        estimatedInputTokens: Math.ceil((agentInput.userMessage.length + upstreamSize) / 4),
        projectId: ctx.projectId, projectName: ctx.projectName, chatTitle: ctx.chatTitle,
      });
    }

    const result = await runAgent(displayConfig, ctx.providers, agentInput, remediationToolSubset, ctx.signal, ctx.chatId, undefined, {
      maxOutputTokens: BUILD_FIX_MAX_OUTPUT_TOKENS,
      maxToolSteps: BUILD_FIX_MAX_TOOL_STEPS,
    });

    if (result.tokenUsage && remProviderKey && remProvisionalIds) {
      finalizeTokenUsage(remProvisionalIds, {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
      }, config.provider, config.model);

      const totalTokens = result.tokenUsage.inputTokens + result.tokenUsage.outputTokens
        + (result.tokenUsage.cacheCreationInputTokens || 0) + (result.tokenUsage.cacheReadInputTokens || 0);
      const costEst = estimateCost(
        config.provider, config.model,
        result.tokenUsage.inputTokens, result.tokenUsage.outputTokens,
        result.tokenUsage.cacheCreationInputTokens || 0, result.tokenUsage.cacheReadInputTokens || 0,
      );
      broadcastTokenUsage({
        chatId: ctx.chatId, projectId: ctx.projectId, agentName,
        provider: config.provider, model: config.model,
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        totalTokens, costEstimate: costEst,
      });
    }

    await db.update(schema.agentExecutions)
      .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));

    ctx.agentResults.set(`${agentName}-remediation`, result.content);
    ctx.completedAgents.push(`${agentName} (remediation #${cycle})`);

    // Extract and write remediated files (hybrid: native + fallback)
    const nativeRemediation = result.filesWritten || [];
    const fallbackRemediation = extractAndWriteFiles(agentName, result.content, ctx.projectPath, ctx.projectId, new Set(nativeRemediation));
    const totalFiles = nativeRemediation.length + fallbackRemediation.length;

    return { content: result.content, filesWritten: totalFiles };
  } catch (err) {
    if (!ctx.signal.aborted) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.agentExecutions)
        .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, executionId));
      broadcastAgentError(ctx.chatId, agentName, `Remediation failed: ${errorMsg}`);
    }
    return null;
  }
}

/**
 * Re-run a review agent (code-review, QA, or Security) on updated code after remediation.
 * Overwrites the agent's entry in agentResults so detectIssues() checks fresh output.
 */
async function runReviewAgent(
  agentName: "code-review" | "qa" | "security",
  cycle: number,
  ctx: RemediationContext,
): Promise<string | null> {
  const maxCallsReview = getMaxAgentCalls();
  if (ctx.callCounter.value >= maxCallsReview) {
    broadcastAgentError(ctx.chatId, "orchestrator", `Agent call limit reached (${maxCallsReview}). Stopping re-review.`);
    return null;
  }
  ctx.callCounter.value++;

  const config = getAgentConfigResolved(agentName);
  if (!config) return null;

  const costCheck = checkCostLimit(ctx.chatId);
  if (!costCheck.allowed) return null;

  const displayConfig = { ...config, displayName: `${config.displayName} (re-review #${cycle})` };

  broadcastAgentStatus(ctx.chatId, agentName, "running", { phase: "re-review", cycle });

  const executionId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: executionId,
    chatId: ctx.chatId,
    agentName,
    status: "running",
    input: JSON.stringify({ phase: "re-review", cycle }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const reviewPrompts: Record<string, string> = {
    "code-review": `Re-review all code after remediation cycle #${cycle}. Dev agents have attempted to fix the issues you previously identified. Check if the fixes are correct and report any remaining issues. Original request: ${ctx.userMessage}`,
    qa: `Re-validate the implementation after remediation cycle #${cycle}. Dev agents have attempted to fix the issues you previously identified. Check if requirements are now met and report any remaining gaps. Original request: ${ctx.userMessage}`,
    security: `Re-scan all code after remediation cycle #${cycle}. Dev agents have attempted to fix the security issues you previously identified. Check if the fixes are correct and scan for any new vulnerabilities. Original request: ${ctx.userMessage}`,
  };

  try {
    const agentInput: AgentInput = {
      userMessage: reviewPrompts[agentName]!,
      chatHistory: ctx.chatHistory,
      projectPath: ctx.projectPath,
      context: {
        projectId: ctx.projectId,
        originalRequest: ctx.userMessage,
        upstreamOutputs: filterUpstreamOutputs(agentName, undefined, ctx.agentResults, "re-review", ctx.projectPath),
        phase: "re-review",
        cycle,
      },
    };

    // Write-ahead: provisional tracking before LLM call
    const revProviderKey = ctx.apiKeys[config.provider];
    let revProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;
    if (revProviderKey) {
      const upstreamSize = Object.values(agentInput.context?.upstreamOutputs as Record<string, string> || {}).reduce((s, v) => s + v.length, 0);
      revProvisionalIds = trackProvisionalUsage({
        executionId, chatId: ctx.chatId, agentName,
        provider: config.provider, model: config.model, apiKey: revProviderKey,
        estimatedInputTokens: Math.ceil((agentInput.userMessage.length + upstreamSize) / 4),
        projectId: ctx.projectId, projectName: ctx.projectName, chatTitle: ctx.chatTitle,
      });
    }

    const result = await runAgent(displayConfig, ctx.providers, agentInput, undefined, ctx.signal, ctx.chatId);

    if (result.tokenUsage && revProviderKey && revProvisionalIds) {
      finalizeTokenUsage(revProvisionalIds, {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
      }, config.provider, config.model);

      const totalTokens = result.tokenUsage.inputTokens + result.tokenUsage.outputTokens
        + (result.tokenUsage.cacheCreationInputTokens || 0) + (result.tokenUsage.cacheReadInputTokens || 0);
      const costEst = estimateCost(
        config.provider, config.model,
        result.tokenUsage.inputTokens, result.tokenUsage.outputTokens,
        result.tokenUsage.cacheCreationInputTokens || 0, result.tokenUsage.cacheReadInputTokens || 0,
      );
      broadcastTokenUsage({
        chatId: ctx.chatId, projectId: ctx.projectId, agentName,
        provider: config.provider, model: config.model,
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        totalTokens, costEstimate: costEst,
      });
    }

    await db.update(schema.agentExecutions)
      .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));

    // Overwrite the agent's entry so detectIssues() checks fresh output next cycle
    ctx.agentResults.set(agentName, result.content);
    ctx.completedAgents.push(`${agentName} (re-review #${cycle})`);

    return result.content;
  } catch (err) {
    if (!ctx.signal.aborted) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(schema.agentExecutions)
        .set({ status: "failed", error: errorMsg, completedAt: Date.now() })
        .where(eq(schema.agentExecutions.id, executionId));
      broadcastAgentError(ctx.chatId, agentName, `Re-review failed: ${errorMsg}`);
    }
    return null;
  }
}

/**
 * Check if the research output indicates backend requirements.
 * Parses JSON for `requires_backend: true` features, falls back to regex heuristic.
 */
export function needsBackend(researchOutput: string): boolean {
  try {
    const parsed = JSON.parse(researchOutput);
    if (parsed.features && Array.isArray(parsed.features)) {
      return parsed.features.some((f: { requires_backend?: boolean }) => f.requires_backend === true);
    }
  } catch {
    // JSON parse failed — fall back to heuristic
  }
  // Regex heuristic: look for backend-related keywords (avoid broad terms like "backend" or "endpoint" that cause false positives)
  return /requires_backend['":\s]+true|api\s*route|server[\s-]*side|database|express/i.test(researchOutput);
}

// --- Intent classification ---

const INTENT_SYSTEM_PROMPT = `You classify user messages for a page builder app.
Respond with ONLY a JSON object: {"intent":"build"|"fix"|"question","scope":"frontend"|"backend"|"styling"|"full","reasoning":"<one sentence>"}

Rules:
- "build": New feature, new page, new project, or adding something that doesn't exist yet
- "fix": Changing, fixing, or updating something that already exists in the project
- "question": Asking about the project, how something works, or a non-code request
- scope "frontend": UI components, React, layout, HTML
- scope "backend": API routes, server logic, database
- scope "styling": CSS, colors, fonts, spacing, visual polish
- scope "full": Multiple areas or unclear

Examples:
- "Build me a landing page with a hero and contact form" → {"intent":"build","scope":"full","reasoning":"New page request with multiple sections"}
- "The submit button isn't working" → {"intent":"fix","scope":"frontend","reasoning":"Bug report about existing button behavior"}
- "Change the header color to blue" → {"intent":"fix","scope":"styling","reasoning":"Visual change to existing element"}
- "Add a REST API for user signup" → {"intent":"build","scope":"backend","reasoning":"New API endpoint that doesn't exist yet"}
- "How does the routing work?" → {"intent":"question","scope":"full","reasoning":"Asking about project architecture"}

Tie-breaking: If ambiguous between build and fix, prefer "fix" when the project already has files.`;

/**
 * Classify the user's intent using the orchestrator model.
 * Fast-path: if no existing files, always returns "build" (skip API call).
 * Fallback: any error returns "build" (safe default).
 */
export async function classifyIntent(
  userMessage: string,
  hasExistingFiles: boolean,
  providers: ProviderInstance
): Promise<IntentClassification & { tokenUsage?: { inputTokens: number; outputTokens: number; provider: string; model: string } }> {
  // Fast path: empty project → always build
  if (!hasExistingFiles) {
    return { intent: "build", scope: "full", reasoning: "New project with no existing files" };
  }

  const classifyConfig = getAgentConfigResolved("orchestrator:classify");
  if (!classifyConfig) {
    return { intent: "build", scope: "full", reasoning: "Fallback: no classify config" };
  }
  const classifyModel = resolveProviderModel(classifyConfig, providers);
  if (!classifyModel) {
    return { intent: "build", scope: "full", reasoning: "Fallback: no classify model" };
  }

  try {
    logLLMInput("orchestrator", "orchestrator-classify", INTENT_SYSTEM_PROMPT, userMessage);
    const result = await generateText({
      model: classifyModel,
      system: INTENT_SYSTEM_PROMPT,
      prompt: userMessage,
      maxOutputTokens: 100,
    });
    logLLMOutput("orchestrator", "orchestrator-classify", result.text);

    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/m, "");
    const parsed = JSON.parse(raw);
    const intent: OrchestratorIntent = ["build", "fix", "question"].includes(parsed.intent) ? parsed.intent : "build";
    const scope: IntentScope = ["frontend", "backend", "styling", "full"].includes(parsed.scope) ? parsed.scope : "full";

    log("orchestrator:classify", `intent=${intent} scope=${scope}`, {
      model: classifyConfig.model,
      promptChars: userMessage.length,
      tokens: { input: result.usage.inputTokens || 0, output: result.usage.outputTokens || 0 },
      rawResponse: raw,
    });

    return {
      intent, scope, reasoning: parsed.reasoning || "",
      tokenUsage: {
        inputTokens: result.usage.inputTokens || 0,
        outputTokens: result.usage.outputTokens || 0,
        provider: classifyConfig.provider,
        model: classifyConfig.model,
      },
    };
  } catch (err) {
    logError("orchestrator", "Intent classification failed, defaulting to build", err);
    return { intent: "build", scope: "full", reasoning: "Fallback: classification error" };
  }
}

const READ_EXCLUDE_PATTERNS = /node_modules|dist|\.git|bun\.lockb|bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.ico|\.woff|\.ttf|\.eot/;
const DATA_DIR_PATTERNS = /(?:^|\/)(?:src\/)?data\//;
const MAX_SOURCE_SIZE = 100_000; // 100KB cap

/**
 * Check if file content is predominantly data (array/object literals).
 * Returns true if >80% of non-empty lines are data patterns.
 */
export function isDataFile(content: string): boolean {
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 10) return false; // too short to be a data dump
  const dataLinePattern = /^\s*["'`\[{]|^\s*\d|^\s*\/\//;
  const dataLines = lines.filter(l => dataLinePattern.test(l)).length;
  return dataLines / lines.length > 0.8;
}

/**
 * Read all source files from a project directory into a formatted string.
 * Excludes node_modules, dist, .git, lockfiles, binary files, and data-heavy files.
 * Returns empty string if project has no readable files.
 */
export function readProjectSource(projectPath: string): string {
  const files = listFiles(projectPath);
  if (files.length === 0) return "";

  const parts: string[] = [];
  let totalSize = 0;

  function walkFiles(nodes: typeof files, prefix = "") {
    for (const node of nodes) {
      if (totalSize >= MAX_SOURCE_SIZE) return;
      if (READ_EXCLUDE_PATTERNS.test(node.path)) continue;
      if (DATA_DIR_PATTERNS.test(node.path)) continue;

      if (node.type === "directory" && node.children) {
        walkFiles(node.children, node.path);
      } else if (node.type === "file") {
        try {
          const content = readFile(projectPath, node.path);
          if (totalSize + content.length > MAX_SOURCE_SIZE) return;
          // Skip files that are predominantly data (e.g., word lists, fixture dumps)
          if (content.length > 5000 && isDataFile(content)) continue;
          parts.push(`### ${node.path}\n\`\`\`\n${content}\n\`\`\``);
          totalSize += content.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walkFiles(files);
  return parts.join("\n\n");
}

/**
 * Check whether a project has any existing source files.
 */
export function projectHasFiles(projectPath: string): boolean {
  const files = listFiles(projectPath);
  return files.length > 0;
}

export interface FilePlanEntry {
  action: string;
  path: string;
  description?: string;
  exports?: string[];
  imports?: Record<string, string[]>;
}


export function buildExecutionPlan(
  userMessage: string,
  researchOutput?: string,
  intent: OrchestratorIntent = "build",
  scope: IntentScope = "full"
): ExecutionPlan {
  // --- Fix mode: tiered pipeline based on scope ---
  // styling/frontend = quick-edit (single agent, no reviewers — finishPipeline runs actual tests)
  // backend/full = dev agent(s) + reviewers
  if (intent === "fix") {
    if (scope === "styling") {
      return {
        steps: [{
          agentName: "styling",
          input: `Fix the following styling issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
        }],
      };
    }
    if (scope === "frontend") {
      return {
        steps: [{
          agentName: "frontend-dev",
          input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
        }],
      };
    }
    // backend/full — delegate to buildFixPlan
    return buildFixPlan(userMessage, scope);
  }

  // --- Build mode: architect (with test plan) → dev → styling → review ---
  const includeBackend = scope === "frontend" || scope === "styling"
    ? false  // Classifier said frontend/styling-only — skip backend
    : researchOutput ? needsBackend(researchOutput) : false;

  const steps: ExecutionPlan["steps"] = [
    {
      agentName: "architect",
      input: `Design the component architecture and test plan based on the research agent's requirements (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["research"],
    },
    {
      agentName: "frontend-dev",
      input: `Implement the React components defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your components following the plan. Original request: ${userMessage}`,
      dependsOn: ["architect"],
    },
  ];

  if (includeBackend) {
    steps.push({
      agentName: "backend-dev",
      input: `Implement the backend API routes and server logic defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your server code following the plan. Original request: ${userMessage}`,
      dependsOn: ["frontend-dev"],
    });
  }

  // Styling depends on all dev agents (waits for both if backend included)
  const stylingDeps: AgentName[] = includeBackend ? ["frontend-dev", "backend-dev"] : ["frontend-dev"];

  steps.push(
    {
      agentName: "styling",
      input: `Apply design polish to the components created by frontend-dev, using the research requirements for design intent (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: stylingDeps,
    },
    // Review agents all depend on styling — they run in parallel with each other
    {
      agentName: "code-review",
      input: `Review and fix all code generated by dev and styling agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      agentName: "security",
      input: `Security review all code generated by the dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      agentName: "qa",
      input: `Validate the implementation against the research requirements (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
  );

  return { steps };
}

/** Check whether an agent has file-writing tools enabled (write_file or write_files). */
export function agentHasFileTools(name: string): boolean {
  const tools = getAgentTools(name as import("../../shared/types.ts").AgentName);
  return tools.includes("write_file") || tools.includes("write_files");
}

/** Check if the project has any test files on disk (.test./.spec. in src/, up to 3 levels deep) */
function testFilesExist(projectPath: string): boolean {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);
  const srcDir = join(fullPath, "src");
  if (!existsSync(srcDir)) return false;

  const testPattern = /\.(test|spec)\.(tsx?|jsx?)$/;

  function searchDir(dir: string, depth: number): boolean {
    if (depth > 3) return false;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && testPattern.test(entry.name)) return true;
        if (entry.isDirectory() && entry.name !== "node_modules") {
          if (searchDir(join(dir, entry.name), depth + 1)) return true;
        }
      }
    } catch {
      // Permission error or similar — skip
    }
    return false;
  }

  return searchDir(srcDir, 0);
}

/**
 * Sanitize a file path from agent output.
 * Strips leading/trailing quotes, backticks, whitespace, and normalizes separators.
 */
export function sanitizeFilePath(raw: string): string {
  return raw
    .trim()
    .replace(/^['"` ]+|['"` ]+$/g, "") // strip leading/trailing quotes, backticks, spaces
    .replace(/^\.\//, "")               // strip ./
    .replace(/\\/g, "/");               // normalize Windows paths
}

/**
 * Extract files from agent text output. Agents primarily use:
 *   <tool_call>{"name":"write_file","parameters":{"path":"...","content":"..."}}</tool_call>
 * Fallback patterns for markdown-style output also supported.
 */
export function extractFilesFromOutput(
  agentOutput: string,
  strict = !process.env.ENABLE_TOOL_CALL_REPAIR,
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  function addFile(filePath: string, content: string) {
    const normalized = sanitizeFilePath(filePath);
    if (normalized && content && !seen.has(normalized)) {
      seen.add(normalized);
      const clean = content.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      files.push({ path: normalized, content: clean });
    }
  }

  // Primary pattern: <tool_call>{"name":"write_file","parameters":{"path":"...","content":"..."}}</tool_call>
  const toolCallRegex = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(agentOutput)) !== null) {
    try {
      const json = JSON.parse(match[1]!.trim());
      if (json.name === "write_file" && json.parameters?.path && json.parameters?.content) {
        addFile(json.parameters.path, json.parameters.content);
      }
    } catch {
      if (strict) {
        // Strict mode: reject malformed tool_call blocks
        logWarn("extractFiles", `Rejected malformed tool_call block (strict mode)`);
        continue;
      }
      // Non-strict: try repairing the raw block before regex fallback
      const rawBlock = match[1]!;
      if (rawBlock.includes("write_file")) {
        // Repair step: fix common JSON encoding issues
        let repaired = false;
        try {
          const repairedJson = rawBlock
            .replace(/\uFEFF/g, "")           // strip BOM
            .replace(/(?<!\\)\n/g, "\\n")      // escape literal newlines
            .replace(/(?<!\\)\r/g, "\\r")      // escape literal CRs
            .replace(/(?<!\\)\t/g, "\\t");     // escape literal tabs
          const parsed = JSON.parse(repairedJson.trim());
          if (parsed.name === "write_file" && parsed.parameters?.path && parsed.parameters?.content) {
            logWarn("extractFiles", `JSON repaired for ${parsed.parameters.path}`);
            addFile(parsed.parameters.path, parsed.parameters.content);
            repaired = true;
          }
        } catch {
          // Repair also failed — fall through to regex
        }

        if (!repaired) {
          // Regex fallback
          const pathMatch = rawBlock.match(/"path"\s*:\s*"([^"]+)"/);
          const contentMatch = rawBlock.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
          if (pathMatch?.[1] && contentMatch?.[1]) {
            try {
              const content = JSON.parse('"' + contentMatch[1] + '"');
              logWarn("extractFiles", `Regex fallback used for ${pathMatch[1]} (${content.length} chars)`);
              addFile(pathMatch[1], content);
            } catch {
              logWarn("extractFiles", `Failed to extract file from tool_call block`);
            }
          }
        }
      }
    }
  }

  // Fallback: markdown/regex extraction — disabled by default to prevent
  // writing markdown artifacts as code. Enable with ENABLE_FALLBACK_EXTRACTION=1.
  if (process.env.ENABLE_FALLBACK_EXTRACTION === "1") {
    // Fallback: ```lang\n// filepath\n...code...\n```
    const codeBlockRegex = /```[\w]*\n\/\/\s*((?:src\/|\.\/)?[\w./-]+\.\w+)\n([\s\S]*?)```/g;
    while ((match = codeBlockRegex.exec(agentOutput)) !== null) {
      addFile(match[1]!, match[2]!.trimEnd());
    }

    // Fallback: ### filepath (or **filepath**) followed by ```...```
    const headingBlockRegex = /(?:###\s+|[*]{2}|`)(\S+\.(?:tsx?|jsx?|css|html|json|md))(?:[*]{2}|`)?[\s\S]*?```[\w]*\n([\s\S]*?)```/g;
    while ((match = headingBlockRegex.exec(agentOutput)) !== null) {
      addFile(match[1]!, match[2]!.trimEnd());
    }
  }

  return files;
}

// Track which orchestrations have already triggered preview prep
const previewPrepStarted = new Set<string>();

function extractAndWriteFiles(
  agentName: string,
  agentOutput: string,
  projectPath: string,
  projectId: string,
  alreadyWritten?: Set<string>
): string[] {
  if (!agentHasFileTools(agentName)) return [];

  const files = extractFilesFromOutput(agentOutput);
  if (files.length === 0) return [];

  const written: string[] = [];
  const hasPackageJson = files.some((f) => f.path === "package.json" || f.path.endsWith("/package.json"));

  for (const file of files) {
    // Skip files already written by native tools
    if (alreadyWritten?.has(file.path)) continue;
    try {
      writeFile(projectPath, file.path, file.content);
      written.push(file.path);
    } catch (err) {
      logError("orchestrator", `Failed to write ${file.path}`, err);
    }
  }

  if (written.length > 0) {
    broadcastFilesChanged(projectId, written);

    // If the agent wrote a package.json, invalidate cached deps
    if (hasPackageJson) {
      invalidateProjectDeps(projectPath);
    }

    // After the first file-producing agent writes files, prepare project for preview
    // This runs in the background — doesn't block the pipeline
    // NOTE: preview_ready is NOT broadcast here — it's only sent after a successful build check
    if (!previewPrepStarted.has(projectId)) {
      previewPrepStarted.add(projectId);
      prepareProjectForPreview(projectPath)
        .then(() => {
          log("orchestrator", `Project ${projectId} scaffolded for preview (waiting for build check)`);
        })
        .catch((err) => {
          logError("orchestrator", "Preview preparation failed", err);
        });
    }
  }

  return written;
}

/**
 * Run a Vite build check on the project to detect compile errors.
 * Returns error output string if there are errors, null if build succeeds.
 */
async function checkProjectBuild(projectPath: string): Promise<string | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Wait for any pending preview prep (which includes bun install)
  await prepareProjectForPreview(projectPath);

  log("orchestrator", `Running build check in ${fullPath}...`);

  const BUILD_TIMEOUT_MS = 30_000;

  try {
    const proc = Bun.spawn(["bunx", "vite", "build", "--mode", "development"], {
      cwd: fullPath,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), BUILD_TIMEOUT_MS),
    );
    const result = await Promise.race([proc.exited, timeout]);

    if (result === "timeout") {
      logWarn("orchestrator", `Build check timed out after ${BUILD_TIMEOUT_MS / 1000}s — killing process`);
      proc.kill();
      return null; // Don't block pipeline on timeout
    }

    const exitCode = result;
    if (exitCode === 0) {
      log("orchestrator", "Build check passed");
      return null;
    }

    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    // Strip ANSI escape codes so error messages are clean for the fix agent
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[([0-9;]*)m/g, "");
    const combined = stripAnsi(stderr + "\n" + stdout).trim();

    // Extract error lines — keep actionable lines, skip pure stack traces (at ...) and blank lines
    const errorLines = combined
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Skip pure stack trace lines — they add noise without actionable info
        if (/^\s*at\s+/.test(trimmed)) return false;
        // Skip vite/rollup build timing lines
        if (/^✓|^✗|built in|^rendering chunks/i.test(trimmed)) return false;
        return true;
      });

    // Deduplicate by core error pattern (strip file paths, keep error type + message)
    const deduped = deduplicateErrors(errorLines);
    const errors = (deduped || combined.slice(0, 2000)).trim();
    logBlock("orchestrator", "Build check failed", errors);
    return errors;
  } catch (err) {
    logError("orchestrator", "Build check process error", err);
    return null; // Don't block pipeline on check failure
  }
}

/**
 * Run a dev agent to fix build errors. Routes to backend-dev if errors
 * reference server files, otherwise defaults to frontend-dev.
 * Returns the agent's output content, or null on failure.
 */
async function runBuildFix(params: {
  buildErrors: string;
  chatId: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  chatTitle: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  agentResults: Map<string, string>;
  callCounter: CallCounter;
  buildFixCounter: BuildFixCounter;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  signal: AbortSignal;
}): Promise<string | null> {
  const { buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal } = params;

  // Enforce per-pipeline build-fix attempt limit
  if (buildFixCounter.value >= MAX_BUILD_FIX_ATTEMPTS) {
    log("orchestrator", `Build fix limit reached (${MAX_BUILD_FIX_ATTEMPTS}). Skipping to prevent runaway costs.`);
    broadcastAgentError(chatId, "orchestrator", `Build fix attempt limit reached (${MAX_BUILD_FIX_ATTEMPTS}). Skipping further fixes.`);
    return null;
  }
  buildFixCounter.value++;

  const maxCallsBuild = getMaxAgentCalls();
  if (callCounter.value >= maxCallsBuild) {
    broadcastAgentError(chatId, "orchestrator", `Agent call limit reached (${maxCallsBuild}). Skipping build fix.`);
    return null;
  }
  callCounter.value++;

  const costCheck = checkCostLimit(chatId);
  if (!costCheck.allowed) {
    log("orchestrator", "Build fix skipped: cost limit reached");
    return null;
  }

  const fixAgent = determineBuildFixAgent(buildErrors);
  const config = getAgentConfigResolved(fixAgent);
  if (!config) return null;

  const buildFixConfig = {
    ...config,
    displayName: `${config.displayName} (build fix)`,
  };
  broadcastAgentStatus(chatId, fixAgent, "running", { phase: "build-fix" });

  const execId = nanoid();
  await db.insert(schema.agentExecutions).values({
    id: execId,
    chatId,
    agentName: fixAgent,
    status: "running",
    input: JSON.stringify({ phase: "build-fix", errors: buildErrors }),
    output: null,
    error: null,
    retryCount: 0,
    startedAt: Date.now(),
    completedAt: null,
  });

  const fixPrompt = `The project has build errors that MUST be fixed before it can run. Here are the Vite build errors:\n\n\`\`\`\n${buildErrors}\n\`\`\`\n\nFix ALL the errors above. Output corrected versions of the files that need changes. The original code is in Previous Agent Outputs. Make sure all exports and imports match correctly.`;

  try {
    const fixInput: AgentInput = {
      userMessage: fixPrompt,
      chatHistory,
      projectPath,
      context: {
        projectId,
        originalRequest: userMessage,
        upstreamOutputs: filterUpstreamOutputs(fixAgent, undefined, agentResults, "build-fix", projectPath),
        phase: "build-fix",
      },
    };

    // Apply same tool subset filtering as normal step execution (Fix C)
    const enabledFixTools = getAgentTools(fixAgent);
    let fixToolSubset: ReturnType<typeof createAgentTools>["tools"] | undefined;
    if (enabledFixTools.length > 0) {
      const allFixTools = createAgentTools(projectPath, projectId);
      fixToolSubset = Object.fromEntries(
        enabledFixTools
          .filter((t) => t in allFixTools.tools)
          .map((t) => [t, allFixTools.tools[t as keyof typeof allFixTools.tools]])
      ) as typeof allFixTools.tools;
    }

    // Write-ahead: provisional tracking before LLM call
    const bfProviderKey = apiKeys[config.provider];
    let bfProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;
    if (bfProviderKey) {
      const upstreamSize = Object.values(fixInput.context?.upstreamOutputs as Record<string, string> || {}).reduce((s, v) => s + v.length, 0);
      bfProvisionalIds = trackProvisionalUsage({
        executionId: execId, chatId, agentName: fixAgent,
        provider: config.provider, model: config.model, apiKey: bfProviderKey,
        estimatedInputTokens: Math.ceil((fixPrompt.length + upstreamSize) / 4),
        projectId, projectName, chatTitle,
      });
    }

    const result = await runAgent(buildFixConfig, providers, fixInput, fixToolSubset, signal, chatId, undefined, {
      maxOutputTokens: BUILD_FIX_MAX_OUTPUT_TOKENS,
      maxToolSteps: BUILD_FIX_MAX_TOOL_STEPS,
    });

    if (result.tokenUsage && bfProviderKey && bfProvisionalIds) {
      finalizeTokenUsage(bfProvisionalIds, {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
      }, config.provider, config.model);

      const totalTokens = result.tokenUsage.inputTokens + result.tokenUsage.outputTokens;
      const costEst = estimateCost(
        config.provider, config.model,
        result.tokenUsage.inputTokens, result.tokenUsage.outputTokens,
        result.tokenUsage.cacheCreationInputTokens || 0, result.tokenUsage.cacheReadInputTokens || 0,
      );
      broadcastTokenUsage({
        chatId, projectId, agentName: fixAgent,
        provider: config.provider, model: config.model,
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        totalTokens, costEstimate: costEst,
      });
    }

    await db.update(schema.agentExecutions)
      .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, execId));

    const nativeFix = result.filesWritten || [];
    extractAndWriteFiles(fixAgent, result.content, projectPath, projectId, new Set(nativeFix));

    broadcastAgentStatus(chatId, fixAgent, "completed", { phase: "build-fix" });
    return result.content;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = signal.aborted ? "interrupted" : "failed";
    // Always update DB record to prevent stuck "running" executions
    await db.update(schema.agentExecutions)
      .set({ status, error: errorMsg, completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, execId));
    if (!signal.aborted) {
      // Check for credit exhaustion — broadcast specific error type
      const apiCheck = isNonRetriableApiError(err);
      if (apiCheck.nonRetriable) {
        broadcastAgentError(chatId, fixAgent, apiCheck.reason);
        broadcast({
          type: "agent_error",
          payload: { chatId, agentName: "orchestrator", error: apiCheck.reason, errorType: "credit_exhaustion" },
        });
      } else {
        broadcastAgentError(chatId, fixAgent, `Build fix failed: ${errorMsg}`);
      }
    }
    broadcastAgentStatus(chatId, fixAgent, status, { phase: "build-fix" });
    return null;
  }
}

export interface TestRunResult {
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: Array<{ name: string; error: string }>;
  testDetails?: Array<{ suite: string; name: string; status: "passed" | "failed" | "skipped"; error?: string; duration?: number }>;
}

/**
 * Parse vitest JSON reporter output into structured test results.
 * Detects suite collection errors (status: "failed" with empty assertionResults)
 * which occur when corrupted source files prevent test collection.
 */
export function parseVitestOutput(stdout: string, stderr: string, exitCode: number): TestRunResult {
  try {
    const jsonOutput = JSON.parse(stdout);
    let passed = jsonOutput.numPassedTests ?? 0;
    let failed = jsonOutput.numFailedTests ?? 0;
    let total = jsonOutput.numTotalTests ?? (passed + failed);
    const duration = jsonOutput.startTime
      ? Date.now() - jsonOutput.startTime
      : 0;

    const failures: Array<{ name: string; error: string }> = [];
    const testDetails: TestRunResult["testDetails"] = [];

    if (jsonOutput.testResults) {
      for (const suite of jsonOutput.testResults) {
        const suiteName = suite.name || suite.testFilePath || "unknown suite";

        // Detect suite collection errors: suite failed but has no assertion results
        if (suite.status === "failed" && (!suite.assertionResults || suite.assertionResults.length === 0)) {
          const errorMsg = (suite.message || suite.failureMessage || "Suite failed to collect").slice(0, 500);
          failures.push({
            name: `[Collection Error] ${suiteName}`,
            error: errorMsg,
          });
          testDetails.push({
            suite: suiteName,
            name: "[Collection Error]",
            status: "failed",
            error: errorMsg,
          });
          failed++;
          total++;
          continue;
        }

        if (suite.assertionResults) {
          for (const test of suite.assertionResults) {
            const testName = test.fullName || test.title || "unknown test";
            const testStatus = test.status === "passed" ? "passed"
              : test.status === "failed" ? "failed"
              : "skipped";
            const testError = test.status === "failed"
              ? (test.failureMessages || []).join("\n").slice(0, 500)
              : undefined;

            testDetails.push({
              suite: suiteName,
              name: testName,
              status: testStatus,
              error: testError,
              duration: test.duration,
            });

            if (test.status === "failed") {
              failures.push({
                name: testName,
                error: testError || "",
              });
            }
          }
        }
      }
    }

    return { passed, failed, total, duration, failures, testDetails };
  } catch {
    // JSON parsing failed — create result from exit code
    if (exitCode === 0) {
      return { passed: 1, failed: 0, total: 1, duration: 0, failures: [] };
    } else {
      const errorSnippet = (stderr + "\n" + stdout).trim().slice(0, 500);
      return {
        passed: 0,
        failed: 1,
        total: 1,
        duration: 0,
        failures: [{ name: "Test suite", error: errorSnippet }],
      };
    }
  }
}

/**
 * Run vitest tests in the project directory.
 * Parses JSON output for structured results and broadcasts them via WebSocket.
 * Returns structured results, or null if tests couldn't be run.
 */
export async function runProjectTests(
  projectPath: string,
  chatId: string,
  projectId: string,
  failedTestFiles?: string[]
): Promise<TestRunResult | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Ensure vitest config + deps are installed (handled by prepareProjectForPreview)
  await prepareProjectForPreview(projectPath);

  log("orchestrator", `Running tests in ${fullPath}...`);

  const TEST_TIMEOUT_MS = 60_000;

  try {
    const jsonOutputFile = join(fullPath, "vitest-results.json");
    const vitestArgs = ["bunx", "vitest", "run", "--reporter=verbose", "--reporter=json", "--outputFile", jsonOutputFile];
    // Smart re-run: only run specific failed test files instead of full suite
    if (failedTestFiles && failedTestFiles.length > 0) {
      vitestArgs.push(...failedTestFiles);
      log("orchestrator", `Smart test re-run: only running ${failedTestFiles.length} failed file(s)`);
    }
    const proc = Bun.spawn(
      vitestArgs,
      {
        cwd: fullPath,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      },
    );

    // Stream verbose output line-by-line for incremental results
    const verboseStdout = await new Response(proc.stdout).text();
    const lines = verboseStdout.split("\n");
    for (const line of lines) {
      // Vitest verbose format: " ✓ Suite > test name 3ms" or " × Suite > test name"
      const passMatch = line.match(/^\s*[✓✔]\s+(.+?)\s+>\s+(.+?)(?:\s+(\d+)ms)?$/);
      const failMatch = line.match(/^\s*[×✗]\s+(.+?)\s+>\s+(.+?)(?:\s+(\d+)ms)?$/);
      if (passMatch) {
        broadcastTestResultIncremental({
          chatId, projectId,
          suite: passMatch[1]!.trim(),
          name: passMatch[2]!.trim(),
          status: "passed",
          duration: passMatch[3] ? parseInt(passMatch[3]) : undefined,
        });
      } else if (failMatch) {
        broadcastTestResultIncremental({
          chatId, projectId,
          suite: failMatch[1]!.trim(),
          name: failMatch[2]!.trim(),
          status: "failed",
          duration: failMatch[3] ? parseInt(failMatch[3]) : undefined,
        });
      }
    }

    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), TEST_TIMEOUT_MS),
    );
    const exitResult = await Promise.race([proc.exited, timeout]);

    if (exitResult === "timeout") {
      logWarn("orchestrator", `Test run timed out after ${TEST_TIMEOUT_MS / 1000}s — killing process`);
      proc.kill();
      return null;
    }

    const exitCode = exitResult;
    const stderr = await new Response(proc.stderr).text();

    if (stderr.trim()) {
      logBlock("orchestrator", "Test stderr", stderr.trim().slice(0, 2000));
    }

    // Read JSON output from file (json reporter writes to outputFile)
    let jsonStdout = "";
    try {
      jsonStdout = await Bun.file(jsonOutputFile).text();
    } catch {
      // JSON file might not exist if vitest failed early — use verbose output
      jsonStdout = verboseStdout;
    }

    const result = parseVitestOutput(jsonStdout, stderr, exitCode);

    broadcastTestResults({
      chatId,
      projectId,
      ...result,
    });

    // Persist test results so they survive page refresh
    await db.insert(schema.agentExecutions).values({
      id: nanoid(),
      chatId,
      agentName: "test-results",
      status: "completed",
      input: JSON.stringify({ projectId }),
      output: JSON.stringify(result),
      error: null,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: Date.now(),
    });

    log("orchestrator", `Tests: ${result.passed}/${result.total} passed, ${result.failed} failed`);
    return result;
  } catch (err) {
    logError("orchestrator", "Test runner error", err);
    return null;
  }
}
