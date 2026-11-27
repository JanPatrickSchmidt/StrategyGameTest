/**
 * Befehlszeile der Kampf-Kalibrierung (B0). Aufruf über `npm run calibrate -- --battles 2000 --budget 6,10,15`.
 * Schreibt `karten.csv` und `zweikampf.csv` (Vorgabe `sim-output/kalibrierung-<seed>-<budget>/`) und eine
 * Zusammenfassung als Markdown auf stdout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadGameData } from "@game/engine";
import { cardsCsv, duelsCsv, parseCalibrationArgs, runCalibration, summarizeCalibration } from "./calibration";

function main(argv: readonly string[]): number {
  const data = loadGameData();
  let options;
  try {
    options = parseCalibrationArgs(argv, data.config.boardCapacity);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(
      "Aufruf: npm run calibrate -- [--battles 2000] [--seed 1] [--budget 10 | 6,10,15] [--max-units 5] [--no-star2] [--same-count] [--duel-repeats 40] [--out ordner]\n",
    );
    return 2;
  }
  const started = performance.now();
  const result = runCalibration(data, options);
  const seconds = (performance.now() - started) / 1000;
  const suffix = options.sameUnitCount ? "-gleichzahl" : "";
  const dir = resolve(options.out ?? `sim-output/kalibrierung-${options.seed}-${options.budgets.join("-")}${suffix}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "karten.csv"), cardsCsv(result));
  writeFileSync(resolve(dir, "zweikampf.csv"), duelsCsv(result));
  process.stdout.write(`${summarizeCalibration(result)}\n`);
  process.stderr.write(`CSV geschrieben: ${dir}\nDauer: ${seconds.toFixed(1)} s\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
