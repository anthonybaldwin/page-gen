import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VITE_DEV_PORT, DEFAULT_PORT } from "./src/server/config/server.ts";
import { VITE_WATCH_POLL } from "./src/server/config/preview.ts";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: VITE_DEV_PORT,
    host: true,
    watch: {
      usePolling: true,
      interval: VITE_WATCH_POLL,
    },
    proxy: {
      "/api": {
        target: `http://localhost:${DEFAULT_PORT}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://localhost:${DEFAULT_PORT}`,
        ws: true,
      },
    },
  },
  preview: {
    port: VITE_DEV_PORT,
    host: true,
    proxy: {
      "/api": {
        target: `http://localhost:${DEFAULT_PORT}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://localhost:${DEFAULT_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "vendor-react";
          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("micromark") || id.includes("mdast") || id.includes("unified") || id.includes("unist") || id.includes("hast")) return "vendor-markdown";
          if (id.includes("@radix-ui/") || id.includes("radix-ui/")) return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@codemirror/") || id.includes("@uiw/react-codemirror") || id.includes("@lezer/")) return "vendor-codemirror";
        },
      },
    },
  },
});
