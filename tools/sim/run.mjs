// Startet das Simulations-Werkzeug (E15): bündelt src/cli.ts mit esbuild für Node und führt es aus.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "dist/cli.mjs");
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(here, "src/cli.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  outfile: out,
  logLevel: "warning",
});
await import(pathToFileURL(out).href);
