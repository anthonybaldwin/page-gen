import { describe, test, expect } from "bun:test";
import { resolveFlowTemplate } from "../../src/server/agents/flow-resolver.ts";
import { generateBuildDefault, generateFixDefault, FLOW_DEFAULTS_VERSION } from "../../src/server/agents/flow-defaults.ts";
import type { FlowTemplate, FlowResolutionContext } from "../../src/shared/flow-types.ts";
import { isActionStep, isAgentStep, stepKey, type ActionStep, type PlanStep } from "../../src/server/agents/orchestrator.ts";

/** Extract action steps from a resolved plan */
function actionSteps(steps: PlanStep[]): ActionStep[] {
  return steps.filter((s): s is ActionStep => isActionStep(s));
}

/** Default resolution context for build intent */
const buildCtx: FlowResolutionContext = {
  intent: "build",
  scope: "full",
  needsBackend: false,
  hasFiles: false,
  userMessage: "Build a landing page",
};

/** Default resolution context for fix intent */
const fixCtx: FlowResolutionContext = {
  intent: "fix",
  scope: "frontend",
  needsBackend: false,
  hasFiles: true,
  userMessage: "Fix the button",
};

// --- Flow defaults version ---

describe("FLOW_DEFAULTS_VERSION", () => {
  test("is version 7", () => {
    expect(FLOW_DEFAULTS_VERSION).toBe(7);
  });
});

// --- Build default template ---

describe("generateBuildDefault", () => {
  test("includes summary node", () => {
    const template = generateBuildDefault();
    const summaryNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "summary"
    );
    expect(summaryNode).toBeDefined();
    expect(summaryNode!.id).toBe("summary");
  });

  test("summary is connected after remediation", () => {
    const template = generateBuildDefault();
    const edge = template.edges.find(
      (e) => e.source === "remediation" && e.target === "summary"
    );
    expect(edge).toBeDefined();
  });

  test("includes build-check and test-run nodes", () => {
    const template = generateBuildDefault();
    const buildCheck = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "build-check"
    );
    const testRun = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "test-run"
    );
    expect(buildCheck).toBeDefined();
    expect(testRun).toBeDefined();
  });

  test("includes remediation node", () => {
    const template = generateBuildDefault();
    const remediation = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "remediation"
    );
    expect(remediation).toBeDefined();
  });

  test("description mentions Summary", () => {
    const template = generateBuildDefault();
    expect(template.description).toContain("Summary");
  });
});

// --- Fix default template ---

describe("generateFixDefault", () => {
  test("includes summary node", () => {
    const template = generateFixDefault();
    const summaryNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "summary"
    );
    expect(summaryNode).toBeDefined();
  });

  test("summary receives edges from both quick and full paths", () => {
    const template = generateFixDefault();
    const summaryEdges = template.edges.filter((e) => e.target === "summary-fix");
    const sources = summaryEdges.map((e) => e.source);
    expect(sources).toContain("build-check-quick");
    expect(sources).toContain("remediation-fix");
  });

  test("includes build-check and test-run nodes for full path", () => {
    const template = generateFixDefault();
    const buildCheck = template.nodes.find((n) => n.id === "build-check-fix");
    const testRun = template.nodes.find((n) => n.id === "test-run-fix");
    expect(buildCheck).toBeDefined();
    expect(testRun).toBeDefined();
  });
});

// --- Resolver: all action kinds become direct steps ---

describe("resolveFlowTemplate (action steps)", () => {
  test("build-check resolves to a direct action step", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const buildCheck = actions.find((a) => a.actionKind === "build-check");
    expect(buildCheck).toBeDefined();
    expect(buildCheck!.kind).toBe("action");
  });

  test("test-run resolves to a direct action step", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const testRun = actions.find((a) => a.actionKind === "test-run");
    expect(testRun).toBeDefined();
  });

  test("remediation resolves to a direct action step", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const remediation = actions.find((a) => a.actionKind === "remediation");
    expect(remediation).toBeDefined();
  });

  test("summary resolves to a direct action step", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary).toBeDefined();
  });

  test("vibe-intake and mood-analysis still resolve as direct steps", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    expect(actions.find((a) => a.actionKind === "vibe-intake")).toBeDefined();
    expect(actions.find((a) => a.actionKind === "mood-analysis")).toBeDefined();
  });

  test("action step dependencies are computed correctly", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    // Summary depends on remediation
    expect(summary!.dependsOn).toContain("remediation");
  });

  test("per-node settings are copied to ActionStep", () => {
    const template = generateBuildDefault();
    // Manually set settings on a build-check node
    const buildCheckNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "build-check"
    );
    if (buildCheckNode && buildCheckNode.data.type === "action") {
      buildCheckNode.data.timeoutMs = 45000;
      buildCheckNode.data.maxAttempts = 5;
      buildCheckNode.data.maxUniqueErrors = 15;
    }

    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const buildCheck = actions.find((a) => a.actionKind === "build-check");
    expect(buildCheck!.timeoutMs).toBe(45000);
    expect(buildCheck!.maxAttempts).toBe(5);
    expect(buildCheck!.maxUniqueErrors).toBe(15);
  });

  test("per-node settings are undefined when not set on node", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const buildCheck = actions.find((a) => a.actionKind === "build-check");
    // Default template doesn't set explicit values
    expect(buildCheck!.timeoutMs).toBeUndefined();
    expect(buildCheck!.maxAttempts).toBeUndefined();
  });

  test("systemPrompt is copied to ActionStep when set", () => {
    const template = generateBuildDefault();
    const summaryNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "summary"
    );
    if (summaryNode && summaryNode.data.type === "action") {
      summaryNode.data.systemPrompt = "Custom summary instructions here.";
    }

    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary!.systemPrompt).toBe("Custom summary instructions here.");
  });

  test("systemPrompt is undefined when not set on node", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary!.systemPrompt).toBeUndefined();
  });

  test("maxOutputTokens is copied to ActionStep when set", () => {
    const template = generateBuildDefault();
    const summaryNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "summary"
    );
    if (summaryNode && summaryNode.data.type === "action") {
      summaryNode.data.maxOutputTokens = 2048;
    }

    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary!.maxOutputTokens).toBe(2048);
  });

  test("maxOutputTokens is undefined when not set on node", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary!.maxOutputTokens).toBeUndefined();
  });

  test("action overrides are still collected for backwards compat", () => {
    const template = generateBuildDefault();
    const buildCheckNode = template.nodes.find(
      (n) => n.data.type === "action" && n.data.kind === "build-check"
    );
    if (buildCheckNode && buildCheckNode.data.type === "action") {
      buildCheckNode.data.timeoutMs = 45000;
    }

    const plan = resolveFlowTemplate(template, buildCtx);
    expect(plan.actionOverrides).toBeDefined();
    expect(plan.actionOverrides!.buildTimeoutMs).toBe(45000);
  });
});

// --- Resolver: fix template resolves scope-based routing ---

describe("resolveFlowTemplate (fix template)", () => {
  test("styling scope routes to styling-quick agent", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "styling",
    });
    const agents = plan.steps.filter((s) => isAgentStep(s));
    const agentNames = agents.map((s) => (s as any).agentName);
    expect(agentNames).toContain("styling");
  });

  test("frontend scope routes to frontend-quick agent", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "frontend",
    });
    const agents = plan.steps.filter((s) => isAgentStep(s));
    const agentNames = agents.map((s) => (s as any).agentName);
    expect(agentNames).toContain("frontend-dev");
  });

  test("fix template includes summary node in resolved plan", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "full",
    });
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary).toBeDefined();
  });
});

// --- Removing nodes removes behavior ---

describe("resolveFlowTemplate (node removal)", () => {
  test("removing build-check node means no build-check step", () => {
    const template = generateBuildDefault();
    template.nodes = template.nodes.filter((n) => n.id !== "build-check");
    template.edges = template.edges.filter(
      (e) => e.source !== "build-check" && e.target !== "build-check"
    );
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    expect(actions.find((a) => a.actionKind === "build-check")).toBeUndefined();
  });

  test("removing test-run node means no test-run step", () => {
    const template = generateBuildDefault();
    template.nodes = template.nodes.filter((n) => n.id !== "test-run");
    template.edges = template.edges.filter(
      (e) => e.source !== "test-run" && e.target !== "test-run"
    );
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    expect(actions.find((a) => a.actionKind === "test-run")).toBeUndefined();
  });

  test("removing remediation node means no remediation step", () => {
    const template = generateBuildDefault();
    template.nodes = template.nodes.filter((n) => n.id !== "remediation");
    template.edges = template.edges.filter(
      (e) => e.source !== "remediation" && e.target !== "remediation"
    );
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    expect(actions.find((a) => a.actionKind === "remediation")).toBeUndefined();
  });

  test("removing summary node means no summary step", () => {
    const template = generateBuildDefault();
    template.nodes = template.nodes.filter((n) => n.id !== "summary");
    template.edges = template.edges.filter(
      (e) => e.source !== "summary" && e.target !== "summary"
    );
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    expect(actions.find((a) => a.actionKind === "summary")).toBeUndefined();
  });
});
