import type { AgentConfig, AgentName, AgentToolConfig, ResolvedAgentConfig, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS } from "../../shared/types.ts";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";

export const AGENT_ROSTER: AgentConfig[] = [
  {
    name: "orchestrator",
    displayName: "Orchestrator",
    provider: "anthropic",
    model: "claude-opus-4-6",
    description: "Creates execution plans, dispatches agents, merges results, handles errors",
  },
  {
    name: "research",
    displayName: "Research Agent",
    provider: "anthropic",
    model: "claude-opus-4-6",
    description: "Analyzes user requests, identifies requirements, suggests approaches",
  },
  {
    name: "architect",
    displayName: "Architect Agent",
    provider: "anthropic",
    model: "claude-opus-4-6",
    description: "Designs component tree, file structure, data flow",
  },
  {
    name: "frontend-dev",
    displayName: "Frontend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates React/HTML/CSS/JS code",
  },
  {
    name: "backend-dev",
    displayName: "Backend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates API routes, server logic, data handling",
  },
  {
    name: "styling",
    displayName: "Styling Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Applies design system, responsive layout, theming",
  },
  {
    name: "testing",
    displayName: "Test Planner",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Creates test plans that define expected behavior; dev agents write the actual test files",
  },
  {
    name: "code-review",
    displayName: "Code Reviewer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Reviews code for bugs, type errors, and correctness; reports issues for dev agents to fix",
  },
  {
    name: "qa",
    displayName: "QA Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Validates implementation against requirements; reports gaps without fixing code",
  },
  {
    name: "security",
    displayName: "Security Reviewer",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Scans for XSS, injection, key exposure, sandbox escapes",
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
  research: ["read_file", "list_files"],
  architect: ["read_file", "list_files"],
  "frontend-dev": [...ALL_TOOLS],
  "backend-dev": [...ALL_TOOLS],
  styling: [...ALL_TOOLS],
  testing: ["read_file", "list_files"],
  "code-review": ["read_file", "list_files"],
  qa: ["read_file", "list_files"],
  security: ["read_file", "list_files"],
};

export const TOOLS_READONLY_AGENTS = new Set<AgentName>(["orchestrator"]);

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
