import { create } from "zustand";
import type { TokenUsage } from "../../shared/types.ts";

interface UsageState {
  records: TokenUsage[];
  totalTokens: number;
  totalCost: number;
  chatTokens: number;
  chatCost: number;
  activeChatId: string | null;
  projectTokens: number;
  projectCost: number;
  activeProjectId: string | null;
  setRecords: (records: TokenUsage[]) => void;
  addRecord: (record: TokenUsage) => void;
  setActiveChatId: (chatId: string | null) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setLifetimeCost: (cost: number) => void;
  seedChatCost: (cost: number) => void;
  seedProjectCost: (cost: number) => void;
  addFromWs: (payload: {
    chatId: string;
    projectId?: string;
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
  projectTokens: 0,
  projectCost: 0,
  activeProjectId: null,

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

  setActiveProjectId: (projectId) =>
    set({ activeProjectId: projectId, projectTokens: 0, projectCost: 0 }),

  setLifetimeCost: (cost) =>
    set({ totalCost: cost }),

  seedChatCost: (cost) =>
    set({ chatCost: cost }),

  seedProjectCost: (cost) =>
    set({ projectCost: cost }),

  addFromWs: (payload) =>
    set((state) => {
      const newTotal = {
        totalTokens: state.totalTokens + payload.totalTokens,
        totalCost: state.totalCost + payload.costEstimate,
      };
      const chatUpdate =
        state.activeChatId && payload.chatId === state.activeChatId
          ? {
              chatTokens: state.chatTokens + payload.totalTokens,
              chatCost: state.chatCost + payload.costEstimate,
            }
          : {};
      const projectUpdate =
        state.activeProjectId && payload.projectId === state.activeProjectId
          ? {
              projectTokens: state.projectTokens + payload.totalTokens,
              projectCost: state.projectCost + payload.costEstimate,
            }
          : {};
      return { ...newTotal, ...chatUpdate, ...projectUpdate };
    }),
}));
