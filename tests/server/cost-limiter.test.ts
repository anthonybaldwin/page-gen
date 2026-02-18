import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { nanoid } from "nanoid";
import { checkCostLimit } from "../../src/server/services/cost-limiter.ts";
import { trackTokenUsage } from "../../src/server/services/token-tracker.ts";

describe("Cost Limiter", () => {
  let chatId: string;

  beforeAll(() => {
    runMigrations();

    const projectId = nanoid();
    chatId = nanoid();
    const executionId = nanoid();

    db.insert(schema.projects).values({
      id: projectId,
      name: "Cost Test",
      path: `./projects/${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: chatId,
      projectId,
      title: "Cost Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.agentExecutions).values({
      id: executionId,
      chatId,
      agentName: "test",
      status: "completed",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();
  });

  test("allows when under limit", () => {
    const result = checkCostLimit(chatId, 500_000);
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(false);
  });

  test("blocks when over limit", () => {
    const result = checkCostLimit(chatId, 0);
    expect(result.allowed).toBe(false);
  });

  test("warns at 80% threshold", () => {
    // Use a fresh chat to control the exact total
    const pid = nanoid();
    const cid = nanoid();
    const eid = nanoid();

    db.insert(schema.projects).values({
      id: pid, name: "Warn Test", path: `./projects/${pid}`, createdAt: Date.now(), updatedAt: Date.now(),
    }).run();
    db.insert(schema.chats).values({
      id: cid, projectId: pid, title: "Warn Chat", createdAt: Date.now(), updatedAt: Date.now(),
    }).run();
    db.insert(schema.agentExecutions).values({
      id: eid, chatId: cid, agentName: "test", status: "completed", input: "{}", startedAt: Date.now(),
    }).run();

    // Add 90K tokens against a 100K limit (90% usage)
    trackTokenUsage({
      executionId: eid, chatId: cid, agentName: "test", provider: "anthropic",
      model: "claude-sonnet-4-6", apiKey: "key", inputTokens: 45_000, outputTokens: 45_000,
    });

    const result = checkCostLimit(cid, 100_000);
    expect(result.warning).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.percentUsed).toBeGreaterThanOrEqual(0.8);
  });
});
