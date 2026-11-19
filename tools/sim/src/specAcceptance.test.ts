import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverage } from "./specCoverage";
import { loadRepoSources } from "./specSources";

// Abnahme M2 (E16c4), verschärft mit P10. R-19.2 (Animation nur aus dem Protokoll) ist seit C4a belegt
// (`apps/client/src/combatReplay.test.ts`); die Ausnahmeliste ist leer. Neue Ausnahmen nur mit Begründung,
// und sobald eine Regel hier Tests hat, muss sie aus der Liste gestrichen werden.
const OPEN_UNTIL_CLIENT = new Set<string>([]);

describe("E16c4: Spec-Abgleich als Abnahme von M2", () => {
  const { spec, tests, others } = loadRepoSources(resolve(__dirname, "../../.."));
  const report = coverage(spec, tests, others);

  it("E16c4: jede Regel der Spec hat einen Test mit ihrer Kennung (seit C4a auch R-19.2)", () => {
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
