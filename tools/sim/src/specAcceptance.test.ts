import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverage } from "./specCoverage";
import { loadRepoSources } from "./specSources";

// Abnahme M2 (E16c4), verschärft mit P10: Nur R-19.2 (Animation nur aus dem Protokoll) darf noch ohne Test
// sein; sie wird mit C4 belegt. Sobald eine Regel hier Tests hat, muss sie aus der Liste gestrichen werden.
const OPEN_UNTIL_CLIENT = new Set(["R-19.2"]);

describe("E16c4: Spec-Abgleich als Abnahme von M2", () => {
  const { spec, tests, others } = loadRepoSources(resolve(__dirname, "../../.."));
  const report = coverage(spec, tests, others);

  it("E16c4: jede Regel der Spec außer R-19.2 hat einen Test mit ihrer Kennung", () => {
    expect(report.rules.length).toBeGreaterThan(100);
    const open = report.uncovered.map((entry) => entry.rule.id).filter((id) => !OPEN_UNTIL_CLIENT.has(id));
    expect(open).toEqual([]);
  });

  it("P10: keine ausgenommene Regel hat schon Tests (sonst aus der Ausnahmeliste streichen)", () => {
    const alreadyCovered = report.covered.map((entry) => entry.rule.id).filter((id) => OPEN_UNTIL_CLIENT.has(id));
    expect(alreadyCovered).toEqual([]);
  });

  it("P10: jede ausgenommene Regel ist in der Spec definiert", () => {
    const known = new Set(report.rules.map((entry) => entry.rule.id));
    expect([...OPEN_UNTIL_CLIENT].filter((id) => !known.has(id))).toEqual([]);
  });

  it("E16c4: keine Testnamen mit Kennungen, die die Spec nicht definiert", () => {
    expect(report.unknownIds.map((entry) => entry.id)).toEqual([]);
  });
});
