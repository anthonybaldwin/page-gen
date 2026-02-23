import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq, inArray, and, desc } from "drizzle-orm";
import { generateText } from "ai";
import { nanoid } from "nanoid";
import type { AgentName, IntentClassification, OrchestratorIntent, IntentScope } from "../../shared/types.ts";
import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfigResolved, getAgentTools } from "./registry.ts";
import { getActiveFlowTemplate, resolveFlowTemplate } from "./flow-resolver.ts";
import { runAgent, trackedGenerateText, AgentAbortError, type AgentInput, type AgentOutput } from "./base.ts";
import { trackTokenUsage, trackBillingOnly, trackProvisionalUsage, finalizeTokenUsage, voidProvisionalUsage, countProvisionalRecords } from "../services/token-tracker.ts";
import { estimateCost } from "../services/pricing.ts";
import { checkCostLimit, getMaxAgentCalls, checkDailyCostLimit, checkProjectCostLimit } from "../services/cost-limiter.ts";
import { broadcastAgentStatus, broadcastAgentError, broadcastTokenUsage, broadcastFilesChanged, broadcastAgentThinking, broadcastTestResults, broadcastTestResultIncremental } from "../ws.ts";
import { broadcast } from "../ws.ts";
import { existsSync, writeFileSync, readdirSync } from "fs";
import { writeFile, listFiles, readFile } from "../tools/file-ops.ts";
import { prepareProjectForPreview, invalidateProjectDeps, getFrontendPort } from "../preview/vite-server.ts";
import { startBackendServer, projectHasBackend } from "../preview/backend-server.ts";
import { createAgentTools, stripBlockedPackages } from "./tools.ts";
import { log, logError, logWarn, logBlock, logLLMInput, logLLMOutput } from "../services/logger.ts";
import { autoCommit, ensureGitRepo, isInPreview, exitPreview } from "../services/versioning.ts";
import { STAGE_HOOKS_ENABLED } from "../config/versioning.ts";
import {
  MAX_RETRIES,
  MAX_OUTPUT_CHARS,
  MAX_PROJECT_SOURCE_CHARS,
  MAX_SOURCE_SIZE,
  REVIEWER_SOURCE_CAP,
  STAGGER_MS,
  ORCHESTRATOR_CLASSIFY_MAX_TOKENS,
  SUMMARY_MAX_OUTPUT_TOKENS,
  QUESTION_MAX_OUTPUT_TOKENS,
  DATA_DIR_PATTERNS,
  getPipelineSetting,
} from "../config/pipeline.ts";

/** Per-flow overrides collected from action nodes in the flow template. */
export type ActionOverrides = Partial<Record<string, number>>;

/**
 * Read a pipeline setting with optional per-flow overrides.
 * Checks overrides first, then falls back to the global pipeline setting.
 */
function effectiveSetting(key: string, overrides?: ActionOverrides): number {
  if (overrides?.[key] !== undefined) return overrides[key]!;
  return getPipelineSetting(key);
}

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
export function deduplicateErrors(errorLines: string[], overrides?: ActionOverrides): string {
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
  const maxErrors = effectiveSetting("maxUniqueErrors", overrides);
  const entries = [...counts.entries()].slice(0, maxErrors);
  const lines = entries.map(([, { count, example }]) =>
    count > 1 ? `[${count}x] ${example}` : example
  );
  const omitted = counts.size - maxErrors;
  if (omitted > 0) lines.push(`(and ${omitted} more unique errors)`);
  return lines.join("\n");
}

/**
 * Format test failures for agent consumption. Caps at MAX_TEST_FAILURES to prevent prompt bloat.
 */
export function formatTestFailures(failures: Array<{ name: string; error: string }>, overrides?: ActionOverrides): string {
  const maxFails = effectiveSetting("maxTestFailures", overrides);
  const capped = failures.slice(0, maxFails);
  const lines = capped.map((f) => `- ${f.name}: ${f.error}`);
  if (failures.length > maxFails) {
    lines.push(`(and ${failures.length - maxFails} more failures — fix the above first)`);
  }
  return `Test failures:\n${lines.join("\n")}`;
}

/**
 * Start the backend server for a project if server/index.ts exists.
 * Fire-and-forget — errors are logged but don't block the pipeline.
 */
function maybeStartBackend(projectId: string, projectPath: string) {
  if (!projectHasBackend(projectPath)) return;
  const fp = getFrontendPort(projectId);
  if (!fp) return;
  log("orchestrator", `Backend detected for ${projectId} — starting backend server`);
  startBackendServer(projectId, projectPath, fp)
    .then(({ ready }) => {
      if (ready) {
        log("orchestrator", `Backend server for ${projectId} is ready`);
      } else {
        logError("orchestrator", `Backend server for ${projectId} started but health check failed`);
      }
    })
    .catch((err) =>
      logError("orchestrator", `Failed to start backend for ${projectId}`, err instanceof Error ? err.message : String(err))
    );
}

/** Resolve a provider model instance from a config, respecting the configured provider. */
function resolveProviderModel(config: { provider: string; model: string }, providers: ProviderInstance) {
  return providers[config.provider]?.(config.model) ?? null;
}

/**
 * Determine which agents will actually run for a given intent/scope combination.
 * Used for plan-scoped preflight validation.
 */
export function getPlannedAgents(intent: OrchestratorIntent, scope: IntentScope, hasFiles: boolean): AgentName[] {
  if (intent === "question") return [];
  if (intent === "fix" && !hasFiles) return []; // will fall through to build

  if (intent === "fix") {
    // Scope-based agent list for preflight validation (actual routing handled by flow template)
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
 * Includes reviewers for backend/full scopes (higher risk).
 */
export function buildFixPlan(userMessage: string, scope: IntentScope): ExecutionPlan {
  const steps: PlanStep[] = [];

  // Dev agent(s) based on scope
  if (scope === "backend") {
    steps.push({
      kind: "agent",
      agentName: "backend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
    });
  } else {
    // "full" scope
    steps.push({
      kind: "agent",
      agentName: "frontend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
    });
    steps.push({
      kind: "agent",
      agentName: "backend-dev",
      input: `Fix the following issue in the existing code (provided in Previous Agent Outputs as "project-source"). Original request: ${userMessage}`,
      dependsOn: ["frontend-dev"],
    });
  }

  // Reviewers for backend/full (higher risk)
  const lastStep = steps[steps.length - 1]!;
  const lastStepName = stepKey(lastStep);
  steps.push(
    {
      kind: "agent",
      agentName: "code-review",
      input: `Review all code changes made by dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastStepName],
    },
    {
      kind: "agent",
      agentName: "security",
      input: `Security review all code changes (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastStepName],
    },
    {
      kind: "agent",
      agentName: "qa",
      input: `Validate the fix against the original request (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: [lastStepName],
    },
  );

  return { steps };
}

function buildQuickEditInput(scope: IntentScope, originalRequest: string): string {
  const scopeText = scope === "styling" ? "styling " : "";
  return `Fix the following ${scopeText}issue in the existing code. Use read_file/list_files to inspect relevant files and keep changes minimal and targeted. Original request: ${originalRequest}`;
}

/**
 * Extract the design_system JSON from the architect's output and format it
 * as a readable section for downstream agents. Mutates the result object
 * by adding a "design-system" key if the architect output contains one.
 */

/** Strip markdown code fences (```json ... ```) and parse JSON. */
function parseJSONSafe(text: string): unknown | null {
  try {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) jsonStr = fenceMatch[1]!.trim();
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function injectDesignSystem(result: Record<string, string>): void {
  const architectOutput = result["architect"];
  if (!architectOutput) return;

  try {
    const parsed = parseJSONSafe(architectOutput) as Record<string, unknown> | null;
    if (!parsed) return;
    if (parsed.design_system) {
      const ds = parsed.design_system as Record<string, unknown>;
      const lines: string[] = ["## Design System (from architect)"];

      if (ds.brand_kernel) lines.push(`Brand: ${ds.brand_kernel}`);
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
      if (ds.motif_language) lines.push(`Motif: ${ds.motif_language}`);
      if (ds.motion_rules) lines.push(`Motion: ${ds.motion_rules}`);
      if (ds.do_list) lines.push(`Do: ${ds.do_list}`);
      if (ds.dont_list) lines.push(`Don't: ${ds.dont_list}`);

      result["design-system"] = lines.join("\n");
    }
  } catch {
    // Architect output not valid JSON — skip design system injection
  }
}

/**
 * Parse design options from the architect's output.
 * If the architect returns `design_directions`, extract them.
 * Otherwise wrap the single `design_system` as a single option.
 */
function parseDesignOptions(architectOutput: string): import("../../shared/types.ts").DesignOption[] {
  try {
    const parsed = parseJSONSafe(architectOutput) as Record<string, unknown> | null;
    if (!parsed) return [];
    if (Array.isArray(parsed.design_directions) && parsed.design_directions.length > 0) {
      return parsed.design_directions.map((d: Record<string, unknown>) => ({
        name: (d.name as string) || "Option",
        description: (d.description as string) || "",
        design_system: (d.design_system as Record<string, unknown>) || {},
        colorPreview: extractColorPreview((d.design_system as Record<string, unknown>) || {}),
      }));
    }
    // Single design_system — wrap as one option (checkpoint will be skipped for length < 2)
    if (parsed.design_system) {
      return [{
        name: "Default",
        description: "The architect's recommended design system.",
        design_system: parsed.design_system as Record<string, unknown>,
        colorPreview: extractColorPreview(parsed.design_system as Record<string, unknown>),
      }];
    }
  } catch { /* not valid JSON */ }
  return [];
}

function extractColorPreview(ds: Record<string, unknown>): string[] {
  const colors = ds.colors as Record<string, string> | undefined;
  if (!colors) return [];
  return Object.values(colors).filter((v) => typeof v === "string" && v.startsWith("#")).slice(0, 6);
}

/**
 * Splice the user's selected design_system back into the architect output,
 * replacing the `design_directions` array with the chosen `design_system`.
 */
function spliceSelectedDesignSystem(
  agentResults: Map<string, string>,
  selected: import("../../shared/types.ts").DesignOption,
): void {
  const architectOutput = agentResults.get("architect");
  if (!architectOutput) return;
  try {
    const parsed = parseJSONSafe(architectOutput) as Record<string, unknown> | null;
    if (!parsed) return;
    parsed.design_system = selected.design_system;
    delete parsed.design_directions;
    agentResults.set("architect", JSON.stringify(parsed, null, 2));
    // Re-inject design system for downstream agents
    const resultMap: Record<string, string> = {};
    for (const [k, v] of agentResults) resultMap[k] = v;
    injectDesignSystem(resultMap);
    if (resultMap["design-system"]) {
      agentResults.set("design-system", resultMap["design-system"]);
    }
    log("orchestrator", `Spliced selected design system: "${selected.name}"`);
  } catch { /* ignore */ }
}

/**
 * Analyze mood board images using a vision-capable model.
 * Returns structured analysis or null if no images or no vision provider.
 */
async function analyzeMoodImages(
  projectPath: string,
  providers: ProviderInstance,
  apiKeys: Record<string, string>,
  signal: AbortSignal,
  opts?: { systemPrompt?: string; maxOutputTokens?: number },
): Promise<string | null> {
  const moodDir = join(projectPath, "mood");
  if (!existsSync(moodDir)) return null;
  const files = readdirSync(moodDir).filter((f: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
  if (files.length === 0) return null;

  // Pick a vision-capable model (Claude or GPT-4o)
  const visionProvider = providers.anthropic || providers.openai;
  if (!visionProvider) {
    logWarn("orchestrator", "No vision-capable provider available for mood analysis");
    return null;
  }

  // Read images as base64 data URLs
  const imageParts: Array<{ type: "image"; image: string; mimeType: string }> = [];
  for (const file of files.slice(0, 5)) {
    try {
      const filePath = join(moodDir, file);
      const buffer = Bun.file(filePath);
      const bytes = await buffer.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const ext = file.substring(file.lastIndexOf(".") + 1).toLowerCase();
      const mimeType = ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      imageParts.push({ type: "image", image: base64, mimeType });
    } catch {
      // Skip unreadable files
    }
  }

  if (imageParts.length === 0) return null;

  try {
    const modelId = providers.anthropic ? "claude-sonnet-4-20250514" : "gpt-4o";
    const defaultPrompt = `Analyze these inspiration/mood board images. Extract a structured JSON response with:
{
  "palette": ["#hex1", "#hex2", ...],  // 5-8 dominant colors
  "styleDescriptors": ["descriptor1", ...],  // 5-8 visual style words
  "textureNotes": "description of textures and materials",
  "typographyHints": "description of typography style if visible",
  "moodKeywords": ["keyword1", ...],  // 5-8 mood/feeling words
  "layoutPatterns": "description of layout patterns observed"
}
Return ONLY the JSON.`;
    const result = await generateText({
      model: visionProvider(modelId),
      ...(opts?.systemPrompt ? { system: opts.systemPrompt } : {}),
      messages: [{
        role: "user",
        content: [
          ...imageParts.map((img) => ({
            type: "image" as const,
            image: img.image,
            mimeType: img.mimeType,
          })),
          {
            type: "text" as const,
            text: opts?.systemPrompt ? "Analyze the attached mood board images." : defaultPrompt,
          },
        ],
      }],
      maxOutputTokens: opts?.maxOutputTokens ?? 1000,
      abortSignal: signal,
    });
    log("orchestrator", "Mood analysis completed", { imageCount: imageParts.length });
    return result.text;
  } catch (err) {
    logWarn("orchestrator", `Mood analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
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

  // research → vibe-brief + mood-analysis (if present)
  if (agentName === "research") {
    const result: Record<string, string> = {};
    if (all["vibe-brief"]) result["vibe-brief"] = all["vibe-brief"];
    if (all["mood-analysis"]) result["mood-analysis"] = all["mood-analysis"];
    return truncateAllOutputs(result);
  }

  // frontend-dev → architect + research + vibe-brief
  if (agentName === "frontend-dev") {
    const result = pick(["architect", "research", "vibe-brief"]);
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

  // architect → research + vibe-brief + mood-analysis
  if (agentName === "architect") {
    return truncateAllOutputs(pick(["research", "vibe-brief", "mood-analysis"]));
  }

  // Default: return everything, truncated
  return truncateAllOutputs(all);
}

/**
 * Resolve upstream sources using explicit per-node configuration.
 * Used when a step has `upstreamSources` defined (new configurable system).
 * Falls back to filterUpstreamOutputs when upstreamSources is undefined.
 */
export function resolveUpstreamSources(
  sources: import("../../shared/flow-types.ts").UpstreamSource[],
  agentResults: Map<string, string>,
  projectPath?: string,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const source of sources) {
    const key = source.alias ?? source.sourceKey;
    const transform = source.transform ?? "raw";

    if (transform === "project-source") {
      // Fresh read from disk regardless of sourceKey
      if (projectPath) {
        result[key] = getFreshProjectSource(projectPath);
      }
      continue;
    }

    const rawValue = agentResults.get(source.sourceKey);
    if (rawValue === undefined) continue;

    switch (transform) {
      case "raw":
        result[key] = rawValue;
        break;
      case "design-system": {
        // Extract design_system from architect JSON → markdown
        const designResult: Record<string, string> = { [source.sourceKey]: rawValue };
        injectDesignSystem(designResult);
        if (designResult["design-system"]) {
          result[key] = designResult["design-system"];
        }
        break;
      }
      case "file-manifest": {
        const manifest = buildFileManifest(rawValue);
        if (manifest) {
          result[key] = `### ${source.sourceKey} output\n${manifest}`;
        }
        break;
      }
    }
  }

  return truncateAllOutputs(result);
}

/**
 * Resolve merge fields in an input template string.
 * Supported patterns:
 *   {{output:KEY}}              — raw output from agentResults[KEY]
 *   {{transform:design-system}} — design system extracted from architect output
 *   {{transform:file-manifest:KEY}} — file manifest from agent KEY
 *   {{transform:project-source}} — fresh project source from disk
 *   {{context:KEY}}             — alias for {{output:KEY}}
 */
export function resolveMergeFields(
  input: string,
  agentResults: Map<string, string>,
  projectPath?: string,
): string {
  return input.replace(/\{\{(output|transform|context):([^}]*)\}\}/g, (_match, type: string, rest: string) => {
    if (type === "output" || type === "context") {
      const value = agentResults.get(rest);
      return value ?? "";
    }

    if (type === "transform") {
      if (rest === "design-system") {
        const architectOutput = agentResults.get("architect");
        if (!architectOutput) return "";
        const temp: Record<string, string> = { architect: architectOutput };
        injectDesignSystem(temp);
        return temp["design-system"] ?? "";
      }

      if (rest.startsWith("file-manifest:")) {
        const sourceKey = rest.slice("file-manifest:".length);
        const rawValue = agentResults.get(sourceKey);
        if (!rawValue) return "";
        return buildFileManifest(rawValue) ?? "";
      }

      if (rest === "project-source") {
        if (projectPath) return getFreshProjectSource(projectPath);
        return agentResults.get("project-source") ?? "";
      }
    }

    return "";
  });
}

// Abort registry — keyed by chatId
const abortControllers = new Map<string, AbortController>();

// Checkpoint registry — keyed by checkpointId
interface CheckpointEntry {
  chatId: string;
  resolve: (selectedIndex: number) => void;
  reject: (reason: string) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  data: {
    checkpointId: string;
    label: string;
    message: string;
    checkpointType: "approve" | "design_direction";
    options: import("../../shared/types.ts").DesignOption[];
    receivedAt: number;
  };
}
const pendingCheckpoints = new Map<string, CheckpointEntry>();

/**
 * Await a checkpoint: pause the pipeline and wait for user selection.
 * Returns the selected option index (0-based).
 */
export function awaitCheckpoint(
  chatId: string,
  checkpointId: string,
  step: CheckpointStep,
  options?: import("../../shared/types.ts").DesignOption[],
  pipelineRunId?: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timeoutMs = step.timeoutMs || getPipelineSetting("checkpointTimeoutMs");
    const receivedAt = Date.now();
    const checkpointPayload = {
      checkpointId,
      label: step.label,
      message: step.message,
      checkpointType: step.checkpointType as "approve" | "design_direction",
      options: options ?? [],
      receivedAt,
    };

    const timeoutHandle = setTimeout(() => {
      pendingCheckpoints.delete(checkpointId);
      log("orchestrator", `Checkpoint ${checkpointId} timed out — auto-selecting option 0`);
      // Persist resolved state
      if (pipelineRunId) {
        db.update(schema.pipelineRuns)
          .set({ checkpointData: JSON.stringify({ ...checkpointPayload, resolved: { selectedIndex: 0, timedOut: true } }) })
          .where(eq(schema.pipelineRuns.id, pipelineRunId))
          .run();
      }
      broadcast({
        type: "pipeline_checkpoint_resolved" as const,
        payload: { chatId, checkpointId, selectedIndex: 0, timedOut: true },
      });
      resolve(0);
    }, timeoutMs);

    pendingCheckpoints.set(checkpointId, { chatId, resolve, reject, timeoutHandle, data: checkpointPayload });

    // Persist checkpoint data to pipeline_runs for refresh recovery
    if (pipelineRunId) {
      db.update(schema.pipelineRuns)
        .set({ checkpointData: JSON.stringify(checkpointPayload), status: "awaiting_checkpoint" })
        .where(eq(schema.pipelineRuns.id, pipelineRunId))
        .run();
    }

    // Broadcast checkpoint event to clients
    broadcast({
      type: "pipeline_checkpoint" as const,
      payload: {
        chatId,
        checkpointId,
        nodeId: step.nodeId,
        label: step.label,
        checkpointType: step.checkpointType,
        message: step.message,
        options: options ?? [],
        timeoutMs,
        receivedAt,
      },
    });

    log("orchestrator", `Checkpoint paused: ${checkpointId} (${step.label})`, { chatId, type: step.checkpointType });
  });
}

/**
 * Resolve a pending checkpoint with the user's selection.
 */
export function resolveCheckpoint(checkpointId: string, selectedIndex: number): boolean {
  const entry = pendingCheckpoints.get(checkpointId);
  if (!entry) return false;
  clearTimeout(entry.timeoutHandle);

  // Persist resolved state to pipeline_runs
  const resolvedData = { ...entry.data, resolved: { selectedIndex, timedOut: false } };
  db.update(schema.pipelineRuns)
    .set({ checkpointData: JSON.stringify(resolvedData), status: "running" })
    .where(and(eq(schema.pipelineRuns.chatId, entry.chatId), eq(schema.pipelineRuns.status, "awaiting_checkpoint")))
    .run();

  pendingCheckpoints.delete(checkpointId);
  entry.resolve(selectedIndex);
  return true;
}

/**
 * Get pending checkpoint for a chat (if any).
 */
export function getPendingCheckpoint(chatId: string): {
  checkpointId: string;
  label: string;
  message: string;
  checkpointType: "approve" | "design_direction";
  options: import("../../shared/types.ts").DesignOption[];
  receivedAt: number;
  resolved?: { selectedIndex: number; timedOut?: boolean };
} | null {
  // Check in-memory pending checkpoints first (live session)
  for (const [, entry] of pendingCheckpoints) {
    if (entry.chatId === chatId) return entry.data;
  }
  // Fall back to DB for resolved checkpoint data (page refresh after resolution)
  const run = db.select({ checkpointData: schema.pipelineRuns.checkpointData })
    .from(schema.pipelineRuns)
    .where(and(eq(schema.pipelineRuns.chatId, chatId), eq(schema.pipelineRuns.status, "awaiting_checkpoint")))
    .orderBy(desc(schema.pipelineRuns.startedAt))
    .get();
  if (run?.checkpointData) {
    try { return JSON.parse(run.checkpointData); } catch { /* ignore */ }
  }
  return null;
}

export function abortOrchestration(chatId: string) {
  const controller = abortControllers.get(chatId);
  if (controller) {
    controller.abort();
    abortControllers.delete(chatId);
  }
  // Reject any pending checkpoints for this chat
  for (const [checkpointId, entry] of pendingCheckpoints) {
    if (entry.chatId === chatId) {
      clearTimeout(entry.timeoutHandle);
      pendingCheckpoints.delete(checkpointId);
      entry.reject("Pipeline aborted");
    }
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

  // Also mark any running or awaiting_checkpoint pipeline_runs as interrupted
  await db
    .update(schema.pipelineRuns)
    .set({
      status: "interrupted",
      completedAt: now,
    })
    .where(inArray(schema.pipelineRuns.status, ["running", "awaiting_checkpoint"]));

  // Log any provisional billing records from interrupted pipelines
  const provisionalCount = countProvisionalRecords();
  if (provisionalCount > 0) {
    log("orchestrator", "Cleaning up provisional billing records from interrupted pipelines", { provisionalCount });
  }

  log("orchestrator", "Cleaned up stale executions", { staleCount: stale.length, affectedChats: affectedChats.length });
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

export interface AgentStep {
  kind: "agent";
  agentName: AgentName;
  input: string;
  dependsOn?: string[];
  instanceId?: string;
  maxOutputTokens?: number;
  maxToolSteps?: number;
  upstreamSources?: import("../../shared/flow-types.ts").UpstreamSource[];
  toolOverrides?: string[];
}

export interface CheckpointStep {
  kind: "checkpoint";
  nodeId: string;
  label: string;
  checkpointType: "approve" | "design_direction";
  message: string;
  timeoutMs: number;
  dependsOn?: string[];
  instanceId?: string;
}

export interface ActionStep {
  kind: "action";
  actionKind: import("../../shared/flow-types.ts").ActionKind;
  label: string;
  dependsOn?: string[];
  instanceId?: string;
  // Per-node settings (copied from ActionNodeData by resolver)
  timeoutMs?: number;
  maxAttempts?: number;
  maxTestFailures?: number;
  maxUniqueErrors?: number;
  // LLM configuration (for agentic action kinds: summary, mood-analysis)
  systemPrompt?: string;
  maxOutputTokens?: number;
}

export interface VersionStep {
  kind: "version";
  nodeId: string;
  label: string;
  dependsOn?: string[];
  instanceId?: string;
}

export type PlanStep = AgentStep | CheckpointStep | ActionStep | VersionStep;

export function isAgentStep(step: PlanStep): step is AgentStep {
  return step.kind === "agent" || !("kind" in step);
}

export function isActionStep(step: PlanStep): step is ActionStep {
  return step.kind === "action";
}

export function isVersionStep(step: PlanStep): step is VersionStep {
  return step.kind === "version";
}

export function stepKey(step: PlanStep): string {
  if (isAgentStep(step)) return step.instanceId ?? step.agentName;
  if (isActionStep(step)) return step.instanceId ?? step.actionKind;
  return step.instanceId ?? step.nodeId;
}

export interface ExecutionPlan {
  steps: PlanStep[];
  actionOverrides?: ActionOverrides;
}

// Shared mutable counters — passed by reference so all call sites share the same count
interface CallCounter { value: number; }
interface BuildFixCounter { value: number; }

interface PipelineStepContext {
  step: AgentStep;
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
  actionOverrides?: ActionOverrides;
}

/**
 * Execute a single pipeline step with retries, token tracking, file extraction,
 * and build checks. Returns the agent's output content, or null on failure/abort.
 */
async function runPipelineStep(ctx: PipelineStepContext): Promise<string | null> {
  const { step, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal, actionOverrides } = ctx;

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

  // Resolve merge fields in the step input template
  const resolvedInput = resolveMergeFields(step.input, agentResults, projectPath);

  // Pre-flight cost estimate: estimate input tokens before calling agent
  let preflightUpstream: Record<string, string>;
  if (step.upstreamSources && step.upstreamSources.length > 0) {
    preflightUpstream = resolveUpstreamSources(step.upstreamSources, agentResults, projectPath);
  } else {
    preflightUpstream = filterUpstreamOutputs(step.agentName, step.instanceId, agentResults, undefined, projectPath);
  }
  const estimatedPromptChars = resolvedInput.length
    + Object.values(preflightUpstream).reduce((sum, v) => sum + v.length, 0)
    + chatHistory.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedInputTokens = Math.ceil(estimatedPromptChars / 4);

  const preflightCheck = checkCostLimit(chatId);
  if (preflightCheck.allowed && preflightCheck.limit > 0) {
    const currentTokens = preflightCheck.currentTokens || 0;
    if (currentTokens + estimatedInputTokens > preflightCheck.limit * 0.95) {
      log("orchestrator", `Pre-flight skip: ${stepKey}`, { agent: stepKey, estimatedTokens: estimatedInputTokens, currentTokens, limit: preflightCheck.limit });
      const pct = Math.round((currentTokens / preflightCheck.limit) * 100);
      broadcastAgentError(chatId, "orchestrator", `Skipping ${stepKey}: ${currentTokens.toLocaleString()} / ${preflightCheck.limit.toLocaleString()} tokens used (${pct}%), estimated ~${estimatedInputTokens.toLocaleString()} more needed`);
      return null;
    }
  }

  let result: AgentOutput | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) break;

    // Write-ahead: provisional usage IDs (hoisted so catch block can void them)
    let provisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;

    try {
      const agentInput: AgentInput = {
        userMessage: resolvedInput,
        chatHistory,
        projectPath,
        context: {
          projectId,
          originalRequest: userMessage,
          upstreamOutputs: preflightUpstream,
        },
      };

      // Create native tools based on agent's tool config (per-node overrides take priority)
      const enabledToolNames = step.toolOverrides ?? getAgentTools(step.agentName);
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

      // Build per-step overrides from flow node data
      const stepOverrides = (step.maxOutputTokens || step.maxToolSteps)
        ? {
            ...(step.maxOutputTokens ? { maxOutputTokens: step.maxOutputTokens } : {}),
            ...(step.maxToolSteps ? { maxToolSteps: step.maxToolSteps } : {}),
          }
        : undefined;

      result = await runAgent(config, providers, agentInput, toolSubset, signal, chatId, step.instanceId, stepOverrides);

      // Fix: Detect silent API failures (0-token empty responses from rate limiting)
      const emptyOutputTokens = result.tokenUsage?.outputTokens || 0;
      const hasContent = result.content.length > 0 || (result.filesWritten && result.filesWritten.length > 0);
      if (emptyOutputTokens === 0 && !hasContent) {
        log("orchestrator", `Agent ${stepKey} returned empty response — treating as retriable failure`, { agent: stepKey });
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
          cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens || 0,
          cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens || 0,
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
      const fallbackFiles = extractAndWriteFiles(step.agentName, result.content, projectPath, projectId, alreadyWritten, projectName);
      if (fallbackFiles.length > 0) {
        logWarn("orchestrator", `${step.agentName} used text fallback for ${fallbackFiles.length} files`);
      }
      const filesWritten = [...nativeFiles, ...fallbackFiles];

      // Diagnostic: warn when file-writing agent produces tokens but no files (possible truncation)
      const diagOutputTokens = result.tokenUsage?.outputTokens || 0;
      if (filesWritten.length === 0 && agentHasFileTools(step.agentName) && diagOutputTokens > 1000) {
        logWarn("orchestrator", `${stepKey} produced ${diagOutputTokens} output tokens but wrote 0 files — possible tool call truncation`);
      }

      break;
    } catch (err) {
      if (signal.aborted) {
        // On abort, finalize the provisional record with partial token data
        // instead of leaving the rough pre-flight estimate.
        if (provisionalIds) {
          if (err instanceof AgentAbortError && err.partialTokenUsage) {
            log("orchestrator", `Finalizing provisional billing on abort for ${stepKey} with partial tokens`, err.partialTokenUsage);
            finalizeTokenUsage(provisionalIds, {
              inputTokens: err.partialTokenUsage.inputTokens,
              outputTokens: err.partialTokenUsage.outputTokens,
              cacheCreationInputTokens: err.partialTokenUsage.cacheCreationInputTokens,
              cacheReadInputTokens: err.partialTokenUsage.cacheReadInputTokens,
            }, config.provider, config.model);
          } else {
            // No partial token data available — keep the provisional estimate.
            // A rough estimate is better than $0 which guarantees undercounting.
            log("orchestrator", `Keeping provisional estimate on abort for ${stepKey} (no partial token data)`);
          }
          provisionalIds = null;
        }
        break;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      logError("orchestrator", `Agent ${stepKey} attempt ${attempt} failed`, err, { agent: stepKey, attempt });

      // Decide whether to void, finalize, or keep the provisional billing record.
      // Check for partial token data attached by runAgent (from step-finish accumulator).
      if (provisionalIds) {
        const partialTokens = (err as Error & { partialTokenUsage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } })?.partialTokenUsage;

        if (partialTokens && (partialTokens.inputTokens > 0 || partialTokens.outputTokens > 0)) {
          // Agent consumed real tokens before crashing — finalize with actuals
          log("orchestrator", `Finalizing crashed-attempt billing for ${stepKey}`, partialTokens);
          finalizeTokenUsage(provisionalIds, partialTokens, config.provider, config.model);
        } else {
          const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          const likelyNoCharge = /connect|econnrefused|dns|etimedout|enotfound|socket hang up/i.test(errMsg);
          if (attempt < MAX_RETRIES || likelyNoCharge) {
            voidProvisionalUsage(provisionalIds);
          }
          // else: final attempt, likely charged but no token data — keep provisional estimate
        }
        provisionalIds = null;
      }

      // Check for non-retriable API errors (credit exhaustion, auth failure, etc.)
      const apiCheck = isNonRetriableApiError(err);
      if (apiCheck.nonRetriable) {
        log("orchestrator", `Non-retriable API error for ${stepKey}`, { agent: stepKey, reason: apiCheck.reason });
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

  if (signal.aborted) {
    await db.update(schema.agentExecutions)
      .set({ status: "stopped", completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));
    broadcastAgentStatus(chatId, stepKey, "stopped");
    log("orchestrator", `Agent ${stepKey} stopped by user`);
    return null;
  }

  if (!result) {
    const errorMsg = lastError?.message || "Unknown error";
    log("orchestrator", `Agent ${stepKey} failed after ${MAX_RETRIES} retries`, { agent: stepKey, retries: MAX_RETRIES, lastError: errorMsg });
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

  // Auto-exit version preview before running the pipeline
  if (isInPreview(projectPath)) {
    exitPreview(projectPath);
    broadcastFilesChanged(projectId, ["__checkout__"]);
    broadcast({ type: "preview_exited", payload: { projectId } });
  }

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

  // Auto-title: if chat has a generic title, generate a short title via LLM (fire-and-forget)
  if (chatTitle === "New Chat" || chatTitle === "Unknown" || /^Chat \d+$/.test(chatTitle)) {
    const titleConfig = getAgentConfigResolved("orchestrator:title");
    const titleModel = titleConfig ? resolveProviderModel(titleConfig, providers) : null;
    const titleApiKey = titleConfig ? apiKeys[titleConfig.provider] : null;
    if (titleModel && titleConfig && titleApiKey) {
      trackedGenerateText({
        model: titleModel,
        system: "Generate a short title (3-6 words, no quotes) for a chat based on the user's message. Just output the title, nothing else.",
        prompt: userMessage,
        maxOutputTokens: ORCHESTRATOR_CLASSIFY_MAX_TOKENS,
        agentName: "orchestrator:title",
        provider: titleConfig.provider,
        modelId: titleConfig.model,
        apiKey: titleApiKey,
        chatId, projectId, projectName, chatTitle,
      }).then(({ text }) => {
        const autoTitle = text.trim().replace(/^["']|["']$/g, "").slice(0, 60);
        if (!autoTitle) return;
        db.update(schema.chats)
          .set({ title: autoTitle, updatedAt: Date.now() })
          .where(eq(schema.chats.id, chatId))
          .run();
        log("orchestrator", `Auto-titled chat ${chatId}: "${autoTitle}"`);
        broadcast({ type: "chat_renamed", payload: { chatId, title: autoTitle } });
      }).catch(() => {
        // Non-critical — don't block pipeline
      });
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
  const classification = await classifyIntent(userMessage, hasFiles, providers, chatHistory);
  log("orchestrator", "Intent classified", { intent: classification.intent, scope: classification.scope, reasoning: classification.reasoning });

  // --- Preflight: verify only planned agents can resolve a provider model ---
  {
    const plannedAgents = getPlannedAgents(classification.intent as OrchestratorIntent, classification.scope as IntentScope, hasFiles);
    const preflightErrors = preflightValidatePlan(plannedAgents, providers);
    if (preflightErrors.length > 0) {
      abortControllers.delete(chatId);
      broadcastAgentError(chatId, "orchestrator", `Preflight check failed:\n${preflightErrors.join("\n")}`);
      broadcastAgentStatus(chatId, "orchestrator", "failed");
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
      const classifyCacheCreate = classification.tokenUsage.cacheCreationInputTokens || 0;
      const classifyCacheRead = classification.tokenUsage.cacheReadInputTokens || 0;
      trackTokenUsage({
        executionId: classifyExecId,
        chatId,
        agentName: "orchestrator:classify",
        provider: classification.tokenUsage.provider,
        model: classification.tokenUsage.model,
        apiKey: providerKey,
        inputTokens: classification.tokenUsage.inputTokens,
        outputTokens: classification.tokenUsage.outputTokens,
        cacheCreationInputTokens: classifyCacheCreate,
        cacheReadInputTokens: classifyCacheRead,
        projectId, projectName, chatTitle,
      });
      const classifyTotalTokens = classification.tokenUsage.inputTokens + classification.tokenUsage.outputTokens
        + classifyCacheCreate + classifyCacheRead;
      const classifyCostEst = estimateCost(
        classification.tokenUsage.provider, classification.tokenUsage.model,
        classification.tokenUsage.inputTokens, classification.tokenUsage.outputTokens,
        classifyCacheCreate, classifyCacheRead,
      );
      broadcastTokenUsage({
        chatId,
        projectId,
        agentName: "orchestrator:classify",
        provider: classification.tokenUsage.provider,
        model: classification.tokenUsage.model,
        inputTokens: classification.tokenUsage.inputTokens,
        outputTokens: classification.tokenUsage.outputTokens,
        totalTokens: classifyTotalTokens,
        cacheCreationInputTokens: classifyCacheCreate,
        cacheReadInputTokens: classifyCacheRead,
        costEstimate: classifyCostEst,
      });
    }
  } else if (classification.reasoning.includes("error")) {
    // Classification failed — the API call may have consumed tokens before erroring.
    // Record an estimated cost so billing isn't silently lost.
    const classifyConfig = getAgentConfigResolved("orchestrator:classify");
    if (classifyConfig) {
      const providerKey = apiKeys[classifyConfig.provider];
      if (providerKey) {
        const estimatedInputTokens = Math.ceil(userMessage.length / 4);
        trackBillingOnly({
          agentName: "orchestrator:classify",
          provider: classifyConfig.provider,
          model: classifyConfig.model,
          apiKey: providerKey,
          inputTokens: estimatedInputTokens,
          outputTokens: 0,
          projectId, projectName, chatTitle,
        });
      }
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

    log("orchestrator", `Question answered directly`, { chatId, chars: answer.length });
    broadcast({
      type: "chat_message",
      payload: { chatId, agentName: "orchestrator", content: answer },
    });

    broadcastAgentStatus(chatId, "orchestrator", "completed");
    abortControllers.delete(chatId);
    return;
  }

  // --- Fix mode: resolve flow template (handles all scopes via condition nodes) ---
  if (classification.intent === "fix" && hasFiles) {
    const scope = classification.scope as IntentScope;
    const projectSource = readProjectSource(projectPath);
    if (projectSource) {
      agentResults.set("project-source", projectSource);
    }

    // Resolve flow template — handles scope routing via condition nodes (no quick-edit bypass)
    let plan: ExecutionPlan;
    const fixTemplate = getActiveFlowTemplate("fix");
    if (fixTemplate) {
      log("orchestrator", `Using flow template "${fixTemplate.name}" for fix intent`);
      plan = resolveFlowTemplate(fixTemplate, {
        intent: "fix", scope, needsBackend: scope === "backend" || scope === "full",
        hasFiles: true, userMessage,
      });
      if (plan.steps.length === 0) {
        log("orchestrator", "Flow template resolved to empty plan — falling back to hardcoded");
        plan = buildFixPlan(userMessage, scope);
      }
    } else {
      plan = buildFixPlan(userMessage, scope);
    }

    // Persist pipeline run
    const pipelineRunId = nanoid();
    await db.insert(schema.pipelineRuns).values({
      id: pipelineRunId,
      chatId,
      intent: "fix",
      scope: classification.scope,
      userMessage,
      plannedAgents: JSON.stringify(plan.steps.map((s) => stepKey(s))),
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
    });

    // Broadcast pipeline plan so client knows which agents to display
    broadcast({
      type: "pipeline_plan",
      payload: { chatId, agents: plan.steps.map((s) => stepKey(s)) },
    });

    // Execute fix pipeline
    const pipelineOk = await executePipelineSteps({
      plan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
      providers, apiKeys, signal, pipelineRunId,
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

    await finishPipeline({ chatId, projectId, projectPath, agentResults, signal });

    await db.update(schema.pipelineRuns).set({ status: "completed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  // --- Build mode: resolve flow template and let it drive everything ---
  const buildTemplate = getActiveFlowTemplate("build");
  let plan: ExecutionPlan;
  if (buildTemplate) {
    log("orchestrator", `Using flow template "${buildTemplate.name}" for build intent`);
    plan = resolveFlowTemplate(buildTemplate, {
      intent: "build",
      scope: classification.scope,
      needsBackend: classification.scope === "backend" || classification.scope === "full",
      hasFiles: projectHasFiles(projectPath),
      userMessage,
    });
    if (plan.steps.length === 0) {
      log("orchestrator", "Flow template resolved to empty plan — falling back to hardcoded");
      plan = buildExecutionPlan(userMessage, "", "build", classification.scope);
    }
  } else {
    plan = buildExecutionPlan(userMessage, "", "build", classification.scope);
  }

  // Persist pipeline run
  const pipelineRunId = nanoid();
  const allStepIds = plan.steps.map((s) => stepKey(s));
  await db.insert(schema.pipelineRuns).values({
    id: pipelineRunId,
    chatId,
    intent: "build",
    scope: classification.scope,
    userMessage,
    plannedAgents: JSON.stringify(allStepIds),
    status: "running",
    startedAt: Date.now(),
    completedAt: null,
  });

  broadcast({
    type: "pipeline_plan",
    payload: { chatId, agents: allStepIds },
  });

  // Execute build pipeline — all steps driven by the flow template
  const pipelineOk = await executePipelineSteps({
    plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal, pipelineRunId,
  });
  if (!pipelineOk) {
    const postCheck = checkCostLimit(chatId);
    const pipelineStatus = !postCheck.allowed ? "interrupted" : "failed";
    await db.update(schema.pipelineRuns).set({ status: pipelineStatus, completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
    abortControllers.delete(chatId);
    return;
  }

  await finishPipeline({ chatId, projectId, projectPath, agentResults, signal });

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

  // For fix mode, inject project source if not already in results.
  // Quick-edit (styling/frontend) skips this to avoid huge prompt overhead.
  const isQuickFixResume = intent === "fix" && (scope === "styling" || scope === "frontend");
  if (intent === "fix" && !isQuickFixResume && !agentResults.has("project-source")) {
    const projectSource = readProjectSource(projectPath);
    if (projectSource) agentResults.set("project-source", projectSource);
  }

  // Rebuild execution plan
  let plan: ExecutionPlan;
  if (intent === "fix") {
    if (scope === "styling" || scope === "frontend") {
      const agentName: AgentName = scope === "styling" ? "styling" : "frontend-dev";
      plan = {
        steps: [{
          kind: "agent" as const,
          agentName,
          input: buildQuickEditInput(scope, originalMessage),
        }],
      };
    } else {
      const fixTmpl = getActiveFlowTemplate("fix");
      if (fixTmpl) {
        plan = resolveFlowTemplate(fixTmpl, {
          intent: "fix", scope, needsBackend: scope === "backend" || scope === "full",
          hasFiles: true, userMessage: originalMessage,
        });
        if (plan.steps.length === 0) plan = buildFixPlan(originalMessage, scope);
      } else {
        plan = buildFixPlan(originalMessage, scope);
      }
    }
  } else {
    // Build mode: resolve flow template and let it drive everything
    const buildTmpl = getActiveFlowTemplate("build");
    if (buildTmpl) {
      plan = resolveFlowTemplate(buildTmpl, {
        intent: "build",
        scope,
        needsBackend: scope === "backend" || scope === "full",
        hasFiles: projectHasFiles(projectPath),
        userMessage: originalMessage,
      });
      if (plan.steps.length === 0) plan = buildExecutionPlan(originalMessage, "", "build", scope);
    } else {
      plan = buildExecutionPlan(originalMessage, "", "build", scope);
    }
  }

  // Filter plan to only remaining steps
  const completedAgentNames = new Set(completedAgents);
  const remainingSteps = plan.steps.filter((s) => !completedAgentNames.has(isAgentStep(s) ? s.agentName : stepKey(s)));

  if (remainingSteps.length === 0) {
    // All agents completed — just run finish pipeline
    log("orchestrator", "All agents already completed — running finish pipeline");
  } else {
    // Broadcast pipeline plan showing all agents (completed + remaining)
    const allStepIds = plan.steps.map((s) => stepKey(s));
    broadcast({ type: "pipeline_plan", payload: { chatId, agents: allStepIds } });

    // Broadcast completed status for already-done agents
    for (const name of completedAgents) {
      broadcastAgentStatus(chatId, name, "completed");
    }

    // Execute remaining steps
    const remainingPlan: ExecutionPlan = { steps: remainingSteps, actionOverrides: plan.actionOverrides };
    const pipelineOk = await executePipelineSteps({
      plan: remainingPlan, chatId, projectId, projectPath, projectName, chatTitle,
      userMessage: originalMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
      providers, apiKeys, signal, pipelineRunId,
    });
    if (!pipelineOk) {
      await db.update(schema.pipelineRuns).set({ status: "failed", completedAt: Date.now() }).where(eq(schema.pipelineRuns.id, pipelineRunId));
      broadcastAgentError(chatId, "orchestrator", "Pipeline failed — one or more agents encountered errors.");
      broadcastAgentStatus(chatId, "orchestrator", "failed");
      abortControllers.delete(chatId);
      return;
    }
  }

  await finishPipeline({ chatId, projectId, projectPath, agentResults, signal });

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
  pipelineRunId?: string;
}): Promise<boolean> {
  const { plan, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
    providers, apiKeys, signal, pipelineRunId } = ctx;
  const actionOverrides = plan.actionOverrides;

  const completedSet = new Set<string>(
    agentResults.keys()
  );
  const remaining = [...plan.steps];

  // Log plan structure for parallel execution diagnosis
  log("orchestrator", "Starting pipeline steps", { stepCount: remaining.length, completedSet: [...completedSet] });
  for (const s of remaining) {
    const sk = stepKey(s);
    log("orchestrator", `  step: ${sk} (kind=${s.kind}${isAgentStep(s) ? `, agent=${s.agentName}` : ""}) dependsOn=[${(s.dependsOn || []).join(", ")}]`);
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
      log("orchestrator", "Pipeline deadlock detected", { blockedSteps: remaining.map((s) => stepKey(s)), completedSet: [...completedSet] });
      broadcastAgentError(chatId, "orchestrator", `Pipeline deadlock: ${remaining.map((s) => stepKey(s)).join(", ")} have unmet dependencies`);
      return false;
    }

    // Separate checkpoint, action, version, and agent steps
    const readyCheckpoints = ready.filter((s): s is CheckpointStep => s.kind === "checkpoint");
    const readyVersions = ready.filter((s): s is VersionStep => isVersionStep(s));
    const readyActions = ready.filter((s): s is ActionStep => isActionStep(s));
    const readyAgents = ready.filter((s): s is AgentStep => isAgentStep(s));

    // Process action steps first (fast, synchronous operations)
    for (const act of readyActions) {
      if (signal.aborted) break;
      const sk = stepKey(act);
      log("orchestrator", `Executing action step: ${act.actionKind}`, { instanceId: sk });
      broadcastAgentStatus(chatId, sk, "running");

      try {
        if (act.actionKind === "vibe-intake") {
          const projectData = await db
            .select({ vibeBrief: schema.projects.vibeBrief })
            .from(schema.projects)
            .where(eq(schema.projects.id, projectId))
            .get();
          if (projectData?.vibeBrief) {
            try {
              const vibe = JSON.parse(projectData.vibeBrief);
              const vibeJson = JSON.stringify(vibe, null, 2);
              agentResults.set("vibe-brief", vibeJson);

              // Surface as a chat message with structured metadata
              const lines: string[] = ["**Vibe Brief**"];
              if (vibe.adjectives?.length) lines.push(`**Feel:** ${vibe.adjectives.join(", ")}`);
              if (vibe.metaphor) lines.push(`**Metaphor:** ${vibe.metaphor}`);
              if (vibe.targetUser) lines.push(`**Target user:** ${vibe.targetUser}`);
              if (vibe.antiReferences?.length) lines.push(`**Avoid:** ${vibe.antiReferences.join(", ")}`);
              const vibeMessage = lines.join("\n");
              const vibeMetadata = {
                type: "vibe-brief",
                adjectives: vibe.adjectives || [],
                metaphor: vibe.metaphor || "",
                targetUser: vibe.targetUser || "",
                antiReferences: vibe.antiReferences || [],
              };
              await db.insert(schema.messages).values({
                id: nanoid(), chatId, role: "assistant",
                content: vibeMessage,
                agentName: "vibe-intake", metadata: JSON.stringify(vibeMetadata), createdAt: Date.now(),
              });
              broadcast({
                type: "chat_message",
                payload: { chatId, agentName: "vibe-intake", content: vibeMessage, metadata: vibeMetadata },
              });

              log("orchestrator", "Vibe brief injected via action step", { projectId });
            } catch {
              // Corrupt JSON — skip
            }
          }
        } else if (act.actionKind === "mood-analysis") {
          const moodResult = await analyzeMoodImages(projectPath, providers, apiKeys, signal, {
            systemPrompt: act.systemPrompt,
            maxOutputTokens: act.maxOutputTokens,
          });
          if (moodResult) {
            agentResults.set("mood-analysis", moodResult);

            // Collect mood image filenames for client display
            const moodDir = join(projectPath, "mood");
            const moodImages = existsSync(moodDir)
              ? readdirSync(moodDir).filter((f: string) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
              : [];

            // Surface as a chat message with structured metadata
            let moodMessage = "**Mood Analysis**\n";
            let moodData: Record<string, unknown> = {};
            try {
              const mood = JSON.parse(moodResult);
              moodData = mood;
              if (mood.palette?.length) moodMessage += `**Palette:** ${mood.palette.join(", ")}\n`;
              if (mood.styleDescriptors?.length) moodMessage += `**Style:** ${mood.styleDescriptors.join(", ")}\n`;
              if (mood.moodKeywords?.length) moodMessage += `**Mood:** ${mood.moodKeywords.join(", ")}\n`;
              if (mood.textureNotes) moodMessage += `**Textures:** ${mood.textureNotes}\n`;
              if (mood.typographyHints) moodMessage += `**Typography:** ${mood.typographyHints}\n`;
              if (mood.layoutPatterns) moodMessage += `**Layout:** ${mood.layoutPatterns}`;
            } catch {
              moodMessage += moodResult.slice(0, 500);
            }
            const moodMetadata = {
              type: "mood-analysis",
              data: moodData,
              images: moodImages,
            };
            await db.insert(schema.messages).values({
              id: nanoid(), chatId, role: "assistant",
              content: moodMessage,
              agentName: "mood-analysis", metadata: JSON.stringify(moodMetadata), createdAt: Date.now(),
            });
            broadcast({
              type: "chat_message",
              payload: { chatId, agentName: "mood-analysis", content: moodMessage, metadata: moodMetadata },
            });

            log("orchestrator", "Mood analysis injected via action step", { projectId });
          }
        } else if (act.actionKind === "build-check") {
          // Build check: run vite build, if errors → run build-fix agent up to maxAttempts
          const stepOverrides: ActionOverrides = { ...actionOverrides };
          if (act.timeoutMs !== undefined) stepOverrides.buildTimeoutMs = act.timeoutMs;
          if (act.maxUniqueErrors !== undefined) stepOverrides.maxUniqueErrors = act.maxUniqueErrors;
          const maxFixes = act.maxAttempts ?? effectiveSetting("maxBuildFixAttempts", actionOverrides);

          let buildErrors = await checkProjectBuild(projectPath, chatId, stepOverrides, projectName);
          let fixAttempt = 0;
          while (buildErrors && fixAttempt < maxFixes && !signal.aborted) {
            fixAttempt++;
            log("orchestrator", `Build check: fix attempt ${fixAttempt}/${maxFixes}`);
            const fixResult = await runBuildFix({
              buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
              userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal, actionOverrides: stepOverrides,
            });
            if (fixResult) {
              agentResults.set(`${sk}-fix-${fixAttempt}`, fixResult);
              completedAgents.push(`${sk} (build fix #${fixAttempt})`);
            }
            buildErrors = await checkProjectBuild(projectPath, undefined, stepOverrides, projectName);
          }
          if (!buildErrors) {
            broadcast({ type: "preview_ready", payload: { projectId } });
            maybeStartBackend(projectId, projectPath);
            agentResults.set(sk, "Build succeeded");
          } else {
            agentResults.set(sk, `Build failed: ${buildErrors.slice(0, 500)}`);
          }
        } else if (act.actionKind === "test-run") {
          // Test run: run vitest, if failures → fix + smart re-run, up to maxAttempts
          const stepOverrides: ActionOverrides = { ...actionOverrides };
          if (act.timeoutMs !== undefined) stepOverrides.testTimeoutMs = act.timeoutMs;
          if (act.maxTestFailures !== undefined) stepOverrides.maxTestFailures = act.maxTestFailures;
          if (act.maxUniqueErrors !== undefined) stepOverrides.maxUniqueErrors = act.maxUniqueErrors;
          const maxFixes = act.maxAttempts ?? 2;

          const hasTestFiles = testFilesExist(projectPath);
          if (hasTestFiles) {
            let testResult = await runProjectTests(projectPath, chatId, projectId, undefined, stepOverrides, projectName);
            let fixAttempt = 0;
            while (testResult && testResult.failed > 0 && fixAttempt < maxFixes && !signal.aborted) {
              fixAttempt++;
              log("orchestrator", `Test run: fix attempt ${fixAttempt}/${maxFixes}`);
              const testFixResult = await runBuildFix({
                buildErrors: formatTestFailures(testResult.failures, stepOverrides),
                chatId, projectId, projectPath, projectName, chatTitle,
                userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal, actionOverrides: stepOverrides,
              });
              if (testFixResult) {
                agentResults.set(`${sk}-fix-${fixAttempt}`, testFixResult);
                completedAgents.push(`${sk} (test fix #${fixAttempt})`);
              }
              // Smart re-run: only re-run failed test files
              const failedFiles = testResult.testDetails
                ?.filter((t) => t.status === "failed")
                .map((t) => t.suite)
                .filter((v, i, a) => a.indexOf(v) === i);
              testResult = await runProjectTests(projectPath, chatId, projectId, failedFiles, stepOverrides, projectName);
            }
            const passed = testResult ? testResult.passed : 0;
            const failed = testResult ? testResult.failed : 0;
            agentResults.set(sk, `Tests: ${passed} passed, ${failed} failed`);
          } else {
            const skipped = {
              chatId, projectId, passed: 0, failed: 0, total: 0, duration: 0,
              failures: [] as Array<{ name: string; error: string }>,
              testDetails: [] as Array<{ suite: string; name: string; status: "passed" | "failed" | "skipped"; error?: string; duration?: number }>,
              skipped: true, skipReason: "Tests skipped: no test files found",
            };
            broadcastTestResults(skipped);
            log("orchestrator", "Tests skipped: no test files found");
            agentResults.set(sk, "Tests skipped: no test files found");
          }
        } else if (act.actionKind === "remediation") {
          // Remediation: detect review issues → fix → re-review, up to maxAttempts cycles
          const stepOverrides: ActionOverrides = { ...actionOverrides };
          if (act.maxAttempts !== undefined) stepOverrides.maxRemediationCycles = act.maxAttempts;

          await runRemediationLoop({
            chatId, projectId, projectPath, projectName, chatTitle,
            userMessage, chatHistory, agentResults, completedAgents, callCounter,
            providers, apiKeys, signal, actionOverrides: stepOverrides,
          });
          agentResults.set(sk, "Remediation complete");
        } else if (act.actionKind === "summary") {
          // Summary: generate final recap using all agent outputs
          const buildCheckResult = agentResults.get("build-check") ?? "";
          const buildFailed = buildCheckResult.startsWith("Build failed");

          const summary = await generateSummary({
            userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys,
            buildFailed,
            customSystemPrompt: act.systemPrompt,
            customMaxOutputTokens: act.maxOutputTokens,
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
          agentResults.set(sk, summary);
        }

        broadcastAgentStatus(chatId, sk, "completed");
        completedSet.add(sk);
        completedAgents.push(sk);
      } catch (err) {
        logError("orchestrator", `Action step ${sk} failed`, err instanceof Error ? err.message : String(err));
        broadcastAgentStatus(chatId, sk, "failed");
        broadcastAgentError(chatId, sk, err instanceof Error ? err.message : String(err));
        return false;
      }
    }

    // Process checkpoint steps (one at a time — each pauses the pipeline)
    for (const cp of readyCheckpoints) {
      if (signal.aborted) break;
      const checkpointId = nanoid();
      const cpKey = stepKey(cp);
      log("orchestrator", `Processing checkpoint: ${cp.label}`, { checkpointId, type: cp.checkpointType });

      // Gather design options from architect output if this is a design_direction checkpoint
      let designOptions: import("../../shared/types.ts").DesignOption[] | undefined;
      if (cp.checkpointType === "design_direction") {
        const architectOutput = agentResults.get("architect");
        if (architectOutput) {
          designOptions = parseDesignOptions(architectOutput);
        }
      }

      // Broadcast awaiting status for the checkpoint step in the progress bar
      broadcastAgentStatus(chatId, cpKey, "awaiting_checkpoint");

      try {
        const selectedIndex = await awaitCheckpoint(chatId, checkpointId, cp, designOptions, pipelineRunId);
        log("orchestrator", `Checkpoint resolved: ${cp.label} → option ${selectedIndex}`);

        // For design_direction: splice the selected design_system into the architect output
        if (cp.checkpointType === "design_direction" && designOptions && designOptions.length > 0) {
          const selected = designOptions[selectedIndex] ?? designOptions[0]!;
          if (selected) spliceSelectedDesignSystem(agentResults, selected);
        }

        broadcast({
          type: "pipeline_checkpoint_resolved" as const,
          payload: { chatId, checkpointId, selectedIndex, timedOut: false },
        });
        broadcastAgentStatus(chatId, cpKey, "completed");
        completedSet.add(cpKey);
      } catch (err) {
        // Checkpoint rejected (pipeline aborted)
        broadcastAgentStatus(chatId, cpKey, "failed");
        log("orchestrator", `Checkpoint rejected: ${cp.label} — ${err}`);
        return false;
      }
    }

    if (signal.aborted) {
      await db.insert(schema.messages).values({
        id: nanoid(), chatId, role: "system",
        content: `Pipeline stopped by user. Completed agents: ${completedAgents.join(", ") || "none"}.`,
        agentName: "orchestrator", metadata: null, createdAt: Date.now(),
      });
      broadcastAgentStatus(chatId, "orchestrator", "stopped");
      return false;
    }

    // Process version steps (fast, synchronous — create a git snapshot)
    for (const vs of readyVersions) {
      if (signal.aborted) break;
      const vk = stepKey(vs);
      log("orchestrator", `Executing version step: ${vs.label}`, { instanceId: vk });
      broadcastAgentStatus(chatId, vk, "running");
      try {
        autoCommit(projectPath, vs.label);
        broadcastAgentStatus(chatId, vk, "completed");
        completedSet.add(vk);
      } catch (err) {
        // Non-fatal — log and continue (matches pipeline-end autoCommit pattern)
        logWarn("orchestrator", `Version step ${vk} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        broadcastAgentStatus(chatId, vk, "completed");
        completedSet.add(vk);
      }
    }

    // If only checkpoints/actions/versions were ready this round, continue to next iteration
    if (readyAgents.length === 0) {
      remaining.length = 0;
      remaining.push(...notReady);
      continue;
    }

    // For parallel batches (size > 1), skip per-agent build checks — run one after the batch
    const isParallelBatch = readyAgents.length > 1;
    const readyNames = readyAgents.map((s) => stepKey(s));
    log("orchestrator", `Running batch of ${readyAgents.length} step(s)`, { steps: readyNames, parallel: isParallelBatch });

    // Stagger parallel launches to avoid API rate-limit bursts
    const results = await Promise.all(
      readyAgents.map((step, i) =>
        new Promise<{ stepKey: string; result: string | null }>((resolve) =>
          setTimeout(async () => {
            const result = await runPipelineStep({
              step, chatId, projectId, projectPath, projectName, chatTitle,
              userMessage, chatHistory, agentResults, completedAgents, callCounter, buildFixCounter,
              providers, apiKeys, signal, actionOverrides,
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
          skippedAgents: notReady.map((s) => stepKey(s)),
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
 * Shared pipeline finish: cleanup and status broadcast.
 * All agent execution (remediation, build checks, summary) now lives in
 * the flow template as explicit action nodes — finishPipeline only handles
 * final status, cleanup, and auto-commit.
 */
async function finishPipeline(ctx: {
  chatId: string;
  projectId: string;
  projectPath: string;
  agentResults: Map<string, string>;
  signal: AbortSignal;
}): Promise<void> {
  const { chatId, projectId, projectPath, agentResults, signal } = ctx;

  // Determine build status from build-check results (if a build-check node ran)
  const buildCheckResult = agentResults.get("build-check") ?? "";
  const buildOk = !buildCheckResult.startsWith("Build failed");

  broadcastAgentStatus(chatId, "orchestrator", buildOk ? "completed" : "failed");

  // Final auto-commit after pipeline completes
  if (!signal.aborted) {
    try {
      autoCommit(projectPath, buildOk ? "Pipeline completed" : "Pipeline completed (with errors)");
    } catch { /* non-fatal */ }
  }
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

  // Build chat history section (same caps as buildSplitPrompt in base.ts)
  let historySection = "";
  if (chatHistory.length > 0) {
    const maxMessages = 6;
    const maxChars = 3_000;
    const recent = chatHistory.slice(-maxMessages);
    const lines: string[] = ["## Chat History"];
    let chars = 0;
    for (const msg of recent) {
      const line = `**${msg.role}:** ${msg.content}`;
      if (chars + line.length > maxChars) {
        lines.push("_(remaining history truncated)_");
        break;
      }
      lines.push(line);
      chars += line.length;
    }
    lines.push("");
    historySection = lines.join("\n");
  }

  const prompt = projectSource
    ? `${historySection}## Project Source\n${projectSource}${pipelineWarning}\n\n## Question\n${userMessage}`
    : `${historySection}## Question\n${userMessage}\n\n(This project has no files yet.)`;

  try {
    const providerKey = apiKeys[questionConfig.provider];
    if (!providerKey) return "No API key configured for the question model.";

    logLLMInput("orchestrator", "orchestrator-question", QUESTION_SYSTEM_PROMPT, prompt);
    const { text } = await trackedGenerateText({
      model: questionModel,
      system: QUESTION_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: QUESTION_MAX_OUTPUT_TOKENS,
      agentName: "orchestrator:question",
      provider: questionConfig.provider,
      modelId: questionConfig.model,
      apiKey: providerKey,
      chatId, projectId, projectName, chatTitle,
    });
    logBlock("orchestrator:question", "response", text);

    return text;
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

const SUMMARY_SYSTEM_PROMPT_FAILED = `You are the orchestrator for a page builder. The build has unresolved errors.
Write a clean, honest markdown response. Include:
- What was attempted and which files were created
- That the build has errors that could not be automatically resolved
- A brief mention of what the errors were (from agent outputs)
Keep it concise — 2-3 short paragraphs. Be direct but not alarming.
The tone: "We made progress but hit some issues that need attention."`;

interface SummaryInput {
  userMessage: string;
  agentResults: Map<string, string>;
  chatId: string;
  projectId: string;
  projectName: string;
  chatTitle: string;
  providers: ProviderInstance;
  apiKeys: Record<string, string>;
  buildFailed?: boolean;
  customSystemPrompt?: string;
  customMaxOutputTokens?: number;
}

async function generateSummary(input: SummaryInput): Promise<string> {
  const { userMessage, agentResults, chatId, projectId, projectName, chatTitle, providers, apiKeys, buildFailed, customSystemPrompt, customMaxOutputTokens } = input;
  const systemPrompt = customSystemPrompt ?? (buildFailed ? SUMMARY_SYSTEM_PROMPT_FAILED : SUMMARY_SYSTEM_PROMPT);

  const fallback = () => Array.from(agentResults.entries())
    .map(([agent, output]) => `**${agent}:** ${output}`)
    .join("\n\n");

  const summaryConfig = getAgentConfigResolved("orchestrator:summary");
  if (!summaryConfig) return fallback();
  const summaryModel = resolveProviderModel(summaryConfig, providers);
  if (!summaryModel) return fallback();
  const providerKey = apiKeys[summaryConfig.provider];
  if (!providerKey) return fallback();

  // Truncate each agent's output to 500 chars — summary only needs high-level view
  const digest = Array.from(agentResults.entries())
    .map(([agent, output]) => {
      const truncated = output.length > 500 ? output.slice(0, 500) + "\n... (truncated)" : output;
      return `### ${agent}\n${truncated}`;
    })
    .join("\n\n");

  const prompt = `## User Request\n${userMessage}\n\n## Agent Outputs\n${digest}`;

  try {
    logLLMInput("orchestrator", "orchestrator-summary", systemPrompt, prompt);
    const { text } = await trackedGenerateText({
      model: summaryModel,
      system: systemPrompt,
      prompt,
      maxOutputTokens: customMaxOutputTokens ?? SUMMARY_MAX_OUTPUT_TOKENS,
      agentName: "orchestrator:summary",
      provider: summaryConfig.provider,
      modelId: summaryConfig.model,
      apiKey: providerKey,
      chatId, projectId, projectName, chatTitle,
    });
    logBlock("orchestrator:summary", "response", text);
    return text;
  } catch (err) {
    logError("orchestrator", "Summary generation failed, using fallback", err);
    return fallback();
  }
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
  actionOverrides?: ActionOverrides;
}

/**
 * Iterative remediation loop: detects code-review/QA/security issues,
 * routes fixes to the correct dev agent(s) based on finding categories,
 * then re-runs code-review, security, and QA to verify. Repeats up to
 * maxRemediationCycles times or until all issues are resolved.
 */
async function runRemediationLoop(ctx: RemediationContext): Promise<void> {
  let previousIssueCount = Infinity;
  const maxCycles = effectiveSetting("maxRemediationCycles", ctx.actionOverrides);

  for (let cycle = 0; cycle < maxCycles; cycle++) {
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

  // Hoist provisional IDs so catch block can finalize billing on crash/abort
  const remProviderKey = ctx.apiKeys[config.provider];
  let remProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;

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
      maxOutputTokens: getPipelineSetting("buildFixMaxOutputTokens"),
      maxToolSteps: getPipelineSetting("buildFixMaxToolSteps"),
    });

    if (result.tokenUsage && remProviderKey && remProvisionalIds) {
      finalizeTokenUsage(remProvisionalIds, {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
      }, config.provider, config.model);
      remProvisionalIds = null;

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
        totalTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens || 0,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens || 0,
        costEstimate: costEst,
      });
    }

    await db.update(schema.agentExecutions)
      .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, executionId));

    ctx.agentResults.set(`${agentName}-remediation`, result.content);
    ctx.completedAgents.push(`${agentName} (remediation #${cycle})`);

    // Extract and write remediated files (hybrid: native + fallback)
    const nativeRemediation = result.filesWritten || [];
    const fallbackRemediation = extractAndWriteFiles(agentName, result.content, ctx.projectPath, ctx.projectId, new Set(nativeRemediation), ctx.projectName);
    const totalFiles = nativeRemediation.length + fallbackRemediation.length;

    return { content: result.content, filesWritten: totalFiles };
  } catch (err) {
    // Finalize billing with partial tokens if available, otherwise keep provisional estimate
    if (remProvisionalIds) {
      const partialTokens = (err instanceof AgentAbortError ? err.partialTokenUsage : (err as Error & { partialTokenUsage?: AgentAbortError["partialTokenUsage"] })?.partialTokenUsage);
      if (partialTokens && (partialTokens.inputTokens > 0 || partialTokens.outputTokens > 0)) {
        log("orchestrator", `Finalizing remediation billing on ${ctx.signal.aborted ? "abort" : "crash"} for ${agentName}`, partialTokens);
        finalizeTokenUsage(remProvisionalIds, partialTokens, config.provider, config.model);
      }
      // else: keep provisional estimate — better than $0
    }
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

  // Hoist provisional IDs so catch block can finalize billing on crash/abort
  const revProviderKey = ctx.apiKeys[config.provider];
  let revProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;

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
      revProvisionalIds = null;

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
        totalTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens || 0,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens || 0,
        costEstimate: costEst,
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
    // Finalize billing with partial tokens if available, otherwise keep provisional estimate
    if (revProvisionalIds) {
      const partialTokens = (err instanceof AgentAbortError ? err.partialTokenUsage : (err as Error & { partialTokenUsage?: AgentAbortError["partialTokenUsage"] })?.partialTokenUsage);
      if (partialTokens && (partialTokens.inputTokens > 0 || partialTokens.outputTokens > 0)) {
        log("orchestrator", `Finalizing re-review billing on ${ctx.signal.aborted ? "abort" : "crash"} for ${agentName}`, partialTokens);
        finalizeTokenUsage(revProvisionalIds, partialTokens, config.provider, config.model);
      }
      // else: keep provisional estimate — better than $0
    }
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

If recent conversation context is provided, use it to resolve pronouns and references (e.g., "them", "it", "those").

Tie-breaking: If ambiguous between build and fix, prefer "fix" when the project already has files.`;

const CLASSIFY_MAX_HISTORY_MESSAGES = 3;
const CLASSIFY_MAX_HISTORY_CHARS = 500;

/**
 * Build the prompt string for intent classification, optionally including
 * recent conversation context so the model can resolve pronouns/references.
 */
export function buildClassifyPrompt(
  userMessage: string,
  chatHistory: Array<{ role: string; content: string }> = [],
): string {
  if (!chatHistory || chatHistory.length === 0) return userMessage;

  const recent = chatHistory.slice(-CLASSIFY_MAX_HISTORY_MESSAGES);
  const lines: string[] = [];
  let chars = 0;
  for (const msg of recent) {
    const line = `${msg.role}: ${msg.content}`;
    if (chars + line.length > CLASSIFY_MAX_HISTORY_CHARS) {
      lines.push(`${msg.role}: ${msg.content.slice(0, CLASSIFY_MAX_HISTORY_CHARS - chars)}`);
      break;
    }
    lines.push(line);
    chars += line.length;
  }

  return `Recent conversation:\n${lines.join("\n")}\n\nCurrent message: ${userMessage}`;
}

/**
 * Classify the user's intent using the orchestrator model.
 * Fast-path: if no existing files, always returns "build" (skip API call).
 * Fallback: any error returns "build" (safe default).
 */
export async function classifyIntent(
  userMessage: string,
  hasExistingFiles: boolean,
  providers: ProviderInstance,
  chatHistory: Array<{ role: string; content: string }> = [],
): Promise<IntentClassification & {
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    provider: string;
    model: string;
  }
}> {
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
    const classifyPrompt = buildClassifyPrompt(userMessage, chatHistory);
    logLLMInput("orchestrator", "orchestrator-classify", INTENT_SYSTEM_PROMPT, classifyPrompt);
    const result = await generateText({
      model: classifyModel,
      system: INTENT_SYSTEM_PROMPT,
      prompt: classifyPrompt,
      maxOutputTokens: 100,
    });
    logLLMOutput("orchestrator", "orchestrator-classify", result.text);

    // Extract token usage BEFORE parsing — billing must be tracked even if parse fails
    const classifyCacheCreation = result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    const classifyCacheRead = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const classifyRawInput = result.usage.inputTokens || 0;
    const classifyInputTokens = result.usage.inputTokenDetails?.noCacheTokens
      ?? Math.max(0, classifyRawInput - classifyCacheCreation - classifyCacheRead);
    const tokenUsage = {
      inputTokens: classifyInputTokens,
      outputTokens: result.usage.outputTokens || 0,
      cacheCreationInputTokens: classifyCacheCreation,
      cacheReadInputTokens: classifyCacheRead,
      provider: classifyConfig.provider,
      model: classifyConfig.model,
    };

    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/m, "");
    let parsed: { intent?: string; scope?: string; reasoning?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logWarn("orchestrator", `Intent classification returned invalid JSON, defaulting to build`, { raw });
      return { intent: "build" as OrchestratorIntent, scope: "full" as IntentScope, reasoning: "Fallback: invalid JSON", tokenUsage };
    }
    const intent: OrchestratorIntent = ["build", "fix", "question"].includes(parsed.intent!) ? parsed.intent as OrchestratorIntent : "build";
    const scope: IntentScope = ["frontend", "backend", "styling", "full"].includes(parsed.scope!) ? parsed.scope as IntentScope : "full";

    log("orchestrator:classify", "classified", {
      intent, scope,
      model: classifyConfig.model,
      promptChars: userMessage.length,
      tokens: {
        input: classifyInputTokens,
        output: result.usage.outputTokens || 0,
        cacheCreate: classifyCacheCreation,
        cacheRead: classifyCacheRead,
      },
      rawResponse: raw,
    });

    return { intent, scope, reasoning: parsed.reasoning || "", tokenUsage };
  } catch (err) {
    logError("orchestrator", "Intent classification failed, defaulting to build", err);
    return { intent: "build", scope: "full", reasoning: "Fallback: classification error" };
  }
}

const READ_EXCLUDE_PATTERNS = /node_modules|dist|\.git|bun\.lockb|bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.ico|\.woff|\.ttf|\.eot/;

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
          kind: "agent" as const,
          agentName: "styling" as AgentName,
          input: buildQuickEditInput("styling", userMessage),
        }],
      };
    }
    if (scope === "frontend") {
      return {
        steps: [{
          kind: "agent" as const,
          agentName: "frontend-dev" as AgentName,
          input: buildQuickEditInput("frontend", userMessage),
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

  const steps: PlanStep[] = [
    {
      kind: "agent",
      agentName: "architect",
      input: `Design the component architecture and test plan based on the research agent's requirements (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["research"],
    },
    {
      kind: "agent",
      agentName: "frontend-dev",
      input: `Implement the React components defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your components following the plan. Original request: ${userMessage}`,
      dependsOn: ["architect"],
    },
  ];

  if (includeBackend) {
    steps.push({
      kind: "agent",
      agentName: "backend-dev",
      input: `Implement the backend API routes and server logic defined in the architect's plan (provided in Previous Agent Outputs). A test plan is included in the architect's output — write test files alongside your server code following the plan. Original request: ${userMessage}`,
      dependsOn: ["frontend-dev"],
    });
  }

  // Styling depends on all dev agents (waits for both if backend included)
  const stylingDeps: AgentName[] = includeBackend ? ["frontend-dev", "backend-dev"] : ["frontend-dev"];

  steps.push(
    {
      kind: "agent",
      agentName: "styling",
      input: `Apply design polish to the components created by frontend-dev, using the research requirements for design intent (both provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: stylingDeps,
    },
    // Review agents all depend on styling — they run in parallel with each other
    {
      kind: "agent",
      agentName: "code-review",
      input: `Review and fix all code generated by dev and styling agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      kind: "agent",
      agentName: "security",
      input: `Security review all code generated by the dev agents (provided in Previous Agent Outputs). Original request: ${userMessage}`,
      dependsOn: ["styling"],
    },
    {
      kind: "agent",
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

/** Check if the project has any test files on disk (.test./.spec. in src/ or server/, up to 3 levels deep) */
function testFilesExist(projectPath: string): boolean {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

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

  const dirsToSearch = [join(fullPath, "src"), join(fullPath, "server")];
  return dirsToSearch.some(dir => existsSync(dir) && searchDir(dir, 0));
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
  alreadyWritten?: Set<string>,
  projectName?: string,
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
      let content = file.content;
      // Strip blocked native-module packages from package.json in the fallback path
      if (file.path === "package.json" || file.path.endsWith("/package.json")) {
        const { cleaned, stripped } = stripBlockedPackages(content);
        if (stripped.length > 0) {
          logWarn("orchestrator", `Stripped blocked packages from ${file.path}: ${stripped.join(", ")}`);
          content = cleaned;
        }
      }
      writeFile(projectPath, file.path, content);
      written.push(file.path);
    } catch (err) {
      logError("orchestrator", `Failed to write ${file.path}`, err);
    }
  }

  // Check both native tool writes AND extracted writes for package.json changes.
  // Native write_file writes land in alreadyWritten (skipped above), so `written`
  // stays empty — but we still need to invalidate deps when package.json was touched.
  const hasPackageJsonNative = alreadyWritten
    ? Array.from(alreadyWritten).some(f => f === "package.json" || f.endsWith("/package.json"))
    : false;
  if (hasPackageJson || hasPackageJsonNative) {
    invalidateProjectDeps(projectPath);
  }

  if (written.length > 0) {
    broadcastFilesChanged(projectId, written);

    // After the first file-producing agent writes files, prepare project for preview
    // This runs in the background — doesn't block the pipeline
    // NOTE: preview_ready is NOT broadcast here — it's only sent after a successful build check
    if (!previewPrepStarted.has(projectId)) {
      previewPrepStarted.add(projectId);
      prepareProjectForPreview(projectPath, undefined, projectName)
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
async function checkProjectBuild(projectPath: string, chatId?: string, overrides?: ActionOverrides, projectName?: string): Promise<string | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Broadcast install phase so the UI isn't silent during bun install (~57s)
  if (chatId) {
    broadcastAgentThinking(chatId, "orchestrator", "Build System", "started");
    broadcastAgentThinking(chatId, "orchestrator", "Build System", "streaming", { chunk: "Installing dependencies..." });
  }

  // Wait for any pending preview prep (which includes bun install)
  const installError = await prepareProjectForPreview(projectPath, chatId, projectName);

  if (installError) {
    log("build", "Dependency install failed — skipping vite build check", { chars: installError.length });
    if (chatId) broadcastAgentThinking(chatId, "orchestrator", "Build System", "failed", { error: "Dependency install failed" });
    return `Dependency install failed:\n${installError}`;
  }

  if (chatId) {
    broadcastAgentThinking(chatId, "orchestrator", "Build System", "streaming", { chunk: "\nRunning build check..." });
  }

  log("build", "Running build check", { path: fullPath });

  try {
    const proc = Bun.spawn(["bunx", "vite", "build", "--mode", "development"], {
      cwd: fullPath,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    const buildTimeout = effectiveSetting("buildTimeoutMs", overrides);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), buildTimeout),
    );
    const result = await Promise.race([proc.exited, timeout]);

    if (result === "timeout") {
      logWarn("build", `Build check timed out after ${buildTimeout / 1000}s — killing process`);
      proc.kill();
      if (chatId) broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed", { summary: "Build check timed out (continuing)" });
      return null; // Don't block pipeline on timeout
    }

    const exitCode = result;
    if (exitCode === 0) {
      log("build", "Build check passed");
      if (chatId) broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed", { summary: "Build passed" });
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
    const deduped = deduplicateErrors(errorLines, overrides);
    const errors = (deduped || combined.slice(0, 2000)).trim();
    log("build", "Build failed", { exitCode, errorLines: errorLines.length, chars: errors.length });
    logBlock("build", "Build errors", errors);
    if (chatId) broadcastAgentThinking(chatId, "orchestrator", "Build System", "failed", { error: errors });
    return errors;
  } catch (err) {
    logError("build", "Build check process error", err);
    if (chatId) broadcastAgentThinking(chatId, "orchestrator", "Build System", "completed", { summary: "Build check skipped" });
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
  actionOverrides?: ActionOverrides;
}): Promise<string | null> {
  const { buildErrors, chatId, projectId, projectPath, projectName, chatTitle,
    userMessage, chatHistory, agentResults, callCounter, buildFixCounter, providers, apiKeys, signal, actionOverrides } = params;

  // Enforce per-pipeline build-fix attempt limit
  const maxBuildFixes = effectiveSetting("maxBuildFixAttempts", actionOverrides);
  if (buildFixCounter.value >= maxBuildFixes) {
    log("orchestrator", `Build fix limit reached (${maxBuildFixes}). Skipping to prevent runaway costs.`);
    broadcastAgentError(chatId, "orchestrator", `Build fix attempt limit reached (${maxBuildFixes}). Skipping further fixes.`);
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

  // Include project source so the fix agent can go straight to writing
  // instead of burning tool steps on read_file calls.
  const projectSource = readProjectSource(projectPath);
  const sourceSection = projectSource
    ? `\n\nHere is the current project source:\n\n${projectSource.slice(0, MAX_PROJECT_SOURCE_CHARS)}`
    : "";
  const fixPrompt = `The project has build errors that MUST be fixed before it can run. Here are the Vite build errors:\n\n\`\`\`\n${buildErrors}\n\`\`\`\n\nFix ALL the errors above. Do NOT use read_file or list_files — the full source is provided below. Write corrected files immediately.${sourceSection}`;

  // Hoist provisional IDs so catch block can finalize billing on crash/abort
  const bfProviderKey = apiKeys[config.provider];
  let bfProvisionalIds: { tokenUsageId: string; billingLedgerId: string } | null = null;

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
      maxOutputTokens: getPipelineSetting("buildFixMaxOutputTokens"),
      maxToolSteps: getPipelineSetting("buildFixMaxToolSteps"),
    });

    if (result.tokenUsage && bfProviderKey && bfProvisionalIds) {
      finalizeTokenUsage(bfProvisionalIds, {
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens,
      }, config.provider, config.model);
      bfProvisionalIds = null;

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
        totalTokens,
        cacheCreationInputTokens: result.tokenUsage.cacheCreationInputTokens || 0,
        cacheReadInputTokens: result.tokenUsage.cacheReadInputTokens || 0,
        costEstimate: costEst,
      });
    }

    await db.update(schema.agentExecutions)
      .set({ status: "completed", output: JSON.stringify(result), completedAt: Date.now() })
      .where(eq(schema.agentExecutions.id, execId));

    const nativeFix = result.filesWritten || [];
    extractAndWriteFiles(fixAgent, result.content, projectPath, projectId, new Set(nativeFix), projectName);

    broadcastAgentStatus(chatId, fixAgent, "completed", { phase: "build-fix" });
    return result.content;
  } catch (err) {
    // Finalize billing with partial tokens if available, otherwise keep provisional estimate
    if (bfProvisionalIds) {
      const partialTokens = (err instanceof AgentAbortError ? err.partialTokenUsage : (err as Error & { partialTokenUsage?: AgentAbortError["partialTokenUsage"] })?.partialTokenUsage);
      if (partialTokens && (partialTokens.inputTokens > 0 || partialTokens.outputTokens > 0)) {
        log("orchestrator", `Finalizing build-fix billing on ${signal.aborted ? "abort" : "crash"} for ${fixAgent}`, partialTokens);
        finalizeTokenUsage(bfProvisionalIds, partialTokens, config.provider, config.model);
      }
      // else: keep provisional estimate — better than $0
    }
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
  failedTestFiles?: string[],
  overrides?: ActionOverrides,
  projectName?: string,
): Promise<TestRunResult | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  // Ensure vitest config + deps are installed (handled by prepareProjectForPreview)
  await prepareProjectForPreview(projectPath, undefined, projectName);

  log("test", "Running tests", { path: fullPath });

  try {
    const jsonOutputFile = join(fullPath, "vitest-results.json");
    const vitestArgs = ["bunx", "vitest", "run", "--reporter=verbose", "--reporter=json", "--outputFile", jsonOutputFile];
    // Smart re-run: only run specific failed test files instead of full suite
    if (failedTestFiles && failedTestFiles.length > 0) {
      vitestArgs.push(...failedTestFiles);
      log("test", `Smart re-run: only running ${failedTestFiles.length} failed file(s)`);
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

    const testTimeout = effectiveSetting("testTimeoutMs", overrides);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), testTimeout),
    );
    const exitResult = await Promise.race([proc.exited, timeout]);

    if (exitResult === "timeout") {
      logWarn("test", `Test run timed out after ${testTimeout / 1000}s — killing process`);
      proc.kill();
      return null;
    }

    const exitCode = exitResult;
    const stderr = await new Response(proc.stderr).text();

    if (stderr.trim()) {
      logBlock("test", "Test stderr", stderr.trim().slice(0, 2000));
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

    log("test", "Test run completed", { passed: result.passed, failed: result.failed, total: result.total });
    return result;
  } catch (err) {
    logError("test", "Test runner error", err);
    return null;
  }
}
