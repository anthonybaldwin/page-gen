import { Hono } from "hono";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { log, logWarn } from "../services/logger.ts";
import { getAllAgentConfigs, resetAgentOverrides, getAllAgentToolConfigs, resetAgentToolOverrides } from "../agents/registry.ts";
import { loadSystemPrompt, trackedGenerateText, type TrackedGenerateTextOpts } from "../agents/base.ts";
import { getAllPricing, getModelPricing, upsertPricing, deletePricingOverride, DEFAULT_PRICING, getAllCacheMultipliers, upsertCacheMultipliers, deleteCacheMultiplierOverride } from "../services/pricing.ts";
import { ANTHROPIC_MODELS } from "../providers/anthropic.ts";
import { OPENAI_MODELS } from "../providers/openai.ts";
import { GOOGLE_MODELS } from "../providers/google.ts";
import type { AgentName, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS } from "../../shared/types.ts";
import { LIMIT_DEFAULTS, WARNING_THRESHOLD } from "../config/limits.ts";
import { getGitSettings, setGitSettings, applyGitConfig } from "../services/versioning.ts";

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
    defaultTokenLimit: limits.maxTokensPerChat,
    warningThreshold: WARNING_THRESHOLD,
    limits,
    limitDefaults: Object.fromEntries(
      Object.entries(LIMIT_DEFAULTS).map(([k, v]) => [k, Number(v)])
    ),
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

  if (Object.keys(updated).length > 0) {
    log("settings", `Limits updated`, { updated });
  }

  return c.json({ ok: true, limits: getAllLimits(), defaults: LIMIT_DEFAULTS_NUMERIC });
});

const LIMIT_DEFAULTS_NUMERIC = Object.fromEntries(
  Object.entries(LIMIT_DEFAULTS).map(([k, v]) => [k, Number(v)])
);

// Reset all limits to defaults
settingsRoutes.delete("/limits", (c) => {
  for (const [key, value] of Object.entries(LIMIT_DEFAULTS)) {
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
    }
  }
  log("settings", `All limits reset to defaults`);
  return c.json({ ok: true, limits: getAllLimits(), defaults: LIMIT_DEFAULTS_NUMERIC });
});

const VALID_AGENT_NAMES = new Set<AgentName>([
  "orchestrator", "orchestrator:classify", "orchestrator:title", "orchestrator:question", "orchestrator:summary",
  "research", "architect", "frontend-dev", "backend-dev",
  "styling", "code-review", "qa", "security",
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

  log("settings", `Agent tools overridden: ${name}`, { agent: name, tools: body.tools });
  return c.json({ ok: true });
});

// Reset tool override for an agent (reverts to default)
settingsRoutes.delete("/agents/:name/tools", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentToolOverrides(name);
  log("settings", `Agent tools reset to default: ${name}`, { agent: name });
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

  // Validate provider value
  const VALID_PROVIDERS = new Set(["anthropic", "openai", "google"]);
  if (body.provider && !VALID_PROVIDERS.has(body.provider)) {
    return c.json({ error: `Invalid provider "${body.provider}". Must be one of: ${[...VALID_PROVIDERS].join(", ")}` }, 400);
  }

  // Build known model → provider mapping for compatibility checks
  const MODEL_PROVIDERS: Record<string, string> = {};
  for (const id of Object.values(ANTHROPIC_MODELS)) MODEL_PROVIDERS[id] = "anthropic";
  for (const id of Object.values(OPENAI_MODELS)) MODEL_PROVIDERS[id] = "openai";
  for (const id of Object.values(GOOGLE_MODELS)) MODEL_PROVIDERS[id] = "google";

  // Also include custom models from pricing overrides
  const allPricingEntries = getAllPricing();
  for (const p of allPricingEntries) {
    if (p.provider && !MODEL_PROVIDERS[p.model]) {
      MODEL_PROVIDERS[p.model] = p.provider;
    }
  }

  // Determine effective provider (new value or existing override or default)
  const effectiveProvider = body.provider
    || db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.provider`)).get()?.value
    || (() => { const base = getAllAgentConfigs().find(a => a.name === name); return base?.provider || "anthropic"; })();

  // If model is provided, validate provider/model compatibility
  if (body.model) {
    // Reject unknown models that don't have pricing configured
    if (!getModelPricing(body.model)) {
      return c.json({ error: "Unknown model requires pricing configuration", requiresPricing: true }, 400);
    }

    // Check model/provider compatibility
    const modelProvider = MODEL_PROVIDERS[body.model];
    if (modelProvider && modelProvider !== effectiveProvider) {
      return c.json({
        error: `Model "${body.model}" belongs to provider "${modelProvider}" but agent is configured for "${effectiveProvider}". Set provider to "${modelProvider}" first.`,
      }, 400);
    }
  }

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
    const key = `agent.${name}.model`;
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: body.model }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: body.model }).run();
    }
  }

  log("settings", `Agent config overridden: ${name}`, { agent: name, provider: body.provider, model: body.model });
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

  log("settings", `Agent prompt overridden: ${name}`, { agent: name, chars: body.prompt.length });
  return c.json({ ok: true });
});

// Reset all overrides for an agent
settingsRoutes.delete("/agents/:name/overrides", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!VALID_AGENT_NAMES.has(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentOverrides(name);
  log("settings", `All agent overrides reset: ${name}`, { agent: name });
  return c.json({ ok: true });
});

// Validate an API key by making a tiny request
settingsRoutes.post("/validate-key", async (c) => {
  const body = await c.req.json<{ provider: string }>();
  const keys = extractApiKeys(c);
  const providers = createProviders(keys);

  try {
    const validate = async (provider: string, modelId: string, apiKey: string, model: TrackedGenerateTextOpts["model"]) => {
      await trackedGenerateText({
        model: model!,
        prompt: "Say hi",
        maxOutputTokens: 16,
        agentName: "system:validate-key",
        provider, modelId, apiKey,
      });
      log("settings", `API key validated: ${provider}`);
      return c.json({ valid: true, provider });
    };

    switch (body.provider) {
      case "anthropic": {
        if (!providers.anthropic) return c.json({ error: "No Anthropic key provided" }, 400);
        return validate("anthropic", "claude-haiku-4-5-20251001", keys.anthropic.apiKey, providers.anthropic("claude-haiku-4-5-20251001"));
      }
      case "openai": {
        if (!providers.openai) return c.json({ error: "No OpenAI key provided" }, 400);
        return validate("openai", "gpt-5.2", keys.openai.apiKey, providers.openai("gpt-5.2"));
      }
      case "google": {
        if (!providers.google) return c.json({ error: "No Google key provided" }, 400);
        return validate("google", "gemini-2.5-flash", keys.google.apiKey, providers.google("gemini-2.5-flash"));
      }
      default:
        return c.json({ error: "Unknown provider" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    logWarn("settings", `API key validation failed: ${body.provider} — ${message}`);
    return c.json({ error: message }, 401);
  }
});

// --- Pricing endpoints ---

// Get all effective pricing (defaults + overrides)
settingsRoutes.get("/pricing", (c) => {
  return c.json(getAllPricing());
});

// Upsert pricing override for a model (optional provider for custom models)
settingsRoutes.put("/pricing/:model", async (c) => {
  const model = c.req.param("model");
  const body = await c.req.json<{ input: number; output: number; provider?: string }>();

  if (typeof body.input !== "number" || typeof body.output !== "number") {
    return c.json({ error: "input and output must be numbers" }, 400);
  }
  if (body.input < 0 || body.output < 0) {
    return c.json({ error: "Pricing values must be non-negative" }, 400);
  }

  upsertPricing(model, body.input, body.output, body.provider);
  log("settings", `Pricing overridden: ${model}`, { model, input: body.input, output: body.output, provider: body.provider });
  return c.json({ ok: true });
});

// Delete pricing override (reverts known model to default, rejects unknown)
settingsRoutes.delete("/pricing/:model", (c) => {
  const model = c.req.param("model");
  deletePricingOverride(model);
  log("settings", `Pricing override deleted: ${model}`, { model });
  return c.json({ ok: true });
});

// --- Cache multiplier endpoints ---

// Get all effective cache multipliers (defaults + overrides)
settingsRoutes.get("/cache-multipliers", (c) => {
  return c.json(getAllCacheMultipliers());
});

// Upsert cache multiplier override for a provider
settingsRoutes.put("/cache-multipliers/:provider", async (c) => {
  const provider = c.req.param("provider");
  const body = await c.req.json<{ create: number; read: number }>();

  if (typeof body.create !== "number" || typeof body.read !== "number") {
    return c.json({ error: "create and read must be numbers" }, 400);
  }
  if (body.create < 0 || body.read < 0) {
    return c.json({ error: "Multiplier values must be non-negative" }, 400);
  }

  upsertCacheMultipliers(provider, body.create, body.read);
  log("settings", `Cache multipliers overridden: ${provider}`, { provider, create: body.create, read: body.read });
  return c.json({ ok: true });
});

// Delete cache multiplier override (reverts to default)
settingsRoutes.delete("/cache-multipliers/:provider", (c) => {
  const provider = c.req.param("provider");
  deleteCacheMultiplierOverride(provider);
  log("settings", `Cache multiplier override deleted: ${provider}`, { provider });
  return c.json({ ok: true });
});

// Get known models grouped by provider with pricing info (includes custom models)
settingsRoutes.get("/models", (c) => {
  const providers: { provider: string; models: { id: string; pricing: { input: number; output: number } | null }[] }[] = [
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

  // Include custom models (non-known) under their assigned provider
  const allPricing = getAllPricing();
  const knownModelIds: Set<string> = new Set([
    ...Object.values(ANTHROPIC_MODELS),
    ...Object.values(OPENAI_MODELS),
    ...Object.values(GOOGLE_MODELS),
  ]);
  for (const p of allPricing) {
    if (knownModelIds.has(p.model)) continue;
    if (!p.provider) continue;
    let group = providers.find((g) => g.provider === p.provider);
    if (!group) {
      group = { provider: p.provider, models: [] };
      providers.push(group);
    }
    group.models.push({ id: p.model, pricing: { input: p.input, output: p.output } });
  }

  return c.json(providers);
});

// --- Git settings endpoints ---

settingsRoutes.get("/git", (c) => {
  return c.json(getGitSettings());
});

settingsRoutes.put("/git", async (c) => {
  const body = await c.req.json<{ name?: string; email?: string }>();
  setGitSettings(body);

  // Apply updated config to all existing project repos
  const projects = db.select().from(schema.projects).all();
  for (const project of projects) {
    try {
      applyGitConfig(project.path);
    } catch {
      // Non-fatal — project may not have a git repo yet
    }
  }

  log("settings", "Git settings updated", { name: body.name, email: body.email });
  return c.json({ ok: true, ...getGitSettings() });
});
