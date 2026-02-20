import { describe, expect, test } from "bun:test";
import { inferCacheTokensFromLedgerRow, recomputeRowCost } from "../../src/server/services/billing-reconcile.ts";

describe("billing-reconcile helpers", () => {
  test("inferCacheTokensFromLedgerRow returns positive inferred cache tokens", () => {
    const row = {
      id: "r1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1800,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costEstimate: 0,
    };
    expect(inferCacheTokensFromLedgerRow(row)).toBe(600);
  });

  test("inferCacheTokensFromLedgerRow clamps negative inferred cache to zero", () => {
    const row = {
      id: "r2",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costEstimate: 0,
    };
    expect(inferCacheTokensFromLedgerRow(row)).toBe(0);
  });

  test("recomputeRowCost uses stored cache columns when available", () => {
    const row = {
      id: "r3",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1800,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 500,
      costEstimate: 0,
    };
    const calls: Array<{ create: number; read: number }> = [];
    const cost = recomputeRowCost(
      row,
      (_provider, _model, input, output, create = 0, read = 0) => {
        calls.push({ create, read });
        return input + output + create + read;
      },
    );
    expect(cost).toBe(1800);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ create: 100, read: 500 });
  });

  test("recomputeRowCost falls back to inference for legacy rows (no stored cache)", () => {
    const row = {
      id: "r4",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1800,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costEstimate: 0,
    };
    const calls: Array<{ create: number; read: number }> = [];
    recomputeRowCost(
      row,
      (_provider, _model, _input, _output, create = 0, read = 0) => {
        calls.push({ create, read });
        return 0;
      },
    );
    expect(calls).toHaveLength(1);
    // Legacy fallback assumes cache-creation (worst case)
    expect(calls[0]).toEqual({ create: 600, read: 0 });
  });
});
