import { describe, test, expect } from "bun:test";
import { AGENT_ROSTER, getAgentConfig } from "../../src/server/agents/registry.ts";

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
