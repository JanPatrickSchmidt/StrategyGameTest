import { describe, expect, it } from "vitest";
import { applyCombatAftermath, runFrontWinEffects, runRoundStartEffects } from "./aftermath";
import { runCombatPhase } from "./center";
import { loadGameData } from "./data";
import type { Effect } from "./dataTypes";
import { COMBAT_TRIGGERS, type DeferredEffect } from "./effects";
import { fighterForUnit, runFrontCombats } from "./fronts";
import { mergeUnits } from "./merge";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import {
  cloneState,
  type FrontResult,
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

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const reserve = (slot = 1): UnitLocation => ({ zone: "reserve", slot });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve (leere Fronten). */
function emptyBoard(seed = 5): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string, extra: Partial<Unit> = {}): UnitId {
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
    ...extra,
  };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

function frontResult(first: PlayerIndex, second: PlayerIndex, winner: PlayerIndex | null, participants: UnitId[]): FrontResult {
  return {
    round: 1,
    arena: `front:${first}-${second}`,
    first,
    second,
    outcome: "combat",
    winner,
    ticks: 10,
    participants,
    survivors: [],
    winnerBreakthrough: 0,
  };
}

function deferred(unit: UnitId, team: PlayerIndex, effect: Effect, extra: Partial<DeferredEffect> = {}): DeferredEffect {
  return { tick: 1, unit, team, sourceId: "test", trigger: "onDeath", effect, ...extra };
}

describe("Vorgemerkte Kampf-Effekte (E10b, R-10.3)", () => {
  it("R-10.3: Goblin-Plänkler stirbt im Frontkampf, sein Spieler erhält 1 Gold sofort in die Schatzkammer", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 2), "goblin_skirmisher");
    placeUnit(state, 1, front("left", 2, 2), "arena_champion");
    const before = getPlayer(state, 0).treasury;
    const start = state.log.length;
    runFrontCombats(state, data);
    expect(eventsOf(state, "combat_unit_died", start).some((e) => state.units[e.unit]?.sourceId === "goblin_skirmisher")).toBe(true);
    expect(getPlayer(state, 0).treasury).toBe(before + 1);
    expect(eventsOf(state, "gold_gained", start)).toEqual([
      expect.objectContaining({ player: 0, amount: 1, treasury: before + 1, phase: "planning" }),
    ]);
  });

  it("R-10.3: auch Gold mit `to: pool` geht nach der Planung in die Schatzkammer", () => {
    const state = emptyBoard();
    const id = placeUnit(state, 2, front("right", 0, 0), "recruit");
    const roundGold = getPlayer(state, 2).roundGold;
    applyCombatAftermath(state, data, {
      fronts: [{ result: frontResult(2, 3, null, [id]), deferred: [deferred(id, 2, { op: "gainGold", amount: 3, when: "now", to: "pool" }, { amount: 3 })] }],
      center: null,
    });
    expect(getPlayer(state, 2).treasury).toBe(3);
    expect(getPlayer(state, 2).roundGold).toBe(roundGold);
  });

  it("E10b: Champion der Arena behält +1 Angriff je Bezwingen dauerhaft, auch in späteren Kämpfen", () => {
    const state = emptyBoard();
    const champion = placeUnit(state, 0, front("right", 2, 2), "arena_champion");
    placeUnit(state, 1, front("left", 2, 2), "recruit");
    placeUnit(state, 1, front("left", 1, 2), "pickpocket");
    const start = state.log.length;
    runFrontCombats(state, data);
    const kills = eventsOf(state, "combat_unit_died", start).filter((e) => state.units[e.unit]?.owner === 1).length;
    expect(kills).toBe(2);
    expect(state.units[champion]?.permanentBuffs).toEqual({ attack: 2 });
    expect(eventsOf(state, "unit_buffed_permanently", start)).toEqual([
      expect.objectContaining({ player: 0, unitId: champion, stat: "attack", amount: 1, total: 1 }),
      expect.objectContaining({ player: 0, unitId: champion, stat: "attack", amount: 1, total: 2 }),
    ]);
    const init = fighterForUnit(state, data, state.units[champion] as Unit, { col: 0, row: 0 });
    expect(init.stats.attack).toBe(8);
  });

  it("E10b: dauerhafte Buffs kommen nach dem Sternfaktor als fester Zuschlag hinzu (F31)", () => {
    const state = emptyBoard();
    const id = placeUnit(state, 0, front("right", 0, 0), "arena_champion", { stars: 2, permanentBuffs: { attack: 3, hp: 2 } });
    const init = fighterForUnit(state, data, state.units[id] as Unit, { col: 0, row: 0 });
    expect(init.stats.attack).toBe(Math.floor(6 * 1.8) + 3);
    expect(init.stats.hp).toBe(Math.floor(12 * 1.8) + 2);
  });

  it("R-15.1: beim Verschmelzen addieren sich die dauerhaften Buffs der drei Einheiten (F31)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 0, 0), "arena_champion", { permanentBuffs: { attack: 2 } });
    placeUnit(state, 0, front("right", 1, 0), "arena_champion");
    placeUnit(state, 0, front("right", 2, 0), "arena_champion", { permanentBuffs: { attack: 1, armor: 1 } });
    const [merged] = mergeUnits(state, 0);
    expect(state.units[merged as UnitId]?.permanentBuffs).toEqual({ attack: 3, armor: 1 });
  });

  it("E10b: dauerhafte Buffs auf Tokens gehen nicht in den Spielzustand (Tokens verschwinden, R-1.4)", () => {
    const state = emptyBoard();
    const src = placeUnit(state, 0, front("right", 0, 0), "arena_champion");
    const effect: Effect = { op: "buff", stat: "attack", amount: 1, duration: "permanent", target: "self" };
    applyCombatAftermath(state, data, {
      fronts: [{ result: frontResult(0, 1, null, [src]), deferred: [deferred(src, 0, effect, { targets: [9999, src], amount: 1 })] }],
      center: null,
    });
    expect(state.units[src]?.permanentBuffs).toEqual({ attack: 1 });
    expect(eventsOf(state, "unit_buffed_permanently")).toHaveLength(1);
  });

  it("E10b: Seelenhirte gibt dem eigenen Anführer je gestorbenem Verbündeten 1 XP", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "soul_shepherd");
    placeUnit(state, 0, front("right", 1, 2), "recruit");
    placeUnit(state, 0, front("right", 3, 2), "pickpocket");
    placeUnit(state, 1, front("left", 2, 2), "arena_champion");
    const xp = getPlayer(state, 0).leader.xp;
    const start = state.log.length;
    runFrontCombats(state, data);
    const died = eventsOf(state, "combat_unit_died", start).map((e) => state.units[e.unit]?.sourceId);
    // Gezählt werden nur Tode, solange der Seelenhirte lebt.
    const shepherdAt = died.indexOf("soul_shepherd");
    const allyDeaths = (shepherdAt === -1 ? died : died.slice(0, shepherdAt)).filter((s) => s === "recruit" || s === "pickpocket").length;
    expect(allyDeaths).toBeGreaterThan(0);
    expect(getPlayer(state, 0).leader.xp).toBe(xp + allyDeaths);
    expect(eventsOf(state, "leader_xp_gained", start).every((e) => e.player === 0 && e.amount === 1)).toBe(true);
  });

  it("E10b: Effekte aus dem Mittelkampf wirken ebenfalls (Goblin-Plänkler in der Mitte)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, { zone: "center", position: 2 }, "goblin_skirmisher");
    placeUnit(state, 2, { zone: "center", position: 2 }, "arena_champion");
    const before = getPlayer(state, 0).treasury;
    runCombatPhase(state, data);
    expect(getPlayer(state, 0).treasury).toBe(before + 1);
  });

  it("E10b: Effekte ausgeschiedener Spieler wirken nicht", () => {
    const state = emptyBoard();
    const id = placeUnit(state, 3, reserve(), "recruit");
    getPlayer(state, 3).eliminated = true;
    applyCombatAftermath(state, data, {
      fronts: [{ result: frontResult(3, 0, null, [id]), deferred: [deferred(id, 3, { op: "gainGold", amount: 1, when: "now", to: "treasury" }, { amount: 1 })] }],
      center: null,
    });
    expect(getPlayer(state, 3).treasury).toBe(0);
  });
});

describe("onFrontWin (E10b, R-14.7)", () => {
  it("R-14.7: Fluchweber gewinnt seine Front, der Gegner bekommt einen Fluch auf den Ablagestapel", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "curse_weaver");
    const pile = state.supply["curse"] as number;
    const discard = getPlayer(state, 1).discard.length;
    const start = state.log.length;
    runFrontCombats(state, data);
    const p1 = getPlayer(state, 1);
    expect(p1.discard).toHaveLength(discard + 1);
    expect(state.cards[p1.discard[p1.discard.length - 1] as number]).toEqual(expect.objectContaining({ cardId: "curse", owner: 1 }));
    expect(state.supply["curse"]).toBe(pile - 1);
    expect(eventsOf(state, "curse_given", start)).toEqual([expect.objectContaining({ player: 0, to: 1, cardId: "curse" })]);
    expect(eventsOf(state, "pile_changed", start)).toEqual([expect.objectContaining({ pile: "curse", remaining: pile - 1 })]);
    expect(eventsOf(state, "ability_triggered", start)).toEqual([
      expect.objectContaining({ player: 0, sourceId: "curse_weaver", trigger: "onFrontWin", arena: "front:0-1" }),
    ]);
  });

  it("R-14.7: ist der Fluch-Stapel leer, passiert nichts", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "curse_weaver");
    state.supply["curse"] = 0;
    const discard = getPlayer(state, 1).discard.length;
    runFrontCombats(state, data);
    expect(getPlayer(state, 1).discard).toHaveLength(discard);
    expect(eventsOf(state, "curse_given")).toEqual([]);
  });

  it("E10b: wer seine Front verliert oder unentschieden spielt, löst onFrontWin nicht aus", () => {
    const state = emptyBoard();
    const weaver = placeUnit(state, 0, front("right", 2, 0), "curse_weaver");
    runFrontWinEffects(state, data, [frontResult(0, 1, 1, [weaver]), frontResult(3, 0, null, [weaver])]);
    expect(eventsOf(state, "curse_given")).toEqual([]);
  });

  it("E10b: onFrontWin löst auch aus, wenn die Einheit im Kampf gestorben ist (F31)", () => {
    const state = emptyBoard();
    const weaver = placeUnit(state, 0, front("right", 2, 0), "curse_weaver");
    const result = frontResult(0, 1, 0, [weaver]);
    expect(result.survivors).not.toContain(weaver);
    runFrontWinEffects(state, data, [result]);
    expect(eventsOf(state, "curse_given")).toEqual([expect.objectContaining({ to: 1 })]);
  });

  it("E10b: Meisterdieb stiehlt nach gewonnener Front 2 Gold aus der Schatzkammer des Gegners", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "master_thief");
    getPlayer(state, 1).treasury = 5;
    const start = state.log.length;
    runFrontCombats(state, data);
    expect(getPlayer(state, 1).treasury).toBe(3);
    expect(getPlayer(state, 0).treasury).toBe(2);
    expect(eventsOf(state, "gold_stolen", start)).toEqual([
      expect.objectContaining({ player: 0, from: 1, amount: 2, treasury: 2, fromTreasury: 3 }),
    ]);
  });

  it("E10b: Meisterdieb stiehlt höchstens, was da ist; bei leerer Schatzkammer nichts", () => {
    const state = emptyBoard();
    const thief = placeUnit(state, 0, front("right", 2, 0), "master_thief");
    getPlayer(state, 1).treasury = 1;
    runFrontWinEffects(state, data, [frontResult(0, 1, 0, [thief])]);
    expect(getPlayer(state, 0).treasury).toBe(1);
    expect(getPlayer(state, 1).treasury).toBe(0);
    runFrontWinEffects(state, data, [frontResult(0, 1, 0, [thief])]);
    expect(getPlayer(state, 0).treasury).toBe(1);
    expect(eventsOf(state, "gold_stolen")).toHaveLength(1);
  });

  it("R-1.7: mehrere onFrontWin-Effekte verschiedener Spieler wirken in Prioritätsreihenfolge", () => {
    const build = (round: number): GameState => {
      const state = emptyBoard();
      state.round = round;
      const thief0 = placeUnit(state, 0, front("right", 2, 0), "master_thief");
      const thief1 = placeUnit(state, 1, front("right", 2, 0), "master_thief");
      getPlayer(state, 1).treasury = 0;
      getPlayer(state, 2).treasury = 5;
      runFrontWinEffects(state, data, [frontResult(0, 1, 0, [thief0]), frontResult(1, 2, 1, [thief1])]);
      return state;
    };
    // Runde 1: Spieler 0 zuerst, Spieler 1 hat noch nichts.
    const r1 = build(1);
    expect([getPlayer(r1, 0).treasury, getPlayer(r1, 1).treasury, getPlayer(r1, 2).treasury]).toEqual([0, 2, 3]);
    // Runde 2: Spieler 1 zuerst, danach bestiehlt ihn Spieler 0.
    const r2 = build(2);
    expect([getPlayer(r2, 0).treasury, getPlayer(r2, 1).treasury, getPlayer(r2, 2).treasury]).toEqual([2, 0, 3]);
  });
});

describe("onRoundStart (E10b, R-17a.1)", () => {
  it("R-17a.1: Hehler in der Reserve bringt zu Rundenbeginn 1 Gold in den Rundenvorrat (R-10.3)", () => {
    const state = emptyBoard();
    const fence = placeUnit(state, 0, reserve(), "fence");
    playRound(state);
    expect(state.round).toBe(2);
    const gained = eventsOf(state, "round_gold_gained").filter((e) => e.round === 2);
    expect(gained).toEqual([expect.objectContaining({ player: 0, amount: 1, phase: "roundStart" })]);
    expect(eventsOf(state, "ability_triggered").filter((e) => e.round === 2)).toEqual([
      expect.objectContaining({ player: 0, unitId: fence, trigger: "onRoundStart", arena: null }),
    ]);
  });

  it("R-17a.1: Hehler auf dem Brett bringt nichts", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 0), "fence");
    playRound(state);
    expect(eventsOf(state, "round_gold_gained").filter((e) => e.round === 2)).toEqual([]);
  });

  it("R-17a.1: auch ein verwundeter Hehler in der Reserve bringt Gold (R-1.9)", () => {
    const state = emptyBoard();
    placeUnit(state, 1, reserve(), "fence", { wounded: true });
    const before = getPlayer(state, 1).roundGold;
    runRoundStartEffects(state, data);
    expect(getPlayer(state, 1).roundGold).toBe(before + 1);
  });

  it("R-6.1, R-17a.1: „pro Runde“-Effekte vor den Zinsen (F31)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, reserve(), "fence");
    getPlayer(state, 0).treasury = 10;
    playRound(state);
    const round2 = state.log.filter((e) => e.round === 2);
    const triggered = round2.findIndex((e) => e.type === "ability_triggered");
    const interest = round2.findIndex((e) => e.type === "interest_paid" && e.player === 0);
    expect(triggered).toBeGreaterThanOrEqual(0);
    expect(interest).toBeGreaterThan(triggered);
  });

  it("R-17a.1: mehrere Hehler, Spieler in Prioritätsreihenfolge; ausgeschiedene Spieler nicht", () => {
    const state = emptyBoard();
    state.round = 2;
    placeUnit(state, 0, reserve(1), "fence");
    placeUnit(state, 1, reserve(1), "fence");
    placeUnit(state, 3, reserve(1), "fence");
    getPlayer(state, 3).eliminated = true;
    const start = state.log.length;
    runRoundStartEffects(state, data);
    expect(eventsOf(state, "round_gold_gained", start).map((e) => e.player)).toEqual([1, 0]);
  });
});

describe("Abdeckung und Determinismus", () => {
  it("R-14.1: jede Karte mit Wirkung außerhalb des Kampfes hat hier einen Test", () => {
    const covered = new Set(["goblin_skirmisher", "arena_champion", "soul_shepherd", "curse_weaver", "master_thief", "fence"]);
    const outside = (e: Effect): boolean =>
      e.op === "gainGold" || e.op === "gainLeaderXp" || e.op === "giveCurse" || e.op === "stealGold" || (e.op === "buff" && e.duration === "permanent");
    const ids = [...data.cards.values()]
      .filter((c) => c.type === "unit")
      .filter((c) =>
        (c.abilities ?? []).some(
          (a) => a.trigger === "onFrontWin" || a.trigger === "onRoundStart" || (COMBAT_TRIGGERS.includes(a.trigger) && a.effects.some(outside)),
        ),
      )
      .map((c) => c.id);
    expect(ids.filter((id) => !covered.has(id))).toEqual([]);
  });

  it("Determinismus: eine Runde mit Wirkungen außerhalb des Kampfes ergibt identische Protokolle", () => {
    const state = emptyBoard(9);
    placeUnit(state, 0, front("right", 2, 2), "arena_champion");
    placeUnit(state, 0, front("right", 1, 0), "curse_weaver");
    placeUnit(state, 1, front("left", 2, 2), "goblin_skirmisher");
    placeUnit(state, 1, front("left", 1, 1), "soul_shepherd");
    placeUnit(state, 2, front("right", 2, 0), "master_thief");
    placeUnit(state, 3, reserve(), "fence");
    getPlayer(state, 3).treasury = 4;
    const a = cloneState(state);
    const b = cloneState(state);
    playRound(a);
    playRound(b);
    expect(a.log).toEqual(b.log);
    expect(a.log.some((e) => e.type === "curse_given")).toBe(true);
    expect(a.log.some((e) => e.type === "gold_stolen")).toBe(true);
  });
});
