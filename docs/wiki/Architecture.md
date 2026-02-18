# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Sidebar   │  │ Chat/Preview │  │ File Explorer│  │
│  │ (projects │  │ (main panel) │  │ (tree view)  │  │
│  │  + chats) │  │              │  │              │  │
│  └──────────┘  └──────────────┘  └──────────────┘  │
│                     │ HTTP + WS                      │
└─────────────────────┼───────────────────────────────┘
                      │
┌─────────────────────┼───────────────────────────────┐
│                 Hono Backend                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ REST API  │  │ WebSocket    │  │ Agent System │  │
│  │ Routes    │  │ Handler      │  │ + Orchestrator│  │
│  └──────────┘  └──────────────┘  └──────────────┘  │
│        │                                │            │
│  ┌──────────┐              ┌──────────────────┐     │
│  │ SQLite   │              │ AI Providers     │     │
│  │ (Drizzle)│              │ (Anthropic/OAI/G)│     │
│  └──────────┘              └──────────────────┘     │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Per-Project Vite Dev Server (HMR Preview)     │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

## Data Flow

1. User sends a message in the chat UI
2. Message is persisted to SQLite via REST API
3. Backend triggers the orchestrator agent
4. Orchestrator creates an execution plan and dispatches specialized agents
5. Each agent streams thinking/status updates via WebSocket
6. Agents write files to the project directory
7. Vite dev server detects changes and pushes HMR updates
8. Preview iframe re-renders with the new code
9. Token usage is tracked for every AI API call

## Key Decisions

- See [ADR-001: Tech Stack](../adr/001-tech-stack.md)
- API keys stored in browser localStorage, sent per-request via headers
- One Vite dev server per active project for isolated HMR
- All data is local (SQLite), no cloud dependency
