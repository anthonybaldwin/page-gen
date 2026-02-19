# HMR Live Preview

## Overview

Users see their page update live in the preview as agents write/modify files during a chat session.

## Flow

```
User sends message
  → Orchestrator creates plan
    → Agents write files to /projects/{id}/src/...
      → File extraction writes to disk, broadcasts files_changed
        → Preview preparation: scaffold package.json, vite.config, main.tsx, bun install
          → Vite dev server detects file changes (fs watcher)
            → HMR pushes update to iframe
              → User sees live preview update instantly
```

## Implementation

### Per-Project Vite Dev Server
- Each active project gets its own Vite dev server on a unique port (3001, 3002, ...)
- Server is started lazily when user opens the Preview tab
- The preview iframe points to `localhost:{port}`

### Auto-Scaffolding

When preview is triggered (either by the orchestrator after first file extraction, or when user clicks Preview), the system ensures:

1. **`package.json`** exists with `react`, `react-dom`, `vite`, `@vitejs/plugin-react`
2. **`vite.config.ts`** includes the React plugin for JSX/TSX transformation
3. **`index.html`** entry point exists pointing to `./src/main.tsx`
4. **`src/main.tsx`** exists as the React entry point (auto-detects App component)
5. **`bun install`** is run to install dependencies into `node_modules`

Agent-generated `package.json` is merged — any deps the agent specifies are preserved, and core React deps are added if missing.

### File Extraction → Preview

After each file-producing agent completes (`frontend-dev`, `backend-dev`, `styling`, `qa`, `security`):
1. Agent text output is parsed for `<tool_call>` write_file calls
2. Files are written to disk via `file-ops.ts`
3. `files_changed` WebSocket event is broadcast
4. After the **first** file-producing agent, `prepareProjectForPreview()` runs in the background (scaffold + install)
5. When prep completes, `preview_ready` WebSocket event is broadcast

### File Change → HMR
- When agents write/modify files via the `file-ops` tool, Vite's built-in file watcher detects the change
- Vite sends HMR updates over WebSocket to the iframe
- The iframe re-renders with updated code — no full page reload needed
- As a fallback, the client also listens for `files_changed` WS events and reloads the iframe

### Preview Iframe Security
- iframe uses `sandbox="allow-scripts allow-same-origin allow-forms"`
- No access to parent app's localStorage, cookies, or DOM
- Completely isolated execution environment

### Server Lifecycle
- Servers are started on-demand via `POST /api/files/preview/{projectId}`
- `startPreviewServer()` runs full scaffolding before spawning Vite
- Servers are cleaned up when the project is closed or the app exits
- Port range: 3001+ (incremented per project)
- Port readiness is verified by polling before returning the URL

## Troubleshooting

- **Preview shows blank:** Check if `src/main.tsx` exists and imports the correct App component
- **JSX errors:** Verify `vite.config.ts` includes `@vitejs/plugin-react`
- **Module not found:** Check that `bun install` ran successfully in the project directory
- **HMR not working:** Verify Vite config exists in the project directory
- **Port conflict:** Check if another process is using the assigned port
