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
      costEstimate: 0,
    };
    expect(inferCacheTokensFromLedgerRow(row)).toBe(0);
  });

  test("recomputeRowCost routes inferred cache as creation tokens in create mode", () => {
    const row = {
      id: "r3",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1800,
      costEstimate: 0,
    };
    const calls: Array<{ create: number; read: number }> = [];
    const cost = recomputeRowCost(
      row,
      (_provider, _model, input, output, create = 0, read = 0) => {
        calls.push({ create, read });
        return input + output + create + read;
      },
      "create",
    );
    expect(cost).toBe(1800);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ create: 600, read: 0 });
  });

  test("recomputeRowCost routes inferred cache as read tokens in read mode", () => {
    const row = {
      id: "r4",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1800,
      costEstimate: 0,
    };
    const calls: Array<{ create: number; read: number }> = [];
    recomputeRowCost(
      row,
      (_provider, _model, _input, _output, create = 0, read = 0) => {
        calls.push({ create, read });
        return 0;
      },
      "read",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ create: 0, read: 600 });
  });
});

