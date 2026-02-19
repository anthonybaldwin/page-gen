import { describe, test, expect } from "bun:test";
import {
  sanitizeFilePath,
  needsBackend,
  buildExecutionPlan,
  detectIssues,
  determineFixAgents,
  determineBuildFixAgent,
  extractFilesFromOutput,
  classifyIntent,
} from "../../src/server/agents/orchestrator.ts";
import type { ReviewFindings } from "../../src/server/agents/orchestrator.ts";

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

  test("regex detects endpoint keyword", () => {
    expect(needsBackend("REST endpoint for authentication")).toBe(true);
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
  test("includes core pipeline agents without backend", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const agentNames = plan.steps.map((s) => s.agentName);
    expect(agentNames).toEqual([
      "architect",
      "frontend-dev",
      "styling",
      "testing",
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
    const agentNames = plan.steps.map((s) => s.agentName);
    expect(agentNames).toContain("backend-dev");
  });

  test("excludes backend-dev when research says no backend", () => {
    const research = JSON.stringify({
      features: [{ name: "hero", requires_backend: false }],
    });
    const plan = buildExecutionPlan("Build a landing page", research);
    const agentNames = plan.steps.map((s) => s.agentName);
    expect(agentNames).not.toContain("backend-dev");
  });

  test("backend-dev comes after frontend-dev and before styling", () => {
    const research = JSON.stringify({
      features: [{ name: "api", requires_backend: true }],
    });
    const plan = buildExecutionPlan("Build app", research);
    const names = plan.steps.map((s) => s.agentName);
    const feIdx = names.indexOf("frontend-dev");
    const beIdx = names.indexOf("backend-dev");
    const stIdx = names.indexOf("styling");
    expect(beIdx).toBeGreaterThan(feIdx);
    expect(beIdx).toBeLessThan(stIdx);
  });

  test("testing comes after styling in build mode", () => {
    const plan = buildExecutionPlan("Build something");
    const names = plan.steps.map((s) => s.agentName);
    expect(names.indexOf("testing")).toBeGreaterThan(names.indexOf("styling"));
  });

  test("code-review comes after testing", () => {
    const plan = buildExecutionPlan("Build something");
    const names = plan.steps.map((s) => s.agentName);
    expect(names.indexOf("code-review")).toBeGreaterThan(names.indexOf("testing"));
  });

  test("qa is the last step", () => {
    const plan = buildExecutionPlan("Build something");
    const lastStep = plan.steps[plan.steps.length - 1]!;
    expect(lastStep.agentName).toBe("qa");
  });

  test("each step has input containing original user message", () => {
    const plan = buildExecutionPlan("Build a calculator");
    for (const step of plan.steps) {
      expect(step.input).toContain("Build a calculator");
    }
  });

  test("no research step in plan (research runs in phase 1)", () => {
    const plan = buildExecutionPlan("Build something");
    const agentNames = plan.steps.map((s) => s.agentName);
    expect(agentNames).not.toContain("research");
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

  test("extracts files from markdown code blocks with // filepath", () => {
    const output = "```tsx\n// src/App.tsx\nexport default function App() {}\n```";
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
  });

  test("extracts files from ### heading + code block pattern", () => {
    const output = "### src/App.tsx\n```tsx\nexport default function App() {}\n```";
    const files = extractFilesFromOutput(output);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/App.tsx");
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
});

// --- buildExecutionPlan (fix mode) ---

describe("buildExecutionPlan (fix mode)", () => {
  test("fix mode skips research and architect", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).not.toContain("research");
    expect(names).not.toContain("architect");
  });

  test("fix mode with frontend scope routes to frontend-dev", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toContain("frontend-dev");
    expect(names).not.toContain("backend-dev");
    expect(names).not.toContain("styling");
  });

  test("fix mode with backend scope routes to backend-dev", () => {
    const plan = buildExecutionPlan("fix the API", undefined, "fix", "backend");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toContain("backend-dev");
    expect(names).not.toContain("frontend-dev");
  });

  test("fix mode with styling scope routes to styling", () => {
    const plan = buildExecutionPlan("fix the colors", undefined, "fix", "styling");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toContain("styling");
    expect(names).not.toContain("frontend-dev");
    expect(names).not.toContain("backend-dev");
  });

  test("fix mode with full scope routes to frontend-dev + backend-dev", () => {
    const plan = buildExecutionPlan("fix everything", undefined, "fix", "full");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toContain("frontend-dev");
    expect(names).toContain("backend-dev");
  });

  test("fix mode always ends with testing, code-review, security, qa", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = plan.steps.map((s) => s.agentName);
    const lastFour = names.slice(-4);
    expect(lastFour).toEqual(["testing", "code-review", "security", "qa"]);
  });

  test("fix mode includes testing agent before code-review", () => {
    const plan = buildExecutionPlan("fix the button", undefined, "fix", "frontend");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toContain("testing");
    expect(names.indexOf("testing")).toBeLessThan(names.indexOf("code-review"));
  });

  test("fix mode includes user message in step inputs", () => {
    const plan = buildExecutionPlan("fix the button color", undefined, "fix", "frontend");
    for (const step of plan.steps) {
      expect(step.input).toContain("fix the button color");
    }
  });

  test("build mode with default params includes testing", () => {
    const plan = buildExecutionPlan("Build a landing page");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toEqual(["architect", "frontend-dev", "styling", "testing", "code-review", "security", "qa"]);
  });

  test("build mode with explicit intent param includes testing", () => {
    const plan = buildExecutionPlan("Build a landing page", undefined, "build");
    const names = plan.steps.map((s) => s.agentName);
    expect(names).toEqual(["architect", "frontend-dev", "styling", "testing", "code-review", "security", "qa"]);
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
