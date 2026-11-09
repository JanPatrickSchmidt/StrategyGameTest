import { describe, expect, it } from "vitest";
import type { Planning, PlanningAction } from "../actions";
import { loadGameData } from "../data";
import { advance, submitPlanning } from "../round";
import { createGame, defaultLeaders } from "../setup";
import { getPlayer, PLAYER_INDICES, type CardInstanceId, type GameState, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "../state";
import { unitArenaHex } from "../targets";
import type { Bot } from "./bot";
import { GreedyBot } from "./greedyBot";
import { RandomBot } from "./randomBot";
import { playBotGame } from "./runner";

const data = loadGameData();
const config = data.config;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde: alle Anführer in der Reserve, alle Hände leer. */
function emptyBoard(seed = 31): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const player = getPlayer(state, p);
    (state.units[player.leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
    player.discard.push(...player.hand);
    player.hand = [];
    player.roundGold = 0;
    player.treasury = 0;
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = { id, owner: player, kind: "card", sourceId, cardInstanceIds: [instance], stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function giveCard(state: GameState, player: PlayerIndex, cardId: string): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  getPlayer(state, player).hand.push(id);
  return id;
}

function actionsOf<T extends PlanningAction["type"]>(planning: Planning, type: T): Extract<PlanningAction, { type: T }>[] {
  return [...planning.play, ...planning.buy, ...planning.position].filter((a): a is Extract<PlanningAction, { type: T }> => a.type === type);
}

function greedyBots(seed: number): GreedyBot[] {
  return PLAYER_INDICES.map((p) => new GreedyBot(seed * 4 + p + 1));
}

describe("GreedyBot: Heuristik (E14b)", () => {
  it("R-3.2: stellt Nahkämpfer vorne (Zeile 2, grenzt an den Gegner) und Fernkämpfer hinten (Zeile 0) auf", () => {
    const state = emptyBoard();
    const recruit = giveCard(state, 0, "recruit");
    const apprentice = giveCard(state, 0, "apprentice");
    getPlayer(state, 0).treasury = 10;
    const planning = new GreedyBot(1).plan(state, data, 0);
    const plays = actionsOf(planning, "playUnit");
    const rowOf = (card: CardInstanceId): number | undefined => {
      const to = plays.find((a) => a.cardInstanceId === card)?.to;
      return to && (to.zone === "left" || to.zone === "right") ? to.cell.row : undefined;
    };
    expect(rowOf(recruit)).toBe(2);
    expect(rowOf(apprentice)).toBe(0);
  });

  it("R-3.6: füllt das Brett mit den stärksten Einheiten der Hand, bis die Kapazität erreicht ist", () => {
    const state = emptyBoard();
    for (let i = 0; i < config.boardCapacity; i++) placeUnit(state, 0, front(i % 2 === 0 ? "left" : "right", i, 0), "squire");
    getPlayer(state, 0).treasury = 20;
    const veteran = giveCard(state, 0, "shieldwall_veteran");
    const planning = new GreedyBot(1).plan(state, data, 0);
    // Brett voll: die Karte bleibt auf der Hand (keine gleiche Karte zum Verschmelzen, also keine Reserve).
    expect(actionsOf(planning, "playUnit").some((a) => a.cardInstanceId === veteran)).toBe(false);

    const open = emptyBoard();
    getPlayer(open, 0).treasury = 4;
    const strong = giveCard(open, 0, "shieldwall_veteran");
    const weak = giveCard(open, 0, "recruit");
    const plays = actionsOf(new GreedyBot(1).plan(open, data, 0), "playUnit").map((a) => a.cardInstanceId);
    expect(plays).toEqual([strong, weak]);
  });

  it("R-14.2: Feuerball auf das Feld mit den meisten Gegnern (Nachbarfelder zählen mit)", () => {
    const state = emptyBoard();
    // Rechter Nachbar von Spieler 0 ist Spieler 1; seine linke Zone steht Spieler 0s rechter Zone gegenüber (R-2.3).
    const middle = placeUnit(state, 1, front("left", 2, 2), "recruit");
    placeUnit(state, 1, front("left", 1, 2), "recruit");
    placeUnit(state, 1, front("left", 3, 2), "recruit");
    placeUnit(state, 3, front("right", 0, 0), "recruit");
    const fireball = giveCard(state, 0, "fireball");
    getPlayer(state, 0).treasury = 10;
    const spells = actionsOf(new GreedyBot(1).plan(state, data, 0), "setSpell");
    const expected = unitArenaHex(config, state.units[middle] as Unit);
    expect(spells).toEqual([{ type: "setSpell", cardInstanceId: fireball, slot: "pre", target: { kind: "hex", arena: "right", cell: expected?.cell } }]);
  });

  it("R-14.2: ohne Gegner auf dem Brett bleibt ein Schadenszauber auf der Hand", () => {
    const state = emptyBoard();
    giveCard(state, 0, "fireball");
    getPlayer(state, 0).treasury = 10;
    expect(actionsOf(new GreedyBot(1).plan(state, data, 0), "setSpell")).toEqual([]);
  });

  it("R-14.2: Schutzrune auf die stärkste eigene Einheit", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 2), "recruit");
    const veteran = placeUnit(state, 0, front("right", 3, 1), "shieldwall_veteran");
    const rune = giveCard(state, 0, "rune_shield");
    getPlayer(state, 0).treasury = 10;
    const spells = actionsOf(new GreedyBot(1).plan(state, data, 0), "setSpell");
    const at = unitArenaHex(config, state.units[veteran] as Unit);
    expect(spells).toEqual([{ type: "setSpell", cardInstanceId: rune, slot: "pre", target: { kind: "hex", arena: at?.arena, cell: at?.cell } }]);
  });

  it("R-10.4: besetzt die Mitte, wenn das Brett stark genug ist", () => {
    const state = emptyBoard();
    for (const [zone, col] of [["left", 1], ["left", 2], ["right", 1], ["right", 2]] as const) placeUnit(state, 0, front(zone, col, 2), "recruit");
    const moves = actionsOf(new GreedyBot(1).plan(state, data, 0), "moveUnit");
    expect(moves.filter((m) => m.to.zone === "center")).toHaveLength(1);
  });

  it("R-10.4: lässt die Mitte frei, wenn eine Front schwächer ist als der Gegner", () => {
    const state = emptyBoard();
    for (const [zone, col] of [["left", 1], ["left", 2], ["right", 1], ["right", 2]] as const) placeUnit(state, 0, front(zone, col, 2), "recruit");
    for (const col of [0, 1, 2]) placeUnit(state, 1, front("left", col, 2), "shieldwall_veteran");
    const moves = actionsOf(new GreedyBot(1).plan(state, data, 0), "moveUnit");
    expect(moves.filter((m) => m.to.zone === "center")).toEqual([]);
  });

  it("R-11.2: kauft die teuerste bezahlbare Karte", () => {
    const state = emptyBoard();
    getPlayer(state, 0).treasury = 5;
    const buys = actionsOf(new GreedyBot(1).plan(state, data, 0), "buy");
    const p = getPlayer(state, 0);
    const affordable = [...Object.keys(state.supply), ...Object.keys(p.classPool)]
      .map((id) => data.cards.get(id))
      .filter((c) => c !== undefined && c.type !== "curse" && c.buyable !== false && c.cost <= 5)
      .map((c) => c?.cost ?? 0);
    expect(buys).toHaveLength(1);
    expect(data.cards.get(buys[0]?.cardId ?? "")?.cost).toBe(Math.max(...affordable));
  });

  it("R-7.4, R-14.2: Ilyras Blitzschlag zielt auf ein Feld mit einem Gegner", () => {
    const state = emptyBoard();
    // Spieler 1 (Ilyra): rechter Nachbar ist Spieler 2.
    const enemy = placeUnit(state, 2, front("left", 2, 2), "recruit");
    const planning = new GreedyBot(1).plan(state, data, 1);
    const at = unitArenaHex(config, state.units[enemy] as Unit);
    expect(actionsOf(planning, "setLeaderAbility")).toEqual([{ type: "setLeaderAbility", target: { kind: "hex", arena: "right", cell: at?.cell } }]);
  });

  it("R-8.1: der Entwurf verändert den Originalzustand nicht", () => {
    const state = createGame(data, undefined, 3);
    advance(state, data);
    const before = JSON.stringify(state);
    new GreedyBot(9).plan(state, data, 0);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("GreedyBot: ganze Partien (E14b, Abnahme E14)", () => {
  it("E14: vier GreedyBots spielen vollständige Partien bis zum Spielende ohne abgelehnte Aktionen (R-13)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const state = playBotGame(data, { seed, bots: greedyBots(seed) });
      expect(state.phase).toBe("gameOver");
      expect(state.result).not.toBeNull();
      expect(state.round).toBeLessThanOrEqual(config.maxRounds);
      expect(state.log.filter((e) => e.type === "action_rejected" || e.type === "submission_rejected")).toEqual([]);
    }
  });

  it("E14: gemischte Tische (GreedyBot und RandomBot) spielen vollständige Partien ohne abgelehnte Aktionen", () => {
    for (const seed of [1, 2, 3, 4]) {
      const bots: Bot[] = PLAYER_INDICES.map((p) => ((p + seed) % 2 === 0 ? new GreedyBot(seed * 10 + p) : new RandomBot(seed * 10 + p)));
      const state = playBotGame(data, { seed, bots });
      expect(state.phase).toBe("gameOver");
      expect(state.log.filter((e) => e.type === "action_rejected" || e.type === "submission_rejected")).toEqual([]);
    }
  });

  it("E14: GreedyBot nutzt Einheiten, Käufe, Zauber, Mitte und Anführer-Fähigkeit", () => {
    const types = new Set<string>();
    let center = false;
    for (const seed of [1, 2, 3]) {
      const state = playBotGame(data, { seed, bots: greedyBots(seed) });
      for (const e of state.log) {
        types.add(e.type);
        if (e.type === "center_held") center = true;
      }
    }
    for (const t of ["unit_played", "purchase_paid", "spell_resolved", "leader_ability_resolved"]) expect(types).toContain(t);
    expect(center).toBe(true);
  });

  it("E14: ein GreedyBot gewinnt gegen drei RandomBots klar häufiger als ein Viertel der Partien", () => {
    const games = 40;
    let wins = 0;
    for (let seed = 1; seed <= games; seed++) {
      const greedy = (seed % 4) as PlayerIndex;
      const bots: Bot[] = PLAYER_INDICES.map((p) => (p === greedy ? new GreedyBot(seed * 10 + p) : new RandomBot(seed * 10 + p)));
      const state = playBotGame(data, { seed, bots });
      const winners = state.result?.winners ?? [];
      if (winners.includes(greedy)) wins += 1 / winners.length;
    }
    expect(wins / games).toBeGreaterThanOrEqual(0.4);
  });

  it("R-1.8: gleicher Seed und gleiche Bot-Seeds ergeben dasselbe Ereignisprotokoll", () => {
    const a = playBotGame(data, { seed: 7, bots: greedyBots(7) });
    const b = playBotGame(data, { seed: 7, bots: greedyBots(7) });
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it("R-5: die Planung eines GreedyBots wird beim Einreichen angenommen", () => {
    const state = createGame(data, undefined, 12);
    advance(state, data);
    for (const p of PLAYER_INDICES) expect(submitPlanning(state, p, new GreedyBot(p).plan(state, data, p))).toEqual({ ok: true });
  });
});
