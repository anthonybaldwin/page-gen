import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfig } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";

export async function runSecurityAgent(
  providers: ProviderInstance,
  input: AgentInput
): Promise<AgentOutput> {
  const config = getAgentConfig("security");
  if (!config) throw new Error("Security agent config not found");
  return runAgent(config, providers, input);
}
