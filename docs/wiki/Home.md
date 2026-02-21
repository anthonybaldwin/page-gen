# Page Gen. - Wiki

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live.

## Quick Links

- [Architecture](Architecture) - System architecture overview
- [Agent Roster](Agent-Roster) - All agents, roles, models, prompts
- [Data Model](Data-Model) - Schema reference
- [API Reference](API-Reference) - Backend routes
- [HMR Preview](HMR-Preview) - How live preview works
- [Token Billing](Token-Billing) - Usage tracking and billing
- [Snapshots](Snapshots) - Versioning and rollback
- [Pipeline Resume](Pipeline-Resume) - Resume interrupted pipelines
- [Security](Security) - Security model
- [Docker](Docker) - Optional Docker deployment
- [Logging](Logging) - Structured logging reference

## Getting Started

```bash
# Prerequisites: Bun (https://bun.sh)

# 1. Clone and install
git clone https://github.com/anthonybaldwin/page-gen.git
cd page-gen
bun install

# 2. Start dev servers (two terminals)
bun dev          # Backend  → http://localhost:3000
bun dev:client   # Frontend → http://localhost:5173

# 3. Start logs viewer (optional — third terminal, not included in Docker)
bun logs:viewer   # http://localhost:3200

# Or run in Docker (optional — sandboxed code execution)
bun dev:docker
```

Open `http://localhost:5173`, configure an API key in Settings, and describe what you want to build.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono
- **Frontend:** React 19 + Vite 7
- **Database:** Drizzle ORM + SQLite
- **AI:** AI SDK 6.x (Anthropic, OpenAI, Google)
- **UI:** Tailwind CSS + shadcn/ui
- **Editor:** CodeMirror 6 (Nord theme)
- **State:** Zustand
