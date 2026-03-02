// Preview server constants

// Port range
export const PREVIEW_PORT_MIN = 3001;
export const PREVIEW_PORT_MAX = 3020;
export const BACKEND_PORT_OFFSET = 1000;

// Host
export const DEFAULT_PREVIEW_HOST = "localhost";

// Preview timeouts & polling
export const PREVIEW_READY_TIMEOUT = 15_000;
export const PREVIEW_FETCH_TIMEOUT = 1000;
export const PREVIEW_READY_POLL_INTERVAL = 500;
export const PREVIEW_SHUTDOWN_DEADLINE = 3000;
export const PREVIEW_SHUTDOWN_POLL = 200;

// Backend server
export const BACKEND_HEALTH_TIMEOUT = 1000;
export const BACKEND_READY_POLL = 500;
export const BACKEND_SHUTDOWN_DEADLINE = 3000;
export const BACKEND_SHUTDOWN_POLL = 200;
export const BACKEND_ENTRY_PATH = "server/index.ts";

// PostCSS / Tailwind config files that conflict with bun-plugin-tailwind
export const TAILWIND_CONFLICT_FILES = [
  "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs", "postcss.config.ts",
  "tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts",
];
