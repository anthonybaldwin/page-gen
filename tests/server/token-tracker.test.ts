import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { trackTokenUsage, getSessionTokenTotal, trackProvisionalUsage, finalizeTokenUsage, voidProvisionalUsage, countProvisionalRecords, getEstimatedTokenTotal, finalizeOrphanedProvisionalRecords } from "../../src/server/services/token-tracker.ts";

describe("Token Tracker", () => {
  let projectId: string;
  let chatId: string;
  let executionId: string;

  beforeAll(() => {
    runMigrations();

    // Set up test data
    projectId = nanoid();
    chatId = nanoid();
    executionId = nanoid();

    db.insert(schema.projects).values({
      id: projectId,
      name: "Token Test",
      path: `./projects/${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: chatId,
      projectId,
      title: "Token Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.agentExecutions).values({
      id: executionId,
      chatId,
      agentName: "research",
      status: "completed",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();
  });

  test("tracks token usage", () => {
    const record = trackTokenUsage({
      executionId,
      chatId,
      agentName: "research",
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(record.id).toBeTruthy();
    expect(record.totalTokens).toBe(150);
    expect(record.costEstimate).toBeGreaterThan(0);
    expect(record.apiKeyHash).toHaveLength(64);
  });

  test("getSessionTokenTotal returns correct total", () => {
    const total = getSessionTokenTotal(chatId);
    expect(total).toBeGreaterThanOrEqual(150);
  });

  test("tracks multiple records", () => {
    const exec2 = nanoid();
    db.insert(schema.agentExecutions).values({
      id: exec2,
      chatId,
      agentName: "frontend-dev",
      status: "completed",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();

    trackTokenUsage({
      executionId: exec2,
      chatId,
      agentName: "frontend-dev",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key-2",
      inputTokens: 500,
      outputTokens: 200,
    });

    const total = getSessionTokenTotal(chatId);
    expect(total).toBeGreaterThanOrEqual(850); // 150 + 700
  });

  test("cost estimation uses model pricing", () => {
    const record = trackTokenUsage({
      executionId,
      chatId,
      agentName: "orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "test-key",
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Opus pricing: $5/M input + $25/M output
    // Expected: (1000 * 5 + 500 * 25) / 1_000_000 = 0.0175
    expect(record.costEstimate).toBeCloseTo(0.0175, 4);
  });

  test("cost estimation includes cache tokens", () => {
    const record = trackTokenUsage({
      executionId,
      chatId,
      agentName: "frontend-dev",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 1000,
      cacheReadInputTokens: 2000,
    });

    // Sonnet: $3/M input, $15/M output
    // inputCost = 500 * 3 = 1500
    // outputCost = 200 * 15 = 3000
    // cacheCreateCost = 1000 * 3 * 1.25 = 3750
    // cacheReadCost = 2000 * 3 * 0.1 = 600
    // total = (1500 + 3000 + 3750 + 600) / 1_000_000 = 0.00885
    expect(record.costEstimate).toBeCloseTo(0.00885, 5);
  });
});

describe("Provisional Token Tracking", () => {
  let projectId: string;
  let chatId: string;
  let executionId: string;

  beforeAll(() => {
    runMigrations();

    projectId = nanoid();
    chatId = nanoid();
    executionId = nanoid();

    db.insert(schema.projects).values({
      id: projectId,
      name: "Provisional Test",
      path: `./projects/${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: chatId,
      projectId,
      title: "Provisional Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.agentExecutions).values({
      id: executionId,
      chatId,
      agentName: "test-agent",
      status: "running",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();
  });

  test("trackProvisionalUsage inserts estimated records", () => {
    const ids = trackProvisionalUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      estimatedInputTokens: 5000,
      projectId,
    });

    expect(ids.tokenUsageId).toBeTruthy();
    expect(ids.billingLedgerId).toBeTruthy();

    // Verify the record is marked as estimated
    const record = db.select().from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId)).get();
    expect(record).toBeTruthy();
    expect(record!.estimated).toBe(1);
    expect(record!.inputTokens).toBe(5000);
  });

  test("finalizeTokenUsage updates records with actual values", () => {
    const ids = trackProvisionalUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      estimatedInputTokens: 5000,
      projectId,
    });

    finalizeTokenUsage(ids, {
      inputTokens: 4200,
      outputTokens: 800,
    }, "anthropic", "claude-sonnet-4-6");

    // Check token_usage record is finalized
    const record = db.select().from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId)).get();
    expect(record!.estimated).toBe(0);
    expect(record!.inputTokens).toBe(4200);
    expect(record!.outputTokens).toBe(800);
    expect(record!.totalTokens).toBe(5000);

    // Check billing_ledger record is finalized
    const ledger = db.select().from(schema.billingLedger)
      .where(eq(schema.billingLedger.id, ids.billingLedgerId)).get();
    expect(ledger!.estimated).toBe(0);
    expect(ledger!.inputTokens).toBe(4200);
  });

  test("countProvisionalRecords returns count of estimated=1 records", () => {
    const beforeCount = countProvisionalRecords();

    // Add a provisional record
    trackProvisionalUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      estimatedInputTokens: 1000,
      projectId,
    });

    const afterCount = countProvisionalRecords();
    expect(afterCount).toBe(beforeCount + 1);
  });

  test("getEstimatedTokenTotal sums only provisional records", () => {
    const total = getEstimatedTokenTotal();
    expect(total).toBeGreaterThan(0);
  });

  test("provisional records count toward session token total", () => {
    const total = getSessionTokenTotal(chatId);
    expect(total).toBeGreaterThan(0);
  });

  test("voidProvisionalUsage deletes both token_usage and billing_ledger records", () => {
    const ids = trackProvisionalUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      estimatedInputTokens: 3000,
      projectId,
    });

    // Verify records exist
    const beforeToken = db.select().from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId)).get();
    const beforeLedger = db.select().from(schema.billingLedger)
      .where(eq(schema.billingLedger.id, ids.billingLedgerId)).get();
    expect(beforeToken).toBeTruthy();
    expect(beforeLedger).toBeTruthy();

    // Void them
    voidProvisionalUsage(ids);

    // Verify records are deleted
    const afterToken = db.select().from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId)).get();
    const afterLedger = db.select().from(schema.billingLedger)
      .where(eq(schema.billingLedger.id, ids.billingLedgerId)).get();
    expect(afterToken).toBeUndefined();
    expect(afterLedger).toBeUndefined();
  });

  test("finalizeOrphanedProvisionalRecords sets estimated=0 on orphaned records", () => {
    // Create a provisional record
    const ids = trackProvisionalUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      estimatedInputTokens: 2000,
      projectId,
    });

    // Verify it's provisional
    const beforeLedger = db.select().from(schema.billingLedger)
      .where(eq(schema.billingLedger.id, ids.billingLedgerId)).get();
    expect(beforeLedger!.estimated).toBe(1);

    // Finalize orphaned records
    const count = finalizeOrphanedProvisionalRecords();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify it's now finalized
    const afterLedger = db.select().from(schema.billingLedger)
      .where(eq(schema.billingLedger.id, ids.billingLedgerId)).get();
    expect(afterLedger!.estimated).toBe(0);

    const afterToken = db.select().from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId)).get();
    expect(afterToken!.estimated).toBe(0);
  });

  test("dual-write operations are atomic (transaction test)", () => {
    // Verify that trackTokenUsage writes to both tables
    const beforeTokenCount = db.select().from(schema.tokenUsage).all().length;
    const beforeLedgerCount = db.select().from(schema.billingLedger).all().length;

    trackTokenUsage({
      executionId,
      chatId,
      agentName: "test-agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key",
      inputTokens: 100,
      outputTokens: 50,
      projectId,
    });

    const afterTokenCount = db.select().from(schema.tokenUsage).all().length;
    const afterLedgerCount = db.select().from(schema.billingLedger).all().length;

    // Both tables should have exactly one new record
    expect(afterTokenCount).toBe(beforeTokenCount + 1);
    expect(afterLedgerCount).toBe(beforeLedgerCount + 1);
  });
});
