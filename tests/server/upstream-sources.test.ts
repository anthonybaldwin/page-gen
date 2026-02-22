import { describe, test, expect } from "bun:test";
import {
  resolveUpstreamSources,
  resolveMergeFields,
  filterUpstreamOutputs,
} from "../../src/server/agents/orchestrator.ts";
import { validateFlowTemplate } from "../../src/shared/flow-validation.ts";
import type { FlowTemplate, UpstreamSource } from "../../src/shared/flow-types.ts";

function makeResults(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

// --- resolveUpstreamSources ---

describe("resolveUpstreamSources", () => {
  test("raw transform passes values through", () => {
    const sources: UpstreamSource[] = [
      { sourceKey: "research" },
      { sourceKey: "architect" },
    ];
    const results = makeResults({
      research: "research output",
      architect: "architect output",
    });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).toEqual({
      research: "research output",
      architect: "architect output",
    });
  });

  test("alias renames the key", () => {
    const sources: UpstreamSource[] = [
      { sourceKey: "architect", alias: "arch-plan" },
    ];
    const results = makeResults({ architect: "plan" });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).toHaveProperty("arch-plan", "plan");
    expect(resolved).not.toHaveProperty("architect");
  });

  test("design-system transform extracts from architect JSON", () => {
    const architectOutput = JSON.stringify({
      design_system: {
        brand_kernel: "Bold and modern",
        colors: { primary: "#3B82F6", secondary: "#10B981" },
        typography: { heading: "Inter", body: "Inter" },
        spacing: "8px base",
        radius: "8px",
      },
    });
    const sources: UpstreamSource[] = [
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
    ];
    const results = makeResults({ architect: architectOutput });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).toHaveProperty("design-system");
    expect(resolved["design-system"]).toContain("Design System");
    expect(resolved["design-system"]).toContain("#3B82F6");
  });

  test("design-system transform returns nothing when no design_system in JSON", () => {
    const sources: UpstreamSource[] = [
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
    ];
    const results = makeResults({ architect: "plain text, not JSON" });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).not.toHaveProperty("design-system");
  });

  test("file-manifest transform extracts file paths", () => {
    const devOutput = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "export default function App() {}"}}
</tool_call>
<tool_call>
{"name": "write_file", "parameters": {"path": "src/index.css", "content": "body { margin: 0 }"}}
</tool_call>`;
    const sources: UpstreamSource[] = [
      { sourceKey: "frontend-dev", alias: "changed-files", transform: "file-manifest" },
    ];
    const results = makeResults({ "frontend-dev": devOutput });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).toHaveProperty("changed-files");
    expect(resolved["changed-files"]).toContain("src/App.tsx");
    expect(resolved["changed-files"]).toContain("src/index.css");
  });

  test("missing source key is silently skipped", () => {
    const sources: UpstreamSource[] = [
      { sourceKey: "nonexistent" },
    ];
    const results = makeResults({});
    const resolved = resolveUpstreamSources(sources, results);
    expect(Object.keys(resolved)).toHaveLength(0);
  });

  test("empty sources returns empty object", () => {
    const resolved = resolveUpstreamSources([], makeResults({ architect: "x" }));
    expect(Object.keys(resolved)).toHaveLength(0);
  });

  test("project-source transform reads from disk (skipped without projectPath)", () => {
    const sources: UpstreamSource[] = [
      { sourceKey: "project-source", transform: "project-source" },
    ];
    // Without projectPath, project-source is skipped
    const resolved = resolveUpstreamSources(sources, makeResults({}));
    expect(resolved).not.toHaveProperty("project-source");
  });

  test("multiple sources with mixed transforms", () => {
    const architectOutput = JSON.stringify({
      design_system: { brand_kernel: "Clean" },
    });
    const devOutput = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/main.tsx", "content": "..."}}
</tool_call>`;
    const sources: UpstreamSource[] = [
      { sourceKey: "architect" },
      { sourceKey: "architect", alias: "design-system", transform: "design-system" },
      { sourceKey: "frontend-dev", alias: "changed-files", transform: "file-manifest" },
      { sourceKey: "vibe-brief" },
    ];
    const results = makeResults({
      architect: architectOutput,
      "frontend-dev": devOutput,
      "vibe-brief": "vibrant and bold",
    });
    const resolved = resolveUpstreamSources(sources, results);
    expect(resolved).toHaveProperty("architect");
    expect(resolved).toHaveProperty("design-system");
    expect(resolved).toHaveProperty("changed-files");
    expect(resolved).toHaveProperty("vibe-brief");
  });
});

// --- resolveMergeFields ---

describe("resolveMergeFields", () => {
  test("resolves {{output:KEY}} to agent output", () => {
    const results = makeResults({ research: "research output" });
    const resolved = resolveMergeFields("Based on: {{output:research}}", results);
    expect(resolved).toBe("Based on: research output");
  });

  test("resolves {{context:KEY}} as alias for output", () => {
    const results = makeResults({ architect: "arch plan" });
    const resolved = resolveMergeFields("Plan: {{context:architect}}", results);
    expect(resolved).toBe("Plan: arch plan");
  });

  test("resolves {{transform:design-system}} from architect", () => {
    const architectOutput = JSON.stringify({
      design_system: { brand_kernel: "Modern" },
    });
    const results = makeResults({ architect: architectOutput });
    const resolved = resolveMergeFields("Design: {{transform:design-system}}", results);
    expect(resolved).toContain("Design System");
  });

  test("resolves {{transform:file-manifest:KEY}}", () => {
    const devOutput = `<tool_call>
{"name": "write_file", "parameters": {"path": "src/App.tsx", "content": "..."}}
</tool_call>`;
    const results = makeResults({ "frontend-dev": devOutput });
    const resolved = resolveMergeFields("Files: {{transform:file-manifest:frontend-dev}}", results);
    expect(resolved).toContain("src/App.tsx");
  });

  test("missing output resolves to empty string", () => {
    const results = makeResults({});
    const resolved = resolveMergeFields("Data: {{output:nonexistent}}", results);
    expect(resolved).toBe("Data: ");
  });

  test("multiple merge fields in same string", () => {
    const results = makeResults({
      research: "R",
      architect: "A",
    });
    const resolved = resolveMergeFields("R={{output:research}} A={{output:architect}}", results);
    expect(resolved).toBe("R=R A=A");
  });

  test("non-merge-field {{userMessage}} is left alone", () => {
    const results = makeResults({});
    const resolved = resolveMergeFields("Request: {{userMessage}}", results);
    expect(resolved).toBe("Request: {{userMessage}}");
  });

  test("transform:project-source without projectPath falls back to agentResults", () => {
    const results = makeResults({ "project-source": "cached source" });
    const resolved = resolveMergeFields("Source: {{transform:project-source}}", results);
    expect(resolved).toBe("Source: cached source");
  });
});

// --- Backward compatibility ---

describe("backward compatibility", () => {
  test("step without upstreamSources uses filterUpstreamOutputs", () => {
    // Verify filterUpstreamOutputs still works as before
    const results = makeResults({
      research: "research output",
      "vibe-brief": "vibe data",
      "mood-analysis": "mood data",
      architect: "architect output",
    });
    const filtered = filterUpstreamOutputs("research", undefined, results);
    expect(filtered).toHaveProperty("vibe-brief");
    expect(filtered).toHaveProperty("mood-analysis");
    expect(filtered).not.toHaveProperty("architect");
    expect(filtered).not.toHaveProperty("research");
  });
});

// --- Validation ---

describe("upstream source validation", () => {
  function makeTemplate(overrides: Partial<FlowTemplate> = {}): FlowTemplate {
    return {
      id: "test",
      name: "Test",
      description: "Test template",
      intent: "build",
      version: 5,
      enabled: true,
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [{ sourceKey: "research" }],
          }, position: { x: 280, y: 0 },
        },
      ],
      edges: [
        { id: "e-research-architect", source: "research", target: "architect" },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDefault: false,
      ...overrides,
    };
  }

  test("valid upstream source referencing ancestor", () => {
    const template = makeTemplate();
    const errors = validateFlowTemplate(template, ["research", "architect"]);
    expect(errors.filter(e => e.type === "error")).toHaveLength(0);
  });

  test("valid upstream source referencing well-known key", () => {
    const template = makeTemplate({
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [{ sourceKey: "vibe-brief" }],
          }, position: { x: 280, y: 0 },
        },
      ],
    });
    const errors = validateFlowTemplate(template, ["research", "architect"]);
    const upstreamErrors = errors.filter(e => e.message.includes("upstream"));
    expect(upstreamErrors).toHaveLength(0);
  });

  test("warns on non-ancestor upstream source", () => {
    const template = makeTemplate({
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        { id: "other", type: "agent", data: { type: "agent", agentName: "frontend-dev", inputTemplate: "test" }, position: { x: 0, y: 200 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [{ sourceKey: "other" }],
          }, position: { x: 280, y: 0 },
        },
      ],
      edges: [
        { id: "e-research-architect", source: "research", target: "architect" },
      ],
    });
    const errors = validateFlowTemplate(template, ["research", "architect", "frontend-dev"]);
    const warnings = errors.filter(e => e.type === "warning" && e.message.includes("not an ancestor"));
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("warns on design-system transform with non-architect source", () => {
    const template = makeTemplate({
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [{ sourceKey: "research", transform: "design-system" }],
          }, position: { x: 280, y: 0 },
        },
      ],
    });
    const errors = validateFlowTemplate(template, ["research", "architect"]);
    const warnings = errors.filter(e => e.type === "warning" && e.message.includes("design-system"));
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("warns on duplicate aliases", () => {
    const template = makeTemplate({
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [
              { sourceKey: "research", alias: "data" },
              { sourceKey: "vibe-brief", alias: "data" },
            ],
          }, position: { x: 280, y: 0 },
        },
      ],
    });
    const errors = validateFlowTemplate(template, ["research", "architect"]);
    const warnings = errors.filter(e => e.type === "warning" && e.message.includes("duplicate"));
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("errors on invalid transform", () => {
    const template = makeTemplate({
      nodes: [
        { id: "research", type: "agent", data: { type: "agent", agentName: "research", inputTemplate: "test" }, position: { x: 0, y: 0 } },
        {
          id: "architect", type: "agent", data: {
            type: "agent", agentName: "architect", inputTemplate: "test",
            upstreamSources: [{ sourceKey: "research", transform: "invalid" as any }],
          }, position: { x: 280, y: 0 },
        },
      ],
    });
    const errors = validateFlowTemplate(template, ["research", "architect"]);
    const transformErrors = errors.filter(e => e.type === "error" && e.message.includes("invalid transform"));
    expect(transformErrors.length).toBeGreaterThan(0);
  });
});
