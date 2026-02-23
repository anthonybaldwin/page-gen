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
  test("is version 10", () => {
    expect(FLOW_DEFAULTS_VERSION).toBe(10);
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

  test("summary is connected after remediation via version node", () => {
    const template = generateBuildDefault();
    const remToVersion = template.edges.find(
      (e) => e.source === "remediation" && e.target === "version-build"
    );
    const versionToSummary = template.edges.find(
      (e) => e.source === "version-build" && e.target === "summary"
    );
    expect(remToVersion).toBeDefined();
    expect(versionToSummary).toBeDefined();
  });

  test("includes version node for auto-snapshot", () => {
    const template = generateBuildDefault();
    const versionNode = template.nodes.find((n) => n.id === "version-build");
    expect(versionNode).toBeDefined();
    expect(versionNode!.data.type).toBe("version");
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

  test("summary receives edges from both quick and full version nodes", () => {
    const template = generateFixDefault();
    const summaryEdges = template.edges.filter((e) => e.target === "summary-fix");
    const sources = summaryEdges.map((e) => e.source);
    expect(sources).toContain("version-quick");
    expect(sources).toContain("version-full");
  });

  test("includes version nodes for auto-snapshot on both paths", () => {
    const template = generateFixDefault();
    const versionQuick = template.nodes.find((n) => n.id === "version-quick");
    const versionFull = template.nodes.find((n) => n.id === "version-full");
    expect(versionQuick).toBeDefined();
    expect(versionQuick!.data.type).toBe("version");
    expect(versionFull).toBeDefined();
    expect(versionFull!.data.type).toBe("version");
  });

  test("quick-fix agents have project-source upstream", () => {
    const template = generateFixDefault();
    const frontendQuick = template.nodes.find((n) => n.id === "frontend-quick");
    const stylingQuick = template.nodes.find((n) => n.id === "styling-quick");
    expect(frontendQuick).toBeDefined();
    expect(stylingQuick).toBeDefined();
    const fqSources = (frontendQuick!.data as any).upstreamSources;
    const sqSources = (stylingQuick!.data as any).upstreamSources;
    expect(fqSources).toBeDefined();
    expect(sqSources).toBeDefined();
    expect(fqSources.some((s: any) => s.transform === "project-source")).toBe(true);
    expect(sqSources.some((s: any) => s.transform === "project-source")).toBe(true);
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
    // Summary depends on version-build (which depends on remediation)
    expect(summary!.dependsOn).toContain("version-build");
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

  test("per-node settings from defaults are resolved to ActionStep", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const buildCheck = actions.find((a) => a.actionKind === "build-check");
    // Default template now sets explicit values
    expect(buildCheck!.timeoutMs).toBe(30_000);
    expect(buildCheck!.maxAttempts).toBe(3);
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

  test("maxOutputTokens from defaults is resolved to ActionStep", () => {
    const template = generateBuildDefault();
    const plan = resolveFlowTemplate(template, buildCtx);
    const actions = actionSteps(plan.steps);
    const summary = actions.find((a) => a.actionKind === "summary");
    expect(summary!.maxOutputTokens).toBe(1024);
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

  test("backend scope routes to backend-dev only (not frontend-dev)", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "backend",
    });
    const agents = plan.steps.filter((s) => isAgentStep(s));
    const agentNames = agents.map((s) => (s as any).agentName);
    expect(agentNames).toContain("backend-dev");
    // frontend-dev should NOT appear (backend-only path)
    expect(agentNames).not.toContain("frontend-dev");
  });

  test("full scope routes to both frontend-dev and backend-dev", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "full",
    });
    const agents = plan.steps.filter((s) => isAgentStep(s));
    const agentNames = agents.map((s) => (s as any).agentName);
    expect(agentNames).toContain("frontend-dev");
    expect(agentNames).toContain("backend-dev");
  });

  test("full scope includes QA reviewer", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "full",
    });
    const agents = plan.steps.filter((s) => isAgentStep(s));
    const agentNames = agents.map((s) => (s as any).agentName);
    expect(agentNames).toContain("qa");
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

// --- Resolver: dependency keys match runtime stepKey ---

describe("resolveFlowTemplate (dependency keys)", () => {
  test("dependsOn uses nodeId (not agentName) for agent steps", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "backend",
    });
    // build-check-fix should depend on backend-fix (nodeId), NOT backend-dev (agentName)
    const buildCheck = actionSteps(plan.steps).find((a) => a.instanceId === "build-check-fix");
    expect(buildCheck).toBeDefined();
    expect(buildCheck!.dependsOn).toContain("backend-fix");
    expect(buildCheck!.dependsOn).not.toContain("backend-dev");
  });

  test("stepKey matches dependsOn entries for agent nodes", () => {
    const template = generateFixDefault();
    const plan = resolveFlowTemplate(template, {
      ...fixCtx,
      scope: "full",
    });
    // Collect all step keys
    const allKeys = new Set(plan.steps.map((s) => stepKey(s)));
    // All dependsOn entries should reference actual step keys
    for (const step of plan.steps) {
      for (const dep of step.dependsOn ?? []) {
        expect(allKeys.has(dep)).toBe(true);
      }
    }
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

// --- Default pipeline explicit configuration ---

describe("default pipeline explicit configuration", () => {
  test("remediation-fix node has correct reviewer keys matching fix pipeline nodeIds", () => {
    const template = generateFixDefault();
    const remediationFix = template.nodes.find((n) => n.id === "remediation-fix");
    expect(remediationFix).toBeDefined();
    expect(remediationFix!.data.type).toBe("action");
    if (remediationFix!.data.type === "action") {
      expect(remediationFix!.data.remediationReviewerKeys).toEqual([
        "code-review-fix",
        "security-fix",
        "qa-fix",
      ]);
    }
  });

  test("build remediation node has reviewer keys matching build pipeline nodeIds", () => {
    const template = generateBuildDefault();
    const remediation = template.nodes.find((n) => n.id === "remediation");
    expect(remediation).toBeDefined();
    expect(remediation!.data.type).toBe("action");
    if (remediation!.data.type === "action") {
      expect(remediation!.data.remediationReviewerKeys).toEqual([
        "code-review",
        "security",
        "qa",
      ]);
    }
  });

  test("all action nodes in build default have explicit configuration", () => {
    const template = generateBuildDefault();
    const actionNodes = template.nodes.filter((n) => n.data.type === "action");

    for (const node of actionNodes) {
      if (node.data.type !== "action") continue;
      const { kind } = node.data;

      switch (kind) {
        case "build-check":
          expect(node.data.timeoutMs).toBe(30_000);
          expect(node.data.maxAttempts).toBe(3);
          expect(node.data.maxUniqueErrors).toBe(10);
          expect(node.data.buildCommand).toBe("bunx vite build --mode development");
          break;
        case "test-run":
          expect(node.data.timeoutMs).toBe(60_000);
          expect(node.data.maxAttempts).toBe(2);
          expect(node.data.maxTestFailures).toBe(5);
          expect(node.data.maxUniqueErrors).toBe(10);
          expect(node.data.testCommand).toBe("bunx vitest run");
          break;
        case "remediation":
          expect(node.data.maxAttempts).toBe(2);
          expect(node.data.remediationReviewerKeys).toBeDefined();
          break;
        case "summary":
          expect(node.data.maxOutputTokens).toBe(1024);
          break;
      }
    }
  });
});
