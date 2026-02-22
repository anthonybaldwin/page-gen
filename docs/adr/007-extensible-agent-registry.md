# ADR-007: Extensible Agent Registry & Category Restrictions

## Status

Accepted

## Date

2026-02-21

## Context

The agent registry (`AGENT_ROSTER` in `registry.ts`) was a hardcoded array of 13 built-in agents. With 71 models now spanning 6 categories (text, code, reasoning, voice, image, realtime), two problems emerged:

1. **No category guardrails.** Users could assign a voice or image model to a text-only agent (e.g., orchestrator) via Settings, causing runtime failures.
2. **No extensibility.** The pipeline builder (ADR-008) needs custom agents created via API, but the registry only knew about the 13 built-in agents. Adding an agent meant editing source code.

## Decision

### Category Restrictions

Each `AgentConfig` gains an `allowedCategories?: string[]` field. When set, only models whose category is in the list can be assigned.

| Agent Group | Agents | Allowed Categories |
|-------------|--------|--------------------|
| Orchestrator subtasks | orchestrator, classify, title, question, summary | `text` |
| Planning | research, architect | `text`, `reasoning` |
| Development | frontend-dev, backend-dev, styling | `text`, `code`, `reasoning` |
| Quality | code-review, qa, security | `text`, `code`, `reasoning` |

Enforcement is both server-side (400 rejection in `PUT /agents/:name`) and client-side (model dropdown filters out disallowed categories). When `allowedCategories` is undefined (custom agents without restrictions), all categories are permitted.

### Extensible Registry

`AgentName` is widened from a union type to `string`. A `BUILTIN_AGENT_NAMES` const array preserves the original 13 names for type-safe checks.

Custom agents are stored in a new `custom_agents` SQLite table (self-contained rows with provider, model, prompt, tools, limits, categories). All registry getters (`getAgentConfig`, `getAllAgentConfigs`, `getAgentTools`, `getAgentLimits`, etc.) merge built-in and custom agents transparently.

Key design choices:

- **Built-in agents** use `app_settings` overlays for overrides (unchanged from before).
- **Custom agents** are self-contained rows — the row IS the source of truth, not an overlay on a hardcoded default. Updates go directly to the `custom_agents` table.
- **System prompts** resolve in order: (1) `app_settings` override, (2) `custom_agents.prompt` column, (3) `.md` file (built-in only), (4) generic fallback.
- **`isBuiltIn` flag** on `ResolvedAgentConfig` lets the UI distinguish custom agents (violet badge, delete button) from built-in ones.

### What Does NOT Change

- The orchestrator's hardcoded pipeline DAG stays as-is. Custom agents are not automatically part of any pipeline — ADR-008's flow editor handles dynamic pipeline composition.
- Token tracking, billing, and cost limits are agent-name-agnostic and work identically for custom agents.
- Prompt `.md` files remain exclusively for built-in agents.

## Alternatives Considered

1. **Keep `AgentName` as a union, add a parallel `CustomAgentName` type.** Rejected — creates two parallel code paths for every registry function instead of one unified path.
2. **Store custom agents in `app_settings` with a naming convention.** Rejected — agents have too many fields (provider, model, prompt, tools, limits, categories) to flatten into key-value pairs cleanly. A dedicated table is simpler.
3. **No category restrictions, just document the incompatibility.** Rejected — voice/realtime models cause hard crashes at runtime. Server-side enforcement is cheap and prevents user confusion.

## Consequences

- Custom agents can be created via `POST /settings/custom-agents` and immediately appear in all Settings tabs (Agents, Prompts, Tools).
- The `custom_agents` table is a new migration — existing databases get it via `CREATE TABLE IF NOT EXISTS`.
- Adding `"custom"` to the `AgentGroup` type required updating `GROUP_LABELS`/`GROUP_ORDER` in three UI components (ModelSettings, PromptEditor, ToolSettings).
- The widened `AgentName = string` type means the compiler no longer catches typos in agent name literals. This is acceptable because agent names are validated at runtime boundaries (API endpoints, registry lookups) and the orchestrator hardcodes its literals as plain strings anyway.
