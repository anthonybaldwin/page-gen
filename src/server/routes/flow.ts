import { Hono } from "hono";
import { log } from "../services/logger.ts";
import { validateFlowTemplate } from "../../shared/flow-validation.ts";
import { generateDefaultForIntent, FLOW_DEFAULTS_VERSION } from "../agents/flow-defaults.ts";
import {
  getFlowTemplate,
  getAllFlowTemplates,
  saveFlowTemplate,
  deleteFlowTemplate,
  getActiveBindings,
  setActiveBinding,
  clearActiveBinding,
  ensureFlowDefaults,
} from "../agents/flow-resolver.ts";
import { getAllAgentConfigs } from "../agents/registry.ts";
import type { FlowTemplate } from "../../shared/flow-types.ts";
import type { OrchestratorIntent } from "../../shared/types.ts";

export const flowRoutes = new Hono();

// --- List all flow templates (auto-seed defaults on first access, auto-upgrade outdated) ---
flowRoutes.get("/templates", (c) => {
  ensureFlowDefaults();
  let templates = getAllFlowTemplates();
  if (templates.length > 0) {
    // Auto-upgrade outdated default templates
    let upgraded = false;
    templates = templates.map((tmpl) => {
      if (tmpl.isDefault && tmpl.version < FLOW_DEFAULTS_VERSION) {
        const fresh = generateDefaultForIntent(tmpl.intent);
        if (fresh) {
          const reset = { ...fresh, id: tmpl.id, name: tmpl.name, createdAt: tmpl.createdAt, updatedAt: Date.now() };
          saveFlowTemplate(reset);
          upgraded = true;
          log("flow", `Auto-upgraded default template "${tmpl.name}" from v${tmpl.version} to v${FLOW_DEFAULTS_VERSION}`);
          return reset;
        }
      }
      return tmpl;
    });
    if (upgraded) {
      templates = getAllFlowTemplates();
    }
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

// --- Create a new flow template (auto-populates from defaults if nodes are empty) ---
flowRoutes.post("/templates", async (c) => {
  const body = await c.req.json<FlowTemplate>();
  if (!body.id || !body.name?.trim() || !body.intent) {
    return c.json({ error: "id, name, and intent are required" }, 400);
  }
  const existing = getFlowTemplate(body.id);
  if (existing) {
    return c.json({ error: "Template with this ID already exists" }, 400);
  }

  // Auto-populate with default nodes/edges when created empty
  if (body.nodes.length === 0) {
    const defaults = generateDefaultForIntent(body.intent);
    if (defaults) {
      body.nodes = defaults.nodes;
      body.edges = defaults.edges;
      body.description = defaults.description;
    }
  }

  body.updatedAt = Date.now();
  saveFlowTemplate(body);
  log("flow", `Template created: ${body.name}`, { id: body.id, intent: body.intent, nodes: body.nodes.length });
  return c.json({ ok: true, template: body });
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

// --- Reset a single template to its intent's default ---
flowRoutes.post("/templates/:id/reset", (c) => {
  const id = c.req.param("id");
  const template = getFlowTemplate(id);
  if (!template) return c.json({ error: "Template not found" }, 404);

  const fresh = generateDefaultForIntent(template.intent);
  if (!fresh) return c.json({ error: `No default template for intent "${template.intent}"` }, 400);

  // Replace content but keep the same ID, name, and bindings
  const reset: FlowTemplate = {
    ...fresh,
    id: template.id,
    name: template.name,
    createdAt: template.createdAt,
    updatedAt: Date.now(),
  };
  saveFlowTemplate(reset);

  log("flow", `Template reset to default: ${reset.name}`, { id: reset.id, intent: reset.intent });
  return c.json({ ok: true, template: reset });
});

// --- Seed missing default templates (only for intents with no templates) ---
flowRoutes.post("/defaults", (c) => {
  ensureFlowDefaults();
  const templates = getAllFlowTemplates();
  return c.json({ ok: true, templates });
});
