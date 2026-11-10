/**
 * Befehlszeile des Spec-Abgleichs (E16b). Aufruf über `npm run check:spec [-- --table datei.md]`.
 * Liest `docs/spec/regeln-prototyp.md` und alle `*.test.ts` im Repository, meldet Regeln ohne Test.
 * Exit-Code ist immer 0 (Bericht, keine Abnahmeprüfung), außer bei Lesefehlern.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { coverage, coverageTable, formatCoverage, type SourceFile } from "./specCoverage";

const SKIP = new Set(["node_modules", "dist", ".git", "sim-output", "docs"]);
// Die Tests des Abgleichs selbst enthalten Beispiel-Kennungen in Testnamen und würden das Ergebnis verfälschen.
const SELF = new Set(["specCoverage.test.ts", "specCoverage.ts", "specCoverageCli.ts"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || SELF.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(path);
  }
}

function main(argv: readonly string[]): number {
  const root = resolve(".");
  const spec = readFileSync(join(root, "docs/spec/regeln-prototyp.md"), "utf8");
  const files: string[] = [];
  walk(root, files);
  const load = (path: string): SourceFile => ({ path: relative(root, path), content: readFileSync(path, "utf8") });
  const tests = files.filter((path) => path.endsWith(".test.ts")).sort().map(load);
  const others = files.filter((path) => !path.endsWith(".test.ts")).sort().map(load);
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
