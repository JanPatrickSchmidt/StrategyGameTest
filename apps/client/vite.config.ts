import { defineConfig } from "vite";

// Relative Pfade, damit der Build auch unter docs/play/ auf GitHub Pages läuft (C7).
// Babylon.js kommt in einen eigenen Block: Sein Dateiname (Inhalts-Hash) ändert sich nur mit der
// Babylon-Version, sodass ein neuer Build von Engine oder Client nur den kleinen Spiel-Block ersetzt.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "babylon", test: /node_modules[\\/]@babylonjs[\\/]/ }],
        },
      },
    },
  },
});
