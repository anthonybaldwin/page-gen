import type { FlowTemplate, FlowNode, FlowEdge, UpstreamSource } from "../../shared/flow-types.ts";
import { nanoid } from "nanoid";
import { loadDefaultPrompt } from "./default-prompts.ts";

/** Bump this when default templates change structurally (auto-upgrades existing defaults) */
export const FLOW_DEFAULTS_VERSION = 6;

/** Layout helpers for auto-positioning nodes */
const X_SPACING = 280;
const Y_SPACING = 150;
const Y_CENTER = 200;

function makeNode(
  id: string,
  type: FlowNode["type"],
  data: FlowNode["data"],
  x: number,
  y: number,
): FlowNode {
  return { id, type, data, position: { x, y } };
}

function makeEdge(source: string, target: string, sourceHandle?: string, label?: string): FlowEdge {
  return { id: `e-${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`, source, target, sourceHandle, label };
}

/**
 * Generate the default "build" flow template that replicates the hardcoded
 * buildExecutionPlan logic in orchestrator.ts.
 */
export function generateBuildDefault(): FlowTemplate {
  const now = Date.now();
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Column positions
  let col = 0;

  // Vibe Intake
  const vibeIntake = makeNode("vibe-intake", "action", {
    type: "action",
    kind: "vibe-intake",
    label: "Vibe Brief",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(vibeIntake);

  // Mood Analysis
  col++;
  const moodAnalysis = makeNode("mood-analysis", "action", {
    type: "action",
    kind: "mood-analysis",
    label: "Mood Analysis",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(moodAnalysis);
  edges.push(makeEdge("vibe-intake", "mood-analysis"));

  // Research
  col++;
  const research = makeNode("research", "agent", {
    type: "agent",
    agentName: "research",
    inputTemplate: loadDefaultPrompt("research"),
    upstreamSources: [
      { sourceKey: "vibe-brief" },
      { sourceKey: "mood-analysis" },
    ],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(research);
  edges.push(makeEdge("mood-analysis", "research"));

  // Architect
  col++;
  const architect = makeNode("architect", "agent", {
    type: "agent",
    agentName: "architect",
    inputTemplate: loadDefaultPrompt("architect"),
    upstreamSources: [
      { sourceKey: "research" },
      { sourceKey: "vibe-brief" },
      { sourceKey: "mood-analysis" },
    ],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(architect);
  edges.push(makeEdge("research", "architect"));

  // Checkpoint: Design Direction (pause for user to choose design system)
  col++;
  const designCheckpoint = makeNode("design-checkpoint", "checkpoint", {
    type: "checkpoint",
    label: "Choose Design Direction",
    skipInYolo: true,
    checkpointType: "design_direction",
    message: "The architect produced multiple design directions. Pick the one that best fits your vision.",
    timeoutMs: 600_000,
  }, col * X_SPACING, Y_CENTER);
  nodes.push(designCheckpoint);
  edges.push(makeEdge("architect", "design-checkpoint"));

  // Condition: needsBackend?
  col++;
  const condNeedsBackend = makeNode("cond-backend", "condition", {
    type: "condition",
    mode: "predefined",
    predefined: "needsBackend",
    label: "Needs Backend?",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(condNeedsBackend);
  edges.push(makeEdge("design-checkpoint", "cond-backend"));

  // Frontend Dev
  col++;
  const frontendDev = makeNode("frontend-dev", "agent", {
    type: "agent",
    agentName: "frontend-dev",
    inputTemplate: loadDefaultPrompt("frontend-dev"),
    upstreamSources: [
      { sourceKey: "architect" },
      { sourceKey: "research" },
      { sourceKey: "vibe-brief" },
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
    ],
  }, col * X_SPACING, Y_CENTER - Y_SPACING / 2);
  nodes.push(frontendDev);
  edges.push(makeEdge("cond-backend", "frontend-dev", "true", "yes"));
  edges.push(makeEdge("cond-backend", "frontend-dev", "false", "no"));

  // Backend Dev (conditional)
  const backendDev = makeNode("backend-dev", "agent", {
    type: "agent",
    agentName: "backend-dev",
    inputTemplate: loadDefaultPrompt("backend-dev"),
    upstreamSources: [
      { sourceKey: "architect" },
      { sourceKey: "research" },
    ],
  }, col * X_SPACING, Y_CENTER + Y_SPACING / 2);
  nodes.push(backendDev);
  edges.push(makeEdge("cond-backend", "backend-dev", "true", "yes"));

  // Styling
  col++;
  const styling = makeNode("styling", "agent", {
    type: "agent",
    agentName: "styling",
    inputTemplate: loadDefaultPrompt("styling"),
    upstreamSources: [
      { sourceKey: "architect" },
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
    ],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(styling);
  edges.push(makeEdge("frontend-dev", "styling"));
  edges.push(makeEdge("backend-dev", "styling"));

  // Build Check + Test Run after styling
  col++;
  const buildCheck = makeNode("build-check", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check",
  }, col * X_SPACING, Y_CENTER - Y_SPACING / 2);
  nodes.push(buildCheck);
  edges.push(makeEdge("styling", "build-check"));

  const testRun = makeNode("test-run", "action", {
    type: "action",
    kind: "test-run",
    label: "Test Run",
  }, col * X_SPACING, Y_CENTER + Y_SPACING / 2);
  nodes.push(testRun);
  edges.push(makeEdge("styling", "test-run"));

  // Shared upstream sources for reviewer agents
  const reviewerSources: UpstreamSource[] = [
    { sourceKey: "architect" },
    { sourceKey: "frontend-dev", alias: "changed-files", transform: "file-manifest" },
    { sourceKey: "backend-dev", alias: "changed-files-backend", transform: "file-manifest" },
    { sourceKey: "styling", alias: "changed-files-styling", transform: "file-manifest" },
    { sourceKey: "project-source", transform: "project-source" },
  ];

  // Parallel reviewers
  col++;
  const codeReview = makeNode("code-review", "agent", {
    type: "agent",
    agentName: "code-review",
    inputTemplate: loadDefaultPrompt("code-review"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER - Y_SPACING);
  nodes.push(codeReview);
  edges.push(makeEdge("build-check", "code-review"));
  edges.push(makeEdge("test-run", "code-review"));

  const security = makeNode("security", "agent", {
    type: "agent",
    agentName: "security",
    inputTemplate: loadDefaultPrompt("security"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER);
  nodes.push(security);
  edges.push(makeEdge("build-check", "security"));
  edges.push(makeEdge("test-run", "security"));

  const qa = makeNode("qa", "agent", {
    type: "agent",
    agentName: "qa",
    inputTemplate: loadDefaultPrompt("qa"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(qa);
  edges.push(makeEdge("build-check", "qa"));
  edges.push(makeEdge("test-run", "qa"));

  // Remediation after reviewers
  col++;
  const remediation = makeNode("remediation", "action", {
    type: "action",
    kind: "remediation",
    label: "Remediation",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(remediation);
  edges.push(makeEdge("code-review", "remediation"));
  edges.push(makeEdge("security", "remediation"));
  edges.push(makeEdge("qa", "remediation"));

  return {
    id: `default-build-${nanoid(8)}`,
    name: "Default Build Pipeline",
    description: "Vibe Brief → Mood Analysis → Research → Architect → Dev → Styling → Build & Test → Reviews → Remediation",
    intent: "build",
    version: FLOW_DEFAULTS_VERSION,
    enabled: true,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    isDefault: true,
  };
}

/**
 * Generate the default "fix" flow template that replicates buildFixPlan.
 */
export function generateFixDefault(): FlowTemplate {
  const now = Date.now();
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let col = 0;

  // Condition: scope
  const condScope = makeNode("cond-scope", "condition", {
    type: "condition",
    mode: "expression",
    expression: "scope === 'styling'",
    label: "Styling only?",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(condScope);

  // Quick-edit: styling
  col++;
  const stylingQuick = makeNode("styling-quick", "agent", {
    type: "agent",
    agentName: "styling",
    inputTemplate: "Fix the following styling issue in the existing code. Use read_file/list_files to inspect relevant files and keep changes minimal and targeted. Original request: {{userMessage}}",
    upstreamSources: [
      { sourceKey: "project-source", transform: "project-source" },
    ],
  }, col * X_SPACING, Y_CENTER - Y_SPACING);
  nodes.push(stylingQuick);
  edges.push(makeEdge("cond-scope", "styling-quick", "true", "styling"));

  // Condition: frontend only?
  const condFrontend = makeNode("cond-frontend", "condition", {
    type: "condition",
    mode: "expression",
    expression: "scope === 'frontend'",
    label: "Frontend only?",
  }, col * X_SPACING, Y_CENTER + Y_SPACING / 2);
  nodes.push(condFrontend);
  edges.push(makeEdge("cond-scope", "cond-frontend", "false"));

  // Quick-edit: frontend
  col++;
  const frontendQuick = makeNode("frontend-quick", "agent", {
    type: "agent",
    agentName: "frontend-dev",
    inputTemplate: "Fix the following issue in the existing code. Use read_file/list_files to inspect relevant files and keep changes minimal and targeted. Original request: {{userMessage}}",
    upstreamSources: [
      { sourceKey: "project-source", transform: "project-source" },
    ],
  }, col * X_SPACING, Y_CENTER - Y_SPACING / 2);
  nodes.push(frontendQuick);
  edges.push(makeEdge("cond-frontend", "frontend-quick", "true", "frontend"));

  // Full fix: dev agents
  const devFix = makeNode("dev-fix", "agent", {
    type: "agent",
    agentName: "frontend-dev",
    inputTemplate: "Fix the following issue in the existing code (provided in Previous Agent Outputs as \"project-source\"). Original request: {{userMessage}}",
    upstreamSources: [
      { sourceKey: "project-source", transform: "project-source" },
    ],
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(devFix);
  edges.push(makeEdge("cond-frontend", "dev-fix", "false"));

  // Build check after quick paths
  col++;
  const buildCheckQuick = makeNode("build-check-quick", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check",
  }, col * X_SPACING, Y_CENTER - Y_SPACING * 0.75);
  nodes.push(buildCheckQuick);
  edges.push(makeEdge("styling-quick", "build-check-quick"));
  edges.push(makeEdge("frontend-quick", "build-check-quick"));

  // Build check + test run after full fix dev
  const buildCheckFix = makeNode("build-check-fix", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check",
  }, col * X_SPACING, Y_CENTER + Y_SPACING / 2);
  nodes.push(buildCheckFix);
  edges.push(makeEdge("dev-fix", "build-check-fix"));

  const testRunFix = makeNode("test-run-fix", "action", {
    type: "action",
    kind: "test-run",
    label: "Test Run",
  }, col * X_SPACING, Y_CENTER + Y_SPACING * 1.5);
  nodes.push(testRunFix);
  edges.push(makeEdge("dev-fix", "test-run-fix"));

  // Reviewers (for full fix path)
  col++;
  const codeReview = makeNode("code-review-fix", "agent", {
    type: "agent",
    agentName: "code-review",
    inputTemplate: "Review all code changes made by dev agents (provided in Previous Agent Outputs). Original request: {{userMessage}}",
    upstreamSources: [
      { sourceKey: "dev-fix", alias: "changed-files", transform: "file-manifest" },
      { sourceKey: "project-source", transform: "project-source" },
    ],
  }, col * X_SPACING, Y_CENTER + Y_SPACING - Y_SPACING / 2);
  nodes.push(codeReview);
  edges.push(makeEdge("build-check-fix", "code-review-fix"));
  edges.push(makeEdge("test-run-fix", "code-review-fix"));

  const securityFix = makeNode("security-fix", "agent", {
    type: "agent",
    agentName: "security",
    inputTemplate: "Security review all code changes (provided in Previous Agent Outputs). Original request: {{userMessage}}",
    upstreamSources: [
      { sourceKey: "dev-fix", alias: "changed-files", transform: "file-manifest" },
      { sourceKey: "project-source", transform: "project-source" },
    ],
  }, col * X_SPACING, Y_CENTER + Y_SPACING + Y_SPACING / 2);
  nodes.push(securityFix);
  edges.push(makeEdge("build-check-fix", "security-fix"));
  edges.push(makeEdge("test-run-fix", "security-fix"));

  // Remediation
  col++;
  const remediation = makeNode("remediation-fix", "action", {
    type: "action",
    kind: "remediation",
    label: "Remediation",
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(remediation);
  edges.push(makeEdge("code-review-fix", "remediation-fix"));
  edges.push(makeEdge("security-fix", "remediation-fix"));

  return {
    id: `default-fix-${nanoid(8)}`,
    name: "Default Fix Pipeline",
    description: "Scope-based routing: quick-edit for styling/frontend, full pipeline with reviewers for backend/full",
    intent: "fix",
    version: FLOW_DEFAULTS_VERSION,
    enabled: true,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
    isDefault: true,
  };
}

/**
 * Generate the default "question" flow template.
 */
export function generateQuestionDefault(): FlowTemplate {
  const now = Date.now();

  return {
    id: `default-question-${nanoid(8)}`,
    name: "Default Question Pipeline",
    description: "Single orchestrator:question node — answers questions with project context",
    intent: "question",
    version: FLOW_DEFAULTS_VERSION,
    enabled: true,
    nodes: [
      makeNode("question-agent", "agent", {
        type: "agent",
        agentName: "orchestrator:question",
        inputTemplate: loadDefaultPrompt("orchestrator:question"),
      }, 0, Y_CENTER),
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
    isDefault: true,
  };
}

/** Generate a default template for a specific intent. */
export function generateDefaultForIntent(intent: string): FlowTemplate | null {
  switch (intent) {
    case "build": return generateBuildDefault();
    case "fix": return generateFixDefault();
    case "question": return generateQuestionDefault();
    default: return null;
  }
}

/** Generate all three default templates. */
export function generateAllDefaults(): FlowTemplate[] {
  return [generateBuildDefault(), generateFixDefault(), generateQuestionDefault()];
}
