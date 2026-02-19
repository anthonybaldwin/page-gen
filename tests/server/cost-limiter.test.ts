import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { nanoid } from "nanoid";
import { checkCostLimit, getMaxAgentCalls, checkDailyCostLimit, checkProjectCostLimit } from "../../src/server/services/cost-limiter.ts";
import { trackTokenUsage } from "../../src/server/services/token-tracker.ts";
import { eq } from "drizzle-orm";

describe("Cost Limiter", () => {
  let chatId: string;
  let projectId: string;

  beforeAll(() => {
    runMigrations();

    projectId = nanoid();
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

  test("treats zero limit as unlimited", () => {
    const result = checkCostLimit(chatId, 0);
    expect(result.allowed).toBe(true);
  });

  test("blocks when over limit", () => {
    // Add tokens to the main chat, then check against a very small limit
    const eid = nanoid();
    db.insert(schema.agentExecutions).values({
      id: eid, chatId, agentName: "test", status: "completed", input: "{}", startedAt: Date.now(),
    }).run();
    trackTokenUsage({
      executionId: eid, chatId, agentName: "test", provider: "anthropic",
      model: "claude-sonnet-4-6", apiKey: "key", inputTokens: 100, outputTokens: 100,
    });

    const result = checkCostLimit(chatId, 1);
    expect(result.allowed).toBe(false);
  });

  test("warns at 80% threshold", () => {
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

    trackTokenUsage({
      executionId: eid, chatId: cid, agentName: "test", provider: "anthropic",
      model: "claude-sonnet-4-6", apiKey: "key", inputTokens: 45_000, outputTokens: 45_000,
    });

    const result = checkCostLimit(cid, 100_000);
    expect(result.warning).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.percentUsed).toBeGreaterThanOrEqual(0.8);
  });

  test("reads maxTokensPerChat from DB when set", () => {
    // Set a custom limit in app_settings
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "maxTokensPerChat")).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: "1000" }).where(eq(schema.appSettings.key, "maxTokensPerChat")).run();
    } else {
      db.insert(schema.appSettings).values({ key: "maxTokensPerChat", value: "1000" }).run();
    }

    // checkCostLimit with no override should use DB value
    const result = checkCostLimit(chatId);
    expect(result.limit).toBe(1000);

    // Restore default
    db.update(schema.appSettings).set({ value: "500000" }).where(eq(schema.appSettings.key, "maxTokensPerChat")).run();
  });

  test("getMaxAgentCalls returns DB value", () => {
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "maxAgentCallsPerRun")).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: "50" }).where(eq(schema.appSettings.key, "maxAgentCallsPerRun")).run();
    } else {
      db.insert(schema.appSettings).values({ key: "maxAgentCallsPerRun", value: "50" }).run();
    }

    expect(getMaxAgentCalls()).toBe(50);

    // Restore
    db.update(schema.appSettings).set({ value: "30" }).where(eq(schema.appSettings.key, "maxAgentCallsPerRun")).run();
  });

  test("checkDailyCostLimit allows when no limit set", () => {
    // Default maxCostPerDay is 0 (unlimited)
    const result = checkDailyCostLimit();
    expect(result.allowed).toBe(true);
  });

  test("checkDailyCostLimit blocks when over limit", () => {
    // Set a very low daily limit
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "maxCostPerDay")).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: "0.001" }).where(eq(schema.appSettings.key, "maxCostPerDay")).run();
    } else {
      db.insert(schema.appSettings).values({ key: "maxCostPerDay", value: "0.001" }).run();
    }

    // Add some usage for today
    const eid = nanoid();
    db.insert(schema.agentExecutions).values({
      id: eid, chatId, agentName: "test", status: "completed", input: "{}", startedAt: Date.now(),
    }).run();
    trackTokenUsage({
      executionId: eid, chatId, agentName: "test", provider: "anthropic",
      model: "claude-sonnet-4-6", apiKey: "key", inputTokens: 10_000, outputTokens: 10_000,
      projectId, projectName: "Cost Test",
    });

    const result = checkDailyCostLimit();
    expect(result.allowed).toBe(false);

    // Restore
    db.update(schema.appSettings).set({ value: "0" }).where(eq(schema.appSettings.key, "maxCostPerDay")).run();
  });

  test("checkProjectCostLimit allows when no limit set", () => {
    const result = checkProjectCostLimit(projectId);
    expect(result.allowed).toBe(true);
  });

  test("checkProjectCostLimit blocks when over limit", () => {
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "maxCostPerProject")).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: "0.001" }).where(eq(schema.appSettings.key, "maxCostPerProject")).run();
    } else {
      db.insert(schema.appSettings).values({ key: "maxCostPerProject", value: "0.001" }).run();
    }

    const result = checkProjectCostLimit(projectId);
    expect(result.allowed).toBe(false);

    // Restore
    db.update(schema.appSettings).set({ value: "0" }).where(eq(schema.appSettings.key, "maxCostPerProject")).run();
  });
});
