# API Reference

Base URL: `http://localhost:3000/api`

## Health

### GET /health
Returns server status.

**Response:** `{ status: "ok", timestamp: number }`

## Projects

### GET /projects
List all projects.

### GET /projects/:id
Get a single project by ID.

### POST /projects
Create a new project.

**Body:** `{ name: string }`

### PATCH /projects/:id
Rename a project.

**Body:** `{ name: string }`

### DELETE /projects/:id
Delete a project.

## Chats

### GET /chats?projectId={id}
List chats for a project (or all if no projectId).

### GET /chats/:id
Get a single chat by ID.

### POST /chats
Create a new chat.

**Body:** `{ projectId: string, title: string }`

### PATCH /chats/:id
Rename a chat.

**Body:** `{ title: string }`

### DELETE /chats/:id
Delete a chat.

## Messages

### GET /messages?chatId={id}
List messages for a chat. `chatId` is required.

### POST /messages
Create a new message.

**Body:** `{ chatId: string, role: string, content: string, agentName?: string, metadata?: object }`

## Files

### GET /files/tree/:projectId
Get file tree for a project.

### GET /files/read/:projectId/*
Read a file's content.

### POST /files/write/:projectId
Write file content.

**Body:** `{ path: string, content: string }`

## Snapshots

### GET /snapshots?projectId={id}
List snapshots for a project.

### GET /snapshots/:id
Get a single snapshot.

## Usage

### GET /usage?chatId={id}
Get token usage records (operational, from `token_usage` table).

### GET /usage/summary
Get aggregate usage summary. Reads from `billing_ledger` for lifetime totals (includes deleted chats/projects).

### GET /usage/by-agent?chatId={id}
Get usage grouped by agent. Optional chatId filter.

### GET /usage/by-provider
Get usage grouped by provider and model.

### GET /usage/by-project
Get lifetime usage grouped by project (from `billing_ledger`).

### GET /usage/history
Get full billing history from `billing_ledger` (never deleted).

**Query params:**
- `projectId` — Filter by project
- `chatId` — Filter by chat
- `from` — Start timestamp (Unix ms)
- `to` — End timestamp (Unix ms)

## Settings

### GET /settings
Get server-side settings, including configurable limits from `app_settings`.

**Response:** `{ maxSnapshotsPerProject: number, defaultTokenLimit: number, warningThreshold: number, limits: { maxTokensPerChat, maxAgentCallsPerRun, maxCostPerDay, maxCostPerProject } }`

### PUT /settings/limits
Update cost/usage limits. Accepts a partial object — only provided keys are updated.

**Body:** `{ maxTokensPerChat?: number, maxAgentCallsPerRun?: number, maxCostPerDay?: number, maxCostPerProject?: number }`

**Response:** `{ ok: true, limits: { ... } }`

### GET /settings/agents
Get all 10 agent configs with DB overrides applied.

**Response:** `ResolvedAgentConfig[]` — each includes `name`, `displayName`, `provider`, `model`, `description`, `isOverridden`

### PUT /settings/agents/:name
Override an agent's provider and/or model. Rejects unknown models without pricing configured.

**Body:** `{ provider?: string, model?: string }`

**Error (400):** `{ error: "Unknown model requires pricing configuration", requiresPricing: true }` — returned when model has no default or override pricing. Configure pricing via `PUT /settings/pricing/:model` first.

### GET /settings/agents/:name/prompt
Get an agent's system prompt (custom or file default).

**Response:** `{ prompt: string, isCustom: boolean }`

### PUT /settings/agents/:name/prompt
Set a custom system prompt for an agent.

**Body:** `{ prompt: string }`

### DELETE /settings/agents/:name/overrides
Remove all DB overrides for an agent (provider, model, prompt), reverting to defaults.

### GET /settings/agents/tools
Get tool assignments for all agents.

**Response:** `AgentToolConfig[]` — each includes `name`, `displayName`, `tools` (active), `defaultTools`, `isOverridden`, `isReadOnly`

### PUT /settings/agents/:name/tools
Override tool assignments for an agent.

**Body:** `{ tools: ToolName[] }` — valid values: `"write_file"`, `"read_file"`, `"list_files"`

### DELETE /settings/agents/:name/tools
Remove tool override for an agent, reverting to default assignments.

### POST /settings/validate-key
Validate an API key.

**Body:** `{ provider: string }`
**Headers:** `X-Api-Key-{Provider}: <key>`

### GET /settings/pricing
Get all models with effective pricing (defaults merged with DB overrides).

**Response:** `Array<{ model: string, input: number, output: number, isOverridden: boolean, isKnown: boolean }>`

### PUT /settings/pricing/:model
Upsert pricing override for a model. Required for custom/unknown models before they can be assigned to agents.

**Body:** `{ input: number, output: number }` — per 1M tokens (USD), must be non-negative

### DELETE /settings/pricing/:model
Remove pricing override for a model. Known models revert to default pricing; unknown models lose pricing (cost becomes $0).

### GET /settings/models
Get known models grouped by provider with their default pricing.

**Response:** `Array<{ provider: string, models: Array<{ id: string, pricing: { input: number, output: number } | null }> }>`

## Agents

### GET /agents/executions?chatId={id}
List agent executions for a chat.

### GET /agents/status?chatId={id}
Check orchestration status and get execution history.

**Response:** `{ running: boolean, executions: Array<{ agentName: string, status: string }>, interruptedPipelineId: string | null }`

`interruptedPipelineId` is present when a pipeline was interrupted by a server restart and can be resumed.

### POST /agents/run
Trigger orchestration for a chat, or resume an interrupted pipeline.

**Body:** `{ chatId: string, message: string, resume?: boolean }`

- `resume: true` — Look for an interrupted pipeline for this chat and resume from the last completed agent. Falls back to a fresh start if no interrupted pipeline exists.
- `resume: false` or omitted — Start a fresh pipeline from scratch.

### POST /agents/stop
Stop a running orchestration pipeline.

**Body:** `{ chatId: string }`

## WebSocket

Connect to `ws://localhost:3000/ws` for real-time agent updates.

**Message types:**
- `agent_status` — Agent status change (pending, running, completed, failed, stopped)
- `agent_stream` — Agent output stream (full text after completion)
- `agent_complete` — Agent finished execution
- `agent_error` — Agent encountered an error. Payload includes optional `errorType` field:
  - `errorType: "cost_limit"` — Token limit reached mid-pipeline. Client shows amber banner with inline settings instead of red error.
- `chat_message` — New chat message
- `agent_thinking` — Per-agent thinking stream (started, streaming chunk, completed with summary, failed)
- `token_usage` — Real-time token usage update (chatId, agentName, provider, model, tokens, costEstimate)
- `files_changed` — Files written to disk (projectId, files[])
- `test_results` — Final test execution results (chatId, projectId, passed, failed, total, duration, failures[], testDetails[])
  - `testDetails` — Array of per-test results: `{ suite, name, status, error?, duration? }`
- `test_result_incremental` — Individual test result streamed as vitest runs (chatId, projectId, suite, name, status, error?, duration?)
- `pipeline_plan` — Broadcast at pipeline start with the list of agent names to display in the status bar
- `preview_ready` — Broadcast after a successful build check, triggers preview iframe reload
