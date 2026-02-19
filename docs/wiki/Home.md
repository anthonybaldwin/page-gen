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

## Getting Started

```bash
# Install dependencies
bun install

# Start development server (backend)
bun run dev

# Start frontend dev server
bun run dev:client

# Run tests
bun test
```

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono
- **Frontend:** React 19 + Vite 7
- **Database:** Drizzle ORM + SQLite
- **AI:** Vercel AI SDK 6.x
- **UI:** Tailwind CSS + shadcn/ui
- **State:** Zustand
