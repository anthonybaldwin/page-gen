import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
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
        },
      },
    },
  },
});
