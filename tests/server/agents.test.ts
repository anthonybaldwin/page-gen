import { describe, test, expect, beforeAll } from "bun:test";
import { AGENT_ROSTER, getAgentConfig, DEFAULT_AGENT_TOOLS, TOOLS_READONLY_AGENTS, getAgentTools } from "../../src/server/agents/registry.ts";
import { ALL_TOOLS } from "../../src/shared/types.ts";
import type { AgentName } from "../../src/shared/types.ts";
import { runMigrations } from "../../src/server/db/migrate.ts";

describe("Agent Registry", () => {
  beforeAll(() => {
    runMigrations();
  });

  test("all 13 agents are defined (9 base + 4 orchestrator subtasks)", () => {
    expect(AGENT_ROSTER).toHaveLength(13);
  });

  test("each agent has required fields", () => {
    for (const agent of AGENT_ROSTER) {
      expect(agent.name).toBeTruthy();
      expect(agent.displayName).toBeTruthy();
      expect(agent.provider).toBeTruthy();
      expect(agent.model).toBeTruthy();
      expect(agent.description).toBeTruthy();
    }
  });

  test("getAgentConfig returns correct config", () => {
    const orchestrator = getAgentConfig("orchestrator");
    expect(orchestrator).toBeDefined();
    expect(orchestrator!.model).toBe("claude-sonnet-4-6");
    expect(orchestrator!.provider).toBe("anthropic");
  });

  test("getAgentConfig returns undefined for unknown agent", () => {
    const result = getAgentConfig("nonexistent" as never);
    expect(result).toBeUndefined();
  });

  test("all main agents default to sonnet-4-5", () => {
    for (const name of ["orchestrator", "research", "architect", "frontend-dev", "backend-dev", "styling", "code-review", "qa"] as const) {
      const config = getAgentConfig(name);
      expect(config?.model).toBe("claude-sonnet-4-6");
    }
  });

  test("security uses haiku model", () => {
    const config = getAgentConfig("security");
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
  });

  test("orchestrator:classify defaults to haiku", () => {
    const config = getAgentConfig("orchestrator:classify");
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
    expect(config?.provider).toBe("anthropic");
  });

  test("orchestrator:title defaults to haiku", () => {
    const config = getAgentConfig("orchestrator:title");
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
    expect(config?.provider).toBe("anthropic");
  });

  test("orchestrator:question defaults to sonnet-4-5", () => {
    const config = getAgentConfig("orchestrator:question");
    expect(config?.model).toBe("claude-sonnet-4-6");
  });

  test("orchestrator:summary defaults to sonnet-4-5", () => {
    const config = getAgentConfig("orchestrator:summary");
    expect(config?.model).toBe("claude-sonnet-4-6");
  });
});

describe("Agent Tool Defaults", () => {
  test("DEFAULT_AGENT_TOOLS has entries for all agents", () => {
    const agentNames = AGENT_ROSTER.map((a) => a.name);
    for (const name of agentNames) {
      expect(DEFAULT_AGENT_TOOLS).toHaveProperty(name);
    }
    expect(Object.keys(DEFAULT_AGENT_TOOLS)).toHaveLength(AGENT_ROSTER.length);
  });

  test("file-producing agents default to all tools", () => {
    for (const name of ["frontend-dev", "backend-dev", "styling"] as AgentName[]) {
      const tools = DEFAULT_AGENT_TOOLS[name];
      expect(tools).toHaveLength(ALL_TOOLS.length);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }
    }
  });

  test("orchestrator defaults to no tools", () => {
    expect(DEFAULT_AGENT_TOOLS["orchestrator"]).toEqual([]);
  });

  test("research and architect default to no tools (pure analysis)", () => {
    for (const name of ["research", "architect"] as AgentName[]) {
      expect(DEFAULT_AGENT_TOOLS[name]).toEqual([]);
    }
  });

  test("review agents default to no tools (single-shot)", () => {
    for (const name of ["code-review", "qa", "security"] as AgentName[]) {
      expect(DEFAULT_AGENT_TOOLS[name]).toEqual([]);
    }
  });

  test("orchestrator and subtasks are in readonly set", () => {
    expect(TOOLS_READONLY_AGENTS.has("orchestrator")).toBe(true);
    expect(TOOLS_READONLY_AGENTS.has("orchestrator:classify")).toBe(true);
    expect(TOOLS_READONLY_AGENTS.has("orchestrator:title")).toBe(true);
    expect(TOOLS_READONLY_AGENTS.has("orchestrator:question")).toBe(true);
    expect(TOOLS_READONLY_AGENTS.has("orchestrator:summary")).toBe(true);
  });

  test("getAgentTools returns defaults when no DB override", () => {
    expect(getAgentTools("frontend-dev")).toEqual(ALL_TOOLS);
    expect(getAgentTools("orchestrator")).toEqual([]);
    expect(getAgentTools("code-review")).toEqual([]);
  });
});
