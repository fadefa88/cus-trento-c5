import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { devApi } from "./dev/devApi";

// Built into _site/admin-v2 by scripts/build_cloudflare_pages.sh.
export default defineConfig(({ command }) => ({
  base: "/admin-v2/",
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), ...(command === "serve" ? [devApi()] : [])],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5174, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
}));
