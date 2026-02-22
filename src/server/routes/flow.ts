import { Hono } from "hono";
import { log } from "../services/logger.ts";
import { validateFlowTemplate } from "../../shared/flow-validation.ts";
import { generateAllDefaults } from "../agents/flow-defaults.ts";
import {
  getFlowTemplate,
  getAllFlowTemplates,
  saveFlowTemplate,
  deleteFlowTemplate,
  getActiveBindings,
  setActiveBinding,
  clearActiveBinding,
} from "../agents/flow-resolver.ts";
import { getAllAgentConfigs } from "../agents/registry.ts";
import type { FlowTemplate } from "../../shared/flow-types.ts";
import type { OrchestratorIntent } from "../../shared/types.ts";

export const flowRoutes = new Hono();

// --- List all flow templates (auto-seed defaults on first access) ---
flowRoutes.get("/templates", (c) => {
  let templates = getAllFlowTemplates();
  if (templates.length === 0) {
    const defaults = generateAllDefaults();
    for (const template of defaults) {
      saveFlowTemplate(template);
    }
    for (const template of defaults) {
      setActiveBinding(template.intent, template.id);
    }
    templates = defaults;
    log("flow", "Auto-seeded default templates on first access", { count: defaults.length });
  }
  return c.json(templates);
});

// --- Get a single flow template ---
flowRoutes.get("/templates/:id", (c) => {
  const id = c.req.param("id");
  const template = getFlowTemplate(id);
  if (!template) return c.json({ error: "Template not found" }, 404);
  return c.json(template);
});

// --- Create or update a flow template ---
flowRoutes.put("/templates/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<FlowTemplate>();

  // Ensure ID matches
  if (body.id !== id) {
    return c.json({ error: "Template ID in body must match URL" }, 400);
  }

  // Validate
  const agentNames = getAllAgentConfigs().map((a) => a.name);
  const errors = validateFlowTemplate(body, agentNames);
  const hasErrors = errors.some((e) => e.type === "error");
  if (hasErrors) {
    return c.json({ error: "Validation failed", errors }, 400);
  }

  body.updatedAt = Date.now();
  saveFlowTemplate(body);
  log("flow", `Template saved: ${body.name}`, { id: body.id, intent: body.intent });
  return c.json({ ok: true, warnings: errors.filter((e) => e.type === "warning") });
});

// --- Delete a flow template ---
flowRoutes.delete("/templates/:id", (c) => {
  const id = c.req.param("id");
  const template = getFlowTemplate(id);
  if (!template) return c.json({ error: "Template not found" }, 404);

  // Check if it's the active template for any intent
  const bindings = getActiveBindings();
  const activeFor = Object.entries(bindings).filter(([, tid]) => tid === id).map(([intent]) => intent);
  if (activeFor.length > 0) {
    return c.json({ error: `Cannot delete template — it is the active template for: ${activeFor.join(", ")}. Unset it first.` }, 400);
  }

  deleteFlowTemplate(id);
  log("flow", `Template deleted: ${template.name}`, { id });
  return c.json({ ok: true });
});

// --- Get active template bindings ---
flowRoutes.get("/active", (c) => {
  return c.json(getActiveBindings());
});

// --- Set active template for an intent ---
flowRoutes.put("/active", async (c) => {
  const body = await c.req.json<{ intent: OrchestratorIntent; templateId: string | null }>();

  const validIntents = ["build", "fix", "question"];
  if (!validIntents.includes(body.intent)) {
    return c.json({ error: `Invalid intent. Must be one of: ${validIntents.join(", ")}` }, 400);
  }

  if (body.templateId === null) {
    clearActiveBinding(body.intent);
    log("flow", `Active template cleared for intent: ${body.intent}`);
    return c.json({ ok: true });
  }

  const template = getFlowTemplate(body.templateId);
  if (!template) return c.json({ error: "Template not found" }, 404);

  if (!template.enabled) {
    return c.json({ error: "Cannot set a disabled template as active" }, 400);
  }

  if (template.intent !== body.intent) {
    return c.json({ error: `Template intent "${template.intent}" does not match requested intent "${body.intent}"` }, 400);
  }

  setActiveBinding(body.intent, body.templateId);
  log("flow", `Active template set: ${body.intent} → ${template.name}`, { intent: body.intent, templateId: body.templateId });
  return c.json({ ok: true });
});

// --- Validate a template without saving ---
flowRoutes.post("/validate", async (c) => {
  const body = await c.req.json<FlowTemplate>();
  const agentNames = getAllAgentConfigs().map((a) => a.name);
  const errors = validateFlowTemplate(body, agentNames);
  return c.json({ valid: !errors.some((e) => e.type === "error"), errors });
});

// --- Reset all templates and regenerate defaults ---
flowRoutes.post("/defaults", (c) => {
  // Delete ALL existing templates and clear all active bindings
  const existing = getAllFlowTemplates();
  for (const tmpl of existing) {
    deleteFlowTemplate(tmpl.id);
  }
  for (const intent of ["build", "fix", "question"] as OrchestratorIntent[]) {
    clearActiveBinding(intent);
  }

  // Generate fresh defaults and set as active
  const defaults = generateAllDefaults();
  for (const template of defaults) {
    saveFlowTemplate(template);
    setActiveBinding(template.intent, template.id);
  }

  log("flow", `Default templates reset (deleted ${existing.length} old, created ${defaults.length} new)`);
  return c.json({ ok: true, templates: defaults });
});
