import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Tests that DELETE /api/chats/:id and DELETE /api/projects/:id
 * properly cascade through all child tables without FK violations.
 */
describe("Delete cascade", () => {
  let app: { fetch: (req: Request) => Response | Promise<Response> };

  beforeAll(async () => {
    runMigrations();
    const mod = await import("../../src/server/index.ts");
    app = mod.app;
  });

  /** Seed a full project with all child records and return IDs */
  function seedProject() {
    const projectId = nanoid();
    const chatId = nanoid();
    const executionId = nanoid();
    const now = Date.now();

    db.insert(schema.projects).values({
      id: projectId, name: "Delete Test Project", path: `./projects/${projectId}`,
      createdAt: now, updatedAt: now,
    }).run();

    db.insert(schema.chats).values({
      id: chatId, projectId, title: "Delete Test Chat",
      createdAt: now, updatedAt: now,
    }).run();

    db.insert(schema.messages).values({
      id: nanoid(), chatId, role: "user", content: "hello",
      createdAt: now,
    }).run();

    db.insert(schema.agentExecutions).values({
      id: executionId, chatId, agentName: "orchestrator", status: "completed",
      input: "{}", output: "{}", startedAt: now, completedAt: now, retryCount: 0,
    }).run();

    db.insert(schema.tokenUsage).values({
      id: nanoid(), executionId, chatId, agentName: "orchestrator",
      provider: "anthropic", model: "test", apiKeyHash: "abc",
      inputTokens: 100, outputTokens: 50, totalTokens: 150,
      costEstimate: 0.001, createdAt: now,
    }).run();

    db.insert(schema.pipelineRuns).values({
      id: nanoid(), chatId, intent: "build", scope: "full",
      userMessage: "test", plannedAgents: '["orchestrator"]',
      status: "completed", startedAt: now, completedAt: now,
    }).run();

    db.insert(schema.billingLedger).values({
      id: nanoid(), projectId, projectName: "Delete Test Project",
      chatId, chatTitle: "Delete Test Chat", executionId,
      agentName: "orchestrator", provider: "anthropic", model: "test",
      apiKeyHash: "abc", inputTokens: 100, outputTokens: 50,
      totalTokens: 150, costEstimate: 0.001, createdAt: now,
    }).run();

    return { projectId, chatId, executionId };
  }

  test("DELETE /api/chats/:id cascades through all child tables", async () => {
    const { projectId, chatId } = seedProject();

    // Verify children exist
    expect(db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all().length).toBeGreaterThan(0);
    expect(db.select().from(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, chatId)).all().length).toBeGreaterThan(0);
    expect(db.select().from(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chatId)).all().length).toBeGreaterThan(0);
    expect(db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chatId)).all().length).toBeGreaterThan(0);

    // Delete the chat
    const res = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}`, { method: "DELETE" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Chat is gone
    expect(db.select().from(schema.chats).where(eq(schema.chats.id, chatId)).get()).toBeUndefined();

    // All children are gone
    expect(db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chatId)).all()).toEqual([]);

    // Billing ledger is untouched (no FK, survives deletion)
    const billing = db.select().from(schema.billingLedger).where(eq(schema.billingLedger.chatId, chatId)).all();
    expect(billing.length).toBeGreaterThan(0);
  });

  test("DELETE /api/projects/:id cascades through all chats and children", async () => {
    const { projectId, chatId } = seedProject();

    // Verify everything exists
    expect(db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()).toBeDefined();
    expect(db.select().from(schema.chats).where(eq(schema.chats.projectId, projectId)).all().length).toBeGreaterThan(0);
    expect(db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chatId)).all().length).toBeGreaterThan(0);

    // Delete the project
    const res = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}`, { method: "DELETE" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Project, chats, and all children are gone
    expect(db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()).toBeUndefined();
    expect(db.select().from(schema.chats).where(eq(schema.chats.projectId, projectId)).all()).toEqual([]);
    expect(db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chatId)).all()).toEqual([]);
    expect(db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chatId)).all()).toEqual([]);
  });
});
