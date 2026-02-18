# Just Build It - Wiki

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live.

## Quick Links

- [Architecture](Architecture.md) - System architecture overview
- [Agent Roster](Agent-Roster.md) - All agents, roles, models, prompts
- [Data Model](Data-Model.md) - Schema reference
- [API Reference](API-Reference.md) - Backend routes
- [HMR Preview](HMR-Preview.md) - How live preview works
- [Token Billing](Token-Billing.md) - Usage tracking and billing
- [Snapshots](Snapshots.md) - Versioning and rollback
- [Security](Security.md) - Security model

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
