import { describe, expect, it } from "vitest";
import type { PlanningAction } from "./actions";
import { playUnit } from "./board";
import { loadGameData } from "./data";
import { modifiedCost, resonanceCostModifier } from "./resonance";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
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

const data = loadGameData();
const config = data.config;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const center = (position: number): UnitLocation => ({ zone: "center", position });
const reserve = (slot: number): UnitLocation => ({ zone: "reserve", slot });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. Spieler 2 führt Vex (Goblin). */
function emptyBoard(seed = 11): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = reserve(0);
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

function addToHand(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  return cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    getPlayer(state, player).hand.push(id);
    return id;
  });
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Spieler 2 mit Goblins 4: Vex + Funkenreiter + Plänkler + Kesselflicker auf dem Brett. */
function goblins4(): GameState {
  const state = emptyBoard();
  (state.units[getPlayer(state, 2).leader.unitId] as Unit).location = front("left", 2, 0);
  placeUnit(state, 2, front("left", 0, 0), "spark_rider");
  placeUnit(state, 2, front("right", 0, 0), "goblin_skirmisher");
  placeUnit(state, 2, center(0), "tinker");
  return state;
}

describe("Rassen-Resonanz: Kostenbonus (E10c2, R-17.3)", () => {
  it("R-17.3: Goblins 4: Goblin-Karten kosten 1 Gold weniger, Ereignis meldet die Änderung", () => {
    const state = goblins4();
    const p = getPlayer(state, 2);
    p.roundGold = 2;
    p.treasury = 0;
    expect(resonanceCostModifier(state, data, 2, "goblin")).toBe(-1);
    const [tinker] = addToHand(state, 2, ["tinker"]); // kostet normal 3
    expect(playUnit(state, data, 2, tinker, front("left", 1, 0), undefined)).toBeNull();
    expect([p.roundGold, p.treasury]).toEqual([0, 0]);
    expect(eventsOf(state, "unit_played").at(-1)).toEqual(
      expect.objectContaining({ player: 2, cardInstanceId: tinker, paidFromRoundGold: 2, paidFromTreasury: 0, costModifier: -1 }),
    );
  });

  it("R-17.3: Goblins 2 hat keinen Kostenbonus", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 2);
    placeUnit(state, 2, front("left", 0, 0), "spark_rider");
    placeUnit(state, 2, front("left", 1, 0), "tinker");
    p.roundGold = 2;
    p.treasury = 0;
    expect(resonanceCostModifier(state, data, 2, "goblin")).toBe(0);
    const [skirmisher] = addToHand(state, 2, ["goblin_skirmisher"]);
    expect(playUnit(state, data, 2, skirmisher, front("right", 0, 0), undefined)).toBeNull();
    expect(p.roundGold).toBe(0);
    expect(eventsOf(state, "unit_played").at(-1)).toEqual(expect.objectContaining({ costModifier: 0 }));
  });

  it("R-17.3: der Bonus gilt nur für Karten der Rasse und nur für den eigenen Spieler", () => {
    const state = goblins4();
    const p = getPlayer(state, 2);
    p.roundGold = 2;
    p.treasury = 0;
    const [mercenary] = addToHand(state, 2, ["mercenary"]); // ohne Rasse, kostet 2
    expect(playUnit(state, data, 2, mercenary, front("left", 1, 0), undefined)).toBeNull();
    expect(p.roundGold).toBe(0);
    expect(resonanceCostModifier(state, data, 2, null)).toBe(0);
    expect(resonanceCostModifier(state, data, 2, "dwarf")).toBe(0);
    // Spieler 1 hat keine Goblins auf dem Brett: kein Bonus, auch wenn Spieler 2 Goblins 4 hat.
    const p1 = getPlayer(state, 1);
    p1.roundGold = 2;
    p1.treasury = 0;
    const [tinker] = addToHand(state, 1, ["tinker"]);
    expect(playUnit(state, data, 1, tinker, front("left", 0, 0), undefined)).toBe("notEnoughGold");
    expect(p1.roundGold).toBe(2);
  });

  it("R-17.3: mit dem Bonus reicht weniger Gold, ohne ihn wird abgelehnt", () => {
    const state = goblins4();
    const p = getPlayer(state, 2);
    p.roundGold = 1;
    p.treasury = 0;
    const [rider] = addToHand(state, 2, ["spark_rider"]); // kostet normal 2
    expect(playUnit(state, data, 2, rider, front("left", 1, 0), undefined)).toBeNull();
    expect(p.roundGold).toBe(0);
  });

  it("R-17.3: Kosten fallen nie unter 0, auch nicht bei alternativen Kosten ohne Gold", () => {
    expect(modifiedCost(0, -1)).toBe(0);
    expect(modifiedCost(1, -3)).toBe(0);
    expect(modifiedCost(3, -1)).toBe(2);
    const state = goblins4();
    const p = getPlayer(state, 2);
    p.roundGold = 0;
    p.treasury = 0;
    const [rider] = addToHand(state, 2, ["spark_rider"]); // altCost: bloodToll 2, kein Gold
    expect(playUnit(state, data, 2, rider, front("left", 1, 0), true)).toBeNull();
    expect([p.roundGold, p.treasury, p.life]).toEqual([0, 0, config.startingLife - 2]);
    expect(eventsOf(state, "unit_played").at(-1)).toEqual(expect.objectContaining({ altCost: true, costModifier: 0 }));
  });

  it("R-17.3: maßgeblich ist das Brett zum Zeitpunkt der Aktion – die vierte Goblin-Karte macht die nächste billiger", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 2);
    (state.units[p.leader.unitId] as Unit).location = front("left", 2, 0);
    placeUnit(state, 2, front("left", 0, 0), "spark_rider");
    placeUnit(state, 2, front("left", 1, 0), "goblin_skirmisher");
    p.roundGold = 5;
    p.treasury = 0;
    const [tinker, rider] = addToHand(state, 2, ["tinker", "spark_rider"]);
    const actions: PlanningAction[] = [
      { type: "playUnit", cardInstanceId: tinker as number, to: center(0) }, // 3 Goblins: volle 3 Gold
      { type: "playUnit", cardInstanceId: rider as number, to: front("right", 0, 0) }, // jetzt 4: 2 − 1 = 1
    ];
    for (const pl of PLAYER_INDICES) submitPlanning(state, pl, pl === 2 ? { play: actions } : {});
    advance(state, data);
    const played = eventsOf(state, "unit_played").filter((e) => e.player === 2);
    expect(played.map((e) => [e.cardInstanceId, e.paidFromRoundGold + e.paidFromTreasury, e.costModifier])).toEqual([
      [tinker, 3, 0],
      [rider, 1, -1],
    ]);
  });

  it("R-17.3: verwundete Einheiten und die Reserve zählen nicht für den Bonus (R-17.1)", () => {
    const state = goblins4();
    const p = getPlayer(state, 2);
    const rider = Object.values(state.units).find((u) => u.owner === 2 && u.sourceId === "spark_rider") as Unit;
    rider.wounded = true;
    expect(resonanceCostModifier(state, data, 2, "goblin")).toBe(0);
    rider.wounded = false;
    rider.location = reserve(1);
    expect(resonanceCostModifier(state, data, 2, "goblin")).toBe(0);
    rider.location = front("left", 0, 0);
    expect(resonanceCostModifier(state, data, 2, "goblin")).toBe(-1);
    // Eine Goblin-Karte in die Reserve gespielt erhöht die Zählung nicht.
    rider.location = reserve(1);
    p.roundGold = 5;
    p.treasury = 0;
    const [other, next] = addToHand(state, 2, ["spark_rider", "goblin_skirmisher"]);
    expect(playUnit(state, data, 2, other, reserve(2), undefined)).toBeNull();
    expect(p.roundGold).toBe(3);
    expect(playUnit(state, data, 2, next, front("left", 0, 1), undefined)).toBeNull();
    expect(p.roundGold).toBe(1);
  });
});
