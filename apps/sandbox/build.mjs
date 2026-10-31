// Baut die Kampf-Sandbox als eine einzige, eigenständige HTML-Datei nach docs/play/sandbox.html (D1).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/play/sandbox.html");

const result = await build({
  entryPoints: [resolve(here, "src/main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = readFileSync(resolve(here, "index.html"), "utf8");
if (!template.includes("<!-- SCRIPT -->")) throw new Error("Platzhalter <!-- SCRIPT --> fehlt in index.html");
const html = template.replace("<!-- SCRIPT -->", () => `<script>${js}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Kampf-Sandbox gebaut: ${out} (${Math.round(html.length / 1024)} KB)`);
