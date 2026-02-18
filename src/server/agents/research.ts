import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfig } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";

export async function runResearchAgent(
  providers: ProviderInstance,
  input: AgentInput
): Promise<AgentOutput> {
  const config = getAgentConfig("research");
  if (!config) throw new Error("Research agent config not found");
  return runAgent(config, providers, input);
}
