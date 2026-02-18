import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const activeServers = new Map<string, { port: number; process: ReturnType<typeof Bun.spawn> }>();
let nextPort = 3001;

function ensureProjectHasViteConfig(projectPath: string) {
  const configPath = join(projectPath, "vite.config.ts");
  if (existsSync(configPath)) return;

  // Create a minimal Vite config for the project
  const config = `
import { defineConfig } from "vite";

export default defineConfig({
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

export async function startPreviewServer(projectId: string, projectPath: string): Promise<{ url: string; port: number }> {
  // If already running, return existing URL
  const existing = activeServers.get(projectId);
  if (existing) {
    return { url: `http://localhost:${existing.port}`, port: existing.port };
  }

  const fullPath = join(process.cwd(), projectPath);

  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
  }

  ensureProjectHasIndexHtml(fullPath);

  const port = nextPort++;

  // Start Vite dev server for this project
  const proc = Bun.spawn(["bunx", "vite", "--port", String(port), "--host", "localhost"], {
    cwd: fullPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  activeServers.set(projectId, { port, process: proc });

  // Wait briefly for Vite to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

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
