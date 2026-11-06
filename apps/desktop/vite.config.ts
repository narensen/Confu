import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The window's page: packages/app, bundled for Electron.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "chrome140", chunkSizeWarningLimit: 4000 },
  worker: { format: "es" },
  // SQLite finds its .wasm next to itself; pre-bundling would move it.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  server: { port: 5181, strictPort: true },
});
