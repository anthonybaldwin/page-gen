import type { AgentConfig, AgentGroup, AgentLimitsConfig, AgentName, AgentToolConfig, ResolvedAgentConfig, ToolName } from "../../shared/types.ts";
import { ALL_TOOLS, BUILTIN_TOOL_NAMES, BUILTIN_AGENT_NAMES, FILE_TOOLS } from "../../shared/types.ts";
import { getEnabledCustomToolNames } from "../tools/custom-tool-registry.ts";
import {
  AGENT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  AGENT_MAX_TOOL_STEPS,
  DEFAULT_MAX_TOOL_STEPS,
} from "../config/pipeline.ts";
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
    allowedCategories: ["text"],
  },
  {
    name: "orchestrator:classify",
    displayName: "Intent Classifier",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Classifies user intent (build/fix/question) — fast, cheap",
    group: "planning",
    allowedCategories: ["text"],
  },
  {
    name: "orchestrator:title",
    displayName: "Chat Titler",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Generates short chat titles — fast, cheap, fire-and-forget",
    group: "planning",
    allowedCategories: ["text"],
  },
  {
    name: "orchestrator:question",
    displayName: "Question Answerer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Answers user questions about their project — no pipeline",
    group: "planning",
    allowedCategories: ["text"],
  },
  {
    name: "orchestrator:summary",
    displayName: "Summary Writer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Writes the final pipeline summary shown to the user",
    group: "planning",
    allowedCategories: ["text"],
  },
  {
    name: "research",
    displayName: "Research Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Analyzes user requests, identifies requirements, suggests approaches",
    group: "planning",
    allowedCategories: ["text", "reasoning"],
  },
  {
    name: "architect",
    displayName: "Architect Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Designs component tree, file structure, data flow",
    group: "planning",
    allowedCategories: ["text", "reasoning"],
  },
  {
    name: "frontend-dev",
    displayName: "Frontend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates React/HTML/CSS/JS code",
    group: "development",
    allowedCategories: ["text", "code", "reasoning"],
  },
  {
    name: "backend-dev",
    displayName: "Backend Developer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Generates API routes, server logic, data handling",
    group: "development",
    allowedCategories: ["text", "code", "reasoning"],
  },
  {
    name: "styling",
    displayName: "Styling Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Applies design system, responsive layout, theming",
    group: "development",
    allowedCategories: ["text", "code", "reasoning"],
  },
  {
    name: "code-review",
    displayName: "Code Reviewer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Reviews code for bugs, type errors, and correctness; reports issues for dev agents to fix",
    group: "quality",
    allowedCategories: ["text", "code", "reasoning"],
  },
  {
    name: "qa",
    displayName: "QA Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Validates implementation against requirements; reports gaps without fixing code",
    group: "quality",
    allowedCategories: ["text", "code", "reasoning"],
  },
  {
    name: "security",
    displayName: "Security Reviewer",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    description: "Scans for XSS, injection, key exposure, sandbox escapes",
    group: "quality",
    allowedCategories: ["text", "code", "reasoning"],
  },
];

// --- Built-in vs Custom agent helpers ---

/** Check if an agent name is a built-in agent. */
export function isBuiltinAgent(name: string): boolean {
  return (BUILTIN_AGENT_NAMES as readonly string[]).includes(name);
}

/** Get a single custom agent row from the database. */
export function getCustomAgent(name: string): typeof schema.customAgents.$inferSelect | undefined {
  return db.select().from(schema.customAgents).where(eq(schema.customAgents.name, name)).get();
}

/** Get all custom agent rows from the database. */
export function getCustomAgents(): (typeof schema.customAgents.$inferSelect)[] {
  return db.select().from(schema.customAgents).all();
}

/** Convert a custom_agents DB row to an AgentConfig. */
function customRowToConfig(row: typeof schema.customAgents.$inferSelect): AgentConfig {
  let allowedCategories: string[] | undefined;
  if (row.allowedCategories) {
    try { allowedCategories = JSON.parse(row.allowedCategories); } catch { /* ignore */ }
  }
  return {
    name: row.name,
    displayName: row.displayName,
    provider: row.provider,
    model: row.model,
    description: row.description,
    group: row.agentGroup as AgentGroup,
    allowedCategories,
  };
}

export function getAgentConfig(name: AgentName): AgentConfig | undefined {
  const builtin = AGENT_ROSTER.find((a) => a.name === name);
  if (builtin) return builtin;
  const custom = getCustomAgent(name);
  return custom ? customRowToConfig(custom) : undefined;
}

/** Get agent config with DB overrides layered on top of AGENT_ROSTER defaults. */
export function getAgentConfigResolved(name: AgentName): ResolvedAgentConfig | undefined {
  // Built-in agent: overlay app_settings overrides
  const base = AGENT_ROSTER.find((a) => a.name === name);
  if (base) {
    const providerRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.provider`)).get();
    const modelRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.model`)).get();
    const isOverridden = !!(providerRow || modelRow);
    return {
      ...base,
      provider: providerRow?.value || base.provider,
      model: modelRow?.value || base.model,
      isOverridden,
      isBuiltIn: true,
    };
  }

  // Custom agent: row IS the source of truth
  const custom = getCustomAgent(name);
  if (custom) {
    return {
      ...customRowToConfig(custom),
      isOverridden: false,
      isBuiltIn: false,
    };
  }

  return undefined;
}

/** Get all agent configs with DB overrides applied (built-in + custom). */
export function getAllAgentConfigs(): ResolvedAgentConfig[] {
  const builtIn = AGENT_ROSTER.map((a) => getAgentConfigResolved(a.name)!);
  const custom = getCustomAgents().map((row) => ({
    ...customRowToConfig(row),
    isOverridden: false,
    isBuiltIn: false,
  }));
  return [...builtIn, ...custom];
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

export const DEFAULT_AGENT_TOOLS: Record<string, ToolName[]> = {
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

export const TOOLS_READONLY_AGENTS = new Set<string>(["orchestrator", "orchestrator:classify", "orchestrator:title", "orchestrator:question", "orchestrator:summary"]);

/** Get the set of all valid tool names (built-in + enabled custom). */
function getAllValidToolNames(): Set<string> {
  const names = new Set<string>(BUILTIN_TOOL_NAMES as readonly string[]);
  for (const name of getEnabledCustomToolNames()) names.add(name);
  return names;
}

/** Get the active tools for an agent (DB override or default). */
export function getAgentTools(name: AgentName): ToolName[] {
  const validNames = getAllValidToolNames();

  // Check app_settings override first (works for both built-in and custom)
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).get();
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        return parsed.filter((t: string) => validNames.has(t));
      }
    } catch {
      // Invalid JSON — fall through
    }
  }

  // Built-in default
  if (DEFAULT_AGENT_TOOLS[name] !== undefined) {
    return DEFAULT_AGENT_TOOLS[name];
  }

  // Custom agent: tools from DB row
  const custom = getCustomAgent(name);
  if (custom?.tools) {
    try {
      const parsed = JSON.parse(custom.tools);
      if (Array.isArray(parsed)) {
        return parsed.filter((t: string) => validNames.has(t));
      }
    } catch { /* ignore */ }
  }

  return [];
}

/** Get full tool config for a single agent (used by API). */
export function getAgentToolConfig(name: AgentName): AgentToolConfig | undefined {
  const config = getAgentConfig(name);
  if (!config) return undefined;

  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).get();
  const tools = getAgentTools(name);
  const defaultTools = DEFAULT_AGENT_TOOLS[name] ?? [];

  return {
    name,
    displayName: config.displayName,
    group: config.group,
    tools,
    defaultTools,
    isOverridden: !!row,
    isReadOnly: TOOLS_READONLY_AGENTS.has(name),
  };
}

/** Get tool configs for all agents (built-in + custom). */
export function getAllAgentToolConfigs(): AgentToolConfig[] {
  const builtIn = AGENT_ROSTER.map((a) => getAgentToolConfig(a.name)!);
  const custom = getCustomAgents().map((row) => getAgentToolConfig(row.name)!).filter(Boolean);
  return [...builtIn, ...custom];
}

/** Remove the tool override for an agent (reverts to default). */
export function resetAgentToolOverrides(name: AgentName): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.tools`)).run();
}

// --- Execution limits ---

/** Get active limits for an agent (DB override > pipeline.ts > custom row > global default). */
export function getAgentLimits(name: AgentName): { maxOutputTokens: number; maxToolSteps: number } {
  const tokRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxOutputTokens`)).get();
  const stepsRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxToolSteps`)).get();

  // For custom agents, fall back to DB row values before global defaults
  let defaultTokens = AGENT_MAX_OUTPUT_TOKENS[name] ?? DEFAULT_MAX_OUTPUT_TOKENS;
  let defaultSteps = AGENT_MAX_TOOL_STEPS[name] ?? DEFAULT_MAX_TOOL_STEPS;

  if (!isBuiltinAgent(name)) {
    const custom = getCustomAgent(name);
    if (custom?.maxOutputTokens) defaultTokens = custom.maxOutputTokens;
    if (custom?.maxToolSteps) defaultSteps = custom.maxToolSteps;
  }

  const maxOutputTokens = tokRow ? Number(tokRow.value) : defaultTokens;
  const maxToolSteps = stepsRow ? Number(stepsRow.value) : defaultSteps;

  return { maxOutputTokens, maxToolSteps };
}

/** Get full limits config for a single agent (used by API). */
export function getAgentLimitsConfig(name: AgentName): AgentLimitsConfig | undefined {
  const config = getAgentConfig(name);
  if (!config) return undefined;

  const tokRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxOutputTokens`)).get();
  const stepsRow = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxToolSteps`)).get();

  let defaultMaxOutputTokens = AGENT_MAX_OUTPUT_TOKENS[name] ?? DEFAULT_MAX_OUTPUT_TOKENS;
  let defaultMaxToolSteps = AGENT_MAX_TOOL_STEPS[name] ?? DEFAULT_MAX_TOOL_STEPS;

  if (!isBuiltinAgent(name)) {
    const custom = getCustomAgent(name);
    if (custom?.maxOutputTokens) defaultMaxOutputTokens = custom.maxOutputTokens;
    if (custom?.maxToolSteps) defaultMaxToolSteps = custom.maxToolSteps;
  }

  return {
    name,
    displayName: config.displayName,
    group: config.group,
    maxOutputTokens: tokRow ? Number(tokRow.value) : defaultMaxOutputTokens,
    maxToolSteps: stepsRow ? Number(stepsRow.value) : defaultMaxToolSteps,
    defaultMaxOutputTokens,
    defaultMaxToolSteps,
    isOverridden: !!(tokRow || stepsRow),
  };
}

/** Get limits configs for all agents (built-in + custom). */
export function getAllAgentLimitsConfigs(): AgentLimitsConfig[] {
  const builtIn = AGENT_ROSTER.map((a) => getAgentLimitsConfig(a.name)!);
  const custom = getCustomAgents().map((row) => getAgentLimitsConfig(row.name)!).filter(Boolean);
  return [...builtIn, ...custom];
}

/** Remove limit overrides for an agent (reverts to defaults). */
export function resetAgentLimitsOverrides(name: AgentName): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxOutputTokens`)).run();
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `agent.${name}.maxToolSteps`)).run();
}
