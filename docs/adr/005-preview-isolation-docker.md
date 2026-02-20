# ADR-005: Preview Isolation & Docker Sandboxing

## Status
Accepted

## Date
2026-02-20

## Context

Agents generate and execute arbitrary code in real time. Users see live previews of generated projects while agents are still writing files. This requires:

- Isolated preview environments per project
- Safe execution of untrusted generated code
- Live HMR updates as agents write files
- Optional full containerization for defense-in-depth

## Decisions

### 1. Per-Project Vite Dev Servers

Each active project gets its own Vite dev server on a unique port:

```mermaid
graph TD
  subgraph Pool["Port Pool (3001–3020)"]
    V1["Vite :3001<br>Project A"]
    V2["Vite :3002<br>Project B"]
    V3["Vite :3003<br>Project C"]
  end

  FE["Preview iframe"] -->|localhost:3001| V1
  Agent["Agent writes file"] -->|fs write| V1
  V1 -->|HMR WebSocket| FE
```

- **Port pool:** 3001–3020 (max 20 concurrent previews). Stopped servers release their port back to the pool.
- **On-demand startup:** Server is spawned lazily when the preview component mounts, via `Bun.spawn(["bunx", "vite", ...])`.
- **Auto-scaffolding:** Before starting Vite, the system ensures `package.json`, `vite.config.ts`, `index.html`, and `src/main.tsx` exist. Agent-specified dependencies are merged, not overwritten.
- **Per-project mutex:** Prevents concurrent `bun install` on the same project directory.
- **Cleanup:** Servers are killed when the project is closed or the app exits.

### 2. Pipeline-Aware Preview Gating

The preview doesn't blindly reload on every file change:

| Event | Pipeline running | Pipeline idle |
|-------|-----------------|---------------|
| `files_changed` | Ignored (agents mid-write) | Reload as fallback |
| `preview_ready` | Always reload | Always reload |

`preview_ready` is only broadcast after a successful `vite build` check. This prevents the preview from flashing broken/partial content while agents are still writing files.

### 3. Hybrid File Extraction (Native Tools + Text Fallback)

Agents write files via two mechanisms:

```mermaid
graph TD
  Agent["Agent output"] --> Native{"Used native<br>write_file tool?"}
  Native -->|Yes| Disk["Files on disk<br>(written mid-stream)"]
  Native -->|No| Fallback["Fallback extraction<br>(regex parse output)"]
  Fallback --> Disk
  Disk --> Vite["Vite HMR detects change"]
```

- **Primary:** AI SDK native `write_file` tool — files hit disk during generation, Vite picks them up immediately.
- **Fallback:** If the model outputs `<tool_call>` XML in text instead of using native tools, `extractAndWriteFiles()` parses and writes them. Files already written natively are skipped (tracked via `alreadyWritten` set).
- **JSON repair:** Common encoding issues (literal `\n`, tabs, BOM) are auto-repaired before falling back to regex extraction.
- **Logging:** Warnings are logged when fallback extraction triggers, indicating a model/prompt issue.

### 4. Docker Containerization (Optional)

For users who want full sandboxing, Docker wraps the entire application:

```mermaid
graph TB
  subgraph Container["Docker Container"]
    App["Hono Backend<br>+ Vite Frontends"]
    Source[".:/app:ro<br>(read-only bind mount)"]
    Data["./data:/app/data<br>(read-write volume)"]
    Projects["./projects:/app/projects<br>(read-write volume)"]
    Logs["./logs:/app/logs<br>(read-write volume)"]
  end

  Browser["Browser"] -->|"3000, 3001-3020, 5173"| Container
```

- **Source is read-only:** Application code is bind-mounted as `:ro`. Generated code cannot modify the app itself.
- **Data isolation:** SQLite database, project files, and logs each get their own writable volume.
- **Network:** Ports 3000 (API), 3001–3020 (preview servers), and 5173 (Vite frontend) are mapped.
- **Vite binding:** `PREVIEW_HOST=0.0.0.0` ensures Vite binds to all interfaces inside the container (browser connects via Docker port mapping).
- **Log format:** `LOG_FORMAT=json` by default in Docker for machine-parseable output.
- **Multi-stage Dockerfile:** `dev` target for development (bind-mounted source), `production` target for deployment (compiled frontend, production deps only).

**Key files:** `src/server/preview/vite-server.ts`, `src/server/agents/orchestrator.ts` (`extractAndWriteFiles`), `Dockerfile`, `docker-compose.yml`

## Alternatives Considered

- **Single shared Vite server for all projects:** Simpler, but requires complex routing, shared bundle cache, and HMR channel multiplexing. Per-project servers are cleaner and truly isolated.
- **Native tools only (no fallback extraction):** Simpler, but models sometimes fail to use tools correctly (output token limits, poor instruction following). The fallback prevents lost work.
- **Always require Docker:** Safer, but adds friction for local dev. Docker is optional for users who want sandboxing but not required for basic use.
- **WebContainers (in-browser execution):** No server needed, but limited to browser APIs. Can't run `bun install` or arbitrary Node.js code.

## Consequences

- Each project is fully isolated — different ports, separate HMR channels, independent dependency installs
- Preview never shows broken state thanks to pipeline-aware gating + build checks
- Hybrid extraction ensures files are captured even when models misbehave
- Docker provides defense-in-depth with read-only source and isolated volumes
- Per-project servers use more memory (~20MB each) but the port pool caps concurrency at 20
- The fallback extraction path adds regex complexity but is well-logged for debugging
