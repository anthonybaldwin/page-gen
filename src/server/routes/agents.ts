import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, asc } from "drizzle-orm";
import { extractApiKeys, createProviders } from "../providers/registry.ts";
import { runOrchestration, resumeOrchestration, abortOrchestration, isOrchestrationRunning, findInterruptedPipelineRun } from "../agents/orchestrator.ts";

export const agentRoutes = new Hono();

// List agent executions for a chat
agentRoutes.get("/executions", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ error: "chatId required" }, 400);

  const executions = await db
    .select()
    .from(schema.agentExecutions)
    .where(eq(schema.agentExecutions.chatId, chatId))
    .orderBy(asc(schema.agentExecutions.startedAt), asc(schema.agentExecutions.id))
    .all();
  return c.json(executions);
});

// Trigger orchestration (or resume an interrupted one)
agentRoutes.post("/run", async (c) => {
  const body = await c.req.json<{ chatId: string; message: string; resume?: boolean }>();
  const keys = extractApiKeys(c);
  const providers = createProviders(keys);

  // Verify at least one provider is available
  if (!providers.anthropic && !providers.openai && !providers.google) {
    return c.json({ error: "No API keys provided. Please configure at least one provider." }, 400);
  }

  // Look up the chat to get the project
  const chat = await db
    .select()
    .from(schema.chats)
    .where(eq(schema.chats.id, body.chatId))
    .get();

  if (!chat) return c.json({ error: "Chat not found" }, 404);

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, chat.projectId))
    .get();

  if (!project) return c.json({ error: "Project not found" }, 404);

  // Build apiKeys map for token tracking
  const apiKeysMap: Record<string, string> = {};
  if (keys.anthropic.apiKey) apiKeysMap.anthropic = keys.anthropic.apiKey;
  if (keys.openai.apiKey) apiKeysMap.openai = keys.openai.apiKey;
  if (keys.google.apiKey) apiKeysMap.google = keys.google.apiKey;

  const orchestrationInput = {
    chatId: body.chatId,
    projectId: project.id,
    projectPath: project.path,
    userMessage: body.message,
    providers,
    apiKeys: apiKeysMap,
  };

  // Resume interrupted pipeline if requested
  if (body.resume) {
    const interruptedId = findInterruptedPipelineRun(body.chatId);
    if (interruptedId) {
      resumeOrchestration({ ...orchestrationInput, pipelineRunId: interruptedId }).catch((err) => {
        console.error("[agents] Resume orchestration error:", err);
      });
      return c.json({ status: "resumed", chatId: body.chatId, pipelineRunId: interruptedId });
    }
    // No interrupted pipeline found — fall through to fresh start
  }

  // Run orchestration asynchronously
  runOrchestration(orchestrationInput).catch((err) => {
    console.error("[agents] Orchestration error:", err);
  });

  return c.json({ status: "started", chatId: body.chatId });
});

// Check if orchestration is running for a chat, with execution history
agentRoutes.get("/status", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ error: "chatId required" }, 400);

  const running = isOrchestrationRunning(chatId);

  // Return execution history so thinking blocks can be reconstructed on refresh
  const executions = await db
    .select({
      agentName: schema.agentExecutions.agentName,
      status: schema.agentExecutions.status,
      output: schema.agentExecutions.output,
      error: schema.agentExecutions.error,
      startedAt: schema.agentExecutions.startedAt,
    })
    .from(schema.agentExecutions)
    .where(eq(schema.agentExecutions.chatId, chatId))
    .all();

  // Check for interrupted pipeline run
  const interruptedPipelineId = findInterruptedPipelineRun(chatId);

  return c.json({ running, executions, interruptedPipelineId });
});

// Stop orchestration
agentRoutes.post("/stop", async (c) => {
  const { chatId } = await c.req.json<{ chatId: string }>();
  abortOrchestration(chatId);
  return c.json({ ok: true });
});
