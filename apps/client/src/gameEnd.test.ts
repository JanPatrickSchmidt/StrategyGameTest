import { describe, expect, it } from "vitest";
import { advance, createGame, defaultLeaders, loadGameData, playerView, submitPlanning, type PlayerView } from "@game/engine";
import { GameSession, HUMAN } from "./session";
import { eliminationRounds, gameEndMessage, gameEndSummary, headlineText, outcomeText, placementText } from "./gameEnd";

const data = loadGameData();

function finished(seed: number): GameSession {
  const session = new GameSession(data, { seed });
  session.autopilotToEnd();
  return session;
}

describe("C6b: Spielende", () => {
  it("C6b: während der Partie gibt es kein Ergebnis", () => {
    expect(gameEndSummary(data, new GameSession(data, { seed: 1 }).view())).toBeNull();
  });

  it("R-13.3: Machtsieg – Sieger, Siegart und Platzierung aller vier Spieler (Seed 1)", () => {
    const session = finished(1);
    const view = session.view();
    const summary = gameEndSummary(data, view);
    expect(summary).not.toBeNull();
    if (!summary) return;
    expect(summary.reason).toBe("power");
    expect(summary.winners).toEqual([HUMAN]);
    expect(summary.headline).toBe("Du gewinnst!");
    expect(summary.reasonText).toContain(`${data.config.powerToWin} Machtpunkte`);
    expect(summary.reasonText).toContain("R-13.3");
    expect(summary.rows.map((r) => r.placement)).toEqual([1, 2, 3, 4]);
    expect(summary.rows[0]?.isViewer).toBe(true);
    expect(summary.rows[0]?.power).toBeGreaterThanOrEqual(data.config.powerToWin);
    // Platzierung genau aus der Engine; jeder Spieler kommt einmal vor.
    for (const row of summary.rows) expect(row.placement).toBe(view.players[row.player]?.placement);
    expect(new Set(summary.rows.map((r) => r.player)).size).toBe(4);
    expect(gameEndMessage(summary)).toBe("Die Partie ist beendet: Du gewinnst! Du belegst Platz 1.");
  });

  it("R-13.1: Runde des Ausscheidens je Spieler aus player_eliminated", () => {
    const view = finished(1).view();
    const rounds = eliminationRounds(view.log);
    const summary = gameEndSummary(data, view);
    for (const row of summary?.rows ?? []) {
      const event = view.log.find((e) => e.type === "player_eliminated" && e.player === row.player);
      expect(row.eliminatedRound).toBe(event?.round ?? null);
      expect(rounds.get(row.player) ?? null).toBe(row.eliminatedRound);
      expect(outcomeText(row)).toBe(event ? `ausgeschieden in Runde ${event.round}` : "bis zum Ende im Spiel");
    }
    // Wer ausscheidet, ist schlechter platziert als wer im Spiel bleibt (R-13.2).
    const out = summary?.rows.filter((r) => r.eliminatedRound !== null) ?? [];
    const inGame = summary?.rows.filter((r) => r.eliminatedRound === null) ?? [];
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) for (const i of inGame) expect(o.placement).toBeGreaterThan(i.placement);
  });

  it("R-13.4: letzter Spieler gewinnt; der Mensch ist vorher ausgeschieden, die Bots spielen zu Ende (Seed 3)", () => {
    const session = finished(3);
    expect(session.status).toBe("gameOver");
    const summary = gameEndSummary(data, session.view());
    if (!summary) throw new Error("kein Ergebnis");
    expect(summary.reason).toBe("lastPlayer");
    expect(summary.winners).toEqual([3]);
    expect(summary.headline).toBe("Bot 4 gewinnt.");
    expect(summary.reasonText).toContain("R-13.4");
    const winner = summary.rows[0];
    expect(winner?.player).toBe(3);
    expect(winner?.eliminatedRound).toBeNull();
    const own = summary.rows.find((r) => r.isViewer);
    expect(own?.eliminatedRound).not.toBeNull();
    expect((own?.eliminatedRound ?? 99) < summary.round).toBe(true);
    expect(gameEndMessage(summary)).toBe(
      `Du bist in Runde ${own?.eliminatedRound} ausgeschieden (Platz ${own?.placement}). Die Bots haben die Partie bis Runde ${summary.round} zu Ende gespielt: Bot 4 gewinnt.`,
    );
  });

  it("C6b: scheidet der Mensch aus, endet die Sitzung von selbst ohne weitere Planung", () => {
    const session = new GameSession(data, { seed: 3 });
    // Der Mensch lässt jede Runde aus, bis er nicht mehr gefragt wird.
    for (let i = 0; i < data.config.maxRounds && session.status === "waitingForHuman"; i++) session.pass();
    expect(session.status).toBe("gameOver");
    const view = session.view();
    expect(view.result).not.toBeNull();
    const summary = gameEndSummary(data, view);
    expect(summary?.rows.find((r) => r.isViewer)?.eliminatedRound).not.toBeNull();
  });

  it("R-13.2: geteilte Plätze bei gleichzeitigem Ausscheiden werden als geteilt angezeigt (Seed 34)", () => {
    const summary = gameEndSummary(data, finished(34).view());
    if (!summary) throw new Error("kein Ergebnis");
    const shared = summary.rows.filter((r) => r.shared);
    expect(shared.length).toBe(2);
    expect(shared[0]?.placement).toBe(shared[1]?.placement);
    expect(shared[0]?.eliminatedRound).toBe(shared[1]?.eliminatedRound);
    expect(placementText(shared[0] ?? summary.rows[0]!)).toBe(`Platz ${shared[0]?.placement} (geteilt)`);
    // Sortierung: nach Platz, bei gleichem Platz nach Sitz.
    expect(shared[0]!.player).toBeLessThan(shared[1]!.player);
    // Nach einem geteilten Platz wird der nächste übersprungen (F50 b); hier ist der geteilte Platz der letzte.
    expect(summary.rows.map((r) => r.placement)).toEqual([1, 2, 3, 3]);
  });

  it("R-13.2: alle übrigen scheiden gleichzeitig aus – zwei Spieler teilen sich Platz 1", () => {
    // Alle Spieler planen nichts (R-7.9); nur die Anführer kämpfen, bis alle gleichzeitig ausscheiden.
    const state = createGame(data, defaultLeaders(data), 1);
    for (let i = 0; i < data.config.maxRounds + 2; i++) {
      const step = advance(state, data);
      if (step.waitingFor === "nothing") break;
      for (const p of step.players) submitPlanning(state, p, { play: [], buy: [], position: [] });
    }
    const summary = gameEndSummary(data, playerView(state, HUMAN));
    if (!summary) throw new Error("kein Ergebnis");
    expect(summary.reason).toBe("allEliminated");
    expect(summary.winners).toEqual([2, 3]);
    expect(summary.headline).toBe("Bot 3 und Bot 4 teilen sich Platz 1.");
    expect(summary.reasonText).toContain("R-13.2");
    expect(summary.rows.slice(0, 2).map((r) => [r.player, r.placement, r.shared])).toEqual([
      [2, 1, true],
      [3, 1, true],
    ]);
    expect(summary.rows.every((r) => r.eliminatedRound !== null)).toBe(true);
    // Der Mensch schied eine Runde vor dem Ende aus (Runde 12, Platz 3).
    expect(gameEndMessage(summary)).toBe(
      "Du bist in Runde 12 ausgeschieden (Platz 3). Die Bots haben die Partie bis Runde 13 zu Ende gespielt: Bot 3 und Bot 4 teilen sich Platz 1.",
    );
  });

  it("C6b: scheidet der Mensch in der letzten Runde aus, entfällt der Hinweis aufs Zu-Ende-Spielen", () => {
    const view = finished(21).view(); // Mensch und Bot 2 scheiden in Runde 8 aus, Ende in Runde 9
    const summary = gameEndSummary(data, view);
    if (!summary) throw new Error("kein Ergebnis");
    const lastRound = { ...summary, round: summary.rows.find((r) => r.isViewer)?.eliminatedRound ?? 0 };
    expect(gameEndMessage(lastRound)).toMatch(/^Die Partie ist beendet: Bot 4 gewinnt\. Du belegst Platz \d\.$/);
  });

  it("R-13.5: Rundenlimit – Platzierung nach Leben, dann Machtpunkten, Text nennt die Regel", () => {
    // Ein echtes Rundenlimit kommt mit den Bots in 30 Runden nicht vor; Ergebnis wie von der Engine gesetzt.
    const running = new GameSession(data, { seed: 2 });
    for (let i = 0; i < 3; i++) running.autopilot();
    const base = running.view();
    const placements = [2, 1, 3, 3];
    const view: PlayerView = {
      ...base,
      result: { reason: "roundLimit", round: data.config.maxRounds, winners: [1] },
      players: base.players.map((p) => ({ ...p, placement: placements[p.index] ?? null })),
    };
    const summary = gameEndSummary(data, view);
    if (!summary) throw new Error("kein Ergebnis");
    expect(summary.headline).toBe("Bot 2 gewinnt.");
    expect(summary.reasonText).toBe(
      `Rundenlimit: Partie nach Runde ${data.config.maxRounds} beendet, Platzierung nach Leben, dann Machtpunkten (R-13.5).`,
    );
    expect(summary.rows.map((r) => [r.player, r.placement, r.shared])).toEqual([
      [1, 1, false],
      [0, 2, false],
      [2, 3, true],
      [3, 3, true],
    ]);
    expect(summary.rows.every((r) => r.eliminatedRound === null)).toBe(true);
    expect(gameEndMessage(summary)).toBe("Die Partie ist beendet: Bot 2 gewinnt. Du belegst Platz 2.");
  });

  it("C6b: Überschrift für mehrere Sieger nennt den Betrachter zuerst", () => {
    expect(headlineText([2, 0], 0)).toBe("Du und Bot 3 teilen sich Platz 1.");
    expect(headlineText([1, 2, 3], 0)).toBe("Bot 2, Bot 3 und Bot 4 teilen sich Platz 1.");
    expect(headlineText([], 0)).toBe("Kein Sieger.");
  });
});
