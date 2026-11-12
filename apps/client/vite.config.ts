import { defineConfig } from "vite";

// Relative Pfade, damit der Build später auch unter docs/play/ auf GitHub Pages läuft (C7).
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 8000 },
});
