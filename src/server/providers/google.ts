import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function createGoogleProvider(apiKey: string, baseURL?: string) {
  return createGoogleGenerativeAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export const GOOGLE_MODELS = {
  flash: "gemini-2.5-flash",
} as const;
