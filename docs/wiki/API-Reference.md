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

**Response:** `Message[]` — ordered by `createdAt` ascending

### POST /messages
Create a new message.

**Body:** `{ chatId: string, role: string, content: string, agentName?: string, metadata?: object }`

**Response (201):** `{ id, chatId, role, content, agentName, metadata, createdAt }`

### POST /messages/send
Atomic message creation + orchestration trigger. Persists the user message and starts (or resumes) the pipeline in one call.

**Body:** `{ chatId: string, content: string, resume?: boolean }`

**Response (201):** `{ message: object, status: "started" }`
**Response (200, resume):** `{ message: object, status: "resumed" }`

## Files

### GET /files/tree/:projectId
Get file tree for a project.

### GET /files/read/:projectId/*
Read a file's content.

### POST /files/write/:projectId
Write file content.

**Body:** `{ path: string, content: string }`

### DELETE /files/delete/:projectId
Delete a file from a project.

**Body:** `{ path: string }`

### GET /files/search/:projectId
Search file contents within a project.

**Query params:**
- `q` — Search query (min 2 characters)
- `maxResults` — Max results to return (default 50, max 100)

**Response:** `Array<{ path: string, line: number, content: string }>`

### POST /files/preview/:projectId
Start (or return existing) preview dev server for a project.

**Response:** `{ url: string }` — the localhost URL of the running Vite dev server.

### DELETE /files/preview/:projectId
Stop the preview dev server for a project.

**Response:** `{ ok: true }`

### GET /files/zip/:projectId
Download a project's files as a ZIP archive.

**Response:** Binary ZIP file (`Content-Type: application/zip`)

## Versions

### GET /versions?projectId={id}
List git version history for a project.

**Response:** `VersionEntry[]` — each includes `sha`, `email`, `message`, `timestamp`, `isUserVersion`

### POST /versions
Create a user version (manual save).

**Body:** `{ projectId: string, label?: string }`

**Response (201):** `{ sha: string, label: string }`
**Response (200, no changes):** `{ sha: null, note: "No changes to save" }`

### POST /versions/:sha/rollback?projectId={id}
Rollback project files to a specific git commit.

**Response:** `{ ok: true, restoredTo: string }`

### GET /versions/:sha/diff?projectId={id}
Get unified diff between a commit and its parent.

**Response:** `{ diff: string, files: [{ path: string, additions: number, deletions: number }] }`

## Usage

### GET /usage/chats
Get distinct chats with usage data (for filter dropdowns).

**Response:** `Array<{ chatId: string, chatTitle: string, projectName: string }>`

### GET /usage?chatId={id}
Get token usage records (from `billing_ledger` table).

### GET /usage/summary
Get aggregate usage summary. Reads from `billing_ledger` for lifetime totals (includes deleted chats/projects).

### GET /usage/by-agent?chatId={id}
Get usage grouped by agent. Optional chatId filter.

### GET /usage/by-model
Get usage grouped by provider and model. Supports optional filters: `projectId`, `chatId`, `from`, `to`.

### GET /usage/by-provider
Get usage grouped by provider.

### GET /usage/by-project
Get lifetime usage grouped by project (from `billing_ledger`).

### GET /usage/history
Get full billing history from `billing_ledger` (never deleted).

**Query params:**
- `projectId` — Filter by project
- `chatId` — Filter by chat
- `from` — Start timestamp (Unix ms)
- `to` — End timestamp (Unix ms)

### DELETE /usage/reset
Clear all billing data. Deletes all rows from both `token_usage` and `billing_ledger` tables.

**Response:** `{ ok: true, deleted: { tokenUsage: number, billingLedger: number } }`

## Settings

### GET /settings
Get server-side settings, including configurable limits from `app_settings`.

**Response:** `{ defaultTokenLimit: number, warningThreshold: number, limits: { maxTokensPerChat, maxAgentCallsPerRun, maxCostPerDay, maxCostPerProject }, limitDefaults: { maxTokensPerChat, maxAgentCallsPerRun, maxCostPerDay, maxCostPerProject } }`

### PUT /settings/limits
Update cost/usage limits. Accepts a partial object — only provided keys are updated.

**Body:** `{ maxTokensPerChat?: number, maxAgentCallsPerRun?: number, maxCostPerDay?: number, maxCostPerProject?: number }`

**Response:** `{ ok: true, limits: { ... }, defaults: { ... } }`

### DELETE /settings/limits
Reset all limits to defaults.

**Response:** `{ ok: true, limits: { ... }, defaults: { ... } }`

### GET /settings/agents
Get all 13 agent configs with DB overrides applied.

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

**Body:** `{ tools: ToolName[] }` — valid values: `"write_file"`, `"write_files"`, `"read_file"`, `"list_files"`, `"save_version"`

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

**Body:** `{ input: number, output: number, provider?: string }` — per 1M tokens (USD), must be non-negative

### DELETE /settings/pricing/:model
Remove pricing override for a model. Known models revert to default pricing; unknown models lose pricing (cost becomes $0).

### GET /settings/models
Get known models grouped by provider with their default pricing.

**Response:** `Array<{ provider: string, models: Array<{ id: string, pricing: { input: number, output: number } | null }> }>`

### GET /settings/cache-multipliers
Get cache token pricing multipliers for all providers (default + overrides).

**Response:** `Array<{ provider: string, create: number, read: number, isOverridden: boolean }>`

### PUT /settings/cache-multipliers/:provider
Override cache multipliers for a provider.

**Body:** `{ create: number, read: number }`

### DELETE /settings/cache-multipliers/:provider
Remove cache multiplier override for a provider, reverting to defaults.

### GET /settings/git
Get git user settings for version commits.

**Response:** `{ name: string, email: string }`

### PUT /settings/git
Update git user settings.

**Body:** `{ name?: string, email?: string }`

**Response:** `{ ok: true, settings: { name: string, email: string } }`

## Agents

### GET /agents/executions?chatId={id}
List agent executions for a chat.

### GET /agents/status?chatId={id}
Check orchestration status and get execution history.

**Response:** `{ running: boolean, executions: Array<{ agentName: string, status: string, output: string | null, error: string | null, startedAt: number }>, interruptedPipelineId: string | null }`

`interruptedPipelineId` is present when a pipeline was interrupted by a server restart and can be resumed.

### POST /agents/run
Trigger orchestration for a chat, or resume an interrupted pipeline.

**Body:** `{ chatId: string, message: string, resume?: boolean }`

- `resume: true` — Look for an interrupted pipeline for this chat and resume from the last completed agent. Falls back to a fresh start if no interrupted pipeline exists.
- `resume: false` or omitted — Start a fresh pipeline from scratch.

**Response (201):** `{ status: "started", chatId }`
**Response (200, resume):** `{ status: "resumed", chatId, pipelineRunId }`

### POST /agents/stop
Stop a running orchestration pipeline.

**Body:** `{ chatId: string }`

## WebSocket

Connect to `ws://localhost:3000/ws` for real-time agent updates.

**Message types:**
- `agent_status` — Agent status change (pending, running, completed, failed, stopped)
- `agent_stream` — Agent output stream (full text after completion)
- `agent_error` — Agent encountered an error. Includes `chatId`, `agentName`, `error` (message string). The orchestrator may include an optional `errorType` field via direct broadcast:
  - `errorType: "cost_limit"` — Token limit reached mid-pipeline. Client shows amber banner with inline settings instead of red error.
  - `errorType: "credit_exhaustion"` — Provider credit/balance exhausted.
  - When `errorType` is absent, the client renders a standard red error banner.
- `chat_message` — New chat message
- `agent_thinking` — Per-agent thinking stream (started, streaming chunk, completed with summary, failed)
- `token_usage` — Real-time token usage update (chatId, agentName, provider, model, tokens, costEstimate)
- `files_changed` — Files written to disk (projectId, files[])
- `test_results` — Final test execution results (chatId, projectId, passed, failed, total, duration, failures[], testDetails[])
  - `testDetails` — Array of per-test results: `{ suite, name, status, error?, duration? }`
- `test_result_incremental` — Individual test result streamed as vitest runs (chatId, projectId, suite, name, status, error?, duration?)
- `pipeline_plan` — Broadcast at pipeline start with the list of agent names to display in the status bar
- `pipeline_interrupted` — Pipeline was interrupted by server restart, can be resumed
- `preview_ready` — Broadcast after a successful build check, triggers preview iframe reload
- `backend_ready` — Backend server started and health check passed (projectId, port)
- `backend_error` — Backend server failed to start or crashed (projectId, error, details)
- `chat_renamed` — Chat title was auto-generated (chatId, title)
