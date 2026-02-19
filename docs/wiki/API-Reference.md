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
Get server-side settings.

### POST /settings/validate-key
Validate an API key.

**Body:** `{ provider: string }`
**Headers:** `X-Api-Key-{Provider}: <key>`

## Agents

### GET /agents/executions?chatId={id}
List agent executions for a chat.

### GET /agents/status?chatId={id}
Check orchestration status and get execution history.

**Response:** `{ running: boolean, executions: Array<{ agentName: string, status: string }> }`

### POST /agents/run
Trigger orchestration for a chat.

**Body:** `{ chatId: string, message: string }`

### POST /agents/stop
Stop a running orchestration pipeline.

**Body:** `{ chatId: string }`

## WebSocket

Connect to `ws://localhost:3000/ws` for real-time agent updates.

**Message types:**
- `agent_status` — Agent status change (pending, running, completed, failed, stopped)
- `agent_stream` — Agent output stream (full text after completion)
- `agent_complete` — Agent finished execution
- `agent_error` — Agent encountered an error
- `chat_message` — New chat message
- `agent_thinking` — Per-agent thinking stream (started, streaming chunk, completed with summary, failed)
- `token_usage` — Real-time token usage update (chatId, agentName, provider, model, tokens, costEstimate)
- `files_changed` — Files written to disk (projectId, files[])
