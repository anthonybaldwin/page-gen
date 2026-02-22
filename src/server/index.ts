import { Hono } from "hono";
import { cors } from "hono/cors";
import { runMigrations } from "./db/migrate.ts";
import { projectRoutes } from "./routes/projects.ts";
import { chatRoutes } from "./routes/chats.ts";
import { messageRoutes } from "./routes/messages.ts";
import { usageRoutes } from "./routes/usage.ts";
import { versionRoutes } from "./routes/versions.ts";
import { fileRoutes } from "./routes/files.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { agentRoutes } from "./routes/agents.ts";
import { fontRoutes } from "./routes/fonts.ts";
import { setServer } from "./ws.ts";
import { cleanupStaleExecutions } from "./agents/orchestrator.ts";
import { stopAllPreviewServers } from "./preview/vite-server.ts";
import { PROVIDERS } from "../shared/providers.ts";
import { stopAllBackendServers } from "./preview/backend-server.ts";
import { log, logError, logWarn } from "./services/logger.ts";
import { createMiddleware } from "hono/factory";
import { DEFAULT_PORT, CORS_ORIGINS } from "./config/server.ts";

// Run migrations on startup
runMigrations();

// Clean up any agent executions left in "running" state from a previous server instance
cleanupStaleExecutions().catch((err) => {
  logError("server", "Failed to clean up stale executions", err);
});

const app = new Hono();

// HTTP request logger — routes all request logs through our centralized logger
const httpLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;
  const contentLength = c.req.header("content-length");
  const entry: Record<string, unknown> = { method, path, status, ms, ...(contentLength ? { bytes: Number(contentLength) } : {}) };
  if (status >= 500) logWarn("http", `${method} ${path} ${status} ${ms}ms`, entry);
  else log("http", `${method} ${path} ${status} ${ms}ms`, entry);
});

// Middleware
app.use("*", httpLogger);
app.use(
  "*",
  cors({
    origin: CORS_ORIGINS,
    allowHeaders: [
      "Content-Type",
      ...PROVIDERS.flatMap((p) => [`X-Api-Key-${p.headerKey}`, `X-Proxy-Url-${p.headerKey}`]),
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
app.route("/api/versions", versionRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/fonts", fontRoutes);


const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

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
