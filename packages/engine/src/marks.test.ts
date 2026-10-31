import { describe, expect, it } from "vitest";
import { applyStateEffect, type StateEffectContext } from "./aftermath";
import { runCombatPhase } from "./center";
import { loadGameData } from "./data";
import type { Effect } from "./dataTypes";
import { fighterForUnit } from "./fronts";
import { addRoundMark, applyRoundStartMarks, markedStartManaPercent } from "./marks";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve (leere Fronten). */
function emptyBoard(seed = 7): GameState {
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

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Alle aktiven Spieler reichen leere Planungen ein; läuft bis zur Planung der nächsten Runde. */
function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

const ctx = (player: PlayerIndex, duringPlanning = false): StateEffectContext => ({ player, unitId: null, frontOpponent: null, duringPlanning });

function sparkForgeEffect(): Effect {
  const card = data.cards.get("spark_forge");
  if (!card || card.type !== "spell") throw new Error("Funkenschmiede fehlt");
  return card.effects[0] as Effect;
}

const manaMax = data.config.combat.defaultManaMax;

describe("Markierungen „nächste Runde“ (E10b2, R-17a.2)", () => {
  it("R-17a.2: gainGold mit when nextRound wird als Markierung gespeichert, nicht sofort gutgeschrieben", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 1);
    const before = { pool: p.roundGold, treasury: p.treasury };
    applyStateEffect(state, data, { op: "gainGold", amount: 2, when: "nextRound", to: "pool" }, ctx(1));
    expect(p.roundGold).toBe(before.pool);
    expect(p.treasury).toBe(before.treasury);
    expect(p.roundMarks).toEqual([{ kind: "gold", round: 2, amount: 2, to: "pool" }]);
    expect(eventsOf(state, "round_mark_set")).toHaveLength(1);
  });

  it("R-17a.2: Gold-Markierung wirkt beim Rundenbeginn der nächsten Runde in den Rundenvorrat und wird gelöscht", () => {
    const state = emptyBoard();
    addRoundMark(state, 2, { kind: "gold", round: 2, amount: 3, to: "pool" });
    const from = state.log.length;
    playRound(state);
    expect(state.round).toBe(2);
    const p = getPlayer(state, 2);
    expect(p.roundMarks).toEqual([]);
    const gained = eventsOf(state, "round_gold_gained", from).filter((e) => e.player === 2);
    expect(gained.map((e) => e.amount)).toEqual([3]);
    expect(eventsOf(state, "round_mark_applied", from).map((e) => e.player)).toEqual([2]);
    expect(eventsOf(state, "round_mark_cleared", from).map((e) => e.player)).toEqual([2]);
  });

  it("R-17a.2: Gold-Markierung mit to treasury geht vor den Zinsen in die Schatzkammer (F32)", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 0);
    p.treasury = 4;
    p.roundGold = 0;
    addRoundMark(state, 0, { kind: "gold", round: 2, amount: 1, to: "treasury" });
    const from = state.log.length;
    playRound(state);
    const log = state.log.slice(from);
    const applied = log.findIndex((e) => e.type === "round_mark_applied" && e.player === 0);
    const interest = log.findIndex((e) => e.type === "interest_paid" && e.player === 0);
    expect(applied).toBeGreaterThanOrEqual(0);
    // 4 + 1 = 5 in der Schatzkammer → 1 Zins (R-6.1); ohne Markierung gäbe es keinen.
    expect(interest).toBeGreaterThan(applied);
    expect(eventsOf(state, "interest_paid", from).find((e) => e.player === 0)?.amount).toBe(1);
  });

  it("R-17a.2: gainGold mit when roundStart außerhalb des Rundenbeginns wird Markierung, zu Rundenbeginn wirkt es sofort", () => {
    const state = emptyBoard();
    applyStateEffect(state, data, { op: "gainGold", amount: 1, when: "roundStart", to: "treasury" }, ctx(3));
    expect(getPlayer(state, 3).roundMarks).toEqual([{ kind: "gold", round: 2, amount: 1, to: "treasury" }]);
    const pool = getPlayer(state, 3).roundGold;
    applyStateEffect(state, data, { op: "gainGold", amount: 1, when: "roundStart" }, ctx(3, true));
    expect(getPlayer(state, 3).roundGold).toBe(pool + 1);
    expect(getPlayer(state, 3).roundMarks).toHaveLength(1);
  });

  it("R-17a.2: Funkenschmiede speichert +50 % Start-Mana für eigene Magier in der nächsten Runde", () => {
    const state = emptyBoard();
    applyStateEffect(state, data, sparkForgeEffect(), ctx(0));
    expect(getPlayer(state, 0).roundMarks).toEqual([{ kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" }]);
    // In dieser Runde wirkt sie noch nicht.
    const mage = placeUnit(state, 0, front("right", 0, 0), "apprentice");
    expect(markedStartManaPercent(state, data, state.units[mage] as Unit)).toBe(0);
  });

  it("R-17a.2: Start-Mana-Markierung wirkt beim Kampfbeginn der nächsten Runde nur auf eigene Einheiten der Klasse", () => {
    const state = emptyBoard();
    addRoundMark(state, 0, { kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" });
    playRound(state);
    expect(state.round).toBe(2);
    const mage = placeUnit(state, 0, front("right", 0, 0), "apprentice");
    const warrior = placeUnit(state, 0, front("right", 1, 0), "recruit");
    const enemyMage = placeUnit(state, 1, front("left", 0, 0), "apprentice");
    const at = { col: 0, row: 0 };
    expect(fighterForUnit(state, data, state.units[mage] as Unit, at).startMana).toBe(Math.floor(manaMax / 2));
    expect(fighterForUnit(state, data, state.units[warrior] as Unit, at).startMana).toBeUndefined();
    expect(fighterForUnit(state, data, state.units[enemyMage] as Unit, at).startMana).toBeUndefined();
  });

  it("R-17a.2: in der Kampfphase gemeldet, danach gelöscht; in der Runde darauf wirkt nichts mehr", () => {
    const state = emptyBoard();
    addRoundMark(state, 0, { kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" });
    playRound(state);
    const mage = placeUnit(state, 0, front("right", 0, 0), "apprentice");
    placeUnit(state, 1, front("left", 0, 0), "recruit");
    const from = state.log.length;
    runCombatPhase(state, data);
    const applied = eventsOf(state, "round_mark_applied", from);
    expect(applied.map((e) => e.unitIds)).toEqual([[mage]]);
    const firstCombat = state.log.findIndex((e, i) => i >= from && e.type === "combat_started");
    expect(state.log.findIndex((e, i) => i >= from && e.type === "round_mark_applied")).toBeLessThan(firstCombat);
    expect(getPlayer(state, 0).roundMarks).toEqual([]);
    expect(eventsOf(state, "round_mark_cleared", from)).toHaveLength(1);
    expect(markedStartManaPercent(state, data, state.units[mage] as Unit)).toBe(0);
  });

  it("R-17a.2: mehrere Start-Mana-Markierungen addieren sich, die Kampfsimulation deckelt bei manaMax", () => {
    const state = emptyBoard();
    addRoundMark(state, 0, { kind: "startMana", round: 1, percent: 50, target: "ownClassUnits", classId: "mage" });
    addRoundMark(state, 0, { kind: "startMana", round: 1, percent: 70, target: "ownClassUnits", classId: "mage" });
    const mage = placeUnit(state, 0, front("right", 0, 0), "apprentice");
    expect(markedStartManaPercent(state, data, state.units[mage] as Unit)).toBe(120);
    expect(fighterForUnit(state, data, state.units[mage] as Unit, { col: 0, row: 0 }).startMana).toBe(Math.floor((manaMax * 120) / 100));
  });

  it("R-17a.2: Markierungen gelten nur eine Runde; abgelaufene werden beim Rundenbeginn gelöscht", () => {
    const state = emptyBoard();
    // Eine Markierung für Runde 1, die in dieser Runde nicht wirkt (z. B. kein Kampf): beim nächsten Rundenbeginn weg.
    addRoundMark(state, 1, { kind: "startMana", round: 1, percent: 50, target: "allAllies", classId: null });
    addRoundMark(state, 1, { kind: "gold", round: 1, amount: 5, to: "pool" });
    state.round = 2;
    const pool = getPlayer(state, 1).roundGold;
    applyRoundStartMarks(state);
    expect(getPlayer(state, 1).roundMarks).toEqual([]);
    expect(getPlayer(state, 1).roundGold).toBe(pool);
    expect(eventsOf(state, "round_mark_cleared").filter((e) => e.player === 1)).toHaveLength(2);
  });

  it("R-17a.2: Markierungen für spätere Runden bleiben beim Rundenbeginn liegen", () => {
    const state = emptyBoard();
    addRoundMark(state, 1, { kind: "gold", round: 3, amount: 2, to: "pool" });
    playRound(state);
    expect(state.round).toBe(2);
    expect(getPlayer(state, 1).roundMarks).toEqual([{ kind: "gold", round: 3, amount: 2, to: "pool" }]);
  });

  it("R-17a.2: ausgeschiedene Spieler bekommen keine Markierungen, offene werden gelöscht", () => {
    const state = emptyBoard();
    addRoundMark(state, 3, { kind: "gold", round: 2, amount: 2, to: "pool" });
    getPlayer(state, 3).eliminated = true;
    addRoundMark(state, 3, { kind: "gold", round: 2, amount: 2, to: "pool" });
    expect(getPlayer(state, 3).roundMarks).toHaveLength(1);
    state.round = 2;
    applyRoundStartMarks(state);
    expect(getPlayer(state, 3).roundMarks).toEqual([]);
    expect(eventsOf(state, "round_mark_applied")).toHaveLength(0);
  });

  it("R-17a.2: Determinismus – gleiche Markierungen ergeben identisches Protokoll", () => {
    const run = (): GameEvent[] => {
      const state = emptyBoard(11);
      addRoundMark(state, 0, { kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" });
      addRoundMark(state, 2, { kind: "gold", round: 2, amount: 2, to: "treasury" });
      placeUnit(state, 0, front("right", 0, 0), "apprentice");
      placeUnit(state, 1, front("left", 0, 0), "recruit");
      playRound(state);
      playRound(state);
      return state.log;
    };
    expect(run()).toEqual(run());
  });
});
