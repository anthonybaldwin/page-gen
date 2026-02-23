import { Hono } from "hono";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { log, logWarn } from "../services/logger.ts";
import { getAllAgentConfigs, getAgentConfig, resetAgentOverrides, getAllAgentToolConfigs, resetAgentToolOverrides, getAllAgentLimitsConfigs, resetAgentLimitsOverrides, isBuiltinAgent, getCustomAgent, getCustomAgents, getAgentTools } from "../agents/registry.ts";
import { loadDefaultPrompt, isDefaultPromptCustom } from "../agents/default-prompts.ts";
import { loadSystemPrompt, trackedGenerateText, type TrackedGenerateTextOpts } from "../agents/base.ts";
import { getActionDefaultPrompt, DEFAULT_INTENT_SYSTEM_PROMPT, DEFAULT_FAIL_SIGNALS, getFailSignals } from "../agents/orchestrator.ts";
import { getAllPricing, getModelPricing, upsertPricing, deletePricingOverride, DEFAULT_PRICING, getAllCacheMultipliers, upsertCacheMultipliers, deleteCacheMultiplierOverride, upsertModelCategory, getModelCategoryFromDB } from "../services/pricing.ts";
import { PROVIDER_IDS, PROVIDERS as PROVIDER_DEFS, getModelsForProvider, getModelProvider, VALIDATION_MODELS, getModelCategory, type ModelCategory, CATEGORY_ORDER } from "../../shared/providers.ts";
import { flowRoutes } from "./flow.ts";
import type { AgentName, AgentGroup, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS } from "../../shared/types.ts";
import { LIMIT_DEFAULTS, WARNING_THRESHOLD } from "../config/limits.ts";
import { PIPELINE_DEFAULTS, getPipelineSetting } from "../config/pipeline.ts";
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

/** Check if an agent name is valid (built-in or custom). */
function isValidAgentName(name: string): boolean {
  return isBuiltinAgent(name) || !!getCustomAgent(name);
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

// --- Execution limits endpoints (registered before /agents/:name to avoid param conflicts) ---

// Get all agent limits configs
settingsRoutes.get("/agents/limits", (c) => {
  return c.json(getAllAgentLimitsConfigs());
});

// Upsert limits override for an agent
settingsRoutes.put("/agents/:name/limits", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ maxOutputTokens?: number; maxToolSteps?: number }>();

  if (body.maxOutputTokens !== undefined) {
    if (typeof body.maxOutputTokens !== "number" || body.maxOutputTokens < 1) {
      return c.json({ error: "maxOutputTokens must be a number >= 1" }, 400);
    }
    const key = `agent.${name}.maxOutputTokens`;
    const value = String(body.maxOutputTokens);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value }).run();
    }
  }

  if (body.maxToolSteps !== undefined) {
    if (typeof body.maxToolSteps !== "number" || body.maxToolSteps < 1) {
      return c.json({ error: "maxToolSteps must be a number >= 1" }, 400);
    }
    const key = `agent.${name}.maxToolSteps`;
    const value = String(body.maxToolSteps);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value }).run();
    }
  }

  log("settings", `Agent limits overridden: ${name}`, { agent: name, maxOutputTokens: body.maxOutputTokens, maxToolSteps: body.maxToolSteps });
  return c.json({ ok: true });
});

// Reset limits override for an agent (reverts to defaults)
settingsRoutes.delete("/agents/:name/limits", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentLimitsOverrides(name);
  log("settings", `Agent limits reset to default: ${name}`, { agent: name });
  return c.json({ ok: true });
});

// --- Tool assignment endpoints (registered before /agents/:name to avoid param conflicts) ---

// Get all agent tool configs
settingsRoutes.get("/agents/tools", (c) => {
  return c.json(getAllAgentToolConfigs());
});

// Get resolved tools for a single agent (DB override or default)
settingsRoutes.get("/agents/:name/tools", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);
  return c.json({ tools: getAgentTools(name) });
});

// Upsert tool override for an agent
settingsRoutes.put("/agents/:name/tools", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ tools: ToolName[] }>();
  if (!Array.isArray(body.tools)) return c.json({ error: "tools must be an array" }, 400);

  // Validate tool names: accept both built-in and custom tool names
  const validToolNames = new Set([...ALL_TOOLS, ...getAllCustomTools().map((t) => t.name)]);
  const valid = body.tools.every((t) => validToolNames.has(t));
  if (!valid) return c.json({ error: `Invalid tool name. Allowed: ${[...validToolNames].join(", ")}` }, 400);

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
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  resetAgentToolOverrides(name);
  log("settings", `Agent tools reset to default: ${name}`, { agent: name });
  return c.json({ ok: true });
});

// --- Custom agent CRUD endpoints (registered before /agents/:name to avoid param conflicts) ---

// List all custom agents
settingsRoutes.get("/custom-agents", (c) => {
  const rows = getCustomAgents();
  return c.json(rows);
});

// Create a custom agent
settingsRoutes.post("/custom-agents", async (c) => {
  const body = await c.req.json<{
    name: string;
    displayName: string;
    provider: string;
    model: string;
    description: string;
    group?: AgentGroup;
    allowedCategories?: string[];
    prompt?: string;
    tools?: ToolName[];
    maxOutputTokens?: number;
    maxToolSteps?: number;
  }>();

  // Validate name format
  if (!body.name || !/^[a-z][a-z0-9-]*$/.test(body.name)) {
    return c.json({ error: "Name must match /^[a-z][a-z0-9-]*$/ (lowercase, start with letter, hyphens allowed)" }, 400);
  }

  // Block collision with built-in names
  if (isBuiltinAgent(body.name)) {
    return c.json({ error: `Cannot create custom agent with built-in name "${body.name}"` }, 400);
  }

  // Block duplicates
  if (getCustomAgent(body.name)) {
    return c.json({ error: `Custom agent "${body.name}" already exists` }, 400);
  }

  // Validate required fields
  if (!body.displayName || !body.provider || !body.model || !body.description) {
    return c.json({ error: "displayName, provider, model, and description are required" }, 400);
  }

  // Validate provider
  if (!PROVIDER_IDS.includes(body.provider)) {
    return c.json({ error: `Invalid provider "${body.provider}". Must be one of: ${PROVIDER_IDS.join(", ")}` }, 400);
  }

  // Validate model has pricing
  if (!getModelPricing(body.model)) {
    return c.json({ error: "Model requires pricing configuration", requiresPricing: true }, 400);
  }

  // Validate category restrictions
  if (body.allowedCategories && body.allowedCategories.length > 0) {
    const modelCategory = getModelCategoryFromDB(body.model);
    if (!body.allowedCategories.includes(modelCategory)) {
      return c.json({ error: `Model "${body.model}" has category "${modelCategory}" which is not in allowedCategories [${body.allowedCategories.join(", ")}]` }, 400);
    }
  }

  // Validate tools (built-in + custom)
  if (body.tools) {
    const allValidTools = new Set([...ALL_TOOLS, ...getAllCustomTools().map((t) => t.name)]);
    const validTools = body.tools.every((t) => allValidTools.has(t));
    if (!validTools) return c.json({ error: `Invalid tool name. Allowed: ${[...allValidTools].join(", ")}` }, 400);
  }

  const now = Date.now();
  db.insert(schema.customAgents).values({
    name: body.name,
    displayName: body.displayName,
    provider: body.provider,
    model: body.model,
    description: body.description,
    agentGroup: body.group || "custom",
    allowedCategories: body.allowedCategories ? JSON.stringify(body.allowedCategories) : null,
    prompt: body.prompt || null,
    tools: body.tools ? JSON.stringify(body.tools) : null,
    maxOutputTokens: body.maxOutputTokens || null,
    maxToolSteps: body.maxToolSteps || null,
    createdAt: now,
    updatedAt: now,
  }).run();

  log("settings", `Custom agent created: ${body.name}`, { agent: body.name, provider: body.provider, model: body.model });
  return c.json({ ok: true, name: body.name }, 201);
});

// Update a custom agent
settingsRoutes.put("/custom-agents/:name", async (c) => {
  const name = c.req.param("name");

  // Block updates to built-in agents via this endpoint
  if (isBuiltinAgent(name)) {
    return c.json({ error: "Cannot update built-in agents via this endpoint. Use PUT /settings/agents/:name instead." }, 400);
  }

  const existing = getCustomAgent(name);
  if (!existing) return c.json({ error: `Custom agent "${name}" not found` }, 404);

  const body = await c.req.json<{
    displayName?: string;
    provider?: string;
    model?: string;
    description?: string;
    group?: AgentGroup;
    allowedCategories?: string[];
    prompt?: string;
    tools?: ToolName[];
    maxOutputTokens?: number;
    maxToolSteps?: number;
  }>();

  // Validate provider if changing
  if (body.provider && !PROVIDER_IDS.includes(body.provider)) {
    return c.json({ error: `Invalid provider "${body.provider}". Must be one of: ${PROVIDER_IDS.join(", ")}` }, 400);
  }

  // Validate model has pricing if changing
  if (body.model && !getModelPricing(body.model)) {
    return c.json({ error: "Model requires pricing configuration", requiresPricing: true }, 400);
  }

  // Validate category restrictions for the effective model
  const effectiveModel = body.model || existing.model;
  const effectiveCategories = body.allowedCategories !== undefined ? body.allowedCategories : (existing.allowedCategories ? JSON.parse(existing.allowedCategories) : undefined);
  if (effectiveCategories && effectiveCategories.length > 0) {
    const modelCategory = getModelCategoryFromDB(effectiveModel);
    if (!effectiveCategories.includes(modelCategory)) {
      return c.json({ error: `Model "${effectiveModel}" has category "${modelCategory}" which is not in allowedCategories [${effectiveCategories.join(", ")}]` }, 400);
    }
  }

  // Validate tools (built-in + custom)
  if (body.tools) {
    const allValidTools = new Set([...ALL_TOOLS, ...getAllCustomTools().map((t) => t.name)]);
    const validTools = body.tools.every((t) => allValidTools.has(t));
    if (!validTools) return c.json({ error: `Invalid tool name. Allowed: ${[...allValidTools].join(", ")}` }, 400);
  }

  db.update(schema.customAgents).set({
    ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    ...(body.provider !== undefined ? { provider: body.provider } : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.group !== undefined ? { agentGroup: body.group } : {}),
    ...(body.allowedCategories !== undefined ? { allowedCategories: JSON.stringify(body.allowedCategories) } : {}),
    ...(body.prompt !== undefined ? { prompt: body.prompt || null } : {}),
    ...(body.tools !== undefined ? { tools: JSON.stringify(body.tools) } : {}),
    ...(body.maxOutputTokens !== undefined ? { maxOutputTokens: body.maxOutputTokens } : {}),
    ...(body.maxToolSteps !== undefined ? { maxToolSteps: body.maxToolSteps } : {}),
    updatedAt: Date.now(),
  }).where(eq(schema.customAgents.name, name)).run();

  log("settings", `Custom agent updated: ${name}`, { agent: name });
  return c.json({ ok: true });
});

// Delete a custom agent
settingsRoutes.delete("/custom-agents/:name", (c) => {
  const name = c.req.param("name");

  // Block deletion of built-in agents
  if (isBuiltinAgent(name)) {
    return c.json({ error: `Cannot delete built-in agent "${name}"` }, 400);
  }

  const existing = getCustomAgent(name);
  if (!existing) return c.json({ error: `Custom agent "${name}" not found` }, 404);

  // Delete the custom agent row
  db.delete(schema.customAgents).where(eq(schema.customAgents.name, name)).run();

  // Also clean up any app_settings overrides for this agent
  // Clean all potential override keys
  for (const key of [`agent.${name}.provider`, `agent.${name}.model`, `agent.${name}.prompt`, `agent.${name}.tools`, `agent.${name}.maxOutputTokens`, `agent.${name}.maxToolSteps`]) {
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
  }

  log("settings", `Custom agent deleted: ${name}`, { agent: name });
  return c.json({ ok: true });
});

// Get all agent configs (with DB overrides applied)
settingsRoutes.get("/agents", (c) => {
  return c.json(getAllAgentConfigs());
});

// Upsert agent provider/model override
settingsRoutes.put("/agents/:name", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ provider?: string; model?: string }>();

  // Validate provider value
  if (body.provider && !PROVIDER_IDS.includes(body.provider)) {
    return c.json({ error: `Invalid provider "${body.provider}". Must be one of: ${PROVIDER_IDS.join(", ")}` }, 400);
  }

  // Build known model → provider mapping for compatibility checks
  const MODEL_PROVIDERS: Record<string, string> = {};
  for (const id of PROVIDER_IDS) {
    for (const m of getModelsForProvider(id)) MODEL_PROVIDERS[m.id] = id;
  }

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

    // Enforce category restrictions
    const agentConfig = getAgentConfig(name);
    if (agentConfig?.allowedCategories && agentConfig.allowedCategories.length > 0) {
      const modelCategory = getModelCategoryFromDB(body.model);
      if (!agentConfig.allowedCategories.includes(modelCategory)) {
        return c.json({
          error: `Model "${body.model}" has category "${modelCategory}" which is not allowed for agent "${name}". Allowed categories: ${agentConfig.allowedCategories.join(", ")}`,
        }, 400);
      }
    }
  }

  // For custom agents, update the custom_agents row directly
  if (!isBuiltinAgent(name)) {
    const custom = getCustomAgent(name);
    if (custom) {
      db.update(schema.customAgents).set({
        ...(body.provider ? { provider: body.provider } : {}),
        ...(body.model ? { model: body.model } : {}),
        updatedAt: Date.now(),
      }).where(eq(schema.customAgents.name, name)).run();
      log("settings", `Custom agent config updated: ${name}`, { agent: name, provider: body.provider, model: body.model });
      return c.json({ ok: true });
    }
  }

  // Built-in agent: use app_settings overlay
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
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.prompt`)).get();
  const prompt = loadSystemPrompt(name);
  return c.json({ prompt, isCustom: !!row });
});

// Upsert agent prompt override
settingsRoutes.put("/agents/:name/prompt", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ prompt: string }>();

  // For custom agents, update the prompt column directly
  if (!isBuiltinAgent(name)) {
    const custom = getCustomAgent(name);
    if (custom) {
      db.update(schema.customAgents).set({ prompt: body.prompt, updatedAt: Date.now() }).where(eq(schema.customAgents.name, name)).run();
      log("settings", `Custom agent prompt updated: ${name}`, { agent: name, chars: body.prompt.length });
      return c.json({ ok: true });
    }
  }

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

// Get agent default prompt (DB override or built-in default)
settingsRoutes.get("/agents/:name/defaultPrompt", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const defaultPrompt = loadDefaultPrompt(name);
  const isCustom = isDefaultPromptCustom(name);
  return c.json({ defaultPrompt, isCustom });
});

// Upsert agent default prompt override
settingsRoutes.put("/agents/:name/defaultPrompt", async (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

  const body = await c.req.json<{ defaultPrompt: string }>();
  const key = `agent.${name}.defaultPrompt`;
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: body.defaultPrompt }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value: body.defaultPrompt }).run();
  }

  log("settings", `Agent default prompt overridden: ${name}`, { agent: name, chars: body.defaultPrompt.length });
  return c.json({ ok: true });
});

// Reset all overrides for an agent
settingsRoutes.delete("/agents/:name/overrides", (c) => {
  const name = c.req.param("name") as AgentName;
  if (!isValidAgentName(name)) return c.json({ error: "Unknown agent" }, 400);

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

    const validationModel = VALIDATION_MODELS[body.provider];
    if (!validationModel || !providers[body.provider]) {
      if (!validationModel) return c.json({ error: "Unknown provider" }, 400);
      const def = PROVIDER_DEFS.find((p) => p.id === body.provider);
      return c.json({ error: `No ${def?.label ?? body.provider} key provided` }, 400);
    }
    return validate(body.provider, validationModel, keys[body.provider]!.apiKey, providers[body.provider]!(validationModel));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    logWarn("settings", `API key validation failed: ${body.provider} — ${message}`);
    return c.json({ error: message }, 401);
  }
});

// --- Pricing endpoints ---

// Get all effective pricing (defaults + overrides)
// Only returns models belonging to providers the caller has keys for.
settingsRoutes.get("/pricing", (c) => {
  const keys = extractApiKeys(c);
  const activeSet = new Set(PROVIDER_IDS.filter((id) => !!keys[id]?.apiKey));
  const all = getAllPricing();
  return c.json(all.filter((p) => {
    const provider = p.provider || getModelProvider(p.model);
    return provider ? activeSet.has(provider) : false;
  }));
});

// Upsert pricing override for a model (optional provider and category for custom models)
settingsRoutes.put("/pricing/:model", async (c) => {
  const model = c.req.param("model");
  const body = await c.req.json<{ input: number; output: number; provider?: string; category?: ModelCategory }>();

  if (typeof body.input !== "number" || typeof body.output !== "number") {
    return c.json({ error: "input and output must be numbers" }, 400);
  }
  if (body.input < 0 || body.output < 0) {
    return c.json({ error: "Pricing values must be non-negative" }, 400);
  }

  upsertPricing(model, body.input, body.output, body.provider);
  if (body.category) {
    upsertModelCategory(model, body.category);
  }
  log("settings", `Pricing overridden: ${model}`, { model, input: body.input, output: body.output, provider: body.provider, category: body.category });
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
// Only returns multipliers for providers the caller has keys for.
settingsRoutes.get("/cache-multipliers", (c) => {
  const keys = extractApiKeys(c);
  const activeSet = new Set(PROVIDER_IDS.filter((id) => !!keys[id]?.apiKey));
  const all = getAllCacheMultipliers();
  return c.json(all.filter((cm) => activeSet.has(cm.provider)));
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
// Only returns providers for which the caller supplied an API key.
settingsRoutes.get("/models", (c) => {
  const keys = extractApiKeys(c);
  const activeProviders = PROVIDER_IDS.filter((id) => !!keys[id]?.apiKey);

  const providerGroups: { provider: string; models: { id: string; pricing: { input: number; output: number } | null; category: ModelCategory }[] }[] =
    activeProviders.map((id) => ({
      provider: id,
      models: getModelsForProvider(id).map((m) => ({
        id: m.id,
        pricing: DEFAULT_PRICING[m.id] || null,
        category: (m.category ?? "text") as ModelCategory,
      })),
    }));

  // Include custom models (non-known) under their assigned provider
  const allPricing = getAllPricing();
  const knownModelIds = new Set(Object.keys(DEFAULT_PRICING));
  const activeSet = new Set(activeProviders);
  for (const p of allPricing) {
    if (knownModelIds.has(p.model)) continue;
    if (!p.provider) continue;
    if (!activeSet.has(p.provider)) continue;
    let group = providerGroups.find((g) => g.provider === p.provider);
    if (!group) {
      group = { provider: p.provider, models: [] };
      providerGroups.push(group);
    }
    group.models.push({ id: p.model, pricing: { input: p.input, output: p.output }, category: (p.category ?? "text") as ModelCategory });
  }

  return c.json(providerGroups);
});

// --- Pipeline settings endpoints ---

// Get all pipeline settings (current values + defaults)
settingsRoutes.get("/pipeline", (c) => {
  const current: Record<string, number> = {};
  for (const key of Object.keys(PIPELINE_DEFAULTS)) {
    current[key] = getPipelineSetting(key);
  }
  return c.json({ settings: current, defaults: PIPELINE_DEFAULTS });
});

// Upsert pipeline setting overrides
settingsRoutes.put("/pipeline", async (c) => {
  const body = await c.req.json<Record<string, number>>();
  const updated: Record<string, number> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!(key in PIPELINE_DEFAULTS)) continue;
    if (typeof value !== "number" || value < 0) continue;
    const dbKey = `pipeline.${key}`;
    const strVal = String(value);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, dbKey)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: strVal }).where(eq(schema.appSettings.key, dbKey)).run();
    } else {
      db.insert(schema.appSettings).values({ key: dbKey, value: strVal }).run();
    }
    updated[key] = value;
  }

  if (Object.keys(updated).length > 0) {
    log("settings", `Pipeline settings updated`, { updated });
  }

  const current: Record<string, number> = {};
  for (const key of Object.keys(PIPELINE_DEFAULTS)) {
    current[key] = getPipelineSetting(key);
  }
  return c.json({ ok: true, settings: current, defaults: PIPELINE_DEFAULTS });
});

// Reset all pipeline settings to defaults
settingsRoutes.delete("/pipeline", (c) => {
  for (const key of Object.keys(PIPELINE_DEFAULTS)) {
    const dbKey = `pipeline.${key}`;
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, dbKey)).get();
    if (existing) {
      db.delete(schema.appSettings).where(eq(schema.appSettings.key, dbKey)).run();
    }
  }
  log("settings", `All pipeline settings reset to defaults`);
  return c.json({ ok: true, settings: { ...PIPELINE_DEFAULTS }, defaults: PIPELINE_DEFAULTS });
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

// --- Custom tool endpoints ---

import { getAllCustomTools, getCustomTool, saveCustomTool, deleteCustomTool, validateToolName, isBuiltinToolName } from "../tools/custom-tool-registry.ts";
import { executeCustomTool } from "../tools/custom-tool-executor.ts";
import type { CustomToolDefinition } from "../../shared/custom-tool-types.ts";

// List all custom tools
settingsRoutes.get("/custom-tools", (c) => {
  return c.json(getAllCustomTools());
});

// Get a single custom tool
settingsRoutes.get("/custom-tools/:name", (c) => {
  const name = c.req.param("name");
  const tool = getCustomTool(name);
  if (!tool) return c.json({ error: "Custom tool not found" }, 404);
  return c.json(tool);
});

// Create or update a custom tool
settingsRoutes.put("/custom-tools/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<CustomToolDefinition>();

  // Ensure name matches URL
  if (body.name !== name) {
    return c.json({ error: "Tool name in body must match URL" }, 400);
  }

  // Validate name
  const nameError = validateToolName(body.name);
  if (nameError) return c.json({ error: nameError }, 400);

  // Validate required fields
  if (!body.displayName?.trim()) return c.json({ error: "displayName is required" }, 400);
  if (!body.description?.trim()) return c.json({ error: "description is required" }, 400);
  if (!body.implementation) return c.json({ error: "implementation is required" }, 400);

  const validTypes = ["http", "javascript", "shell"];
  if (!validTypes.includes(body.implementation.type)) {
    return c.json({ error: `Invalid implementation type. Must be one of: ${validTypes.join(", ")}` }, 400);
  }

  // Set timestamps
  const existing = getCustomTool(name);
  if (!existing) {
    body.createdAt = Date.now();
  } else {
    body.createdAt = existing.createdAt;
  }
  body.updatedAt = Date.now();

  saveCustomTool(body);
  log("settings", `Custom tool saved: ${name}`, { tool: name, type: body.implementation.type });
  return c.json({ ok: true });
});

// Delete a custom tool
settingsRoutes.delete("/custom-tools/:name", (c) => {
  const name = c.req.param("name");
  const tool = getCustomTool(name);
  if (!tool) return c.json({ error: "Custom tool not found" }, 404);

  deleteCustomTool(name);

  // Clean up any agent tool overrides that reference this custom tool
  // (agent tool lists are stored as JSON arrays in app_settings)
  const allSettings = db.select().from(schema.appSettings).all();
  for (const row of allSettings) {
    if (!row.key.startsWith("agent.") || !row.key.endsWith(".tools")) continue;
    try {
      const tools = JSON.parse(row.value);
      if (Array.isArray(tools) && tools.includes(name)) {
        const filtered = tools.filter((t: string) => t !== name);
        db.update(schema.appSettings).set({ value: JSON.stringify(filtered) }).where(eq(schema.appSettings.key, row.key)).run();
      }
    } catch { /* ignore */ }
  }

  log("settings", `Custom tool deleted: ${name}`, { tool: name });
  return c.json({ ok: true });
});

// Test-execute a custom tool with sample params
settingsRoutes.post("/custom-tools/:name/test", async (c) => {
  const name = c.req.param("name");
  const tool = getCustomTool(name);
  if (!tool) return c.json({ error: "Custom tool not found" }, 404);

  const body = await c.req.json<{ params: Record<string, unknown> }>();
  const result = await executeCustomTool(tool, body.params ?? {});
  return c.json(result);
});

// --- Action default prompt endpoint ---

// Get the hardcoded default prompt for an action kind (summary, summary-failed, mood-analysis)
settingsRoutes.get("/actions/:kind/defaultPrompt", (c) => {
  const kind = c.req.param("kind");
  const prompt = getActionDefaultPrompt(kind);
  if (!prompt) return c.json({ error: `No default prompt for action kind "${kind}"` }, 404);
  return c.json({ prompt, kind });
});

// --- Intent classification prompt endpoints ---

// Get current intent classification prompt (DB override or default)
settingsRoutes.get("/intent/classifyPrompt", (c) => {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "intent.classifyPrompt")).get();
  return c.json({
    prompt: row?.value || DEFAULT_INTENT_SYSTEM_PROMPT,
    isCustom: !!row,
    defaultPrompt: DEFAULT_INTENT_SYSTEM_PROMPT,
  });
});

// Save custom intent classification prompt
settingsRoutes.put("/intent/classifyPrompt", async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  if (!body.prompt?.trim()) return c.json({ error: "prompt is required" }, 400);

  const key = "intent.classifyPrompt";
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: body.prompt }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value: body.prompt }).run();
  }

  log("settings", `Intent classification prompt updated`, { chars: body.prompt.length });
  return c.json({ ok: true });
});

// Reset intent classification prompt to default
settingsRoutes.delete("/intent/classifyPrompt", (c) => {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, "intent.classifyPrompt")).run();
  log("settings", "Intent classification prompt reset to default");
  return c.json({ ok: true, prompt: DEFAULT_INTENT_SYSTEM_PROMPT });
});

// --- Fail signals endpoints ---

// Get current fail signals (custom or default)
settingsRoutes.get("/pipeline/failSignals", (c) => {
  const signals = getFailSignals();
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "pipeline.failSignals")).get();
  return c.json({ signals, defaults: DEFAULT_FAIL_SIGNALS, isCustom: !!row });
});

// Save custom fail signals
settingsRoutes.put("/pipeline/failSignals", async (c) => {
  const body = await c.req.json<{ signals: string[] }>();
  if (!Array.isArray(body.signals)) return c.json({ error: "signals must be an array" }, 400);
  const filtered = body.signals.filter((s) => typeof s === "string" && s.trim().length > 0);
  if (filtered.length === 0) return c.json({ error: "signals must contain at least one non-empty string" }, 400);

  const key = "pipeline.failSignals";
  const value = JSON.stringify(filtered);
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value }).run();
  }

  log("settings", `Fail signals updated`, { count: filtered.length });
  return c.json({ ok: true, signals: filtered });
});

// Reset fail signals to default
settingsRoutes.delete("/pipeline/failSignals", (c) => {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, "pipeline.failSignals")).run();
  log("settings", "Fail signals reset to default");
  return c.json({ ok: true, signals: DEFAULT_FAIL_SIGNALS });
});

// --- Flow pipeline routes (mounted as sub-router) ---
settingsRoutes.route("/flow", flowRoutes);
