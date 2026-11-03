import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaRef, Planning } from "./actions";
import { loadGameData } from "./data";
import { fighterForUnit } from "./fronts";
import { priorityForRound } from "./marks";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { resolvePreCombatSpells } from "./spells";
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

function fighter(state: GameState, id: UnitId) {
  return fighterForUnit(state, data, unit(state, id), { col: 0, row: 0 });
}

function newCard(state: GameState, player: PlayerIndex, cardId: string): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  return id;
}

/** Legt einen Vorkampf-Zauber direkt in den Slot (wie nach `setSpell`, ohne Planung). */
function setPre(state: GameState, player: PlayerIndex, cardId: string, target: ActionTarget): CardInstanceId {
  const id = newCard(state, player, cardId);
  getPlayer(state, player).spells.pre.push({ cardInstanceId: id, cardId, target });
  return id;
}

/** Feld-Ziel auf das Feld, auf dem eine eigene Einheit steht. */
function hexOf(state: GameState, id: UnitId): ActionTarget {
  const at = unitArenaHex(data.config, unit(state, id));
  if (!at) throw new Error("Einheit steht in der Reserve");
  return { kind: "hexes", hexes: [at] };
}

const zoneTarget = (...arenas: ArenaRef[]): ActionTarget => ({ kind: "zone", arenas });

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function runRound(state: GameState): number {
  for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
  const from = state.log.length;
  advance(state, data);
  return from;
}

describe("E11b1: Vorkampf-Zauber auf eigene Einheiten", () => {
  it("R-8.3, R-14.3: Schutzrune gibt der eigenen Einheit auf dem Feld 5 Schild für die Kämpfe der Runde", () => {
    const state = emptyBoard();
    const squire = placeUnit(state, 0, front("right", 1, 1), "squire");
    const rune = setPre(state, 0, "rune_shield", hexOf(state, squire));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toEqual([expect.objectContaining({ player: 0, cardInstanceId: rune, slot: "pre", tempo: 1 })]);
    expect(eventsOf(state, "unit_shielded")).toEqual([expect.objectContaining({ player: 0, unitId: squire, amount: 5, shield: 5, cardId: "rune_shield" })]);
    expect(fighter(state, squire).shield).toBe(5);
    expect(getPlayer(state, 0).spells.pre).toEqual([]);
    expect(getPlayer(state, 0).discard).toContain(rune);
  });

  it("R-14.3: mehrere Schilde addieren sich", () => {
    const state = emptyBoard();
    const squire = placeUnit(state, 0, front("left", 2, 0), "squire");
    setPre(state, 0, "rune_shield", hexOf(state, squire));
    setPre(state, 0, "rune_shield", hexOf(state, squire));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_shielded").map((e) => e.shield)).toEqual([5, 10]);
    expect(fighter(state, squire).shield).toBe(10);
  });

  it("R-8.3: Kriegsruf gibt allen eigenen, nicht verwundeten Einheiten der Zone +2 Leben, auch Anführer und Tokens", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 0, front("right", 0, 0), "recruit");
    const b = placeUnit(state, 0, front("right", 3, 2), "squire");
    const token = placeUnit(state, 0, front("right", 4, 0), "small_spirit", "token");
    const wounded = placeUnit(state, 0, front("right", 1, 1), "recruit");
    unit(state, wounded).wounded = true;
    const otherZone = placeUnit(state, 0, front("left", 1, 1), "recruit");
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit");
    const leader = getPlayer(state, 0).leader.unitId;
    unit(state, leader).location = front("right", 2, 1);
    const hpBefore = (id: UnitId) => fighter(state, id).stats.hp;
    const before = [a, b, token, leader, wounded, otherZone, enemy].map(hpBefore);
    setPre(state, 0, "war_cry", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    const after = [a, b, token, leader, wounded, otherZone, enemy].map(hpBefore);
    expect(after).toEqual([before[0]! + 2, before[1]! + 2, before[2]! + 2, before[3]! + 2, before[4], before[5], before[6]]);
    expect(eventsOf(state, "unit_buffed").map((e) => e.unitId)).toEqual([leader, a, b, token].sort((x, y) => x - y));
    expect(eventsOf(state, "unit_buffed")[0]).toEqual(expect.objectContaining({ stat: "hp", amount: 2, duration: "combat", cardId: "war_cry" }));
  });

  it("R-8.3: Giftklinge verleiht der Einheit auf dem Feld das Schlüsselwort woundOnKill für die Kämpfe der Runde", () => {
    const state = emptyBoard();
    const thief = placeUnit(state, 0, front("right", 2, 2), "pickpocket");
    expect(fighter(state, thief).keywords ?? []).not.toContain("woundOnKill");
    setPre(state, 0, "poison_blade", hexOf(state, thief));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_keyword_granted")).toEqual([
      expect.objectContaining({ player: 0, unitId: thief, keyword: "woundOnKill", cardId: "poison_blade" }),
    ]);
    expect(fighter(state, thief).keywords).toContain("woundOnKill");
  });

  it("R-8.5: Schutzrune auf ein leeres Feld verpufft, die Kosten bleiben bezahlt, die Karte geht auf den Ablagestapel", () => {
    const state = emptyBoard();
    const squire = placeUnit(state, 0, front("right", 1, 1), "squire");
    const target = hexOf(state, squire);
    unit(state, squire).location = front("right", 3, 1);
    const gold = { pool: getPlayer(state, 0).roundGold, treasury: getPlayer(state, 0).treasury };
    const rune = setPre(state, 0, "rune_shield", target);
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 0, cardInstanceId: rune, slot: "pre", reason: "noValidTarget" })]);
    expect(eventsOf(state, "unit_shielded")).toEqual([]);
    expect(getPlayer(state, 0).discard).toContain(rune);
    expect({ pool: getPlayer(state, 0).roundGold, treasury: getPlayer(state, 0).treasury }).toEqual(gold);
  });

  it("R-8.5: Ein Feld mit nur einer verwundeten Einheit enthält keine gültige Einheit, der Zauber verpufft", () => {
    const state = emptyBoard();
    const squire = placeUnit(state, 0, front("right", 1, 1), "squire");
    unit(state, squire).wounded = true;
    setPre(state, 0, "poison_blade", hexOf(state, squire));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ reason: "noValidTarget" })]);
    expect(unit(state, squire).roundEffects).toBeUndefined();
  });

  it("R-8.5: Kriegsruf auf eine Zone ohne eigene Einheiten verpufft", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 1, 1), "recruit");
    setPre(state, 0, "war_cry", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ cardId: "war_cry", reason: "noValidTarget" })]);
  });

  it("R-8.3: Tempo 1 vor Tempo 2, bei gleichem Tempo nach Prioritätsreihenfolge, jeder Zauber vollständig", () => {
    const state = emptyBoard();
    const order = priorityForRound(state.round);
    const [first, second] = [order[0] as PlayerIndex, order[1] as PlayerIndex];
    const u1 = placeUnit(state, first, front("right", 1, 1), "squire");
    const u2 = placeUnit(state, second, front("right", 1, 1), "squire");
    // Spieler in Prioritätsreihenfolge an zweiter Stelle legt Tempo 1, der erste Tempo 2.
    setPre(state, first, "poison_blade", hexOf(state, u1));
    setPre(state, second, "war_cry", zoneTarget("right"));
    const extra = placeUnit(state, first, front("right", 2, 1), "squire");
    setPre(state, first, "rune_shield", hexOf(state, extra));
    resolvePreCombatSpells(state, data);
    const sequence = state.log
      .filter((e) => e.type === "spell_resolved" || e.type === "unit_buffed" || e.type === "unit_shielded" || e.type === "unit_keyword_granted")
      .map((e) => (e.type === "spell_resolved" ? `${e.cardId}@${e.player}` : e.type));
    expect(sequence).toEqual([
      `rune_shield@${first}`,
      "unit_shielded",
      `war_cry@${second}`,
      "unit_buffed",
      `poison_blade@${first}`,
      "unit_keyword_granted",
    ]);
    expect(unit(state, u2).roundEffects?.buffs.hp).toBe(2);
  });

  it("R-8.3: im Rundenablauf wirkt der Schild im Kampf und der Zauber wird in der Phase preCombatSpells aufgelöst", () => {
    const state = emptyBoard();
    // Spieler 0 rechts gegen den linken Nachbarn in dessen linker Zone (Front 0-1).
    const guard = placeUnit(state, 0, front("right", 2, 2), "squire");
    placeUnit(state, 1, front("left", 2, 2), "recruit");
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    const rune = newCard(state, 0, "rune_shield");
    p.hand.push(rune);
    const target = hexOf(state, guard);
    expect(submitPlanning(state, 0, { play: [{ type: "setSpell", cardInstanceId: rune, slot: "pre", target }], buy: [], position: [] })).toEqual({ ok: true });
    for (const other of [1, 2, 3] as const) submitPlanning(state, other, EMPTY);
    const from = state.log.length;
    advance(state, data);
    expect(eventsOf(state, "spell_resolved", from)).toEqual([expect.objectContaining({ cardInstanceId: rune, phase: "preCombatSpells" })]);
    const hits = eventsOf(state, "combat_damage", from).filter((e) => e.target === guard);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.absorbed).toBeGreaterThan(0);
    expect(eventsOf(state, "spell_discarded", from).filter((e) => e.cardInstanceId === rune)).toHaveLength(1);
  });

  it("R-12.4: Schild, Buffs und Schlüsselwörter aus Vorkampf-Zaubern verfallen beim Aufräumen", () => {
    const state = emptyBoard();
    const squire = placeUnit(state, 0, front("right", 1, 1), "squire");
    setPre(state, 0, "rune_shield", hexOf(state, squire));
    const from = runRound(state);
    expect(eventsOf(state, "unit_round_effects_cleared", from)).toEqual([
      expect.objectContaining({ player: 0, unitId: squire, phase: "cleanup" }),
    ]);
    expect(unit(state, squire).roundEffects).toBeUndefined();
    expect(fighter(state, squire).shield ?? 0).toBe(0);
  });

  it("Vorkampf-Zauber mit noch fehlenden Bausteinen (Feuerball) bleiben liegen und gehen beim Rundenende ab", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit");
    const at = unitArenaHex(data.config, unit(state, enemy));
    const ball = setPre(state, 0, "fireball", { kind: "hexes", hexes: [{ arena: "right", cell: at!.cell }] });
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toEqual([]);
    expect(getPlayer(state, 0).spells.pre.map((s) => s.cardInstanceId)).toEqual([ball]);
  });

  it("Determinismus: gleiche Vorkampf-Zauber, gleicher Zustand = gleiches Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(23);
      const a = placeUnit(state, 0, front("right", 1, 1), "squire");
      placeUnit(state, 1, front("left", 1, 1), "recruit");
      setPre(state, 0, "rune_shield", hexOf(state, a));
      setPre(state, 1, "war_cry", zoneTarget("left"));
      runRound(state);
      return state;
    };
    expect(build().log).toEqual(build().log);
  });
});
