import { describe, test, expect } from "bun:test";
import { extractSummary } from "../../src/shared/summary.ts";

describe("extractSummary", () => {
  test("extracts summary field from research agent JSON", () => {
    const json = JSON.stringify({
      page_type: "landing",
      summary: "A modern landing page with hero and CTA",
      components: [],
      features: [],
    });
    expect(extractSummary(json, "research")).toBe("A modern landing page with hero and CTA");
  });

  test("extracts page_type + counts when no summary field", () => {
    const json = JSON.stringify({
      page_type: "dashboard",
      components: [{ name: "A" }, { name: "B" }, { name: "C" }],
      features: [{ name: "F1" }],
    });
    expect(extractSummary(json, "research")).toBe("dashboard page — 3 components, 1 features");
  });

  test("extracts file_plan count from architect JSON", () => {
    const json = JSON.stringify({
      file_plan: [
        { path: "src/App.tsx" },
        { path: "src/Button.tsx" },
      ],
    });
    expect(extractSummary(json, "architect")).toBe("2 files planned");
  });

  test("extracts component_tree name from architect JSON", () => {
    const json = JSON.stringify({
      component_tree: { name: "App", children: [] },
    });
    expect(extractSummary(json, "architect")).toBe("Architecture: App component tree");
  });

  test("strips leading code fence and finds real text", () => {
    const text = '```json\n{"key": "value"}\n```\n\nThis is the actual summary of work done';
    expect(extractSummary(text)).toBe("This is the actual summary of work done");
  });

  test("skips lines starting with backtick", () => {
    const text = '```typescript\nconst x = 1;\n```\nImplemented the calculator logic';
    expect(extractSummary(text)).toBe("Implemented the calculator logic");
  });

  test("skips JSON lines", () => {
    const text = '{\n  "status": "pass"\n}\nAll checks passed successfully';
    expect(extractSummary(text)).toBe("All checks passed successfully");
  });

  test("skips markdown headers", () => {
    const text = "# Report\n## Details\nThe code has been reviewed and is clean";
    expect(extractSummary(text)).toBe("The code has been reviewed and is clean");
  });

  test("skips JSON key-value lines", () => {
    const text = '"status": "pass",\n"summary": "ok"\nThe review is complete';
    expect(extractSummary(text)).toBe("The review is complete");
  });

  test("truncates at 120 chars", () => {
    const long = "A".repeat(150);
    const result = extractSummary(long);
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  test("returns 'Completed' for pure JSON with no summary (non-research agent)", () => {
    const json = '{"status": "pass", "findings": []}';
    expect(extractSummary(json)).toBe("Completed");
  });

  test("returns 'Completed' for empty string", () => {
    expect(extractSummary("")).toBe("Completed");
  });

  test("returns 'Completed' for whitespace-only", () => {
    expect(extractSummary("   \n  \n  ")).toBe("Completed");
  });

  test("handles JSON inside code fences for research agent", () => {
    const text = '```json\n{"summary": "A todo app with CRUD operations", "page_type": "app"}\n```';
    expect(extractSummary(text, "research")).toBe("A todo app with CRUD operations");
  });

  test("handles normal text output without fences", () => {
    const text = "I have reviewed all the code and found 3 issues that need fixing";
    expect(extractSummary(text)).toBe("I have reviewed all the code and found 3 issues that need fixing");
  });
});
