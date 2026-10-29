import { describe, expect, it } from "vitest";
import type { Planning } from "./actions";
import { capacityFor } from "./board";
import { loadGameData } from "./data";
import { grantRoundXp, levelForXp, levelUpLeaders } from "./leader";
import { activePlayersInPriority, advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer } from "./state";

const data = loadGameData();
const config = data.config;
const newGame = (seed = 5): GameState => createGame(data, defaultLeaders(data), seed);
const EMPTY: Planning = { play: [], buy: [], position: [] };

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Spielt eine leere Runde bis zur Planung der nächsten Runde. */
function playEmptyRound(state: GameState): void {
  expect(advance(state, data).waitingFor).toBe("planning");
  for (const p of activePlayersInPriority(state)) submitPlanning(state, p, EMPTY);
  expect(advance(state, data).waitingFor).toBe("planning");
}

describe("R-16.1: Stufen-Schwellen", () => {
  it("R-16.1: Stufe 2 ab 4 XP, Stufe 3 ab 10 XP, Stufe 4 ab 18 XP (Werte aus der Konfiguration)", () => {
    expect(config.leader.levelThresholds).toEqual({ "2": 4, "3": 10, "4": 18 });
    expect(levelForXp(0, config)).toBe(1);
    expect(levelForXp(3, config)).toBe(1);
    expect(levelForXp(4, config)).toBe(2);
    expect(levelForXp(9, config)).toBe(2);
    expect(levelForXp(10, config)).toBe(3);
    expect(levelForXp(17, config)).toBe(3);
    expect(levelForXp(18, config)).toBe(4);
    expect(levelForXp(100, config)).toBe(4);
  });
});

describe("R-12.3: Anführer-XP am Rundenende", () => {
  it("R-12.3: jeder aktive Anführer erhält +2 XP, ohne sofort aufzusteigen", () => {
    const state = newGame();
    getPlayer(state, 0).leader.xp = 2;
    grantRoundXp(state, config);
    expect(state.players.map((p) => p.leader.xp)).toEqual([4, 2, 2, 2]);
    // Aufstieg erst zu Beginn der nächsten Runde (R-6.6).
    expect(getPlayer(state, 0).leader.level).toBe(1);
    expect(eventsOf(state, "leader_xp_gained")).toEqual([
      expect.objectContaining({ player: 0, amount: config.leader.xpPerRound, xp: 4 }),
      expect.objectContaining({ player: 1, amount: 2, xp: 2 }),
      expect.objectContaining({ player: 2, amount: 2, xp: 2 }),
      expect.objectContaining({ player: 3, amount: 2, xp: 2 }),
    ]);
  });

  it("R-12.3: ausgeschiedene Spieler erhalten keine XP", () => {
    const state = newGame();
    getPlayer(state, 3).eliminated = true;
    grantRoundXp(state, config);
    expect(getPlayer(state, 3).leader.xp).toBe(0);
    expect(eventsOf(state, "leader_xp_gained").map((e) => e.player)).toEqual([0, 1, 2]);
  });

  it("R-12.3: im Rundenlauf in der Phase cleanup", () => {
    const state = newGame();
    playEmptyRound(state);
    expect(state.players.map((p) => p.leader.xp)).toEqual([2, 2, 2, 2]);
    for (const e of eventsOf(state, "leader_xp_gained")) expect(e).toEqual(expect.objectContaining({ round: 1, phase: "cleanup" }));
  });
});

describe("R-6.6: Anführer-Aufstieg zu Rundenbeginn", () => {
  it("R-6.6: genug XP aus der Vorrunde → Aufstieg auf die erreichte Stufe", () => {
    const state = newGame();
    getPlayer(state, 1).leader.xp = 4;
    getPlayer(state, 2).leader.xp = 3;
    levelUpLeaders(state, config);
    expect(state.players.map((p) => p.leader.level)).toEqual([1, 2, 1, 1]);
    expect(eventsOf(state, "leader_leveled_up")).toEqual([expect.objectContaining({ player: 1, level: 2, xp: 4 })]);
    // Erneuter Aufruf ohne neue XP ändert nichts.
    levelUpLeaders(state, config);
    expect(eventsOf(state, "leader_leveled_up")).toHaveLength(1);
  });

  it("R-6.6: mehrere Stufen auf einmal ergeben ein Ereignis je Stufe; Stufen sinken nie", () => {
    const state = newGame();
    const p = getPlayer(state, 0);
    p.leader.xp = 18;
    levelUpLeaders(state, config);
    expect(p.leader.level).toBe(4);
    expect(eventsOf(state, "leader_leveled_up").map((e) => e.level)).toEqual([2, 3, 4]);
    p.leader.xp = 0;
    levelUpLeaders(state, config);
    expect(p.leader.level).toBe(4);
  });

  it("R-6.6: ausgeschiedene Spieler steigen nicht auf", () => {
    const state = newGame();
    const p = getPlayer(state, 2);
    p.eliminated = true;
    p.leader.xp = 10;
    levelUpLeaders(state, config);
    expect(p.leader.level).toBe(1);
  });

  it("R-6.6/R-12.3: im Rundenlauf – nach 2 Runden 4 XP, Aufstieg auf Stufe 2 zu Beginn von Runde 3", () => {
    const state = newGame();
    playEmptyRound(state); // Runde 1 → 2 XP
    expect(getPlayer(state, 0).leader.level).toBe(1);
    playEmptyRound(state); // Runde 2 → 4 XP; Runde 3 beginnt: Aufstieg
    for (const p of state.players) {
      expect(p.leader.xp).toBe(4);
      expect(p.leader.level).toBe(2);
    }
    const ups = eventsOf(state, "leader_leveled_up");
    expect(ups.map((e) => e.player)).toEqual([0, 1, 2, 3]);
    for (const e of ups) expect(e).toEqual(expect.objectContaining({ round: 3, phase: "roundStart", level: 2 }));
    // Der Aufstieg zählt bereits für die Kapazität in dieser Planung (R-3.6).
    expect(capacityFor(config, getPlayer(state, 0).leader.level)).toBe(config.boardCapacity + 1);
  });

  it("R-6.6: der Aufstieg liegt in der Phase roundStart vor dem Ausspielen der Ressourcen (R-6.4)", () => {
    const state = newGame();
    getPlayer(state, 0).leader.xp = 4;
    advance(state, data);
    const types = state.log.filter((e) => e.round === 1 && e.phase === "roundStart").map((e) => e.type);
    expect(types.indexOf("leader_leveled_up")).toBeGreaterThanOrEqual(0);
    const resources = types.indexOf("resources_played_count");
    if (resources >= 0) expect(types.indexOf("leader_leveled_up")).toBeLessThan(resources);
  });
});

describe("R-1.8: Determinismus mit Ziehen und Aufstieg", () => {
  it("R-1.8: gleicher Seed, gleiche Eingaben → identisches Protokoll über mehrere Runden", () => {
    const run = (): string => {
      const s = newGame(123);
      for (let i = 0; i < 6; i++) playEmptyRound(s);
      return JSON.stringify(s.log);
    };
    expect(run()).toBe(run());
  });
});
