# Docker

## Overview

Docker is an **optional** deployment method. The app continues to work without Docker via `bun dev` + `bun dev:client`. Users who want sandboxed code execution run `bun dev:docker`.

## Quick Start

```bash
bun dev:docker
```

This runs `docker compose up --build`, which builds the image, starts the container, and maps all necessary ports. Open `http://localhost:5173` — same as the non-Docker workflow. Full HMR is supported: edit any file on your host and Vite pushes the update to the browser instantly.

## Architecture

The dev Docker setup bind-mounts your project source into the container. Inside the container, two processes run concurrently:

1. **Hono backend** (`bun --watch src/server/index.ts`) on port 3000
2. **Vite dev server** (`bunx vite --host 0.0.0.0`) on port 5173 with HMR

Your source code edits on the host are immediately visible inside the container. Vite's file watcher picks up changes and pushes HMR updates to the browser — the same experience as running locally, but all generated code executes inside the container.

An anonymous volume (`/app/node_modules`) keeps the container's dependencies separate from any host `node_modules/`, avoiding platform mismatches.

### Production build

The Dockerfile also has a `production` target that pre-compiles the frontend into `dist/client/` and serves it as static files. To build for production:

```bash
docker build --target production -t pagegen .
docker run -p 3000:3000 -p 3001-3020:3001-3020 pagegen
```

## Volumes

| Volume | Container path | Purpose |
|--------|---------------|---------|
| Bind mount (`.`) | `/app` | Your project source — live-synced for HMR |
| Anonymous | `/app/node_modules` | Container's deps — isolated from host |
| `pagegen-data` | `/app/data` | SQLite DB — project records, chat history, billing, settings |
| `pagegen-logs` | `/app/logs` | Structured logs (NDJSON) and LLM I/O logs |
| `pagegen-projects` | `/app/projects` | Generated project files |

Named volumes persist across container restarts.

## Ports

| Port | Purpose |
|------|---------|
| `5173` | Vite dev server (frontend + HMR) |
| `3000` | Hono backend (API + WebSocket) |
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
