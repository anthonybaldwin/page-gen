import type { ProviderInstance } from "../providers/registry.ts";
import { getAgentConfig } from "./registry.ts";
import { runAgent, type AgentInput, type AgentOutput } from "./base.ts";

export async function runBackendDevAgent(
  providers: ProviderInstance,
  input: AgentInput
): Promise<AgentOutput> {
  const config = getAgentConfig("backend-dev");
  if (!config) throw new Error("Backend dev agent config not found");
  return runAgent(config, providers, input);
}
