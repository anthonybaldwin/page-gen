/**
 * Shared utility for agent activity status phrases and tool humanization.
 * Pure functions only — no hooks, safe to call from any context.
 */

const IDLE_PHRASES: Record<string, string[]> = {
  research: [
    "Analyzing requirements...",
    "Evaluating approach...",
    "Reviewing project context...",
  ],
  architect: [
    "Designing component structure...",
    "Planning file layout...",
    "Mapping data flow...",
  ],
  "frontend-dev": [
    "Writing components...",
    "Building UI structure...",
    "Implementing logic...",
  ],
  "backend-dev": [
    "Writing server logic...",
    "Building API routes...",
    "Implementing handlers...",
  ],
  styling: [
    "Applying styles...",
    "Tuning layout...",
    "Refining spacing...",
  ],
  "code-review": [
    "Reviewing code quality...",
    "Checking patterns...",
    "Validating logic...",
  ],
  security: [
    "Scanning for vulnerabilities...",
    "Checking input validation...",
    "Reviewing auth patterns...",
  ],
  qa: [
    "Validating requirements...",
    "Checking completeness...",
    "Reviewing edge cases...",
  ],
};

const DEFAULT_PHRASES = ["Working...", "Processing...", "Analyzing..."];

export function getAgentIdlePhrase(agentName: string, index: number): string {
  const phrases = IDLE_PHRASES[agentName] || DEFAULT_PHRASES;
  return phrases[index % phrases.length]!;
}

export function humanizeToolActivity(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const path = input.path as string | undefined;
  const filename = path ? path.split("/").pop() || path : undefined;

  switch (toolName) {
    case "write_file":
      return `Writing ${filename || "file"}`;
    case "write_files":
      return "Writing files";
    case "read_file":
      return `Reading ${filename || "file"}`;
    case "search_files":
      return `Searching for "${(input.pattern || input.query || "") as string}"`;
    case "list_files":
      return `Listing ${filename || "."}`;
    case "shell":
      return "Running command";
    default:
      return filename ? `${toolName}(${filename})` : toolName;
  }
}

export function getAgentActivity(
  agentName: string,
  lastToolCall: { toolName: string; input: Record<string, unknown> } | null | undefined,
  phraseIndex: number,
): string {
  if (lastToolCall) {
    return humanizeToolActivity(lastToolCall.toolName, lastToolCall.input);
  }
  return getAgentIdlePhrase(agentName, phraseIndex);
}

