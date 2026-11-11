import { describe, expect, it } from "vitest";
import type { ActionTarget, Planning } from "./actions";
import { boardCount, unitAt } from "./board";
import { parseGameData, rawGameData } from "./data";
import { destroyUnit } from "./destroy";
import { frontParticipants } from "./fronts";
import { GreedyBot } from "./bots/greedyBot";
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

  it("R-14.5, R-8.5: auf ein Feld ohne gegnerische Einheit verpufft der Zauber", () => {
    const state = emptyBoard();
    setPre(state, 0, DOOM, { kind: "hexes", hexes: [{ arena: "right", cell: { col: 4, row: 4 } }] });
    resolvePreCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled").map((e) => e.reason)).toEqual(["noValidTarget"]);
    expect(eventsOf(state, "unit_destroyed")).toEqual([]);
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

  it("R-14.5: destroyUnit weist Einheiten außerhalb des Bretts zurück", () => {
    const state = emptyBoard();
    const id = placeUnit(state, 0, front("left", 0, 0), "recruit");
    const u = state.units[id] as Unit;
    destroyUnit(state, u, DOOM);
    expect(() => destroyUnit(state, u, DOOM)).toThrow(RangeError);
  });
});

describe("R-14.5 vernichteter Anführer (E16c2b)", () => {
  /** Spieler 1 stellt seinen Anführer auf Feld (2, 2) der linken Zone, Spieler 0 vernichtet ihn in Runde 1. */
  function destroyedInRoundOne(): { state: GameState; leaderId: UnitId; from: number } {
    const state = emptyBoard();
    const leaderId = getPlayer(state, 1).leader.unitId;
    (state.units[leaderId] as Unit).location = front("left", 2, 2);
    setPre(state, 0, DOOM, enemyHex(state, leaderId, "right"));
    const from = state.log.length;
    for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
    advance(state, data);
    return { state, leaderId, from };
  }

  function playEmptyRound(state: GameState, planning1: Planning = EMPTY): void {
    for (const p of PLAYER_INDICES) submitPlanning(state, p, p === 1 ? planning1 : EMPTY);
    advance(state, data);
  }

  it("R-14.5: ein vernichteter Anführer verlässt das Brett, kämpft nicht und kehrt erst in der übernächsten Runde zurück", () => {
    const { state, leaderId, from } = destroyedInRoundOne();
    expect(state.round).toBe(2);
    expect(state.units[leaderId]).toBeUndefined();
    expect(getPlayer(state, 1).leader.returnsInRound).toBe(3);
    expect(eventsOf(state, "unit_destroyed", from)).toEqual([
      expect.objectContaining({ player: 1, unitId: leaderId, kind: "leader", cardInstanceIds: [], from: front("left", 2, 2), returnsInRound: 3 }),
    ]);
    const front01 = eventsOf(state, "front_resolved", from).find((e) => e.arena === "front:0-1");
    expect(front01).toEqual(expect.objectContaining({ outcome: "noFight", survivors: [] }));
    // Zu Beginn von Runde 2 ist er noch nicht zurück.
    expect(eventsOf(state, "leader_returned")).toEqual([]);
  });

  it("R-14.5: in der nächsten Planung keine Anführer-Fähigkeit und kein Bewegen des Anführers", () => {
    const { state, leaderId } = destroyedInRoundOne();
    const from = state.log.length;
    playEmptyRound(state, {
      play: [],
      buy: [],
      position: [
        { type: "moveUnit", unitId: leaderId, to: front("left", 2, 1) },
        { type: "setLeaderAbility", target: { kind: "none" } },
      ],
    });
    const rejected = eventsOf(state, "action_rejected", from).filter((e) => e.player === 1);
    expect(rejected.map((e) => e.reason)).toEqual(["unknownUnit", "leaderUnavailable"]);
    expect(eventsOf(state, "leader_ability_set", from).filter((e) => e.player === 1)).toEqual([]);
  });

  it("R-14.5: solange der Anführer vernichtet ist, sammelt er keine Anführer-XP (Rundenende, Kampf, Effekte)", () => {
    const { state } = destroyedInRoundOne();
    const p1 = getPlayer(state, 1);
    const xpBefore = eventsOf(state, "leader_xp_gained").filter((e) => e.player === 1 && e.round === 1);
    expect(xpBefore).toEqual([]);
    const xp = p1.leader.xp;
    playEmptyRound(state);
    expect(p1.leader.xp).toBe(xp);
    expect(eventsOf(state, "leader_xp_gained").filter((e) => e.player === 1)).toEqual([]);
    // Andere Anführer bekommen ihre XP wie gewohnt.
    expect(getPlayer(state, 0).leader.xp).toBeGreaterThan(0);
  });

  it("R-14.5, R-4.4: zu Beginn der übernächsten Runde kehrt er auf sein Startfeld zurück und ist wieder verfügbar", () => {
    const { state, leaderId } = destroyedInRoundOne();
    playEmptyRound(state);
    expect(state.round).toBe(3);
    const leader = state.units[leaderId];
    expect(leader).toEqual(expect.objectContaining({ id: leaderId, owner: 1, kind: "leader", wounded: false, location: front("left", 2, 1) }));
    expect(getPlayer(state, 1).leader.returnsInRound).toBeUndefined();
    expect(eventsOf(state, "leader_returned")).toEqual([
      expect.objectContaining({ round: 3, player: 1, unitId: leaderId, location: front("left", 2, 1) }),
    ]);
    const from = state.log.length;
    playEmptyRound(state, { play: [], buy: [], position: [{ type: "setLeaderAbility", target: { kind: "none" } }] });
    expect(eventsOf(state, "action_rejected", from).filter((e) => e.player === 1)).toEqual([]);
    expect(eventsOf(state, "leader_xp_gained", from).filter((e) => e.player === 1).length).toBeGreaterThan(0);
  });

  it("R-14.5: ist das Startfeld belegt, kehrt er auf das erste freie Feld der Zone zurück", () => {
    const { state, leaderId } = destroyedInRoundOne();
    placeUnit(state, 1, front("left", 2, 1), "recruit");
    placeUnit(state, 1, front("left", 0, 0), "recruit");
    playEmptyRound(state);
    expect(state.units[leaderId]?.location).toEqual(front("left", 1, 0));
  });

  it("R-14.5: GreedyBot-Partien laufen mit vernichteten Anführern durch", () => {
    for (const seed of [1, 2, 3]) {
      const state = createGame(data, defaultLeaders(data), seed);
      const bots = PLAYER_INDICES.map((p) => new GreedyBot(seed * 4 + p + 1));
      let destroyed = false;
      for (let step = 0; step < config.maxRounds + 2; step++) {
        const result = advance(state, data);
        if (result.waitingFor === "nothing") break;
        if (!destroyed && state.round === 2) {
          // Alle vier Anführer zu Beginn der Planung von Runde 2 vernichten.
          for (const p of PLAYER_INDICES) {
            const leader = state.units[getPlayer(state, p).leader.unitId];
            if (leader) destroyUnit(state, leader, DOOM);
          }
          destroyed = true;
        }
        for (const p of [...result.players].sort((a, b) => a - b)) {
          const planning = (bots[p] as GreedyBot).plan(state, data, p);
          expect(submitPlanning(state, p, planning).ok).toBe(true);
        }
      }
      expect(state.result).not.toBeNull();
      expect(eventsOf(state, "leader_ability_set").filter((e) => e.round === 2 || e.round === 3)).toEqual([]);
      if (state.round >= 4) {
        const returned = eventsOf(state, "leader_returned");
        expect(returned.every((e) => e.round === 4)).toBe(true);
        expect(returned.length).toBeGreaterThan(0);
      }
    }
  });
});
