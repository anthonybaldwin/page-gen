# Logging

## Overview

All server-side logging uses structured NDJSON (newline-delimited JSON). Every log event is a single JSON line written to `logs/app.jsonl`. LLM prompt/response logs are separate text files in `logs/llm/`, referenced by entries in `app.jsonl`.

## Directory Structure

```
logs/
├── app.jsonl          ← All events, one JSON object per line
└── llm/               ← Full LLM prompts/responses
    ├── <ts>_<agent>.in.txt
    └── <ts>_<agent>.out.txt
```

## Log Entry Schema

Every line in `app.jsonl` has these required fields:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `level` | `"info"` \| `"warn"` \| `"error"` | Severity |
| `tag` | string | Source component (see table below) |
| `msg` | string | Human-readable message |

Additional fields are spread to the top level of the JSON object (not nested under a `data` key), with two exceptions: `tokens` (nested object in `pipeline` completion events) and `data` (nested object in `logBlock` output). Any key beyond `ts`, `level`, `tag`, and `msg` is a data field whose presence varies by tag. Common examples:

| Field | Type | Appears in |
|-------|------|------------|
| `error` | string | Error events — the error message |
| `agent` | string | `pipeline`, `billing`, `tool` — agent name |
| `file` | string | `pipeline` — path to referenced LLM log file |
| `chars` | number | `pipeline` — size of referenced content |
| `method` | string | `http` — HTTP method |
| `path` | string | `http` — request path |
| `status` | number | `http`, `llm-http` — HTTP status code |
| `ms` | number | `http` — request duration |
| `bytes` | number | `http` — Content-Length of request body |
| `provider` | string | `llm-http`, `billing` — AI provider name |
| `model` | string | `llm-http`, `billing` — model ID |
| `tool` | string | `tool` — tool name (write_file, read_file, etc.) |
| `inputTokens` | number | `billing` — prompt tokens |
| `outputTokens` | number | `billing` — completion tokens |
| `cost` | number | `billing` — estimated cost in USD |
| `data` | object | `logBlock` output only — `{ block, truncated, totalChars }` |

## Tags

| Tag | Source | What it logs |
|-----|--------|-------------|
| `server` | `src/server/index.ts` | Server startup, shutdown, stale execution cleanup errors |
| `http` | `src/server/index.ts` | All HTTP requests (method, path, status, duration, bytes) |
| `ws` | `src/server/index.ts` | Incoming WebSocket messages |
| `db` | `src/server/db/migrate.ts` | Migration completion |
| `routes` | `src/server/routes/messages.ts`, `agents.ts` | Orchestration trigger errors |
| `user` | `src/server/routes/messages.ts` | User message creation |
| `project` | `src/server/routes/projects.ts` | Project CRUD (create, rename, delete) |
| `chat` | `src/server/routes/chats.ts` | Chat CRUD (create, rename, delete) |
| `settings` | `src/server/routes/settings.ts` | Settings changes (limits, agent overrides, pricing, API key validation) |
| `preview` | `src/server/preview/vite-server.ts`, `backend-server.ts` | Vite and backend server lifecycle, dependency installation, port allocation |
| `backend` | `src/server/preview/backend-server.ts` | Backend server stdout/stderr streams (per-project, real-time) |
| `orchestrator` | `src/server/agents/orchestrator.ts` | Pipeline execution, agent dispatch, cost limits, remediation, intent classification |
| `orchestrator:classify` | `src/server/agents/orchestrator.ts` | Intent classification results (intent, scope, reasoning) |
| `build` | `src/server/agents/orchestrator.ts` | Build check execution (run, pass, fail, timeout) |
| `test` | `src/server/agents/orchestrator.ts` | Test runner execution (run, results, timeout, smart re-run) |
| `snapshot` | `src/server/services/snapshot.ts` | Snapshot create, rollback, pruning |
| `pipeline` | `src/server/agents/base.ts` | Individual agent calls — model, prompt size, token usage, stream events, cache tokens |
| `llm-http` | `src/server/providers/registry.ts` | Outbound LLM API calls (request model/messages/maxTokens, response status/elapsed/requestId/rateLimits/errors) |
| `billing` | `src/server/services/token-tracker.ts`, `cost-limiter.ts`, `src/server/agents/base.ts`, `src/server/routes/usage.ts` | Per-call token counts and cost estimates (actual, provisional, finalized, voided), cost limit warnings, and usage resets |
| `tool` | `src/server/agents/base.ts`, `tools.ts` | Agent tool invocations (write_file, read_file, etc.) and results |
| `extractFiles` | `src/server/agents/orchestrator.ts` | File extraction warnings (malformed blocks, JSON repair, regex fallback) |

## Examples by Tag

### `server`

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"server","msg":"Started on http://localhost:3000"}
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"server","msg":"Shutting down (SIGINT)..."}
{"ts":"2026-02-20T15:30:00.000Z","level":"error","tag":"server","msg":"Failed to clean up stale executions","error":"SQLITE_BUSY"}
```

### `http`

```json
{"ts":"2026-02-20T15:30:00.100Z","level":"info","tag":"http","msg":"GET /api/health 200 2ms","method":"GET","path":"/api/health","status":200,"ms":2}
{"ts":"2026-02-20T15:30:00.200Z","level":"info","tag":"http","msg":"POST /api/messages/send 201 15ms","method":"POST","path":"/api/messages/send","status":201,"ms":15,"bytes":342}
{"ts":"2026-02-20T15:30:00.300Z","level":"warn","tag":"http","msg":"POST /api/agents/run 500 120ms","method":"POST","path":"/api/agents/run","status":500,"ms":120,"bytes":512}
```

### `db`

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"db","msg":"Migrations complete"}
```

### `user`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"user","msg":"New message in chat abc123","chatId":"abc123","messageId":"msg_456","contentLength":85}
```

### `project`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"project","msg":"Created project \"My App\"","projectId":"proj_789"}
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"project","msg":"Renamed project proj_789 to \"My New App\""}
{"ts":"2026-02-20T15:30:03.000Z","level":"info","tag":"project","msg":"Deleted project proj_789","chats":2}
```

### `chat`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"chat","msg":"Created chat \"Build landing page\"","chatId":"chat_abc","projectId":"proj_789"}
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"chat","msg":"Renamed chat chat_abc to \"Build hero section\""}
{"ts":"2026-02-20T15:30:03.000Z","level":"info","tag":"chat","msg":"Deleted chat chat_abc"}
```

### `settings`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"settings","msg":"Limits updated","updated":{"maxTokensPerChat":1000000,"maxCostPerDay":5}}
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"settings","msg":"Agent config overridden: frontend-dev","agent":"frontend-dev","provider":"openai","model":"gpt-5.2"}
{"ts":"2026-02-20T15:30:03.000Z","level":"info","tag":"settings","msg":"Pricing overridden: gpt-5.2","model":"gpt-5.2","input":2.5,"output":10}
{"ts":"2026-02-20T15:30:04.000Z","level":"info","tag":"settings","msg":"API key validated: anthropic"}
{"ts":"2026-02-20T15:30:05.000Z","level":"warn","tag":"settings","msg":"API key validation failed: openai — API authentication failed"}
```

### `preview`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"preview","msg":"Installing dependencies in /app/projects/abc123"}
{"ts":"2026-02-20T15:30:05.000Z","level":"info","tag":"preview","msg":"Dependencies installed successfully"}
{"ts":"2026-02-20T15:30:06.000Z","level":"info","tag":"preview","msg":"Server for proj_123 died (exit 1) — restarting"}
{"ts":"2026-02-20T15:30:06.000Z","level":"error","tag":"preview","msg":"Vite server death reason","error":"EADDRINUSE: address already in use"}
{"ts":"2026-02-20T15:30:07.000Z","level":"error","tag":"preview","msg":"bun install failed (exit 1)","error":"error: could not resolve..."}
```

### `backend`

```json
{"ts":"2026-02-20T15:30:10.000Z","level":"info","tag":"backend","msg":"[proj_123] Listening on port 4005"}
{"ts":"2026-02-20T15:30:10.000Z","level":"error","tag":"backend","msg":"[proj_123] TypeError: Cannot read properties of undefined (reading 'id')"}
```

### `orchestrator`

```json
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"orchestrator","msg":"Intent: build (scope: full) — User wants a landing page"}
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"orchestrator","msg":"Running research agent"}
{"ts":"2026-02-20T15:30:10.000Z","level":"info","tag":"orchestrator","msg":"Running architect agent"}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"orchestrator","msg":"Running batch of 3 step(s): frontend-dev, backend-dev, styling [PARALLEL]"}
{"ts":"2026-02-20T15:30:30.000Z","level":"info","tag":"orchestrator","msg":"Running build check in /app/projects/abc123..."}
{"ts":"2026-02-20T15:30:32.000Z","level":"info","tag":"orchestrator","msg":"Build check passed"}
{"ts":"2026-02-20T15:30:32.000Z","level":"info","tag":"orchestrator","msg":"Running tests in /app/projects/abc123..."}
{"ts":"2026-02-20T15:30:35.000Z","level":"info","tag":"orchestrator","msg":"Tests: 5/5 passed, 0 failed"}
{"ts":"2026-02-20T15:30:40.000Z","level":"warn","tag":"orchestrator","msg":"Build check timed out after 30s — killing process"}
{"ts":"2026-02-20T15:30:41.000Z","level":"info","tag":"orchestrator","msg":"Build check failed","data":{"block":"error: Module not found...","truncated":true,"totalChars":5200}}
{"ts":"2026-02-20T15:30:45.000Z","level":"info","tag":"orchestrator","msg":"Pre-flight skip: frontend-dev estimated 150,000 tokens would exceed 95% of limit (142,500/150,000)"}
{"ts":"2026-02-20T15:30:50.000Z","level":"info","tag":"orchestrator","msg":"Agent frontend-dev failed after 3 retries. Last error: API rate limit"}
```

### `pipeline`

```json
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev starting","agent":"frontend-dev","model":"claude-sonnet-4-20250514","promptChars":12450,"systemChars":3200,"toolCount":2}
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"prompt size breakdown","totalChars":15650,"prefixChars":3200,"chatHistory":2100,"upstream:architect":8150}
{"ts":"2026-02-20T15:30:18.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev step-finish","agent":"frontend-dev","finishReason":"tool-calls","inputTokens":4200,"outputTokens":1800}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev response","agent":"frontend-dev","finishReason":"end-turn","status":200,"streamPartCount":145}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev completed","outputChars":8200,"filesWritten":3,"tokens":{"input":4200,"output":1800,"cacheCreate":1200,"cacheRead":3000,"total":6000}}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev output","data":{"block":"<tool_call>write_file...","truncated":true,"totalChars":15000}}
{"ts":"2026-02-20T15:30:20.000Z","level":"warn","tag":"pipeline","msg":"agent=frontend-dev truncated (finishReason=length) but 3 files written — accepting"}
```

### `llm-http`

```json
{"ts":"2026-02-20T15:30:14.000Z","level":"info","tag":"llm-http","msg":"→ POST anthropic","method":"POST","url":"https://api.anthropic.com/v1/messages","provider":"anthropic","model":"claude-sonnet-4-20250514","messages":3,"maxTokens":8192,"stream":true}
{"ts":"2026-02-20T15:30:18.000Z","level":"info","tag":"llm-http","msg":"← 200 anthropic","status":200,"provider":"anthropic","elapsed":3800,"requestId":"req_abc123","reqRemaining":"95","tokRemaining":"80000"}
{"ts":"2026-02-20T15:30:18.000Z","level":"warn","tag":"llm-http","msg":"← 429 anthropic","status":429,"provider":"anthropic","elapsed":120,"requestId":"req_def456","retryAfter":"30","reqRemaining":"0","body":"{\"error\":{\"type\":\"rate_limit_error\",...}}"}
{"ts":"2026-02-20T15:30:18.000Z","level":"warn","tag":"llm-http","msg":"anthropic tool_use.input is invalid JSON — model likely hit output token limit","provider":"anthropic","tool":"write_file","inputChars":4500}
```

### `billing`

```json
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"billing","msg":"frontend-dev usage: claude-sonnet-4-20250514","agent":"frontend-dev","provider":"anthropic","model":"claude-sonnet-4-20250514","inputTokens":4200,"outputTokens":1800,"cacheCreate":1200,"cacheRead":3000,"cost":0.042}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"billing","msg":"frontend-dev provisional: claude-sonnet-4-20250514 ~6000 tokens ~$0.0420","agent":"frontend-dev","provider":"anthropic","model":"claude-sonnet-4-20250514","estimatedTokens":6000,"estimatedCost":0.042}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"billing","msg":"Finalized: claude-sonnet-4-20250514 6000 tokens $0.0420","provider":"anthropic","model":"claude-sonnet-4-20250514","inputTokens":4200,"outputTokens":1800,"cacheCreate":1200,"cacheRead":3000,"totalTokens":6000,"cost":0.042}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"billing","msg":"Provisional voided","tokenUsageId":"tok_abc","billingLedgerId":"bill_def"}
```

### `tool`

```json
{"ts":"2026-02-20T15:30:16.000Z","level":"info","tag":"tool","msg":"frontend-dev called write_file","tool":"write_file","path":"src/App.tsx"}
{"ts":"2026-02-20T15:30:16.000Z","level":"info","tag":"tool","msg":"frontend-dev called read_file","tool":"read_file","input":"{\"path\":\"src/App.tsx\"}"}
{"ts":"2026-02-20T15:30:17.000Z","level":"info","tag":"tool","msg":"frontend-dev tool result: write_file","tool":"write_file","success":true}
```

### `routes`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"error","tag":"routes","msg":"Orchestration error","error":"No API keys provided"}
{"ts":"2026-02-20T15:30:01.000Z","level":"error","tag":"routes","msg":"Resume orchestration error","error":"Pipeline not found"}
```

### `extractFiles`

```json
{"ts":"2026-02-20T15:30:25.000Z","level":"warn","tag":"extractFiles","msg":"Rejected malformed tool_call block (strict mode)"}
{"ts":"2026-02-20T15:30:25.000Z","level":"warn","tag":"extractFiles","msg":"JSON repaired for src/App.tsx"}
{"ts":"2026-02-20T15:30:25.000Z","level":"warn","tag":"extractFiles","msg":"Regex fallback used for src/App.tsx (58 chars)"}
```

### `build`

```json
{"ts":"2026-02-20T15:30:30.000Z","level":"info","tag":"build","msg":"Running build check","path":"/app/projects/abc123"}
{"ts":"2026-02-20T15:30:32.000Z","level":"info","tag":"build","msg":"Build check passed"}
{"ts":"2026-02-20T15:30:32.000Z","level":"info","tag":"build","msg":"Build failed","exitCode":1,"errorLines":3,"chars":450}
{"ts":"2026-02-20T15:30:40.000Z","level":"warn","tag":"build","msg":"Build check timed out after 30s — killing process"}
```

### `test`

```json
{"ts":"2026-02-20T15:30:32.000Z","level":"info","tag":"test","msg":"Running tests","path":"/app/projects/abc123"}
{"ts":"2026-02-20T15:30:35.000Z","level":"info","tag":"test","msg":"Test run completed","passed":5,"failed":0,"total":5}
{"ts":"2026-02-20T15:30:60.000Z","level":"warn","tag":"test","msg":"Test run timed out after 60s — killing process"}
```

### `snapshot`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"snapshot","msg":"Created snapshot \"v1\"","snapshotId":"snap_abc","projectId":"proj_789","files":5}
{"ts":"2026-02-20T15:30:02.000Z","level":"info","tag":"snapshot","msg":"Rolled back to snapshot snap_abc","projectId":"proj_789","files":5}
{"ts":"2026-02-20T15:30:03.000Z","level":"info","tag":"snapshot","msg":"Pruned 3 old snapshots","projectId":"proj_789","pruned":3}
```

### LLM Log References

```json
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"LLM input logged","agent":"frontend-dev","file":"llm/2026-02-20T15-30-15-000Z_frontend-dev.in.txt","chars":15650}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"LLM output logged","agent":"frontend-dev","file":"llm/2026-02-20T15-30-20-000Z_frontend-dev.out.txt","chars":8200}
{"ts":"2026-02-20T15:30:30.000Z","level":"info","tag":"orchestrator","msg":"LLM input logged","agent":"orchestrator-classify","file":"llm/2026-02-20T15-30-30-000Z_orchestrator-classify.in.txt","chars":2400}
{"ts":"2026-02-20T15:30:31.000Z","level":"info","tag":"orchestrator","msg":"LLM output logged","agent":"orchestrator-summary","file":"llm/2026-02-20T15-30-31-000Z_orchestrator-summary.out.txt","chars":1800}
```

## Log Viewer

A built-in web UI for browsing logs is available at `scripts/logs-viewer.ts`.

```bash
bun --hot scripts/logs-viewer.ts
```

Opens at `http://localhost:3200` (configurable via `LOGS_PORT` env var). Features:

- **Filter** by level, tag, date range, and free-text search
- **Sort** newest-first or oldest-first
- **Tail** mode — auto-scrolls to newest entries, polls every 2 seconds
- **Expand** extra fields inline (click `+data` to toggle)
- **Highlight** rows by clicking — marked rows persist across re-renders
- **Keyboard shortcuts** — `j` / `k` to jump between highlighted rows

The viewer reads `logs/app.jsonl` directly and serves a single-page app with no dependencies.

## Console Output

Controlled by the `LOG_FORMAT` environment variable:

- **`LOG_FORMAT=text`** (default for local dev): Human-readable `[tag] message` on stdout
- **`LOG_FORMAT=json`** (set by `docker-compose.yml` for Docker): NDJSON on stdout, parseable by `docker logs`, Grafana Loki, ELK, etc.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_DIR` | `./logs` (relative to project root) | Directory for `app.jsonl` and `llm/` subdirectory |
| `LOG_FORMAT` | `text` | Console output format: `text` for human-readable, `json` for NDJSON |

## Querying Logs

```bash
# View all events
cat logs/app.jsonl | jq .

# Filter by tag
cat logs/app.jsonl | jq 'select(.tag == "orchestrator")'

# Filter errors only
cat logs/app.jsonl | jq 'select(.level == "error")'

# Find LLM logs for a specific agent
cat logs/app.jsonl | jq 'select(.agent == "frontend-dev" and .file)'

# Show HTTP requests slower than 100ms
cat logs/app.jsonl | jq 'select(.tag == "http" and .ms > 100)'

# Show LLM API errors
cat logs/app.jsonl | jq 'select(.tag == "llm-http" and .level == "warn")'

# Docker logs (when LOG_FORMAT=json)
docker logs pagegen-pagegen-1 | jq 'select(.level == "error")'
```

## Logger API

The logger exports these functions from `src/server/services/logger.ts`:

| Function | Signature | When to use |
|----------|-----------|-------------|
| `log` | `(tag, msg, data?)` | General info events — `data` fields are spread to top level |
| `logWarn` | `(tag, msg, data?)` | Warning events — `data` fields are spread to top level |
| `logError` | `(tag, msg, error?, data?)` | Error events — `error` is coerced to string, `data` fields are spread to top level |
| `logBlock` | `(tag, msg, block)` | Large text blocks (auto-truncated to 2000 chars in nested `data` field) |
| `logLLMInput` | `(tag, agent, system, user)` | Full LLM input to separate file + index entry |
| `logLLMOutput` | `(tag, agent, output)` | Full LLM output to separate file + index entry |
