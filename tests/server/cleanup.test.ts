import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { eq } from "drizzle-orm";
import { cleanupStaleExecutions } from "../../src/server/agents/orchestrator.ts";

/**
 * Tests for server startup cleanup of stale agent executions.
 * Verifies that running/retrying executions are marked as failed when the server restarts.
 */
describe("cleanupStaleExecutions", () => {
  const testProjectId = `test-project-cleanup-${nanoid(6)}`;
  const testChatId = `test-chat-cleanup-${nanoid(6)}`;

  beforeAll(() => {
    runMigrations();

    // Create test project and chat for FK constraints
    db.insert(schema.projects).values({
      id: testProjectId,
      name: "Cleanup Test Project",
      path: `projects/${testProjectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: testChatId,
      projectId: testProjectId,
      title: "Cleanup Test Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
  });

  afterAll(() => {
    // Clean up test data
    db.delete(schema.messages).where(eq(schema.messages.chatId, testChatId)).run();
    db.delete(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, testChatId)).run();
    db.delete(schema.chats).where(eq(schema.chats.id, testChatId)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, testProjectId)).run();
  });

  test("marks running executions as failed", async () => {
    const execId = `test-exec-running-${nanoid(6)}`;
    db.insert(schema.agentExecutions).values({
      id: execId,
      chatId: testChatId,
      agentName: "frontend-dev",
      status: "running",
      input: JSON.stringify({ message: "test" }),
      output: null,
      error: null,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: null,
    }).run();

    const count = await cleanupStaleExecutions();
    expect(count).toBeGreaterThanOrEqual(1);

    const exec = db.select()
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.id, execId))
      .get();

    expect(exec?.status).toBe("failed");
    expect(exec?.error).toBe("Server restarted — pipeline interrupted");
    expect(exec?.completedAt).toBeDefined();
  });

  test("marks retrying executions as failed", async () => {
    const execId = `test-exec-retrying-${nanoid(6)}`;
    db.insert(schema.agentExecutions).values({
      id: execId,
      chatId: testChatId,
      agentName: "styling",
      status: "retrying",
      input: JSON.stringify({ message: "test" }),
      output: null,
      error: null,
      retryCount: 1,
      startedAt: Date.now(),
      completedAt: null,
    }).run();

    await cleanupStaleExecutions();

    const exec = db.select()
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.id, execId))
      .get();

    expect(exec?.status).toBe("failed");
    expect(exec?.error).toBe("Server restarted — pipeline interrupted");
  });

  test("does not modify completed executions", async () => {
    const execId = `test-exec-completed-${nanoid(6)}`;
    db.insert(schema.agentExecutions).values({
      id: execId,
      chatId: testChatId,
      agentName: "qa",
      status: "completed",
      input: JSON.stringify({ message: "test" }),
      output: JSON.stringify({ content: "all good" }),
      error: null,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: Date.now(),
    }).run();

    await cleanupStaleExecutions();

    const exec = db.select()
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.id, execId))
      .get();

    expect(exec?.status).toBe("completed");
    expect(exec?.error).toBeNull();
  });

  test("does not modify already-failed executions", async () => {
    const execId = `test-exec-failed-${nanoid(6)}`;
    const originalError = "API key invalid";
    db.insert(schema.agentExecutions).values({
      id: execId,
      chatId: testChatId,
      agentName: "research",
      status: "failed",
      input: JSON.stringify({ message: "test" }),
      output: null,
      error: originalError,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: Date.now(),
    }).run();

    await cleanupStaleExecutions();

    const exec = db.select()
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.id, execId))
      .get();

    expect(exec?.status).toBe("failed");
    expect(exec?.error).toBe(originalError);
  });

  test("inserts system message into affected chat", async () => {
    // Insert a new running execution to trigger cleanup
    const execId = `test-exec-sysmsg-${nanoid(6)}`;
    db.insert(schema.agentExecutions).values({
      id: execId,
      chatId: testChatId,
      agentName: "architect",
      status: "running",
      input: JSON.stringify({ message: "test" }),
      output: null,
      error: null,
      retryCount: 0,
      startedAt: Date.now(),
      completedAt: null,
    }).run();

    await cleanupStaleExecutions();

    const msgs = db.select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, testChatId))
      .all();

    const systemMsg = msgs.find(
      (m) => m.role === "system" && m.content.includes("server restart")
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg?.agentName).toBe("orchestrator");
  });

  test("returns 0 when no stale executions exist", async () => {
    // All previous running/retrying execs are already cleaned up
    const count = await cleanupStaleExecutions();
    expect(count).toBe(0);
  });
});
