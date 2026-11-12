/**
 * Befehlszeile des Spec-Abgleichs (E16b). Aufruf über `npm run check:spec [-- --table datei.md]`.
 * Liest `docs/spec/regeln-prototyp.md` und alle `*.test.ts` im Repository, meldet Regeln ohne Test.
 * Exit-Code ist immer 0 (Bericht, keine Abnahmeprüfung), außer bei Lesefehlern.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { coverage, coverageTable, formatCoverage } from "./specCoverage";
import { loadRepoSources } from "./specSources";

function main(argv: readonly string[]): number {
  const { spec, tests, others } = loadRepoSources(resolve("."));
  const report = coverage(spec, tests, others);
  process.stdout.write(`${formatCoverage(report)}\n`);
  const tableIndex = argv.indexOf("--table");
  if (tableIndex >= 0) {
    const target = argv[tableIndex + 1];
    if (target === undefined) {
      process.stderr.write("Aufruf: npm run check:spec [-- --table datei.md]\n");
      return 2;
    }
    const out = resolve(target);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${coverageTable(report)}\n`);
    process.stderr.write(`Tabelle geschrieben: ${out}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
