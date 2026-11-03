import { describe, expect, it } from "vitest";
import type { ActionTarget, Planning } from "./actions";
import { type CombatEvent, createCombat, dealDamage, type FighterInit, simulateCombat, stepCombat } from "./combat";
import { loadGameData } from "./data";
import { effectHooks } from "./effects";
import { frontParticipants } from "./fronts";
import { frontArenaSize } from "./hex";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { isUnwoundable, resolvePreCombatSpells } from "./spells";
import {
  type CardInstanceId,
  type GameEvent,
  type GameState,
  getPlayer,
  PLAYER_INDICES,
  type PlayerIndex,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "./state";
import { unitArenaHex } from "./targets";

const data = loadGameData();
const config = data.config;
const SIZE = frontArenaSize(config.arenas.frontZone);
const EMPTY: Planning = { play: [], buy: [], position: [] };

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 17): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string, kind: "card" | "token" = "card"): UnitId {
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

function setPre(state: GameState, player: PlayerIndex, cardId: string, target: ActionTarget): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  getPlayer(state, player).spells.pre.push({ cardInstanceId: id, cardId, target });
  return id;
}

/** Feld, auf dem eine gegnerische Einheit steht, aus Sicht von `caster` (gleiche Koordinaten, eigene Arena). */
function enemyHex(state: GameState, enemy: UnitId, arena: "left" | "right" | "center"): ActionTarget {
  const at = unitArenaHex(config, unit(state, enemy));
  if (!at) throw new Error("Einheit steht in der Reserve");
  return { kind: "hexes", hexes: [{ arena, cell: at.cell }] };
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function ofType<T extends CombatEvent["type"]>(events: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

function runRound(state: GameState): number {
  for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
  const from = state.log.length;
  advance(state, data);
  return from;
}

function testFighter(id: number, team: number, col: number, row: number, extra: Partial<FighterInit> = {}): FighterInit {
  return {
    id,
    team,
    sourceId: "test",
    behavior: "default",
    pos: { col, row },
    stats: { attack: 5, hp: 3, breakthrough: 0, range: 1 },
    hasManaAbility: false,
    ...extra,
  };
}

describe("E11b2: Frostlanze verwundet vor dem Kampf (R-14.4)", () => {
  it("R-14.4: Frostlanze verwundet die gegnerische Einheit auf dem Feld der rechten Frontarena sofort", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit");
    const lance = setPre(state, 0, "frost_lance", enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(unit(state, enemy).wounded).toBe(true);
    expect(eventsOf(state, "spell_resolved")).toEqual([expect.objectContaining({ cardId: "frost_lance", player: 0 })]);
    expect(eventsOf(state, "unit_wounded")).toEqual([
      expect.objectContaining({ player: 1, unitId: enemy, cardId: "frost_lance", arena: null }),
    ]);
    expect(getPlayer(state, 0).discard).toContain(lance);
    expect(getPlayer(state, 0).spells.pre).toEqual([]);
  });

  it("R-14.4: Frostlanze in der linken Frontarena trifft den linken Nachbarn, in der Mitte jeden anderen Spieler", () => {
    const state = emptyBoard();
    // Spieler 0 links gegen den linken Nachbarn (Spieler 3) in dessen rechter Zone.
    const left = placeUnit(state, 3, front("right", 2, 0), "recruit");
    const centerEnemy = placeUnit(state, 2, { zone: "center", position: 0 }, "recruit");
    setPre(state, 0, "frost_lance", enemyHex(state, left, "left"));
    setPre(state, 0, "frost_lance", enemyHex(state, centerEnemy, "center"));
    resolvePreCombatSpells(state, data);
    expect(unit(state, left).wounded).toBe(true);
    expect(unit(state, centerEnemy).wounded).toBe(true);
  });

  it("R-14.4: eine von der Frostlanze verwundete Einheit nimmt am Frontkampf der Runde nicht teil und zählt weiter gegen die Kapazität", () => {
    const state = emptyBoard();
    const own = placeUnit(state, 0, front("right", 2, 2), "recruit");
    const enemy = placeUnit(state, 1, front("left", 2, 2), "squire");
    setPre(state, 0, "frost_lance", enemyHex(state, enemy, "right"));
    const from = runRound(state);
    const started = eventsOf(state, "combat_started", from).filter((e) => e.arena === "front:0-1");
    expect(started).toEqual([]);
    const resolved = eventsOf(state, "front_resolved", from).find((e) => e.arena === "front:0-1");
    expect(resolved).toEqual(expect.objectContaining({ outcome: "emptyFront", winner: 0, survivors: [own] }));
    // Die Einheit steht weiter auf dem Brett, verwundet.
    expect(unit(state, enemy).location).toEqual(front("left", 2, 2));
    expect(unit(state, enemy).wounded).toBe(true);
    expect(frontParticipants(state, { first: 0, second: 1 }).second).toEqual([]);
  });

  it("R-8.5: Frostlanze auf ein Feld ohne gegnerische Einheit oder mit einer schon verwundeten verpufft", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit");
    unit(state, enemy).wounded = true;
    setPre(state, 0, "frost_lance", enemyHex(state, enemy, "right"));
    // Eigene Einheit auf dem gespiegelten Feld der anderen Frontarena zählt nicht als Gegner.
    const own = placeUnit(state, 0, front("left", 1, 1), "recruit");
    setPre(state, 0, "frost_lance", { kind: "hexes", hexes: [{ arena: "left", cell: unitArenaHex(config, unit(state, own))!.cell }] });
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled").map((e) => e.reason)).toEqual(["noValidTarget", "noValidTarget"]);
    expect(eventsOf(state, "unit_wounded")).toEqual([]);
    expect(unit(state, own).wounded).toBe(false);
  });

  it("R-14.4, R-17.2: Zwerge 4 (unwoundable) schützen vor der Frostlanze, der Zauber verpufft", () => {
    const state = emptyBoard();
    // Spieler 0 hat Brann (Zwerg): mit drei Zwergen-Karten zusammen Zwerge 4.
    const veteran = placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    placeUnit(state, 0, front("left", 1, 0), "runesmith");
    placeUnit(state, 0, front("right", 0, 0), "thunder_gun");
    unit(state, getPlayer(state, 0).leader.unitId).location = front("right", 1, 0);
    expect(isUnwoundable(state, data, unit(state, veteran))).toBe(true);
    // Spieler 3 (linker Nachbar von 0) zaubert in seiner rechten Frontarena auf die linke Zone von Spieler 0.
    setPre(state, 3, "frost_lance", enemyHex(state, veteran, "right"));
    resolvePreCombatSpells(state, data);
    expect(unit(state, veteran).wounded).toBe(false);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 3, reason: "noValidTarget" })]);
  });

  it("R-14.4, R-17.1: Ohne Zwerge 4 verwundet die Frostlanze auch Zwerge", () => {
    const state = emptyBoard();
    const veteran = placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    placeUnit(state, 0, front("left", 1, 0), "runesmith");
    expect(isUnwoundable(state, data, unit(state, veteran))).toBe(false);
    setPre(state, 3, "frost_lance", enemyHex(state, veteran, "right"));
    resolvePreCombatSpells(state, data);
    expect(unit(state, veteran).wounded).toBe(true);
  });

  it("R-14.4: unwoundable aus einem Vorkampf-Effekt schützt vor der Frostlanze", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit");
    unit(state, enemy).roundEffects = { shield: 0, buffs: {}, keywords: ["unwoundable"] };
    expect(isUnwoundable(state, data, unit(state, enemy))).toBe(true);
    setPre(state, 0, "frost_lance", enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(unit(state, enemy).wounded).toBe(false);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ cardId: "frost_lance", reason: "noValidTarget" })]);
  });
});

describe("E11b2: Verwunden im Kampf (R-14.4)", () => {
  it("R-14.4: Ein Bezwinger mit woundOnKill verwundet die besiegte Einheit (Ereignis direkt nach dem Tod)", () => {
    const killer = testFighter(1, 0, 2, 2, { keywords: ["woundOnKill"] });
    const victim = testFighter(2, 1, 2, 3, { stats: { attack: 0, hp: 3, breakthrough: 0, range: 1 } });
    const result = simulateCombat(config, SIZE, [killer, victim]);
    expect(result.wounded).toEqual([2]);
    const died = result.events.findIndex((e) => e.type === "combat_unit_died" && e.unit === 2);
    expect(result.events[died + 1]).toEqual({ type: "combat_unit_wounded", tick: expect.any(Number), unit: 2, source: 1, cause: "woundOnKill" });
  });

  it("R-14.4: Ohne wound bzw. woundOnKill ist eine besiegte Einheit nicht verwundet", () => {
    const result = simulateCombat(config, SIZE, [testFighter(1, 0, 2, 2), testFighter(2, 1, 2, 3, { stats: { attack: 0, hp: 3, breakthrough: 0, range: 1 } })]);
    expect(result.wounded).toEqual([]);
    expect(ofType(result.events, "combat_unit_wounded")).toEqual([]);
  });

  it("R-14.4: Schaden mit wound: true verwundet das dadurch besiegte Ziel, nicht überlebende Ziele", () => {
    const sim = createCombat(config, SIZE, [testFighter(1, 0, 0, 0), testFighter(2, 1, 4, 5), testFighter(3, 1, 3, 5, { stats: { attack: 1, hp: 50, breakthrough: 0, range: 1 } })]);
    const [a, b, c] = sim.fighters;
    dealDamage(sim, a!, b!, 10, "ability", { wound: true });
    dealDamage(sim, a!, c!, 10, "ability", { wound: true });
    expect(b!.wounded).toBe(true);
    expect(c!.wounded).toBe(false);
    expect(ofType(sim.events, "combat_unit_wounded")).toEqual([{ type: "combat_unit_wounded", tick: 0, unit: 2, source: 1, cause: "woundEffect" }]);
  });

  it("R-14.4: Fähigkeit mit damage und wound: true (Effekt-System) verwundet besiegte Ziele", () => {
    const caster = testFighter(1, 0, 2, 0, {
      abilities: [{ trigger: "onCombatStart", effects: [{ op: "damage", amount: 20, target: { kind: "nearestEnemies", count: 1 }, wound: true }] }],
    });
    const fx = effectHooks(data);
    const sim = createCombat(config, SIZE, [caster, testFighter(2, 1, 2, 5)], fx.hooks);
    stepCombat(sim);
    expect(ofType(sim.events, "combat_unit_wounded")).toEqual([expect.objectContaining({ unit: 2, source: 1, cause: "woundEffect" })]);
  });

  it("R-14.4, R-17.2: unwoundable schützt im Kampf vor woundOnKill und wound", () => {
    const killer = testFighter(1, 0, 2, 2, { keywords: ["woundOnKill"] });
    const victim = testFighter(2, 1, 2, 3, { stats: { attack: 0, hp: 3, breakthrough: 0, range: 1 }, keywords: ["unwoundable"] });
    const result = simulateCombat(config, SIZE, [killer, victim]);
    expect(ofType(result.events, "combat_unit_died").map((e) => e.unit)).toEqual([2]);
    expect(result.wounded).toEqual([]);
    const sim = createCombat(config, SIZE, [testFighter(1, 0, 0, 0), testFighter(2, 1, 4, 5, { keywords: ["unwoundable"] })]);
    dealDamage(sim, sim.fighters[0]!, sim.fighters[1]!, 99, "ability", { wound: true });
    expect(sim.fighters[1]!.wounded).toBe(false);
  });

  it("R-14.4: Giftklinge im Rundenablauf – die vom Träger besiegte Einheit ist nach dem Kampf verwundet und kämpft in der nächsten Runde nicht", () => {
    const state = emptyBoard();
    const thief = placeUnit(state, 0, front("right", 2, 2), "shieldwall_veteran");
    const enemy = placeUnit(state, 1, front("left", 2, 2), "pickpocket");
    // Giftklinge über die Planung legen.
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    const blade = state.nextCardInstanceId++;
    state.cards[blade] = { id: blade, cardId: "poison_blade", owner: 0 };
    p.hand.push(blade);
    const target: ActionTarget = { kind: "hexes", hexes: [unitArenaHex(config, unit(state, thief))!] };
    expect(submitPlanning(state, 0, { play: [{ type: "setSpell", cardInstanceId: blade, slot: "pre", target }], buy: [], position: [] })).toEqual({ ok: true });
    for (const other of [1, 2, 3] as const) submitPlanning(state, other, EMPTY);
    const from = state.log.length;
    advance(state, data);
    expect(eventsOf(state, "combat_unit_died", from).some((e) => e.unit === enemy && e.killer === thief)).toBe(true);
    expect(eventsOf(state, "combat_unit_wounded", from)).toEqual([
      expect.objectContaining({ unit: enemy, source: thief, cause: "woundOnKill", arena: "front:0-1" }),
    ]);
    expect(eventsOf(state, "unit_wounded", from)).toEqual([
      expect.objectContaining({ player: 1, unitId: enemy, cardId: null, arena: "front:0-1", phase: "combat" }),
    ]);
    expect(state.frontResults.find((r) => r.arena === "front:0-1")?.wounded).toEqual([enemy]);
    expect(unit(state, enemy).wounded).toBe(true);
    // Nächste Runde: Giftklinge ist verfallen, der verwundete Taschendieb kämpft nicht.
    while (state.phase !== "planning") advance(state, data);
    const next = runRound(state);
    const resolved = eventsOf(state, "front_resolved", next).find((e) => e.arena === "front:0-1");
    expect(resolved).toEqual(expect.objectContaining({ outcome: "emptyFront", winner: 0 }));
  });

  it("R-14.4: Im Kampf verwundet besiegte Tokens werden nicht verwundet, sondern verschwinden (R-1.4)", () => {
    const state = emptyBoard();
    const veteran = placeUnit(state, 0, front("right", 2, 2), "shieldwall_veteran");
    const token = placeUnit(state, 1, front("left", 2, 2), "small_spirit", "token");
    unit(state, veteran).roundEffects = { shield: 0, buffs: {}, keywords: ["woundOnKill"] };
    const from = runRound(state);
    expect(eventsOf(state, "combat_unit_wounded", from).map((e) => e.unit)).toEqual([token]);
    expect(eventsOf(state, "unit_wounded", from)).toEqual([]);
    expect(state.units[token]).toBeUndefined();
  });

  it("Determinismus: Frostlanze und Giftklinge, gleicher Zustand = gleiches Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(29);
      const a = placeUnit(state, 0, front("right", 2, 2), "shieldwall_veteran");
      placeUnit(state, 1, front("left", 2, 2), "pickpocket");
      const c = placeUnit(state, 1, front("left", 1, 1), "recruit");
      unit(state, a).roundEffects = { shield: 0, buffs: {}, keywords: ["woundOnKill"] };
      setPre(state, 0, "frost_lance", enemyHex(state, c, "right"));
      runRound(state);
      return state;
    };
    expect(build().log).toEqual(build().log);
  });
});
