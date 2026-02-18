import { create } from "zustand";
import type { TokenUsage } from "../../shared/types.ts";

interface UsageState {
  records: TokenUsage[];
  totalTokens: number;
  totalCost: number;
  chatTokens: number;
  chatCost: number;
  activeChatId: string | null;
  setRecords: (records: TokenUsage[]) => void;
  addRecord: (record: TokenUsage) => void;
  setActiveChatId: (chatId: string | null) => void;
  addFromWs: (payload: {
    chatId: string;
    agentName: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costEstimate: number;
  }) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  records: [],
  totalTokens: 0,
  totalCost: 0,
  chatTokens: 0,
  chatCost: 0,
  activeChatId: null,

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

  setActiveChatId: (chatId) =>
    set({ activeChatId: chatId, chatTokens: 0, chatCost: 0 }),

  addFromWs: (payload) =>
    set((state) => {
      const newTotal = {
        totalTokens: state.totalTokens + payload.totalTokens,
        totalCost: state.totalCost + payload.costEstimate,
      };
      // Increment per-chat counters if this payload matches the active chat
      if (state.activeChatId && payload.chatId === state.activeChatId) {
        return {
          ...newTotal,
          chatTokens: state.chatTokens + payload.totalTokens,
          chatCost: state.chatCost + payload.costEstimate,
        };
      }
      return newTotal;
    }),
}));
