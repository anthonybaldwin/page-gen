# Page Gen.

A local-first, multi-agent page builder. Describe what you want in natural language, and AI agents build it live with real-time HMR preview.

## Features

- **Chat-based UI** — Describe pages naturally, agents build them
- **10 specialized AI agents + 3 orchestrator subtasks** — Orchestrator, Research, Architect, Frontend Dev, Backend Dev, Styling, Test Planner, QA, Code Review, Security (plus classify, summary, question subtasks)
- **Real-time agent thinking** — Expandable per-agent thinking messages stream in chat as agents work
- **Stop & continue** — Interrupt a running pipeline and resume from where it stopped
- **Live HMR preview** — See changes side-by-side as agents write code
- **Multi-provider AI** — Anthropic, OpenAI, Google (configurable per-agent)
- **Token tracking** — Per-agent, per-provider, per-request usage dashboard with real-time cost updates in sidebar and permanent billing history that survives deletions
- **Local-first** — All data in SQLite, API keys encrypted at rest in localStorage, no cloud dependency
- **Docker support** — Optional containerization for sandboxed code execution
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
bun dev

# In another terminal, start the frontend dev server
bun dev:client
```

Open `http://localhost:5173` in your browser. You'll be prompted to enter API keys on first visit.

### Docker (Optional)

Run everything in a container for sandboxed code execution:

```bash
bun dev:docker
```

Open `http://localhost:3000`. Data, logs, and generated projects persist in Docker volumes.

### Running Tests

```bash
bun test
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun dev` | Start backend (Hono) with watch mode |
| `bun dev:client` | Start frontend (Vite) dev server |
| `bun build` | Build for production |
| `bun test` | Run all tests |
| `bun typecheck` | TypeScript type checking |
| `bun db:generate` | Generate Drizzle migrations |
| `bun dev:docker` | Run in Docker (sandboxed) |

## Architecture

```
React Frontend ←→ Hono Backend ←→ AI Providers
       ↕                ↕
   WebSocket         SQLite
       ↕                ↕
  Live Preview    Agent System
```

- **4-column layout:** Collapsible sidebar (projects/chats) → Chat (fixed width) → Live Preview (flex) → File Explorer
- **Agent pipeline:** Research → Architect → Frontend Dev (parallel instances) → Backend Dev → Styling → Code Review + QA + Security (parallel) → Remediation
- **Orchestrator summary:** Agent outputs are persisted per-agent and the orchestrator synthesizes a single markdown response shown in chat
- **File extraction:** Agents produce code in their output; the orchestrator parses code blocks and writes files to disk automatically
- **HMR preview:** Files extracted from agent output → Vite detects changes → iframe updates live

See [Architecture docs](https://github.com/anthonybaldwin/just-build-it/wiki/Architecture) for full details.

## Documentation

- [Wiki Home](https://github.com/anthonybaldwin/just-build-it/wiki)
- [Architecture](https://github.com/anthonybaldwin/just-build-it/wiki/Architecture)
- [Agent Roster](https://github.com/anthonybaldwin/just-build-it/wiki/Agent-Roster)
- [API Reference](https://github.com/anthonybaldwin/just-build-it/wiki/API-Reference)
- [Data Model](https://github.com/anthonybaldwin/just-build-it/wiki/Data-Model)
- [HMR Preview](https://github.com/anthonybaldwin/just-build-it/wiki/HMR-Preview)
- [Token Billing](https://github.com/anthonybaldwin/just-build-it/wiki/Token-Billing)
- [Snapshots](https://github.com/anthonybaldwin/just-build-it/wiki/Snapshots)
- [Security](https://github.com/anthonybaldwin/just-build-it/wiki/Security)
- [Docker](https://github.com/anthonybaldwin/just-build-it/wiki/Docker)
- [Logging](https://github.com/anthonybaldwin/just-build-it/wiki/Logging)
- [Pipeline Resume](https://github.com/anthonybaldwin/just-build-it/wiki/Pipeline-Resume)

## ADRs

- [001 - Tech Stack](docs/adr/001-tech-stack.md)
- [002 - Agent Architecture](docs/adr/002-agent-architecture.md)
