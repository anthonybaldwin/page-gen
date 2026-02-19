# Just Build It

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live with real-time HMR preview.

## Features

- **Chat-based UI** — Describe pages naturally, agents build them
- **9 specialized AI agents** — Orchestrator, Research, Architect, Frontend Dev, Backend Dev, Styling, QA, Code Review, Security
- **Real-time agent thinking** — Expandable per-agent thinking messages stream in chat as agents work
- **Stop & continue** — Interrupt a running pipeline and resume from where it stopped
- **Live HMR preview** — See changes side-by-side as agents write code
- **Multi-provider AI** — Anthropic, OpenAI, Google (configurable per-agent)
- **Token tracking** — Per-agent, per-provider, per-request usage dashboard with real-time cost updates in sidebar and permanent billing history that survives deletions
- **Snapshots** — Version your project, rollback to any point
- **Local-first** — All data in SQLite, API keys encrypted at rest in localStorage, no cloud dependency

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono |
| Frontend | React 19 + Vite 7 |
| Database | Drizzle ORM + SQLite |
| AI | Vercel AI SDK 6.x |
| UI | Tailwind CSS |
| State | Zustand |
| Streaming | WebSocket |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- At least one AI provider API key (Anthropic, OpenAI, or Google)

### Install & Run

```bash
# Clone the repo
git clone <repo-url>
cd just-build-it

# Install dependencies
bun install

# Start the backend server
bun run dev

# In another terminal, start the frontend dev server
bun run dev:client
```

Open `http://localhost:5173` in your browser. You'll be prompted to enter API keys on first visit.

### Running Tests

```bash
bun test
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start backend (Hono) with watch mode |
| `bun run dev:client` | Start frontend (Vite) dev server |
| `bun run build` | Build for production |
| `bun test` | Run all tests |
| `bun run typecheck` | TypeScript type checking |
| `bun run db:generate` | Generate Drizzle migrations |

## Architecture

```
React Frontend ←→ Hono Backend ←→ AI Providers
       ↕                ↕
   WebSocket         SQLite
       ↕                ↕
  Live Preview    Agent System
```

- **4-column layout:** Collapsible sidebar (projects/chats) → Chat (fixed width) → Live Preview (flex) → File Explorer
- **Agent pipeline:** Research → Architect → Frontend Dev → Styling → QA → Code Review → Security
- **Orchestrator summary:** Agent outputs are persisted per-agent and the orchestrator synthesizes a single markdown response shown in chat
- **File extraction:** Agents produce code in their output; the orchestrator parses code blocks and writes files to disk automatically
- **HMR preview:** Files extracted from agent output → Vite detects changes → iframe updates live

See [Architecture docs](docs/wiki/Architecture.md) for full details.

## Documentation

- [Wiki Home](docs/wiki/Home.md)
- [Architecture](docs/wiki/Architecture.md)
- [Agent Roster](docs/wiki/Agent-Roster.md)
- [API Reference](docs/wiki/API-Reference.md)
- [Data Model](docs/wiki/Data-Model.md)
- [HMR Preview](docs/wiki/HMR-Preview.md)
- [Token Billing](docs/wiki/Token-Billing.md)
- [Snapshots](docs/wiki/Snapshots.md)
- [Security](docs/wiki/Security.md)

## ADRs

- [001 - Tech Stack](docs/adr/001-tech-stack.md)
- [002 - Agent Architecture](docs/adr/002-agent-architecture.md)
