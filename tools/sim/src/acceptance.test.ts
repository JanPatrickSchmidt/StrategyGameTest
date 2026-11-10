import { describe, expect, it } from "vitest";
import { loadGameData } from "@game/engine";
import { checkAcceptance, formatAcceptance } from "./acceptance";
import { DEFAULT_SIM_OPTIONS, parseArgs, runSimulation, type SimResult } from "./sim";

const data = loadGameData();

function sample(games: number, seed: number): SimResult {
  return runSimulation(data, { ...DEFAULT_SIM_OPTIONS, games, seed, bots: ["greedy"] });
}

function clone(result: SimResult): SimResult {
  return structuredClone(result);
}

describe("Abnahme M2 (E16a)", () => {
  // Der volle Lauf mit 1.000 Partien ist `npm run accept:m2` (ca. 30 s); hier eine Stichprobe mit anderen Seeds.
  it("E16a, R-13.5: GreedyBot-Partien laufen ohne Ausnahme und enden innerhalb des Rundenlimits", () => {
    const result = sample(40, 5000);
    const report = checkAcceptance(data, result, 40);
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.finishedGames).toBe(40);
    expect(report.maxRoundsSeen).toBeLessThanOrEqual(data.config.maxRounds);
    for (const g of result.games) {
      expect(g.phase).toBe("gameOver");
      expect(g.rejectedActions).toBe(0);
    }
  });

  it("E16a: Ausnahmen, fehlende Partien und zu lange Partien werden als Befund gemeldet", () => {
    const base = sample(2, 77);
    const withFailure = clone(base);
    withFailure.failures.push({ game: 2, seed: 79, message: "Test" });
    expect(checkAcceptance(data, withFailure, 3).findings.map((f) => f.message)).toEqual(["Ausnahme: Test"]);
    expect(checkAcceptance(data, base, 3).findings.map((f) => f.message)).toEqual(["2 von 3 Partien gelaufen"]);

    const tooLong = clone(base);
    const g = tooLong.games[0];
    if (!g) throw new Error("keine Partie");
    g.rounds = data.config.maxRounds + 1;
    for (const r of tooLong.rows) if (r.game === g.game) r.rounds = g.rounds;
    const report = checkAcceptance(data, tooLong, 2);
    expect(report.passed).toBe(false);
    expect(report.findings.map((f) => f.message)).toEqual([`${data.config.maxRounds + 1} Runden, Limit ${data.config.maxRounds}`]);
    expect(formatAcceptance(report, data.config.maxRounds)).toContain("NICHT BESTANDEN");
  });

  it("E16a: Partie ohne Ende, abgelehnte Aktionen und ungültige Plätze werden gemeldet", () => {
    const broken = clone(sample(1, 3));
    const g = broken.games[0];
    if (!g) throw new Error("keine Partie");
    g.phase = "planning";
    g.rejectedActions = 2;
    for (const r of broken.rows) r.placement = 0;
    const messages = checkAcceptance(data, broken, 1).findings.map((f) => f.message);
    expect(messages).toContain("endet in Phase planning statt gameOver");
    expect(messages).toContain("2 abgelehnte Aktionen");
    expect(messages).toContain("kein Spieler auf Platz 1");
    expect(messages).toContain("Spieler 0 hat ungültigen Platz 0");
  });

  it("E16a: `--check` schaltet die Abnahmeprüfung ein", () => {
    expect(parseArgs([]).check).toBe(false);
    expect(parseArgs(["--games", "1000", "--check"]).check).toBe(true);
  });
});
