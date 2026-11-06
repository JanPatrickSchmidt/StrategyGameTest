import { describe, expect, it } from "vitest";
import { type ConfigData, loadGameData } from "./data";
import { baseDamage, frontLoser, resolveFrontDamage } from "./resolution";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import {
  type FrontResult,
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

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve (keine Frontkämpfe ohne weitere Einheiten). */
function emptyBoard(seed = 11): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const leader = state.units[getPlayer(state, p).leader.unitId] as Unit;
    leader.location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string, stars: Unit["stars"] = 1): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = {
    id,
    owner: player,
    kind: "card",
    sourceId,
    cardInstanceIds: [instance],
    stars,
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

function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

/** Front-Ergebnis von Hand für Tests der Auswertung allein. */
function result(state: GameState, first: PlayerIndex, second: PlayerIndex, over: Partial<FrontResult>): FrontResult {
  return {
    round: state.round,
    arena: `front:${first}-${second}`,
    first,
    second,
    outcome: "combat",
    winner: null,
    ticks: 10,
    participants: [],
    survivors: [],
    winnerBreakthrough: 0,
    wounded: [],
    ...over,
  };
}

describe("R-10.5: Grundschaden", () => {
  it("R-10.5: Grundschaden = 1 + max(0, Runde − 10)", () => {
    expect(baseDamage(data.config, 1)).toBe(1);
    expect(baseDamage(data.config, 10)).toBe(1);
    expect(baseDamage(data.config, 11)).toBe(2);
    expect(baseDamage(data.config, 15)).toBe(6);
    expect(baseDamage(data.config, 30)).toBe(21);
  });

  it("R-10.5: die Formel kommt aus config.baseDamage", () => {
    const config: ConfigData = { ...data.config, baseDamage: { base: 2, rampStartsAfterRound: 5, perRound: 3 } };
    expect(baseDamage(config, 5)).toBe(2);
    expect(baseDamage(config, 7)).toBe(8);
  });

  it("R-10.5: in späten Runden steigt der Schaden an der Front mit", () => {
    const state = emptyBoard();
    state.round = 12;
    state.frontResults = [result(state, 0, 1, { winner: 0, winnerBreakthrough: 2 })];
    resolveFrontDamage(state, data);
    // 2 Durchbruch + Grundschaden 3 (Runde 12).
    expect(getPlayer(state, 1).life).toBe(30 - 5);
    expect(eventsOf(state, "breakthrough_damage")).toEqual([
      expect.objectContaining({ winner: 0, loser: 1, breakthrough: 2, baseDamage: 3, amount: 5, life: 25 }),
    ]);
  });
});

describe("R-10.1: Durchbruch", () => {
  it("R-10.1: der Verlierer eines Frontkampfs verliert Durchbruch der Überlebenden des Siegers + Grundschaden", () => {
    const state = emptyBoard();
    // Rekrut ★3 (Durchbruch 1 × 3,2 = 3) gegen einen Schildknappen ★1.
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    placeUnit(state, 1, front("left", 2, 0), "squire");
    playRound(state);
    const fight = state.frontResults.find((r) => r.arena === "front:0-1") as FrontResult;
    expect(fight.outcome).toBe("combat");
    expect(fight.winner).toBe(0);
    expect(fight.winnerBreakthrough).toBe(3);
    expect(getPlayer(state, 1).life).toBe(30 - (3 + 1));
    expect(getPlayer(state, 0).life).toBe(30);
    const dmg = eventsOf(state, "breakthrough_damage");
    expect(dmg).toEqual([
      expect.objectContaining({ arena: "front:0-1", winner: 0, loser: 1, breakthrough: 3, baseDamage: 1, amount: 4, life: 26, phase: "combatResolution" }),
    ]);
    // Kein Gold für einen gewonnenen Kampf ohne leere Front.
    expect(eventsOf(state, "front_loot")).toEqual([]);
  });

  it("R-10.1: Überlebende ohne Durchbruch richten nur den Grundschaden an", () => {
    const state = emptyBoard();
    state.frontResults = [result(state, 2, 3, { winner: 3, winnerBreakthrough: 0 })];
    resolveFrontDamage(state, data);
    expect(getPlayer(state, 2).life).toBe(29);
    expect(getPlayer(state, 3).life).toBe(30);
  });

  it("R-10.1: Unentschieden und Fronten ohne Kampf richten keinen Schaden an", () => {
    const state = emptyBoard();
    state.frontResults = [
      result(state, 0, 1, { winner: null }),
      result(state, 1, 2, { outcome: "noFight", winner: null, ticks: 0 }),
    ];
    resolveFrontDamage(state, data);
    for (const p of PLAYER_INDICES) expect(getPlayer(state, p).life).toBe(30);
    expect(eventsOf(state, "breakthrough_damage")).toEqual([]);
  });

  it("R-10.1: jede Front zählt einzeln, ein Spieler kann an beiden Fronten Leben verlieren", () => {
    const state = emptyBoard();
    state.frontResults = [
      result(state, 0, 1, { winner: 0, winnerBreakthrough: 1 }),
      result(state, 1, 2, { winner: 2, winnerBreakthrough: 4 }),
    ];
    resolveFrontDamage(state, data);
    expect(getPlayer(state, 1).life).toBe(30 - 2 - 5);
    expect(eventsOf(state, "breakthrough_damage").map((e) => [e.arena, e.amount])).toEqual([
      ["front:0-1", 2],
      ["front:1-2", 5],
    ]);
  });

  it("R-10.1/R-13.1: Leben darf unter 0 fallen, ausgeschieden wird erst später", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 2;
    state.frontResults = [result(state, 0, 1, { winner: 0, winnerBreakthrough: 5 })];
    resolveFrontDamage(state, data);
    expect(getPlayer(state, 1).life).toBe(-4);
    expect(getPlayer(state, 1).eliminated).toBe(false);
  });

  it("R-10.1: Ergebnisse früherer Runden werden nicht noch einmal ausgewertet", () => {
    const state = emptyBoard();
    state.frontResults = [{ ...result(state, 0, 1, { winner: 0, winnerBreakthrough: 1 }), round: state.round - 1 }];
    resolveFrontDamage(state, data);
    expect(getPlayer(state, 1).life).toBe(30);
  });

  it("frontLoser: der jeweils andere Spieler, bei Unentschieden keiner", () => {
    const state = emptyBoard();
    expect(frontLoser(result(state, 3, 0, { winner: 3 }))).toBe(0);
    expect(frontLoser(result(state, 3, 0, { winner: 0 }))).toBe(3);
    expect(frontLoser(result(state, 3, 0, { winner: null }))).toBe(null);
  });
});

describe("R-10.2: Leere Front", () => {
  it("R-10.2: Sieg an leerer Front: Schaden mit allen Einheiten und 2 Gold Beute sofort in die Schatzkammer", () => {
    const state = emptyBoard();
    // Spieler 0 stellt zwei Rekruten an die rechte Front, Spieler 1 hat links niemanden.
    placeUnit(state, 0, front("right", 1, 0), "recruit");
    placeUnit(state, 0, front("right", 3, 0), "recruit");
    playRound(state);
    const fight = state.frontResults.find((r) => r.arena === "front:0-1") as FrontResult;
    expect(fight.outcome).toBe("emptyFront");
    expect(getPlayer(state, 1).life).toBe(30 - (2 + 1));
    const lootIdx = state.log.findIndex((e) => e.type === "front_loot");
    expect(state.log[lootIdx]).toEqual(expect.objectContaining({ arena: "front:0-1", player: 0, amount: 2, phase: "combatResolution" }));
    // R-10.3: direkt danach in die Schatzkammer.
    expect(state.log[lootIdx + 1]).toEqual(expect.objectContaining({ type: "gold_gained", player: 0, amount: 2, treasury: 2 }));
  });

  it("R-10.2: die Beute kommt aus config.emptyFrontLoot", () => {
    const state = emptyBoard();
    const custom = { ...data, config: { ...data.config, emptyFrontLoot: 5 } };
    state.frontResults = [result(state, 0, 1, { outcome: "emptyFront", winner: 1, winnerBreakthrough: 0, ticks: 0 })];
    resolveFrontDamage(state, custom);
    expect(getPlayer(state, 1).treasury).toBe(5);
    expect(getPlayer(state, 0).life).toBe(29);
  });

  it("R-10.2/R-2.5: bei 2 Spielern zählen beide Fronten getrennt", () => {
    const state = emptyBoard();
    getPlayer(state, 1).eliminated = true;
    getPlayer(state, 3).eliminated = true;
    // Spieler 0 hat rechts und links je einen Rekruten, Spieler 2 niemanden.
    placeUnit(state, 0, front("right", 2, 0), "recruit");
    placeUnit(state, 0, front("left", 2, 0), "recruit");
    playRound(state);
    expect(state.frontResults.map((r) => [r.arena, r.outcome, r.winner])).toEqual([
      ["front:0-2", "emptyFront", 0],
      ["front:2-0", "emptyFront", 0],
    ]);
    expect(getPlayer(state, 2).life).toBe(30 - 2 * (1 + 1));
    expect(eventsOf(state, "front_loot").map((e) => e.amount)).toEqual([2, 2]);
  });
});

describe("Determinismus der Kampfauswertung", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben dasselbe Protokoll über mehrere Runden mit Schaden", () => {
    const run = (): GameState => {
      const state = createGame(data, defaultLeaders(data), 99);
      advance(state, data);
      for (let i = 0; i < 4; i++) playRound(state);
      return state;
    };
    const a = run();
    const b = run();
    expect(eventsOf(a, "breakthrough_damage").length).toBeGreaterThan(0);
    expect(a.log).toEqual(b.log);
    expect(a.players.map((p) => p.life)).toEqual(b.players.map((p) => p.life));
  });
});
