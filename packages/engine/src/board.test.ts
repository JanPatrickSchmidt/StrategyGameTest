import { describe, expect, it } from "vitest";
import type { PlanningAction } from "./actions";
import { boardCount, capacityFor, healUnit, isValidLocation, moveUnit, playUnit } from "./board";
import { loadGameData } from "./data";
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
const newGame = (seed = 11): GameState => createGame(data, defaultLeaders(data), seed);

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const center = (position: number): UnitLocation => ({ zone: "center", position });
const reserve = (slot: number): UnitLocation => ({ zone: "reserve", slot });

function addToHand(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  return cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    getPlayer(state, player).hand.push(id);
    return id;
  });
}

/** Legt eine Karten-Einheit direkt aufs Brett (für Testaufbauten). */
function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, extra: Partial<Unit> = {}): UnitId {
  const id = state.nextUnitId++;
  state.units[id] = {
    id,
    owner: player,
    kind: "card",
    sourceId: "recruit",
    cardInstanceIds: [],
    stars: 1,
    xp: 0,
    wounded: false,
    location,
    ...extra,
  };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function leaderId(state: GameState, player: PlayerIndex): UnitId {
  return getPlayer(state, player).leader.unitId;
}

function inPlanning(): GameState {
  const state = newGame();
  advance(state, data);
  return state;
}

describe("R-7.1: Einheit ausspielen", () => {
  it("R-7.1: Karte verlässt die Hand, wird zur Einheit auf dem Zielfeld, Kosten bezahlt", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 1;
    p.treasury = 2;
    const [card] = addToHand(state, 0, ["mercenary"]);
    expect(playUnit(state, data, 0, card, front("right", 1, 2), undefined)).toBeNull();
    expect(p.hand).not.toContain(card);
    const unit = Object.values(state.units).find((u) => u.cardInstanceIds.includes(card as number));
    expect(unit).toEqual(
      expect.objectContaining({ owner: 0, kind: "card", sourceId: "mercenary", stars: 1, xp: 0, wounded: false, location: front("right", 1, 2) }),
    );
    expect([p.roundGold, p.treasury]).toEqual([0, 1]);
    expect(eventsOf(state, "unit_played")).toEqual([
      expect.objectContaining({ player: 0, cardInstanceId: card, sourceId: "mercenary", paidFromRoundGold: 1, paidFromTreasury: 1 }),
    ]);
  });

  it("R-7.1: Karte nicht auf der Hand, keine Einheitenkarte, alternative Kosten noch nicht umgesetzt", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 10;
    const [spell] = addToHand(state, 0, ["purify"]);
    const [other] = addToHand(state, 1, ["recruit"]);
    const [spark] = addToHand(state, 0, ["spark_rider"]);
    expect(playUnit(state, data, 0, other, front("left", 0, 0), undefined)).toBe("cardNotInHand");
    expect(playUnit(state, data, 0, 9999, front("left", 0, 0), undefined)).toBe("cardNotInHand");
    expect(playUnit(state, data, 0, "1", front("left", 0, 0), undefined)).toBe("cardNotInHand");
    expect(playUnit(state, data, 0, spell, front("left", 0, 0), undefined)).toBe("notAUnitCard");
    // Alternative Kosten (R-14.6) folgen in E7b.
    expect(playUnit(state, data, 0, spark, front("left", 0, 0), true)).toBe("notImplemented");
    expect(playUnit(state, data, 0, spark, front("left", 0, 0), "yes")).toBe("malformed");
    expect(getPlayer(state, 0).roundGold).toBe(10);
    expect(eventsOf(state, "unit_played")).toEqual([]);
  });

  it("R-7.1/R-3.1/R-3.3/R-3.5: Zielort muss existieren", () => {
    expect(isValidLocation(config, front("left", 0, 0))).toBe(true);
    expect(isValidLocation(config, front("right", 4, 2))).toBe(true);
    expect(isValidLocation(config, front("left", 5, 0))).toBe(false);
    expect(isValidLocation(config, front("left", 0, 3))).toBe(false);
    expect(isValidLocation(config, front("left", -1, 0))).toBe(false);
    expect(isValidLocation(config, { zone: "left", cell: { col: 0.5, row: 0 } })).toBe(false);
    expect(isValidLocation(config, center(4))).toBe(true);
    expect(isValidLocation(config, center(5))).toBe(false);
    expect(isValidLocation(config, reserve(2))).toBe(true);
    expect(isValidLocation(config, reserve(3))).toBe(false);
    expect(isValidLocation(config, { zone: "sky" })).toBe(false);
    expect(isValidLocation(config, { zone: "left" })).toBe(false);
    expect(isValidLocation(config, null)).toBe(false);
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 5;
    const [card] = addToHand(state, 0, ["recruit"]);
    expect(playUnit(state, data, 0, card, center(7), undefined)).toBe("invalidLocation");
    expect(getPlayer(state, 0).hand).toContain(card);
  });

  it("R-7.1: Zielfeld muss frei sein; fremde Einheiten auf gleichen Koordinaten stören nicht", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 5;
    const [a, b] = addToHand(state, 0, ["recruit", "recruit"]);
    // R-4.4: Anführer steht auf left (2,1).
    expect(playUnit(state, data, 0, a, front("left", 2, 1), undefined)).toBe("cellOccupied");
    placeUnit(state, 1, front("right", 0, 0));
    expect(playUnit(state, data, 0, a, front("right", 0, 0), undefined)).toBeNull();
    expect(playUnit(state, data, 0, b, front("right", 0, 0), undefined)).toBe("cellOccupied");
  });

  it("R-7.1: fehlt Gold, wird die Aktion abgelehnt und nichts verändert", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 2;
    p.treasury = 2;
    const [card] = addToHand(state, 0, ["bounty_hunter"]);
    expect(playUnit(state, data, 0, card, front("left", 0, 0), undefined)).toBe("notEnoughGold");
    expect(p.hand).toContain(card);
    expect([p.roundGold, p.treasury]).toEqual([2, 2]);
  });

  it("R-7.1/R-7: in der Rundenmaschine beim Aufdecken der Reihe nach, ungültige Aktionen übersprungen", () => {
    const state = newGame();
    advance(state, data);
    const p = getPlayer(state, 0);
    p.roundGold = 2;
    p.treasury = 0;
    const [r1, r2, r3] = addToHand(state, 0, ["recruit", "recruit", "recruit"]);
    const actions: PlanningAction[] = [
      { type: "playUnit", cardInstanceId: r1 as number, to: front("left", 0, 2) },
      { type: "playUnit", cardInstanceId: r2 as number, to: front("left", 0, 2) },
      { type: "playUnit", cardInstanceId: r2 as number, to: center(0) },
      { type: "playUnit", cardInstanceId: r3 as number, to: center(1) },
    ];
    for (const pl of PLAYER_INDICES) submitPlanning(state, pl, pl === 0 ? { play: actions } : {});
    advance(state, data);
    expect(eventsOf(state, "unit_played").map((e) => e.cardInstanceId)).toEqual([r1, r2]);
    expect(eventsOf(state, "unit_played").every((e) => e.phase === "reveal")).toBe(true);
    expect(eventsOf(state, "action_rejected").filter((e) => e.player === 0).map((e) => [e.section, e.index, e.reason])).toEqual([
      ["play", 1, "cellOccupied"],
      ["play", 3, "notEnoughGold"],
    ]);
    // R-7.10: nicht ausgespielte Karten bleiben bis zum Rundenende auf der Hand und werden dann abgelegt.
    expect(eventsOf(state, "hand_discarded").find((e) => e.player === 0 && e.round === 1)?.cardInstanceIds).toContain(r3);
    expect(p.hand).not.toContain(r3);
    // R-3.7: Einheiten bleiben auf ihrem Feld.
    expect(Object.values(state.units).filter((u) => u.owner === 0 && u.kind === "card")).toHaveLength(2);
  });
});

describe("R-3.5: Reserve", () => {
  it("R-3.5/R-7.1: Einheiten dürfen direkt in die Reserve ausgespielt werden, auch bei vollem Brett", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    for (let i = 0; i < config.boardCapacity; i++) placeUnit(state, 0, center(i));
    const [a, b, c, d] = addToHand(state, 0, ["mercenary", "recruit", "recruit", "recruit"]);
    expect(playUnit(state, data, 0, a, reserve(0), undefined)).toBeNull();
    expect(p.hand).not.toContain(a);
    const unit = Object.values(state.units).find((u) => u.cardInstanceIds.includes(a as number));
    expect(unit?.location).toEqual(reserve(0));
    expect(eventsOf(state, "unit_played")).toEqual([expect.objectContaining({ player: 0, location: reserve(0) })]);
    expect(playUnit(state, data, 0, b, reserve(1), undefined)).toBeNull();
    expect(playUnit(state, data, 0, c, reserve(2), undefined)).toBeNull();
    // Reserve hat 3 Plätze: belegter Platz und Platz außerhalb werden abgelehnt.
    expect(playUnit(state, data, 0, d, reserve(0), undefined)).toBe("cellOccupied");
    expect(playUnit(state, data, 0, d, reserve(config.reserveSlots), undefined)).toBe("invalidLocation");
    expect(p.hand).toContain(d);
  });
});

describe("R-3.6: Kapazität", () => {
  it("R-3.6: 5 Plätze, +1 ab Anführer-Stufe 2 und nochmals +1 ab Stufe 4", () => {
    expect(capacityFor(config, 1)).toBe(5);
    expect(capacityFor(config, 2)).toBe(6);
    expect(capacityFor(config, 3)).toBe(6);
    expect(capacityFor(config, 4)).toBe(7);
    expect(capacityFor({ ...config, boardCapacity: 3 }, 1)).toBe(3);
  });

  it("R-3.6: links, rechts und Mitte zusammen; Anführer, Tokens und Reserve zählen nicht, Verwundete schon", () => {
    const state = inPlanning();
    getPlayer(state, 0).roundGold = 10;
    placeUnit(state, 0, front("left", 0, 0));
    placeUnit(state, 0, front("right", 0, 0));
    placeUnit(state, 0, center(0));
    placeUnit(state, 0, center(1), { wounded: true });
    placeUnit(state, 0, reserve(0));
    placeUnit(state, 0, front("left", 1, 0), { kind: "token", sourceId: "goblin_token" });
    expect(boardCount(state, 0)).toBe(4);
    const [a, b, c] = addToHand(state, 0, ["recruit", "recruit", "recruit"]);
    expect(playUnit(state, data, 0, a, center(2), undefined)).toBeNull();
    expect(boardCount(state, 0)).toBe(5);
    expect(playUnit(state, data, 0, b, center(3), undefined)).toBe("capacityExceeded");
    expect(playUnit(state, data, 0, b, reserve(1), undefined)).toBeNull();
    getPlayer(state, 0).leader.level = 2;
    expect(playUnit(state, data, 0, c, center(3), undefined)).toBeNull();
    expect(boardCount(state, 0)).toBe(6);
  });
});

describe("R-7.2: Einheit bewegen", () => {
  it("R-7.2: kostenlos zwischen Zonen, in und aus der Reserve, auch der Anführer", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 0;
    const unit = placeUnit(state, 0, front("left", 0, 0));
    const leader = leaderId(state, 0);
    expect(moveUnit(state, data, 0, unit, center(2))).toBeNull();
    expect(moveUnit(state, data, 0, unit, reserve(0))).toBeNull();
    expect(moveUnit(state, data, 0, unit, front("right", 4, 2))).toBeNull();
    expect(moveUnit(state, data, 0, leader, reserve(1))).toBeNull();
    expect(moveUnit(state, data, 0, leader, center(0))).toBeNull();
    expect(state.units[unit]?.location).toEqual(front("right", 4, 2));
    expect(state.units[leader]?.location).toEqual(center(0));
    expect(p.roundGold).toBe(0);
    expect(eventsOf(state, "unit_moved")[0]).toEqual(
      expect.objectContaining({ player: 0, unitId: unit, from: front("left", 0, 0), to: center(2) }),
    );
  });

  it("R-7.2: unbekannte, fremde Einheit, gleicher Ort, besetztes oder ungültiges Ziel werden abgelehnt", () => {
    const state = inPlanning();
    const unit = placeUnit(state, 0, front("left", 0, 0));
    const foreign = placeUnit(state, 1, front("left", 1, 1));
    expect(moveUnit(state, data, 0, 999, center(0))).toBe("unknownUnit");
    expect(moveUnit(state, data, 0, "x", center(0))).toBe("unknownUnit");
    expect(moveUnit(state, data, 0, foreign, center(0))).toBe("notOwnUnit");
    expect(moveUnit(state, data, 0, unit, front("left", 0, 0))).toBe("sameLocation");
    expect(moveUnit(state, data, 0, unit, front("left", 2, 1))).toBe("cellOccupied");
    expect(moveUnit(state, data, 0, unit, reserve(5))).toBe("invalidLocation");
    expect(state.units[unit]?.location).toEqual(front("left", 0, 0));
    expect(eventsOf(state, "unit_moved")).toEqual([]);
  });

  it("R-7.2/R-3.6: aus der Reserve aufs volle Brett abgelehnt, auf dem Brett umstellen erlaubt", () => {
    const state = inPlanning();
    for (let i = 0; i < 5; i++) placeUnit(state, 0, center(i));
    const benched = placeUnit(state, 0, reserve(0));
    expect(moveUnit(state, data, 0, benched, front("left", 0, 0))).toBe("capacityExceeded");
    const onBoard = Object.values(state.units).find((u) => u.owner === 0 && u.location.zone === "center")?.id as UnitId;
    expect(moveUnit(state, data, 0, onBoard, front("right", 0, 0))).toBeNull();
    // Der Anführer zählt nicht gegen die Kapazität.
    const leader = leaderId(state, 0);
    expect(moveUnit(state, data, 0, leader, reserve(1))).toBeNull();
    expect(moveUnit(state, data, 0, leader, front("left", 4, 0))).toBeNull();
    // Platz frei machen, dann darf die Reserve-Einheit aufs Brett.
    expect(moveUnit(state, data, 0, onBoard, reserve(2))).toBeNull();
    expect(moveUnit(state, data, 0, benched, front("left", 0, 0))).toBeNull();
  });
});

describe("R-7.5: Genesen", () => {
  it("R-7.5: kostet 1 Gold pro Stern, danach nicht mehr verwundet", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 1;
    p.treasury = 2;
    const unit = placeUnit(state, 0, reserve(0), { wounded: true, stars: 2 });
    expect(healUnit(state, data, 0, unit)).toBeNull();
    expect(state.units[unit]?.wounded).toBe(false);
    expect([p.roundGold, p.treasury]).toEqual([0, 1]);
    expect(eventsOf(state, "unit_healed")).toEqual([
      expect.objectContaining({ player: 0, unitId: unit, paidFromRoundGold: 1, paidFromTreasury: 1 }),
    ]);
  });

  it("R-7.5: nicht verwundet, fremd, unbekannt oder zu wenig Gold wird abgelehnt", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 2;
    p.treasury = 0;
    const healthy = placeUnit(state, 0, center(0));
    const foreign = placeUnit(state, 1, center(0), { wounded: true });
    const expensive = placeUnit(state, 0, center(1), { wounded: true, stars: 3 });
    expect(healUnit(state, data, 0, healthy)).toBe("notWounded");
    expect(healUnit(state, data, 0, foreign)).toBe("notOwnUnit");
    expect(healUnit(state, data, 0, 999)).toBe("unknownUnit");
    expect(healUnit(state, data, 0, expensive)).toBe("notEnoughGold");
    expect(state.units[expensive]?.wounded).toBe(true);
    expect(p.roundGold).toBe(2);
  });
});
