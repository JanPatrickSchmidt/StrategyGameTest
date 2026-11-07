import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { eliminatePlayers, eliminationPlacements, runCombatResolution } from "./resolution";
import { advance, submitPlanning } from "./round";
import { neighborsOf } from "./seating";
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

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
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

/** Arenen der Frontkämpfe einer Runde. */
function frontArenas(state: GameState, round: number): string[] {
  return state.frontResults.filter((r) => r.round === round).map((r) => r.arena);
}

describe("R-13.1: Ausscheiden", () => {
  it("R-13.1: wer nach der Kampfauswertung genau 0 Leben hat, scheidet aus", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 4;
    // Rekrut ★3 (Durchbruch 3) + Grundschaden 1 = 4 Schaden.
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    placeUnit(state, 1, front("left", 2, 0), "squire");
    playRound(state);
    const p1 = getPlayer(state, 1);
    expect(p1.life).toBe(0);
    expect(p1.eliminated).toBe(true);
    expect(p1.placement).toBe(4);
    const [ev] = eventsOf(state, "player_eliminated");
    expect(ev).toEqual(expect.objectContaining({ player: 1, life: 0, lifeBefore: 4, placement: 4, phase: "combatResolution" }));
    // Erst nach der ganzen Kampfauswertung: nach Schaden, Serien und XP.
    const elimIdx = state.log.findIndex((e) => e.type === "player_eliminated");
    const lastResolution = state.log.reduce((i, e, idx) => (e.phase === "combatResolution" && e.type !== "player_eliminated" && e.type !== "unit_removed" ? idx : i), -1);
    expect(elimIdx).toBeGreaterThan(lastResolution);
    expect(state.log.findIndex((e) => e.type === "breakthrough_damage")).toBeLessThan(elimIdx);
    // Die anderen bleiben im Spiel.
    for (const p of [0, 2, 3] as const) expect(getPlayer(state, p).eliminated).toBe(false);
  });

  it("R-13.1: wer noch 1 Leben hat, bleibt im Spiel", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 5;
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    placeUnit(state, 1, front("left", 2, 0), "squire");
    playRound(state);
    expect(getPlayer(state, 1).life).toBe(1);
    expect(getPlayer(state, 1).eliminated).toBe(false);
    expect(getPlayer(state, 1).placement).toBe(null);
    expect(eventsOf(state, "player_eliminated")).toEqual([]);
  });

  it("R-13.1: die Einheiten des Ausgeschiedenen verlassen das Spiel, auch Anführer, Reserve und Mitte", () => {
    const state = emptyBoard();
    const p1 = getPlayer(state, 1);
    p1.life = 1;
    const leaderId = p1.leader.unitId;
    const inFront = placeUnit(state, 1, front("left", 2, 0), "squire");
    const inCenter = placeUnit(state, 1, { zone: "center", position: 0 }, "recruit");
    const inReserve = placeUnit(state, 1, { zone: "reserve", slot: 1 }, "recruit");
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    const others = Object.values(state.units).filter((u) => u.owner !== 1).map((u) => u.id);
    playRound(state);
    expect(p1.eliminated).toBe(true);
    for (const id of [leaderId, inFront, inCenter, inReserve]) expect(state.units[id]).toBeUndefined();
    expect(Object.values(state.units).some((u) => u.owner === 1)).toBe(false);
    // Fremde Einheiten (ohne Tokens, die beim Aufräumen verschwinden) bleiben.
    for (const id of others) expect(state.units[id]).toBeDefined();
    const removed = eventsOf(state, "unit_removed").map((e) => e.unitId);
    for (const id of [leaderId, inFront, inCenter, inReserve]) expect(removed).toContain(id);
    expect(eventsOf(state, "unit_removed").every((e) => e.player === 1 && e.reason === "eliminated")).toBe(true);
    // Reihenfolge: erst die Einheiten, dann das Ausscheiden.
    const lastRemoved = state.log.map((e) => e.type).lastIndexOf("unit_removed");
    expect(state.log[lastRemoved + 1]?.type).toBe("player_eliminated");
  });

  it("R-13.1: ein Ausgeschiedener scheidet nicht noch einmal aus und plant nicht mehr", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 1;
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    placeUnit(state, 1, front("left", 2, 0), "squire");
    playRound(state);
    expect(getPlayer(state, 1).eliminated).toBe(true);
    // Die nächste Runde wartet nicht auf Spieler 1.
    const waiting = advance(state, data);
    expect(waiting.waitingFor).toBe("planning");
    expect("players" in waiting ? [...waiting.players].sort() : null).toEqual([0, 2, 3]);
    playRound(state);
    expect(eventsOf(state, "player_eliminated").length).toBe(1);
    expect(getPlayer(state, 1).placement).toBe(4);
  });

  it("R-13.1: mehrere Spieler können in derselben Runde ausscheiden", () => {
    const state = emptyBoard();
    state.frontResults = [
      result(state, 0, 1, { winner: 0, winnerBreakthrough: 4 }),
      result(state, 2, 3, { winner: 2, winnerBreakthrough: 4 }),
    ];
    getPlayer(state, 1).life = 3;
    getPlayer(state, 3).life = 5;
    runCombatResolution(state, data);
    expect(getPlayer(state, 1).eliminated).toBe(true);
    expect(getPlayer(state, 3).eliminated).toBe(true);
    // Spieler 3 hatte vor dem Schaden mehr Leben → Platz 3, Spieler 1 Platz 4.
    expect(getPlayer(state, 3).placement).toBe(3);
    expect(getPlayer(state, 1).placement).toBe(4);
    expect(eventsOf(state, "player_eliminated").map((e) => e.player)).toEqual([1, 3]);
  });
});

describe("R-13.2: Platzierung", () => {
  it("R-13.2: wer später ausscheidet, ist besser platziert", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 0;
    eliminatePlayers(state, [30, 5, 30, 30]);
    expect(getPlayer(state, 1).placement).toBe(4);
    getPlayer(state, 2).life = -3;
    eliminatePlayers(state, [30, 0, 1, 30]);
    expect(getPlayer(state, 2).placement).toBe(3);
    getPlayer(state, 0).life = 0;
    eliminatePlayers(state, [8, 0, -3, 30]);
    expect(getPlayer(state, 0).placement).toBe(2);
    expect(getPlayer(state, 3).placement).toBe(null);
  });

  it("R-13.2: gleiche Runde – zuerst zählt das Leben vor dem Schaden dieser Runde, nicht das Leben danach", () => {
    const state = emptyBoard();
    // Spieler 1: 6 Leben → −10; Spieler 3: 2 Leben → 0.
    state.frontResults = [
      result(state, 0, 1, { winner: 0, winnerBreakthrough: 15 }),
      result(state, 2, 3, { winner: 2, winnerBreakthrough: 1 }),
    ];
    getPlayer(state, 1).life = 6;
    getPlayer(state, 3).life = 2;
    runCombatResolution(state, data);
    expect(getPlayer(state, 1).life).toBe(-10);
    expect(getPlayer(state, 3).life).toBe(0);
    expect(getPlayer(state, 1).placement).toBe(3);
    expect(getPlayer(state, 3).placement).toBe(4);
    expect(eventsOf(state, "player_eliminated")).toEqual([
      expect.objectContaining({ player: 1, lifeBefore: 6, life: -10, placement: 3 }),
      expect.objectContaining({ player: 3, lifeBefore: 2, life: 0, placement: 4 }),
    ]);
  });

  it("R-13.2: gleiches Leben vor dem Schaden – mehr Machtpunkte sind besser", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = -1;
    getPlayer(state, 2).life = -5;
    getPlayer(state, 2).power = 2;
    getPlayer(state, 1).power = 1;
    eliminatePlayers(state, [30, 4, 4, 30]);
    expect(getPlayer(state, 2).placement).toBe(3);
    expect(getPlayer(state, 1).placement).toBe(4);
  });

  it("R-13.2: gleiches Leben und gleiche Machtpunkte – die Platzierung wird geteilt", () => {
    const state = emptyBoard();
    for (const p of [1, 2, 3] as const) {
      getPlayer(state, p).life = 0;
      getPlayer(state, p).power = 1;
    }
    getPlayer(state, 3).power = 0;
    eliminatePlayers(state, [30, 4, 4, 4]);
    // 1 und 2 teilen sich Platz 2, Spieler 3 (weniger Machtpunkte) ist Vierter.
    expect(getPlayer(state, 1).placement).toBe(2);
    expect(getPlayer(state, 2).placement).toBe(2);
    expect(getPlayer(state, 3).placement).toBe(4);
    expect(getPlayer(state, 0).placement).toBe(null);
  });

  it("R-13.2: eliminationPlacements belegt die Plätze hinter den verbleibenden Spielern", () => {
    const placements = eliminationPlacements(
      [
        { player: 0, lifeBefore: 3, power: 0 },
        { player: 1, lifeBefore: 3, power: 0 },
        { player: 2, lifeBefore: 7, power: 0 },
        { player: 3, lifeBefore: 1, power: 4 },
      ],
      0,
    );
    expect([...placements.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 2],
      [1, 2],
      [2, 1],
      [3, 4],
    ]);
  });
});

describe("R-2.2–R-2.5: Nachbarn nach dem Ausscheiden", () => {
  it("R-2.2/R-13.1: der Sitz bleibt leer, die Nachbarn rücken auf", () => {
    const state = emptyBoard();
    expect(neighborsOf(state, 0)).toEqual({ left: 3, right: 1 });
    getPlayer(state, 1).life = 1;
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    playRound(state);
    expect(getPlayer(state, 1).eliminated).toBe(true);
    expect(neighborsOf(state, 0)).toEqual({ left: 3, right: 2 });
    expect(neighborsOf(state, 2)).toEqual({ left: 0, right: 3 });
    expect(neighborsOf(state, 1)).toBe(null);
  });

  it("R-2.4: nach einem Ausscheiden kämpfen 3 Spieler im nächsten Kampf an drei Fronten gegen neue Nachbarn", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 1;
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    playRound(state);
    expect(frontArenas(state, 1)).toEqual(["front:0-1", "front:1-2", "front:2-3", "front:3-0"]);
    advance(state, data);
    // Spieler 0 trifft jetzt mit seiner rechten Zone auf Spieler 2.
    const round = state.round;
    playRound(state);
    expect(frontArenas(state, round)).toEqual(["front:0-2", "front:2-3", "front:3-0"]);
  });

  it("R-2.5: scheiden zwei in derselben Runde aus, gibt es danach zwei getrennte Fronten zwischen den übrigen", () => {
    const state = emptyBoard();
    getPlayer(state, 1).life = 1;
    getPlayer(state, 3).life = 1;
    placeUnit(state, 0, front("right", 2, 0), "recruit");
    placeUnit(state, 2, front("right", 2, 0), "recruit");
    playRound(state);
    expect(getPlayer(state, 1).eliminated).toBe(true);
    expect(getPlayer(state, 3).eliminated).toBe(true);
    expect(neighborsOf(state, 0)).toEqual({ left: 2, right: 2 });
    advance(state, data);
    const round = state.round;
    // Spieler 0 rechts gegen die leere linke Zone von Spieler 2 → leere Front.
    playRound(state);
    expect(state.frontResults.filter((r) => r.round === round).map((r) => [r.arena, r.first, r.second])).toEqual([
      ["front:0-2", 0, 2],
      ["front:2-0", 2, 0],
    ]);
  });
});

describe("Determinismus mit Ausscheiden", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben dasselbe Protokoll, auch wenn Spieler ausscheiden", () => {
    const run = (): GameState => {
      const state = emptyBoard(42);
      getPlayer(state, 1).life = 2;
      getPlayer(state, 3).life = 2;
      placeUnit(state, 0, front("right", 2, 0), "recruit", 2);
      placeUnit(state, 2, front("right", 2, 0), "recruit", 2);
      for (let i = 0; i < 3; i++) {
        playRound(state);
        advance(state, data);
      }
      return state;
    };
    const a = run();
    const b = run();
    expect(eventsOf(a, "player_eliminated").length).toBe(2);
    expect(a.log).toEqual(b.log);
  });
});
