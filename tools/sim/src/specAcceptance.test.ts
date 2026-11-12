import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverage } from "./specCoverage";
import { loadRepoSources } from "./specSources";

// Abnahme M2 (E16c4): Nur die Client-Regeln dürfen noch ohne Test sein; sie werden mit C3 und C4 belegt.
const OPEN_UNTIL_CLIENT = new Set(["R-3.8", "R-19.2"]);

describe("E16c4: Spec-Abgleich als Abnahme von M2", () => {
  const { spec, tests, others } = loadRepoSources(resolve(__dirname, "../../.."));
  const report = coverage(spec, tests, others);

  it("E16c4: jede Regel der Spec außer R-3.8 und R-19.2 hat einen Test mit ihrer Kennung", () => {
    expect(report.rules.length).toBeGreaterThan(100);
    const open = report.uncovered.map((entry) => entry.rule.id).filter((id) => !OPEN_UNTIL_CLIENT.has(id));
    expect(open).toEqual([]);
  });

  it("E16c4: keine Testnamen mit Kennungen, die die Spec nicht definiert", () => {
    expect(report.unknownIds.map((entry) => entry.id)).toEqual([]);
  });
});
