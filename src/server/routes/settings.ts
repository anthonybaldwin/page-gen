import { Hono } from "hono";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { generateText } from "ai";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { getAllAgentConfigs, resetAgentOverrides, getAllAgentToolConfigs, resetAgentToolOverrides } from "../agents/registry.ts";
import { loadSystemPrompt } from "../agents/base.ts";
import { trackBillingOnly } from "../services/token-tracker.ts";
import { getAllPricing, getModelPricing, upsertPricing, deletePricingOverride, DEFAULT_PRICING } from "../services/pricing.ts";
import { ANTHROPIC_MODELS } from "../providers/anthropic.ts";
import { OPENAI_MODELS } from "../providers/openai.ts";
import { GOOGLE_MODELS } from "../providers/google.ts";
import type { AgentName, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS } from "../../shared/types.ts";

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

const VALID_AGENT_NAMES = new Set<AgentName>([
  "orchestrator", "orchestrator:classify", "orchestrator:question", "orchestrator:summary",
  "research", "architect", "frontend-dev", "backend-dev",
  "styling", "testing", "code-review", "qa", "security",
]);

// --- Tool assignment endpoints (registered before /agents/:name to avoid param conflicts) ---

// Get all agent tool configs
settingsRoutes.get("/agents/tools", (c) => {
  return c.json(getAllAgentToolConfigs());
});

// Upsert tool override for an agent
settingsRoutes.put("/agents/:name/tools", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ tools: ToolName[] }>();
  if (!Array.isArray(body.tools)) return c.json({ error: "tools must be an array" }, 400);

  const valid = body.tools.every((t) => ALL_TOOLS.includes(t));
  if (!valid) return c.json({ error: `Invalid tool name. Allowed: ${ALL_TOOLS.join(", ")}` }, 400);

  const key = `agent.${name}.tools`;
  const value = JSON.stringify(body.tools);
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value }).run();
  }

  return c.json({ ok: true });
});

// Reset tool override for an agent (reverts to default)
settingsRoutes.delete("/agents/:name/tools", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentToolOverrides(name);
  return c.json({ ok: true });
});

// Get all agent configs (with DB overrides applied)
settingsRoutes.get("/agents", (c) => {
  return c.json(getAllAgentConfigs());
});

// Upsert agent provider/model override
settingsRoutes.put("/agents/:name", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ provider?: string; model?: string }>();

  if (body.provider) {
    const key = `agent.${name}.provider`;
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: body.provider }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: body.provider }).run();
    }
  }

  if (body.model) {
    // Reject unknown models that don't have pricing configured
    if (!getModelPricing(body.model)) {
      return c.json({ error: "Unknown model requires pricing configuration", requiresPricing: true }, 400);
    }

    const key = `agent.${name}.model`;
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: body.model }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: body.model }).run();
    }
  }

  return c.json({ ok: true });
});

// Get agent prompt (DB override or file default)
settingsRoutes.get("/agents/:name/prompt", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.prompt`)).get();
  const prompt = loadSystemPrompt(name);
  return c.json({ prompt, isCustom: !!row });
});

// Upsert agent prompt override
settingsRoutes.put("/agents/:name/prompt", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ prompt: string }>();
  const key = `agent.${name}.prompt`;
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: body.prompt }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value: body.prompt }).run();
  }

  return c.json({ ok: true });
});

// Reset all overrides for an agent
settingsRoutes.delete("/agents/:name/overrides", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentOverrides(name);
  return c.json({ ok: true });
});

// Validate an API key by making a tiny request
settingsRoutes.post("/validate-key", async (c) => {
  const body = await c.req.json<{ provider: string }>();
  const keys = extractApiKeys(c);
  const providers = createProviders(keys);

  try {
    const trackValidation = (provider: string, model: string, apiKey: string, usage: { inputTokens?: number; outputTokens?: number }) => {
      trackBillingOnly({
        agentName: "system:validate-key",
        provider, model, apiKey,
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
      });
    };

    switch (body.provider) {
      case "anthropic": {
        if (!providers.anthropic) return c.json({ error: "No Anthropic key provided" }, 400);
        const result = await generateText({
          model: providers.anthropic("claude-haiku-4-5-20251001"),
          prompt: "Say hi",
          maxOutputTokens: 16,
        });
        trackValidation("anthropic", "claude-haiku-4-5-20251001", keys.anthropic.apiKey, result.usage);
        return c.json({ valid: true, provider: "anthropic" });
      }
      case "openai": {
        if (!providers.openai) return c.json({ error: "No OpenAI key provided" }, 400);
        const result = await generateText({
          model: providers.openai("gpt-5.2"),
          prompt: "Say hi",
          maxOutputTokens: 16,
        });
        trackValidation("openai", "gpt-5.2", keys.openai.apiKey, result.usage);
        return c.json({ valid: true, provider: "openai" });
      }
      case "google": {
        if (!providers.google) return c.json({ error: "No Google key provided" }, 400);
        const result = await generateText({
          model: providers.google("gemini-2.5-flash"),
          prompt: "Say hi",
          maxOutputTokens: 16,
        });
        trackValidation("google", "gemini-2.5-flash", keys.google.apiKey, result.usage);
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

// --- Pricing endpoints ---

// Get all effective pricing (defaults + overrides)
settingsRoutes.get("/pricing", (c) => {
  return c.json(getAllPricing());
});

// Upsert pricing override for a model
settingsRoutes.put("/pricing/:model", async (c) => {
  const model = c.req.param("model");
  const body = await c.req.json<{ input: number; output: number }>();

  if (typeof body.input !== "number" || typeof body.output !== "number") {
    return c.json({ error: "input and output must be numbers" }, 400);
  }
  if (body.input < 0 || body.output < 0) {
    return c.json({ error: "Pricing values must be non-negative" }, 400);
  }

  upsertPricing(model, body.input, body.output);
  return c.json({ ok: true });
});

// Delete pricing override (reverts known model to default, rejects unknown)
settingsRoutes.delete("/pricing/:model", (c) => {
  const model = c.req.param("model");
  deletePricingOverride(model);
  return c.json({ ok: true });
});

// Get known models grouped by provider with pricing info
settingsRoutes.get("/models", (c) => {
  const providers = [
    {
      provider: "anthropic",
      models: Object.values(ANTHROPIC_MODELS).map((id) => ({
        id,
        pricing: DEFAULT_PRICING[id] || null,
      })),
    },
    {
      provider: "openai",
      models: Object.values(OPENAI_MODELS).map((id) => ({
        id,
        pricing: DEFAULT_PRICING[id] || null,
      })),
    },
    {
      provider: "google",
      models: Object.values(GOOGLE_MODELS).map((id) => ({
        id,
        pricing: DEFAULT_PRICING[id] || null,
      })),
    },
  ];
  return c.json(providers);
});
