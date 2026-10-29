import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, Planning } from "./actions";
import { loadGameData } from "./data";
import { autoChooseBranch, chooseBranch, leaderAbilityParams, setLeaderAbility } from "./leader";
import { activePlayersInPriority, advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, type PlayerIndex, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();
const EMPTY: Planning = { play: [], buy: [], position: [] };
// Standard-Anführer: 0 Brann (zone, buff), 1 Ilyra (hex, damage), 2 Vex (moveUnits, move), 3 Morgra (hex own frei, summon).
const BRANN = 0;
const ILYRA = 1;
const VEX = 2;
const MORGRA = 3;

function inPlanning(seed = 31): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  return state;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function setLevel(state: GameState, player: PlayerIndex, level: 1 | 2 | 3 | 4, branchId: string | null = null): void {
  const leader = getPlayer(state, player).leader;
  leader.level = level;
  leader.branchId = branchId;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation): UnitId {
  const id = state.nextUnitId++;
  state.units[id] = {
    id, owner: player, kind: "card", sourceId: "recruit", cardInstanceIds: [], stars: 1, xp: 0, wounded: false, restedInReserve: false, location,
  };
  return id;
}

const at = (arena: ArenaHex["arena"], col: number, row: number): ArenaHex => ({ arena, cell: { col, row } });
const hexes = (...list: ArenaHex[]): ActionTarget => ({ kind: "hexes", hexes: list });

function submitOthers(state: GameState, except: PlayerIndex): void {
  for (const p of activePlayersInPriority(state)) if (p !== except) submitPlanning(state, p, EMPTY);
}

describe("R-7.7: Astwahl", () => {
  it("R-7.7: erst ab Stufe 2 und nur einmal; der Ast muss zum Anführer gehören", () => {
    const state = inPlanning();
    expect(chooseBranch(state, data, BRANN, "reach")).toBe("branchNotAvailable");
    setLevel(state, BRANN, 2);
    expect(chooseBranch(state, data, BRANN, "chain")).toBe("unknownBranch");
    expect(chooseBranch(state, data, BRANN, 7)).toBe("malformed");
    expect(chooseBranch(state, data, BRANN, "might")).toBeNull();
    expect(getPlayer(state, BRANN).leader.branchId).toBe("might");
    expect(chooseBranch(state, data, BRANN, "reach")).toBe("branchNotAvailable");
    expect(eventsOf(state, "branch_chosen")).toEqual([expect.objectContaining({ player: BRANN, branchId: "might", auto: false })]);
  });

  it("R-7.7: ohne Wahl wird beim Aufdecken der erste Ast genommen, mit Wahl nicht", () => {
    const state = inPlanning();
    setLevel(state, BRANN, 2);
    setLevel(state, ILYRA, 2);
    submitPlanning(state, ILYRA, { play: [{ type: "chooseBranch", branchId: "storm" }] });
    submitOthers(state, ILYRA);
    advance(state, data);
    expect(getPlayer(state, BRANN).leader.branchId).toBe("reach");
    expect(getPlayer(state, ILYRA).leader.branchId).toBe("storm");
    expect(eventsOf(state, "branch_chosen")).toEqual([
      expect.objectContaining({ player: BRANN, branchId: "reach", auto: true, phase: "reveal" }),
      expect.objectContaining({ player: ILYRA, branchId: "storm", auto: false, phase: "reveal" }),
    ]);
  });

  it("R-7.7: auf Stufe 1 wird kein Ast gesetzt", () => {
    const state = inPlanning();
    autoChooseBranch(state, data, BRANN);
    expect(getPlayer(state, BRANN).leader.branchId).toBeNull();
    expect(eventsOf(state, "branch_chosen")).toEqual([]);
  });

  it("R-16.2: Stufe 1 nutzt die Grundfähigkeit, ab Stufe 2 die Stufe des Asts", () => {
    const ilyra = data.leaders.get("ilyra")!;
    expect(leaderAbilityParams(ilyra, 1, null)).toEqual(expect.objectContaining({ limits: {}, effects: ilyra.active.base.effects }));
    expect(leaderAbilityParams(ilyra, 2, "chain").limits).toEqual({ hexes: 3 });
    expect(leaderAbilityParams(ilyra, 4, "chain").limits).toEqual({ hexes: 4 });
    expect(leaderAbilityParams(ilyra, 3, "might").effects).toEqual(ilyra.active.branches[2]!.levels["3"].effects);
  });
});

describe("R-7.4: Anführer-Fähigkeit wählen", () => {
  it("R-7.4: höchstens einmal pro Runde, `none` erlaubt, kostenlos", () => {
    const state = inPlanning();
    const p = getPlayer(state, ILYRA);
    const gold = [p.roundGold, p.treasury];
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 2, 4)))).toBeNull();
    expect(setLeaderAbility(state, data, ILYRA, { kind: "none" })).toBe("abilityAlreadySet");
    expect([p.roundGold, p.treasury]).toEqual(gold);
    expect(p.leaderAbility).toEqual(hexes(at("right", 2, 4)));
    expect(setLeaderAbility(state, data, BRANN, { kind: "none" })).toBeNull();
    expect(getPlayer(state, BRANN).leaderAbility).toEqual({ kind: "none" });
  });

  it("R-7.4/R-14.2: ungültige Ziele werden abgelehnt und verbrauchen die Wahl nicht", () => {
    const state = inPlanning();
    expect(setLeaderAbility(state, data, ILYRA, { kind: "zone", arenas: ["left"] })).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("center", 7, 7)))).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, ILYRA, "x")).toBe("malformed");
    expect(getPlayer(state, ILYRA).leaderAbility).toBeNull();
    expect(setLeaderAbility(state, data, ILYRA, { kind: "hex", arena: "center", cell: { col: 3, row: 3 } })).toBeNull();
  });

  it("R-7.4/R-16.2: Brann wählt auf Stufe 1 eine eigene Zone, mit „Weite“ zwei (Stufe 2–3) bzw. drei (Stufe 4)", () => {
    const zones = (...arenas: ("left" | "right" | "center")[]): ActionTarget => ({ kind: "zone", arenas });
    let state = inPlanning();
    expect(setLeaderAbility(state, data, BRANN, zones("left", "right"))).toBe("tooManyTargets");
    expect(setLeaderAbility(state, data, BRANN, zones("left"))).toBeNull();
    state = inPlanning();
    setLevel(state, BRANN, 2, "reach");
    expect(setLeaderAbility(state, data, BRANN, zones("left", "right", "center"))).toBe("tooManyTargets");
    expect(setLeaderAbility(state, data, BRANN, zones("left", "left"))).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, BRANN, zones("left", "center"))).toBeNull();
    state = inPlanning();
    setLevel(state, BRANN, 4, "reach");
    expect(setLeaderAbility(state, data, BRANN, zones("left", "right", "center"))).toBeNull();
    state = inPlanning();
    setLevel(state, BRANN, 4, "might");
    expect(setLeaderAbility(state, data, BRANN, zones("left", "right"))).toBe("tooManyTargets");
  });

  it("R-7.4/R-16.2: Ilyra trifft auf Stufe 1 ein Feld, mit „Kette“ bis zu drei verschiedene Felder", () => {
    let state = inPlanning();
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 1, 4), at("left", 1, 1)))).toBe("tooManyTargets");
    state = inPlanning();
    setLevel(state, ILYRA, 2, "chain");
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 1, 4), at("right", 1, 4)))).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 1, 4), at("left", 1, 1), at("center", 3, 3), at("center", 3, 4)))).toBe(
      "tooManyTargets",
    );
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 1, 4), at("left", 1, 1), at("center", 3, 3)))).toBeNull();
  });

  it("R-7.4: Morgra beschwört nur auf ein freies eigenes Feld", () => {
    const state = inPlanning();
    // Morgras Anführer steht links auf (2, 1) → Arena-Feld (2, 4).
    expect(setLeaderAbility(state, data, MORGRA, hexes(at("left", 2, 4)))).toBe("cellOccupied");
    expect(setLeaderAbility(state, data, MORGRA, hexes(at("left", 2, 1)))).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, MORGRA, hexes(at("left", 2, 3)))).toBeNull();
  });

  it("R-16.6: Vex setzt eigene Einheiten auf freie Felder jeder beteiligten Arena, auch in die gegnerische Hälfte", () => {
    const state = inPlanning();
    const leader = getPlayer(state, VEX).leader.unitId;
    const own = placeUnit(state, VEX, { zone: "right", cell: { col: 0, row: 0 } });
    const foreign = placeUnit(state, 0, { zone: "right", cell: { col: 0, row: 0 } });
    const move = (unitId: UnitId, to: ArenaHex) => ({ unitId, to });
    const target = (...moves: { unitId: UnitId; to: ArenaHex }[]): ActionTarget => ({ kind: "moveUnits", moves });
    expect(setLeaderAbility(state, data, VEX, target(move(foreign, at("right", 2, 4))))).toBe("notOwnUnit");
    expect(setLeaderAbility(state, data, VEX, target(move(9999, at("right", 2, 4))))).toBe("unknownUnit");
    expect(setLeaderAbility(state, data, VEX, target(move(leader, at("right", 0, 0))))).toBe("cellOccupied");
    expect(setLeaderAbility(state, data, VEX, target(move(own, at("right", 2, 4)), move(leader, at("right", 3, 4))))).toBe("tooManyTargets");
    expect(setLeaderAbility(state, data, VEX, target())).toBe("invalidTarget");
    expect(setLeaderAbility(state, data, VEX, target(move(own, at("right", 2, 5))))).toBeNull();
    expect(getPlayer(state, VEX).leaderAbility).toEqual(target(move(own, at("right", 2, 5))));
  });

  it("R-16.6/R-16.2: Vex mit „Doppelt“ bewegt zwei verschiedene Einheiten auf verschiedene Felder", () => {
    const state = inPlanning();
    setLevel(state, VEX, 2, "double");
    const leader = getPlayer(state, VEX).leader.unitId;
    const own = placeUnit(state, VEX, { zone: "reserve", slot: 0 });
    const target = (...moves: { unitId: UnitId; to: ArenaHex }[]): ActionTarget => ({ kind: "moveUnits", moves });
    expect(setLeaderAbility(state, data, VEX, target({ unitId: own, to: at("center", 3, 3) }, { unitId: own, to: at("center", 3, 4) }))).toBe(
      "invalidTarget",
    );
    expect(setLeaderAbility(state, data, VEX, target({ unitId: own, to: at("center", 3, 3) }, { unitId: leader, to: at("center", 3, 3) }))).toBe(
      "cellOccupied",
    );
    expect(setLeaderAbility(state, data, VEX, target({ unitId: own, to: at("center", 3, 3) }, { unitId: leader, to: at("left", 0, 0) }))).toBeNull();
  });

  it("R-16.4: Fähigkeit auch, wenn die Kampfeinheit verwundet in der Reserve steht", () => {
    const state = inPlanning();
    const leaderUnit = state.units[getPlayer(state, ILYRA).leader.unitId]!;
    leaderUnit.wounded = true;
    leaderUnit.location = { zone: "reserve", slot: 0 };
    expect(setLeaderAbility(state, data, ILYRA, hexes(at("right", 2, 4)))).toBeNull();
  });
});

describe("R-7.4/R-7.7 im Rundenablauf", () => {
  it("R-7.4: Fähigkeit im Abschnitt `position`, nicht in `play`; gilt nur für die Runde", () => {
    const state = inPlanning();
    submitPlanning(state, ILYRA, {
      play: [{ type: "setLeaderAbility", target: hexes(at("center", 3, 3)) }],
      position: [{ type: "setLeaderAbility", target: hexes(at("right", 2, 4)) }],
    });
    submitOthers(state, ILYRA);
    advance(state, data);
    expect(eventsOf(state, "action_rejected")).toEqual([
      expect.objectContaining({ player: ILYRA, section: "play", action: "setLeaderAbility", reason: "wrongSection" }),
    ]);
    const set = eventsOf(state, "leader_ability_set");
    expect(set).toEqual([expect.objectContaining({ player: ILYRA, target: hexes(at("right", 2, 4)), phase: "reveal" })]);
    expect(set[0]?.visibleTo).toBeUndefined();
    // Rundenende: zurückgesetzt, in der nächsten Runde erneut wählbar.
    expect(getPlayer(state, ILYRA).leaderAbility).toBeNull();
  });

  it("R-7.7/R-1.9: der automatisch gewählte erste Ast gilt schon für die Fähigkeit derselben Planung", () => {
    const state = inPlanning();
    setLevel(state, ILYRA, 2);
    submitPlanning(state, ILYRA, {
      position: [{ type: "setLeaderAbility", target: hexes(at("right", 1, 4), at("left", 1, 1), at("center", 3, 3)) }],
    });
    submitOthers(state, ILYRA);
    advance(state, data);
    expect(eventsOf(state, "action_rejected")).toEqual([]);
    expect(eventsOf(state, "leader_ability_set")).toEqual([expect.objectContaining({ player: ILYRA })]);
    expect(getPlayer(state, ILYRA).leader.branchId).toBe("chain");
  });
});
