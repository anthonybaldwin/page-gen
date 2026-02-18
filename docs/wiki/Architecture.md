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
5. Each agent runs via `streamText` (Vercel AI SDK); chunks stream in real time
6. Per-agent thinking blocks appear in the chat UI — expandable cards showing live streaming output
7. Pipeline progress bar updates via `agent_status` WebSocket events
8. Agent outputs are collected internally — not shown to the user as separate messages
9. Agents write files to the project directory
10. Vite dev server detects changes and pushes HMR updates
11. Preview iframe re-renders with the new code (Preview tab auto-enables once files exist)
12. After all agents complete, the orchestrator synthesizes a single markdown summary
13. Only the summary is saved as a chat message and displayed to the user (rendered as markdown)
14. Token usage is tracked for every AI API call and broadcast to the client in real time
15. Users can stop a running pipeline at any time; sending a new message resumes from the chat history

## Key Decisions

- See [ADR-001: Tech Stack](../adr/001-tech-stack.md)
- API keys stored in browser localStorage, sent per-request via headers
- One Vite dev server per active project for isolated HMR
- All data is local (SQLite), no cloud dependency
