import { streamText, stepCountIs, type ToolSet } from "ai";
import type { ProviderInstance } from "../providers/registry.ts";
import type { AgentConfig, AgentName } from "../../shared/types.ts";
import { broadcastAgentStatus, broadcastAgentStream, broadcastAgentThinking, broadcast } from "../ws.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { extractSummary, stripTrailingJson } from "../../shared/summary.ts";
import { log, logWarn, logBlock, logLLMInput, logLLMOutput } from "../services/logger.ts";
import { extractAnthropicCacheTokens } from "../services/provider-metadata.ts";

/**
 * Extract safe, structured fields from an error for logging.
 * Strips requestBodyValues (full prompts) and other large/sensitive fields
 * that AI SDK APICallError includes.
 */
function sanitizeErrorForLog(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  const e = err as Record<string, unknown>;
  const safe: Record<string, unknown> = { name: err.name, message: err.message.slice(0, 300) };
  if (typeof e.statusCode === "number") safe.statusCode = e.statusCode;
  if (typeof e.url === "string") safe.url = redactUrlKeys(e.url);
  if (typeof e.requestBodyValues === "object" && e.requestBodyValues) {
    const body = e.requestBodyValues as Record<string, unknown>;
    safe.requestModel = body.model;
    safe.requestMaxTokens = body.max_tokens;
  }
  if (typeof e.responseBody === "string") {
    safe.responseBody = e.responseBody.slice(0, 500);
  }
  return safe;
}

/** Redact API keys from URLs (e.g., Google AI uses ?key=... query params). */
function redactUrlKeys(url: string): string {
  return url.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
}

/**
 * Extract a user-friendly error message from AI SDK errors.
 * APICallError includes statusCode, responseBody, etc. — parse those
 * instead of showing the raw (often huge/generic) message.
 */
function formatUserFacingError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Record<string, unknown>;

  // AI SDK APICallError has statusCode and responseBody
  const statusCode = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const responseBody = typeof e.responseBody === "string" ? e.responseBody : undefined;

  // Try to extract the API error type/message from the response body
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody);
      const apiError = parsed?.error;
      if (apiError?.type && apiError?.message) {
        const prefix = statusCode ? `API error ${statusCode}` : "API error";
        return `${prefix}: ${apiError.message} (${apiError.type})`;
      }
    } catch { /* not JSON */ }
  }

  // Map common HTTP status codes to clear messages
  if (statusCode) {
    const msg = err.message || "";
    if (statusCode === 401) return "API authentication failed — check your API key.";
    if (statusCode === 402) return "API credits exhausted — check your account balance.";
    if (statusCode === 403) return "API access forbidden — check your API key permissions.";
    if (statusCode === 429) return "API rate limit exceeded — please wait and retry.";
    if (statusCode === 500) return "API server error — the provider is experiencing issues.";
    if (statusCode === 529 || statusCode === 503) return "API is temporarily overloaded — please retry shortly.";
    return `API error (${statusCode}): ${msg.slice(0, 200)}`;
  }

  // For non-API errors, use the message but cap length
  return err.message.length > 200 ? err.message.slice(0, 200) + "..." : err.message;
}

/** Per-agent output token caps to reduce chattiness and speed up generation. */
const AGENT_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "research": 3000,
  "architect": 12000,   // large JSON architecture doc — truncation breaks file_plan parsing
  "frontend-dev": 64000, // large write_files calls with many components need ~40k tokens
  "backend-dev": 32000,  // multi-file writes can exceed 12k easily
  "styling": 32000,      // bulk style changes across many files
  "code-review": 2048,
  "security": 2048,
  "qa": 2048,
  "testing": 2048,
};
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Per-agent tool step limits — fewer steps = less context resend overhead. */
const AGENT_MAX_TOOL_STEPS: Record<string, number> = {
  "frontend-dev": 8,
  "backend-dev": 8,
  "styling": 8,
};
const DEFAULT_MAX_TOOL_STEPS = 10;

/** Resolve a human-readable display name for an agent instance. */
function resolveInstanceDisplayName(instanceId: string, fallback: string): string {
  return fallback;
}

export interface AgentInput {
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  projectPath: string;
  context?: Record<string, unknown>;
}

export interface AgentOutput {
  content: string;
  filesWritten?: string[];
  metadata?: Record<string, unknown>;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

export function loadSystemPrompt(agentName: AgentName): string {
  // Check DB override first
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${agentName}.prompt`)).get();
  if (row?.value) return row.value;

  // Fall back to .md file
  try {
    const promptPath = join(import.meta.dir, "prompts", `${agentName}.md`);
    return readFileSync(promptPath, "utf-8");
  } catch {
    return `You are the ${agentName} agent. Follow instructions carefully.`;
  }
}

export async function runAgent(
  config: AgentConfig,
  providers: ProviderInstance,
  input: AgentInput,
  tools?: ToolSet,
  abortSignal?: AbortSignal,
  chatId?: string,
  instanceId?: string,
  overrides?: { maxOutputTokens?: number; maxToolSteps?: number }
): Promise<AgentOutput> {
  const systemPrompt = loadSystemPrompt(config.name);
  const provider = getProviderModel(config, providers);
  const cid = chatId || "";
  // Use instanceId for broadcasting (distinguishes parallel instances), base name for config
  const broadcastName = instanceId ?? config.name;
  const broadcastDisplayName = instanceId ? resolveInstanceDisplayName(instanceId, config.displayName) : config.displayName;

  if (!provider) {
    throw new Error(`No provider available for agent ${config.name} (needs ${config.provider})`);
  }

  broadcastAgentStatus(cid, broadcastName, "running");
  broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "started");

  try {
    const { cacheablePrefix, dynamicSuffix } = buildSplitPrompt(input);
    const builtPrompt = cacheablePrefix ? `${cacheablePrefix}\n${dynamicSuffix}` : dynamicSuffix;
    log("pipeline", `agent=${broadcastName} starting`, {
      agent: broadcastName, model: config.model,
      promptChars: builtPrompt.length, systemChars: systemPrompt.length,
      toolCount: tools ? Object.keys(tools).length : 0,
    });
    logLLMInput("pipeline", broadcastName, systemPrompt, builtPrompt);

    const maxOutputTokens = overrides?.maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS[config.name] ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const maxToolSteps = overrides?.maxToolSteps ?? AGENT_MAX_TOOL_STEPS[config.name] ?? DEFAULT_MAX_TOOL_STEPS;
    const isAnthropic = config.provider === "anthropic";

    // For Anthropic: use SystemModelMessage with cache_control and split user messages
    // For other providers: keep the simple system + prompt format
    const result = streamText({
      model: provider,
      ...(isAnthropic
        ? {
            system: {
              role: "system" as const,
              content: systemPrompt,
              providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
            },
            messages: [{
              role: "user" as const,
              content: cacheablePrefix
                ? [
                    {
                      type: "text" as const,
                      text: cacheablePrefix,
                      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
                    },
                    { type: "text" as const, text: dynamicSuffix },
                  ]
                : [{ type: "text" as const, text: dynamicSuffix }],
            }],
          }
        : {
            system: systemPrompt,
            prompt: builtPrompt,
          }),
      maxOutputTokens,
      ...(tools ? { tools, stopWhen: stepCountIs(maxToolSteps) } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullText = "";
    let pendingChunk = "";
    let lastBroadcast = 0;
    const THROTTLE_MS = 150;
    const filesWritten: string[] = [];
    let streamErrorCount = 0;
    const MAX_STREAM_ERRORS = 3;

    let streamPartCount = 0;
    for await (const part of result.fullStream) {
      streamPartCount++;
      switch (part.type) {
        case "text-delta": {
          fullText += part.text;
          pendingChunk += part.text;
          const now = Date.now();
          if (now - lastBroadcast >= THROTTLE_MS) {
            broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "streaming", { chunk: pendingChunk });
            pendingChunk = "";
            lastBroadcast = now;
          }
          break;
        }
        case "tool-call": {
          // Broadcast tool activity so UI can show what the agent is doing
          const toolName = part.toolName;
          log("tool", `${broadcastName} called ${toolName}`, {
            tool: toolName,
            ...(toolName !== "write_file" && toolName !== "write_files"
              ? { input: JSON.stringify(part.input).slice(0, 200) }
              : { path: (part.input as { path?: string }).path }),
          });
          broadcast({
            type: "agent_thinking",
            payload: {
              chatId: cid,
              agentName: broadcastName,
              displayName: broadcastDisplayName,
              status: "streaming",
              toolCall: {
                toolName,
                input: toolName === "write_file"
                  ? { path: (part.input as { path: string }).path }
                  : toolName === "write_files"
                  ? { paths: (part.input as { files: Array<{ path: string }> }).files.map(f => f.path) }
                  : part.input,
              },
            },
          });
          break;
        }
        case "tool-result": {
          const output = part.output as Record<string, unknown>;
          log("tool", `${broadcastName} tool result: ${part.toolName}`, { tool: part.toolName, success: !!output?.success });
          if (part.toolName === "write_file" && output?.success) {
            filesWritten.push((part.input as { path: string }).path);
          } else if (part.toolName === "write_files" && output?.success) {
            const paths = (output as { paths?: string[] }).paths || [];
            filesWritten.push(...paths);
          }
          break;
        }
        case "error": {
          streamErrorCount++;
          const rawError = (part as { error: unknown }).error;
          const safeDetail = sanitizeErrorForLog(rawError);
          logWarn("pipeline", `agent=${broadcastName} stream error (${streamErrorCount}/${MAX_STREAM_ERRORS})`, safeDetail);
          if (streamErrorCount >= MAX_STREAM_ERRORS) {
            // Throw the original error so formatUserFacingError can parse APICallError fields
            if (rawError instanceof Error) throw rawError;
            throw new Error(`Agent stream hit ${MAX_STREAM_ERRORS} errors. ${formatUserFacingError(rawError)}`);
          }
          break;
        }
        case "step-finish" as string: {
          const stepPart = part as unknown as { finishReason: string; usage: { inputTokens: number; outputTokens: number } };
          log("pipeline", `agent=${broadcastName} step-finish`, {
            agent: broadcastName, finishReason: stepPart.finishReason,
            inputTokens: stepPart.usage.inputTokens, outputTokens: stepPart.usage.outputTokens,
          });
          break;
        }
      }
    }

    // Flush remaining text
    if (pendingChunk) {
      broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "streaming", { chunk: pendingChunk });
    }

    // Log finish reason and response metadata for diagnosing silent API failures
    const finishReason = await result.finishReason;
    try {
      const response = await result.response as Record<string, unknown>;
      const status = response?.status;
      const headers = response?.headers as Record<string, string> | undefined;
      const retryAfter = headers?.["retry-after"];
      const requestId = headers?.["request-id"] || headers?.["x-request-id"];
      log("pipeline", `agent=${broadcastName} response`, {
        agent: broadcastName, finishReason, status, streamPartCount,
        ...(requestId ? { requestId } : {}),
        ...(retryAfter ? { retryAfter } : {}),
      });
    } catch {
      log("pipeline", `agent=${broadcastName} response`, {
        agent: broadcastName, finishReason, streamPartCount, metadataUnavailable: true,
      });
    }

    // Treat non-successful finish reasons as failures — the agent didn't complete its work
    if (finishReason === "other" || finishReason === "error") {
      const errorMessage = `Agent stream ended with finishReason=${finishReason} (tool-use step likely failed)`;
      broadcastAgentStatus(cid, broadcastName, "failed");
      broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed", { error: errorMessage });
      throw new Error(errorMessage);
    }

    // finishReason=length means output was truncated. Behavior depends on agent type:
    // - Review agents (code-review, qa, security): output must be complete — fail
    // - Tool-writing agents: acceptable only if files were written (work is on disk)
    // - Others: fail and retry
    if (finishReason === "length") {
      const REVIEW_AGENTS = new Set(["code-review", "qa", "security"]);
      if (REVIEW_AGENTS.has(config.name)) {
        const errorMessage = `Review agent "${config.name}" output was truncated (finishReason=length) — output must be complete`;
        broadcastAgentStatus(cid, broadcastName, "failed");
        broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed", { error: errorMessage });
        throw new Error(errorMessage);
      }
      const TOOL_AGENTS = new Set(["frontend-dev", "backend-dev", "styling"]);
      if (TOOL_AGENTS.has(config.name) && filesWritten.length > 0) {
        logWarn("pipeline", `agent=${broadcastName} truncated (finishReason=length) but ${filesWritten.length} files written — accepting`);
      } else {
        const errorMessage = `Agent "${config.name}" output was truncated (finishReason=length) with no files written — failing`;
        broadcastAgentStatus(cid, broadcastName, "failed");
        broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed", { error: errorMessage });
        throw new Error(errorMessage);
      }
    }

    // Use totalUsage to aggregate tokens across ALL steps (not just the last one).
    // Multi-step tool-use agents re-send full context each step, so result.usage
    // (last step only) dramatically undercounts actual token consumption.
    const usage = await result.totalUsage;

    // Aggregate Anthropic cache tokens from ALL steps, not just the last response
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    try {
      const steps = await result.steps;
      for (const step of steps) {
        const { cacheCreationInputTokens: creation, cacheReadInputTokens: read } = extractAnthropicCacheTokens(step);
        if (creation > 0 || read > 0) {
          log("pipeline", `agent=${broadcastName} cache tokens step`, { agent: broadcastName, cacheCreation: creation, cacheRead: read });
        }
        cacheCreationInputTokens += creation;
        cacheReadInputTokens += read;
      }
    } catch {
      // Provider metadata not available — continue with base tokens only
    }

    // AI SDK's usage.inputTokens includes cache tokens in the total.
    // Subtract cache tokens to get the non-cached input count that estimateCost expects.
    const rawInputTokens = usage?.inputTokens || 0;
    const inputTokens = Math.max(0, rawInputTokens - cacheCreationInputTokens - cacheReadInputTokens);
    const outputTokens = usage?.outputTokens || 0;
    const totalInputTokens = rawInputTokens;

    // Strip trailing JSON summaries (e.g. { "files_written": [...] }) before broadcast
    const cleanText = stripTrailingJson(fullText);
    const summary = extractSummary(cleanText, config.name);

    log("pipeline", `agent=${broadcastName} completed`, {
      outputChars: cleanText.length,
      filesWritten: filesWritten.length,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheCreate: cacheCreationInputTokens,
        cacheRead: cacheReadInputTokens,
        total: totalInputTokens + outputTokens,
      },
    });
    logBlock("pipeline", `agent=${broadcastName} output`, cleanText);
    logLLMOutput("pipeline", broadcastName, cleanText);

    broadcastAgentStatus(cid, broadcastName, "completed");
    broadcastAgentStream(cid, broadcastName, cleanText);
    broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "completed", { summary });

    return {
      content: cleanText,
      filesWritten: filesWritten.length > 0 ? filesWritten : undefined,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: totalInputTokens + outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      },
    };
  } catch (err) {
    const userMessage = formatUserFacingError(err);
    broadcastAgentStatus(cid, broadcastName, "failed");
    broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed", { error: userMessage });
    throw err;
  }
}

function getProviderModel(config: AgentConfig, providers: ProviderInstance) {
  switch (config.provider) {
    case "anthropic":
      return providers.anthropic?.(config.model);
    case "openai":
      return providers.openai?.(config.model);
    case "google":
      return providers.google?.(config.model);
    default:
      return null;
  }
}

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 3_000;

export interface SplitPrompt {
  /** Cacheable prefix: chat history + context + upstream outputs (stable across tool-use turns) */
  cacheablePrefix: string;
  /** Dynamic suffix: current request (changes each turn) */
  dynamicSuffix: string;
}

export function buildPrompt(input: AgentInput): string {
  const { cacheablePrefix, dynamicSuffix } = buildSplitPrompt(input);
  return cacheablePrefix ? `${cacheablePrefix}\n${dynamicSuffix}` : dynamicSuffix;
}

export function buildSplitPrompt(input: AgentInput): SplitPrompt {
  const prefixParts: string[] = [];
  const sizeBreakdown: Record<string, number> = {};

  if (input.chatHistory.length > 0) {
    prefixParts.push("## Chat History");
    const historyStart = prefixParts.join("\n").length;

    // Cap chat history: keep only last N messages, truncate to char limit
    let history = input.chatHistory;
    if (history.length > MAX_HISTORY_MESSAGES) {
      const omitted = history.length - MAX_HISTORY_MESSAGES;
      history = history.slice(-MAX_HISTORY_MESSAGES);
      prefixParts.push(`_(${omitted} earlier messages omitted)_`);
    }

    let historyChars = 0;
    for (const msg of history) {
      const line = `**${msg.role}:** ${msg.content}`;
      if (historyChars + line.length > MAX_HISTORY_CHARS) {
        prefixParts.push(`_(remaining history truncated — ${MAX_HISTORY_CHARS} char cap)_`);
        break;
      }
      prefixParts.push(line);
      historyChars += line.length;
    }
    prefixParts.push("");
    sizeBreakdown.chatHistory = prefixParts.join("\n").length - historyStart;
  }

  if (input.context) {
    const { upstreamOutputs, ...rest } = input.context as Record<string, unknown>;

    if (Object.keys(rest).length > 0) {
      prefixParts.push("## Context");
      prefixParts.push(JSON.stringify(rest, null, 2));
      prefixParts.push("");
    }

    if (upstreamOutputs && typeof upstreamOutputs === "object") {
      prefixParts.push("## Previous Agent Outputs");
      for (const [agent, output] of Object.entries(upstreamOutputs as Record<string, string>)) {
        prefixParts.push(`### ${agent}`);
        prefixParts.push(String(output));
        prefixParts.push("");
        sizeBreakdown[`upstream:${agent}`] = String(output).length;
      }
    }
  }

  const cacheablePrefix = prefixParts.join("\n");
  const dynamicSuffix = `## Current Request\n${input.userMessage}`;

  // Log prompt size breakdown
  const totalLen = cacheablePrefix.length + (cacheablePrefix ? 1 : 0) + dynamicSuffix.length;
  log("pipeline", "prompt size breakdown", {
    totalChars: totalLen, prefixChars: cacheablePrefix.length, ...sizeBreakdown,
  });

  return { cacheablePrefix, dynamicSuffix };
}
