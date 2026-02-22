import type { FlowTemplate, FlowNode, FlowEdge } from "./flow-types.ts";
import { CONDITION_VARIABLES } from "./flow-types.ts";

export interface ValidationError {
  type: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/**
 * Validate a flow template for correctness.
 * Runs client-side before save AND server-side before accepting.
 */
export function validateFlowTemplate(
  template: FlowTemplate,
  knownAgentNames?: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(template.nodes.map((n) => n.id));

  // --- Basic structure ---
  if (!template.nodes.length) {
    errors.push({ type: "error", message: "Flow must have at least one node" });
    return errors;
  }

  if (!template.name.trim()) {
    errors.push({ type: "error", message: "Flow template must have a name" });
  }

  // --- Edge validation ---
  for (const edge of template.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ type: "error", message: `Edge "${edge.id}" references non-existent source node "${edge.source}"`, edgeId: edge.id });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ type: "error", message: `Edge "${edge.id}" references non-existent target node "${edge.target}"`, edgeId: edge.id });
    }
  }

  // --- Build adjacency for graph analysis ---
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of template.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of template.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      outgoing.get(edge.source)!.push(edge.target);
      incoming.get(edge.target)!.push(edge.source);
    }
  }

  // --- Start and terminal nodes ---
  const startNodes = template.nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0);
  const terminalNodes = template.nodes.filter((n) => (outgoing.get(n.id)?.length ?? 0) === 0);

  if (startNodes.length === 0) {
    errors.push({ type: "error", message: "Flow must have at least one start node (no incoming edges)" });
  }
  if (terminalNodes.length === 0) {
    errors.push({ type: "error", message: "Flow must have at least one terminal node (no outgoing edges)" });
  }

  // --- Acyclicity (topological sort via Kahn's algorithm) ---
  const cycleErrors = checkAcyclicity(template.nodes, template.edges);
  errors.push(...cycleErrors);

  // --- Reachability: all nodes reachable from start nodes ---
  const reachable = new Set<string>();
  const queue = startNodes.map((n) => n.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const neighbor of outgoing.get(current) ?? []) {
      if (!reachable.has(neighbor)) queue.push(neighbor);
    }
  }
  for (const node of template.nodes) {
    if (!reachable.has(node.id)) {
      errors.push({ type: "error", message: `Node "${node.id}" is not reachable from any start node`, nodeId: node.id });
    }
  }

  // --- Node-specific validation ---
  for (const node of template.nodes) {
    validateNode(node, errors, knownAgentNames);
  }

  // --- Condition nodes must have true/false edges ---
  for (const node of template.nodes) {
    if (node.data.type === "condition") {
      const nodeEdges = template.edges.filter((e) => e.source === node.id);
      const handles = new Set(nodeEdges.map((e) => e.sourceHandle));
      if (!handles.has("true") && !handles.has("false")) {
        errors.push({ type: "warning", message: `Condition node "${node.id}" should have "true" and/or "false" branch edges`, nodeId: node.id });
      }
    }
  }

  return errors;
}

function validateNode(
  node: FlowNode,
  errors: ValidationError[],
  knownAgentNames?: string[],
): void {
  const { data } = node;

  switch (data.type) {
    case "agent": {
      if (!data.agentName.trim()) {
        errors.push({ type: "error", message: `Agent node "${node.id}" must have an agent name`, nodeId: node.id });
      }
      if (knownAgentNames && !knownAgentNames.includes(data.agentName)) {
        errors.push({ type: "error", message: `Agent node "${node.id}" references unknown agent "${data.agentName}"`, nodeId: node.id });
      }
      break;
    }
    case "condition": {
      if (data.mode === "predefined" && !data.predefined) {
        errors.push({ type: "error", message: `Condition node "${node.id}" has no predefined condition selected`, nodeId: node.id });
      }
      if (data.mode === "expression") {
        if (!data.expression?.trim()) {
          errors.push({ type: "error", message: `Condition node "${node.id}" has an empty expression`, nodeId: node.id });
        } else {
          const exprErrors = validateConditionExpression(data.expression);
          for (const msg of exprErrors) {
            errors.push({ type: "error", message: `Condition node "${node.id}": ${msg}`, nodeId: node.id });
          }
        }
      }
      break;
    }
    case "checkpoint": {
      if (!data.label.trim()) {
        errors.push({ type: "warning", message: `Checkpoint node "${node.id}" has no label`, nodeId: node.id });
      }
      break;
    }
    case "action": {
      const validKinds = ["build-check", "test-run", "remediation"];
      if (!validKinds.includes(data.kind)) {
        errors.push({ type: "error", message: `Action node "${node.id}" has invalid kind "${data.kind}"`, nodeId: node.id });
      }
      break;
    }
  }
}

/**
 * Validate a condition expression uses only allowed variables.
 * Returns an array of error messages (empty = valid).
 */
function validateConditionExpression(expression: string): string[] {
  const errors: string[] = [];
  const allowedVars = new Set<string>(CONDITION_VARIABLES);

  // Extract identifiers (simple approach: word characters not preceded by . or ")
  const identifiers = expression.match(/\b[a-zA-Z_]\w*\b/g) ?? [];
  const jsKeywords = new Set(["true", "false", "null", "undefined", "typeof", "instanceof"]);
  const jsOperators = new Set(["and", "or", "not"]);

  for (const id of identifiers) {
    if (jsKeywords.has(id) || jsOperators.has(id)) continue;
    if (!allowedVars.has(id)) {
      errors.push(`Unknown variable "${id}". Allowed: ${[...allowedVars].join(", ")}`);
    }
  }

  // Check for dangerous patterns
  const dangerous = /\b(eval|Function|require|import|process|window|document|globalThis|__proto__)\b/;
  if (dangerous.test(expression)) {
    errors.push("Expression contains disallowed keywords");
  }

  return errors;
}

/**
 * Check for cycles using Kahn's algorithm for topological sorting.
 * Returns validation errors if cycles are detected.
 */
function checkAcyclicity(nodes: FlowNode[], edges: FlowEdge[]): ValidationError[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let sorted = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted++;
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted < nodeIds.size) {
    return [{ type: "error", message: "Flow contains a cycle — pipelines must be directed acyclic graphs (DAGs)" }];
  }
  return [];
}

/**
 * Topologically sort nodes. Returns sorted node IDs or null if cycle detected.
 */
export function topologicalSort(nodes: FlowNode[], edges: FlowEdge[]): string[] | null {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return result.length === nodeIds.size ? result : null;
}
