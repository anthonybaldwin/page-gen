import { streamText, stepCountIs, type ToolSet } from "ai";
import type { ProviderInstance } from "../providers/registry.ts";
import type { AgentConfig, AgentName } from "../../shared/types.ts";
import { broadcastAgentStatus, broadcastAgentStream, broadcastAgentThinking, broadcast } from "../ws.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { extractSummary } from "../../shared/summary.ts";

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
    const result = streamText({
      model: provider,
      system: systemPrompt,
      prompt: buildPrompt(input),
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

    const usage = await result.usage;

    // Extract Anthropic cache tokens from provider metadata
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    try {
      const response = await result.response;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respAny = response as any;
      const anthropicMeta = respAny?.providerMetadata?.anthropic;
      if (anthropicMeta && typeof anthropicMeta === "object") {
        cacheCreationInputTokens = Number(anthropicMeta.cacheCreationInputTokens) || 0;
        cacheReadInputTokens = Number(anthropicMeta.cacheReadInputTokens) || 0;
      }
    } catch {
      // Provider metadata not available — continue with base tokens only
    }

    // inputTokens = non-cached input only; totalTokens includes all input types
    const inputTokens = usage?.inputTokens || 0;
    const outputTokens = usage?.outputTokens || 0;
    const totalInputTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;

    const summary = extractSummary(fullText, config.name);

    broadcastAgentStatus(cid, broadcastName, "completed");
    broadcastAgentStream(cid, broadcastName, fullText);
    broadcastAgentThinking(cid, broadcastName, broadcastDisplayName, "completed", { summary });

    return {
      content: fullText,
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

function buildPrompt(input: AgentInput): string {
  const parts: string[] = [];

  if (input.chatHistory.length > 0) {
    parts.push("## Chat History");
    for (const msg of input.chatHistory) {
      parts.push(`**${msg.role}:** ${msg.content}`);
    }
    parts.push("");
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
      }
    }
  }

  parts.push("## Current Request");
  parts.push(input.userMessage);

  return parts.join("\n");
}
