import { streamText } from "ai";
import type { ProviderInstance } from "../providers/registry.ts";
import type { AgentConfig, AgentName } from "../../shared/types.ts";
import { broadcastAgentStatus, broadcastAgentStream, broadcastAgentThinking } from "../ws.ts";
import { readFileSync } from "fs";
import { join } from "path";

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

function loadSystemPrompt(agentName: AgentName): string {
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
  abortSignal?: AbortSignal
): Promise<AgentOutput> {
  const systemPrompt = loadSystemPrompt(config.name);
  const provider = getProviderModel(config, providers);

  if (!provider) {
    throw new Error(`No provider available for agent ${config.name} (needs ${config.provider})`);
  }

  broadcastAgentStatus(config.name, "running");
  broadcastAgentThinking(config.name, config.displayName, "started");

  try {
    const result = streamText({
      model: provider,
      system: systemPrompt,
      prompt: buildPrompt(input),
      ...(tools ? { tools: tools as Record<string, never> } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    });

    let fullText = "";
    for await (const chunk of result.textStream) {
      fullText += chunk;
      broadcastAgentThinking(config.name, config.displayName, "streaming", { chunk });
    }

    const usage = await result.usage;

    // Build summary: first sentence, max 120 chars
    const firstSentence = fullText.split(/[.!?\n]/)[0]?.trim() || "";
    const summary = firstSentence.length > 120 ? firstSentence.slice(0, 117) + "..." : firstSentence;

    broadcastAgentStatus(config.name, "completed");
    broadcastAgentStream(config.name, fullText);
    broadcastAgentThinking(config.name, config.displayName, "completed", { summary });

    return {
      content: fullText,
      tokenUsage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
      },
    };
  } catch (err) {
    broadcastAgentStatus(config.name, "failed");
    broadcastAgentThinking(config.name, config.displayName, "failed");
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
    parts.push("## Context");
    parts.push(JSON.stringify(input.context, null, 2));
    parts.push("");
  }

  parts.push("## Current Request");
  parts.push(input.userMessage);

  return parts.join("\n");
}
