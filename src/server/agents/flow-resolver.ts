import type { FlowTemplate, FlowNode, FlowEdge, FlowResolutionContext, ConditionNodeData, ActionNodeData, CheckpointNodeData, VersionNodeData, ConfigNodeData, ActionKind, AgentNodeData } from "../../shared/flow-types.ts";
import { topologicalSort } from "../../shared/flow-validation.ts";
import type { ExecutionPlan, ActionOverrides, PlanStep } from "./orchestrator.ts";
import { getPipelineSetting } from "../config/pipeline.ts";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";
import { log } from "../services/logger.ts";
import type { OrchestratorIntent } from "../../shared/types.ts";
import { generateAllDefaults, generateDefaultForIntent } from "./flow-defaults.ts";

/**
 * Get a flow template from app_settings by ID.
 */
export function getFlowTemplate(id: string): FlowTemplate | null {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `flow.template.${id}`)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as FlowTemplate;
  } catch {
    return null;
  }
}

/**
 * Get the active flow template for a given intent.
 */
export function getActiveFlowTemplate(intent: OrchestratorIntent): FlowTemplate | null {
  const bindingRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `flow.active.${intent}`)).get();
  if (!bindingRow) return null;
  const template = getFlowTemplate(bindingRow.value);
  if (!template || !template.enabled) return null;
  return template;
}

/**
 * Get all flow templates from app_settings.
 */
export function getAllFlowTemplates(): FlowTemplate[] {
  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, "flow.template.%")).all();
  const templates: FlowTemplate[] = [];
  for (const row of rows) {
    try {
      templates.push(JSON.parse(row.value) as FlowTemplate);
    } catch {
      // Invalid JSON — skip
    }
  }
  return templates.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Save a flow template to app_settings.
 */
export function saveFlowTemplate(template: FlowTemplate): void {
  const key = `flow.template.${template.id}`;
  const value = JSON.stringify(template);
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value }).run();
  }
}

/**
 * Delete a flow template from app_settings.
 */
export function deleteFlowTemplate(id: string): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `flow.template.${id}`)).run();
}

/**
 * Get active template bindings (intent → template ID).
 */
export function getActiveBindings(): Record<string, string> {
  const intents = ["build", "fix", "question"] as const;
  const bindings: Record<string, string> = {};
  for (const intent of intents) {
    const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `flow.active.${intent}`)).get();
    if (row) bindings[intent] = row.value;
  }
  return bindings;
}

/**
 * Set the active template for a given intent.
 */
export function setActiveBinding(intent: OrchestratorIntent, templateId: string): void {
  const key = `flow.active.${intent}`;
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: templateId }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value: templateId }).run();
  }
}

/**
 * Remove the active binding for an intent.
 */
export function clearActiveBinding(intent: OrchestratorIntent): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `flow.active.${intent}`)).run();
}

/**
 * Evaluate a predefined condition against the context.
 */
function evaluatePredefined(predefined: string, ctx: FlowResolutionContext): boolean {
  switch (predefined) {
    case "needsBackend":
      return ctx.needsBackend;
    case "scopeIncludes:frontend":
      return ctx.scope === "frontend" || ctx.scope === "full";
    case "scopeIncludes:backend":
      return ctx.scope === "backend" || ctx.scope === "full";
    case "scopeIncludes:styling":
      return ctx.scope === "styling";
    case "hasFiles":
      return ctx.hasFiles;
    default:
      log("flow-resolver", `Unknown predefined condition: ${predefined}`);
      return false;
  }
}

/**
 * Evaluate a condition expression against the context.
 * Only allows access to: intent, scope, needsBackend, hasFiles
 */
function evaluateExpression(expression: string, ctx: FlowResolutionContext): boolean {
  try {
    const fn = new Function("intent", "scope", "needsBackend", "hasFiles",
      `"use strict"; return (${expression});`
    );
    return !!fn(ctx.intent, ctx.scope, ctx.needsBackend, ctx.hasFiles);
  } catch (err) {
    log("flow-resolver", `Condition expression evaluation failed: ${expression} — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Evaluate a condition node and return true/false.
 */
function evaluateCondition(data: ConditionNodeData, ctx: FlowResolutionContext): boolean {
  if (data.mode === "predefined" && data.predefined) {
    return evaluatePredefined(data.predefined, ctx);
  }
  if (data.mode === "expression" && data.expression) {
    return evaluateExpression(data.expression, ctx);
  }
  return false;
}

/**
 * Resolve a flow template into an ExecutionPlan.
 *
 * 1. Topologically sort the DAG
 * 2. Walk nodes: evaluate conditions (prune branches), convert agent nodes to plan steps
 * 3. Compute dependsOn from pruned edges
 * 4. Return standard ExecutionPlan
 */
export function resolveFlowTemplate(template: FlowTemplate, ctx: FlowResolutionContext): ExecutionPlan {
  const sorted = topologicalSort(template.nodes, template.edges);
  if (!sorted) {
    log("flow-resolver", `Template "${template.id}" has a cycle — falling back to empty plan`);
    return { steps: [] };
  }

  const nodeMap = new Map(template.nodes.map((n) => [n.id, n]));

  // Build edge lookup: source → edges
  const outEdges = new Map<string, FlowEdge[]>();
  for (const edge of template.edges) {
    if (!outEdges.has(edge.source)) outEdges.set(edge.source, []);
    outEdges.get(edge.source)!.push(edge);
  }

  // Build reverse edge lookup: target → source IDs
  const inEdges = new Map<string, string[]>();
  for (const edge of template.edges) {
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    inEdges.get(edge.target)!.push(edge.source);
  }

  // Track which nodes are active (not pruned by conditions)
  const activeNodes = new Set<string>(sorted);
  // Track condition results for pruning
  const conditionResults = new Map<string, boolean>();
  // Track edge IDs pruned by condition evaluation (so multi-edge targets are handled correctly)
  const prunedEdgeIds = new Set<string>();

  // First pass: evaluate conditions and prune
  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Skip already pruned nodes
    if (!activeNodes.has(nodeId)) continue;

    if (node.data.type === "condition") {
      const result = evaluateCondition(node.data, ctx);
      conditionResults.set(nodeId, result);

      // Collect which edges are killed by this condition, then prune targets
      const edges = outEdges.get(nodeId) ?? [];
      const deadTargets = new Set<string>();
      for (const edge of edges) {
        const handle = edge.sourceHandle;
        if ((handle === "true" && !result) || (handle === "false" && result)) {
          prunedEdgeIds.add(edge.id);
          deadTargets.add(edge.target);
        }
      }
      for (const target of deadTargets) {
        pruneSubgraph(target, activeNodes, outEdges, inEdges, nodeMap, template.edges, prunedEdgeIds);
      }
    }
  }

  // Extract baseSystemPrompt from config nodes (metadata-only, no step generated)
  let baseSystemPrompt: string | undefined;
  for (const nodeId of sorted) {
    if (!activeNodes.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (node?.data.type === "config") {
      const configData = node.data as ConfigNodeData;
      if (configData.baseSystemPrompt?.trim()) {
        baseSystemPrompt = configData.baseSystemPrompt;
      }
    }
  }

  // Second pass: convert active nodes to execution plan steps + collect action overrides
  const steps: PlanStep[] = [];
  const nodeToStepKey = new Map<string, string>(); // nodeId → stepKey for dependsOn resolution
  const actionOverrides: ActionOverrides = {};

  for (const nodeId of sorted) {
    if (!activeNodes.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Config nodes are metadata-only — no step generated
    if (node.data.type === "config") continue;

    if (node.data.type === "agent") {
      const agentData = node.data as AgentNodeData;
      const input = agentData.inputTemplate.replace(/\{\{userMessage\}\}/g, ctx.userMessage);

      // Compute dependsOn: find upstream agent/checkpoint nodes
      const deps = computeStepDependencies(nodeId, activeNodes, inEdges, nodeMap, nodeToStepKey);

      steps.push({
        kind: "agent",
        agentName: agentData.agentName,
        input,
        dependsOn: deps.length > 0 ? deps : undefined,
        instanceId: nodeId,
        maxOutputTokens: agentData.maxOutputTokens,
        maxToolSteps: agentData.maxToolSteps,
        upstreamSources: agentData.upstreamSources,
        toolOverrides: agentData.toolOverrides,
        systemPrompt: agentData.systemPrompt,
      });

      nodeToStepKey.set(nodeId, nodeId);
    }

    // Action nodes: ALL action kinds become direct executable steps
    if (node.data.type === "action") {
      const actionData = node.data as ActionNodeData;
      const deps = computeStepDependencies(nodeId, activeNodes, inEdges, nodeMap, nodeToStepKey);
      steps.push({
        kind: "action",
        actionKind: actionData.kind,
        label: actionData.label,
        dependsOn: deps.length > 0 ? deps : undefined,
        instanceId: nodeId,
        // Copy per-node settings so execution handlers can read them
        timeoutMs: actionData.timeoutMs,
        maxAttempts: actionData.maxAttempts,
        maxTestFailures: actionData.maxTestFailures,
        maxUniqueErrors: actionData.maxUniqueErrors,
        // LLM configuration (for agentic action kinds)
        systemPrompt: actionData.systemPrompt,
        maxOutputTokens: actionData.maxOutputTokens,
        // Remediation-specific configuration
        remediationFixAgents: actionData.remediationFixAgents,
        remediationReviewerKeys: actionData.remediationReviewerKeys,
        // Build/test command overrides
        buildCommand: actionData.buildCommand,
        testCommand: actionData.testCommand,
        // Fail signals + build-fix agent routing
        failSignals: actionData.failSignals,
        buildFixAgent: actionData.buildFixAgent,
        // Shell action
        shellCommand: actionData.shellCommand,
        shellCaptureOutput: actionData.shellCaptureOutput,
        // LLM call action
        llmInputTemplate: actionData.llmInputTemplate,
        // Agent config (for agentic action kinds)
        agentConfig: actionData.agentConfig,
      });
      nodeToStepKey.set(nodeId, nodeId);

      // Also collect overrides for backwards compat (used by utility functions like deduplicateErrors)
      collectActionOverrides(actionData, actionOverrides);
    }

    // Version nodes: emit as version steps
    if (node.data.type === "version") {
      const versionData = node.data as VersionNodeData;
      const deps = computeStepDependencies(nodeId, activeNodes, inEdges, nodeMap, nodeToStepKey);
      steps.push({
        kind: "version",
        nodeId,
        label: versionData.label,
        dependsOn: deps.length > 0 ? deps : undefined,
        instanceId: nodeId,
      });
      nodeToStepKey.set(nodeId, nodeId);
    }

    // Checkpoint nodes: emit as checkpoint steps
    if (node.data.type === "checkpoint") {
      const cpData = node.data as CheckpointNodeData;
      const deps = computeStepDependencies(nodeId, activeNodes, inEdges, nodeMap, nodeToStepKey);
      const defaultTimeout = getPipelineSetting("checkpointTimeoutMs");

      steps.push({
        kind: "checkpoint",
        nodeId,
        label: cpData.label,
        checkpointType: cpData.checkpointType ?? "approve",
        message: cpData.message ?? cpData.label,
        timeoutMs: cpData.timeoutMs ?? defaultTimeout,
        dependsOn: deps.length > 0 ? deps : undefined,
        instanceId: nodeId,
      });

      nodeToStepKey.set(nodeId, nodeId);
    }
  }

  log("flow-resolver", `Resolved template "${template.name}" → ${steps.length} steps`, {
    templateId: template.id,
    activeNodes: activeNodes.size,
    totalNodes: template.nodes.length,
  });

  const hasOverrides = Object.keys(actionOverrides).length > 0;
  return { steps, ...(hasOverrides ? { actionOverrides } : {}), ...(baseSystemPrompt ? { baseSystemPrompt } : {}) };
}

/**
 * Prune a node and all its exclusive descendants from the active set.
 * A descendant is only pruned if ALL its incoming edges come from pruned nodes
 * (or are in the set of edges being pruned by this condition evaluation).
 *
 * `prunedEdgeIds` tracks which specific edges triggered this prune pass so that
 * nodes with multiple incoming edges (some pruned, some still live) are kept.
 */
function pruneSubgraph(
  startId: string,
  activeNodes: Set<string>,
  outEdges: Map<string, FlowEdge[]>,
  inEdges: Map<string, string[]>,
  nodeMap: Map<string, FlowNode>,
  allTemplateEdges: FlowEdge[],
  prunedEdgeIds: Set<string>,
): void {
  const queue = [startId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (!activeNodes.has(nodeId)) continue;

    // Check ALL incoming edges: a node is only prunable if every incoming
    // edge is either (a) from an already-pruned node, or (b) in the set of
    // edges being pruned by the current condition evaluation.
    const incomingEdges = allTemplateEdges.filter((e) => e.target === nodeId);
    const allIncomingDead = incomingEdges.every(
      (e) => !activeNodes.has(e.source) || prunedEdgeIds.has(e.id) || e.source === nodeId,
    );
    if (!allIncomingDead) continue;

    activeNodes.delete(nodeId);

    // Queue children for potential pruning
    const edges = outEdges.get(nodeId) ?? [];
    for (const edge of edges) {
      queue.push(edge.target);
    }
  }
}

/**
 * Walk backwards from a node through the graph to find the nearest active
 * agent or checkpoint nodes that this node depends on.
 */
function computeStepDependencies(
  nodeId: string,
  activeNodes: Set<string>,
  inEdges: Map<string, string[]>,
  nodeMap: Map<string, FlowNode>,
  nodeToStepKey: Map<string, string>,
): string[] {
  const deps = new Set<string>();
  const visited = new Set<string>();
  const queue = [...(inEdges.get(nodeId) ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    if (!activeNodes.has(currentId)) continue;

    const node = nodeMap.get(currentId);
    if (!node) continue;

    if ((node.data.type === "agent" || node.data.type === "checkpoint" || node.data.type === "action" || node.data.type === "version") && nodeToStepKey.has(currentId)) {
      deps.add(nodeToStepKey.get(currentId)!);
    } else {
      // Not a step-producing node — keep walking backwards
      const parents = inEdges.get(currentId) ?? [];
      queue.push(...parents);
    }
  }

  return [...deps];
}

/**
 * Map ActionNodeData overrides to pipeline setting keys.
 * Multiple action nodes of the same kind merge (last-write-wins).
 */
function collectActionOverrides(data: ActionNodeData, out: ActionOverrides): void {
  switch (data.kind) {
    case "build-check":
      if (data.timeoutMs !== undefined) out.buildTimeoutMs = data.timeoutMs;
      if (data.maxAttempts !== undefined) out.maxBuildFixAttempts = data.maxAttempts;
      if (data.maxUniqueErrors !== undefined) out.maxUniqueErrors = data.maxUniqueErrors;
      break;
    case "test-run":
      if (data.timeoutMs !== undefined) out.testTimeoutMs = data.timeoutMs;
      if (data.maxTestFailures !== undefined) out.maxTestFailures = data.maxTestFailures;
      if (data.maxUniqueErrors !== undefined) out.maxUniqueErrors = data.maxUniqueErrors;
      break;
    case "remediation":
      if (data.maxAttempts !== undefined) out.maxRemediationCycles = data.maxAttempts;
      break;
  }
}

/** Default system prompt for the question agent (seeded into DB). */
const QUESTION_SYSTEM_PROMPT = `You are a helpful assistant for a React + TypeScript + Tailwind CSS page builder.
Answer the user's question based on the project source code provided.
Keep answers to 2-3 short paragraphs max. Be direct — answer the question, don't restate it.
If the project has no files yet, say so in one sentence and suggest they describe what they'd like to build.`;

/**
 * Ensure all three intent default flow templates exist.
 * Called at the top of runOrchestration() (idempotent, synchronous SQLite).
 * Also seeds the question agent system prompt into app_settings if missing.
 */
export function ensureFlowDefaults(): void {
  const templates = getAllFlowTemplates();
  if (templates.length === 0) {
    const defaults = generateAllDefaults();
    for (const t of defaults) saveFlowTemplate(t);
    for (const t of defaults) setActiveBinding(t.intent, t.id);
    log("flow", "Auto-seeded default templates", { count: defaults.length });
  } else {
    // Seed any missing intents
    const existingIntents = new Set(templates.map(t => t.intent));
    for (const intent of ["build", "fix", "question"] as const) {
      if (!existingIntents.has(intent)) {
        const fresh = generateDefaultForIntent(intent);
        if (fresh) {
          saveFlowTemplate(fresh);
          setActiveBinding(intent, fresh.id);
          log("flow", `Auto-seeded missing default template for "${intent}"`);
        }
      }
    }
  }

  // Seed question system prompt into DB if not already present
  const promptKey = "agent.orchestrator:question.prompt";
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, promptKey)).get();
  if (!existing) {
    db.insert(schema.appSettings).values({
      key: promptKey,
      value: QUESTION_SYSTEM_PROMPT,
    }).run();
    log("flow", "Seeded question agent system prompt into app_settings");
  }
}
