import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { log, logError } from "../services/logger.ts";
import { broadcastAgentThinking } from "../ws.ts";
import {
  PREVIEW_PORT_MIN,
  PREVIEW_PORT_MAX,
  PREVIEW_READY_TIMEOUT,
  PREVIEW_FETCH_TIMEOUT,
  PREVIEW_READY_POLL_INTERVAL,
  PREVIEW_SHUTDOWN_DEADLINE,
  PREVIEW_SHUTDOWN_POLL,
  DEFAULT_PREVIEW_HOST,
  TAILWIND_CONFLICT_FILES,
} from "../config/preview.ts";
import { STDERR_TRUNCATION } from "../config/logging.ts";

// Read versions from our own package.json so Dependabot keeps them current
const OUR_PKG = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf-8"));
const OUR_DEPS: Record<string, string> = { ...OUR_PKG.dependencies, ...OUR_PKG.devDependencies };

const activeServers = new Map<string, { port: number; process: ReturnType<typeof Bun.spawn> }>();
// Per-project stop mutex — prevents a POST (start) from racing with an in-progress DELETE (stop)
const pendingStops = new Map<string, Promise<void>>();

// --- Port pool ---

const availablePorts: number[] = [];
let nextPort = PREVIEW_PORT_MIN;

function allocatePort(): number {
  if (availablePorts.length > 0) return availablePorts.shift()!;
  if (nextPort > PREVIEW_PORT_MAX) throw new Error(`Preview port range exhausted (${PREVIEW_PORT_MIN}-${PREVIEW_PORT_MAX})`);
  return nextPort++;
}

function releasePort(port: number) {
  if (port >= PREVIEW_PORT_MIN && port <= PREVIEW_PORT_MAX) availablePorts.push(port);
}

// Track which projects have had deps installed to avoid re-running
const installedProjects = new Set<string>();
// Per-project install mutex — prevents concurrent bun install on the same directory
const pendingInstalls = new Map<string, Promise<string | null>>();

function ensureProjectHasBunfig(projectPath: string) {
  const configPath = join(projectPath, "bunfig.toml");

  // Only write if missing — rewriting could disrupt the running dev server
  if (existsSync(configPath)) return;

  const config = `[serve.static]
plugins = ["bun-plugin-tailwind"]

[test]
preload = ["./src/test-setup.ts"]
`;
  writeFileSync(configPath, config, "utf-8");
}

function ensureProjectHasIndexHtml(projectPath: string) {
  const indexPath = join(projectPath, "index.html");
  if (existsSync(indexPath)) return;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>`;

  writeFileSync(indexPath, html, "utf-8");
}

/** Convert a human-readable project name into a valid npm package name. */
function toPackageName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")       // spaces → dashes
    .replace(/[^a-z0-9._-]/g, "") // strip invalid chars
    .replace(/^[._-]+/, "")     // no leading dots/dashes/underscores
    || "project";               // fallback if nothing left
}

function ensureProjectHasPackageJson(projectPath: string, projectName?: string) {
  const pkgPath = join(projectPath, "package.json");

  // Merge with any agent-generated package.json
  let existing: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    try {
      existing = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch {
      // corrupt — overwrite
    }
  }

  const deps = (existing.dependencies || {}) as Record<string, string>;
  const devDeps = (existing.devDependencies || {}) as Record<string, string>;

  // Inherit versions from our own package.json (Dependabot keeps them current)
  if (!deps.react) deps.react = OUR_DEPS.react || "^19.2.0";
  if (!deps["react-dom"]) deps["react-dom"] = OUR_DEPS["react-dom"] || "^19.2.0";
  if (!deps.hono) deps.hono = OUR_DEPS.hono || "^4.11.0";
  if (!deps.zod) deps.zod = OUR_DEPS.zod || "^4.3.0";

  if (!devDeps["bun-plugin-tailwind"]) devDeps["bun-plugin-tailwind"] = OUR_DEPS["bun-plugin-tailwind"] || "^0.1.0";
  if (!devDeps.tailwindcss) devDeps.tailwindcss = OUR_DEPS.tailwindcss || "^4.2.0";
  if (!devDeps["@types/bun"]) devDeps["@types/bun"] = OUR_DEPS["@types/bun"] || "^1.3.9";
  if (!devDeps["@types/react"]) devDeps["@types/react"] = OUR_DEPS["@types/react"] || "^19.2.0";
  if (!devDeps["@types/react-dom"]) devDeps["@types/react-dom"] = OUR_DEPS["@types/react-dom"] || "^19.2.0";
  // Testing deps
  if (!devDeps["happy-dom"]) devDeps["happy-dom"] = "^20.0.0";
  if (!devDeps["@testing-library/react"]) devDeps["@testing-library/react"] = "^16.3.0";
  if (!devDeps["@testing-library/user-event"]) devDeps["@testing-library/user-event"] = "^14.0.0";
  if (!devDeps["@testing-library/jest-dom"]) devDeps["@testing-library/jest-dom"] = "^6.6.0";

  // Remove stale Vite-era deps if agents inherited them
  delete devDeps.vite;
  delete devDeps["@vitejs/plugin-react"];
  delete devDeps["@tailwindcss/vite"];
  delete devDeps.vitest;

  const pkg = {
    name: (existing.name as string) || (projectName ? toPackageName(projectName) : "preview-project"),
    private: true,
    type: "module",
    ...existing,
    dependencies: deps,
    devDependencies: devDeps,
  };

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
}

/**
 * Ensure src/main.tsx exists as the app entry point.
 * If agents wrote an App.tsx or similar, import from it.
 */
function ensureProjectHasMainEntry(projectPath: string) {
  const mainPath = join(projectPath, "src", "main.tsx");
  if (existsSync(mainPath)) return;

  mkdirSync(join(projectPath, "src"), { recursive: true });

  // Look for the root component the agents likely created
  const srcDir = join(projectPath, "src");
  let appImport = "./App";

  if (existsSync(srcDir)) {
    const files = readdirSync(srcDir);
    // Prefer App.tsx, then index.tsx, then any .tsx file
    if (files.includes("App.tsx")) {
      appImport = "./App";
    } else if (files.includes("app.tsx")) {
      appImport = "./app";
    } else if (files.includes("index.tsx") && files.length > 1) {
      // index.tsx might BE the main entry — check if it renders
      appImport = "./index";
    } else {
      // Find any .tsx file that might be the root
      const tsxFile = files.find((f) => f.endsWith(".tsx") && f !== "main.tsx");
      if (tsxFile) {
        appImport = "./" + tsxFile.replace(/\.tsx$/, "");
      }
    }
  }

  const mainContent = `import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "${appImport}";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

  writeFileSync(mainPath, mainContent, "utf-8");
}

/**
 * Ensure src/test-setup.ts exists so bun:test has jest-dom matchers available.
 */
function ensureProjectHasTestSetup(projectPath: string) {
  const setupPath = join(projectPath, "src", "test-setup.ts");
  if (existsSync(setupPath)) return;
  mkdirSync(join(projectPath, "src"), { recursive: true });
  writeFileSync(setupPath, `import "@testing-library/jest-dom";\n`, "utf-8");
}

/**
 * Ensure tsconfig.json exists so Bun correctly handles .ts files.
 */
function ensureProjectHasTsConfig(projectPath: string) {
  const tsconfigPath = join(projectPath, "tsconfig.json");
  if (existsSync(tsconfigPath)) return;

  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      allowJs: true,
      skipLibCheck: true,
      esModuleInterop: true,
      strict: false,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
    },
    include: ["src", "server"],
    exclude: ["node_modules", "dist"],
  };

  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");
}

/**
 * Ensure src/index.css exists with Tailwind CSS v4 import.
 */
function ensureProjectHasTailwindCss(projectPath: string) {
  const cssPath = join(projectPath, "src", "index.css");
  if (existsSync(cssPath)) return;

  mkdirSync(join(projectPath, "src"), { recursive: true });

  const css = `@import "tailwindcss";
`;
  writeFileSync(cssPath, css, "utf-8");
}

/**
 * Run bun install in the project directory.
 * Returns a promise that resolves when install is complete.
 */
async function installProjectDependencies(projectPath: string, chatId?: string): Promise<string | null> {
  if (installedProjects.has(projectPath)) return null;

  // If an install is already running for this path, wait for it instead of starting another
  const pending = pendingInstalls.get(projectPath);
  if (pending) return pending;

  const installPromise = (async (): Promise<string | null> => {
    log("preview", `Installing dependencies in ${projectPath}`);

    const proc = Bun.spawn(["bun", "install"], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      logError("preview", `bun install failed (exit ${exitCode})`, stderr);
      if (chatId) {
        broadcastAgentThinking(chatId, "orchestrator", "Build System", "streaming", {
          chunk: "\n\nDependency install failed:\n" + stderr.slice(0, STDERR_TRUNCATION),
        });
      }
      // Return the error so callers can surface it to agents
      return stderr.slice(0, STDERR_TRUNCATION);
    } else {
      log("preview", "Dependencies installed successfully");
      installedProjects.add(projectPath);
      return null;
    }
  })();

  pendingInstalls.set(projectPath, installPromise);
  try {
    return await installPromise;
  } finally {
    pendingInstalls.delete(projectPath);
  }
}

/**
 * Remove postcss.config.* and tailwind.config.* files that conflict with
 * the bun-plugin-tailwind plugin (Tailwind CSS v4).
 */
function removeConflictingTailwindConfigs(projectPath: string) {
  for (const file of TAILWIND_CONFLICT_FILES) {
    const filePath = join(projectPath, file);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      log("preview", `Removed conflicting config: ${file}`);
    }
  }
}

/**
 * Remove stale Vite-era config files left over from previous scaffolding.
 */
function removeStaleViteConfigs(projectPath: string) {
  for (const file of ["vite.config.ts", "vitest.config.ts"]) {
    const filePath = join(projectPath, file);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      log("preview", `Removed stale Vite config: ${file}`);
    }
  }
}

/**
 * Prepare a project for preview: scaffold config, install deps.
 * Called by orchestrator after first file extraction, and as a safety net by startPreviewServer.
 */
export async function prepareProjectForPreview(projectPath: string, chatId?: string, projectName?: string): Promise<string | null> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }

  removeConflictingTailwindConfigs(fullPath);
  removeStaleViteConfigs(fullPath);
  ensureProjectHasPackageJson(fullPath, projectName);
  ensureProjectHasBunfig(fullPath);
  ensureProjectHasTsConfig(fullPath);
  ensureProjectHasIndexHtml(fullPath);
  ensureProjectHasTailwindCss(fullPath);
  ensureProjectHasTestSetup(fullPath);
  ensureProjectHasMainEntry(fullPath);
  return await installProjectDependencies(fullPath, chatId);
}

export async function startPreviewServer(projectId: string, projectPath: string, projectName?: string): Promise<{ url: string; port: number }> {
  // Wait for any in-progress stop to finish before starting — prevents the new
  // server from colliding with an old process that is still being killed.
  const pendingStop = pendingStops.get(projectId);
  if (pendingStop) {
    log("preview", `Waiting for pending stop of ${projectId} before starting`);
    await pendingStop;
  }

  // If already running, check if process is still alive
  const existing = activeServers.get(projectId);
  if (existing) {
    if (existing.process.exitCode !== null) {
      // Process has exited — remove stale entry and start fresh
      log("preview", `Server for ${projectId} died (exit ${existing.process.exitCode}) — restarting`);
      releasePort(existing.port);
      activeServers.delete(projectId);
    } else {
      return { url: `http://localhost:${existing.port}`, port: existing.port };
    }
  }

  const fullPath = join(process.cwd(), projectPath);

  // Full preparation — scaffolds everything and installs deps
  await prepareProjectForPreview(projectPath, undefined, projectName);

  const port = allocatePort();
  const host = process.env.PREVIEW_HOST || DEFAULT_PREVIEW_HOST;
  log("preview", `Starting preview server for ${projectId} on port ${port}`);

  // Start Bun dev server for this project
  const proc = Bun.spawn(["bun", "./index.html", "--port", String(port)], {
    cwd: fullPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  activeServers.set(projectId, { port, process: proc });

  // Auto-cleanup when process exits unexpectedly — capture stderr for diagnostics
  proc.exited.then(async (code) => {
    if (activeServers.get(projectId)?.process === proc) {
      let stderrText = "";
      try {
        stderrText = await new Response(proc.stderr).text();
      } catch { /* already consumed */ }
      const reason = stderrText.trim().split("\n").slice(-5).join("\n") || "unknown";
      log("preview", `Preview server for ${projectId} exited (code ${code}) — removing from active servers`);
      if (code !== 0 && code !== null) {
        logError("preview", `Preview server death reason`, reason);
      }
      releasePort(port);
      activeServers.delete(projectId);
    }
  });

  // Wait for preview server to be ready by polling the port
  const startTime = Date.now();
  while (Date.now() - startTime < PREVIEW_READY_TIMEOUT) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT) });
      if (res.ok || res.status === 404) break;
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_READY_POLL_INTERVAL));
  }

  // Always return localhost to the client (browser connects to Docker-mapped ports on localhost)
  return { url: `http://localhost:${port}`, port };
}

export async function stopPreviewServer(projectId: string) {
  const entry = activeServers.get(projectId);
  if (!entry) return;

  const { port, process: proc } = entry;
  activeServers.delete(projectId);

  // Register the stop as a pending operation so concurrent starts wait for it
  const stopPromise = (async () => {
    // Kill the entire process tree
    if (process.platform === "win32" && proc.pid) {
      try {
        Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
          stdout: "ignore", stderr: "ignore",
        });
      } catch {
        proc.kill();
      }
    } else if (proc.pid) {
      // Unix: kill the process group (negative PID) to get all children
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill();
      }
    } else {
      proc.kill();
    }

    // Wait for the process to actually exit before releasing the port
    const deadline = Date.now() + PREVIEW_SHUTDOWN_DEADLINE;
    while (proc.exitCode === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, PREVIEW_SHUTDOWN_POLL));
    }
    if (proc.exitCode === null) {
      log("preview", `Process for ${projectId} didn't exit in ${PREVIEW_SHUTDOWN_DEADLINE}ms — force-killing`);
      if (process.platform !== "win32" && proc.pid) {
        try { process.kill(-proc.pid, "SIGKILL"); } catch { /* already dead */ }
      } else {
        proc.kill(9);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    releasePort(port);
    log("preview", `Stopped preview server for ${projectId} (port ${port})`);
  })();

  pendingStops.set(projectId, stopPromise);
  await stopPromise;
  pendingStops.delete(projectId);
}

export async function stopAllPreviewServers() {
  await Promise.all([...activeServers.keys()].map((id) => stopPreviewServer(id)));
}

export function getPreviewUrl(projectId: string): string | null {
  const entry = activeServers.get(projectId);
  return entry ? `http://localhost:${entry.port}` : null;
}

/**
 * Invalidate the installed cache for a project so deps will be reinstalled.
 * Call this when package.json is written by an agent.
 */
export function invalidateProjectDeps(projectPath: string) {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);
  installedProjects.delete(fullPath);
}

/**
 * Get the frontend port for a running project, or null if not running.
 */
export function getFrontendPort(projectId: string): number | null {
  return activeServers.get(projectId)?.port ?? null;
}

/**
 * Scaffold a dev-server.ts wrapper in the project that uses Bun.serve() with
 * routes + fetch fallback to forward /api/* to the backend port. Then restart
 * the preview process to pick it up.
 * Called by backend-server.ts after the backend process is confirmed ready.
 */
export function enableBunProxy(projectPath: string, backendPort: number) {
  const devServerPath = join(projectPath, "dev-server.ts");

  // Already has a dev-server wrapper — skip
  if (existsSync(devServerPath)) {
    const current = readFileSync(devServerPath, "utf-8");
    if (current.includes(`${backendPort}`)) return;
  }

  const devServer = `// Auto-generated proxy wrapper — forwards /api/* to backend
const server = Bun.serve({
  port: parseInt(process.env.PORT || "3001"),
  development: true,
  routes: {
    "/": "./index.html",
  },
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api")) {
      const target = "http://localhost:${backendPort}" + url.pathname + url.search;
      return fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});
console.log("Dev server with proxy on port " + server.port);
`;

  writeFileSync(devServerPath, devServer, "utf-8");
  log("preview", `Scaffolded Bun proxy dev-server for backend port ${backendPort}`);
}
