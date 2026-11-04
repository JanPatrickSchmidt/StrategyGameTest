import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaRef, Planning } from "./actions";
import { boardCount } from "./board";
import { loadGameData } from "./data";
import { zoneFreeLocations } from "./preCombat";
import { resonanceCounts } from "./resonance";
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
const EMPTY: Planning = { play: [], buy: [], position: [] };

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const zoneTarget = (...arenas: ArenaRef[]): ActionTarget => ({ kind: "zone", arenas });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 17): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string): UnitId {
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

function setPre(state: GameState, player: PlayerIndex, cardId: string, target: ActionTarget): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  getPlayer(state, player).spells.pre.push({ cardInstanceId: id, cardId, target });
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function tokensOf(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units)
    .filter((u) => u.owner === player && u.kind === "token")
    .sort((a, b) => a.id - b.id);
}

function runRound(state: GameState): number {
  for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
  const from = state.log.length;
  advance(state, data);
  return from;
}

describe("E11b4: Geistertrommel beschwört vor dem Kampf (R-8.3, R-8.5, R-1.4)", () => {
  it("R-8.3: Geistertrommel beschwört 2 Kleine Geister auf die ersten freien Felder der gewählten Zone", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 0, 0), "recruit");
    const drum = setPre(state, 0, "spirit_drum", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toEqual([expect.objectContaining({ player: 0, cardInstanceId: drum, cardId: "spirit_drum", tempo: 1 })]);
    const tokens = tokensOf(state, 0);
    expect(tokens.map((t) => [t.sourceId, t.location])).toEqual([
      ["small_spirit", front("right", 1, 0)],
      ["small_spirit", front("right", 2, 0)],
    ]);
    expect(eventsOf(state, "unit_summoned")).toEqual(
      tokens.map((t) => expect.objectContaining({ player: 0, unitId: t.id, sourceId: "small_spirit", location: t.location, cardId: "spirit_drum" })),
    );
    expect(getPlayer(state, 0).spells.pre).toEqual([]);
    expect(getPlayer(state, 0).discard).toContain(drum);
  });

  it("R-8.3: auch in die Mittelzone (nach Position)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, { zone: "center", position: 0 }, "recruit");
    setPre(state, 0, "spirit_drum", zoneTarget("center"));
    resolvePreCombatSpells(state, data);
    expect(tokensOf(state, 0).map((t) => t.location)).toEqual([
      { zone: "center", position: 1 },
      { zone: "center", position: 2 },
    ]);
  });

  it("R-8.3: wirkt auch in einer leeren Zone (die Zone ist das Ziel, nicht eine Einheit)", () => {
    const state = emptyBoard();
    setPre(state, 0, "spirit_drum", zoneTarget("left"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([]);
    expect(tokensOf(state, 0)).toHaveLength(2);
  });

  it("R-8.3: verwundete Einheiten belegen ihr Feld weiter; mit nur einem freien Feld entsteht ein Geist", () => {
    const state = emptyBoard();
    const free = zoneFreeLocations(state, config, 0, "center");
    free.slice(0, free.length - 1).forEach((loc, i) => {
      const id = placeUnit(state, 0, loc, "recruit");
      if (i === 0) (state.units[id] as Unit).wounded = true;
    });
    setPre(state, 0, "spirit_drum", zoneTarget("center"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toHaveLength(1);
    expect(tokensOf(state, 0).map((t) => t.location)).toEqual([free[free.length - 1]]);
  });

  it("R-8.5: ohne freies Feld in der Zone verpufft die Geistertrommel, die Kosten bleiben bezahlt", () => {
    const state = emptyBoard();
    for (const loc of zoneFreeLocations(state, config, 0, "right")) placeUnit(state, 0, loc, "recruit");
    const drum = setPre(state, 0, "spirit_drum", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 0, cardInstanceId: drum, reason: "noValidTarget" })]);
    expect(eventsOf(state, "spell_resolved")).toEqual([]);
    expect(tokensOf(state, 0)).toEqual([]);
    expect(getPlayer(state, 0).discard).toContain(drum);
  });

  it("R-3.6, R-17.1: die Geister zählen weder gegen die Kapazität noch für die Resonanz", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 0, 0), "spark_rider");
    const before = { count: boardCount(state, 0), resonance: resonanceCounts(state, data, 0) };
    setPre(state, 0, "spirit_drum", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    expect(tokensOf(state, 0)).toHaveLength(2);
    expect(boardCount(state, 0)).toBe(before.count);
    expect(resonanceCounts(state, data, 0)).toEqual(before.resonance);
  });

  it("R-8.3: ein später aufgelöster Kriegsruf stärkt auch die beschworenen Geister", () => {
    const state = emptyBoard();
    setPre(state, 0, "spirit_drum", zoneTarget("right"));
    setPre(state, 0, "war_cry", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    const tokens = tokensOf(state, 0);
    expect(eventsOf(state, "unit_buffed").map((e) => e.unitId)).toEqual(tokens.map((t) => t.id));
  });

  it("R-14.2: ein Feuerball mit höherem Tempo trifft die vorher beschworenen Geister", () => {
    const state = emptyBoard();
    // Spieler 1 links = dieselbe Frontarena wie Zone `right` von Spieler 0 (gleiche Arena-Koordinaten).
    setPre(state, 1, "fireball", { kind: "hexes", hexes: [{ arena: "left", cell: { col: 0, row: 0 } }] });
    setPre(state, 0, "spirit_drum", zoneTarget("right"));
    resolvePreCombatSpells(state, data);
    const tokens = tokensOf(state, 0).map((t) => t.id);
    expect(tokens).toHaveLength(2);
    expect(eventsOf(state, "spell_resolved").map((e) => e.cardId)).toEqual(["spirit_drum", "fireball"]);
    expect(eventsOf(state, "unit_damaged").map((e) => [e.unitId, e.amount])).toEqual([
      [tokens[0], 5],
      [tokens[1], 2],
    ]);
    expect(eventsOf(state, "unit_defeated").map((e) => e.unitId)).toEqual(tokens);
  });

  it("R-1.4, R-12.2: die Geister kämpfen in der Runde mit (Durchbruch an leerer Front) und verschwinden beim Aufräumen", () => {
    const state = emptyBoard();
    setPre(state, 0, "spirit_drum", zoneTarget("right"));
    const from = runRound(state);
    const summoned = eventsOf(state, "unit_summoned", from).map((e) => e.unitId);
    expect(summoned).toHaveLength(2);
    const result = state.frontResults.find((r) => r.first === 0);
    expect(result).toEqual(expect.objectContaining({ outcome: "emptyFront", winner: 0 }));
    expect(result?.survivors).toEqual(summoned);
    expect(eventsOf(state, "unit_xp_gained", from).filter((e) => summoned.includes(e.unitId))).toEqual([]);
    expect(eventsOf(state, "token_removed", from).map((e) => e.unitId)).toEqual(summoned);
    expect(tokensOf(state, 0)).toEqual([]);
  });

  it("F33c: die Resonanz zählt nach den Vorkampf-Zaubern (Frostlanze nimmt einen Goblin heraus)", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 1, front("left", 0, 0), "spark_rider");
    placeUnit(state, 1, front("left", 1, 0), "tinker");
    const at = unitArenaHex(config, state.units[rider] as Unit);
    if (!at) throw new Error("Einheit steht in der Reserve");
    setPre(state, 0, "frost_lance", { kind: "hexes", hexes: [{ arena: "right", cell: at.cell }] });
    const from = runRound(state);
    expect(eventsOf(state, "unit_wounded", from).map((e) => e.unitId)).toContain(rider);
    expect(eventsOf(state, "resonance_active", from).filter((e) => e.player === 1)).toEqual([]);
  });

  it("Determinismus: gleiche Geistertrommel, gleicher Zustand = gleiches Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(29);
      placeUnit(state, 1, front("left", 2, 2), "recruit");
      setPre(state, 0, "spirit_drum", zoneTarget("right"));
      runRound(state);
      return state;
    };
    expect(build().log).toEqual(build().log);
  });
});
