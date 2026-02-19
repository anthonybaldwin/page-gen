import { streamText } from "ai";
import type { ProviderInstance } from "../providers/registry.ts";
import type { AgentConfig, AgentName } from "../../shared/types.ts";
import { broadcastAgentStatus, broadcastAgentStream, broadcastAgentThinking } from "../ws.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { extractSummary } from "../../shared/summary.ts";

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
  tools?: Record<string, unknown>,
  abortSignal?: AbortSignal,
  chatId?: string
): Promise<AgentOutput> {
  const systemPrompt = loadSystemPrompt(config.name);
  const provider = getProviderModel(config, providers);
  const cid = chatId || "";

  if (!provider) {
    throw new Error(`No provider available for agent ${config.name} (needs ${config.provider})`);
  }

  broadcastAgentStatus(cid, config.name, "running");
  broadcastAgentThinking(cid, config.name, config.displayName, "started");

  try {
    const result = streamText({
      model: provider,
      system: systemPrompt,
      prompt: buildPrompt(input),
      ...(tools ? { tools: tools as Record<string, never> } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullText = "";
    let pendingChunk = "";
    let lastBroadcast = 0;
    const THROTTLE_MS = 150;

    for await (const chunk of result.textStream) {
      fullText += chunk;
      pendingChunk += chunk;
      const now = Date.now();
      if (now - lastBroadcast >= THROTTLE_MS) {
        broadcastAgentThinking(cid, config.name, config.displayName, "streaming", { chunk: pendingChunk });
        pendingChunk = "";
        lastBroadcast = now;
      }
    }
    if (pendingChunk) {
      broadcastAgentThinking(cid, config.name, config.displayName, "streaming", { chunk: pendingChunk });
    }

    const usage = await result.usage;

    const summary = extractSummary(fullText, config.name);

    broadcastAgentStatus(cid, config.name, "completed");
    broadcastAgentStream(cid, config.name, fullText);
    broadcastAgentThinking(cid, config.name, config.displayName, "completed", { summary });

    return {
      content: fullText,
      tokenUsage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
      },
    };
  } catch (err) {
    broadcastAgentStatus(cid, config.name, "failed");
    broadcastAgentThinking(cid, config.name, config.displayName, "failed");
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
