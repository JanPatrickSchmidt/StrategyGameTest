/**
 * Liest Spec und Quelldateien des Repositorys für den Spec-Abgleich (E16b, E16c4).
 * Nur für Werkzeuge und Tests in `tools/sim`, nicht für die Engine (Datei-Ein-/Ausgabe).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { SourceFile } from "./specCoverage";

const SKIP = new Set(["node_modules", "dist", ".git", "sim-output", "docs"]);
// Die Tests des Abgleichs selbst enthalten Beispiel-Kennungen in Testnamen und würden das Ergebnis verfälschen.
const SELF = new Set(["specCoverage.test.ts", "specCoverage.ts", "specCoverageCli.ts", "specSources.ts", "specAcceptance.test.ts"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || SELF.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(path);
  }
}

export interface RepoSources {
  readonly spec: string;
  readonly tests: readonly SourceFile[];
  readonly others: readonly SourceFile[];
}

/** Spec `docs/spec/regeln-prototyp.md`, alle `*.test.ts` und übrigen `*.ts` unterhalb von `root`, sortiert. */
export function loadRepoSources(root: string): RepoSources {
  const spec = readFileSync(join(root, "docs/spec/regeln-prototyp.md"), "utf8");
  const files: string[] = [];
  walk(root, files);
  const load = (path: string): SourceFile => ({ path: relative(root, path), content: readFileSync(path, "utf8") });
  const tests = files.filter((path) => path.endsWith(".test.ts")).sort().map(load);
  const others = files.filter((path) => !path.endsWith(".test.ts")).sort().map(load);
  return { spec, tests, others };
}
