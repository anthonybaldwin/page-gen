import { describe, test, expect } from "bun:test";
import { AGENT_ROSTER, getAgentConfig, DEFAULT_AGENT_TOOLS, TOOLS_READONLY_AGENTS, getAgentTools } from "../../src/server/agents/registry.ts";
import { ALL_TOOLS } from "../../src/shared/types.ts";
import type { AgentName } from "../../src/shared/types.ts";

describe("Agent Registry", () => {
  test("all 10 agents are defined", () => {
    expect(AGENT_ROSTER).toHaveLength(10);
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
    expect(orchestrator!.model).toBe("claude-opus-4-6");
    expect(orchestrator!.provider).toBe("anthropic");
  });

  test("getAgentConfig returns undefined for unknown agent", () => {
    const result = getAgentConfig("nonexistent" as never);
    expect(result).toBeUndefined();
  });

  test("planning agents use opus model", () => {
    for (const name of ["orchestrator", "research", "architect"] as const) {
      const config = getAgentConfig(name);
      expect(config?.model).toBe("claude-opus-4-6");
    }
  });

  test("dev agents use sonnet model", () => {
    for (const name of ["frontend-dev", "backend-dev", "styling"] as const) {
      const config = getAgentConfig(name);
      expect(config?.model).toBe("claude-sonnet-4-6");
    }
  });

  test("review agents use sonnet model", () => {
    for (const name of ["code-review", "qa"] as const) {
      const config = getAgentConfig(name);
      expect(config?.model).toBe("claude-sonnet-4-6");
    }
  });

  test("security uses haiku model", () => {
    const config = getAgentConfig("security");
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("Agent Tool Defaults", () => {
  test("DEFAULT_AGENT_TOOLS has entries for all 10 agents", () => {
    const agentNames = AGENT_ROSTER.map((a) => a.name);
    for (const name of agentNames) {
      expect(DEFAULT_AGENT_TOOLS).toHaveProperty(name);
    }
    expect(Object.keys(DEFAULT_AGENT_TOOLS)).toHaveLength(10);
  });

  test("file-producing agents default to all 3 tools", () => {
    for (const name of ["frontend-dev", "backend-dev", "styling"] as AgentName[]) {
      const tools = DEFAULT_AGENT_TOOLS[name];
      expect(tools).toHaveLength(3);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }
    }
  });

  test("non-producing agents default to empty tools", () => {
    for (const name of ["orchestrator", "research", "architect", "testing", "code-review", "qa", "security"] as AgentName[]) {
      expect(DEFAULT_AGENT_TOOLS[name]).toEqual([]);
    }
  });

  test("orchestrator is in readonly set", () => {
    expect(TOOLS_READONLY_AGENTS.has("orchestrator")).toBe(true);
  });

  test("getAgentTools returns defaults when no DB override", () => {
    expect(getAgentTools("frontend-dev")).toEqual(ALL_TOOLS);
    expect(getAgentTools("orchestrator")).toEqual([]);
    expect(getAgentTools("testing")).toEqual([]);
  });
});
