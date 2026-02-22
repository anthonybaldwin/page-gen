# ADR-008: Visual Pipeline Flow Editor & Custom Tools

## Status

Accepted

## Context

The pipeline flow (agent sequencing, dependencies, conditional routing) was hardcoded in `orchestrator.ts` via `buildExecutionPlan()` and `buildFixPlan()`. Settings already had agents, models, prompts, and per-agent tool toggles — but not the flow itself. The prompts define *what* each agent does; the flow defines *when* and *in what order*. These are fundamentally separate concerns.

With voice models incoming and user interaction checkpoints planned, the flow was about to get more complex. Hardcoding it wouldn't scale.

Additionally, users could edit prompts and toggle built-in tools per agent, but couldn't define their own tools. Custom tools (HTTP endpoints, JavaScript functions, shell commands) are a natural extension of the existing tool system.

## Decision

### Feature 1: Visual Pipeline Flow Editor

**Library**: `@xyflow/react` v12 — purpose-built for DAG editing with drag-and-drop, custom nodes, minimap, zoom/pan.

**Core idea**: Flow templates are stored as JSON in `app_settings`. The orchestrator loads the active template at runtime, resolves any conditions based on intent/scope, and produces an `ExecutionPlan` — same structure it uses today. Hardcoded functions remain as fallback.

Key components:
- **Data model** (`src/shared/flow-types.ts`): `FlowTemplate`, `FlowNode` (agent, condition, checkpoint, post-action), `FlowEdge`
- **Validation** (`src/shared/flow-validation.ts`): DAG acyclicity, reachability, agent name validation, condition expression safety
- **Resolver** (`src/server/agents/flow-resolver.ts`): `resolveFlowTemplate()` — topological sort, condition evaluation, branch pruning, dependency computation
- **Defaults** (`src/server/agents/flow-defaults.ts`): Three default templates that exactly replicate hardcoded behavior (build, fix, question)
- **Storage**: `app_settings` table — `flow.template.{id}` for template data, `flow.active.{intent}` for active bindings
- **API**: CRUD at `/settings/flow/templates`, active bindings at `/settings/flow/active`, validation at `/settings/flow/validate`
- **UI**: New "Pipeline" tab in Settings with React Flow canvas, custom node components, node inspector, toolbar

**Migration strategy**: Orchestrator tries `getActiveFlowTemplate()` first, falls back to `buildExecutionPlan()`/`buildFixPlan()` if no template is active or resolution produces an empty plan.

### Feature 2: Custom User-Defined Tools

**Pattern**: Follows the same widening pattern used for `AgentName` → `string`:
- `ToolName` widened from union to `string`
- `BuiltinToolName` preserves the original union
- `BUILTIN_TOOL_NAMES` const array for type safety

Custom tools are stored in `app_settings` as `custom_tool.{name}` → JSON.

Three implementation types:
- **HTTP**: `fetch()` with URL/body/header interpolation, 30s timeout
- **JavaScript**: `new Function()` sandbox with restricted scope (only `params`, `JSON`, `Math`, `Date`, etc.), 5s timeout
- **Shell**: `Bun.spawn()` with command interpolation, gated behind `pipeline.allowShellTools` setting (disabled by default)

Integration: `createAgentTools()` in `tools.ts` automatically includes enabled custom tools alongside built-in ones. The per-agent tool toggle grid shows both built-in and custom tools.

## Alternatives Considered

1. **Config file instead of DB storage**: Rejected — app_settings KV store is already the pattern for all other settings. No migration needed.
2. **YAML-based flow definitions**: Rejected — less intuitive than visual editing. The canvas gives immediate feedback on DAG structure.
3. **Custom tools via MCP**: Considered for Phase 2 — MCP (Model Context Protocol) servers would allow more sophisticated tool integrations but adds complexity. The three built-in executor types cover the common cases.
4. **Separate database table for flows**: Rejected — app_settings KV store is sufficient. Flow templates are small JSON blobs.

## Consequences

### Positive
- Users can customize pipeline execution flow without code changes
- Custom tools enable arbitrary integrations (APIs, scripts, automation)
- Visual editor makes pipeline structure immediately understandable
- Hardcoded fallback ensures zero-downtime migration
- Same patterns as existing settings (app_settings, per-agent toggles)

### Negative
- `@xyflow/react` adds ~100KB to the client bundle (only loaded in Settings)
- Shell tools require explicit opt-in due to security implications
- JavaScript sandboxing via `new Function()` is not a true security boundary — UI warns users

### Risks
- Flow template resolution adds one DB read per orchestration (negligible vs LLM calls)
- Custom tool execution during pipeline adds latency if tools are slow (mitigated by timeouts)
- Condition expressions use `new Function()` — restricted to safe variables but still user-provided code

## File Map

| File | Purpose |
|------|---------|
| `src/shared/flow-types.ts` | FlowTemplate, FlowNode, FlowEdge types |
| `src/shared/flow-validation.ts` | DAG validation, expression safety |
| `src/shared/custom-tool-types.ts` | CustomToolDefinition types |
| `src/server/agents/flow-resolver.ts` | Template → ExecutionPlan resolution |
| `src/server/agents/flow-defaults.ts` | Default template generation |
| `src/server/tools/custom-tool-executor.ts` | HTTP + JS + Shell executors |
| `src/server/tools/custom-tool-registry.ts` | Custom tool CRUD |
| `src/server/routes/flow.ts` | Flow template API routes |
| `src/client/components/settings/FlowEditorTab.tsx` | Pipeline tab |
| `src/client/components/flow/*.tsx` | Canvas, nodes, inspector, toolbar |
| `src/client/components/settings/CustomTool*.tsx` | Custom tool UI |
