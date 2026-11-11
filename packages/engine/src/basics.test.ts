/**
 * E16c1: Tests für Grundbegriffe und Regeln, die bisher nur indirekt abgedeckt waren
 * (R-1.3, R-1.5, R-1.6, R-2.1, R-3.7, R-7.10). Nur Tests, kein Produktivcode.
 */
import { describe, expect, it } from "vitest";
import type { PlanningAction } from "./actions";
import { isValidLocation, moveUnit, playUnit } from "./board";
import { GreedyBot } from "./bots/greedyBot";
import { loadGameData } from "./data";
import { advance, submitPlanning } from "./round";
import { activeRing, neighborsOf } from "./seating";
import { createGame, defaultLeaders, leaderStartLocation } from "./setup";
import {
  type CardInstanceId,
  type GameEvent,
  type GameState,
  getPlayer,
  getUnit,
  PLAYER_INDICES,
  type PlayerIndex,
  type Unit,
  type UnitLocation,
} from "./state";

const data = loadGameData();
const config = data.config;
const newGame = (seed = 5): GameState => createGame(data, defaultLeaders(data), seed);

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

function addToHand(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  return cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    getPlayer(state, player).hand.push(id);
    return id;
  });
}

function inPlanning(seed = 5): GameState {
  const state = newGame(seed);
  advance(state, data);
  return state;
}

function cardUnitsOf(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.kind === "card");
}

function allCardInstancesOf(state: GameState, player: PlayerIndex): CardInstanceId[] {
  const p = getPlayer(state, player);
  return [...p.hand, ...p.deck, ...p.discard, ...p.played];
}

/** Leere Planungen für alle wartenden Spieler, dann weiter bis zur nächsten Planung. */
function emptyRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

describe("R-1.3: Einheit", () => {
  it("R-1.3: eine ausgespielte Einheitenkarte wird zur Einheit, die auf genau ihre Karteninstanz verweist", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 5;
    const [card] = addToHand(state, 0, ["mercenary"]);
    expect(playUnit(state, data, 0, card, front("right", 0, 0), undefined)).toBeNull();
    const units = cardUnitsOf(state, 0);
    expect(units).toHaveLength(1);
    const unit = units[0] as Unit;
    expect(unit.cardInstanceIds).toEqual([card]);
    expect(state.cards[card as number]).toEqual(expect.objectContaining({ cardId: unit.sourceId, owner: 0 }));
    // Die Karteninstanz liegt jetzt in keinem Kartenstapel, nur noch bei der Einheit.
    expect(allCardInstancesOf(state, 0)).not.toContain(card);
  });

  it("R-1.3: nach dem Verschmelzen verweist die Einheit auf alle drei Karteninstanzen (R-7.8)", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 10;
    const cards = addToHand(state, 0, ["mercenary", "mercenary", "mercenary"]);
    const play: PlanningAction[] = [
      { type: "playUnit", cardInstanceId: cards[0] as number, to: front("right", 0, 0) },
      { type: "playUnit", cardInstanceId: cards[1] as number, to: front("right", 1, 0) },
      { type: "playUnit", cardInstanceId: cards[2] as number, to: front("right", 2, 0) },
    ];
    for (const p of PLAYER_INDICES) submitPlanning(state, p, p === 0 ? { play } : {});
    advance(state, data);
    const mercs = cardUnitsOf(state, 0).filter((u) => u.sourceId === "mercenary");
    expect(mercs).toHaveLength(1);
    expect(mercs[0]?.stars).toBe(2);
    expect([...(mercs[0]?.cardInstanceIds ?? [])].sort((a, b) => a - b)).toEqual([...cards].sort((a, b) => a - b));
    for (const c of cards) expect(allCardInstancesOf(state, 0)).not.toContain(c);
  });
});

describe("R-1.5: Anführer", () => {
  it("R-1.5: Anführer ist eine Einheit ohne Karte und steht nicht im Deck", () => {
    const state = newGame();
    for (const p of PLAYER_INDICES) {
      const player = getPlayer(state, p);
      const leader = getUnit(state, player.leader.unitId);
      expect(leader).toEqual(
        expect.objectContaining({ owner: p, kind: "leader", sourceId: player.leader.leaderId, cardInstanceIds: [] }),
      );
      expect(leader.location).toEqual(leaderStartLocation(config));
      // Keine Karteninstanz des Spielers ist der Anführer.
      const cardIds = allCardInstancesOf(state, p).map((id) => state.cards[id]?.cardId);
      expect(cardIds).not.toContain(player.leader.leaderId);
      expect(data.cards.has(player.leader.leaderId)).toBe(false);
    }
  });

  it("R-1.5: Anführer ist in jeder Planung jedes aktiven Spielers vorhanden (GreedyBot-Partien, mehrere Seeds)", () => {
    for (const seed of [1, 2, 3]) {
      const state = newGame(seed);
      const bots = PLAYER_INDICES.map((p) => new GreedyBot(seed * 4 + p + 1));
      let rounds = 0;
      for (let step = 0; step < config.maxRounds + 2; step++) {
        const result = advance(state, data);
        if (result.waitingFor === "nothing") break;
        rounds++;
        for (const p of PLAYER_INDICES) {
          const player = getPlayer(state, p);
          if (player.eliminated) continue;
          const leaders = Object.values(state.units).filter((u) => u.owner === p && u.kind === "leader");
          expect(leaders.map((u) => u.id)).toEqual([player.leader.unitId]);
          expect(allCardInstancesOf(state, p).map((id) => state.cards[id]?.cardId)).not.toContain(player.leader.leaderId);
        }
        for (const p of [...result.players].sort((a, b) => a - b)) {
          expect(submitPlanning(state, p, (bots[p] as GreedyBot).plan(state, data, p)).ok).toBe(true);
        }
      }
      expect(state.phase).toBe("gameOver");
      expect(rounds).toBeGreaterThan(1);
    }
  });
});

describe("R-1.6: Zonen eines Spielers", () => {
  it("R-1.6: genau die Zonen left, right, center und reserve sind gültige Orte", () => {
    expect(isValidLocation(config, front("left", 0, 0))).toBe(true);
    expect(isValidLocation(config, front("right", 0, 0))).toBe(true);
    expect(isValidLocation(config, { zone: "center", position: 0 })).toBe(true);
    expect(isValidLocation(config, { zone: "reserve", slot: 0 })).toBe(true);
    for (const zone of ["front", "middle", "bench", "hand", "LEFT", ""]) {
      expect(isValidLocation(config, { zone, cell: { col: 0, row: 0 }, position: 0, slot: 0 })).toBe(false);
    }
  });

  it("R-1.6: eine Einheit kann durch alle vier Zonen bewegt werden (R-7.2)", () => {
    const state = inPlanning();
    const leaderId = getPlayer(state, 0).leader.unitId;
    const route: UnitLocation[] = [
      front("right", 0, 0),
      { zone: "center", position: 0 },
      { zone: "reserve", slot: 0 },
      front("left", 0, 0),
    ];
    for (const to of route) {
      expect(moveUnit(state, data, 0, leaderId, to)).toBeNull();
      expect(getUnit(state, leaderId).location).toEqual(to);
    }
    const moves = state.log.filter((e): e is Extract<GameEvent, { type: "unit_moved" }> => e.type === "unit_moved");
    expect(moves.map((e) => e.to.zone)).toEqual(["right", "center", "reserve", "left"]);
  });
});

describe("R-2.1: Sitzordnung", () => {
  it("R-2.1: die vier Sitze bilden den Ring 0 → 1 → 2 → 3 → 0", () => {
    const state = newGame();
    expect(state.players.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(activeRing(state)).toEqual([0, 1, 2, 3]);
    // Im Ring weitergehen: rechter Nachbar ist der nächste Sitz, nach 3 kommt wieder 0.
    const walk: PlayerIndex[] = [0];
    for (let i = 0; i < 4; i++) walk.push(neighborsOf(state, walk[i] as PlayerIndex)?.right as PlayerIndex);
    expect(walk).toEqual([0, 1, 2, 3, 0]);
    // Rückwärts über den linken Nachbarn.
    const back: PlayerIndex[] = [0];
    for (let i = 0; i < 4; i++) back.push(neighborsOf(state, back[i] as PlayerIndex)?.left as PlayerIndex);
    expect(back).toEqual([0, 3, 2, 1, 0]);
  });
});

describe("R-3.7: Persistenz", () => {
  it("R-3.7: Einheiten bleiben über mehrere Runden auf ihrem Feld, solange niemand sie bewegt", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 5;
    const [card] = addToHand(state, 0, ["mercenary"]);
    const target = front("right", 4, 0);
    const play: PlanningAction[] = [{ type: "playUnit", cardInstanceId: card as number, to: target }];
    for (const p of PLAYER_INDICES) submitPlanning(state, p, p === 0 ? { play } : {});
    advance(state, data);
    const unit = cardUnitsOf(state, 0).find((u) => u.cardInstanceIds.includes(card as number));
    expect(unit).toBeDefined();
    const unitId = unit?.id as number;
    const leaderId = getPlayer(state, 0).leader.unitId;
    const startRound = state.round;
    for (let i = 0; i < 3; i++) {
      expect(state.phase).toBe("planning");
      expect(getUnit(state, unitId).location).toEqual(target);
      expect(getUnit(state, leaderId).location).toEqual(leaderStartLocation(config));
      emptyRound(state);
    }
    expect(state.round).toBe(startRound + 3);
    expect(getUnit(state, unitId).location).toEqual(target);
    // Kein Ortswechsel-Ereignis für diese Einheiten.
    const moved = state.log.filter((e) => e.type === "unit_moved" && (e.unitId === unitId || e.unitId === leaderId));
    expect(moved).toEqual([]);
  });
});

describe("R-7.10: nicht ausgespielte Karten", () => {
  it("R-7.10: eine nicht ausgespielte Karte bleibt in allen Phasen bis zum Rundenende auf der Hand", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    const [kept] = addToHand(state, 0, ["mercenary"]);
    // Bei jedem Phasenwechsel festhalten, ob die Karte auf der Hand liegt.
    const handAtPhase: [string, boolean][] = [];
    const log = state.log;
    const originalPush = log.push.bind(log);
    log.push = (...events: GameEvent[]): number => {
      for (const e of events) {
        if (e.type === "phase_started") handAtPhase.push([e.phase, p.hand.includes(kept as number)]);
      }
      return originalPush(...events);
    };
    for (const pl of PLAYER_INDICES) submitPlanning(state, pl, {});
    advance(state, data);
    log.push = originalPush;
    const phases = handAtPhase.map(([phase]) => phase);
    expect(phases.slice(0, phases.indexOf("cleanup") + 1)).toEqual([
      "reveal",
      "leaderAbilities",
      "preCombatSpells",
      "combat",
      "combatResolution",
      "postCombatSpells",
      "cleanup",
    ]);
    // Bis einschließlich zum Beginn des Aufräumens auf der Hand, danach abgelegt (R-12.1).
    for (const [phase, inHand] of handAtPhase) {
      expect([phase, inHand]).toEqual([phase, phases.indexOf(phase) <= phases.indexOf("cleanup")]);
    }
    const discarded = state.log.find((e) => e.type === "hand_discarded" && e.player === 0 && e.round === 1);
    expect(discarded).toEqual(expect.objectContaining({ phase: "cleanup" }));
    expect(p.discard).toContain(kept);
  });
});
