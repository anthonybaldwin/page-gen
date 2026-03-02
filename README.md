# Page Gen.

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live — frontend and backend — with real-time HMR preview.

## Features

- **Multi-agent pipeline** — 13 specialized agents (research, architect, frontend, backend, styling, code review, QA, security) orchestrated automatically
- **Full-stack generation** — Frontend (React + Tailwind) and backend (Hono + SQLite) with working API routes and data persistence
- **Live preview** — Side-by-side HMR preview updates as agents write code, with `/api` proxy for full-stack projects
- **Built-in editor** — CodeMirror editor with syntax highlighting for direct file editing
- **Multi-provider AI** — Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral (configurable per-agent)
- **Token tracking & billing** — Real-time cost dashboard with per-agent, daily, and per-project limits
- **Git versioning & rollback** — Automatic version checkpoints at every pipeline stage, manual saves, visual diffs, and one-click rollback
- **Stop & resume** — Interrupt a running pipeline and continue from where it stopped
- **Local-first** — All data in SQLite, API keys encrypted client-side, no cloud dependency
- **Docker support** — Optional containerization for sandboxed execution

## Quick Start

```bash
# Prerequisites: Bun (https://bun.sh)

# 1. Clone and install
git clone https://github.com/anthonybaldwin/page-gen.git
cd page-gen
bun install

# 2. Start dev server
bun dev          # http://localhost:3000

# 3. Start logs viewer (optional — second terminal, not auto-started by Docker)
bun logs:viewer   # http://localhost:3200

# Or run in Docker (optional — sandboxed code execution)
bun dev:docker
```

Open `http://localhost:3000`, configure an API key in Settings, and describe what you want to build.

## Documentation

Full docs live in the **[Wiki](https://github.com/anthonybaldwin/page-gen/wiki)** (auto-synced from [`docs/wiki/`](docs/wiki/) by a [GitHub Action](.github/workflows/sync-wiki.yml)):

- [Home](https://github.com/anthonybaldwin/page-gen/wiki) — Quick start, tech stack overview
- [Architecture](https://github.com/anthonybaldwin/page-gen/wiki/Architecture) — System overview, agent pipeline, layout
- [Agent Roster](https://github.com/anthonybaldwin/page-gen/wiki/Agent-Roster) — All agents, roles, models, prompts
- [HMR Preview](https://github.com/anthonybaldwin/page-gen/wiki/HMR-Preview) — Live preview, backend servers, proxy
- [Token Billing](https://github.com/anthonybaldwin/page-gen/wiki/Token-Billing) — Usage tracking, cost limits, billing ledger
- [Data Model](https://github.com/anthonybaldwin/page-gen/wiki/Data-Model) — Database schema reference
- [API Reference](https://github.com/anthonybaldwin/page-gen/wiki/API-Reference) — Backend HTTP routes
- [Versioning](https://github.com/anthonybaldwin/page-gen/wiki/Versioning) — Git-based versioning, diffs, and rollback
- [Pipeline Flow Editor](https://github.com/anthonybaldwin/page-gen/wiki/Pipeline-Flow-Editor) — Visual flow editor & custom tools
- [Pipeline Resume](https://github.com/anthonybaldwin/page-gen/wiki/Pipeline-Resume) — Interrupt and continue pipelines
- [Security](https://github.com/anthonybaldwin/page-gen/wiki/Security) — Client-side encryption, sandboxing
- [Docker](https://github.com/anthonybaldwin/page-gen/wiki/Docker) — Containerization, volumes, ports
- [Logging](https://github.com/anthonybaldwin/page-gen/wiki/Logging) — Structured NDJSON logging

## TODO

- [ ] **Go-to-definition** — Ctrl+Click / F12 to jump to where a function/variable is defined across files (only if easy CodeMirror plugin)
- [ ] **Type checking** — Surface TypeScript errors inline in the editor (only if easy CodeMirror plugin)
- [ ] **Git history in editor** — Show file-level git log/blame inline (only if easy plugin, since we already have git)

## ADRs

Architecture Decision Records in [`docs/adr/`](docs/adr/):

- [001 - Tech Stack](docs/adr/001-tech-stack.md)
- [002 - Agent Architecture](docs/adr/002-agent-architecture.md)
- [003 - Token Accounting & Cost Safety](docs/adr/003-token-accounting-cost-safety.md)
- [004 - Client-Side Security](docs/adr/004-client-side-security.md)
- [005 - Preview Isolation & Docker](docs/adr/005-preview-isolation-docker.md)
- [006 - Git-Based Versioning](docs/adr/006-git-versioning.md)
- [007 - Extensible Agent Registry & Category Restrictions](docs/adr/007-extensible-agent-registry.md)
- [008 - Visual Pipeline Flow Editor & Custom Tools](docs/adr/008-flow-editor-custom-tools.md)
