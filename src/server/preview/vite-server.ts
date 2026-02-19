import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

const activeServers = new Map<string, { port: number; process: ReturnType<typeof Bun.spawn> }>();
let nextPort = 3001;

// Track which projects have had deps installed to avoid re-running
const installedProjects = new Set<string>();
// Per-project install mutex — prevents concurrent bun install on the same directory
const pendingInstalls = new Map<string, Promise<void>>();

function ensureProjectHasViteConfig(projectPath: string) {
  const configPath = join(projectPath, "vite.config.ts");

  // Always overwrite with our known-good config to ensure React + Tailwind plugins are present
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

  // Ensure core React deps
  if (!deps.react) deps.react = "^19.0.0";
  if (!deps["react-dom"]) deps["react-dom"] = "^19.0.0";

  // Ensure Vite + React plugin + Tailwind in devDeps
  if (!devDeps.vite) devDeps.vite = "^6.0.0";
  if (!devDeps["@vitejs/plugin-react"]) devDeps["@vitejs/plugin-react"] = "^4.3.0";
  if (!devDeps["@tailwindcss/vite"]) devDeps["@tailwindcss/vite"] = "^4.0.0";
  if (!devDeps.tailwindcss) devDeps.tailwindcss = "^4.0.0";
  if (!devDeps["@types/react"]) devDeps["@types/react"] = "^19.0.0";
  if (!devDeps["@types/react-dom"]) devDeps["@types/react-dom"] = "^19.0.0";
  // Testing deps for the testing agent
  if (!devDeps.vitest) devDeps.vitest = "^2.0.0";
  if (!devDeps["happy-dom"]) devDeps["happy-dom"] = "^15.0.0";
  if (!devDeps["@testing-library/react"]) devDeps["@testing-library/react"] = "^16.0.0";
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
    console.log(`[preview] Installing dependencies in ${projectPath}...`);

    const proc = Bun.spawn(["bun", "install"], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[preview] bun install failed (exit ${exitCode}):`, stderr);
      // Don't throw — preview might still partially work
    } else {
      console.log(`[preview] Dependencies installed successfully`);
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
  ensureProjectHasTsConfig(fullPath);
  ensureProjectHasIndexHtml(fullPath);
  ensureProjectHasTailwindCss(fullPath);
  ensureProjectHasMainEntry(fullPath);
  await installProjectDependencies(fullPath);
}

export async function startPreviewServer(projectId: string, projectPath: string): Promise<{ url: string; port: number }> {
  // If already running, return existing URL
  const existing = activeServers.get(projectId);
  if (existing) {
    return { url: `http://localhost:${existing.port}`, port: existing.port };
  }

  const fullPath = join(process.cwd(), projectPath);

  // Full preparation — scaffolds everything and installs deps
  await prepareProjectForPreview(projectPath);

  const port = nextPort++;

  // Start Vite dev server for this project
  const proc = Bun.spawn(["bunx", "vite", "--port", String(port), "--host", "localhost"], {
    cwd: fullPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  activeServers.set(projectId, { port, process: proc });

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

  return { url: `http://localhost:${port}`, port };
}

export function stopPreviewServer(projectId: string) {
  const entry = activeServers.get(projectId);
  if (entry) {
    entry.process.kill();
    activeServers.delete(projectId);
  }
}

export function stopAllPreviewServers() {
  for (const [id] of activeServers) {
    stopPreviewServer(id);
  }
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
