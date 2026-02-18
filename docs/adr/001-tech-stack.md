# ADR-001: Tech Stack Selection

## Status
Accepted

## Date
2026-02-18

## Context
Building a local-first, multi-agent page builder web app. Need to select a tech stack that supports:
- Fast development iteration with HMR
- Multi-provider AI integration (Anthropic, OpenAI, Google)
- Local SQLite database for data persistence
- Real-time streaming from agents to UI
- Generated project preview with live reload

## Decision

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun | Fastest JS runtime, native SQLite, native TS |
| AI SDK | Vercel AI SDK 6.x | Agent abstraction, multi-provider, streaming |
| Backend | Hono | Lightweight, Bun-native, Web Standard |
| Database | Drizzle ORM + bun:sqlite | Type-safe, zero-dep, fast |
| Frontend | React 19 + Vite 7 | Best HMR, mature ecosystem |
| UI | Tailwind CSS + shadcn/ui | Full code ownership |
| State | Zustand | Minimal React state management |
| Streaming | WebSocket | Real-time agent status |

## Alternatives Considered
- **Express over Hono:** Heavier, not Bun-native
- **Redux over Zustand:** Overkill for our state needs
- **MUI over shadcn/ui:** Black-box components, less control
- **Prisma over Drizzle:** Heavier, worse Bun support
- **Raw API calls over AI SDK:** More boilerplate, no agent abstraction

## Consequences
- Bun is required (not Node.js compatible for SQLite)
- Vite 7 is cutting-edge but stable
- AI SDK 6 provides strong agent primitives
