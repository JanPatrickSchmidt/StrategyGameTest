import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaRef, Planning } from "./actions";
import { loadGameData } from "./data";
import { fighterForUnit } from "./fronts";
import { LEADER_CATEGORY_STEPS, resolveLeaderAbilities } from "./leaderAbilities";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();
const EMPTY: Planning = { play: [], buy: [], position: [] };
// Standard-Anführer: 0 Brann (zone, buff), 1 Ilyra, 2 Vex, 3 Morgra.
const BRANN: PlayerIndex = 0;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const zoneTarget = (...arenas: ArenaRef[]): ActionTarget => ({ kind: "zone", arenas });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 23): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit", kind: "card" | "token" = "card"): UnitId {
  const id = state.nextUnitId++;
  const cardInstanceIds: number[] = [];
  if (kind === "card") {
    const instance = state.nextCardInstanceId++;
    state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
    cardInstanceIds.push(instance);
  }
  state.units[id] = { id, owner: player, kind, sourceId, cardInstanceIds, stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function unit(state: GameState, id: UnitId): Unit {
  return state.units[id] as Unit;
}

function stats(state: GameState, id: UnitId) {
  return fighterForUnit(state, data, unit(state, id), { col: 0, row: 0 }).stats;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function setBrann(state: GameState, level: 1 | 2 | 3 | 4, branchId: string | null, target: ActionTarget): void {
  const p = getPlayer(state, BRANN);
  p.leader.level = level;
  p.leader.branchId = branchId;
  p.leaderAbility = target;
}

/** Brann-Einheiten in allen drei Zonen; gibt die Einheiten je Zone zurück. */
function brannBoard(state: GameState): Record<ArenaRef, UnitId> {
  return {
    left: placeUnit(state, BRANN, front("left", 0, 0)),
    right: placeUnit(state, BRANN, front("right", 0, 0)),
    center: placeUnit(state, BRANN, { zone: "center", position: 0 }),
  };
}

/** Wirkt Branns Sammelruf und gibt die Zuschläge auf Angriff und Leben je Zone zurück. */
function gains(level: 1 | 2 | 3 | 4, branchId: string | null, target: ActionTarget): Record<ArenaRef, [number, number]> {
  const state = emptyBoard();
  const ids = brannBoard(state);
  const before = Object.fromEntries(Object.entries(ids).map(([z, id]) => [z, stats(state, id)]));
  setBrann(state, level, branchId, target);
  resolveLeaderAbilities(state, data);
  const result = {} as Record<ArenaRef, [number, number]>;
  for (const [zone, id] of Object.entries(ids) as [ArenaRef, UnitId][]) {
    const s = stats(state, id);
    const b = before[zone] as typeof s;
    result[zone] = [s.attack - b.attack, s.hp - b.hp];
  }
  return result;
}

describe("R-8.2: Anführer-Fähigkeiten nach Kategorien (E11c1)", () => {
  it("R-8.2: Reihenfolge der Kategorien summon/move → buff → damage", () => {
    expect(LEADER_CATEGORY_STEPS).toEqual([["summon", "move"], ["buff"], ["damage"]]);
  });

  it("R-8.2: Brann Stufe 1 – Sammelruf gibt allen eigenen Einheiten der gewählten Zone +2 Angriff, inkl. Anführer und Tokens", () => {
    const state = emptyBoard();
    const ids = brannBoard(state);
    const leaderId = getPlayer(state, BRANN).leader.unitId;
    unit(state, leaderId).location = front("left", 2, 1);
    const token = placeUnit(state, BRANN, front("left", 1, 1), "spirit", "token");
    const enemy = placeUnit(state, 1, front("right", 0, 0));
    const attack = (id: UnitId) => stats(state, id).attack;
    const before = [ids.left, leaderId, token, ids.right, ids.center, enemy].map(attack);
    setBrann(state, 1, null, zoneTarget("left"));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    const after = [ids.left, leaderId, token, ids.right, ids.center, enemy].map(attack);
    expect(after.map((a, i) => a - (before[i] as number))).toEqual([2, 2, 2, 0, 0, 0]);
    expect(eventsOf(state, "leader_ability_resolved", from)).toMatchObject([
      { type: "leader_ability_resolved", player: BRANN, leaderId: "brann", category: "buff", level: 1, branchId: null },
    ]);
    expect(eventsOf(state, "unit_buffed", from).map((e) => [e.unitId, e.stat, e.amount, e.duration, e.cardId])).toEqual(
      [ids.left, leaderId, token].sort((a, b) => a - b).map((id) => [id, "attack", 2, "combat", "brann"]),
    );
  });

  it("R-16.2: Brann „Weite“ – Stufe 2: 2 Zonen +2, Stufe 3: 2 Zonen +3, Stufe 4: 3 Zonen +3", () => {
    expect(gains(2, "reach", zoneTarget("left", "right"))).toEqual({ left: [2, 0], right: [2, 0], center: [0, 0] });
    expect(gains(3, "reach", zoneTarget("left", "center"))).toEqual({ left: [3, 0], right: [0, 0], center: [3, 0] });
    expect(gains(4, "reach", zoneTarget("left", "right", "center"))).toEqual({ left: [3, 0], right: [3, 0], center: [3, 0] });
  });

  it("R-16.2: Brann „Wucht“ – Stufe 2/3/4: +4/+5/+6 Angriff in einer Zone", () => {
    expect(gains(2, "might", zoneTarget("right"))).toEqual({ left: [0, 0], right: [4, 0], center: [0, 0] });
    expect(gains(3, "might", zoneTarget("right"))).toEqual({ left: [0, 0], right: [5, 0], center: [0, 0] });
    expect(gains(4, "might", zoneTarget("center"))).toEqual({ left: [0, 0], right: [0, 0], center: [6, 0] });
  });

  it("R-16.2: Brann „Standhaft“ – Stufe 2/3/4: +2/+4, +3/+6, +3/+10 auf Angriff/Leben", () => {
    expect(gains(2, "steadfast", zoneTarget("left"))).toEqual({ left: [2, 4], right: [0, 0], center: [0, 0] });
    expect(gains(3, "steadfast", zoneTarget("left"))).toEqual({ left: [3, 6], right: [0, 0], center: [0, 0] });
    expect(gains(4, "steadfast", zoneTarget("left"))).toEqual({ left: [3, 10], right: [0, 0], center: [0, 0] });
  });

  it("R-16.4: wirkt auch, wenn Brann selbst in der Reserve steht oder verwundet ist; verwundete Einheiten sind kein Ziel", () => {
    const state = emptyBoard();
    const leaderId = getPlayer(state, BRANN).leader.unitId;
    unit(state, leaderId).wounded = true;
    const healthy = placeUnit(state, BRANN, front("left", 0, 0));
    const wounded = placeUnit(state, BRANN, front("left", 1, 0));
    unit(state, wounded).wounded = true;
    setBrann(state, 1, null, zoneTarget("left"));
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "unit_buffed").map((e) => e.unitId)).toEqual([healthy]);
  });

  it("R-8.2/R-8.5: ohne gültige Einheit in der Zone verpufft die Fähigkeit (F42)", () => {
    const state = emptyBoard();
    placeUnit(state, BRANN, front("right", 0, 0));
    setBrann(state, 1, null, zoneTarget("left"));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_fizzled", from)).toMatchObject([
      { type: "leader_ability_fizzled", player: BRANN, leaderId: "brann", category: "buff", reason: "noValidTarget" },
    ]);
    expect(eventsOf(state, "leader_ability_resolved", from)).toEqual([]);
    expect(eventsOf(state, "unit_buffed", from)).toEqual([]);
  });

  it("R-8.2: keine Wahl, „keine Fähigkeit“ oder ausgeschiedener Spieler lösen nichts aus", () => {
    for (const setup of ["null", "none", "eliminated"] as const) {
      const state = emptyBoard();
      placeUnit(state, BRANN, front("left", 0, 0));
      if (setup === "null") getPlayer(state, BRANN).leaderAbility = null;
      if (setup === "none") setBrann(state, 1, null, { kind: "none" });
      if (setup === "eliminated") {
        setBrann(state, 1, null, zoneTarget("left"));
        getPlayer(state, BRANN).eliminated = true;
      }
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(state.log.slice(from)).toEqual([]);
    }
  });

  it("R-8.2: im Rundenablauf vor den Vorkampf-Zaubern, addiert sich mit Kriegsruf, verfällt beim Aufräumen (R-12.4)", () => {
    const state = emptyBoard();
    const ally = placeUnit(state, BRANN, front("left", 0, 0));
    const base = stats(state, ally);
    // Kriegsruf direkt in den Slot legen (wie nach `setSpell`).
    const spell = state.nextCardInstanceId++;
    state.cards[spell] = { id: spell, cardId: "war_cry", owner: BRANN };
    getPlayer(state, BRANN).spells.pre.push({ cardInstanceId: spell, cardId: "war_cry", target: zoneTarget("left") });
    for (const p of PLAYER_INDICES) {
      submitPlanning(state, p, p === BRANN ? { ...EMPTY, position: [{ type: "setLeaderAbility", target: zoneTarget("left") }] } : EMPTY);
    }
    const from = state.log.length;
    // Ganze Runde bis zur nächsten Planung; die Reihenfolge steht im Protokoll.
    advance(state, data);
    const log = state.log.slice(from);
    const leaderAt = log.findIndex((e) => e.type === "leader_ability_resolved");
    const spellAt = log.findIndex((e) => e.type === "spell_resolved");
    const combatAt = log.findIndex((e) => e.type === "phase_started" && e.phase === "combat");
    expect(leaderAt).toBeGreaterThanOrEqual(0);
    expect(leaderAt).toBeLessThan(spellAt);
    expect(spellAt).toBeLessThan(combatAt);
    const buffs = eventsOf(state, "unit_buffed", from).filter((e) => e.unitId === ally);
    expect(buffs.map((e) => [e.stat, e.amount, e.cardId])).toEqual([
      ["attack", 2, "brann"],
      ["hp", 2, "war_cry"],
    ]);
    // Nach dem Aufräumen sind die Zuschläge wieder weg.
    expect(stats(state, ally)).toEqual(base);
    expect(eventsOf(state, "unit_round_effects_cleared", from).map((e) => e.unitId)).toContain(ally);
  });
});
