import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRuleIds, coverage, coverageTable, leafRules, parseSpecRules, parseTestTitles, ruleIdsIn } from "./specCoverage";

const SPEC = [
  "# Regel-Spezifikation",
  "",
  "Fließtext nennt R-99.1, definiert sie aber nicht.",
  "## R-1 Grundbegriffe",
  "- **R-1.1 Spieler:** genau 4.",
  "- **R-1.2** Die Spieler sitzen im Ring.",
  "## R-5 Rundenablauf",
  "1. **Rundenbeginn (R-6)**",
  "## R-9 Kampf",
  "### R-9.1 Teilnehmer",
  "### R-9.10 Später",
  "## R-17a Zeitpunkte",
  "- **R-17a.1 Pro Runde:** …",
  "## R-18 Sicht",
  "- **R-18.2 Privat:** …",
  "- **R-18.2a Deck:** …",
].join("\n");

describe("E16b: Spec-Abgleich – Regeln lesen", () => {
  it("E16b: Überschriften und fette Kennungen am Anfang eines Aufzählungspunkts definieren Regeln, Fließtext nicht", () => {
    const ids = parseSpecRules(SPEC).map((rule) => rule.id);
    expect(ids).toEqual(["R-1", "R-1.1", "R-1.2", "R-5", "R-9", "R-9.1", "R-9.10", "R-17a", "R-17a.1", "R-18", "R-18.2", "R-18.2a"]);
  });

  it("E16b: Titel aus dem fetten Namen, sonst aus dem Regeltext; Abschnitt und Zeile stimmen", () => {
    const rules = parseSpecRules(SPEC);
    expect(rules.find((rule) => rule.id === "R-1.1")).toMatchObject({ title: "Spieler", section: "R-1 Grundbegriffe", line: 5 });
    expect(rules.find((rule) => rule.id === "R-1.2")?.title).toBe("Die Spieler sitzen im Ring.");
    expect(rules.find((rule) => rule.id === "R-9.1")).toMatchObject({ title: "Teilnehmer", section: "R-9 Kampf" });
  });

  it("E16b: nur Blätter zählen – R-9 hat Unterregeln, R-5 nicht; R-18.2 und R-18.2a sind beide Blätter", () => {
    const leaves = leafRules(parseSpecRules(SPEC)).map((rule) => rule.id);
    expect(leaves).toEqual(["R-1.1", "R-1.2", "R-5", "R-9.1", "R-9.10", "R-17a.1", "R-18.2", "R-18.2a"]);
  });

  it("E16b: Kennungen werden ganz gelesen (R-9.10 ist nicht R-9.1, ein Satzpunkt gehört nicht dazu)", () => {
    expect(ruleIdsIn("R-9.10 und R-9.1. Dazu R-17a.1/R-18.2a, nochmal R-9.1")).toEqual(["R-9.10", "R-9.1", "R-17a.1", "R-18.2a"]);
  });

  it("E16b: natürliche Sortierung der Kennungen", () => {
    const ids = ["R-10.1", "R-2.5", "R-17a.1", "R-17.5", "R-7.10", "R-7.9", "R-18.2a", "R-18.2"];
    expect([...ids].sort(compareRuleIds)).toEqual(["R-2.5", "R-7.9", "R-7.10", "R-10.1", "R-17.5", "R-17a.1", "R-18.2", "R-18.2a"]);
  });
});

describe("E16b: Spec-Abgleich – Testnamen lesen", () => {
  it("E16b: it, test und describe mit allen Anführungszeichen, auch .each und .skip, mit Zeilennummer", () => {
    const source = [
      'describe("R-9.1: Teilnehmer", () => {',
      "  it('R-1.1: vier Spieler', () => {});",
      "  it.each([[1, 2]])(`R-9.10: Stufe ${level}`, () => {});",
      '  test.skip("ohne Kennung", () => {});',
      "  // it(\"R-1.2: nur ein Kommentar\") zählt als Testname, weil es wie einer aussieht",
      "});",
    ].join("\n");
    const titles = parseTestTitles("a.test.ts", source);
    expect(titles.map((title) => [title.kind, title.line, ruleIdsIn(title.title)])).toEqual([
      ["describe", 1, ["R-9.1"]],
      ["test", 2, ["R-1.1"]],
      ["test", 3, ["R-9.10"]],
      ["test", 4, []],
      ["test", 5, ["R-1.2"]],
    ]);
  });
});

describe("E16b: Spec-Abgleich – Abdeckung", () => {
  it("E16b: Regel mit Kennung in einem Testnamen gilt als getestet, Erwähnung nur im Kommentar nicht", () => {
    const tests = [
      { path: "x.test.ts", content: 'it("R-1.1/R-9.10: zwei auf einmal", () => {\n  // R-1.2: nur erwähnt\n});\nit("R-42.1: veraltet", () => {});' },
    ];
    const others = [{ path: "x.ts", content: "/** R-5 Rundenablauf */" }];
    const report = coverage(SPEC, tests, others);
    expect(report.covered.map((entry) => entry.rule.id)).toEqual(["R-1.1", "R-9.10"]);
    expect(report.uncovered.map((entry) => entry.rule.id)).toEqual(["R-1.2", "R-5", "R-9.1", "R-17a.1", "R-18.2", "R-18.2a"]);
    expect(report.uncovered.find((entry) => entry.rule.id === "R-1.2")?.mentionedIn).toEqual(["x.test.ts"]);
    expect(report.uncovered.find((entry) => entry.rule.id === "R-5")?.mentionedIn).toEqual(["x.ts"]);
    expect(report.unknownIds.map((unknown) => unknown.id)).toEqual(["R-42.1"]);
  });

  it("E16b: Tabelle enthält jede Blatt-Regel mit Testzahl und erstem Fundort", () => {
    const report = coverage(SPEC, [{ path: "x.test.ts", content: 'it("R-1.1: a", () => {});\nit("R-1.1: b", () => {});' }]);
    const table = coverageTable(report).split("\n");
    expect(table).toHaveLength(2 + 8);
    expect(table[2]).toBe("| R-1.1 | Spieler | 2 | `x.test.ts`:1 |");
    expect(table[3]).toBe("| R-1.2 | Die Spieler sitzen im Ring. | 0 | – |");
  });

  it("E16b: die echte Spec wird gelesen – mehr als 100 Blatt-Regeln, darunter R-5, R-7b und R-18.2a", () => {
    const spec = readFileSync(resolve(__dirname, "../../../docs/spec/regeln-prototyp.md"), "utf8");
    const leaves = leafRules(parseSpecRules(spec)).map((rule) => rule.id);
    expect(leaves.length).toBeGreaterThan(100);
    expect(leaves).toEqual(expect.arrayContaining(["R-1.1", "R-5", "R-7b", "R-9.4", "R-17a.2", "R-18.2a", "R-19.3"]));
    expect(leaves).not.toContain("R-9");
  });
});
