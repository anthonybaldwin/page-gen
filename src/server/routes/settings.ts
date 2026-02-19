import { Hono } from "hono";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { generateText } from "ai";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export const LIMIT_DEFAULTS: Record<string, string> = {
  maxTokensPerChat: "500000",
  maxAgentCallsPerRun: "30",
  maxCostPerDay: "0",
  maxCostPerProject: "0",
};

/** Read a single limit from app_settings, seeding the default if missing. */
export function getLimit(key: string): number {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (row) return Number(row.value);
  const def = LIMIT_DEFAULTS[key];
  if (def === undefined) return 0;
  db.insert(schema.appSettings).values({ key, value: def }).run();
  return Number(def);
}

/** Read all limits, seeding any missing defaults. */
export function getAllLimits(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(LIMIT_DEFAULTS)) {
    result[key] = getLimit(key);
  }
  return result;
}

export const settingsRoutes = new Hono();

// Server settings — includes limits from app_settings
settingsRoutes.get("/", (c) => {
  const limits = getAllLimits();
  return c.json({
    maxSnapshotsPerProject: 10,
    defaultTokenLimit: limits.maxTokensPerChat,
    warningThreshold: 0.8,
    limits,
  });
});

// Upsert cost/usage limits
settingsRoutes.put("/limits", async (c) => {
  const body = await c.req.json<Record<string, string | number>>();
  const validKeys = Object.keys(LIMIT_DEFAULTS);
  const updated: Record<string, number> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!validKeys.includes(key)) continue;
    const strVal = String(value);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: strVal }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: strVal }).run();
    }
    updated[key] = Number(strVal);
  }

  return c.json({ ok: true, limits: getAllLimits() });
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
          maxOutputTokens: 16,
        });
        return c.json({ valid: true, provider: "anthropic" });
      }
      case "openai": {
        if (!providers.openai) return c.json({ error: "No OpenAI key provided" }, 400);
        await generateText({
          model: providers.openai("gpt-5.2"),
          prompt: "Say hi",
          maxOutputTokens: 16,
        });
        return c.json({ valid: true, provider: "openai" });
      }
      case "google": {
        if (!providers.google) return c.json({ error: "No Google key provided" }, 400);
        await generateText({
          model: providers.google("gemini-2.5-flash"),
          prompt: "Say hi",
          maxOutputTokens: 16,
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
