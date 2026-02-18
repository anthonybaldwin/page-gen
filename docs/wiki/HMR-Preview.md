# HMR Live Preview

## Overview

Users see their page update live in the preview as agents write/modify files during a chat session.

## Flow

```
User sends message
  → Orchestrator creates plan
    → Agents write files to /projects/{id}/src/...
      → Vite dev server detects file changes (fs watcher)
        → HMR pushes update to iframe
          → User sees live preview update instantly
```

## Implementation

### Per-Project Vite Dev Server
- Each active project gets its own Vite dev server on a unique port (3001, 3002, ...)
- Server is started lazily when user opens the Preview tab
- The preview iframe points to `localhost:{port}`

### File Change → HMR
- When agents write/modify files via the `file-ops` tool, Vite's built-in file watcher detects the change
- Vite sends HMR updates over WebSocket to the iframe
- The iframe re-renders with updated code — no full page reload needed

### Preview Iframe Security
- iframe uses `sandbox="allow-scripts allow-same-origin allow-forms"`
- No access to parent app's localStorage, cookies, or DOM
- Completely isolated execution environment

### Server Lifecycle
- Servers are started on-demand via `POST /api/files/preview/{projectId}`
- Servers are cleaned up when the project is closed or the app exits
- Port range: 3001+ (incremented per project)

## Troubleshooting

- **Preview shows blank:** Check if the project has an `index.html` at the root
- **HMR not working:** Verify Vite config exists in the project directory
- **Port conflict:** Check if another process is using the assigned port
