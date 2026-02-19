import type { AgentConfig, AgentName } from "../../shared/types.ts";

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
    model: "claude-sonnet-4-6",
    description: "Analyzes user requests, identifies requirements, suggests approaches",
  },
  {
    name: "architect",
    displayName: "Architect Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
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
    name: "code-review",
    displayName: "Code Reviewer",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Reviews code for bugs, type errors, and correctness; fixes issues directly",
  },
  {
    name: "qa",
    displayName: "QA Agent",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    description: "Reviews code, writes tests, checks for issues",
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

export function getModelId(provider: string, model: string): string {
  return model;
}
