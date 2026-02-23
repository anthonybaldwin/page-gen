import type { FlowTemplate, FlowNode, FlowEdge, UpstreamSource, ActionKind } from "../../shared/flow-types.ts";
import { nanoid } from "nanoid";
import { loadDefaultPrompt } from "./default-prompts.ts";

/** Bump this when default templates change structurally (auto-upgrades existing defaults) */
export const FLOW_DEFAULTS_VERSION = 13;

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

  // Version snapshot after dev (captures dev output before styling/testing)
  col++;
  const versionPostDev = makeNode("version-post-dev", "version", {
    type: "version",
    label: "Post-dev snapshot",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(versionPostDev);
  edges.push(makeEdge("frontend-dev", "version-post-dev"));
  edges.push(makeEdge("backend-dev", "version-post-dev"));

  // Styling
  col++;
  const styling = makeNode("styling", "agent", {
    type: "agent",
    agentName: "styling",
    inputTemplate: loadDefaultPrompt("styling"),
    upstreamSources: [
      { sourceKey: "architect" },
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
      { sourceKey: "vibe-brief" },
      { sourceKey: "mood-analysis" },
    ],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(styling);
  edges.push(makeEdge("version-post-dev", "styling"));

  // Build Check → Test Run (sequential)
  col++;
  const buildCheck = makeNode("build-check", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check",
    timeoutMs: 30_000,
    maxAttempts: 3,
    maxUniqueErrors: 10,
    buildCommand: "bunx vite build --mode development",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(buildCheck);
  edges.push(makeEdge("styling", "build-check"));

  col++;
  const testRun = makeNode("test-run", "action", {
    type: "action",
    kind: "test-run",
    label: "Test Run",
    timeoutMs: 60_000,
    maxAttempts: 2,
    maxTestFailures: 5,
    maxUniqueErrors: 10,
    testCommand: "bunx vitest run",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(testRun);
  edges.push(makeEdge("build-check", "test-run"));

  // Version snapshot after tests (captures tested state before reviews)
  col++;
  const versionPostTest = makeNode("version-post-test", "version", {
    type: "version",
    label: "Post-test snapshot",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(versionPostTest);
  edges.push(makeEdge("test-run", "version-post-test"));

  // Shared upstream sources for reviewer agents
  const reviewerSources: UpstreamSource[] = [
    { sourceKey: "architect" },
    { sourceKey: "frontend-dev", alias: "changed-files", transform: "file-manifest" },
    { sourceKey: "backend-dev", alias: "changed-files-backend", transform: "file-manifest" },
    { sourceKey: "styling", alias: "changed-files-styling", transform: "file-manifest" },
    { sourceKey: "project-source", transform: "project-source" },
  ];

  // Parallel reviewers (depend on version-post-test)
  col++;
  const codeReview = makeNode("code-review", "agent", {
    type: "agent",
    agentName: "code-review",
    inputTemplate: loadDefaultPrompt("code-review"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER - Y_SPACING);
  nodes.push(codeReview);
  edges.push(makeEdge("version-post-test", "code-review"));

  const security = makeNode("security", "agent", {
    type: "agent",
    agentName: "security",
    inputTemplate: loadDefaultPrompt("security"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER);
  nodes.push(security);
  edges.push(makeEdge("version-post-test", "security"));

  const qa = makeNode("qa", "agent", {
    type: "agent",
    agentName: "qa",
    inputTemplate: loadDefaultPrompt("qa"),
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(qa);
  edges.push(makeEdge("version-post-test", "qa"));

  // Remediation after reviewers
  col++;
  const remediation = makeNode("remediation", "action", {
    type: "action",
    kind: "remediation",
    label: "Remediation",
    maxAttempts: 2,
    remediationReviewerKeys: ["code-review", "security", "qa"],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(remediation);
  edges.push(makeEdge("code-review", "remediation"));
  edges.push(makeEdge("security", "remediation"));
  edges.push(makeEdge("qa", "remediation"));

  // Auto-snapshot after remediation
  col++;
  const versionBuild = makeNode("version-build", "version", {
    type: "version",
    label: "Auto-snapshot",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(versionBuild);
  edges.push(makeEdge("remediation", "version-build"));

  // Summary after version snapshot
  col++;
  const summary = makeNode("summary", "action", {
    type: "action",
    kind: "summary",
    label: "Summary",
    maxOutputTokens: 1024,
  }, col * X_SPACING, Y_CENTER);
  nodes.push(summary);
  edges.push(makeEdge("version-build", "summary"));

  return {
    id: `default-build-${nanoid(8)}`,
    name: "Default Build Pipeline",
    description: "Vibe Brief → Mood Analysis → Research → Architect → Dev → Snapshot → Styling → Build → Test → Snapshot → Reviews → Remediation → Snapshot → Summary",
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
 * Generate the default "fix" flow template.
 *
 * Scope routing:
 *   styling  → styling agent (quick path)
 *   frontend → frontend-dev agent (quick path)
 *   backend  → backend-dev agent (full path with reviews)
 *   full     → frontend-dev + backend-dev (full path with reviews)
 */
export function generateFixDefault(): FlowTemplate {
  const now = Date.now();
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let col = 0;

  const fixPrompt = "Fix the following issue in the existing code (provided in Previous Agent Outputs as \"project-source\"). Use read_file and list_files to find and inspect only the files relevant to this fix. Keep changes minimal and targeted. Original request: {{userMessage}}";
  const projectSourceUpstream: UpstreamSource[] = [
    { sourceKey: "project-source", transform: "project-source" },
  ];

  // ── Col 0: Styling scope? ──
  const condScope = makeNode("cond-scope", "condition", {
    type: "condition",
    mode: "expression",
    expression: "scope === 'styling'",
    label: "Styling only?",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(condScope);

  // ── Col 2: Quick-edit styling (true branch) ──
  col++;
  const stylingQuick = makeNode("styling-quick", "agent", {
    type: "agent",
    agentName: "styling",
    inputTemplate: fixPrompt,
    upstreamSources: projectSourceUpstream,
  }, col * X_SPACING, Y_CENTER - 2 * Y_SPACING);
  nodes.push(stylingQuick);
  edges.push(makeEdge("cond-scope", "styling-quick", "true", "styling"));

  // ── Col 1: Frontend scope? (false branch) ──
  const condFrontend = makeNode("cond-frontend", "condition", {
    type: "condition",
    mode: "expression",
    expression: "scope === 'frontend'",
    label: "Frontend only?",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(condFrontend);
  edges.push(makeEdge("cond-scope", "cond-frontend", "false"));

  // ── Col 2: Quick-edit frontend (true branch) ──
  col++;
  const frontendQuick = makeNode("frontend-quick", "agent", {
    type: "agent",
    agentName: "frontend-dev",
    inputTemplate: fixPrompt,
    upstreamSources: projectSourceUpstream,
  }, col * X_SPACING, Y_CENTER - 2 * Y_SPACING);
  nodes.push(frontendQuick);
  edges.push(makeEdge("cond-frontend", "frontend-quick", "true", "frontend"));

  // ── Col 2: Backend-only scope? (false branch — handles backend + full) ──
  const condBackendOnly = makeNode("cond-backend-only", "condition", {
    type: "condition",
    mode: "expression",
    expression: "scope === 'backend'",
    label: "Backend only?",
  }, col * X_SPACING, Y_CENTER + Y_SPACING / 2);
  nodes.push(condBackendOnly);
  edges.push(makeEdge("cond-frontend", "cond-backend-only", "false"));

  // ── Col 3: Full-path dev agents ──
  col++;

  // frontend-fix: runs when scope='full' (false branch of backend-only check)
  const frontendFix = makeNode("frontend-fix", "agent", {
    type: "agent",
    agentName: "frontend-dev",
    inputTemplate: fixPrompt,
    upstreamSources: projectSourceUpstream,
  }, col * X_SPACING, Y_CENTER - Y_SPACING / 2);
  nodes.push(frontendFix);
  edges.push(makeEdge("cond-backend-only", "frontend-fix", "false", "full"));

  // backend-fix: runs when scope='backend' OR scope='full'
  // Gets BOTH true edge (backend-only) and false edge (full scope)
  const backendFix = makeNode("backend-fix", "agent", {
    type: "agent",
    agentName: "backend-dev",
    inputTemplate: fixPrompt,
    upstreamSources: projectSourceUpstream,
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(backendFix);
  edges.push(makeEdge("cond-backend-only", "backend-fix", "true", "backend"));
  edges.push(makeEdge("cond-backend-only", "backend-fix", "false"));

  // ── Col 3: Quick-path build check (shared by styling-quick + frontend-quick) ──
  const buildCheckQuick = makeNode("build-check-quick", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check (quick)",
    timeoutMs: 30_000,
    maxAttempts: 3,
    maxUniqueErrors: 10,
    buildCommand: "bunx vite build --mode development",
  }, col * X_SPACING, Y_CENTER - 2 * Y_SPACING);
  nodes.push(buildCheckQuick);
  edges.push(makeEdge("styling-quick", "build-check-quick"));
  edges.push(makeEdge("frontend-quick", "build-check-quick"));

  // ── Col 4: Full-path build check → test run (sequential) ──
  col++;
  const buildCheckFix = makeNode("build-check-fix", "action", {
    type: "action",
    kind: "build-check",
    label: "Build Check",
    timeoutMs: 30_000,
    maxAttempts: 3,
    maxUniqueErrors: 10,
    buildCommand: "bunx vite build --mode development",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(buildCheckFix);
  edges.push(makeEdge("frontend-fix", "build-check-fix"));
  edges.push(makeEdge("backend-fix", "build-check-fix"));

  col++;
  const testRunFix = makeNode("test-run-fix", "action", {
    type: "action",
    kind: "test-run",
    label: "Test Run",
    timeoutMs: 60_000,
    maxAttempts: 2,
    maxTestFailures: 5,
    maxUniqueErrors: 10,
    testCommand: "bunx vitest run",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(testRunFix);
  edges.push(makeEdge("build-check-fix", "test-run-fix"));

  // ── Quick-path version snapshot ──
  const versionQuick = makeNode("version-quick", "version", {
    type: "version",
    label: "Auto-snapshot (quick fix)",
  }, (col - 1) * X_SPACING, Y_CENTER - 2 * Y_SPACING);
  nodes.push(versionQuick);
  edges.push(makeEdge("build-check-quick", "version-quick"));

  // ── Full-path version snapshot after tests ──
  col++;
  const versionPostTestFix = makeNode("version-post-test-fix", "version", {
    type: "version",
    label: "Post-test snapshot",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(versionPostTestFix);
  edges.push(makeEdge("test-run-fix", "version-post-test-fix"));

  // ── Full-path reviewers (depend on version-post-test-fix) ──
  col++;
  const reviewerSources: UpstreamSource[] = [
    { sourceKey: "frontend-fix", alias: "changed-files-frontend", transform: "file-manifest" },
    { sourceKey: "backend-fix", alias: "changed-files-backend", transform: "file-manifest" },
    { sourceKey: "project-source", transform: "project-source" },
  ];

  const codeReviewFix = makeNode("code-review-fix", "agent", {
    type: "agent",
    agentName: "code-review",
    inputTemplate: "Review all code changes made by dev agents (provided in Previous Agent Outputs). Original request: {{userMessage}}",
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER - Y_SPACING);
  nodes.push(codeReviewFix);
  edges.push(makeEdge("version-post-test-fix", "code-review-fix"));

  const securityFix = makeNode("security-fix", "agent", {
    type: "agent",
    agentName: "security",
    inputTemplate: "Security review all code changes (provided in Previous Agent Outputs). Original request: {{userMessage}}",
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER);
  nodes.push(securityFix);
  edges.push(makeEdge("version-post-test-fix", "security-fix"));

  const qaFix = makeNode("qa-fix", "agent", {
    type: "agent",
    agentName: "qa",
    inputTemplate: "Validate the fix against the original request (both provided in Previous Agent Outputs). Original request: {{userMessage}}",
    upstreamSources: reviewerSources,
  }, col * X_SPACING, Y_CENTER + Y_SPACING);
  nodes.push(qaFix);
  edges.push(makeEdge("version-post-test-fix", "qa-fix"));

  // ── Col 6: Remediation ──
  col++;
  const remediationFix = makeNode("remediation-fix", "action", {
    type: "action",
    kind: "remediation",
    label: "Remediation",
    maxAttempts: 2,
    remediationReviewerKeys: ["code-review-fix", "security-fix", "qa-fix"],
  }, col * X_SPACING, Y_CENTER);
  nodes.push(remediationFix);
  edges.push(makeEdge("code-review-fix", "remediation-fix"));
  edges.push(makeEdge("security-fix", "remediation-fix"));
  edges.push(makeEdge("qa-fix", "remediation-fix"));

  // ── Col 7: Full-path version snapshot ──
  col++;
  const versionFull = makeNode("version-full", "version", {
    type: "version",
    label: "Auto-snapshot (full fix)",
  }, col * X_SPACING, Y_CENTER);
  nodes.push(versionFull);
  edges.push(makeEdge("remediation-fix", "version-full"));

  // ── Col 8: Summary (shared endpoint for quick + full paths) ──
  col++;
  const summaryFix = makeNode("summary-fix", "action", {
    type: "action",
    kind: "summary",
    label: "Summary",
    maxOutputTokens: 1024,
  }, col * X_SPACING, Y_CENTER - Y_SPACING);
  nodes.push(summaryFix);
  edges.push(makeEdge("version-quick", "summary-fix"));
  edges.push(makeEdge("version-full", "summary-fix"));

  return {
    id: `default-fix-${nanoid(8)}`,
    name: "Default Fix Pipeline",
    description: "Scope-based routing: styling/frontend quick-edit, backend/full with reviews + remediation → Summary",
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
    description: "Answers questions about the project with full context",
    intent: "question",
    version: FLOW_DEFAULTS_VERSION,
    enabled: true,
    nodes: [
      makeNode("question-agent", "agent", {
        type: "agent",
        agentName: "orchestrator:question",
        inputTemplate: loadDefaultPrompt("orchestrator:question"),
        upstreamSources: [
          { sourceKey: "project-source", transform: "project-source" },
        ],
      }, 0, Y_CENTER),
      makeNode("question-answer", "action", {
        type: "action",
        kind: "answer" as ActionKind,
        label: "Answer",
      }, X_SPACING, Y_CENTER),
    ],
    edges: [
      { id: "e-question-answer", source: "question-agent", target: "question-answer" },
    ],
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
