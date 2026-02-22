import type { FlowTemplate, FlowNode, FlowEdge, FlowResolutionContext, ConditionNodeData } from "../../shared/flow-types.ts";
import { topologicalSort } from "../../shared/flow-validation.ts";
import type { ExecutionPlan } from "./orchestrator.ts";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";
import { log } from "../services/logger.ts";
import type { OrchestratorIntent } from "../../shared/types.ts";

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

  // First pass: evaluate conditions and prune
  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Skip already pruned nodes
    if (!activeNodes.has(nodeId)) continue;

    if (node.data.type === "condition") {
      const result = evaluateCondition(node.data, ctx);
      conditionResults.set(nodeId, result);

      // Prune edges based on condition result
      const edges = outEdges.get(nodeId) ?? [];
      for (const edge of edges) {
        const handle = edge.sourceHandle;
        if (handle === "true" && !result) {
          pruneSubgraph(edge.target, activeNodes, outEdges, inEdges, nodeMap);
        } else if (handle === "false" && result) {
          pruneSubgraph(edge.target, activeNodes, outEdges, inEdges, nodeMap);
        }
      }
    }
  }

  // Second pass: convert active agent nodes to execution plan steps
  const steps: ExecutionPlan["steps"] = [];
  const nodeToAgent = new Map<string, string>(); // nodeId → agentName for dependsOn resolution

  for (const nodeId of sorted) {
    if (!activeNodes.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.data.type === "agent") {
      const input = node.data.inputTemplate.replace(/\{\{userMessage\}\}/g, ctx.userMessage);

      // Compute dependsOn: find upstream agent nodes
      const deps = computeAgentDependencies(nodeId, activeNodes, inEdges, nodeMap, nodeToAgent);

      steps.push({
        agentName: node.data.agentName,
        input,
        dependsOn: deps.length > 0 ? deps : undefined,
        instanceId: nodeId,
        maxOutputTokens: node.data.maxOutputTokens,
        maxToolSteps: node.data.maxToolSteps,
      });

      nodeToAgent.set(nodeId, node.data.agentName);
    }

    // Checkpoint nodes: skip for now (Phase 2)
  }

  log("flow-resolver", `Resolved template "${template.name}" → ${steps.length} steps`, {
    templateId: template.id,
    activeNodes: activeNodes.size,
    totalNodes: template.nodes.length,
  });

  return { steps };
}

/**
 * Prune a node and all its exclusive descendants from the active set.
 * A descendant is only pruned if ALL its incoming edges come from pruned nodes.
 */
function pruneSubgraph(
  startId: string,
  activeNodes: Set<string>,
  outEdges: Map<string, FlowEdge[]>,
  inEdges: Map<string, string[]>,
  nodeMap: Map<string, FlowNode>,
): void {
  const queue = [startId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (!activeNodes.has(nodeId)) continue;

    // Only prune if all incoming edges come from pruned/inactive nodes
    const inSources = inEdges.get(nodeId) ?? [];
    const allIncomingPruned = inSources.every((src) => !activeNodes.has(src) || src === nodeId);
    if (!allIncomingPruned && nodeId !== startId) continue;

    activeNodes.delete(nodeId);

    // Queue children for potential pruning
    const edges = outEdges.get(nodeId) ?? [];
    for (const edge of edges) {
      queue.push(edge.target);
    }
  }
}

/**
 * Walk backwards from a node through the graph to find the nearest active agent nodes
 * that this node depends on.
 */
function computeAgentDependencies(
  nodeId: string,
  activeNodes: Set<string>,
  inEdges: Map<string, string[]>,
  nodeMap: Map<string, FlowNode>,
  nodeToAgent: Map<string, string>,
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

    if (node.data.type === "agent" && nodeToAgent.has(currentId)) {
      deps.add(nodeToAgent.get(currentId)!);
    } else {
      // Not an agent node — keep walking backwards
      const parents = inEdges.get(currentId) ?? [];
      queue.push(...parents);
    }
  }

  return [...deps];
}
