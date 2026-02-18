import { Hono } from "hono";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { generateText } from "ai";

export const settingsRoutes = new Hono();

// Server settings
settingsRoutes.get("/", (c) => {
  return c.json({
    maxSnapshotsPerProject: 10,
    defaultTokenLimit: 500_000,
    warningThreshold: 0.8,
  });
});

// Validate an API key by making a tiny request
settingsRoutes.post("/validate-key", async (c) => {
  const body = await c.req.json<{ provider: string }>();
  const keys = extractApiKeys(c);
  const providers = createProviders(keys);

  try {
    switch (body.provider) {
      case "anthropic": {
        if (!providers.anthropic) return c.json({ error: "No Anthropic key provided" }, 400);
        await generateText({
          model: providers.anthropic("claude-haiku-4-5-20251001"),
          prompt: "Say hi",
          maxOutputTokens: 5,
        });
        return c.json({ valid: true, provider: "anthropic" });
      }
      case "openai": {
        if (!providers.openai) return c.json({ error: "No OpenAI key provided" }, 400);
        await generateText({
          model: providers.openai("gpt-5.2"),
          prompt: "Say hi",
          maxOutputTokens: 5,
        });
        return c.json({ valid: true, provider: "openai" });
      }
      case "google": {
        if (!providers.google) return c.json({ error: "No Google key provided" }, 400);
        await generateText({
          model: providers.google("gemini-2.5-flash"),
          prompt: "Say hi",
          maxOutputTokens: 5,
        });
        return c.json({ valid: true, provider: "google" });
      }
      default:
        return c.json({ error: "Unknown provider" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    return c.json({ error: message }, 401);
  }
});
