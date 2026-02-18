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
5. Each agent runs sequentially; status updates stream via WebSocket (for the pipeline progress bar)
6. Agent outputs are collected internally — not shown to the user
7. Agents write files to the project directory
8. Vite dev server detects changes and pushes HMR updates
9. Preview iframe re-renders with the new code
10. After all agents complete, the orchestrator synthesizes a single markdown summary
11. Only the summary is saved as a chat message and displayed to the user (rendered as markdown)
12. Token usage is tracked for every AI API call, including the summary generation

## Key Decisions

- See [ADR-001: Tech Stack](../adr/001-tech-stack.md)
- API keys stored in browser localStorage, sent per-request via headers
- One Vite dev server per active project for isolated HMR
- All data is local (SQLite), no cloud dependency
