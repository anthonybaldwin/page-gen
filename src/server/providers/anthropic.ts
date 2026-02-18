import { createAnthropic } from "@ai-sdk/anthropic";

export function createAnthropicProvider(apiKey: string, baseURL?: string) {
  return createAnthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export const ANTHROPIC_MODELS = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;
