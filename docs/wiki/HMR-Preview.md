# HMR Live Preview

## Overview

Users see their page update live in the preview as agents write/modify files during a chat session.

## Flow

```mermaid
graph TD
  A["User sends message"] --> B["Orchestrator creates plan"]
  B --> C["Agents write files<br>to /projects/{id}/src/..."]
  C --> D["File extraction writes to disk<br>broadcasts files_changed"]
  D --> E["Preview preparation<br>scaffold package.json, vite.config,<br>main.tsx, bun install"]
  E --> F["Vite dev server detects changes<br>(fs watcher)"]
  F --> G["HMR pushes update to iframe"]
  G --> H["User sees live preview<br>update instantly"]
```

## Implementation

### Per-Project Vite Dev Server
- Each active project gets its own Vite dev server on a unique port (3001, 3002, ...)
- Server is started lazily when the preview component mounts (always visible in the side-by-side layout)
- The preview iframe points to `localhost:{port}`

### Auto-Scaffolding

When preview is triggered (by the orchestrator after first file extraction, or when the preview component mounts for an active project), the system ensures:

1. **`package.json`** exists with `react`, `react-dom`, `vite`, `@vitejs/plugin-react`
2. **`vite.config.ts`** includes the React plugin for JSX/TSX transformation
3. **`index.html`** entry point exists pointing to `./src/main.tsx`
4. **`src/main.tsx`** exists as the React entry point (auto-detects App component)
5. **`bun install`** is run to install dependencies into `node_modules`

Agent-generated `package.json` is merged — any deps the agent specifies are preserved, and core React deps are added if missing.

### File Extraction → Preview

After each file-producing agent completes (`frontend-dev`, `backend-dev`, `styling`):
1. Agent text output is parsed for `<tool_call>` write_file calls
2. Files are written to disk via `file-ops.ts`
3. `files_changed` WebSocket event is broadcast
4. After the **first** file-producing agent, `prepareProjectForPreview()` runs in the background (scaffold + install)
5. When prep completes, `preview_ready` WebSocket event is broadcast

### File Change → HMR
- When agents write/modify files via the `file-ops` tool, Vite's built-in file watcher detects the change
- Vite sends HMR updates over WebSocket to the iframe
- The iframe re-renders with updated code — no full page reload needed

### Editor Save → Preview Reload
- User edits a file in the CodeMirror editor (Editor tab) and saves via Ctrl+S or the Save button
- `POST /api/files/write/{projectId}` writes the file to disk and broadcasts `files_changed`
- The `files_changed` event triggers a preview iframe reload (same path as agent writes)
- The file store clears the dirty flag and resets `originalContent` to the saved content
- If the pipeline is running, `files_changed` reloads are gated (same as agent writes)

### Pipeline-Aware Preview Gating

The preview component tracks whether the pipeline is running via `agent_status` WS events:

- **Pipeline running:** `files_changed` events are **ignored** — preview does NOT reload. This prevents showing broken/corrupted state while agents are mid-write and build hasn't passed yet.
- **Pipeline idle:** `files_changed` events reload the preview as a fallback (HMR should handle most cases).
- **`preview_ready` events** always trigger a reload regardless of pipeline state. These are only sent after a successful build check.

This prevents the preview from flashing broken content when agents write files that haven't been build-checked yet.

### Preview Iframe Security
- iframe uses `sandbox="allow-scripts allow-same-origin allow-forms"`
- No access to parent app's localStorage, cookies, or DOM
- Completely isolated execution environment

### Backend Server (Full-Stack Projects)

Projects that include a `server/index.ts` entry point automatically get a backend process alongside Vite:

- **Framework:** Hono on Bun. Entry point: `server/index.ts`. All routes under `/api/`.
- **Port derivation:** `backendPort = frontendPort + 1000` (e.g., Vite on 3005 → backend on 4005).
- **Startup:** The orchestrator starts the backend after a successful build check if `server/index.ts` exists.
- **Health check:** Polls `GET /api/health` every 500ms for up to 10s.
- **Proxy injection:** Once the backend is ready, `enableViteProxy()` rewrites `vite.config.ts` to add an `/api` proxy. Vite auto-restarts with the proxy active.
- **Persistence:** SQLite only via `bun:sqlite`. Data file at `server/data.sqlite` (per-project, zero cross-project conflicts).
- **Frontend-only projects:** No backend spawned, no proxy in Vite config, no changes at all.
- **Error handling:** Backend stderr is streamed to logs in real-time. Crashes broadcast `backend_error` WebSocket events. Health check failures are logged with the last 10 lines of stderr.

### Server Lifecycle
- Vite servers are started on-demand via `POST /api/files/preview/{projectId}`
- Backend servers are started eagerly by the orchestrator after build passes
- `startPreviewServer()` runs full scaffolding before spawning Vite
- Servers are cleaned up when the project is closed or deleted
- Vite port pool: 3001-3020 with automatic reuse. Backend ports: 4001-4020 (derived from frontend port + 1000).
- Port readiness is verified by polling before returning the URL

### Docker Support
- When `PREVIEW_HOST` env var is set (e.g., `0.0.0.0`), Vite binds to that address instead of `localhost`
- URLs returned to the client always use `localhost` (browser connects through Docker port mapping)
- See [Docker](Docker) for full containerization details

### Editor ↔ Agent Conflict Handling

When a file is open in the editor and an agent writes to the same file:

- **Editor is clean (not dirty):** The file store silently re-fetches the new content. The user sees the updated file seamlessly.
- **Editor has unsaved changes:** A conflict banner appears: "File changed externally. [Reload] [Keep mine]". The user decides whether to accept the agent's version or keep their edits.

The editor closes automatically when switching projects, resetting the tab back to Preview.

## Troubleshooting

- **Preview shows blank:** Check if `src/main.tsx` exists and imports the correct App component
- **JSX errors:** Verify `vite.config.ts` includes `@vitejs/plugin-react`
- **Module not found:** Check that `bun install` ran successfully in the project directory
- **HMR not working:** Verify Vite config exists in the project directory
- **Port conflict:** Check if another process is using the assigned port
- **API returns 404:** Check that `server/index.ts` exists and the backend started (look for `backend_ready` or `backend_error` in WS events). Verify `vite.config.ts` has the `/api` proxy block.
- **Backend crashes on start:** Check logs for `[backend]` tag — stderr is streamed in real-time. Common cause: syntax errors in `server/index.ts` or missing `export default`.
- **Health check timeout:** Backend may be starting slowly or not exposing `GET /api/health`. Check that the entry point uses `process.env.PORT`.
