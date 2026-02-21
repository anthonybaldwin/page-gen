import { create } from "zustand";
import { api } from "../lib/api.ts";
import { useFileStore } from "./fileStore.ts";

export interface VersionEntry {
  sha: string;
  email: string;
  message: string;
  timestamp: number;
  isUserVersion: boolean;
  isInitial: boolean;
}

interface VersionViewState {
  activeVersionSha: string | null;
  projectId: string | null;
  versions: VersionEntry[];
  isPreviewing: boolean;
  previewSha: string | null;

  openVersion: (sha: string, projectId: string, versions: VersionEntry[]) => void;
  closeVersion: () => void;
  setActiveVersionSha: (sha: string) => void;
  setVersions: (versions: VersionEntry[]) => void;

  startPreview: (sha: string, projectId: string, versions: VersionEntry[]) => Promise<void>;
  stopPreview: (projectId: string) => Promise<void>;
  navigatePreview: (sha: string, projectId: string) => Promise<void>;
  clearPreviewState: () => void;
}

export const useVersionStore = create<VersionViewState>((set, get) => ({
  activeVersionSha: null,
  projectId: null,
  versions: [],
  isPreviewing: false,
  previewSha: null,

  openVersion(sha, projectId, versions) {
    set({ activeVersionSha: sha, projectId, versions });
  },

  closeVersion() {
    set({ activeVersionSha: null, projectId: null });
  },

  setActiveVersionSha(sha) {
    set({ activeVersionSha: sha });
  },

  setVersions(versions) {
    set({ versions });
  },

  async startPreview(sha, projectId, versions) {
    try {
      await api.post(`/versions/${sha}/preview?projectId=${projectId}`, {});
      set({
        isPreviewing: true,
        previewSha: sha,
        activeVersionSha: sha,
        projectId,
        versions,
      });
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      console.error("startPreview failed:", errObj?.error || err);
    }
  },

  async stopPreview(projectId) {
    try {
      await api.delete(`/versions/preview?projectId=${projectId}`);
    } catch {
      // Best effort
    }
    set({
      isPreviewing: false,
      previewSha: null,
      activeVersionSha: null,
    });
    // Close all editor tabs since files reverted
    useFileStore.getState().closeFile();
  },

  async navigatePreview(sha, projectId) {
    try {
      await api.post(`/versions/${sha}/preview?projectId=${projectId}`, {});
      set({
        previewSha: sha,
        activeVersionSha: sha,
      });
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      console.error("navigatePreview failed:", errObj?.error || err);
    }
  },

  clearPreviewState() {
    set({
      isPreviewing: false,
      previewSha: null,
      activeVersionSha: null,
    });
    useFileStore.getState().closeFile();
  },
}));
