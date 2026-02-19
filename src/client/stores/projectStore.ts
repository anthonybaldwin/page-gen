import { create } from "zustand";
import type { Project } from "../../shared/types.ts";

interface ProjectState {
  projects: Project[];
  activeProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setActiveProject: (project: Project | null) => void;
  renameProject: (id: string, name: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProject: null,
  setProjects: (projects) => set({ projects }),
  setActiveProject: (project) => set({ activeProject: project }),
  renameProject: (id, name) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p)),
      activeProject:
        state.activeProject?.id === id
          ? { ...state.activeProject, name }
          : state.activeProject,
    })),
}));
