import { describe, expect, it } from "vitest";
import { CENTER_ARENA_ID } from "./center";
import { type GameData, loadGameData } from "./data";
import { centerReward, resolveCenterHold } from "./resolution";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import {
  type CenterResult,
  type GameEvent,
  type GameState,
  getPlayer,
  PLAYER_INDICES,
  type PlayerIndex,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "./state";

const data = loadGameData();

const center = (position: number): UnitLocation => ({ zone: "center", position });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve (keine Kämpfe ohne weitere Einheiten). */
function emptyBoard(seed = 21): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const leader = state.units[getPlayer(state, p).leader.unitId] as Unit;
    leader.location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit"): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = {
    id,
    owner: player,
    kind: "card",
    sourceId,
    cardInstanceIds: [instance],
    stars: 1,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location,
  };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function playRound(state: GameState, gameData: GameData = data): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, gameData);
}

/** Mittel-Ergebnis von Hand für Tests der Auswertung allein. */
function centerResult(state: GameState, holder: PlayerIndex | null, over: Partial<CenterResult> = {}): CenterResult {
  return {
    round: state.round,
    arena: CENTER_ARENA_ID,
    players: holder === null ? [] : [holder],
    outcome: holder === null ? "noFight" : "uncontested",
    holder,
    ticks: 0,
    participants: [],
    survivors: [],
    wounded: [],
    ...over,
  };
}

/** R-12.6: Anzahl der beim Aufräumen der Runde `round` gezogenen Karten des Spielers. */
function drawnAtEnd(state: GameState, round: number, player: PlayerIndex): number {
  const drawn = eventsOf(state, "cards_drawn_count").filter((e) => e.round === round && e.phase === "cleanup" && e.player === player);
  return drawn.reduce((sum, e) => sum + e.count, 0);
}

function heldIn(state: GameState, round: number): Extract<GameEvent, { type: "center_held" }>[] {
  return eventsOf(state, "center_held").filter((e) => e.round === round);
}

describe("R-10.4: Belohnung nach Serienlänge", () => {
  it("R-10.4: Serie 1 → +2 Gold, 2 → +2 Gold und +1 Karte, ≥ 3 → +2 Gold, +1 Karte, +1 Machtpunkt", () => {
    const pick = (streak: number) => {
      const r = centerReward(data.config, streak);
      return r === null ? null : [r.gold, r.cards, r.power];
    };
    expect(pick(0)).toBeNull();
    expect(pick(1)).toEqual([2, 0, 0]);
    expect(pick(2)).toEqual([2, 1, 0]);
    expect(pick(3)).toEqual([2, 1, 1]);
    expect(pick(7)).toEqual([2, 1, 1]);
  });

  it("R-10.4: die Belohnungen kommen aus config.center.rewards (auch unsortiert)", () => {
    const config = {
      ...data.config,
      center: {
        rewards: [
          { streak: 4, gold: 0, cards: 0, power: 3 },
          { streak: 2, gold: 5, cards: 2, power: 0 },
        ],
      },
    };
    expect(centerReward(config, 1)).toBeNull();
    expect(centerReward(config, 3)).toEqual({ streak: 2, gold: 5, cards: 2, power: 0 });
    expect(centerReward(config, 9)).toEqual({ streak: 4, gold: 0, cards: 0, power: 3 });
  });
});

describe("R-10.4: Mitte im Rundenablauf", () => {
  it("R-10.4/R-10.3: Serie 1 – +2 Gold sofort in die Schatzkammer, keine Karte, kein Machtpunkt", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2));
    playRound(state);
    const p = getPlayer(state, 0);
    expect(p.centerStreak).toBe(1);
    expect(heldIn(state, 1)).toEqual([expect.objectContaining({ player: 0, streak: 1, gold: 2, cards: 0, power: 0 })]);
    const gold = eventsOf(state, "gold_gained").filter((e) => e.round === 1 && e.phase === "combatResolution");
    expect(gold).toEqual([expect.objectContaining({ player: 0, amount: 2 })]);
    expect(p.power).toBe(0);
    expect(drawnAtEnd(state, 1, 0)).toBe(data.config.handSize);
    expect(drawnAtEnd(state, 1, 1)).toBe(data.config.handSize);
  });

  it("R-10.4/R-12.6: Serie 2 – zusätzlich +1 Karte beim Nachziehen am Rundenende", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2));
    playRound(state);
    playRound(state);
    const p = getPlayer(state, 0);
    expect(p.centerStreak).toBe(2);
    expect(heldIn(state, 2)).toEqual([expect.objectContaining({ player: 0, streak: 2, gold: 2, cards: 1, power: 0 })]);
    expect(drawnAtEnd(state, 1, 0)).toBe(data.config.handSize);
    expect(drawnAtEnd(state, 2, 0)).toBe(data.config.handSize + 1);
    expect(p.nextRound.cards).toBe(0);
    expect(p.power).toBe(0);
    expect(drawnAtEnd(state, 2, 1)).toBe(data.config.handSize);
  });

  it("R-10.4: ab Serie 3 sofort +1 Machtpunkt je gehaltener Runde, weiter +2 Gold und +1 Karte", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2));
    playRound(state);
    playRound(state);
    playRound(state);
    const p = getPlayer(state, 0);
    expect(p.centerStreak).toBe(3);
    expect(p.power).toBe(1);
    const power = eventsOf(state, "power_gained");
    expect(power).toEqual([expect.objectContaining({ round: 3, phase: "combatResolution", player: 0, amount: 1, power: 1 })]);
    expect(drawnAtEnd(state, 3, 0)).toBe(data.config.handSize + 1);
    playRound(state);
    expect(p.centerStreak).toBe(4);
    expect(p.power).toBe(2);
    expect(heldIn(state, 4)).toEqual([expect.objectContaining({ streak: 4, gold: 2, cards: 1, power: 1 })]);
  });

  it("R-10.4: Reihenfolge der Ereignisse: center_held, gold_gained, power_gained (danach Schwung/Trotz, R-10.6)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2));
    getPlayer(state, 0).centerStreak = 2;
    playRound(state);
    const types = state.log
      .filter((e) => e.round === 1 && e.phase === "combatResolution")
      .map((e) => e.type)
      .filter((t) => t !== "phase_started");
    expect(types).toEqual(["center_held", "gold_gained", "power_gained", "round_outcome", "round_outcome", "round_outcome", "round_outcome"]);
  });

  it("R-10.4: hält ein anderer Spieler die Mitte, fällt die Serie auf 0", () => {
    const state = emptyBoard();
    const holder = placeUnit(state, 0, center(2));
    playRound(state);
    playRound(state);
    expect(getPlayer(state, 0).centerStreak).toBe(2);
    delete state.units[holder];
    placeUnit(state, 1, center(1));
    playRound(state);
    expect(getPlayer(state, 0).centerStreak).toBe(0);
    expect(getPlayer(state, 1).centerStreak).toBe(1);
    expect(eventsOf(state, "center_streak_reset")).toEqual([expect.objectContaining({ round: 3, player: 0, previous: 2 })]);
    expect(heldIn(state, 3)).toEqual([expect.objectContaining({ player: 1, streak: 1, gold: 2, cards: 0, power: 0 })]);
    expect(drawnAtEnd(state, 3, 0)).toBe(data.config.handSize);
    expect(drawnAtEnd(state, 3, 1)).toBe(data.config.handSize);
  });

  it("R-10.4: ohne Halter (niemand in der Mitte) fallen alle Serien auf 0, keine Belohnung", () => {
    const state = emptyBoard();
    const holder = placeUnit(state, 2, center(0));
    playRound(state);
    expect(getPlayer(state, 2).centerStreak).toBe(1);
    delete state.units[holder];
    playRound(state);
    expect(getPlayer(state, 2).centerStreak).toBe(0);
    expect(heldIn(state, 2)).toEqual([]);
    expect(eventsOf(state, "center_streak_reset")).toEqual([expect.objectContaining({ round: 2, player: 2, previous: 1 })]);
  });

  it("R-10.4: Mittelkampf ohne Halter (z. B. Unentschieden) setzt alle Serien zurück, auch die der Teilnehmer", () => {
    const state = emptyBoard();
    getPlayer(state, 0).centerStreak = 3;
    getPlayer(state, 1).centerStreak = 1;
    state.centerResult = centerResult(state, null, { outcome: "combat", players: [0, 1] });
    resolveCenterHold(state, data);
    expect(PLAYER_INDICES.map((i) => getPlayer(state, i).centerStreak)).toEqual([0, 0, 0, 0]);
    expect(eventsOf(state, "center_streak_reset").map((e) => [e.player, e.previous])).toEqual([
      [0, 3],
      [1, 1],
    ]);
    expect(eventsOf(state, "center_held")).toEqual([]);
    expect(getPlayer(state, 0).power).toBe(0);
  });

  it("R-10.4: der Sieger eines Mittelkampfs ist Halter und bekommt die Belohnung", () => {
    const state = emptyBoard();
    getPlayer(state, 3).centerStreak = 1;
    const before = getPlayer(state, 3).treasury;
    state.centerResult = centerResult(state, 3, { outcome: "combat", players: [1, 3] });
    resolveCenterHold(state, data);
    const p = getPlayer(state, 3);
    expect(p.centerStreak).toBe(2);
    expect(p.treasury).toBe(before + 2);
    expect(p.nextRound.cards).toBe(1);
  });

  it("R-10.4: ein Mittel-Ergebnis einer früheren Runde zählt nicht", () => {
    const state = emptyBoard();
    getPlayer(state, 0).centerStreak = 1;
    state.centerResult = { ...centerResult(state, 0), round: state.round - 1 };
    resolveCenterHold(state, data);
    expect(getPlayer(state, 0).centerStreak).toBe(0);
    expect(eventsOf(state, "center_held")).toEqual([]);
  });

  it("R-10.4: Belohnungen aus geänderter Konfiguration wirken im Rundenablauf", () => {
    const custom: GameData = {
      ...data,
      config: { ...data.config, center: { rewards: [{ streak: 1, gold: 0, cards: 2, power: 1 }] } },
    };
    const state = createGame(custom, defaultLeaders(custom), 21);
    advance(state, custom);
    for (const i of PLAYER_INDICES) {
      const leader = state.units[getPlayer(state, i).leader.unitId] as Unit;
      leader.location = { zone: "reserve", slot: 0 };
    }
    placeUnit(state, 1, center(3));
    playRound(state, custom);
    const p = getPlayer(state, 1);
    expect(p.power).toBe(1);
    expect(drawnAtEnd(state, 1, 1)).toBe(custom.config.handSize + 2);
    expect(eventsOf(state, "gold_gained").filter((e) => e.phase === "combatResolution")).toEqual([]);
  });
});

describe("Determinismus der Mitte", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben dasselbe Protokoll über mehrere gehaltene Runden", () => {
    const run = () => {
      const state = emptyBoard(33);
      placeUnit(state, 0, center(2));
      placeUnit(state, 1, center(4));
      for (let i = 0; i < 4; i++) playRound(state);
      return state.log;
    };
    expect(run()).toEqual(run());
  });
});
