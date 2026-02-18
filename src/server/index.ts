import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runMigrations } from "./db/migrate.ts";
import { projectRoutes } from "./routes/projects.ts";
import { chatRoutes } from "./routes/chats.ts";
import { messageRoutes } from "./routes/messages.ts";
import { usageRoutes } from "./routes/usage.ts";
import { snapshotRoutes } from "./routes/snapshots.ts";
import { fileRoutes } from "./routes/files.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { agentRoutes } from "./routes/agents.ts";

// Run migrations on startup
runMigrations();

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

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket: {
    open(ws) {
      ws.subscribe("agents");
    },
    message(ws, message) {
      // Handle incoming WebSocket messages
      console.log("[ws] received:", message);
    },
    close(ws) {
      ws.unsubscribe("agents");
    },
  },
});

console.log(`[server] Running on http://localhost:${PORT}`);

export { app, server };
