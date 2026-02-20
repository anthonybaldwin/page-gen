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

Optional fields (included when relevant):

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message |
| `data` | object | Structured payload (e.g., truncated log blocks) |
| `agent` | string | Agent name (for LLM/pipeline events) |
| `file` | string | Path to referenced LLM log file |
| `chars` | number | Size of referenced content |

## Tags

| Tag | Source | What it logs |
|-----|--------|-------------|
| `server` | `src/server/index.ts` | Server startup, stale execution cleanup errors |
| `ws` | `src/server/index.ts` | Incoming WebSocket messages |
| `db` | `src/server/db/migrate.ts` | Migration completion |
| `routes` | `src/server/routes/messages.ts`, `agents.ts` | Orchestration trigger errors |
| `preview` | `src/server/preview/vite-server.ts` | Vite server lifecycle, dependency installation, port allocation |
| `orchestrator` | `src/server/agents/orchestrator.ts` | Pipeline execution, agent dispatch, build checks, test runs, file extraction, cost limits, remediation |
| `pipeline` | `src/server/agents/base.ts` | Individual agent calls — model, prompt size, token usage, stream events, cache tokens |
| `extractFiles` | `src/server/agents/orchestrator.ts` | File extraction warnings (malformed blocks, JSON repair, regex fallback) |

## Examples by Tag

### `server`

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"server","msg":"Started on http://localhost:3000"}
{"ts":"2026-02-20T15:30:00.000Z","level":"error","tag":"server","msg":"Failed to clean up stale executions","error":"SQLITE_BUSY"}
```

### `db`

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"db","msg":"Migrations complete"}
```

### `preview`

```json
{"ts":"2026-02-20T15:30:01.000Z","level":"info","tag":"preview","msg":"Installing dependencies in /app/projects/abc123"}
{"ts":"2026-02-20T15:30:05.000Z","level":"info","tag":"preview","msg":"Dependencies installed successfully"}
{"ts":"2026-02-20T15:30:06.000Z","level":"info","tag":"preview","msg":"Server for proj_123 died (exit 1) — restarting"}
{"ts":"2026-02-20T15:30:06.000Z","level":"error","tag":"preview","msg":"Vite server death reason","error":"EADDRINUSE: address already in use"}
{"ts":"2026-02-20T15:30:07.000Z","level":"error","tag":"preview","msg":"bun install failed (exit 1)","error":"error: could not resolve..."}
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
{"ts":"2026-02-20T15:30:36.000Z","level":"info","tag":"orchestrator","msg":"Project abc123 scaffolded for preview (waiting for build check)"}
{"ts":"2026-02-20T15:30:40.000Z","level":"warn","tag":"orchestrator","msg":"Build check timed out after 30s — killing process"}
{"ts":"2026-02-20T15:30:41.000Z","level":"info","tag":"orchestrator","msg":"Build check failed","data":{"block":"error: Module not found...","truncated":true,"totalChars":5200}}
{"ts":"2026-02-20T15:30:45.000Z","level":"info","tag":"orchestrator","msg":"Pre-flight skip: frontend-dev estimated 150,000 tokens would exceed 95% of limit (142,500/150,000)"}
{"ts":"2026-02-20T15:30:50.000Z","level":"info","tag":"orchestrator","msg":"Agent frontend-dev failed after 3 retries. Last error: API rate limit"}
```

### `pipeline`

```json
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev model=claude-sonnet-4-20250514 prompt=12,450chars system=3,200chars tools=2"}
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"prompt total=15,650chars prefix=3,200chars chatHistory=2,100 upstream:architect=8,150"}
{"ts":"2026-02-20T15:30:18.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev step-finish: reason=tool-calls tokens={\"promptTokens\":4200,\"completionTokens\":1800}"}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev response: finishReason=end-turn streamParts=145"}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev completed","data":{"input":4200,"output":1800,"total":6000,"cost":"$0.0420","model":"claude-sonnet-4-20250514"}}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"agent=frontend-dev output","data":{"block":"<tool_call>write_file...","truncated":true,"totalChars":15000}}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"cache tokens step: creation=1200 read=3000"}
{"ts":"2026-02-20T15:30:20.000Z","level":"warn","tag":"pipeline","msg":"agent=frontend-dev truncated (finishReason=length) but 3 files written — accepting"}
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

### LLM Log References

```json
{"ts":"2026-02-20T15:30:15.000Z","level":"info","tag":"pipeline","msg":"LLM input logged","agent":"frontend-dev","file":"llm/2026-02-20T15-30-15-000Z_frontend-dev.in.txt","chars":15650}
{"ts":"2026-02-20T15:30:20.000Z","level":"info","tag":"pipeline","msg":"LLM output logged","agent":"frontend-dev","file":"llm/2026-02-20T15-30-20-000Z_frontend-dev.out.txt","chars":8200}
{"ts":"2026-02-20T15:30:30.000Z","level":"info","tag":"orchestrator","msg":"LLM input logged","agent":"orchestrator-classify","file":"llm/2026-02-20T15-30-30-000Z_orchestrator-classify.in.txt","chars":2400}
{"ts":"2026-02-20T15:30:31.000Z","level":"info","tag":"orchestrator","msg":"LLM output logged","agent":"orchestrator-summary","file":"llm/2026-02-20T15-30-31-000Z_orchestrator-summary.out.txt","chars":1800}
```

## Console Output

Controlled by the `LOG_FORMAT` environment variable:

- **`LOG_FORMAT=text`** (default for local dev): Human-readable `[tag] message` on stdout
- **`LOG_FORMAT=json`** (default in Docker): NDJSON on stdout, parseable by `docker logs`, Grafana Loki, ELK, etc.

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

# Docker logs (when LOG_FORMAT=json)
docker logs pagegen-pagegen-1 | jq 'select(.level == "error")'
```

## Logger API

The logger exports these functions from `src/server/services/logger.ts`:

| Function | Signature | When to use |
|----------|-----------|-------------|
| `log` | `(tag, msg, data?)` | General info events |
| `logError` | `(tag, msg, error?)` | Error events |
| `logWarn` | `(tag, msg)` | Warning events |
| `logBlock` | `(tag, msg, block)` | Large text blocks (auto-truncated to 2000 chars in `data` field) |
| `logLLMInput` | `(tag, agent, system, user)` | Full LLM input to separate file + index entry |
| `logLLMOutput` | `(tag, agent, output)` | Full LLM output to separate file + index entry |
