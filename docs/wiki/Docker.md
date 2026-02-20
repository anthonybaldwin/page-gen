# Docker

## Overview

Docker is an **optional** deployment method. The app continues to work without Docker via `bun dev` + `bun dev:client`. Users who want sandboxed code execution run `bun dev:docker`.

## Quick Start

```bash
bun dev:docker
```

This runs `docker compose up --build`, which builds the image, starts the container, and maps all necessary ports. Open `http://localhost:3000`.

## Architecture

In Docker mode, the Vite client build is pre-compiled into `dist/client/` during the Docker build stage. The Hono backend serves these static files directly — no separate Vite dev server is needed for the frontend.

Generated project previews still use per-project Vite dev servers on ports 3001-3020.

## Volumes

| Volume | Container path | Purpose |
|--------|---------------|---------|
| `pagegen-data` | `/app/data` | SQLite DB — project records, chat history, billing, settings |
| `pagegen-logs` | `/app/logs` | Structured logs (NDJSON) and LLM I/O logs |
| `pagegen-projects` | `/app/projects` | Generated project files |

Data in these volumes persists across container restarts.

**Not mounted**: `node_modules/` and `dist/` are built inside the container.

## Ports

| Port | Purpose |
|------|---------|
| `3000` | Hono backend (API + static frontend + WebSocket) |
| `3001-3020` | Preview Vite dev servers (one per active project) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PREVIEW_HOST` | `localhost` | Host for Vite preview servers. Set to `0.0.0.0` in Docker so servers are reachable from the host. |
| `LOG_FORMAT` | `text` | Set to `json` for NDJSON stdout (used in Docker for `docker logs` parsing). |
| `LOG_DIR` | `./logs` | Directory for log files. |
| `DB_PATH` | `./data/pagegen.db` | SQLite database path. |
| `PORT` | `3000` | Backend server port. |

## Structured Logging

All log output uses NDJSON format (one JSON object per line) in `logs/app.jsonl`:

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"orchestrator","msg":"Pipeline started","projectId":"abc123"}
{"ts":"2026-02-20T15:30:01.000Z","level":"error","tag":"preview","msg":"Vite server crashed","error":"EADDRINUSE","port":3005}
```

Every line has `ts`, `level`, `tag`, and `msg` fields. Optional fields include `projectId`, `agent`, `error`, `data`, `file`, `chars`, `port`, and `duration`.

LLM prompt/response logs are separate text files in `logs/llm/` (too large for NDJSON lines), with index entries in `app.jsonl` pointing to them.

### Console output

- **Local dev** (`LOG_FORMAT=text`): Human-readable `[tag] message` on stdout
- **Docker** (`LOG_FORMAT=json`): NDJSON on stdout for `docker logs` and log drivers

## Preview Port Pool

Preview servers use a port pool (3001-3020) with automatic recycling. When a preview server stops, its port returns to the pool for reuse. This keeps the port range bounded even with many project starts/stops.

## What Stays the Same

- `bun dev` + `bun dev:client` works exactly as before
- WebSocket URL logic handles same-origin correctly
- CORS allows both `localhost:5173` and `localhost:3000`
- iframe sandbox isolation is preserved (different port = different origin)
- File path validation is unchanged
- Database path is configurable via `DB_PATH` env var
