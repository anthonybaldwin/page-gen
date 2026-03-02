# Docker

## Overview

Docker is an **optional** deployment method. The app continues to work without Docker via `bun dev`. Users who want sandboxed code execution run `bun dev:docker`.

## Quick Start

```bash
bun dev:docker
```

This runs `docker compose up --build`, which builds the image, starts the container, and maps all necessary ports. Open `http://localhost:3000` — same as the non-Docker workflow. Full HMR is supported: edit any file on your host and Bun pushes the update to the browser instantly.

## Architecture

The dev Docker setup bind-mounts your project source into the container. Inside the container, a single process runs:

1. **Bun.serve()** (`bun --watch src/server/index.ts`) on port 3000 — serves both the backend API and the frontend

Your source code edits on the host are immediately visible inside the container. Bun's file watcher picks up changes and pushes HMR updates to the browser — the same experience as running locally, but all generated code executes inside the container.

The source bind mount is **read-only** (`:ro`). Generated project code running inside the container cannot modify your Page Gen source files or tamper with the backend. Bind mounts for `data/`, `logs/`, and `projects/` override the read-only flag at those paths, so the backend can still write where it needs to.

An anonymous volume (`/app/node_modules`) keeps the container's dependencies separate from any host `node_modules/`, avoiding platform mismatches. When `package.json` changes, run `docker compose down -v && docker compose up --build` to rebuild with fresh dependencies (the `-v` flag removes the stale anonymous volume).

### Production build

The Dockerfile also has a `production` target that pre-compiles the frontend into `dist/client/` and serves it as static files. To build for production:

```bash
docker build --target production -t pagegen .
docker run -p 3000:3000 -p 3001-3020:3001-3020 -p 4001-4020:4001-4020 pagegen
```

## Volumes

| Volume | Container path | Purpose |
|--------|---------------|---------|
| Bind mount (`.`, read-only) | `/app` | Your project source — live-synced for HMR, not writable by container |
| Anonymous | `/app/node_modules` | Container's deps — isolated from host. Requires empty `node_modules/` dir on host as mountpoint. Run `docker compose down -v` when deps change. |
| Bind mount (`./data`) | `/app/data` | SQLite DB — project records, chat history, billing, settings |
| Bind mount (`./logs`) | `/app/logs` | Structured logs (NDJSON) and LLM I/O logs |
| Bind mount (`./projects`) | `/app/projects` | Generated project files — visible on host |

Bind mounts persist data on the host filesystem across container restarts.

## Ports

| Port | Purpose |
|------|---------|
| `3000` | Bun.serve() (API + WebSocket + frontend) |
| `3001-3020` | Preview Bun dev servers (one per active project) |
| `4001-4020` | Preview backend servers (one per full-stack project, derived from frontend port + 1000) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PREVIEW_HOST` | `localhost` | Host for preview servers. Set to `0.0.0.0` in Docker so servers are reachable from the host. |
| `LOG_FORMAT` | `text` | Set to `json` for NDJSON stdout (used in Docker for `docker logs` parsing). |
| `LOG_DIR` | `./logs` | Directory for log files. |
| `DB_PATH` | `./data/app.db` | SQLite database path. |
| `PORT` | `3000` | Backend server port. |

## Structured Logging

All log output uses NDJSON format (one JSON object per line) in `logs/app.jsonl`:

```json
{"ts":"2026-02-20T15:30:00.000Z","level":"info","tag":"orchestrator","msg":"Intent classified","intent":"build","scope":"full"}
{"ts":"2026-02-20T15:30:01.000Z","level":"error","tag":"preview","msg":"Preview server death reason","error":"EADDRINUSE: address already in use"}
```

Every line has `ts`, `level`, `tag`, and `msg` fields. Optional fields include `projectId`, `agent`, `error`, `data`, `file`, `chars`, `ms`, and `elapsed`.

LLM prompt/response logs are separate text files in `logs/llm/` (too large for NDJSON lines), with index entries in `app.jsonl` pointing to them.

### Console output

- **Local dev** (`LOG_FORMAT=text`): Human-readable `[tag] message` on stdout
- **Docker** (`LOG_FORMAT=json`): NDJSON on stdout for `docker logs` and log drivers

## Preview Port Pool

Preview Bun servers use a port pool (3001-3020) with automatic recycling. When a preview server stops, its port returns to the pool for reuse. Full-stack projects also get a backend server on ports 4001-4020 (derived as `frontendPort + 1000`). Both are stopped when a project is deleted or its preview is closed.

## What Stays the Same

- `bun dev` works exactly as before
- WebSocket URL logic handles same-origin correctly
- CORS allows `localhost:3000`
- iframe sandbox isolation is preserved (preview ports = different origin)
- File path validation is unchanged
- Database path is configurable via `DB_PATH` env var
