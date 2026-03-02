import { existsSync } from "fs";
import { join } from "path";
import { log, logError } from "../services/logger.ts";
import { enableBunProxy } from "./preview-server.ts";
import { broadcast } from "../ws.ts";
import {
  BACKEND_PORT_OFFSET,
  BACKEND_HEALTH_TIMEOUT,
  BACKEND_READY_POLL,
  BACKEND_SHUTDOWN_DEADLINE,
  BACKEND_SHUTDOWN_POLL,
  BACKEND_ENTRY_PATH,
  DEFAULT_PREVIEW_HOST,
} from "../config/preview.ts";

interface BackendEntry {
  port: number;
  projectId: string;
  process: ReturnType<typeof Bun.spawn>;
  stderrChunks: string[];
}

const activeBackends = new Map<string, BackendEntry>();

/**
 * Check whether a project has a backend entry point on disk.
 */
export function projectHasBackend(projectPath: string): boolean {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);
  return existsSync(join(fullPath, BACKEND_ENTRY_PATH));
}

/**
 * Get the backend port for a running project, or null if not running.
 */
export function getBackendPort(projectId: string): number | null {
  return activeBackends.get(projectId)?.port ?? null;
}

/**
 * Drain a ReadableStream line-by-line, calling `onLine` for each line.
 * Non-blocking — runs in the background.
 */
function drainStream(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) onLine(line);
        }
      }
      // Flush remaining buffer
      if (buffer.trim()) onLine(buffer);
    } catch {
      // Stream closed — expected on process kill
    }
  })();
}

/**
 * Start a backend server for a project. Spawns `bun run server/index.ts` with
 * the PORT env var set, polls /api/health until ready, then injects a
 * proxy config so the frontend can reach /api/* routes.
 */
export async function startBackendServer(
  projectId: string,
  projectPath: string,
  frontendPort: number,
): Promise<{ port: number; ready: boolean }> {
  // Already running — return existing
  const existing = activeBackends.get(projectId);
  if (existing) {
    if (existing.process.exitCode !== null) {
      log("preview", `Backend for ${projectId} died (exit ${existing.process.exitCode}) — restarting`);
      activeBackends.delete(projectId);
    } else {
      return { port: existing.port, ready: true };
    }
  }

  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  const entryPoint = join(fullPath, BACKEND_ENTRY_PATH);
  if (!existsSync(entryPoint)) {
    throw new Error(`No backend entry point at ${entryPoint}`);
  }

  const port = frontendPort + BACKEND_PORT_OFFSET;
  const host = process.env.PREVIEW_HOST || DEFAULT_PREVIEW_HOST;

  log("preview", `Starting backend server for ${projectId} on port ${port}`);

  const proc = Bun.spawn(["bun", "run", entryPoint], {
    cwd: fullPath,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
    },
  });

  const entry: BackendEntry = { port, projectId, process: proc, stderrChunks: [] };
  activeBackends.set(projectId, entry);

  // Stream stderr for real-time logging — capture last N lines for crash diagnostics
  const MAX_STDERR_LINES = 50;
  drainStream(proc.stderr as ReadableStream<Uint8Array>, (line) => {
    entry.stderrChunks.push(line);
    if (entry.stderrChunks.length > MAX_STDERR_LINES) entry.stderrChunks.shift();
    logError("backend", `[${projectId}] ${line}`);
  });

  // Stream stdout for logging (backend may log useful info)
  drainStream(proc.stdout as ReadableStream<Uint8Array>, (line) => {
    log("backend", `[${projectId}] ${line}`);
  });

  // Auto-cleanup on unexpected exit — broadcast error so client sees it
  proc.exited.then((code: number | null) => {
    if (activeBackends.get(projectId)?.process === proc) {
      const reason = entry.stderrChunks.slice(-10).join("\n") || "unknown";
      log("preview", `Backend server for ${projectId} exited (code ${code}) — removing`);
      if (code !== 0 && code !== null) {
        logError("preview", `Backend server crash for ${projectId}`, reason);
        broadcast({
          type: "backend_error",
          payload: {
            projectId,
            error: `Backend server crashed (exit code ${code})`,
            details: reason,
          },
        });
      }
      activeBackends.delete(projectId);
    }
  });

  // Poll /api/health until ready
  const startTime = Date.now();
  const healthTimeout = 10_000;
  let ready = false;

  while (Date.now() - startTime < healthTimeout) {
    // If process already exited, capture stderr and bail
    if (proc.exitCode !== null) {
      const reason = entry.stderrChunks.slice(-10).join("\n") || "no output";
      logError("preview", `Backend process for ${projectId} exited (code ${proc.exitCode}) before becoming ready:\n${reason}`);
      broadcast({
        type: "backend_error",
        payload: {
          projectId,
          error: `Backend server failed to start (exit code ${proc.exitCode})`,
          details: reason,
        },
      });
      break;
    }
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(BACKEND_HEALTH_TIMEOUT),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, BACKEND_READY_POLL));
  }

  if (ready) {
    log("preview", `Backend server for ${projectId} ready on port ${port}`);
    // Inject proxy so frontend /api/* requests reach the backend
    enableBunProxy(fullPath, port);
    broadcast({
      type: "backend_ready",
      payload: { projectId, port },
    });
  } else if (proc.exitCode === null) {
    // Process is still running but health check timed out
    const reason = entry.stderrChunks.slice(-10).join("\n") || "no output";
    logError("preview", `Backend server for ${projectId} failed to become ready within ${healthTimeout}ms:\n${reason}`);
    broadcast({
      type: "backend_error",
      payload: {
        projectId,
        error: `Backend server started but health check timed out after ${healthTimeout}ms`,
        details: reason,
      },
    });
  }

  return { port, ready };
}

/**
 * Stop the backend server for a project. Kills the entire process tree.
 */
export async function stopBackendServer(projectId: string): Promise<void> {
  const entry = activeBackends.get(projectId);
  if (!entry) return;

  const { process: proc } = entry;
  activeBackends.delete(projectId);

  // Kill the entire process tree (mirrors preview-server.ts)
  if (process.platform === "win32" && proc.pid) {
    try {
      Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      proc.kill();
    }
  } else if (proc.pid) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill();
    }
  } else {
    proc.kill();
  }

  // Wait for exit
  const deadline = Date.now() + BACKEND_SHUTDOWN_DEADLINE;
  while (proc.exitCode === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, BACKEND_SHUTDOWN_POLL));
  }
  if (proc.exitCode === null) {
    log("preview", `Backend for ${projectId} didn't exit in ${BACKEND_SHUTDOWN_DEADLINE}ms — force-killing`);
    if (process.platform !== "win32" && proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL"); } catch { /* already dead */ }
    } else {
      proc.kill(9);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  log("preview", `Stopped backend server for ${projectId}`);
}

/**
 * Stop all running backend servers (cleanup on shutdown).
 */
export async function stopAllBackendServers(): Promise<void> {
  await Promise.all([...activeBackends.keys()].map((id) => stopBackendServer(id)));
}
