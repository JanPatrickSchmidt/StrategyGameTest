import { describe, expect, it } from "vitest";
import { centerReward, loadGameData, streakGold, type GameEvent, type PlayerView } from "@game/engine";
import { GameSession, HUMAN } from "./session";
import {
  centerText,
  frontOpponents,
  lastResolvedRound,
  leaderText,
  lifeText,
  opponentsText,
  powerText,
  roundChange,
  scoreboard,
  statusText,
  streakText,
  type ScoreRow,
} from "./scoreboard";

const data = loadGameData();

function playedSession(seed: number, rounds: number): GameSession {
  const session = new GameSession(data, { seed });
  for (let i = 0; i < rounds && session.status === "waitingForHuman"; i++) session.autopilot();
  return session;
}

function withEliminated(view: PlayerView, seats: number[]): PlayerView {
  return { ...view, players: view.players.map((p) => (seats.includes(p.index) ? { ...p, eliminated: true } : p)) };
}

function row(over: Partial<ScoreRow>): ScoreRow {
  return {
    player: 1,
    name: "Bot 2",
    isViewer: false,
    leader: "Brann",
    level: 1,
    branch: null,
    life: 30,
    power: 0,
    treasury: 0,
    deckSize: 5,
    handSize: 5,
    discardSize: 0,
    winStreak: 0,
    lossStreak: 0,
    centerStreak: 0,
    eliminated: false,
    placement: null,
    leftOpponent: null,
    rightOpponent: null,
    lastRound: null,
    ...over,
  };
}

describe("C6a: Übersichtstafel", () => {
  it("C6a: Runde 1 – Kopfzeile mit Rundenzahl und Phase, vier Spieler mit Startwerten, noch keine aufgelöste Runde", () => {
    const view = new GameSession(data, { seed: 1 }).view();
    const board = scoreboard(data, view);
    expect(board.header).toBe(`Runde 1 von höchstens ${data.config.maxRounds} · Phase: Planung`);
    expect(board.powerToWin).toBe(data.config.powerToWin);
    expect(board.rows.map((r) => r.name)).toEqual(["Du", "Bot 2", "Bot 3", "Bot 4"]);
    expect(board.rows.filter((r) => r.isViewer).map((r) => r.player)).toEqual([HUMAN]);
    for (const r of board.rows) {
      expect(r.life).toBe(data.config.startingLife);
      expect(r.power).toBe(0);
      expect(r.lastRound).toBeNull();
      expect(r.handSize).toBe(view.players[r.player]?.handSize);
      expect(statusText(r, false)).toBe("im Spiel");
    }
    expect(lastResolvedRound(view)).toBeNull();
  });

  it("R-18.1: Werte der Tafel sind genau die öffentlichen Angaben der Sicht", () => {
    const view = playedSession(3, 5).view();
    const board = scoreboard(data, view);
    for (const entry of view.players) {
      const r = board.rows[entry.index];
      expect(r).toBeDefined();
      expect(r?.life).toBe(entry.life);
      expect(r?.power).toBe(entry.power);
      expect(r?.treasury).toBe(entry.treasury);
      expect(r?.deckSize).toBe(entry.deckSize);
      expect(r?.discardSize).toBe(entry.discard.length);
      expect(r?.level).toBe(entry.leader.level);
      expect(r?.winStreak).toBe(entry.winStreak);
      expect(r?.lossStreak).toBe(entry.lossStreak);
      expect(r?.centerStreak).toBe(entry.centerStreak);
      expect(r?.leader).toBe(data.leaders.get(entry.leader.leaderId)?.name);
    }
  });

  it("R-10.1: Lebensverlust der letzten Runde stammt aus den Durchbruch-Ereignissen und passt zur Lebensänderung", () => {
    const session = playedSession(3, 4);
    const before = session.view();
    session.autopilot();
    const view = session.view();
    const round = lastResolvedRound(view);
    expect(round).toBe(before.round);
    const board = scoreboard(data, view);
    for (const r of board.rows) {
      const prev = before.players[r.player];
      if (!prev || prev.eliminated) continue;
      expect(r.lastRound?.round).toBe(before.round);
      // Leben kann sich zwischen den Runden nur durch Durchbruch und Blutzoll ändern (keine Heilung im Prototyp).
      expect(prev.life - r.life).toBe(r.lastRound?.lifeLost);
      expect(r.power - prev.power).toBe(r.lastRound?.powerGained);
    }
    expect(board.rows.some((r) => (r.lastRound?.lifeLost ?? 0) > 0)).toBe(true);
  });

  it("C6a: roundChange zählt nur Ereignisse der genannten Runde und des genannten Spielers", () => {
    const base = { phase: "combatResolution" as const };
    const log: GameEvent[] = [
      { ...base, round: 2, type: "breakthrough_damage", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 2, baseDamage: 1, amount: 3, life: 27 },
      { ...base, round: 3, type: "breakthrough_damage", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 4, baseDamage: 1, amount: 5, life: 22 },
      { ...base, round: 3, type: "breakthrough_damage", arena: "front:1-2", winner: 1, loser: 2, breakthrough: 0, baseDamage: 1, amount: 1, life: 29 },
      { ...base, round: 3, type: "power_gained", player: 1, amount: 1, power: 1 },
      { ...base, round: 3, type: "power_gained", player: 0, amount: 1, power: 2 },
    ];
    expect(roundChange(log, 1, 3)).toEqual({ round: 3, lifeLost: 5, powerGained: 1 });
    expect(roundChange(log, 1, 2)).toEqual({ round: 2, lifeLost: 3, powerGained: 0 });
    expect(roundChange(log, 3, 3)).toEqual({ round: 3, lifeLost: 0, powerGained: 0 });
  });

  it("R-2.3: Gegner an linker und rechter Front nach den Front-Paarungen der Engine", () => {
    const view = new GameSession(data, { seed: 1 }).view();
    // 4 Spieler im Ring: rechte Front von Sitz p gegen den rechten Nachbarn p+1, linke gegen p−1.
    expect(frontOpponents(view, 0)).toEqual({ left: 3, right: 1 });
    expect(frontOpponents(view, 2)).toEqual({ left: 1, right: 3 });
    const board = scoreboard(data, view);
    expect(opponentsText(board.rows[0] as ScoreRow, HUMAN)).toBe("links Bot 4 · rechts Bot 2");
  });

  it("R-2.5: nach dem Ausscheiden rücken die Nachbarn nach, Ausgeschiedene haben keine Gegner", () => {
    const view = withEliminated(new GameSession(data, { seed: 1 }).view(), [1]);
    expect(frontOpponents(view, 0)).toEqual({ left: 3, right: 2 });
    expect(frontOpponents(view, 2)).toEqual({ left: 0, right: 3 });
    const board = scoreboard(data, view);
    expect(board.rows[1]?.leftOpponent).toBeNull();
    expect(board.rows[1]?.rightOpponent).toBeNull();
    expect(opponentsText(board.rows[1] as ScoreRow, HUMAN)).toBe("–");
  });

  it("R-2.4: bei zwei Spielern kämpfen beide an beiden Fronten gegeneinander", () => {
    const view = withEliminated(new GameSession(data, { seed: 1 }).view(), [1, 3]);
    expect(frontOpponents(view, 0)).toEqual({ left: 2, right: 2 });
    expect(frontOpponents(view, 2)).toEqual({ left: 0, right: 0 });
  });

  it("R-13.3: Machtpunkte stehen gegen das Siegziel, Gewinn der letzten Runde in Klammern", () => {
    expect(powerText(row({ power: 2 }), 5)).toBe("2/5");
    expect(powerText(row({ power: 3, lastRound: { round: 4, lifeLost: 0, powerGained: 1 } }), 5)).toBe("3/5 (+1)");
    expect(lifeText(row({ life: 24, lastRound: { round: 4, lifeLost: 6, powerGained: 0 } }))).toBe("24♥ (−6)");
    expect(lifeText(row({ life: 24, lastRound: { round: 4, lifeLost: 0, powerGained: 0 } }))).toBe("24♥");
  });

  it("R-10.6: Serie mit dem Bonusgold der Engine", () => {
    expect(streakText(data, row({}))).toBe("keine");
    expect(streakText(data, row({ winStreak: 1 }))).toBe(streakGold(data.config, 1) > 0 ? `Siege 1 (+${streakGold(data.config, 1)} Gold)` : "Siege 1");
    expect(streakText(data, row({ winStreak: 3 }))).toBe(`Siege 3 (+${streakGold(data.config, 3)} Gold)`);
    expect(streakText(data, row({ lossStreak: 5 }))).toBe(`Niederlagen 5 (+${streakGold(data.config, 5)} Gold)`);
  });

  it("R-10.4: Halteserie mit der Belohnung des nächsten Haltens aus der Engine", () => {
    for (const streak of [0, 1, 2, 4]) {
      const next = centerReward(data.config, streak + 1);
      const text = centerText(data, row({ centerStreak: streak }));
      expect(text.startsWith(`${streak} · nächstes Halten: `)).toBe(true);
      expect(text).toContain(`+${next?.gold} Gold`);
      expect(text.includes("Karte")).toBe((next?.cards ?? 0) > 0);
      expect(text.includes("Macht")).toBe((next?.power ?? 0) > 0);
    }
    expect(centerText(data, row({ centerStreak: 0, eliminated: true }))).toBe("0");
  });

  it("R-13.2: Status nennt ausgeschiedene Spieler mit Platzierung, nach Spielende alle Plätze", () => {
    expect(statusText(row({ eliminated: true, placement: 4 }), false)).toBe("raus, Platz 4");
    expect(statusText(row({ placement: 1 }), true)).toBe("Platz 1");
    expect(statusText(row({ eliminated: true, placement: 3 }), true)).toBe("raus, Platz 3");
    expect(leaderText(row({ level: 2, branch: "Schildwall" }))).toBe("Brann, Stufe 2, Ast Schildwall");
  });

  it("C6a: nach Spielende nennt die Kopfzeile die letzte Runde, alle haben eine Platzierung und keine Gegner", () => {
    const session = new GameSession(data, { seed: 5 });
    session.autopilotToEnd();
    const view = session.view();
    expect(view.result).not.toBeNull();
    const board = scoreboard(data, view);
    expect(board.header).toBe(`Partie beendet in Runde ${view.result?.round} von höchstens ${data.config.maxRounds}`);
    for (const r of board.rows) {
      expect(r.placement).not.toBeNull();
      expect(r.leftOpponent).toBeNull();
      expect(r.rightOpponent).toBeNull();
    }
    const winners = board.rows.filter((r) => r.placement === 1).map((r) => r.player);
    expect(winners).toEqual(view.result?.winners);
  });
});
