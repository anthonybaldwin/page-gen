// Preview server constants

// Port range
export const PREVIEW_PORT_MIN = 3001;
export const PREVIEW_PORT_MAX = 3020;
export const BACKEND_PORT_OFFSET = 1000;

// Host
export const DEFAULT_PREVIEW_HOST = "localhost";

// Vite timeouts & polling
export const VITE_READY_TIMEOUT = 15_000;
export const VITE_FETCH_TIMEOUT = 1000;
export const VITE_READY_POLL_INTERVAL = 500;
export const VITE_SHUTDOWN_DEADLINE = 3000;
export const VITE_SHUTDOWN_POLL = 200;

// Backend server
export const BACKEND_HEALTH_TIMEOUT = 1000;
export const BACKEND_READY_POLL = 500;
export const BACKEND_SHUTDOWN_DEADLINE = 3000;
export const BACKEND_SHUTDOWN_POLL = 200;
export const BACKEND_ENTRY_PATH = "server/index.ts";

// Vite config watch
export const VITE_WATCH_POLL = 300;

// PostCSS / Tailwind config files that conflict with @tailwindcss/vite plugin
export const TAILWIND_CONFLICT_FILES = [
  "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs", "postcss.config.ts",
  "tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts",
];
