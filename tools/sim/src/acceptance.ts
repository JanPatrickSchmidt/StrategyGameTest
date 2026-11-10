/**
 * Abnahmeprüfung M2 (E16a): Eine Simulation gilt als bestanden, wenn jede Partie ohne Ausnahme durchläuft,
 * im Zustand `gameOver` mit Ergebnis endet, das Rundenlimit (`config.maxRounds`, R-13.5) einhält, keine
 * abgelehnten Aktionen enthält und jeder Spieler einen gültigen Platz hat (R-13.2).
 * Rein: liefert nur die Liste der Befunde; Ausgabe in `cli.ts`.
 */
import type { GameData } from "@game/engine";
import type { SimResult } from "./sim";

export interface AcceptanceFinding {
  game: number;
  seed: number;
  message: string;
}

export interface AcceptanceReport {
  /** Erwartete Anzahl Partien. */
  expectedGames: number;
  finishedGames: number;
  maxRoundsSeen: number;
  findings: AcceptanceFinding[];
  passed: boolean;
}

export function checkAcceptance(data: GameData, result: SimResult, expectedGames: number): AcceptanceReport {
  const players = data.config.players;
  const findings: AcceptanceFinding[] = result.failures.map((f) => ({ game: f.game, seed: f.seed, message: `Ausnahme: ${f.message}` }));
  let maxRoundsSeen = 0;
  for (const g of result.games) {
    maxRoundsSeen = Math.max(maxRoundsSeen, g.rounds);
    const add = (message: string): void => {
      findings.push({ game: g.game, seed: g.seed, message });
    };
    if (g.phase !== "gameOver") add(`endet in Phase ${g.phase} statt gameOver`);
    if (g.victory === "none") add("ohne Ergebnis");
    if (g.rounds < 1 || g.rounds > data.config.maxRounds) add(`${g.rounds} Runden, Limit ${data.config.maxRounds}`);
    if (g.rejectedActions > 0) add(`${g.rejectedActions} abgelehnte Aktionen`);
    const rows = result.rows.filter((r) => r.game === g.game);
    if (rows.length !== players) add(`${rows.length} Zeilen statt ${players}`);
    if (!rows.some((r) => r.placement === 1)) add("kein Spieler auf Platz 1");
    for (const r of rows) {
      if (r.placement < 1 || r.placement > players) add(`Spieler ${r.player} hat ungültigen Platz ${r.placement}`);
      if (r.rounds !== g.rounds || r.victory !== g.victory) add(`Spieler ${r.player} widerspricht dem Partie-Ergebnis`);
    }
  }
  const finishedGames = result.games.length;
  if (finishedGames + result.failures.length !== expectedGames) {
    findings.push({ game: -1, seed: -1, message: `${finishedGames + result.failures.length} von ${expectedGames} Partien gelaufen` });
  }
  return { expectedGames, finishedGames, maxRoundsSeen, findings, passed: findings.length === 0 };
}

export function formatAcceptance(report: AcceptanceReport, maxRounds: number): string {
  const lines = [
    `Abnahme: ${report.passed ? "BESTANDEN" : "NICHT BESTANDEN"} (${report.finishedGames} von ${report.expectedGames} Partien beendet, höchstens ${report.maxRoundsSeen} von ${maxRounds} Runden, ${report.findings.length} Befunde)`,
  ];
  for (const f of report.findings.slice(0, 50)) lines.push(`  Partie ${f.game} (Seed ${f.seed}): ${f.message}`);
  if (report.findings.length > 50) lines.push(`  … und ${report.findings.length - 50} weitere`);
  return lines.join("\n");
}
