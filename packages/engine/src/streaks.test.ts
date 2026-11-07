import { describe, expect, it } from "vitest";
import { CENTER_ARENA_ID } from "./center";
import { type ConfigData, type GameData, loadGameData } from "./data";
import { grantLeaderFightXp, resolveStreaks, roundOutcome, streakGold } from "./resolution";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import {
  type CenterResult,
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

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve (keine Kämpfe ohne weitere Einheiten). */
function emptyBoard(seed = 31): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const leader = state.units[getPlayer(state, p).leader.unitId] as Unit;
    leader.location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function leaderOf(state: GameState, player: PlayerIndex): Unit {
  return state.units[getPlayer(state, player).leader.unitId] as Unit;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit"): UnitId {
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

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function playRound(state: GameState, gameData: GameData = data): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, gameData);
}

/** Front-Ergebnis von Hand für Tests der Auswertung allein. */
function result(state: GameState, first: PlayerIndex, second: PlayerIndex, over: Partial<FrontResult>): FrontResult {
  return {
    round: state.round,
    arena: `front:${first}-${second}`,
    first,
    second,
    outcome: "combat",
    winner: null,
    ticks: 10,
    participants: [],
    survivors: [],
    winnerBreakthrough: 0,
    wounded: [],
    ...over,
  };
}

function centerResult(state: GameState, over: Partial<CenterResult>): CenterResult {
  return {
    round: state.round,
    arena: CENTER_ARENA_ID,
    players: [],
    outcome: "combat",
    holder: null,
    ticks: 10,
    participants: [],
    survivors: [],
    wounded: [],
    ...over,
  };
}

describe("R-10.6: Ausgang der Runde", () => {
  it("R-10.6: mehr gewonnene als verlorene Frontkämpfe = gewonnen, umgekehrt verloren, sonst neutral", () => {
    const state = emptyBoard();
    state.frontResults = [
      result(state, 0, 1, { winner: 0 }),
      result(state, 1, 2, { winner: 2 }),
      result(state, 2, 3, { winner: 2 }),
      result(state, 3, 0, { winner: null }),
    ];
    expect(roundOutcome(state, 0)).toEqual({ outcome: "won", wins: 1, losses: 0 });
    expect(roundOutcome(state, 1)).toEqual({ outcome: "lost", wins: 0, losses: 2 });
    expect(roundOutcome(state, 2)).toEqual({ outcome: "won", wins: 2, losses: 0 });
    // Spieler 3: eine Niederlage, ein Unentschieden.
    expect(roundOutcome(state, 3)).toEqual({ outcome: "lost", wins: 0, losses: 1 });
  });

  it("R-10.6: ein Sieg und eine Niederlage ergeben eine neutrale Runde", () => {
    const state = emptyBoard();
    state.frontResults = [result(state, 0, 1, { winner: 0 }), result(state, 3, 0, { winner: 3 })];
    expect(roundOutcome(state, 0)).toEqual({ outcome: "neutral", wins: 1, losses: 1 });
  });

  it("R-10.6: Unentschieden und Fronten ohne Kampf sind neutral; Ergebnisse früherer Runden zählen nicht", () => {
    const state = emptyBoard();
    state.frontResults = [
      result(state, 0, 1, { winner: null }),
      result(state, 3, 0, { outcome: "noFight", winner: null, ticks: 0 }),
      { ...result(state, 0, 2, { winner: 0 }), round: state.round - 1 },
    ];
    expect(roundOutcome(state, 0)).toEqual({ outcome: "neutral", wins: 0, losses: 0 });
  });

  it("R-10.6: die Mitte zählt nicht für den Ausgang der Runde", () => {
    const state = emptyBoard();
    state.centerResult = centerResult(state, { players: [0], outcome: "uncontested", holder: 0 });
    expect(roundOutcome(state, 0).outcome).toBe("neutral");
  });

  it("R-10.6/R-2.5: bei 2 Spielern zählen beide Fronten, zwei Siege = gewonnen", () => {
    const state = emptyBoard();
    state.frontResults = [result(state, 0, 2, { winner: 0 }), result(state, 2, 0, { winner: 0 })];
    expect(roundOutcome(state, 0)).toEqual({ outcome: "won", wins: 2, losses: 0 });
    expect(roundOutcome(state, 2)).toEqual({ outcome: "lost", wins: 0, losses: 2 });
  });
});

describe("R-10.6: Bonusgold der Serien", () => {
  it("R-10.6: Serie 1 → 0, 2 → +1, 3–4 → +2, ≥ 5 → +3", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((s) => streakGold(data.config, s))).toEqual([0, 0, 1, 2, 2, 3, 3, 3]);
  });

  it("R-10.6: die Stufen kommen aus config.streakGold", () => {
    const config: ConfigData = { ...data.config, streakGold: [{ minStreak: 1, gold: 4 }, { minStreak: 4, gold: 9 }] };
    expect([0, 1, 3, 4, 7].map((s) => streakGold(config, s))).toEqual([0, 4, 4, 9, 9]);
  });

  for (const [before, gold] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [7, 3],
  ] as const) {
    it(`R-10.6: Siegesserie ${before} → ${before + 1} bringt ${gold} Gold sofort in die Schatzkammer`, () => {
      const state = emptyBoard();
      const p = getPlayer(state, 0);
      p.winStreak = before;
      const treasury = p.treasury;
      state.frontResults = [result(state, 0, 1, { winner: 0 })];
      resolveStreaks(state, data);
      expect(p.winStreak).toBe(before + 1);
      expect(p.lossStreak).toBe(0);
      expect(p.treasury).toBe(treasury + gold);
      const streak = eventsOf(state, "streak_gold").filter((e) => e.player === 0);
      expect(streak).toEqual(gold > 0 ? [expect.objectContaining({ kind: "win", streak: before + 1, amount: gold })] : []);
    });

    it(`R-10.6: Niederlagenserie ${before} → ${before + 1} bringt ebenso ${gold} Gold`, () => {
      const state = emptyBoard();
      const p = getPlayer(state, 1);
      p.lossStreak = before;
      const treasury = p.treasury;
      state.frontResults = [result(state, 0, 1, { winner: 0 })];
      resolveStreaks(state, data);
      expect(p.lossStreak).toBe(before + 1);
      expect(p.winStreak).toBe(0);
      expect(p.treasury).toBe(treasury + gold);
    });
  }

  it("R-10.6: eine gewonnene Runde beendet die Niederlagenserie und umgekehrt", () => {
    const state = emptyBoard();
    getPlayer(state, 0).lossStreak = 4;
    getPlayer(state, 1).winStreak = 6;
    state.frontResults = [result(state, 0, 1, { winner: 0 })];
    resolveStreaks(state, data);
    expect([getPlayer(state, 0).winStreak, getPlayer(state, 0).lossStreak]).toEqual([1, 0]);
    expect([getPlayer(state, 1).winStreak, getPlayer(state, 1).lossStreak]).toEqual([0, 1]);
    // Neue Serien der Länge 1 bringen kein Gold.
    expect(eventsOf(state, "streak_gold")).toEqual([]);
  });

  it("R-10.6: neutrale Runde – Serie bleibt unverändert, ihr Bonusgold gibt es trotzdem (F49)", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 2);
    p.winStreak = 3;
    const treasury = p.treasury;
    state.frontResults = [result(state, 1, 2, { winner: null })];
    resolveStreaks(state, data);
    expect(p.winStreak).toBe(3);
    expect(p.lossStreak).toBe(0);
    expect(p.treasury).toBe(treasury + 2);
    expect(eventsOf(state, "round_outcome").find((e) => e.player === 2)).toEqual(
      expect.objectContaining({ outcome: "neutral", wins: 0, losses: 0, winStreak: 3, lossStreak: 0 }),
    );
  });

  it("R-10.6: ohne Serie gibt es in einer neutralen Runde nichts", () => {
    const state = emptyBoard();
    resolveStreaks(state, data);
    for (const p of PLAYER_INDICES) {
      expect(getPlayer(state, p).winStreak).toBe(0);
      expect(getPlayer(state, p).lossStreak).toBe(0);
    }
    expect(eventsOf(state, "round_outcome").map((e) => e.outcome)).toEqual(["neutral", "neutral", "neutral", "neutral"]);
    expect(eventsOf(state, "streak_gold")).toEqual([]);
  });

  it("R-10.6: ausgeschiedene Spieler haben keinen Rundenausgang und bekommen kein Gold", () => {
    const state = emptyBoard();
    const p = getPlayer(state, 1);
    p.eliminated = true;
    p.lossStreak = 4;
    state.frontResults = [result(state, 0, 1, { winner: 0 })];
    resolveStreaks(state, data);
    expect(p.lossStreak).toBe(4);
    expect(eventsOf(state, "round_outcome").map((e) => e.player)).toEqual([0, 2, 3]);
  });

  it("R-10.6/R-10.3: Ereignisse round_outcome → streak_gold → gold_gained je Spieler", () => {
    const state = emptyBoard();
    getPlayer(state, 0).winStreak = 1;
    state.frontResults = [result(state, 0, 1, { winner: 0 })];
    resolveStreaks(state, data);
    const i = state.log.findIndex((e) => e.type === "round_outcome" && e.player === 0);
    expect(state.log.slice(i, i + 3).map((e) => e.type)).toEqual(["round_outcome", "streak_gold", "gold_gained"]);
    expect(state.log[i + 2]).toEqual(expect.objectContaining({ player: 0, amount: 1 }));
  });

  it("R-10.6: im Rundenablauf – drei Siege an einer leeren Front ergeben Serie 3 und zusammen 3 Bonusgold", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "recruit");
    for (let i = 0; i < 3; i += 1) playRound(state);
    const p0 = getPlayer(state, 0);
    const p1 = getPlayer(state, 1);
    expect(p0.winStreak).toBe(3);
    expect(p1.lossStreak).toBe(3);
    expect(getPlayer(state, 2).winStreak + getPlayer(state, 2).lossStreak).toBe(0);
    const gold = (player: PlayerIndex): number[] =>
      eventsOf(state, "streak_gold")
        .filter((e) => e.player === player)
        .map((e) => e.amount);
    expect(gold(0)).toEqual([1, 2]);
    expect(gold(1)).toEqual([1, 2]);
    for (const e of eventsOf(state, "round_outcome")) expect(e.phase).toBe("combatResolution");
  });

  it("R-10.6/R-1.8: Determinismus über mehrere Runden", () => {
    const run = (): GameState => {
      const state = emptyBoard(77);
      placeUnit(state, 0, front("right", 2, 0), "recruit");
      placeUnit(state, 1, front("left", 2, 0), "squire");
      placeUnit(state, 2, front("right", 1, 0), "recruit");
      for (let i = 0; i < 4; i += 1) playRound(state);
      return state;
    };
    expect(run().log).toEqual(run().log);
  });
});

describe("R-10.8: Anführer-XP für einen überlebten Kampf", () => {
  it("R-10.8: Teilnahme und Überleben → +1 XP (Wert aus config.leader.xpPerSurvivedFight)", () => {
    const state = emptyBoard();
    expect(data.config.leader.xpPerSurvivedFight).toBe(1);
    const leader = leaderOf(state, 0).id;
    state.frontResults = [result(state, 0, 1, { winner: 0, participants: [leader], survivors: [leader] })];
    grantLeaderFightXp(state, data);
    expect(getPlayer(state, 0).leader.xp).toBe(1);
    expect(eventsOf(state, "leader_xp_gained")).toEqual([expect.objectContaining({ player: 0, amount: 1, xp: 1 })]);
  });

  it("R-10.8: auch bei Niederlage oder Unentschieden, solange der Anführer überlebt", () => {
    const state = emptyBoard();
    const a = leaderOf(state, 0).id;
    const b = leaderOf(state, 1).id;
    state.frontResults = [result(state, 0, 1, { winner: 1, participants: [a, b], survivors: [a, b] })];
    grantLeaderFightXp(state, data);
    expect(getPlayer(state, 0).leader.xp).toBe(1);
    expect(getPlayer(state, 1).leader.xp).toBe(1);
  });

  it("R-10.8: ein im Kampf gestorbener Anführer bekommt nichts", () => {
    const state = emptyBoard();
    const a = leaderOf(state, 0).id;
    const b = leaderOf(state, 1).id;
    state.frontResults = [result(state, 0, 1, { winner: 1, participants: [a, b], survivors: [b] })];
    grantLeaderFightXp(state, data);
    expect(getPlayer(state, 0).leader.xp).toBe(0);
    expect(getPlayer(state, 1).leader.xp).toBe(1);
  });

  it("R-10.8: ohne Teilnahme (Reserve) keine XP", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 0), "recruit");
    playRound(state);
    expect(eventsOf(state, "leader_xp_gained").filter((e) => e.phase === "combatResolution")).toEqual([]);
  });

  it("R-10.8: in der Mitte, auch unbestritten (F49)", () => {
    const state = emptyBoard();
    const leader = leaderOf(state, 2).id;
    state.centerResult = centerResult(state, { players: [2], outcome: "uncontested", holder: 2, participants: [leader], survivors: [leader] });
    grantLeaderFightXp(state, data);
    expect(getPlayer(state, 2).leader.xp).toBe(1);
  });

  it("R-10.8: Ergebnisse früherer Runden und ausgeschiedene Spieler zählen nicht", () => {
    const state = emptyBoard();
    const a = leaderOf(state, 0).id;
    const c = leaderOf(state, 3).id;
    getPlayer(state, 3).eliminated = true;
    state.frontResults = [
      { ...result(state, 0, 1, { winner: 0, participants: [a], survivors: [a] }), round: state.round - 1 },
      result(state, 3, 0, { winner: 3, participants: [c], survivors: [c] }),
    ];
    grantLeaderFightXp(state, data);
    expect(getPlayer(state, 0).leader.xp).toBe(0);
    expect(getPlayer(state, 3).leader.xp).toBe(0);
  });

  it("R-10.8: Wert 0 in der Konfiguration schaltet die XP ab", () => {
    const state = emptyBoard();
    const leader = leaderOf(state, 0).id;
    const config: ConfigData = { ...data.config, leader: { ...data.config.leader, xpPerSurvivedFight: 0 } };
    state.frontResults = [result(state, 0, 1, { winner: 0, participants: [leader], survivors: [leader] })];
    grantLeaderFightXp(state, { ...data, config });
    expect(getPlayer(state, 0).leader.xp).toBe(0);
  });

  it("R-10.8/R-12.3: im Rundenablauf – Anführer an der leeren Front: +1 in der Kampfauswertung, +2 am Rundenende", () => {
    const state = emptyBoard();
    // Spieler 0 stellt seinen Anführer an die rechte Front, gegenüber steht niemand.
    leaderOf(state, 0).location = front("right", 2, 1);
    playRound(state);
    const xp = eventsOf(state, "leader_xp_gained").filter((e) => e.player === 0);
    expect(xp.map((e) => [e.phase, e.amount])).toEqual([
      ["combatResolution", 1],
      ["cleanup", data.config.leader.xpPerRound],
    ]);
    expect(getPlayer(state, 0).leader.xp).toBe(1 + data.config.leader.xpPerRound);
    expect(getPlayer(state, 1).leader.xp).toBe(data.config.leader.xpPerRound);
  });

  it("R-10.8: Reihenfolge in der Kampfauswertung – nach Schwung und Trotz", () => {
    const state = emptyBoard();
    leaderOf(state, 0).location = front("right", 2, 1);
    playRound(state);
    const types = state.log.filter((e) => e.round === 1 && e.phase === "combatResolution").map((e) => e.type);
    const lastOutcome = types.lastIndexOf("round_outcome");
    expect(types.indexOf("leader_xp_gained")).toBeGreaterThan(lastOutcome);
  });
});
