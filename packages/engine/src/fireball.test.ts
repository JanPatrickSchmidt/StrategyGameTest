import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaRef, Planning } from "./actions";
import { createCombat } from "./combat";
import { type GameData, loadGameData } from "./data";
import type { CardData, SpellCard } from "./dataTypes";
import { fighterForUnit, frontParticipants } from "./fronts";
import { frontArenaSize } from "./hex";
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
const config = data.config;
const SIZE = frontArenaSize(config.arenas.frontZone);
const EMPTY: Planning = { play: [], buy: [], position: [] };

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 31): GameState {
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

/** Feld einer Einheit in der Arena, aus Sicht eines Spielers, der diese Arena als `arena` sieht. */
function hexOfUnit(state: GameState, id: UnitId, arena: ArenaRef): ActionTarget {
  const at = unitArenaHex(config, unit(state, id));
  if (!at) throw new Error("Einheit steht in der Reserve");
  return { kind: "hexes", hexes: [{ arena, cell: at.cell }] };
}

const hex = (arena: ArenaRef, col: number, row: number): ActionTarget => ({ kind: "hexes", hexes: [{ arena, cell: { col, row } }] });

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function runRound(state: GameState): number {
  for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
  const from = state.log.length;
  advance(state, data);
  return from;
}

/** Lebenspunkte, mit denen die Einheit in einen Kampf dieser Runde startet. */
function startHp(state: GameState, id: UnitId): number {
  const init = fighterForUnit(state, data, unit(state, id), { col: 0, row: 0 });
  const sim = createCombat(config, SIZE, [init]);
  return (sim.fighters[0] as { hp: number }).hp;
}

/** Spieldaten mit geänderten Effekten des Feuerballs (für Bausteine, die noch keine Karte nutzt). */
function withFireballEffects(effects: SpellCard["effects"]): GameData {
  const cards = new Map<string, CardData>(data.cards);
  const fireball = data.cards.get("fireball") as SpellCard;
  cards.set("fireball", { ...fireball, effects } as CardData);
  return { ...data, cards };
}

describe("E11b3: Feuerball – Schaden vor dem Kampf (R-14.2)", () => {
  it("R-14.2: Feuerball macht 5 Schaden auf dem Feld und 2 auf den gegnerischen Nachbarfeldern", () => {
    const state = emptyBoard();
    // Gegner (rechter Nachbar, Spieler 1) in seiner linken Zone; in der Arena von Spieler 0 die Zeilen 3–5.
    const center = placeUnit(state, 1, front("left", 1, 1), "shieldwall_veteran");
    const at = unitArenaHex(config, unit(state, center))!.cell;
    const neighbor = placeUnit(state, 1, front("left", 0, 1), "shieldwall_veteran");
    const far = placeUnit(state, 1, front("left", 3, 0), "shieldwall_veteran");
    expect(unitArenaHex(config, unit(state, neighbor))!.cell.row).toBe(at.row);
    const ball = setPre(state, 0, "fireball", hexOfUnit(state, center, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toEqual([expect.objectContaining({ cardId: "fireball", player: 0, tempo: 2 })]);
    // Schildwall-Veteran: 8 LP, Panzer 1 → 5 Schaden = 4 LP Verlust, 2 Schaden = 1 LP Verlust.
    expect(eventsOf(state, "unit_damaged")).toEqual([
      expect.objectContaining({ type: "unit_damaged", player: 1, unitId: center, amount: 5, absorbed: 0, hpLoss: 4, hp: 4, cardId: "fireball" }),
      expect.objectContaining({ type: "unit_damaged", player: 1, unitId: neighbor, amount: 2, absorbed: 0, hpLoss: 1, hp: 7, cardId: "fireball" }),
    ]);
    expect(unit(state, far).roundEffects).toBeUndefined();
    expect(getPlayer(state, 0).discard).toContain(ball);
    expect(getPlayer(state, 0).spells.pre).toEqual([]);
  });

  it("R-14.2: Schadenseffekte mit Feldziel treffen nur gegnerische Einheiten (eigene Nachbarn bleiben heil)", () => {
    const state = emptyBoard();
    // Eigene Einheit in Zeile 2 der rechten Frontarena, Gegner direkt daneben in Zeile 3.
    const own = placeUnit(state, 0, front("right", 1, 2), "squire");
    const enemy = placeUnit(state, 1, front("left", 1, 2), "squire");
    const enemyCell = unitArenaHex(config, unit(state, enemy))!.cell;
    expect(enemyCell.row).toBe(3);
    setPre(state, 0, "fireball", hexOfUnit(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_damaged").map((e) => e.unitId)).toEqual([enemy]);
    expect(unit(state, own).roundEffects).toBeUndefined();
  });

  it("R-14.2: Feuerball in der linken Frontarena trifft den linken Nachbarn, in der Mitte alle anderen Spieler", () => {
    const state = emptyBoard();
    const left = placeUnit(state, 3, front("right", 2, 0), "shieldwall_veteran");
    const c1 = placeUnit(state, 2, { zone: "center", position: 0 }, "shieldwall_veteran");
    setPre(state, 0, "fireball", hexOfUnit(state, left, "left"));
    setPre(state, 0, "fireball", hexOfUnit(state, c1, "center"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_damaged").map((e) => [e.unitId, e.amount])).toEqual([
      [left, 5],
      [c1, 5],
    ]);
  });

  it("R-9.5: Schaden vor dem Kampf wird wie Fähigkeitsschaden zuerst vom Schild, dann vom Panzer reduziert", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "shieldwall_veteran");
    // Schutzrune (Tempo 1) löst vor dem Feuerball (Tempo 2) auf: 5 Schild.
    setPre(state, 1, "rune_shield", hexOfUnit(state, enemy, "left"));
    setPre(state, 0, "fireball", hexOfUnit(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved").map((e) => e.cardId)).toEqual(["rune_shield", "fireball"]);
    expect(eventsOf(state, "unit_damaged")).toEqual([expect.objectContaining({ unitId: enemy, amount: 5, absorbed: 5, hpLoss: 0, hp: 8 })]);
    expect(unit(state, enemy).roundEffects?.shield).toBe(0);
    // Ohne Schild: Panzer 1 plus 2 aus einem dauerhaften Buff → max(1, 5 − 3) = 2; Mindestschaden 1 bei 2 Schaden.
    const second = emptyBoard();
    const armored = placeUnit(second, 1, front("left", 1, 1), "shieldwall_veteran");
    const next = placeUnit(second, 1, front("left", 0, 1), "shieldwall_veteran");
    unit(second, armored).permanentBuffs = { armor: 2 };
    unit(second, next).permanentBuffs = { armor: 5 };
    setPre(second, 0, "fireball", hexOfUnit(second, armored, "right"));
    resolvePreCombatSpells(second, data);
    expect(eventsOf(second, "unit_damaged").map((e) => [e.unitId, e.hpLoss, e.hp])).toEqual([
      [armored, 2, 6],
      [next, 1, 7],
    ]);
  });

  it("R-14.2: der Schaden bleibt für alle Kämpfe der Runde und verfällt beim Aufräumen", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "shieldwall_veteran");
    setPre(state, 0, "fireball", hexOfUnit(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(startHp(state, enemy)).toBe(4);
    // Volle Runde: Der Veteran startet mit 4 LP in den Frontkampf; nach dem Aufräumen wieder mit 8.
    const round = emptyBoard();
    const veteran = placeUnit(round, 1, front("left", 1, 1), "shieldwall_veteran");
    placeUnit(round, 0, front("right", 1, 1), "recruit");
    setPre(round, 0, "fireball", hexOfUnit(round, veteran, "right"));
    const from = runRound(round);
    const started = round.log.slice(from).findIndex((e) => e.type === "combat_started");
    const damaged = round.log.slice(from).findIndex((e) => e.type === "unit_damaged");
    expect(damaged).toBeGreaterThanOrEqual(0);
    expect(damaged).toBeLessThan(started);
    const hits = eventsOf(round, "combat_damage", from).filter((e) => e.target === veteran);
    expect(hits[0]?.hp).toBe(4 - (hits[0]?.hpLoss ?? 0));
    expect(eventsOf(round, "unit_round_effects_cleared", from).map((e) => e.unitId)).toContain(veteran);
    expect(unit(round, veteran).roundEffects).toBeUndefined();
    expect(startHp(round, veteran)).toBe(8);
  });

  it("R-14.2: tödlicher Schaden – die Einheit nimmt in dieser Runde an keinem Kampf teil, bleibt aber auf dem Brett", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "squire");
    const attacker = placeUnit(state, 0, front("right", 1, 1), "recruit");
    setPre(state, 0, "fireball", hexOfUnit(state, enemy, "right"));
    const from = runRound(state);
    expect(eventsOf(state, "unit_damaged", from)).toEqual([expect.objectContaining({ unitId: enemy, hpLoss: 5, hp: 0 })]);
    expect(eventsOf(state, "unit_defeated", from)).toEqual([
      expect.objectContaining({ type: "unit_defeated", player: 1, unitId: enemy, cardId: "fireball", phase: "preCombatSpells" }),
    ]);
    // Die Front zwischen 0 und 1 ist leer für Spieler 1: Spieler 0 gewinnt ohne Simulation (R-10.2).
    const started = eventsOf(state, "combat_started", from).filter((e) => e.players.includes(1) && e.players.includes(0));
    expect(started).toEqual([]);
    expect(eventsOf(state, "front_resolved", from)).toContainEqual(
      expect.objectContaining({ outcome: "emptyFront", winner: 0, survivors: [attacker] }),
    );
    // Nicht verwundet, nicht vernichtet: steht in der nächsten Runde wieder normal bereit.
    expect(unit(state, enemy).wounded).toBe(false);
    expect(unit(state, enemy).location).toEqual(front("left", 1, 1));
    expect(unit(state, enemy).roundEffects).toBeUndefined();
    expect(frontParticipants(state, { first: 0, second: 1 }).second.map((u) => u.id)).toEqual([enemy]);
  });

  it("R-14.2: vor dem Kampf besiegte Einheiten sind für spätere Vorkampf-Zauber kein Ziel mehr; Schaden summiert sich", () => {
    const state = emptyBoard();
    const target = placeUnit(state, 1, front("left", 1, 1), "squire");
    const veteran = placeUnit(state, 1, front("left", 0, 1), "shieldwall_veteran");
    // Erster Feuerball besiegt den Knappen und trifft den Veteranen mit 2; der zweite trifft nur noch den Veteranen.
    setPre(state, 0, "fireball", hexOfUnit(state, target, "right"));
    setPre(state, 0, "fireball", hexOfUnit(state, target, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_damaged").map((e) => [e.unitId, e.hp])).toEqual([
      [target, 0],
      [veteran, 7],
      [veteran, 6],
    ]);
    expect(eventsOf(state, "spell_resolved")).toHaveLength(2);
    expect(startHp(state, veteran)).toBe(6);
    // Eine eigene Schutzrune des Gegners auf den besiegten Knappen verpufft (R-8.5).
    setPre(state, 1, "rune_shield", hexOfUnit(state, target, "left"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ cardId: "rune_shield", reason: "noValidTarget" })]);
  });

  it("R-8.5: Feuerball verpufft ohne gegnerische Einheit auf dem Feld und den Nachbarfeldern, sonst wirkt er", () => {
    const state = emptyBoard();
    placeUnit(state, 1, front("left", 3, 0), "squire");
    const wounded = placeUnit(state, 1, front("left", 1, 1), "squire");
    unit(state, wounded).wounded = true;
    setPre(state, 0, "fireball", hexOfUnit(state, wounded, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ cardId: "fireball", reason: "noValidTarget" })]);
    expect(eventsOf(state, "unit_damaged")).toEqual([]);
    // Leeres Feld, aber ein Gegner auf einem Nachbarfeld: der Zauber wirkt (nur die 2 Schaden).
    const second = emptyBoard();
    const neighbor = placeUnit(second, 1, front("left", 0, 1), "squire");
    const empty = unitArenaHex(config, { ...unit(second, neighbor), location: front("left", 1, 1) })!.cell;
    setPre(second, 0, "fireball", hex("right", empty.col, empty.row));
    resolvePreCombatSpells(second, data);
    expect(eventsOf(second, "spell_resolved")).toHaveLength(1);
    expect(eventsOf(second, "unit_damaged")).toEqual([expect.objectContaining({ unitId: neighbor, amount: 2, hp: 3 })]);
  });

  it("R-14.4: besiegt Schaden vor dem Kampf mit `wound: true`, ist die Einheit verwundet (außer `unwoundable`)", () => {
    const woundData = withFireballEffects([{ op: "damage", amount: 5, target: "hexEnemies", wound: true }]);
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "squire");
    const sturdy = placeUnit(state, 3, front("right", 1, 1), "squire");
    unit(state, sturdy).roundEffects = { shield: 0, buffs: {}, keywords: ["unwoundable"] };
    setPre(state, 0, "fireball", hexOfUnit(state, enemy, "right"));
    setPre(state, 0, "fireball", hexOfUnit(state, sturdy, "left"));
    resolvePreCombatSpells(state, woundData);
    expect(unit(state, enemy).wounded).toBe(true);
    expect(unit(state, sturdy).wounded).toBe(false);
    expect(unit(state, sturdy).roundEffects?.defeated).toBe(true);
    expect(eventsOf(state, "unit_wounded").map((e) => e.unitId)).toEqual([enemy]);
  });

  it("Determinismus: gleicher Feuerball, gleicher Zustand = gleiches Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(41);
      const a = placeUnit(state, 1, front("left", 1, 1), "shieldwall_veteran");
      placeUnit(state, 1, front("left", 0, 1), "squire");
      placeUnit(state, 0, front("right", 1, 1), "recruit");
      setPre(state, 0, "fireball", hexOfUnit(state, a, "right"));
      runRound(state);
      return state;
    };
    expect(build().log).toEqual(build().log);
  });
});
