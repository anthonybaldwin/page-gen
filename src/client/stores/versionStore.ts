import { create } from "zustand";

export interface VersionEntry {
  sha: string;
  email: string;
  message: string;
  timestamp: number;
  isUserVersion: boolean;
}

interface VersionViewState {
  activeVersionSha: string | null;
  projectId: string | null;
  versions: VersionEntry[];
  openVersion: (sha: string, projectId: string, versions: VersionEntry[]) => void;
  closeVersion: () => void;
  setActiveVersionSha: (sha: string) => void;
  setVersions: (versions: VersionEntry[]) => void;
}

export const useVersionStore = create<VersionViewState>((set) => ({
  activeVersionSha: null,
  projectId: null,
  versions: [],

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
}));
