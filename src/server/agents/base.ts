import { streamText, stepCountIs, type ToolSet } from "ai";
import type { ProviderInstance } from "../providers/registry.ts";
import type { AgentConfig, AgentName } from "../../shared/types.ts";
import { broadcastAgentStatus, broadcastAgentStream, broadcastAgentThinking, broadcast } from "../ws.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { extractSummary, stripTrailingJson } from "../../shared/summary.ts";
import { log, logBlock, logLLMInput, logLLMOutput } from "../services/logger.ts";

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
  instanceId?: string
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

    const result = streamText({
      model: provider,
      system: systemPrompt,
      prompt: builtPrompt,
      ...(tools ? { tools, stopWhen: stepCountIs(15) } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullText = "";
    let pendingChunk = "";
    let lastBroadcast = 0;
    const THROTTLE_MS = 150;
    const filesWritten: string[] = [];

    for await (const part of result.fullStream) {
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
          }
          break;
        }
      }
    }

    // Flush remaining text
    if (pendingChunk) {
      broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "streaming", { chunk: pendingChunk });
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
          cacheCreationInputTokens += Number(meta.cacheCreationInputTokens) || 0;
          cacheReadInputTokens += Number(meta.cacheReadInputTokens) || 0;
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

export function buildPrompt(input: AgentInput): string {
  const parts: string[] = [];
  const sizeBreakdown: Record<string, number> = {};

  if (input.chatHistory.length > 0) {
    parts.push("## Chat History");
    const historyStart = parts.join("\n").length;
    for (const msg of input.chatHistory) {
      parts.push(`**${msg.role}:** ${msg.content}`);
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
