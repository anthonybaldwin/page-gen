import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { log, logError } from "../services/logger.ts";

// Read versions from our own package.json so Dependabot keeps them current
const OUR_PKG = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf-8"));
const OUR_DEPS: Record<string, string> = { ...OUR_PKG.dependencies, ...OUR_PKG.devDependencies };

const activeServers = new Map<string, { port: number; process: ReturnType<typeof Bun.spawn> }>();

// --- Port pool ---

const PORT_MIN = 3001;
const PORT_MAX = 3020;
const availablePorts: number[] = [];
let nextPort = PORT_MIN;

function allocatePort(): number {
  if (availablePorts.length > 0) return availablePorts.shift()!;
  if (nextPort > PORT_MAX) throw new Error(`Preview port range exhausted (${PORT_MIN}-${PORT_MAX})`);
  return nextPort++;
}

function releasePort(port: number) {
  if (port >= PORT_MIN && port <= PORT_MAX) availablePorts.push(port);
}

// Track which projects have had deps installed to avoid re-running
const installedProjects = new Set<string>();
// Per-project install mutex — prevents concurrent bun install on the same directory
const pendingInstalls = new Map<string, Promise<void>>();

function ensureProjectHasViteConfig(projectPath: string) {
  const configPath = join(projectPath, "vite.config.ts");

  // Only write if missing — rewriting kills the running Vite dev server (file watcher detects config change)
  if (existsSync(configPath)) return;

  const config = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  server: {
    hmr: true,
  },
});
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

function ensureProjectHasPackageJson(projectPath: string) {
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

  if (!devDeps.vite) devDeps.vite = OUR_DEPS.vite || "^7.3.0";
  if (!devDeps["@vitejs/plugin-react"]) devDeps["@vitejs/plugin-react"] = OUR_DEPS["@vitejs/plugin-react"] || "^5.1.0";
  if (!devDeps["@tailwindcss/vite"]) devDeps["@tailwindcss/vite"] = OUR_DEPS["@tailwindcss/vite"] || "^4.2.0";
  if (!devDeps.tailwindcss) devDeps.tailwindcss = OUR_DEPS.tailwindcss || "^4.2.0";
  if (!devDeps["@types/react"]) devDeps["@types/react"] = OUR_DEPS["@types/react"] || "^19.2.0";
  if (!devDeps["@types/react-dom"]) devDeps["@types/react-dom"] = OUR_DEPS["@types/react-dom"] || "^19.2.0";
  // Testing deps (not in our package.json — pinned here)
  if (!devDeps.vitest) devDeps.vitest = "^4.0.0";
  if (!devDeps["happy-dom"]) devDeps["happy-dom"] = "^20.0.0";
  if (!devDeps["@testing-library/react"]) devDeps["@testing-library/react"] = "^16.3.0";
  if (!devDeps["@testing-library/user-event"]) devDeps["@testing-library/user-event"] = "^14.0.0";

  const pkg = {
    name: (existing.name as string) || "preview-project",
    private: true,
    type: "module",
    ...existing,
    dependencies: deps,
    devDependencies: devDeps,
  };

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
}

/**
 * Ensure src/main.tsx exists as the Vite entry point.
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
 * Ensure vitest.config.ts exists for test execution.
 * Does NOT overwrite — agents or users may customize the config.
 */
function ensureProjectHasVitestConfig(projectPath: string) {
  const configPath = join(projectPath, "vitest.config.ts");
  if (existsSync(configPath)) return;

  const config = `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx,js,jsx}"],
  },
});
`;
  writeFileSync(configPath, config, "utf-8");
}

/**
 * Ensure tsconfig.json exists so Vite/esbuild correctly handles .ts files.
 * Without this, esbuild may treat .ts files as JavaScript and choke on type annotations.
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
    include: ["src"],
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
async function installProjectDependencies(projectPath: string): Promise<void> {
  if (installedProjects.has(projectPath)) return;

  // If an install is already running for this path, wait for it instead of starting another
  const pending = pendingInstalls.get(projectPath);
  if (pending) return pending;

  const installPromise = (async () => {
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
      // Don't throw — preview might still partially work
    } else {
      log("preview", "Dependencies installed successfully");
      installedProjects.add(projectPath);
    }
  })();

  pendingInstalls.set(projectPath, installPromise);
  try {
    await installPromise;
  } finally {
    pendingInstalls.delete(projectPath);
  }
}

/**
 * Prepare a project for preview: scaffold config, install deps.
 * Called by orchestrator after first file extraction, and as a safety net by startPreviewServer.
 */
export async function prepareProjectForPreview(projectPath: string): Promise<void> {
  const fullPath = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? projectPath
    : join(process.cwd(), projectPath);

  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }

  ensureProjectHasPackageJson(fullPath);
  ensureProjectHasViteConfig(fullPath);
  ensureProjectHasVitestConfig(fullPath);
  ensureProjectHasTsConfig(fullPath);
  ensureProjectHasIndexHtml(fullPath);
  ensureProjectHasTailwindCss(fullPath);
  ensureProjectHasMainEntry(fullPath);
  await installProjectDependencies(fullPath);
}

export async function startPreviewServer(projectId: string, projectPath: string): Promise<{ url: string; port: number }> {
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
  await prepareProjectForPreview(projectPath);

  const port = allocatePort();
  const host = process.env.PREVIEW_HOST || "localhost";

  // Start Vite dev server for this project
  const proc = Bun.spawn(["bunx", "vite", "--port", String(port), "--host", host], {
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
      log("preview", `Vite server for ${projectId} exited (code ${code}) — removing from active servers`);
      if (code !== 0 && code !== null) {
        logError("preview", `Vite server death reason`, reason);
      }
      releasePort(port);
      activeServers.delete(projectId);
    }
  });

  // Wait for Vite to be ready by polling the port
  const startTime = Date.now();
  const timeout = 15000; // 15s max wait
  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status === 404) break; // Vite is responding
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Always return localhost to the client (browser connects to Docker-mapped ports on localhost)
  return { url: `http://localhost:${port}`, port };
}

export async function stopPreviewServer(projectId: string) {
  const entry = activeServers.get(projectId);
  if (!entry) return;

  const { port, process: proc } = entry;
  activeServers.delete(projectId);

  // Kill the process tree. On Windows, process.kill() only kills the parent
  // (bunx) and orphans the Vite child — use taskkill /T to kill the tree.
  if (process.platform === "win32" && proc.pid) {
    try {
      Bun.spawnSync(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore", stderr: "ignore",
      });
    } catch {
      proc.kill();
    }
  } else {
    proc.kill();
  }

  // Wait for the process to actually exit (max 3s) before releasing the port
  const deadline = Date.now() + 3000;
  while (proc.exitCode === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (proc.exitCode === null) {
    log("preview", `Process for ${projectId} didn't exit in 3s — force-killing`);
    proc.kill(9);
    await new Promise((r) => setTimeout(r, 200));
  }

  releasePort(port);
  log("preview", `Stopped preview server for ${projectId} (port ${port})`);
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
