import type { AgentConfig, AgentName, AgentToolConfig, ResolvedAgentConfig, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS, FILE_TOOLS } from "../../shared/types.ts";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";

export const AGENT_ROSTER: AgentConfig[] = [
  {
    name: "orchestrator",
    displayName: "Orchestrator",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Creates execution plans, dispatches agents, merges results, handles errors",
    group: "planning",
  },
  {
    name: "orchestrator:classify",
    displayName: "Intent Classifier",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Classifies user intent (build/fix/question) — fast, cheap",
    group: "planning",
  },
  {
    name: "orchestrator:title",
    displayName: "Chat Titler",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Generates short chat titles — fast, cheap, fire-and-forget",
    group: "planning",
  },
  {
    name: "orchestrator:question",
    displayName: "Question Answerer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Answers user questions about their project — no pipeline",
    group: "planning",
  },
  {
    name: "orchestrator:summary",
    displayName: "Summary Writer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Writes the final pipeline summary shown to the user",
    group: "planning",
  },
  {
    name: "research",
    displayName: "Research Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Analyzes user requests, identifies requirements, suggests approaches",
    group: "planning",
  },
  {
    name: "architect",
    displayName: "Architect Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Designs component tree, file structure, data flow",
    group: "planning",
  },
  {
    name: "frontend-dev",
    displayName: "Frontend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates React/HTML/CSS/JS code",
    group: "development",
  },
  {
    name: "backend-dev",
    displayName: "Backend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates API routes, server logic, data handling",
    group: "development",
  },
  {
    name: "styling",
    displayName: "Styling Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Applies design system, responsive layout, theming",
    group: "development",
  },
  {
    name: "code-review",
    displayName: "Code Reviewer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Reviews code for bugs, type errors, and correctness; reports issues for dev agents to fix",
    group: "quality",
  },
  {
    name: "qa",
    displayName: "QA Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Validates implementation against requirements; reports gaps without fixing code",
    group: "quality",
  },
  {
    name: "security",
    displayName: "Security Reviewer",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Scans for XSS, injection, key exposure, sandbox escapes",
    group: "quality",
  },
];

export function getAgentConfig(name: AgentName): AgentConfig | undefined {
  return AGENT_ROSTER.find((a) => a.name === name);
}

/** Get agent config with DB overrides layered on top of AGENT_ROSTER defaults. */
export function getAgentConfigResolved(name: AgentName): ResolvedAgentConfig | undefined {
  const base = AGENT_ROSTER.find((a) => a.name === name);
  if (!base) return undefined;

  const providerRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.provider`)).get();
  const modelRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.model`)).get();

  const isOverridden = !!(providerRow || modelRow);

  return {
    ...base,
    provider: providerRow?.value || base.provider,
    model: modelRow?.value || base.model,
    isOverridden,
  };
}

/** Get all agent configs with DB overrides applied. */
export function getAllAgentConfigs(): ResolvedAgentConfig[] {
  return AGENT_ROSTER.map((a) => getAgentConfigResolved(a.name)!);
}

/** Remove all DB overrides for an agent (provider, model, prompt). */
export function resetAgentOverrides(name: AgentName): void {
  const prefix = `agent.${name}.`;
  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, `${prefix}%`)).all();
  for (const row of rows) {
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, row.key)).run();
  }
}

export function getModelId(provider: string, model: string): string {
  return model;
}

// --- Tool configuration ---

export const DEFAULT_AGENT_TOOLS: Record<AgentName, ToolName[]> = {
  orchestrator: [],
  "orchestrator:classify": [],
  "orchestrator:title": [],
  "orchestrator:question": [],
  "orchestrator:summary": [],
  research: [],
  architect: [],
  "frontend-dev": [...FILE_TOOLS, "save_version"],
  "backend-dev": [...FILE_TOOLS, "save_version"],
  styling: [...FILE_TOOLS, "save_version"],
  "code-review": [], // reviewer — receives code in prompt, tools cause extra round-trips
  qa: [],            // reviewer — receives code in prompt, tools cause extra round-trips
  security: [],      // reviewer — receives code in prompt, tools cause extra round-trips
};

export const TOOLS_READONLY_AGENTS = new Set<AgentName>(["orchestrator", "orchestrator:classify", "orchestrator:title", "orchestrator:question", "orchestrator:summary"]);

/** Get the active tools for an agent (DB override or default). */
export function getAgentTools(name: AgentName): ToolName[] {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).get();
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        return parsed.filter((t: string) => ALL_TOOLS.includes(t as ToolName)) as ToolName[];
      }
    } catch {
      // Invalid JSON — fall through to default
    }
  }
  return DEFAULT_AGENT_TOOLS[name] ?? [];
}

/** Get full tool config for a single agent (used by API). */
export function getAgentToolConfig(name: AgentName): AgentToolConfig | undefined {
  const base = AGENT_ROSTER.find((a) => a.name === name);
  if (!base) return undefined;

  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).get();
  const tools = getAgentTools(name);
  const defaultTools = DEFAULT_AGENT_TOOLS[name] ?? [];

  return {
    name,
    displayName: base.displayName,
    group: base.group,
    tools,
    defaultTools,
    isOverridden: !!row,
    isReadOnly: TOOLS_READONLY_AGENTS.has(name),
  };
}

/** Get tool configs for all agents. */
export function getAllAgentToolConfigs(): AgentToolConfig[] {
  return AGENT_ROSTER.map((a) => getAgentToolConfig(a.name)!);
}

/** Remove the tool override for an agent (reverts to default). */
export function resetAgentToolOverrides(name: AgentName): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).run();
}
