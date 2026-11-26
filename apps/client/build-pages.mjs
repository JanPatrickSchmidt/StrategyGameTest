// Baut die Partie gegen 3 Bots als statische Seite nach docs/play/ (C7, GitHub Pages:
// https://janpatrickschmidt.github.io/StrategyGameTest/play/). Ersetzt nur docs/play/index.html und
// docs/play/assets/; die Kampf-Sandbox (docs/play/sandbox.html) bleibt unberührt.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../docs/play");

rmSync(resolve(outDir, "index.html"), { force: true });
rmSync(resolve(outDir, "assets"), { recursive: true, force: true });

await build({
  root: here,
  configFile: resolve(here, "vite.config.ts"),
  logLevel: "warn",
  build: { outDir, emptyOutDir: false },
});

if (!existsSync(resolve(outDir, "index.html"))) throw new Error("docs/play/index.html wurde nicht erzeugt");
const assets = readdirSync(resolve(outDir, "assets"));
console.log(`Spiel gebaut: ${outDir}/index.html mit ${assets.length} Dateien in assets/ (${assets.join(", ")})`);
