import { describe, test, expect } from "bun:test";
import {
  sanitizeFilePath,
  needsBackend,
  buildExecutionPlan,
  detectIssues,
  outputHasFailSignals,
  determineFixAgents,
  determineBuildFixAgent,
  extractFilesFromOutput,
  classifyIntent,
  parseVitestOutput,
  agentHasFileTools,
  truncateOutput,
  buildFileManifest,
  filterUpstreamOutputs,
  isNonRetriableApiError,
  deduplicateErrors,
  getPlannedAgents,
  buildFixPlan,
  isDataFile,
  isAgentStep,
  type AgentStep,
} from "../../src/server/agents/orchestrator.ts";
import { buildPrompt, buildSplitPrompt } from "../../src/server/agents/base.ts";
import type { ReviewFindings } from "../../src/server/agents/orchestrator.ts";

/** Helper: extract agent steps from a plan (all steps from buildExecutionPlan are agents) */
function agentSteps(plan: ReturnType<typeof buildExecutionPlan>): AgentStep[] {
  return plan.steps.filter((s) => isAgentStep(s)) as AgentStep[];
}

// --- sanitizeFilePath ---

describe("sanitizeFilePath", () => {
  test("passes through clean paths", () => {
    expect(sanitizeFilePath("src/App.tsx")).toBe("src/App.tsx");
  });

  test("strips leading single quotes", () => {
    expect(sanitizeFilePath("'src/utils/evaluate.ts")).toBe("src/utils/evaluate.ts");
  });

  test("strips leading double quotes", () => {
    expect(sanitizeFilePath('"src/App.tsx"')).toBe("src/App.tsx");
  });

  test("strips leading backticks", () => {
    expect(sanitizeFilePath("`src/App.tsx`")).toBe("src/App.tsx");
  });

  test("strips leading/trailing whitespace", () => {
    expect(sanitizeFilePath("  src/App.tsx  ")).toBe("src/App.tsx");
  });

  test("strips ./ prefix", () => {
    expect(sanitizeFilePath("./src/App.tsx")).toBe("src/App.tsx");
  });

  test("normalizes Windows backslashes", () => {
    expect(sanitizeFilePath("src\\components\\Button.tsx")).toBe("src/components/Button.tsx");
  });

  test("handles combined corruption", () => {
    expect(sanitizeFilePath("  './src/utils/helpers.ts'  ")).toBe("src/utils/helpers.ts");
  });

  test("returns empty for empty string", () => {
    expect(sanitizeFilePath("")).toBe("");
  });

  test("returns empty for whitespace only", () => {
    expect(sanitizeFilePath("   ")).toBe("");
  });
});

// --- needsBackend ---

describe("needsBackend", () => {
  test("returns true when JSON has requires_backend: true", () => {
    const output = JSON.stringify({
      features: [
        { name: "contact-form", requires_backend: true },
        { name: "hero-section", requires_backend: false },
      ],
    });
    expect(needsBackend(output)).toBe(true);
  });

  test("returns false when JSON has no requires_backend: true", () => {
    const output = JSON.stringify({
      features: [
        { name: "hero-section", requires_backend: false },
        { name: "footer", requires_backend: false },
      ],
    });
    expect(needsBackend(output)).toBe(false);
  });

  test("returns false for empty features array", () => {
    const output = JSON.stringify({ features: [] });
    expect(needsBackend(output)).toBe(false);
  });

  test("falls back to regex for invalid JSON", () => {
    expect(needsBackend("This project needs an api route for data")).toBe(true);
  });

  test("regex detects server-side keyword", () => {
    expect(needsBackend("server-side rendering needed")).toBe(true);
  });

  test("regex detects database keyword", () => {
    expect(needsBackend("needs a database for users")).toBe(true);
  });

  test("regex does not match bare 'endpoint' (too broad)", () => {
    expect(needsBackend("REST endpoint for authentication")).toBe(false);
  });

  test("regex does not match 'no backend needed' (false positive guard)", () => {
    expect(needsBackend("This is a frontend-only page, no backend needed")).toBe(false);
  });

  test("regex detects express keyword", () => {
    expect(needsBackend("uses express for the server")).toBe(true);
  });

  test("returns false for frontend-only text", () => {
    expect(needsBackend("A simple landing page with hero and CTA")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(needsBackend("")).toBe(false);
  });
});

// --- buildExecutionPlan ---

describe("buildExecutionPlan", () => {
  test("includes core pipeline agents without backend (no separate testing step)", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const agentNames = agentSteps(plan).map((s) => s.agentName);
    expect(agentNames).toEqual([
      "architect",
      "frontend-dev",
      "styling",
      "code-review",
      "security",
      "qa",
    ]);
  });

  test("includes backend-dev when research indicates backend needed", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build an app with API", research);
    const agentNames = agentSteps(plan).map((s) => s.agentName);
    expect(agentNames).toContain("backend-dev");
  });

  test("excludes backend-dev when research says no backend", () => {
    const research = JSON.stringify({
      features: [{ name: "hero", requires_backend: false }],
    });
    const plan = buildExecutionPlan("Build a landing page", research);
    const agentNames = agentSteps(plan).map((s) => s.agentName);
    expect(agentNames).not.toContain("backend-dev");
  });

  test("backend-dev comes after architect and before styling", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research);
    const names = agentSteps(plan).map((s) => s.agentName);
    const archIdx = names.indexOf("architect");
    const beIdx = names.indexOf("backend-dev");
    const stIdx = names.indexOf("styling");
    expect(beIdx).toBeGreaterThan(archIdx);
    expect(beIdx).toBeLessThan(stIdx);
  });

  test("no separate testing step in build mode (merged into architect)", () => {
    const plan = buildExecutionPlan("Build something");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("testing");
  });

  test("build mode: architect step input mentions test plan", () => {
    const plan = buildExecutionPlan("Build something");
    const archStep = agentSteps(plan).find((s) => s.agentName === "architect");
    expect(archStep?.input).toContain("test plan");
  });

  test("build mode: frontend-dev step input mentions test plan", () => {
    const plan = buildExecutionPlan("Build something");
    const feStep = agentSteps(plan).find((s) => s.agentName === "frontend-dev");
    expect(feStep?.input).toContain("test plan");
  });

  test("code-review comes after architect", () => {
    const plan = buildExecutionPlan("Build something");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names.indexOf("code-review")).toBeGreaterThan(names.indexOf("architect"));
  });

  test("qa is the last step", () => {
    const plan = buildExecutionPlan("Build something");
    const steps = agentSteps(plan);
    const lastStep = steps[steps.length - 1]!;
    expect(lastStep.agentName).toBe("qa");
  });

  test("each step has input containing original user message", () => {
    const plan = buildExecutionPlan("Build a calculator");
    for (const step of agentSteps(plan)) {
      expect(step.input).toContain("Build a calculator");
    }
  });

  test("no research step in plan (research runs in phase 1)", () => {
    const plan = buildExecutionPlan("Build something");
    const agentNames = agentSteps(plan).map((s) => s.agentName);
    expect(agentNames).not.toContain("research");
  });
});

// --- outputHasFailSignals ---

describe("outputHasFailSignals", () => {
  test("returns false for empty string", () => {
    expect(outputHasFailSignals("")).toBe(false);
  });

  test("returns false for whitespace-only", () => {
    expect(outputHasFailSignals("   ")).toBe(false);
  });

  test("returns false for generic pass output", () => {
    expect(outputHasFailSignals("All checks passed. Code looks good.")).toBe(false);
  });

  test("returns false for LLM-style pass with no fail keywords", () => {
    expect(outputHasFailSignals("The code is clean and well-structured. No issues found.")).toBe(false);
  });

  test('detects "status": "fail" with spaces', () => {
    expect(outputHasFailSignals('{"status": "fail", "findings": []}')).toBe(true);
  });

  test('detects "status":"fail" without spaces', () => {
    expect(outputHasFailSignals('{"status":"fail"}')).toBe(true);
  });

  test("detects [FAIL] marker", () => {
    expect(outputHasFailSignals("[FAIL] Missing import in App.tsx")).toBe(true);
  });

  test("detects 'critical issue' phrase", () => {
    expect(outputHasFailSignals("Found a critical issue with XSS vulnerability")).toBe(true);
  });

  test("detects 'must fix' phrase", () => {
    expect(outputHasFailSignals("This must fix the broken import")).toBe(true);
  });

  test("detects 'severity: critical'", () => {
    expect(outputHasFailSignals("Issue severity: critical — SQL injection")).toBe(true);
  });

  test("detects 'severity: high'", () => {
    expect(outputHasFailSignals("severity: high - missing auth check")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(outputHasFailSignals("[fail] something broke")).toBe(true);
    expect(outputHasFailSignals("CRITICAL ISSUE found")).toBe(true);
    expect(outputHasFailSignals("MUST FIX immediately")).toBe(true);
  });
});

// --- detectIssues ---

describe("detectIssues", () => {
  function makeResults(overrides: Record<string, string> = {}): Map<string, string> {
    return new Map(Object.entries({
      "code-review": '{"status": "pass", "findings": []}',
      qa: '{"status": "pass", "findings": []}',
      security: '{"status": "pass", "findings": []}',
      ...overrides,
    }));
  }

  test("returns no issues when all agents pass (JSON)", () => {
    const result = detectIssues(makeResults());
    expect(result.hasIssues).toBe(false);
    expect(result.codeReviewFindings).toBeNull();
    expect(result.qaFindings).toBeNull();
    expect(result.securityFindings).toBeNull();
  });

  test("returns no issues when all agents pass (text format)", () => {
    const result = detectIssues(makeResults({
      "code-review": "Code Review: Pass\nAll files reviewed.",
      qa: "QA Review: Pass\nAll requirements met.",
      security: "Passed with no issues",
    }));
    expect(result.hasIssues).toBe(false);
  });

  test("returns no issues for empty outputs", () => {
    const result = detectIssues(new Map());
    expect(result.hasIssues).toBe(false);
  });

  test("detects code-review failure", () => {
    const result = detectIssues(makeResults({
      "code-review": '{"status": "fail", "findings": [{"issue": "missing import"}]}',
    }));
    expect(result.hasIssues).toBe(true);
    expect(result.codeReviewFindings).not.toBeNull();
    expect(result.qaFindings).toBeNull();
  });

  test("detects qa failure", () => {
    const result = detectIssues(makeResults({
      qa: '{"status": "fail", "findings": [{"issue": "requirement not met"}]}',
    }));
    expect(result.hasIssues).toBe(true);
    expect(result.qaFindings).not.toBeNull();
  });

  test("detects security failure", () => {
    const result = detectIssues(makeResults({
      security: '{"status": "fail", "findings": [{"severity": "critical"}]}',
    }));
    expect(result.hasIssues).toBe(true);
    expect(result.securityFindings).not.toBeNull();
  });

  test("recognizes 'zero security vulnerabilities' as pass", () => {
    const result = detectIssues(makeResults({
      security: "zero security vulnerabilities found",
    }));
    expect(result.hasIssues).toBe(false);
  });

  test("recognizes 'safe for production' as pass", () => {
    const result = detectIssues(makeResults({
      security: "Code is safe for production",
    }));
    expect(result.hasIssues).toBe(false);
  });

  test("parses [frontend] routing hint", () => {
    const result = detectIssues(makeResults({
      "code-review": '[frontend] Missing import in App.tsx\n{"status": "fail"}',
    }));
    expect(result.routingHints.frontendIssues).toBe(true);
    expect(result.routingHints.backendIssues).toBe(false);
  });

  test("parses [backend] routing hint", () => {
    const result = detectIssues(makeResults({
      qa: '[backend] API endpoint not implemented\n{"status": "fail"}',
    }));
    expect(result.routingHints.backendIssues).toBe(true);
  });

  test("parses [styling] routing hint", () => {
    const result = detectIssues(makeResults({
      "code-review": '[styling] Layout broken on mobile\n{"status": "fail"}',
    }));
    expect(result.routingHints.stylingIssues).toBe(true);
  });

  test("parses multiple routing hints", () => {
    const result = detectIssues(makeResults({
      "code-review": '[frontend] bug\n[styling] layout\n{"status": "fail"}',
      qa: '[backend] missing endpoint\n{"status": "fail"}',
    }));
    expect(result.routingHints.frontendIssues).toBe(true);
    expect(result.routingHints.backendIssues).toBe(true);
    expect(result.routingHints.stylingIssues).toBe(true);
  });

  test("no routing hints when all pass", () => {
    const result = detectIssues(makeResults());
    expect(result.routingHints.frontendIssues).toBe(false);
    expect(result.routingHints.backendIssues).toBe(false);
    expect(result.routingHints.stylingIssues).toBe(false);
  });

  test("treats varied LLM pass phrasing as clean (no false positives)", () => {
    const result = detectIssues(makeResults({
      "code-review": "All code looks clean. No issues detected. The components are well-structured.",
      qa: "All requirements have been met. Quality is acceptable.",
      security: "No vulnerabilities found. The application follows security best practices.",
    }));
    expect(result.hasIssues).toBe(false);
  });

  test("treats LLM summary with recommendations (but no fail signals) as clean", () => {
    const result = detectIssues(makeResults({
      "code-review": "Overall good code quality. Consider adding TypeScript strict mode in the future.",
      qa: "All tests conceptually pass. UI looks correct.",
      security: "No security concerns at this time.",
    }));
    expect(result.hasIssues).toBe(false);
  });
});

// --- determineFixAgents ---

describe("determineFixAgents", () => {
  function makeFindings(hints: Partial<ReviewFindings["routingHints"]> = {}): ReviewFindings {
    return {
      hasIssues: true,
      codeReviewFindings: null,
      qaFindings: null,
      securityFindings: null,
      routingHints: {
        frontendIssues: false,
        backendIssues: false,
        stylingIssues: false,
        ...hints,
      },
    };
  }

  test("routes to frontend-dev for frontend issues", () => {
    expect(determineFixAgents(makeFindings({ frontendIssues: true }))).toEqual(["frontend-dev"]);
  });

  test("routes to backend-dev for backend issues", () => {
    expect(determineFixAgents(makeFindings({ backendIssues: true }))).toEqual(["backend-dev"]);
  });

  test("routes to styling for styling issues", () => {
    expect(determineFixAgents(makeFindings({ stylingIssues: true }))).toEqual(["styling"]);
  });

  test("routes to multiple agents for mixed issues", () => {
    const agents = determineFixAgents(makeFindings({
      frontendIssues: true,
      backendIssues: true,
      stylingIssues: true,
    }));
    expect(agents).toContain("frontend-dev");
    expect(agents).toContain("backend-dev");
    expect(agents).toContain("styling");
    expect(agents).toHaveLength(3);
  });

  test("defaults to frontend-dev when no routing hints", () => {
    expect(determineFixAgents(makeFindings())).toEqual(["frontend-dev"]);
  });
});

// --- determineBuildFixAgent ---

describe("determineBuildFixAgent", () => {
  test("routes server/ errors to backend-dev", () => {
    expect(determineBuildFixAgent("Error in server/routes.ts: missing export")).toBe("backend-dev");
  });

  test("routes api/ errors to backend-dev", () => {
    expect(determineBuildFixAgent("Cannot find module 'api/users'")).toBe("backend-dev");
  });

  test("routes backend/ errors to backend-dev", () => {
    expect(determineBuildFixAgent("TypeError in backend/db.ts")).toBe("backend-dev");
  });

  test("routes .server. errors to backend-dev", () => {
    expect(determineBuildFixAgent("Error in auth.server.ts")).toBe("backend-dev");
  });

  test("routes routes/ errors to backend-dev", () => {
    expect(determineBuildFixAgent("Error in routes/index.ts")).toBe("backend-dev");
  });

  test("routes frontend errors to frontend-dev", () => {
    expect(determineBuildFixAgent("Error in src/App.tsx: JSX element")).toBe("frontend-dev");
  });

  test("routes component errors to frontend-dev", () => {
    expect(determineBuildFixAgent("Cannot find module './components/Button'")).toBe("frontend-dev");
  });

  test("routes generic errors to frontend-dev", () => {
    expect(determineBuildFixAgent("Module not found")).toBe("frontend-dev");
  });
});

// --- extractFilesFromOutput ---

describe("extractFilesFromOutput", () => {
  test("extracts files from tool_call JSON", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() { return <div>Hello</div>; }"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
    expect(files[0]!.content).toContain("Hello");
  });

  test("extracts multiple files", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "app code"}}
</tool_call>
<tool_call>
{"name": "write_file", "parameters": {"path": "src/Button.tsx", "content": "button code"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe("src/App.tsx");
    expect(files[1]!.path).toBe("src/Button.tsx");
  });

  test("deduplicates files by path", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "version 1"}}
</tool_call>
<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "version 2"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe("version 1"); // first occurrence wins (seen set)
  });

  test("sanitizes paths in tool_call output", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "'src/App.tsx", "content": "code"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });

  test("strips ./ prefix from paths", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "./src/App.tsx", "content": "code"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files[0]!.path).toBe("src/App.tsx");
  });

  test("ignores markdown code blocks by default (fallback extraction disabled)", () => {
    const output = "```tsx\n// src/App.tsx\nexport default function App() {}\n```";
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(0);
  });

  test("ignores ### heading + code block by default (fallback extraction disabled)", () => {
    const output = "### src/App.tsx\n```tsx\nexport default function App() {}\n```";
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(0);
  });

  test("returns empty array for no files", () => {
    expect(extractFilesFromOutput("Just some text with no files")).toEqual([]);
  });

  test("returns empty array for empty input", () => {
    expect(extractFilesFromOutput("")).toEqual([]);
  });

  test("ignores non-write_file tool calls", () => {
    const output = `<tool_call>
{"name": "read_file", "parameters": {"path": "src/App.tsx"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(0);
  });

  test("repairs JSON with literal newlines in content (non-strict)", () => {
    // Simulate AI output with unescaped newlines inside JSON content value
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "line1
line2
line3"}}
</tool_call>`;
    const files = extractFilesFromOutput(output, false);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
    expect(files[0]!.content).toContain("line1");
    expect(files[0]!.content).toContain("line2");
  });

  test("strips BOM from extracted content", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "\uFEFFexport default function App() {}"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).not.toContain("\uFEFF");
    expect(files[0]!.content).toBe("export default function App() {}");
  });

  test("normalizes CRLF line endings in extracted content", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "line1\\r\\nline2\\r\\nline3"}}
</tool_call>`;
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).not.toContain("\r\n");
    expect(files[0]!.content).toBe("line1\nline2\nline3");
  });

  test("falls back to regex when JSON repair also fails (non-strict)", () => {
    // Completely mangled JSON that even repair can't fix, but regex can extract
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() { return <div>Hello</div>; }"  INVALID}}
</tool_call>`;
    const files = extractFilesFromOutput(output, false);
    // Regex fallback should find the path and content
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });
});

// --- buildExecutionPlan (fix mode) ---

describe("buildExecutionPlan (fix mode — tiered)", () => {
  test("fix mode skips research and architect", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("research");
    expect(names).not.toContain("architect");
  });

  test("fix + frontend = quick-edit: only frontend-dev (no testing, no reviewers)", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["frontend-dev"]);
  });

  test("fix + styling = quick-edit: only styling (no testing, no reviewers)", () => {
    const plan = buildExecutionPlan("fix the colors", undefined, "fix", "styling");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["styling"]);
  });

  test("fix + backend = dev + reviewers (no testing)", () => {
    const plan = buildExecutionPlan("fix the API", undefined, "fix", "backend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["backend-dev", "code-review", "security", "qa"]);
    expect(names).not.toContain("testing");
  });

  test("fix + full = frontend-dev + backend-dev + reviewers (no testing)", () => {
    const plan = buildExecutionPlan("fix everything", undefined, "fix", "full");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["frontend-dev", "backend-dev", "code-review", "security", "qa"]);
    expect(names).not.toContain("testing");
  });

  test("fix + backend: reviewers depend on backend-dev", () => {
    const plan = buildExecutionPlan("fix the API", undefined, "fix", "backend");
    const cr = agentSteps(plan).find((s) => s.agentName === "code-review");
    const sec = agentSteps(plan).find((s) => s.agentName === "security");
    const qa = agentSteps(plan).find((s) => s.agentName === "qa");
    expect(cr?.dependsOn).toEqual(["backend-dev"]);
    expect(sec?.dependsOn).toEqual(["backend-dev"]);
    expect(qa?.dependsOn).toEqual(["backend-dev"]);
  });

  test("fix + full: backend-dev depends on frontend-dev", () => {
    const plan = buildExecutionPlan("fix everything", undefined, "fix", "full");
    const be = agentSteps(plan).find((s) => s.agentName === "backend-dev");
    expect(be?.dependsOn).toEqual(["frontend-dev"]);
  });

  test("fix mode includes user message in step inputs", () => {
    const plan = buildExecutionPlan("fix the button color", undefined, "fix", "frontend");
    for (const step of agentSteps(plan)) {
      expect(step.input).toContain("fix the button color");
    }
  });

  test("quick-edit frontend input guides file tools and skips project-source payload", () => {
    const plan = buildExecutionPlan("fix the button color", undefined, "fix", "frontend");
    const input = agentSteps(plan)[0]!.input;
    expect(input).toContain("read_file/list_files");
    expect(input).not.toContain("project-source");
  });

  test("quick-edit styling input guides file tools and skips project-source payload", () => {
    const plan = buildExecutionPlan("fix the button color", undefined, "fix", "styling");
    const input = agentSteps(plan)[0]!.input;
    expect(input).toContain("read_file/list_files");
    expect(input).not.toContain("project-source");
  });

  test("build mode with default params: architect+dev pipeline", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["architect", "frontend-dev", "styling", "code-review", "security", "qa"]);
  });

  test("build mode with explicit intent param: architect+dev pipeline", () => {
    const plan = buildExecutionPlan("Build a landing page", undefined, "build");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["architect", "frontend-dev", "styling", "code-review", "security", "qa"]);
  });

  test("build mode: frontend-dev depends on architect", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const feStep = agentSteps(plan).find((s) => s.agentName === "frontend-dev");
    expect(feStep?.dependsOn).toContain("architect");
  });

  test("build mode: review agents all depend on styling (parallel with each other)", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const cr = agentSteps(plan).find((s) => s.agentName === "code-review");
    const sec = agentSteps(plan).find((s) => s.agentName === "security");
    const qa = agentSteps(plan).find((s) => s.agentName === "qa");
    expect(cr?.dependsOn).toEqual(["styling"]);
    expect(sec?.dependsOn).toEqual(["styling"]);
    expect(qa?.dependsOn).toEqual(["styling"]);
  });

  test("build mode: styling depends on both dev agents when backend included", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research);
    const styling = agentSteps(plan).find((s) => s.agentName === "styling");
    expect(styling?.dependsOn).toContain("frontend-dev");
    expect(styling?.dependsOn).toContain("backend-dev");
  });

  test("build mode: styling depends only on frontend-dev when no backend", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const styling = agentSteps(plan).find((s) => s.agentName === "styling");
    expect(styling?.dependsOn).toEqual(["frontend-dev"]);
  });

  test("build mode: backend-dev depends on frontend-dev (sequential to avoid file conflicts)", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research);
    const fe = agentSteps(plan).find((s) => s.agentName === "frontend-dev");
    const be = agentSteps(plan).find((s) => s.agentName === "backend-dev");
    expect(fe?.dependsOn).toEqual(["architect"]);
    expect(be?.dependsOn).toEqual(["frontend-dev"]);
  });

  test("build mode: scope 'frontend' skips backend even when research says backend", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research, "build", "frontend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("backend-dev");
  });

  test("build mode: scope 'styling' skips backend even when research says backend", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research, "build", "styling");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("backend-dev");
  });

  test("build mode: scope 'full' includes backend when research says backend", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research, "build", "full");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toContain("backend-dev");
  });

  test("build mode: scope 'backend' includes backend when research says backend", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research, "build", "backend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toContain("backend-dev");
  });
});

// --- classifyIntent ---

describe("classifyIntent", () => {
  const emptyProviders = {} as Parameters<typeof classifyIntent>[2];

  test("fast-path: no existing files always returns build", async () => {
    const result = await classifyIntent("fix the button", false, emptyProviders);
    expect(result.intent).toBe("build");
    expect(result.scope).toBe("full");
    expect(result.reasoning).toContain("no existing files");
  });

  test("fast-path: ignores message content when no files", async () => {
    const result = await classifyIntent("how does the routing work?", false, emptyProviders);
    expect(result.intent).toBe("build");
  });

  test("fallback: returns build when no providers available", async () => {
    const result = await classifyIntent("fix the button", true, emptyProviders);
    expect(result.intent).toBe("build");
    expect(result.reasoning).toContain("Fallback");
  });
});

// --- parseVitestOutput ---

describe("parseVitestOutput", () => {
  test("parses normal vitest JSON output", () => {
    const json = JSON.stringify({
      numPassedTests: 5,
      numFailedTests: 1,
      numTotalTests: 6,
      startTime: Date.now() - 1000,
      testResults: [{
        name: "src/App.test.tsx",
        assertionResults: [
          { status: "passed", fullName: "App renders", title: "renders", failureMessages: [] },
          { status: "failed", fullName: "App handles click", title: "handles click", failureMessages: ["Expected true to be false"] },
        ],
      }],
    });
    const result = parseVitestOutput(json, "", 1);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(6);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toBe("App handles click");
  });

  test("detects suite collection errors with empty assertionResults", () => {
    const json = JSON.stringify({
      numPassedTests: 0,
      numFailedTests: 0,
      numTotalTests: 0,
      testResults: [{
        name: "src/App.test.tsx",
        status: "failed",
        message: "Cannot find module './App'",
        assertionResults: [],
      }],
    });
    const result = parseVitestOutput(json, "", 1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toContain("[Collection Error]");
    expect(result.failures[0]!.error).toContain("Cannot find module");
  });

  test("counts collection failures as test failures", () => {
    const json = JSON.stringify({
      numPassedTests: 0,
      numFailedTests: 0,
      numTotalTests: 0,
      testResults: [
        { name: "a.test.tsx", status: "failed", message: "Import error", assertionResults: [] },
        { name: "b.test.tsx", status: "failed", message: "Syntax error", assertionResults: [] },
      ],
    });
    const result = parseVitestOutput(json, "", 1);
    expect(result.failed).toBe(2);
    expect(result.total).toBe(2);
    expect(result.failures).toHaveLength(2);
  });

  test("handles mixed: some suites collected, some failed", () => {
    const json = JSON.stringify({
      numPassedTests: 3,
      numFailedTests: 0,
      numTotalTests: 3,
      testResults: [
        {
          name: "good.test.tsx",
          status: "passed",
          assertionResults: [
            { status: "passed", fullName: "works", title: "works", failureMessages: [] },
          ],
        },
        {
          name: "broken.test.tsx",
          status: "failed",
          message: "Cannot resolve import",
          assertionResults: [],
        },
      ],
    });
    const result = parseVitestOutput(json, "", 1);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(4);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toContain("[Collection Error]");
  });

  test("falls back to exit code when JSON parsing fails", () => {
    const result = parseVitestOutput("not json", "some error", 1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toBe("Test suite");
  });

  test("reports success on exit code 0 when JSON parsing fails", () => {
    const result = parseVitestOutput("not json", "", 0);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  test("uses failureMessage when message is absent on collection error", () => {
    const json = JSON.stringify({
      numPassedTests: 0,
      numFailedTests: 0,
      numTotalTests: 0,
      testResults: [{
        name: "src/Broken.test.tsx",
        status: "failed",
        failureMessage: "ReferenceError: foo is not defined",
        assertionResults: [],
      }],
    });
    const result = parseVitestOutput(json, "", 1);
    expect(result.failures[0]!.error).toContain("ReferenceError");
  });
});

// --- agentHasFileTools ---

describe("agentHasFileTools", () => {
  test("returns true for dev agents with default tools", () => {
    expect(agentHasFileTools("frontend-dev")).toBe(true);
    expect(agentHasFileTools("backend-dev")).toBe(true);
    expect(agentHasFileTools("styling")).toBe(true);
  });

  test("returns false for non-producing agents", () => {
    expect(agentHasFileTools("orchestrator")).toBe(false);
    expect(agentHasFileTools("research")).toBe(false);
    expect(agentHasFileTools("architect")).toBe(false);
    expect(agentHasFileTools("testing")).toBe(false);
    expect(agentHasFileTools("code-review")).toBe(false);
    expect(agentHasFileTools("qa")).toBe(false);
    expect(agentHasFileTools("security")).toBe(false);
  });
});



// --- truncateOutput ---

describe("truncateOutput", () => {
  test("returns short content unchanged", () => {
    expect(truncateOutput("hello", 100)).toBe("hello");
  });

  test("returns content at exact limit unchanged", () => {
    const text = "a".repeat(100);
    expect(truncateOutput(text, 100)).toBe(text);
  });

  test("truncates content exceeding limit", () => {
    const text = "a".repeat(200);
    const result = truncateOutput(text, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("chars elided");
  });

  test("preserves start and end of content", () => {
    const text = "START" + "x".repeat(1000) + "END";
    const result = truncateOutput(text, 100);
    expect(result).toContain("START");
    expect(result).toContain("END");
  });

  test("includes elided char count", () => {
    const text = "a".repeat(500);
    const result = truncateOutput(text, 100);
    expect(result).toMatch(/\d+ chars elided/);
  });
});

// --- buildFileManifest ---

describe("buildFileManifest", () => {
  test("extracts file paths from tool_call output", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() {}"}}
</tool_call>
<tool_call>
{"name": "write_file", "parameters": {"path": "src/Button.tsx", "content": "export function Button() {}"}}
</tool_call>`;
    const manifest = buildFileManifest(output);
    expect(manifest).toContain("Files written (2)");
    expect(manifest).toContain("src/App.tsx");
    expect(manifest).toContain("src/Button.tsx");
    expect(manifest).toContain("read_file");
  });

  test("does not include full file content", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() { return <div>Very long content here</div>; }"}}
</tool_call>`;
    const manifest = buildFileManifest(output);
    expect(manifest).not.toContain("Very long content here");
  });

  test("falls back to truncated output when no files detected", () => {
    const output = "Just some reasoning text with no file writes at all. ".repeat(100);
    const manifest = buildFileManifest(output);
    // Should be truncated since it's longer than MAX_OUTPUT_CHARS
    expect(manifest.length).toBeLessThanOrEqual(output.length);
  });

  test("handles empty output", () => {
    const manifest = buildFileManifest("");
    expect(manifest).toBe("");
  });
});

// --- filterUpstreamOutputs ---

describe("filterUpstreamOutputs", () => {
  function makeResults(entries: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(entries));
  }

  test("review agents get architect + project-source, not dev outputs", () => {
    const results = makeResults({
      architect: "architect output",
      "frontend-dev": "dev output",
      styling: "styling output",
    });
    const filtered = filterUpstreamOutputs("code-review", undefined, results);
    expect(filtered).toHaveProperty("architect");
    expect(filtered).not.toHaveProperty("frontend-dev");
    expect(filtered).not.toHaveProperty("styling");
  });

  test("remediation phase gets architect + review findings only", () => {
    const results = makeResults({
      architect: "architect output",
      "frontend-dev": "dev output",
      "code-review": "review findings",
      security: "security findings",
      qa: "qa findings",
    });
    const filtered = filterUpstreamOutputs("frontend-dev", undefined, results, "remediation");
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("code-review");
    expect(filtered).toHaveProperty("security");
    expect(filtered).toHaveProperty("qa");
    expect(filtered).not.toHaveProperty("frontend-dev");
  });

  test("re-review phase gets architect only (no dev outputs)", () => {
    const results = makeResults({
      architect: "architect output",
      "frontend-dev": "dev output",
      "code-review": "old review",
    });
    const filtered = filterUpstreamOutputs("code-review", undefined, results, "re-review");
    expect(filtered).toHaveProperty("architect");
    expect(filtered).not.toHaveProperty("frontend-dev");
    expect(filtered).not.toHaveProperty("code-review");
  });

  test("all outputs are truncated", () => {
    const longOutput = "x".repeat(20_000);
    const results = makeResults({
      architect: longOutput,
    });
    const filtered = filterUpstreamOutputs("frontend-dev", undefined, results);
    expect(filtered["architect"]!.length).toBeLessThan(20_000);
    expect(filtered["architect"]).toContain("chars elided");
  });

  test("build-fix phase gets architect + review findings only", () => {
    const results = makeResults({
      architect: "arch",
      "frontend-dev": "dev",
      "code-review": "review",
      research: "research",
    });
    const filtered = filterUpstreamOutputs("frontend-dev", undefined, results, "build-fix");
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("code-review");
    expect(filtered).not.toHaveProperty("frontend-dev");
    expect(filtered).not.toHaveProperty("research");
  });

  test("remediation phase excludes project-source even when present", () => {
    const results = makeResults({
      architect: "architect output",
      "code-review": "review findings",
      "project-source": "full project source code here",
    });
    const filtered = filterUpstreamOutputs("frontend-dev", undefined, results, "remediation");
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("code-review");
    expect(filtered).not.toHaveProperty("project-source");
  });

  test("build-fix phase excludes project-source even when present", () => {
    const results = makeResults({
      architect: "architect output",
      "code-review": "review findings",
      "project-source": "full project source code here",
    });
    const filtered = filterUpstreamOutputs("frontend-dev", undefined, results, "build-fix");
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("code-review");
    expect(filtered).not.toHaveProperty("project-source");
  });
});

// --- buildPrompt (chat history capping) ---

describe("buildPrompt", () => {
  test("caps chat history at 6 messages", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    }));
    const prompt = buildPrompt({
      userMessage: "test",
      chatHistory: history,
      projectPath: "/tmp/test",
    });
    // Should mention omitted messages
    expect(prompt).toContain("earlier messages omitted");
    // Should NOT contain the earliest messages
    expect(prompt).not.toContain("Message 1:");
    expect(prompt).not.toContain("Message 2:");
  });

  test("does not cap when history is within limit", () => {
    const history = Array.from({ length: 4 }, (_, i) => ({
      role: "user",
      content: `Msg ${i}`,
    }));
    const prompt = buildPrompt({
      userMessage: "test",
      chatHistory: history,
      projectPath: "/tmp/test",
    });
    expect(prompt).not.toContain("omitted");
    expect(prompt).toContain("Msg 0");
    expect(prompt).toContain("Msg 3");
  });

  test("truncates individual messages when history exceeds char cap", () => {
    const history = [
      { role: "user", content: "a".repeat(4000) },
      { role: "assistant", content: "b".repeat(4000) },
    ];
    const prompt = buildPrompt({
      userMessage: "test",
      chatHistory: history,
      projectPath: "/tmp/test",
    });
    expect(prompt).toContain("char cap");
  });

  test("includes upstream outputs in prompt", () => {
    const prompt = buildPrompt({
      userMessage: "build something",
      chatHistory: [],
      projectPath: "/tmp/test",
      context: {
        upstreamOutputs: {
          architect: "architecture plan here",
        },
      },
    });
    expect(prompt).toContain("architecture plan here");
    expect(prompt).toContain("build something");
  });
});

// --- buildSplitPrompt ---

describe("buildSplitPrompt", () => {
  test("puts current request in dynamicSuffix", () => {
    const result = buildSplitPrompt({
      userMessage: "build a calculator",
      chatHistory: [],
      projectPath: "/tmp/test",
    });
    expect(result.dynamicSuffix).toContain("build a calculator");
    expect(result.dynamicSuffix).toContain("Current Request");
  });

  test("puts upstream outputs in cacheablePrefix", () => {
    const result = buildSplitPrompt({
      userMessage: "build something",
      chatHistory: [],
      projectPath: "/tmp/test",
      context: {
        upstreamOutputs: {
          architect: "architecture plan here",
        },
      },
    });
    expect(result.cacheablePrefix).toContain("architecture plan here");
    expect(result.cacheablePrefix).toContain("Previous Agent Outputs");
    expect(result.dynamicSuffix).not.toContain("architecture plan here");
  });

  test("cacheablePrefix is empty when no history or context", () => {
    const result = buildSplitPrompt({
      userMessage: "test",
      chatHistory: [],
      projectPath: "/tmp/test",
    });
    expect(result.cacheablePrefix).toBe("");
    expect(result.dynamicSuffix).toContain("test");
  });

  test("puts chat history in cacheablePrefix", () => {
    const result = buildSplitPrompt({
      userMessage: "test",
      chatHistory: [{ role: "user", content: "hello" }],
      projectPath: "/tmp/test",
    });
    expect(result.cacheablePrefix).toContain("hello");
    expect(result.cacheablePrefix).toContain("Chat History");
    expect(result.dynamicSuffix).not.toContain("hello");
  });

  test("combined output matches buildPrompt", () => {
    const input = {
      userMessage: "build something",
      chatHistory: [{ role: "user", content: "previous message" }],
      projectPath: "/tmp/test",
      context: {
        upstreamOutputs: { architect: "plan" },
      },
    };
    const fullPrompt = buildPrompt(input);
    const split = buildSplitPrompt(input);
    const combined = `${split.cacheablePrefix}\n${split.dynamicSuffix}`;
    expect(combined).toBe(fullPrompt);
  });
});


// --- deduplicateErrors ---

describe("deduplicateErrors", () => {
  test("returns empty string for empty array", () => {
    expect(deduplicateErrors([])).toBe("");
  });

  test("preserves 'Could not resolve' error (the most common vite failure)", () => {
    const lines = [
      'error during build:',
      'Could not resolve "./components/Tile" from "src/App.tsx"',
    ];
    const result = deduplicateErrors(lines);
    expect(result).toContain("Could not resolve");
    expect(result).toContain("src/App.tsx");
  });

  test("deduplicates repeated errors", () => {
    const lines = [
      'Could not resolve "./components/A" from "src/App.tsx"',
      'Could not resolve "./components/B" from "src/App.tsx"',
      'Could not resolve "./components/C" from "src/App.tsx"',
    ];
    const result = deduplicateErrors(lines);
    // All three have different file references so they should be separate
    expect(result).toContain("components/A");
    expect(result).toContain("components/B");
    expect(result).toContain("components/C");
  });

  test("handles esbuild transform error format", () => {
    const lines = [
      'error during build:',
      'Transform failed with 1 error:',
      'C:/project/src/utils/words.ts:150:1: ERROR: Expected ";" but found ")"',
    ];
    const result = deduplicateErrors(lines);
    expect(result).toContain('Expected ";"');
    expect(result).toContain("words.ts");
  });

  test("strips ANSI-cleaned lines (no [31m residue)", () => {
    // After ANSI stripping, lines should be clean
    const lines = [
      'error during build:',
      'Could not resolve "./components/Tile" from "src/App.tsx"',
    ];
    const result = deduplicateErrors(lines);
    expect(result).not.toContain("[31m");
    expect(result).not.toContain("[39m");
  });

  test("groups identical error patterns with count", () => {
    const lines = [
      'Module not found',
      'Module not found',
      'Module not found',
    ];
    const result = deduplicateErrors(lines);
    expect(result).toContain("[3x]");
    expect(result).toContain("Module not found");
  });

  test("preserves multiple distinct error types", () => {
    const lines = [
      'error during build:',
      'Could not resolve "./types/game" from "src/hooks/useWordle.ts"',
      'Export "GameBoard" is not provided by "src/components/index.ts"',
    ];
    const result = deduplicateErrors(lines);
    expect(result).toContain("Could not resolve");
    expect(result).toContain("is not provided");
  });
});

// --- isNonRetriableApiError ---

describe("isNonRetriableApiError", () => {
  test("detects 402 Payment Required", () => {
    const result = isNonRetriableApiError(new Error("API returned 402 Payment Required"));
    expect(result.nonRetriable).toBe(true);
    expect(result.reason).toContain("credits exhausted");
  });

  test("detects credit exhaustion message", () => {
    const result = isNonRetriableApiError(new Error("Your account has insufficient credits"));
    expect(result.nonRetriable).toBe(true);
  });

  test("detects out of credit message", () => {
    const result = isNonRetriableApiError(new Error("out of credit on this API key"));
    expect(result.nonRetriable).toBe(true);
  });

  test("detects billing error", () => {
    const result = isNonRetriableApiError(new Error("billing issue detected on account"));
    expect(result.nonRetriable).toBe(true);
  });

  test("detects 401 Unauthorized", () => {
    const result = isNonRetriableApiError(new Error("401 Unauthorized"));
    expect(result.nonRetriable).toBe(true);
    expect(result.reason).toContain("authentication failed");
  });

  test("detects invalid API key", () => {
    const result = isNonRetriableApiError(new Error("invalid api key provided"));
    expect(result.nonRetriable).toBe(true);
  });

  test("detects invalid x-api-key header", () => {
    const result = isNonRetriableApiError(new Error("invalid x-api-key"));
    expect(result.nonRetriable).toBe(true);
  });

  test("detects 403 Forbidden", () => {
    const result = isNonRetriableApiError(new Error("403 Forbidden"));
    expect(result.nonRetriable).toBe(true);
    expect(result.reason).toContain("forbidden");
  });

  test("detects invalid_request_error", () => {
    const result = isNonRetriableApiError(new Error("invalid_request_error: prompt too long"));
    expect(result.nonRetriable).toBe(true);
  });

  test("does NOT flag overloaded errors as non-retriable", () => {
    const result = isNonRetriableApiError(new Error("overloaded_error: server is busy"));
    expect(result.nonRetriable).toBe(false);
  });

  test("does NOT flag rate limit errors as non-retriable", () => {
    const result = isNonRetriableApiError(new Error("429 rate_limit_error: too many requests"));
    expect(result.nonRetriable).toBe(false);
  });

  test("does NOT flag timeout errors as non-retriable", () => {
    const result = isNonRetriableApiError(new Error("Request timed out after 30s"));
    expect(result.nonRetriable).toBe(false);
  });

  test("does NOT flag network errors as non-retriable", () => {
    const result = isNonRetriableApiError(new Error("ECONNREFUSED"));
    expect(result.nonRetriable).toBe(false);
  });

  test("does NOT flag generic errors as non-retriable", () => {
    const result = isNonRetriableApiError(new Error("Something went wrong"));
    expect(result.nonRetriable).toBe(false);
  });

  test("handles non-Error objects", () => {
    const result = isNonRetriableApiError("402 Payment Required");
    expect(result.nonRetriable).toBe(true);
  });

  test("handles null/undefined gracefully", () => {
    const result = isNonRetriableApiError(null);
    expect(result.nonRetriable).toBe(false);
  });
});

// --- Quick-edit tier safety tests ---

describe("buildExecutionPlan (quick-edit tiers)", () => {
  test("fix + styling => [styling] only", () => {
    const plan = buildExecutionPlan("fix the colors", undefined, "fix", "styling");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["styling"]);
  });

  test("fix + frontend => [frontend-dev] only", () => {
    const plan = buildExecutionPlan("change the title", undefined, "fix", "frontend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["frontend-dev"]);
  });

  test("fix + backend => [backend-dev, code-review, security, qa]", () => {
    const plan = buildExecutionPlan("fix the API", undefined, "fix", "backend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["backend-dev", "code-review", "security", "qa"]);
  });

  test("fix + full => [frontend-dev, backend-dev, code-review, security, qa]", () => {
    const plan = buildExecutionPlan("fix everything", undefined, "fix", "full");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toEqual(["frontend-dev", "backend-dev", "code-review", "security", "qa"]);
  });

  test("fix + styling has no testing agent", () => {
    const plan = buildExecutionPlan("fix colors", undefined, "fix", "styling");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("testing");
  });

  test("fix + frontend has no testing agent", () => {
    const plan = buildExecutionPlan("change title", undefined, "fix", "frontend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("testing");
  });

  test("fix + backend has no testing agent", () => {
    const plan = buildExecutionPlan("fix API", undefined, "fix", "backend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("testing");
  });

  test("fix + full has no testing agent", () => {
    const plan = buildExecutionPlan("fix everything", undefined, "fix", "full");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).not.toContain("testing");
  });
});

// --- buildFixPlan ---

describe("buildFixPlan", () => {
  test("backend scope starts with backend-dev", () => {
    const plan = buildFixPlan("fix the API", "backend");
    expect(agentSteps(plan)[0]!.agentName).toBe("backend-dev");
  });

  test("backend scope includes reviewers", () => {
    const plan = buildFixPlan("fix the API", "backend");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toContain("code-review");
    expect(names).toContain("security");
    expect(names).toContain("qa");
  });

  test("full scope includes frontend-dev + backend-dev + reviewers", () => {
    const plan = buildFixPlan("fix everything", "full");
    const names = agentSteps(plan).map((s) => s.agentName);
    expect(names).toContain("frontend-dev");
    expect(names).toContain("backend-dev");
    expect(names).toContain("code-review");
    expect(names).toContain("security");
    expect(names).toContain("qa");
  });

  test("full scope: backend-dev depends on frontend-dev", () => {
    const plan = buildFixPlan("fix everything", "full");
    const be = agentSteps(plan).find((s) => s.agentName === "backend-dev");
    expect(be?.dependsOn).toEqual(["frontend-dev"]);
  });

  test("reviewers depend on last dev agent", () => {
    const plan = buildFixPlan("fix the API", "backend");
    const cr = agentSteps(plan).find((s) => s.agentName === "code-review");
    expect(cr?.dependsOn).toEqual(["backend-dev"]);
  });

  test("includes user message in step inputs", () => {
    const plan = buildFixPlan("fix the broken endpoint", "backend");
    for (const step of agentSteps(plan)) {
      expect(step.input).toContain("fix the broken endpoint");
    }
  });
});

// --- getPlannedAgents (preflight scoping) ---

describe("getPlannedAgents", () => {
  test("question intent returns empty list", () => {
    expect(getPlannedAgents("question", "full", true)).toEqual([]);
  });

  test("fix + styling returns [styling]", () => {
    expect(getPlannedAgents("fix", "styling", true)).toEqual(["styling"]);
  });

  test("fix + frontend returns [frontend-dev]", () => {
    expect(getPlannedAgents("fix", "frontend", true)).toEqual(["frontend-dev"]);
  });

  test("fix + backend returns dev + reviewers", () => {
    const agents = getPlannedAgents("fix", "backend", true);
    expect(agents).toEqual(["backend-dev", "code-review", "security", "qa"]);
  });

  test("fix + full returns all fix agents", () => {
    const agents = getPlannedAgents("fix", "full", true);
    expect(agents).toEqual(["frontend-dev", "backend-dev", "code-review", "security", "qa"]);
  });

  test("fix with no files returns empty (falls through to build)", () => {
    expect(getPlannedAgents("fix", "frontend", false)).toEqual([]);
  });

  test("build mode returns full pipeline agents", () => {
    const agents = getPlannedAgents("build", "full", false);
    expect(agents).toContain("research");
    expect(agents).toContain("architect");
    expect(agents).toContain("frontend-dev");
    expect(agents).toContain("styling");
    expect(agents).toContain("code-review");
    expect(agents).toContain("security");
    expect(agents).toContain("qa");
  });
});

// --- extractFilesFromOutput (strict mode) ---

describe("extractFilesFromOutput (strict mode)", () => {
  test("strict mode rejects malformed JSON in tool_call", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() { return <div>Hello</div>; }"  INVALID}}
</tool_call>`;
    const files = extractFilesFromOutput(output, true);
    expect(files).toHaveLength(0);
  });

  test("strict mode accepts valid JSON", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() {}"}}
</tool_call>`;
    const files = extractFilesFromOutput(output, true);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });

  test("non-strict mode repairs malformed JSON", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "line1
line2"}}
</tool_call>`;
    const files = extractFilesFromOutput(output, false);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });

  test("non-strict mode uses regex fallback for completely mangled JSON", () => {
    const output = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() { return <div>Hello</div>; }"  INVALID}}
</tool_call>`;
    const files = extractFilesFromOutput(output, false);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });
});

// --- isDataFile ---

describe("isDataFile", () => {
  test("returns false for short content", () => {
    expect(isDataFile("const x = 1;\nconst y = 2;\n")).toBe(false);
  });

  test("returns true for large array-like content", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `  "${String.fromCharCode(65 + (i % 26))}word${i}",`);
    const content = `export const words = [\n${lines.join("\n")}\n];\n`;
    expect(isDataFile(content)).toBe(true);
  });

  test("returns false for code-heavy content", () => {
    const lines = [
      "export function App() {",
      "  const [state, setState] = useState(0);",
      "  const handleClick = () => setState(s => s + 1);",
      "  return (",
      "    <div className='flex flex-col'>",
      "      <h1>Hello</h1>",
      "      <button onClick={handleClick}>Click</button>",
      "      <p>{state}</p>",
      "    </div>",
      "  );",
      "}",
    ];
    expect(isDataFile(lines.join("\n"))).toBe(false);
  });

  test("returns true for JSON-like data dumps", () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      `  { "id": ${i}, "name": "item${i}", "value": ${i * 10} },`
    );
    const content = `[\n${lines.join("\n")}\n]\n`;
    expect(isDataFile(content)).toBe(true);
  });
});

// --- filterUpstreamOutputs (reviewer changed-file manifest) ---

describe("filterUpstreamOutputs (reviewer manifest)", () => {
  function makeResults(entries: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(entries));
  }

  test("reviewer gets changed-files from dev agents when available", () => {
    const devOutput = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() {}"}}
</tool_call>`;
    const results = makeResults({
      architect: "architecture plan",
      "frontend-dev": devOutput,
    });
    const filtered = filterUpstreamOutputs("code-review", undefined, results);
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("changed-files");
    expect(filtered["changed-files"]).toContain("src/App.tsx");
  });

  test("reviewer gets project-source as fallback when no dev outputs", () => {
    const results = makeResults({
      architect: "architecture plan",
      "project-source": "full source code",
    });
    const filtered = filterUpstreamOutputs("code-review", undefined, results);
    expect(filtered).toHaveProperty("architect");
    expect(filtered).toHaveProperty("project-source");
    expect(filtered).not.toHaveProperty("changed-files");
  });
});
