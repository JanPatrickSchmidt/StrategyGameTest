import { describe, expect, it } from "vitest";
import { fighterFromData } from "./combat";
import { loadGameData } from "./data";
import { fighterForUnit, frontArenaId, frontPairings, frontParticipants, runFrontCombats } from "./fronts";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in die Reserve gestellt (leere Fronten). */
function emptyBoard(seed = 5): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const leader = state.units[getPlayer(state, p).leader.unitId] as Unit;
    leader.location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(
  state: GameState,
  player: PlayerIndex,
  location: UnitLocation,
  sourceId = "recruit",
  extra: Partial<Unit> = {},
): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  const kind = extra.kind ?? "card";
  if (kind === "card") state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = {
    id,
    owner: player,
    kind,
    sourceId,
    cardInstanceIds: kind === "card" ? [instance] : [],
    stars: 1,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location,
    ...extra,
  };
  return id;
}

function leaderUnit(state: GameState, player: PlayerIndex): Unit {
  return state.units[getPlayer(state, player).leader.unitId] as Unit;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

describe("Paarungen (R-2.3, R-2.4, R-2.5)", () => {
  it("R-2.3: bei 4 Spielern kämpft jede rechte Zone gegen die linke Zone des rechten Nachbarn", () => {
    const state = emptyBoard();
    expect(frontPairings(state)).toEqual([
      { first: 0, second: 1 },
      { first: 1, second: 2 },
      { first: 2, second: 3 },
      { first: 3, second: 0 },
    ]);
  });

  it("R-2.4: bei 3 Spielern werden die Nachbarn im aktiven Ring neu berechnet", () => {
    const state = emptyBoard();
    getPlayer(state, 1).eliminated = true;
    expect(frontPairings(state)).toEqual([
      { first: 0, second: 2 },
      { first: 2, second: 3 },
      { first: 3, second: 0 },
    ]);
  });

  it("R-2.5: bei 2 Spielern gibt es zwei getrennte Frontkämpfe", () => {
    const state = emptyBoard();
    getPlayer(state, 1).eliminated = true;
    getPlayer(state, 3).eliminated = true;
    const pairings = frontPairings(state);
    expect(pairings).toEqual([
      { first: 0, second: 2 },
      { first: 2, second: 0 },
    ]);
    expect(new Set(pairings.map(frontArenaId)).size).toBe(2);

    const a = placeUnit(state, 0, front("right", 1, 2));
    const b = placeUnit(state, 2, front("left", 1, 2));
    const c = placeUnit(state, 2, front("right", 3, 2), "bounty_hunter");
    const d = placeUnit(state, 0, front("left", 3, 2));
    expect(frontParticipants(state, { first: 0, second: 2 })).toEqual({ first: [state.units[a]], second: [state.units[b]] });
    expect(frontParticipants(state, { first: 2, second: 0 })).toEqual({ first: [state.units[c]], second: [state.units[d]] });
  });

  it("R-2.2: ein einzelner übrig gebliebener Spieler hat keinen Frontkampf", () => {
    const state = emptyBoard();
    for (const p of [1, 2, 3] as const) getPlayer(state, p).eliminated = true;
    expect(frontPairings(state)).toEqual([]);
  });
});

describe("Teilnehmer (R-9.1)", () => {
  it("R-9.1: nur nicht verwundete Einheiten der beiden Frontzonen, inklusive Anführer", () => {
    const state = emptyBoard();
    leaderUnit(state, 0).location = front("right", 2, 1);
    const fit = placeUnit(state, 0, front("right", 0, 2));
    placeUnit(state, 0, front("right", 4, 2), "recruit", { wounded: true });
    placeUnit(state, 0, front("left", 1, 2));
    placeUnit(state, 0, { zone: "center", position: 2 });
    placeUnit(state, 0, { zone: "reserve", slot: 1 });
    const enemy = placeUnit(state, 1, front("left", 0, 0));
    placeUnit(state, 1, front("right", 0, 0));
    const parts = frontParticipants(state, { first: 0, second: 1 });
    expect(parts.first.map((u) => u.id)).toEqual([leaderUnit(state, 0).id, fit].sort((x, y) => x - y));
    expect(parts.second.map((u) => u.id)).toEqual([enemy]);
  });

  it("R-9.1: hat nur eine Seite Einheiten, gewinnt sie ohne Simulation mit allen Einheiten", () => {
    const state = emptyBoard();
    const r = placeUnit(state, 0, front("right", 0, 2));
    const b = placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    placeUnit(state, 1, front("left", 2, 2), "recruit", { wounded: true });
    const results = runFrontCombats(state, data);
    const res = results.find((x) => x.arena === "front:0-1");
    expect(res).toMatchObject({ outcome: "emptyFront", winner: 0, ticks: 0, survivors: [r, b], winnerBreakthrough: 1 + 4 });
    expect(eventsOf(state, "combat_started")).toHaveLength(0);
    expect(eventsOf(state, "front_resolved").find((e) => e.arena === "front:0-1")).toMatchObject({
      outcome: "emptyFront",
      winner: 0,
    });
  });

  it("R-9.1: haben beide Seiten keine Einheiten, findet kein Kampf statt (Unentschieden)", () => {
    const state = emptyBoard();
    const results = runFrontCombats(state, data);
    expect(results).toHaveLength(4);
    for (const res of results) {
      expect(res).toMatchObject({ outcome: "noFight", winner: null, survivors: [], winnerBreakthrough: 0 });
    }
    expect(state.log.some((e) => e.type.startsWith("combat_"))).toBe(false);
  });
});

describe("Frontkampf (R-3.2, R-9)", () => {
  it("R-3.2: die rechte Zone des ersten Spielers bleibt, die linke Zone des Gegners wird gedreht", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 0, front("right", 1, 2));
    const b = placeUnit(state, 1, front("left", 1, 2));
    runFrontCombats(state, data);
    const started = eventsOf(state, "combat_started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ arena: "front:0-1", players: [0, 1], phase: "planning" });
    expect(started[0]?.fighters).toEqual([
      { unitId: a, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 } },
      { unitId: b, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 } },
    ]);
  });

  it("R-9: der Kampf läuft in der Kampfphase, Ereignisse stehen mit Arena im Protokoll, Ergebnis für die Auswertung", () => {
    const state = emptyBoard();
    const hunter = placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    const recruit = placeUnit(state, 1, front("left", 2, 2));
    playRound(state);
    const combatEvents = state.log.filter((e) => e.type.startsWith("combat_"));
    expect(combatEvents.length).toBeGreaterThan(2);
    for (const e of combatEvents) {
      expect(e.phase).toBe("combat");
      expect(e.round).toBe(1);
      expect((e as { arena?: string }).arena).toBe("front:0-1");
    }
    expect(combatEvents.some((e) => e.type === "combat_unit_died" && e.unit === recruit)).toBe(true);
    const res = state.frontResults.find((r) => r.arena === "front:0-1");
    expect(res).toMatchObject({ round: 1, outcome: "combat", winner: 0, survivors: [hunter], winnerBreakthrough: 4 });
    expect(res?.participants).toEqual([hunter, recruit]);
    expect(res?.ticks).toBeGreaterThan(0);
  });

  it("R-9.6: eine im Kampf gestorbene Karten-Einheit steht nach dem Kampf wieder auf ihrem Feld", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    const recruit = placeUnit(state, 1, front("left", 2, 2));
    playRound(state);
    expect(state.units[recruit]?.location).toEqual(front("left", 2, 2));
    expect(state.units[recruit]?.wounded).toBe(false);
  });

  it("R-9: alle Kämpfe einer Runde nutzen denselben Ausgangszustand", () => {
    const state = emptyBoard();
    // Spieler 1 kämpft links gegen Spieler 0 und rechts gegen Spieler 2; beide Kämpfe sehen dieselbe Einheit 1.
    placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    placeUnit(state, 1, front("left", 2, 2));
    placeUnit(state, 1, front("right", 2, 2), "bounty_hunter");
    placeUnit(state, 2, front("left", 2, 2));
    const before = JSON.stringify(state.units);
    const results = runFrontCombats(state, data);
    expect(JSON.stringify(state.units)).toBe(before);
    expect(results.filter((r) => r.outcome === "combat").map((r) => r.winner)).toEqual([0, 1]);
  });

  it("R-1.4, R-9.6: Tokens verschwinden nach dem Kampf, an dem sie teilgenommen haben", () => {
    const state = emptyBoard();
    const token = placeUnit(state, 0, front("right", 0, 2), "goblin_token", { kind: "token" });
    placeUnit(state, 0, front("right", 4, 2), "bounty_hunter");
    placeUnit(state, 1, front("left", 2, 2));
    const results = runFrontCombats(state, data);
    expect(results[0]?.participants).toContain(token);
    expect(state.units[token]).toBeUndefined();
    expect(eventsOf(state, "token_removed").map((e) => e.unitId)).toEqual([token]);
  });

  it("R-10.1: Tokens zählen beim Durchbruch des Siegers mit (Ergebnis für E12)", () => {
    const state = emptyBoard();
    const token = placeUnit(state, 0, front("right", 0, 2), "goblin_token", { kind: "token" });
    const results = runFrontCombats(state, data);
    expect(results[0]).toMatchObject({ outcome: "emptyFront", winner: 0, survivors: [token], winnerBreakthrough: 1 });
  });

  it("R-16.3: ab Anführer-Stufe 3 steigen attack und hp der Anführer-Kampfeinheit um 30 % (abgerundet)", () => {
    const state = emptyBoard();
    const leader = leaderUnit(state, 0);
    const pos = { col: 0, row: 0 };
    const base = fighterFromData(data, { id: leader.id, team: 0, kind: "leader", sourceId: leader.sourceId, stars: 1, pos });
    getPlayer(state, 0).leader.level = 2;
    expect(fighterForUnit(state, data, leader, pos).stats).toEqual(base.stats);
    getPlayer(state, 0).leader.level = 3;
    const raised = fighterForUnit(state, data, leader, pos).stats;
    const bonus = data.config.leader.level3StatBonus;
    expect(raised.attack).toBe(base.stats.attack + Math.floor(base.stats.attack * bonus));
    expect(raised.hp).toBe(base.stats.hp + Math.floor(base.stats.hp * bonus));
    expect(raised.hp).toBeGreaterThan(base.stats.hp);
  });

  it("R-9.1: der Anführer kämpft in seiner Frontzone mit (Startfeld links)", () => {
    const state = createGame(data, defaultLeaders(data), 5);
    advance(state, data);
    playRound(state);
    // Alle Anführer stehen links, alle rechten Zonen sind leer: jede Front ist eine leere Front.
    for (const res of state.frontResults) {
      expect(res.outcome).toBe("emptyFront");
      expect(res.winner).toBe(res.second);
      expect(res.survivors).toEqual([leaderUnit(state, res.second).id]);
    }
  });
});

describe("Determinismus (R-1.8)", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben über eine Runde mit Kampf dasselbe Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(42);
      placeUnit(state, 0, front("right", 1, 2), "blade_dancer");
      placeUnit(state, 0, front("right", 3, 1), "ranger");
      placeUnit(state, 1, front("left", 2, 2), "shieldwall_veteran");
      placeUnit(state, 1, front("left", 0, 0), "apprentice");
      leaderUnit(state, 2).location = front("left", 2, 1);
      placeUnit(state, 1, front("right", 2, 2), "pickpocket");
      playRound(state);
      return state;
    };
    const a = build();
    const b = build();
    expect(a.log.some((e) => e.type === "combat_attack")).toBe(true);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(JSON.stringify(a.frontResults)).toBe(JSON.stringify(b.frontResults));
  });
});
