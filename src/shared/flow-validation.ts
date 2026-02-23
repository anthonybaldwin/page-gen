import type { FlowTemplate, FlowNode, FlowEdge, UpstreamSource } from "./flow-types.ts";
import { CONDITION_VARIABLES, UPSTREAM_TRANSFORMS, WELL_KNOWN_SOURCES } from "./flow-types.ts";

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

  // --- Upstream source validation (requires graph context) ---
  for (const node of template.nodes) {
    if (node.data.type === "agent" && node.data.upstreamSources) {
      validateUpstreamSources(node, node.data.upstreamSources, template.nodes, template.edges, errors);
    }
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
      const validKinds = ["build-check", "test-run", "remediation", "summary", "vibe-intake", "mood-analysis", "answer", "shell", "llm-call"];
      if (!validKinds.includes(data.kind)) {
        errors.push({ type: "error", message: `Action node "${node.id}" has invalid kind "${data.kind}"`, nodeId: node.id });
      }
      if (data.kind === "shell" && !data.shellCommand?.trim()) {
        errors.push({ type: "error", message: `Shell node "${node.id}" requires a command`, nodeId: node.id });
      }
      if (data.kind === "llm-call" && !data.systemPrompt?.trim()) {
        errors.push({ type: "error", message: `LLM Call node "${node.id}" requires a system prompt`, nodeId: node.id });
      }
      break;
    }
    case "version": {
      if (!data.label.trim()) {
        errors.push({ type: "warning", message: `Version node "${node.id}" has no label`, nodeId: node.id });
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
 * Validate upstream sources for an agent node.
 * Checks that sourceKeys reference ancestor node IDs or well-known keys,
 * transforms are valid, and aliases are unique.
 */
function validateUpstreamSources(
  node: FlowNode,
  sources: UpstreamSource[],
  allNodes: FlowNode[],
  allEdges: FlowEdge[],
  errors: ValidationError[],
): void {
  // Collect all ancestor node IDs via BFS backwards
  const ancestors = new Set<string>();
  const inEdges = new Map<string, string[]>();
  for (const edge of allEdges) {
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    inEdges.get(edge.target)!.push(edge.source);
  }
  const queue = [...(inEdges.get(node.id) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    queue.push(...(inEdges.get(id) ?? []));
  }

  const nodeIds = new Set(allNodes.map((n) => n.id));
  const wellKnown = new Set<string>(WELL_KNOWN_SOURCES);
  const aliases = new Set<string>();

  for (const source of sources) {
    // Validate sourceKey references an ancestor or well-known key
    if (!ancestors.has(source.sourceKey) && !wellKnown.has(source.sourceKey) && !nodeIds.has(source.sourceKey)) {
      errors.push({
        type: "warning",
        message: `Agent node "${node.id}": upstream source "${source.sourceKey}" is not an ancestor node or well-known key`,
        nodeId: node.id,
      });
    } else if (nodeIds.has(source.sourceKey) && !ancestors.has(source.sourceKey) && !wellKnown.has(source.sourceKey)) {
      errors.push({
        type: "warning",
        message: `Agent node "${node.id}": upstream source "${source.sourceKey}" exists but is not an ancestor of this node`,
        nodeId: node.id,
      });
    }

    // Validate transform
    if (source.transform && !UPSTREAM_TRANSFORMS.includes(source.transform)) {
      errors.push({
        type: "error",
        message: `Agent node "${node.id}": invalid transform "${source.transform}" on source "${source.sourceKey}"`,
        nodeId: node.id,
      });
    }

    // Warn if design-system transform used on non-architect source
    if (source.transform === "design-system" && source.sourceKey !== "architect") {
      errors.push({
        type: "warning",
        message: `Agent node "${node.id}": "design-system" transform is typically used with "architect" source, not "${source.sourceKey}"`,
        nodeId: node.id,
      });
    }

    // Check for duplicate aliases
    const key = source.alias ?? source.sourceKey;
    if (aliases.has(key)) {
      errors.push({
        type: "warning",
        message: `Agent node "${node.id}": duplicate upstream alias "${key}"`,
        nodeId: node.id,
      });
    }
    aliases.add(key);
  }
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
