import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { runOrchestration, resumeOrchestration, findInterruptedPipelineRun } from "../agents/orchestrator.ts";
import { log, logError } from "../services/logger.ts";

export const messageRoutes = new Hono();

// List messages for a chat
messageRoutes.get("/", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ error: "chatId required" }, 400);

  const ordered = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .all();
  return c.json(ordered);
});

// Create message
messageRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    chatId: string;
    role: string;
    content: string;
    agentName?: string;
    metadata?: Record<string, unknown>;
  }>();

  const id = nanoid();
  const now = Date.now();

  const message = {
    id,
    chatId: body.chatId,
    role: body.role,
    content: body.content,
    agentName: body.agentName || null,
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    createdAt: now,
  };

  await db.insert(schema.messages).values(message);
  return c.json(message, 201);
});

// Combined: persist message + trigger orchestration in a single call
// Saves one network round-trip vs. POST /messages then POST /agents/run
messageRoutes.post("/send", async (c) => {
  const body = await c.req.json<{
    chatId: string;
    content: string;
    resume?: boolean;
  }>();

  // 1. Persist message
  const id = nanoid();
  const now = Date.now();
  const message = {
    id,
    chatId: body.chatId,
    role: "user",
    content: body.content,
    agentName: null,
    metadata: null,
    createdAt: now,
  };
  await db.insert(schema.messages).values(message);
  log("user", `New message in chat ${body.chatId}`, { chatId: body.chatId, messageId: id, contentLength: body.content.length });

  // 2. Trigger orchestration
  const keys = extractApiKeys(c);
  const providers = createProviders(keys);

  if (!providers.anthropic && !providers.openai && !providers.google) {
    return c.json({ message, error: "No API keys provided. Please configure at least one provider." }, 400);
  }

  const chat = await db.select().from(schema.chats).where(eq(schema.chats.id, body.chatId)).get();
  if (!chat) return c.json({ error: "Chat not found" }, 404);

  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, chat.projectId)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const apiKeysMap: Record<string, string> = {};
  if (keys.anthropic?.apiKey) apiKeysMap.anthropic = keys.anthropic.apiKey;
  if (keys.openai?.apiKey) apiKeysMap.openai = keys.openai.apiKey;
  if (keys.google?.apiKey) apiKeysMap.google = keys.google.apiKey;

  const orchestrationInput = {
    chatId: body.chatId,
    projectId: project.id,
    projectPath: project.path,
    userMessage: body.content,
    providers,
    apiKeys: apiKeysMap,
  };

  if (body.resume) {
    const interruptedId = findInterruptedPipelineRun(body.chatId);
    if (interruptedId) {
      log("orchestrator", `Resuming interrupted pipeline for chat ${body.chatId}`);
      resumeOrchestration({ ...orchestrationInput, pipelineRunId: interruptedId }).catch((err) => {
        logError("routes", "Resume orchestration error", err);
      });
      return c.json({ message, status: "resumed" });
    }
  }

  log("orchestrator", `Orchestration started for chat ${body.chatId}`);
  runOrchestration(orchestrationInput).catch((err) => {
    logError("routes", "Orchestration error", err);
  });

  return c.json({ message, status: "started" }, 201);
});
