import { create } from "zustand";
import { api } from "../lib/api.ts";

type ActiveTab = "preview" | "editor";

interface FileStoreState {
  openFilePath: string | null;
  openFileProjectId: string | null;
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  externallyChanged: boolean;
  activeTab: ActiveTab;

  openFile: (projectId: string, path: string) => Promise<void>;
  closeFile: () => void;
  updateContent: (content: string) => void;
  saveFile: () => Promise<void>;
  setActiveTab: (tab: ActiveTab) => void;
  handleExternalChange: (projectId: string, paths: string[]) => void;
  acceptExternal: () => void;
  dismissExternal: () => void;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  openFilePath: null,
  openFileProjectId: null,
  originalContent: "",
  currentContent: "",
  isDirty: false,
  isLoading: false,
  isSaving: false,
  externallyChanged: false,
  activeTab: "preview",

  async openFile(projectId, path) {
    set({ isLoading: true, openFilePath: path, openFileProjectId: projectId, activeTab: "editor", externallyChanged: false });
    try {
      const data = await api.get<{ content: string }>(`/files/read/${projectId}/${path}`);
      set({ originalContent: data.content, currentContent: data.content, isDirty: false, isLoading: false });
    } catch {
      set({ originalContent: "", currentContent: "Error loading file", isDirty: false, isLoading: false });
    }
  },

  closeFile() {
    set({
      openFilePath: null,
      openFileProjectId: null,
      originalContent: "",
      currentContent: "",
      isDirty: false,
      isLoading: false,
      isSaving: false,
      externallyChanged: false,
      activeTab: "preview",
    });
  },

  updateContent(content) {
    const { originalContent } = get();
    set({ currentContent: content, isDirty: content !== originalContent });
  },

  async saveFile() {
    const { openFileProjectId, openFilePath, currentContent } = get();
    if (!openFileProjectId || !openFilePath) return;
    set({ isSaving: true });
    try {
      await api.post(`/files/write/${openFileProjectId}`, { path: openFilePath, content: currentContent });
      set({ originalContent: currentContent, isDirty: false, isSaving: false, externallyChanged: false });
    } catch {
      set({ isSaving: false });
    }
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  handleExternalChange(projectId, paths) {
    const { openFilePath, openFileProjectId, isDirty } = get();
    if (!openFilePath || openFileProjectId !== projectId) return;
    if (!paths.some((p) => p === openFilePath || p === "__scaffold__")) return;

    if (!isDirty) {
      // Silent re-fetch
      const { openFile } = get();
      // Keep on editor tab, re-fetch content
      api.get<{ content: string }>(`/files/read/${projectId}/${openFilePath}`).then((data) => {
        const current = get();
        if (current.openFilePath === openFilePath && current.openFileProjectId === projectId) {
          set({ originalContent: data.content, currentContent: data.content });
        }
      }).catch(() => {});
    } else {
      set({ externallyChanged: true });
    }
  },

  async acceptExternal() {
    const { openFileProjectId, openFilePath } = get();
    if (!openFileProjectId || !openFilePath) return;
    try {
      const data = await api.get<{ content: string }>(`/files/read/${openFileProjectId}/${openFilePath}`);
      set({ originalContent: data.content, currentContent: data.content, isDirty: false, externallyChanged: false });
    } catch {
      set({ externallyChanged: false });
    }
  },

  dismissExternal() {
    set({ externallyChanged: false });
  },
}));
