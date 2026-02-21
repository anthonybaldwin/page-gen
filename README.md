# Page Gen.

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live — frontend and backend — with real-time HMR preview.

## Features

- **Multi-agent pipeline** — 14 specialized agents (research, architect, frontend, backend, styling, testing, code review, QA, security) orchestrated automatically
- **Full-stack generation** — Frontend (React + Tailwind) and backend (Hono + SQLite) with working API routes and data persistence
- **Live preview** — Side-by-side HMR preview updates as agents write code, with `/api` proxy for full-stack projects
- **Built-in editor** — CodeMirror editor with syntax highlighting for direct file editing
- **Multi-provider AI** — Anthropic, OpenAI, Google (configurable per-agent)
- **Token tracking & billing** — Real-time cost dashboard with per-agent, daily, and per-project limits
- **Snapshots & rollback** — Version project state and roll back to any previous snapshot
- **Stop & resume** — Interrupt a running pipeline and continue from where it stopped
- **Local-first** — All data in SQLite, API keys encrypted client-side, no cloud dependency
- **Docker support** — Optional containerization for sandboxed execution

See the **[Wiki](https://github.com/anthonybaldwin/page-gen/wiki)** for quick-start instructions, tech stack details, and full documentation.

## Documentation

Full docs live in the **[Wiki](https://github.com/anthonybaldwin/page-gen/wiki)**:

- [Architecture](https://github.com/anthonybaldwin/page-gen/wiki/Architecture) — System overview, agent pipeline, layout
- [Agent Roster](https://github.com/anthonybaldwin/page-gen/wiki/Agent-Roster) — All agents, roles, models, prompts
- [HMR Preview](https://github.com/anthonybaldwin/page-gen/wiki/HMR-Preview) — Live preview, backend servers, proxy
- [Token Billing](https://github.com/anthonybaldwin/page-gen/wiki/Token-Billing) — Usage tracking, cost limits, billing ledger
- [Data Model](https://github.com/anthonybaldwin/page-gen/wiki/Data-Model) — Database schema reference
- [API Reference](https://github.com/anthonybaldwin/page-gen/wiki/API-Reference) — Backend HTTP routes
- [Snapshots](https://github.com/anthonybaldwin/page-gen/wiki/Snapshots) — Versioning and rollback
- [Pipeline Resume](https://github.com/anthonybaldwin/page-gen/wiki/Pipeline-Resume) — Interrupt and continue pipelines
- [Security](https://github.com/anthonybaldwin/page-gen/wiki/Security) — Client-side encryption, sandboxing
- [Docker](https://github.com/anthonybaldwin/page-gen/wiki/Docker) — Containerization, volumes, ports
- [Logging](https://github.com/anthonybaldwin/page-gen/wiki/Logging) — Structured NDJSON logging

## ADRs

Architecture Decision Records in [`docs/adr/`](docs/adr/):

- [001 - Tech Stack](docs/adr/001-tech-stack.md)
- [002 - Agent Architecture](docs/adr/002-agent-architecture.md)
- [003 - Token Accounting & Cost Safety](docs/adr/003-token-accounting-cost-safety.md)
- [004 - Client-Side Security](docs/adr/004-client-side-security.md)
- [005 - Preview Isolation & Docker](docs/adr/005-preview-isolation-docker.md)
