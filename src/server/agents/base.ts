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
  "frontend-dev": 12,
  "backend-dev": 8,
  "styling": 8,
};
const DEFAULT_MAX_TOOL_STEPS = 10;

/** Resolve a human-readable display name for parallel frontend-dev instances. */
function resolveInstanceDisplayName(instanceId: string, fallback: string): string {
  if (instanceId === "frontend-dev-components") return "Frontend Dev";
  if (instanceId === "frontend-dev-app") return "Frontend Dev (App)";
  const match = instanceId.match(/^frontend-dev-(\d+)$/);
  if (match) return `Frontend Dev ${match[1]}`;
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
    const builtPrompt = buildPrompt(input);
    log("pipeline", `agent=${broadcastName} model=${config.model} prompt=${builtPrompt.length.toLocaleString()}chars system=${systemPrompt.length.toLocaleString()}chars tools=${tools ? Object.keys(tools).length : 0}`);
    logLLMInput("pipeline", broadcastName, systemPrompt, builtPrompt);

    const maxOutputTokens = overrides?.maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS[config.name] ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const maxToolSteps = overrides?.maxToolSteps ?? AGENT_MAX_TOOL_STEPS[config.name] ?? DEFAULT_MAX_TOOL_STEPS;
    const result = streamText({
      model: provider,
      system: systemPrompt,
      prompt: builtPrompt,
      maxOutputTokens,
      ...(tools ? { tools, stopWhen: stepCountIs(maxToolSteps) } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullText = "";
    let pendingChunk = "";
    let lastBroadcast = 0;
    const THROTTLE_MS = 150;
    const filesWritten: string[] = [];

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
          broadcast({
            type: "agent_thinking",
            payload: {
              chatId: cid,
              agentName: broadcastName,
              displayName: broadcastDisplayName,
              status: "streaming",
              toolCall: {
                toolName: part.toolName,
                input: part.toolName === "write_file" ? { path: (part.input as { path: string }).path } : part.input,
              },
            },
          });
          break;
        }
        case "tool-result": {
          const output = part.output as Record<string, unknown>;
          if (part.toolName === "write_file" && output?.success) {
            filesWritten.push((part.input as { path: string }).path);
          } else if (part.toolName === "write_files" && output?.success) {
            const paths = (output as { paths?: string[] }).paths || [];
            filesWritten.push(...paths);
          }
          break;
        }
        case "error": {
          logWarn("pipeline", `agent=${broadcastName} stream error event: ${JSON.stringify((part as { error: unknown }).error)}`);
          break;
        }
        case "step-finish" as string: {
          const stepPart = part as unknown as { finishReason: string; usage: { inputTokens: number; outputTokens: number } };
          log("pipeline", `agent=${broadcastName} step-finish: reason=${stepPart.finishReason} tokens=${JSON.stringify(stepPart.usage)}`);
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
      const response = await result.response;
      const status = response?.status;
      const headers = response?.headers;
      const retryAfter = headers?.["retry-after"];
      const requestId = headers?.["request-id"] || headers?.["x-request-id"];
      log("pipeline", `agent=${broadcastName} response: finishReason=${finishReason} status=${status} streamParts=${streamPartCount}${requestId ? ` requestId=${requestId}` : ""}${retryAfter ? ` retryAfter=${retryAfter}` : ""}`);
    } catch {
      log("pipeline", `agent=${broadcastName} response: finishReason=${finishReason} streamParts=${streamPartCount} (response metadata unavailable)`);
    }

    // Treat non-successful finish reasons as failures — the agent didn't complete its work
    if (finishReason === "other" || finishReason === "error") {
      broadcastAgentStatus(cid, broadcastName, "failed");
      broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed");
      throw new Error(`Agent stream ended with finishReason=${finishReason} (tool-use step likely failed)`);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (step as any).providerMetadata?.anthropic;
        if (meta && typeof meta === "object") {
          // Try both camelCase (AI SDK v4) and snake_case (raw Anthropic response)
          const creation = Number(meta.cacheCreationInputTokens ?? meta.cache_creation_input_tokens) || 0;
          const read = Number(meta.cacheReadInputTokens ?? meta.cache_read_input_tokens) || 0;
          if (creation > 0 || read > 0) {
            log("pipeline", `cache tokens step: creation=${creation} read=${read} keys=[${Object.keys(meta).join(", ")}]`);
          }
          cacheCreationInputTokens += creation;
          cacheReadInputTokens += read;
        }
      }
    } catch {
      // Provider metadata not available — continue with base tokens only
    }

    // inputTokens = non-cached input only; totalTokens includes all input types
    const inputTokens = usage?.inputTokens || 0;
    const outputTokens = usage?.outputTokens || 0;
    const totalInputTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

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
    broadcastAgentStatus(cid, broadcastName, "failed");
    broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "failed");
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

export function buildPrompt(input: AgentInput): string {
  const parts: string[] = [];
  const sizeBreakdown: Record<string, number> = {};

  if (input.chatHistory.length > 0) {
    parts.push("## Chat History");
    const historyStart = parts.join("\n").length;

    // Cap chat history: keep only last N messages, truncate to char limit
    let history = input.chatHistory;
    if (history.length > MAX_HISTORY_MESSAGES) {
      const omitted = history.length - MAX_HISTORY_MESSAGES;
      history = history.slice(-MAX_HISTORY_MESSAGES);
      parts.push(`_(${omitted} earlier messages omitted)_`);
    }

    let historyChars = 0;
    for (const msg of history) {
      const line = `**${msg.role}:** ${msg.content}`;
      if (historyChars + line.length > MAX_HISTORY_CHARS) {
        parts.push(`_(remaining history truncated — ${MAX_HISTORY_CHARS} char cap)_`);
        break;
      }
      parts.push(line);
      historyChars += line.length;
    }
    parts.push("");
    sizeBreakdown.chatHistory = parts.join("\n").length - historyStart;
  }

  if (input.context) {
    const { upstreamOutputs, ...rest } = input.context as Record<string, unknown>;

    if (Object.keys(rest).length > 0) {
      parts.push("## Context");
      parts.push(JSON.stringify(rest, null, 2));
      parts.push("");
    }

    if (upstreamOutputs && typeof upstreamOutputs === "object") {
      parts.push("## Previous Agent Outputs");
      for (const [agent, output] of Object.entries(upstreamOutputs as Record<string, string>)) {
        parts.push(`### ${agent}`);
        parts.push(String(output));
        parts.push("");
        sizeBreakdown[`upstream:${agent}`] = String(output).length;
      }
    }
  }

  parts.push("## Current Request");
  parts.push(input.userMessage);

  const prompt = parts.join("\n");

  // Log prompt size breakdown
  const breakdown = Object.entries(sizeBreakdown)
    .map(([k, v]) => `${k}=${v.toLocaleString()}`)
    .join(" ");
  log("pipeline", `prompt total=${prompt.length.toLocaleString()}chars ${breakdown}`);

  return prompt;
}
