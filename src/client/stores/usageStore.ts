import { create } from "zustand";
import type { TokenUsage } from "../../shared/types.ts";

interface UsageState {
  records: TokenUsage[];
  totalTokens: number;
  totalCost: number;
  setRecords: (records: TokenUsage[]) => void;
  addRecord: (record: TokenUsage) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  records: [],
  totalTokens: 0,
  totalCost: 0,
  setRecords: (records) =>
    set({
      records,
      totalTokens: records.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost: records.reduce((sum, r) => sum + r.costEstimate, 0),
    }),
  addRecord: (record) =>
    set((state) => {
      const records = [...state.records, record];
      return {
        records,
        totalTokens: state.totalTokens + record.totalTokens,
        totalCost: state.totalCost + record.costEstimate,
      };
    }),
}));
