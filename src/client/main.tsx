import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useThemeStore } from "./stores/themeStore.ts";
import "./index.css";

useThemeStore.getState().initTheme();

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
