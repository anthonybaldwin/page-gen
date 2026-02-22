import { create } from "zustand";
import { api } from "../lib/api.ts";

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp3", "mp4", "wav", "ogg", "webm", "avi",
  "pdf", "zip", "tar", "gz", "rar", "7z",
  "exe", "dll", "so", "dylib", "bin",
  "db", "sqlite", "sqlite3",
]);

function isBinaryFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

type ActiveTab = "preview" | "editor";

interface OpenFile {
  path: string;
  projectId: string;
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  externallyChanged: boolean;
  /** Preview tabs are italic and replaced by the next single-click open */
  isPreview: boolean;
}

interface FileStoreState {
  // Core multi-file state
  openFiles: Record<string, OpenFile>;
  activeFilePath: string | null;
  activeTab: ActiveTab;

  // Derived from active file (kept flat for backward compat)
  openFilePath: string | null;
  openFileProjectId: string | null;
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  externallyChanged: boolean;

  // Actions
  openFile: (projectId: string, path: string, opts?: { preview?: boolean }) => Promise<void>;
  pinFile: (path?: string) => void;
  closeFile: (path?: string) => void;
  setActiveFile: (path: string) => void;
  updateContent: (content: string) => void;
  saveFile: () => Promise<void>;
  setActiveTab: (tab: ActiveTab) => void;
  handleExternalChange: (projectId: string, paths: string[]) => void;
  acceptExternal: () => void;
  dismissExternal: () => void;
}

function deriveActive(openFiles: Record<string, OpenFile>, activeFilePath: string | null) {
  if (!activeFilePath || !openFiles[activeFilePath]) {
    return {
      openFilePath: null as string | null,
      openFileProjectId: null as string | null,
      originalContent: "",
      currentContent: "",
      isDirty: false,
      isLoading: false,
      isSaving: false,
      externallyChanged: false,
    };
  }
  const f = openFiles[activeFilePath];
  return {
    openFilePath: f.path,
    openFileProjectId: f.projectId,
    originalContent: f.originalContent,
    currentContent: f.currentContent,
    isDirty: f.isDirty,
    isLoading: f.isLoading,
    isSaving: f.isSaving,
    externallyChanged: f.externallyChanged,
  };
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  openFiles: {},
  activeFilePath: null,
  activeTab: "preview",

  openFilePath: null,
  openFileProjectId: null,
  originalContent: "",
  currentContent: "",
  isDirty: false,
  isLoading: false,
  isSaving: false,
  externallyChanged: false,

  async openFile(projectId, path, opts) {
    const { openFiles } = get();
    const isPreview = opts?.preview ?? false;

    // Already open — just switch to it (and pin if double-clicked)
    if (openFiles[path]) {
      const updated = !isPreview && openFiles[path].isPreview
        ? { ...openFiles, [path]: { ...openFiles[path], isPreview: false } }
        : openFiles;
      set({
        openFiles: updated,
        activeFilePath: path,
        activeTab: "editor",
        ...deriveActive(updated, path),
      });
      return;
    }

    // If opening a preview, close any existing preview tab first
    let base = openFiles;
    if (isPreview) {
      const existingPreview = Object.keys(openFiles).find((p) => openFiles[p]?.isPreview);
      if (existingPreview) {
        const { [existingPreview]: _, ...rest } = openFiles;
        base = rest;
      }
    }

    // New file — add entry in loading state (binary files skip content fetch)
    const binary = isBinaryFile(path);
    const newFile: OpenFile = {
      path,
      projectId,
      originalContent: "",
      currentContent: "",
      isDirty: false,
      isLoading: !binary,
      isSaving: false,
      externallyChanged: false,
      isPreview,
    };
    const newOpenFiles = { ...base, [path]: newFile };
    set({
      openFiles: newOpenFiles,
      activeFilePath: path,
      activeTab: "editor",
      ...deriveActive(newOpenFiles, path),
    });

    // Binary files are rendered by dedicated preview components — no text fetch needed
    if (binary) return;

    try {
      const data = await api.get<{ content: string }>(`/files/read/${projectId}/${path}`);
      const current = get();
      if (current.openFiles[path]) {
        const updatedFile: OpenFile = {
          ...current.openFiles[path],
          originalContent: data.content,
          currentContent: data.content,
          isDirty: false,
          isLoading: false,
        };
        const updatedOpenFiles = { ...current.openFiles, [path]: updatedFile };
        set({
          openFiles: updatedOpenFiles,
          ...deriveActive(updatedOpenFiles, current.activeFilePath),
        });
      }
    } catch {
      const current = get();
      if (current.openFiles[path]) {
        const updatedFile: OpenFile = {
          ...current.openFiles[path],
          originalContent: "",
          currentContent: "Error loading file",
          isDirty: false,
          isLoading: false,
        };
        const updatedOpenFiles = { ...current.openFiles, [path]: updatedFile };
        set({
          openFiles: updatedOpenFiles,
          ...deriveActive(updatedOpenFiles, current.activeFilePath),
        });
      }
    }
  },

  pinFile(path?) {
    const { openFiles, activeFilePath } = get();
    const target = path ?? activeFilePath;
    if (!target || !openFiles[target] || !openFiles[target].isPreview) return;
    const pinned = { ...openFiles, [target]: { ...openFiles[target], isPreview: false } };
    set({
      openFiles: pinned,
      ...deriveActive(pinned, activeFilePath),
    });
  },

  closeFile(path?) {
    if (!path) {
      // No path — close all files (used on project switch)
      set({
        openFiles: {},
        activeFilePath: null,
        activeTab: "preview",
        ...deriveActive({}, null),
      });
      return;
    }

    const { openFiles, activeFilePath } = get();
    if (!openFiles[path]) return;

    const { [path]: _, ...remaining } = openFiles;
    const remainingPaths = Object.keys(remaining);

    let newActive: string | null = null;
    if (path === activeFilePath) {
      // Closing the active tab — pick a neighbor
      if (remainingPaths.length > 0) {
        const allPaths = Object.keys(openFiles);
        const idx = allPaths.indexOf(path);
        if (idx < allPaths.length - 1) {
          newActive = allPaths[idx + 1] ?? null; // prefer right neighbor
        } else {
          newActive = allPaths[idx - 1] ?? null; // fall back to left
        }
      }
    } else {
      newActive = activeFilePath;
    }

    set({
      openFiles: remaining,
      activeFilePath: newActive,
      activeTab: newActive ? "editor" : "preview",
      ...deriveActive(remaining, newActive),
    });
  },

  setActiveFile(path) {
    const { openFiles } = get();
    if (!openFiles[path]) return;
    set({
      activeFilePath: path,
      activeTab: "editor",
      ...deriveActive(openFiles, path),
    });
  },

  updateContent(content) {
    const { openFiles, activeFilePath } = get();
    if (!activeFilePath || !openFiles[activeFilePath]) return;
    const f = openFiles[activeFilePath];
    const updatedFile: OpenFile = {
      ...f,
      currentContent: content,
      isDirty: content !== f.originalContent,
      // Auto-pin when user starts editing
      isPreview: false,
    };
    const updatedOpenFiles = { ...openFiles, [activeFilePath]: updatedFile };
    set({
      openFiles: updatedOpenFiles,
      ...deriveActive(updatedOpenFiles, activeFilePath),
    });
  },

  async saveFile() {
    const { openFiles, activeFilePath } = get();
    if (!activeFilePath || !openFiles[activeFilePath]) return;
    const f = openFiles[activeFilePath];

    const savingFile: OpenFile = { ...f, isSaving: true };
    const savingOpenFiles = { ...openFiles, [activeFilePath]: savingFile };
    set({
      openFiles: savingOpenFiles,
      ...deriveActive(savingOpenFiles, activeFilePath),
    });

    try {
      await api.post(`/files/write/${f.projectId}`, { path: f.path, content: f.currentContent });
      const current = get();
      if (current.openFiles[activeFilePath]) {
        const savedFile: OpenFile = {
          ...current.openFiles[activeFilePath],
          originalContent: current.openFiles[activeFilePath].currentContent,
          isDirty: false,
          isSaving: false,
          externallyChanged: false,
        };
        const savedOpenFiles = { ...current.openFiles, [activeFilePath]: savedFile };
        set({
          openFiles: savedOpenFiles,
          ...deriveActive(savedOpenFiles, current.activeFilePath),
        });
      }
    } catch {
      const current = get();
      if (current.openFiles[activeFilePath]) {
        const failedFile: OpenFile = { ...current.openFiles[activeFilePath], isSaving: false };
        const failedOpenFiles = { ...current.openFiles, [activeFilePath]: failedFile };
        set({
          openFiles: failedOpenFiles,
          ...deriveActive(failedOpenFiles, current.activeFilePath),
        });
      }
    }
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  handleExternalChange(projectId, paths) {
    const { openFiles } = get();
    const updatedOpenFiles = { ...openFiles };
    let changed = false;

    for (const [filePath, file] of Object.entries(openFiles)) {
      if (file.projectId !== projectId) continue;
      if (!paths.some((p) => p === filePath || p === "__scaffold__" || p === "__checkout__")) continue;

      if (!file.isDirty) {
        // Silent re-fetch
        api.get<{ content: string }>(`/files/read/${projectId}/${filePath}`)
          .then((data) => {
            const current = get();
            if (current.openFiles[filePath] && current.openFiles[filePath].projectId === projectId) {
              const refreshed: OpenFile = {
                ...current.openFiles[filePath],
                originalContent: data.content,
                currentContent: data.content,
              };
              const refreshedOpenFiles = { ...current.openFiles, [filePath]: refreshed };
              set({
                openFiles: refreshedOpenFiles,
                ...deriveActive(refreshedOpenFiles, current.activeFilePath),
              });
            }
          })
          .catch(() => {});
      } else {
        updatedOpenFiles[filePath] = { ...file, externallyChanged: true };
        changed = true;
      }
    }

    if (changed) {
      const { activeFilePath } = get();
      set({
        openFiles: updatedOpenFiles,
        ...deriveActive(updatedOpenFiles, activeFilePath),
      });
    }
  },

  async acceptExternal() {
    const { openFiles, activeFilePath } = get();
    if (!activeFilePath || !openFiles[activeFilePath]) return;
    const f = openFiles[activeFilePath];
    try {
      const data = await api.get<{ content: string }>(`/files/read/${f.projectId}/${f.path}`);
      const current = get();
      if (current.openFiles[activeFilePath]) {
        const refreshed: OpenFile = {
          ...current.openFiles[activeFilePath],
          originalContent: data.content,
          currentContent: data.content,
          isDirty: false,
          externallyChanged: false,
        };
        const refreshedOpenFiles = { ...current.openFiles, [activeFilePath]: refreshed };
        set({
          openFiles: refreshedOpenFiles,
          ...deriveActive(refreshedOpenFiles, current.activeFilePath),
        });
      }
    } catch {
      const current = get();
      if (current.openFiles[activeFilePath]) {
        const dismissed: OpenFile = { ...current.openFiles[activeFilePath], externallyChanged: false };
        const dismissedOpenFiles = { ...current.openFiles, [activeFilePath]: dismissed };
        set({
          openFiles: dismissedOpenFiles,
          ...deriveActive(dismissedOpenFiles, current.activeFilePath),
        });
      }
    }
  },

  dismissExternal() {
    const { openFiles, activeFilePath } = get();
    if (!activeFilePath || !openFiles[activeFilePath]) return;
    const dismissed: OpenFile = { ...openFiles[activeFilePath], externallyChanged: false };
    const dismissedOpenFiles = { ...openFiles, [activeFilePath]: dismissed };
    set({
      openFiles: dismissedOpenFiles,
      ...deriveActive(dismissedOpenFiles, activeFilePath),
    });
  },
}));
