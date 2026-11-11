import { describe, expect, it } from "vitest";
import type { ActionTarget, Planning } from "./actions";
import { boardCount, unitAt } from "./board";
import { parseGameData, rawGameData } from "./data";
import { destroyUnit } from "./destroy";
import { frontParticipants } from "./fronts";
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
import { type RawGameData, validateGameData } from "./validate";

/**
 * Keine Karte der echten Daten nutzt `destroy` bisher. Die Tests verwenden deshalb eine Testkarte
 * „Vernichtungsstrahl“: Vorkampf-Zauber mit Feldziel, der die gegnerischen Einheiten auf dem Feld vernichtet.
 */
const DOOM = "test_doom_ray";

function withDoomRay(): RawGameData {
  const raw = structuredClone(rawGameData());
  (raw.cards as { cards: unknown[] }).cards.push({
    id: DOOM,
    name: "Vernichtungsstrahl (Test)",
    type: "spell",
    slot: "pre",
    tempo: 2,
    cost: 3,
    pool: "class:mage",
    buyable: false,
    target: { kind: "hex", arenas: "participating" },
    effects: [{ op: "destroy", target: "hexEnemies" }],
  });
  return raw;
}

const data = parseGameData(withDoomRay());
const config = data.config;
const EMPTY: Planning = { play: [], buy: [], position: [] };

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 23): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(
  state: GameState,
  player: PlayerIndex,
  location: UnitLocation,
  sourceId: string,
  options: { kind?: "card" | "token"; copies?: number; stars?: 1 | 2 | 3 } = {},
): UnitId {
  const kind = options.kind ?? "card";
  const id = state.nextUnitId++;
  const cardInstanceIds: number[] = [];
  if (kind === "card") {
    for (let i = 0; i < (options.copies ?? 1); i++) {
      const instance = state.nextCardInstanceId++;
      state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
      cardInstanceIds.push(instance);
    }
  }
  state.units[id] = {
    id,
    owner: player,
    kind,
    sourceId,
    cardInstanceIds,
    stars: options.stars ?? 1,
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

/** Feld, auf dem eine gegnerische Einheit steht, aus Sicht des Zaubernden (gleiche Koordinaten, eigene Arena). */
function enemyHex(state: GameState, enemy: UnitId, arena: "left" | "right" | "center"): ActionTarget {
  const at = unitArenaHex(config, state.units[enemy] as Unit);
  if (!at) throw new Error("Einheit steht in der Reserve");
  return { kind: "hexes", hexes: [{ arena, cell: at.cell }] };
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("R-14.5 Vernichten (E16c2a, Effekt-Baustein destroy)", () => {
  it("R-14.5: Datenvalidierung kennt `destroy` mit Pflichtfeld `target`", () => {
    expect(validateGameData(withDoomRay())).toEqual([]);
    const raw = withDoomRay();
    const cards = (raw.cards as { cards: { id: string; effects?: Record<string, unknown>[] }[] }).cards;
    const doom = cards.find((c) => c.id === DOOM);
    if (!doom?.effects?.[0]) throw new Error("Testkarte fehlt");
    delete doom.effects[0].target;
    const issues = validateGameData(raw);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toContain("effects[0]");
  });

  it("R-14.5: die vernichtete Einheit verlässt das Brett, ihre Karteninstanz geht auf den Ablagestapel ihres Besitzers", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 2, 2), "squire");
    const instance = (state.units[enemy] as Unit).cardInstanceIds[0];
    const discardBefore = [...getPlayer(state, 1).discard];
    const spell = setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);

    expect(state.units[enemy]).toBeUndefined();
    expect(getPlayer(state, 1).discard).toEqual([...discardBefore, instance]);
    expect(eventsOf(state, "spell_resolved")).toEqual([expect.objectContaining({ player: 0, cardId: DOOM })]);
    expect(eventsOf(state, "unit_destroyed")).toEqual([
      expect.objectContaining({
        player: 1,
        unitId: enemy,
        kind: "card",
        sourceId: "squire",
        cardInstanceIds: [instance],
        from: front("left", 2, 2),
        cardId: DOOM,
      }),
    ]);
    // R-8.6: der Zauber selbst geht auf den Ablagestapel des Zaubernden.
    expect(getPlayer(state, 0).discard).toContain(spell);
  });

  it("R-14.5, R-15.1: eine verschmolzene Einheit gibt beim Vernichten alle drei Karteninstanzen auf den Ablagestapel", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 1, 1), "recruit", { copies: 3, stars: 2 });
    const instances = [...(state.units[enemy] as Unit).cardInstanceIds];
    setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(state.units[enemy]).toBeUndefined();
    expect(getPlayer(state, 1).discard.slice(-3)).toEqual(instances);
    expect(eventsOf(state, "unit_destroyed")[0]?.cardInstanceIds).toEqual(instances);
  });

  it("R-14.5, R-1.4: ein vernichtetes Token verschwindet ohne Karte auf dem Ablagestapel", () => {
    const state = emptyBoard();
    const token = placeUnit(state, 1, front("left", 3, 0), "goblin_token", { kind: "token" });
    const discardBefore = [...getPlayer(state, 1).discard];
    setPre(state, 0, DOOM, enemyHex(state, token, "right"));
    resolvePreCombatSpells(state, data);
    expect(state.units[token]).toBeUndefined();
    expect(getPlayer(state, 1).discard).toEqual(discardBefore);
    expect(eventsOf(state, "unit_destroyed")).toEqual([expect.objectContaining({ unitId: token, kind: "token", cardInstanceIds: [] })]);
  });

  it("R-14.5: Feld und Kapazitätsplatz sind sofort frei, die Einheit kämpft in dieser Runde nicht mehr", () => {
    const state = emptyBoard();
    const own = placeUnit(state, 0, front("right", 2, 2), "recruit");
    const enemy = placeUnit(state, 1, front("left", 2, 2), "squire");
    const countBefore = boardCount(state, 1);
    setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
    const from = state.log.length;
    advance(state, data);

    expect(boardCount(state, 1)).toBe(countBefore - 1);
    expect(unitAt(state, 1, front("left", 2, 2))).toBeUndefined();
    expect(frontParticipants(state, { first: 0, second: 1 }).second).toEqual([]);
    const resolved = eventsOf(state, "front_resolved", from).find((e) => e.arena === "front:0-1");
    expect(resolved).toEqual(expect.objectContaining({ outcome: "emptyFront", winner: 0, survivors: [own] }));
  });

  it("R-14.5, R-8.5: auf ein Feld ohne gegnerische Karten-Einheit oder Token (leer oder nur Anführer) verpufft der Zauber", () => {
    const state = emptyBoard();
    const leaderId = getPlayer(state, 1).leader.unitId;
    const leader = state.units[leaderId] as Unit;
    leader.location = front("left", 0, 0);
    setPre(state, 0, DOOM, enemyHex(state, leaderId, "right"));
    setPre(state, 0, DOOM, { kind: "hexes", hexes: [{ arena: "right", cell: { col: 4, row: 4 } }] });
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled").map((e) => e.reason)).toEqual(["noValidTarget", "noValidTarget"]);
    expect(eventsOf(state, "unit_destroyed")).toEqual([]);
    // Anführer werden erst mit E16c2b vernichtet (Rückkehr in der übernächsten Planung).
    expect(state.units[leaderId]).toBe(leader);
  });

  it("R-14.5: verwundete Einheiten kämpfen nicht und sind kein gültiges Ziel", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 2, 1), "squire");
    (state.units[enemy] as Unit).wounded = true;
    setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ reason: "noValidTarget" })]);
    expect(state.units[enemy]).toBeDefined();
  });

  it("R-14.5: zwei Vernichtungen desselben Feldes – der zweite Zauber verpufft, die Karte liegt nur einmal auf dem Ablagestapel", () => {
    const state = emptyBoard();
    const enemy = placeUnit(state, 1, front("left", 2, 2), "squire");
    const instance = (state.units[enemy] as Unit).cardInstanceIds[0] as number;
    setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    setPre(state, 2, DOOM, enemyHex(state, enemy, "center")); // anderes Feld/Arena: kein Ziel
    setPre(state, 0, DOOM, enemyHex(state, enemy, "right"));
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "unit_destroyed")).toHaveLength(1);
    expect(eventsOf(state, "spell_fizzled")).toHaveLength(2);
    expect(getPlayer(state, 1).discard.filter((id) => id === instance)).toHaveLength(1);
  });

  it("R-14.5: destroyUnit weist Anführer (bis E16c2b) und Einheiten außerhalb des Bretts zurück", () => {
    const state = emptyBoard();
    const leader = state.units[getPlayer(state, 0).leader.unitId] as Unit;
    expect(() => destroyUnit(state, leader, DOOM)).toThrow(RangeError);
    const id = placeUnit(state, 0, front("left", 0, 0), "recruit");
    const u = state.units[id] as Unit;
    destroyUnit(state, u, DOOM);
    expect(() => destroyUnit(state, u, DOOM)).toThrow(RangeError);
  });
});
