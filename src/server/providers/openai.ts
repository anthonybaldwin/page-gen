import { createOpenAI } from "@ai-sdk/openai";

export function createOpenAIProvider(apiKey: string, baseURL?: string) {
  return createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export const OPENAI_MODELS = {
  standard: "gpt-5.2",
  reasoning: "gpt-5.2-pro",
} as const;
