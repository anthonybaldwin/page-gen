import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
  initTheme: () => () => void;
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (localStorage.getItem("theme") as Theme) || "dark",
  resolvedTheme: "dark",

  setTheme(theme: Theme) {
    localStorage.setItem("theme", theme);
    const resolved = theme === "system" ? getSystemTheme() : theme;
    applyTheme(resolved);
    set({ theme, resolvedTheme: resolved });
  },

  initTheme() {
    const { theme } = get();
    const resolved = theme === "system" ? getSystemTheme() : theme;
    applyTheme(resolved);
    set({ resolvedTheme: resolved });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const current = get().theme;
      if (current === "system") {
        const newResolved = getSystemTheme();
        applyTheme(newResolved);
        set({ resolvedTheme: newResolved });
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  },
}));
