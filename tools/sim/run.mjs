// Startet ein Werkzeug aus tools/sim: bündelt den Einstieg mit esbuild für Node und führt es aus.
// Standard ist src/cli.ts (Simulation, E15); `--entry specCoverageCli` startet den Spec-Abgleich (E16b).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entryIndex = process.argv.indexOf("--entry");
const entry = entryIndex >= 0 ? process.argv[entryIndex + 1] : "cli";
if (entryIndex >= 0) process.argv.splice(entryIndex, 2);
if (!/^[A-Za-z]+$/.test(entry ?? "")) throw new Error(`Unbekannter Einstieg: ${entry}`);
const out = resolve(here, `dist/${entry}.mjs`);
mkdirSync(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(here, `src/${entry}.ts`)],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  outfile: out,
  logLevel: "warning",
});
await import(pathToFileURL(out).href);
