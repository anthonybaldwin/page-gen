import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { existsSync } from "fs";
import { runMigrations } from "./db/migrate.ts";
import { projectRoutes } from "./routes/projects.ts";
import { chatRoutes } from "./routes/chats.ts";
import { messageRoutes } from "./routes/messages.ts";
import { usageRoutes } from "./routes/usage.ts";
import { snapshotRoutes } from "./routes/snapshots.ts";
import { fileRoutes } from "./routes/files.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { agentRoutes } from "./routes/agents.ts";
import { setServer } from "./ws.ts";
import { cleanupStaleExecutions } from "./agents/orchestrator.ts";
import { stopAllPreviewServers } from "./preview/vite-server.ts";
import { stopAllBackendServers } from "./preview/backend-server.ts";
import { log, logError } from "./services/logger.ts";

// Run migrations on startup
runMigrations();

// Clean up any agent executions left in "running" state from a previous server instance
cleanupStaleExecutions().catch((err) => {
  logError("server", "Failed to clean up stale executions", err);
});

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    allowHeaders: [
      "Content-Type",
      "X-Api-Key-Anthropic",
      "X-Api-Key-OpenAI",
      "X-Api-Key-Google",
      "X-Proxy-Url-Anthropic",
      "X-Proxy-Url-OpenAI",
      "X-Proxy-Url-Google",
    ],
  })
);

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});

// Mount routes
app.route("/api/projects", projectRoutes);
app.route("/api/chats", chatRoutes);
app.route("/api/messages", messageRoutes);
app.route("/api/usage", usageRoutes);
app.route("/api/snapshots", snapshotRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/agents", agentRoutes);

// Serve static frontend in production/Docker mode
if (existsSync("./dist/client")) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ root: "./dist/client", path: "index.html" }));
}

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Handle WebSocket upgrade requests
    const url = new URL(req.url);
    if (url.pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    // All other requests go through Hono
    return app.fetch(req, server);
  },
  websocket: {
    open(ws) {
      ws.subscribe("agents");
    },
    message(ws, message) {
      // Handle incoming WebSocket messages
      log("ws", `received: ${message}`);
    },
    close(ws) {
      ws.unsubscribe("agents");
    },
  },
});

// Register server for WebSocket broadcasts
setServer(server);

log("server", `Started on http://localhost:${PORT}`);

// --- Graceful shutdown ---
async function shutdown(signal: string) {
  log("server", `Shutting down (${signal})...`);
  try {
    await Promise.all([
      stopAllPreviewServers(),
      stopAllBackendServers(),
    ]);
    log("server", `Cleanup complete — exiting`);
  } catch (err) {
    logError("server", "Error during shutdown cleanup", err);
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { app, server };
