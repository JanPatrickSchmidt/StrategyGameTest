/**
 * Befehlszeile des Simulations-Werkzeugs (E15). Aufruf über `npm run sim -- --games 100`.
 * Schreibt die CSV (Vorgabe `sim-output/sim-<seed>-<games>.csv`) und eine Zusammenfassung auf stderr.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadGameData } from "@game/engine";
import { checkAcceptance, formatAcceptance } from "./acceptance";
import { parseArgs, runSimulation, summarize, toCsv } from "./sim";

function main(argv: readonly string[]): number {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("Aufruf: npm run sim -- --games 100 [--seed 1] [--bots greedy|random|greedy,random,random,random] [--leaders random|rotate|brann,ilyra,vex,morgra] [--no-rotate-bots] [--check] [--out datei.csv|-]\n");
    return 2;
  }
  const data = loadGameData();
  const started = performance.now();
  const result = runSimulation(data, options);
  const seconds = (performance.now() - started) / 1000;
  const csv = toCsv(result);
  if (options.out === "-") {
    process.stdout.write(csv);
  } else {
    const out = resolve(options.out ?? `sim-output/sim-${options.seed}-${options.games}.csv`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, csv);
    process.stderr.write(`CSV geschrieben: ${out}\n`);
  }
  process.stderr.write(`${summarize(result)}\nDauer: ${seconds.toFixed(1)} s\n`);
  if (options.check) {
    const report = checkAcceptance(data, result, options.games);
    process.stderr.write(`${formatAcceptance(report, data.config.maxRounds)}\n`);
    if (!report.passed) return 1;
  }
  return result.failures.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
