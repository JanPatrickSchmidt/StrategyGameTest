import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { advance } from "./round";
import { applyRoundResonance, bonusInterestFor, countRoundResonance, payBonusInterest } from "./resonanceRound";
import { createGame, defaultLeaders } from "./setup";
import {
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
const center = (position: number): UnitLocation => ({ zone: "center", position });
const reserve = (slot: number): UnitLocation => ({ zone: "reserve", slot });

/**
 * Neue Partie, noch vor dem ersten Rundenbeginn (Phase `roundStart`), alle Anführer in der Reserve.
 * Spieler 0 führt Brann (Zwerg), Spieler 3 Morgra (Mensch).
 */
function freshGame(seed = 5): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = reserve(0);
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string, wounded = false): UnitId {
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
    wounded,
    restedInReserve: false,
    location,
  };
  return id;
}

function moveLeader(state: GameState, player: PlayerIndex, location: UnitLocation): void {
  (state.units[getPlayer(state, player).leader.unitId] as Unit).location = location;
}

/** Zwerge 2: Schildwall-Veteran + Runenschmied. */
function dwarves2(state: GameState): void {
  placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
  placeUnit(state, 0, center(0), "runesmith");
}

/** Zwerge 4: Brann + drei Zwergen-Karten. */
function dwarves4(state: GameState): void {
  moveLeader(state, 0, front("left", 2, 1));
  dwarves2(state);
  placeUnit(state, 0, front("right", 0, 0), "thunder_gun");
}

/** Menschen 2 bzw. 4 für Spieler 3 (Morgra + Söldner, Fluchweber, Kopfgeldjäger). */
function humans(state: GameState, count: 2 | 4): void {
  placeUnit(state, 3, front("left", 0, 0), "mercenary");
  placeUnit(state, 3, center(0), "curse_weaver");
  if (count === 4) {
    moveLeader(state, 3, front("left", 2, 1));
    placeUnit(state, 3, front("right", 0, 0), "bounty_hunter");
  }
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Führt den Rundenbeginn aus (bis zur Planung) und gibt den Protokollabschnitt ab dem Aufruf zurück. */
function runRoundStart(state: GameState): GameEvent[] {
  const from = state.log.length;
  advance(state, data);
  expect(state.phase).toBe("planning");
  return state.log.slice(from);
}

describe("Rassen-Resonanz mit Rundenwirkung (E10c3, R-17.4)", () => {
  it("R-17.4: Zwerge 2: +1 Gold zu Rundenbeginn in die Schatzkammer, vor den Zinsen", () => {
    const state = freshGame();
    dwarves2(state);
    getPlayer(state, 0).treasury = 4;
    const log = runRoundStart(state);
    const p0 = log.filter((e) => "player" in e && e.player === 0);
    const types = p0.map((e) => e.type);
    expect(types.indexOf("resonance_round")).toBeLessThan(types.indexOf("gold_gained"));
    expect(types.indexOf("gold_gained")).toBeLessThan(types.indexOf("interest_paid"));
    expect(p0.find((e) => e.type === "resonance_round")).toMatchObject({ race: "dwarf", count: 2, tier: 2 });
    expect(p0.find((e) => e.type === "gold_gained")).toMatchObject({ amount: 1, treasury: 5 });
    // 5 Gold → 1 Zins: das Resonanz-Gold zählt schon für die Zinsen.
    expect(p0.find((e) => e.type === "interest_paid")).toMatchObject({ amount: 1, treasury: 6 });
    expect(getPlayer(state, 0).treasury).toBe(6);
    expect(eventsOf(state, "bonus_interest_paid")).toEqual([]);
  });

  it("R-17.4: Zwerge 4: +1 Gold und Bonuszinsen (1 pro volle 10 Gold), zusätzlich zu den normalen Zinsen", () => {
    const state = freshGame();
    dwarves4(state);
    getPlayer(state, 0).treasury = 19;
    const log = runRoundStart(state);
    const p0 = log.filter((e) => "player" in e && e.player === 0);
    expect(p0.find((e) => e.type === "resonance_round")).toMatchObject({ race: "dwarf", count: 4, tier: 4 });
    // Nur die Stufe 4 gilt (F33): genau einmal +1 Gold.
    expect(p0.filter((e) => e.type === "gold_gained")).toEqual([expect.objectContaining({ amount: 1, treasury: 20 })]);
    expect(p0.find((e) => e.type === "interest_paid")).toMatchObject({ amount: 2, treasury: 22 });
    // Grundlage wie bei den Zinsen: 20 Gold → 2 Bonuszinsen, nicht durch interestMax gedeckelt (F35).
    expect(p0.find((e) => e.type === "bonus_interest_paid")).toMatchObject({ race: "dwarf", amount: 2, treasury: 24 });
    const types = p0.map((e) => e.type);
    expect(types.indexOf("interest_paid")).toBeLessThan(types.indexOf("bonus_interest_paid"));
    expect(getPlayer(state, 0).treasury).toBe(24);
  });

  it("R-17.4: Bonuszinsen nur für volle 10 Gold (9 Gold → keine)", () => {
    const state = freshGame();
    dwarves4(state);
    getPlayer(state, 0).treasury = 8;
    runRoundStart(state);
    // 8 + 1 = 9 Gold: 1 Zins, keine Bonuszinsen.
    expect(eventsOf(state, "bonus_interest_paid")).toEqual([]);
    expect(getPlayer(state, 0).treasury).toBe(10);
  });

  it("R-17.4: Menschen 2: Anführer +1 XP zu Rundenbeginn", () => {
    const state = freshGame();
    humans(state, 2);
    const log = runRoundStart(state);
    expect(log.find((e) => e.type === "resonance_round" && e.player === 3)).toMatchObject({ race: "human", count: 2, tier: 2 });
    expect(log.filter((e) => e.type === "leader_xp_gained" && e.player === 3)).toEqual([
      expect.objectContaining({ amount: 1, xp: 1 }),
    ]);
    expect(getPlayer(state, 3).leader.xp).toBe(1);
    // Menschen geben kein Gold.
    expect(log.filter((e) => e.type === "gold_gained" && e.player === 3)).toEqual([]);
  });

  it("R-17.4: Menschen 4: Anführer +2 XP, der Aufstieg im selben Rundenbeginn zählt sie schon", () => {
    const state = freshGame();
    humans(state, 4);
    getPlayer(state, 3).leader.xp = 2;
    const log = runRoundStart(state);
    expect(log.find((e) => e.type === "resonance_round" && e.player === 3)).toMatchObject({ race: "human", count: 4, tier: 4 });
    expect(log.filter((e) => e.type === "leader_xp_gained" && e.player === 3)).toEqual([
      expect.objectContaining({ amount: 2, xp: 4 }),
    ]);
    // 4 XP = Stufe 2 (R-16.1), Aufstieg nach der Resonanz (R-6.6).
    expect(getPlayer(state, 3).leader.level).toBe(2);
    const types = log.filter((e) => "player" in e && e.player === 3).map((e) => e.type);
    expect(types.indexOf("leader_xp_gained")).toBeLessThan(types.indexOf("leader_leveled_up"));
  });

  it("R-17.4/R-17.1: verwundete Einheiten, Reserve und eine einzelne Karte lösen keine Rundenwirkung aus", () => {
    const state = freshGame();
    placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    placeUnit(state, 0, center(0), "runesmith", true);
    placeUnit(state, 0, reserve(1), "thunder_gun");
    getPlayer(state, 0).treasury = 4;
    runRoundStart(state);
    expect(eventsOf(state, "resonance_round")).toEqual([]);
    expect(eventsOf(state, "gold_gained")).toEqual([]);
    expect(getPlayer(state, 0).treasury).toBe(4);
  });

  it("R-17.4: gezählt wird das Brett vor der Genesung durch Reserve (Brett am Ende der Vorrunde)", () => {
    const state = freshGame();
    placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    // Verwundet auf dem Brett: zählt nicht, auch wenn später in der Runde genesen würde.
    placeUnit(state, 0, center(0), "runesmith", true);
    const resonance = countRoundResonance(state, data);
    expect(resonance.find((r) => r.player === 0)?.tiers).toEqual([]);
  });

  it("R-17.4: ausgeschiedene Spieler bekommen keine Rundenwirkung", () => {
    const state = freshGame();
    dwarves4(state);
    getPlayer(state, 0).treasury = 20;
    const resonance = countRoundResonance(state, data);
    getPlayer(state, 0).eliminated = true;
    applyRoundResonance(state, data, resonance);
    payBonusInterest(state, bonusInterestFor(state, resonance));
    expect(getPlayer(state, 0).treasury).toBe(20);
    expect(eventsOf(state, "resonance_round")).toEqual([]);
  });

  it("R-17.4: mehrere Spieler in Prioritätsreihenfolge, Ablauf deterministisch", () => {
    const build = (): GameState => {
      const state = freshGame(9);
      dwarves4(state);
      humans(state, 4);
      getPlayer(state, 0).treasury = 12;
      return state;
    };
    const a = build();
    const b = build();
    runRoundStart(a);
    runRoundStart(b);
    expect(a.log).toEqual(b.log);
    expect(eventsOf(a, "resonance_round").map((e) => e.player)).toEqual([0, 3]);
  });
});
