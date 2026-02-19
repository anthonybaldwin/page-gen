import { describe, test, expect } from "bun:test";
import { AGENT_ROSTER, getAgentConfig } from "../../src/server/agents/registry.ts";

describe("Agent Registry", () => {
  test("all 8 agents are defined", () => {
    expect(AGENT_ROSTER).toHaveLength(8);
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

  test("orchestrator uses opus model", () => {
    const config = getAgentConfig("orchestrator");
    expect(config?.model).toBe("claude-opus-4-6");
  });

  test("research uses sonnet model", () => {
    const config = getAgentConfig("research");
    expect(config?.provider).toBe("anthropic");
    expect(config?.model).toBe("claude-sonnet-4-6");
  });

  test("security uses haiku model", () => {
    const config = getAgentConfig("security");
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
  });
});
