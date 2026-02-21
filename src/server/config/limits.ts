// Cost/usage default limits

export const LIMIT_DEFAULTS: Record<string, string> = {
  maxTokensPerChat: "500000",
  maxAgentCallsPerRun: "30",
  maxCostPerDay: "0",
  maxCostPerProject: "0",
};

export const WARNING_THRESHOLD = 0.8;
