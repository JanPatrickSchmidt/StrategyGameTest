import { describe, expect, it } from "vitest";
import { CENTER_ARENA_ID, centerParticipants, runCenter, runCombatPhase } from "./center";
import { type GameData, loadGameData } from "./data";
import { centerPositionToArena } from "./hex";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();

const center = (position: number): UnitLocation => ({ zone: "center", position });
const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in die Reserve gestellt (leeres Brett). */
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

function centerEvents(state: GameState): GameEvent[] {
  return state.log.filter((e) => (e as { arena?: string }).arena === CENTER_ARENA_ID);
}

function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  advance(state, data);
}

function withMaxTicks(maxTicks: number): GameData {
  return { ...data, config: { ...data.config, combat: { ...data.config.combat, maxTicks } } };
}

describe("Teilnehmer der Mitte (R-9.1)", () => {
  it("R-9.1: alle nicht verwundeten Einheiten aller Mittelzonen, inklusive Anführer und Tokens", () => {
    const state = emptyBoard();
    leaderUnit(state, 2).location = center(4);
    const a = placeUnit(state, 0, center(0));
    placeUnit(state, 0, center(1), "recruit", { wounded: true });
    placeUnit(state, 0, front("right", 1, 2));
    placeUnit(state, 0, { zone: "reserve", slot: 1 });
    const b = placeUnit(state, 1, center(2), "goblin_token", { kind: "token" });
    const c = placeUnit(state, 3, center(3));
    expect(centerParticipants(state).map((u) => u.id)).toEqual([leaderUnit(state, 2).id, a, b, c].sort((x, y) => x - y));
  });

  it("R-9.1: Einheiten ausgeschiedener Spieler nehmen nicht teil", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 0, center(0));
    placeUnit(state, 1, center(0));
    getPlayer(state, 1).eliminated = true;
    expect(centerParticipants(state).map((u) => u.id)).toEqual([a]);
  });

  it("R-9.1: hat niemand Einheiten in der Mitte, gibt es keinen Kampf und keinen Halter", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(1), "recruit", { wounded: true });
    const res = runCenter(state, data);
    expect(res).toMatchObject({ outcome: "noFight", holder: null, players: [], participants: [], survivors: [], ticks: 0 });
    expect(eventsOf(state, "combat_started")).toHaveLength(0);
    expect(eventsOf(state, "center_resolved")).toEqual([
      expect.objectContaining({ arena: CENTER_ARENA_ID, outcome: "noFight", holder: null }),
    ]);
  });

  it("R-9.1: hat nur ein Spieler Einheiten in der Mitte, hält er sie ohne Simulation", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 2, center(0));
    const b = placeUnit(state, 2, center(3), "bounty_hunter");
    placeUnit(state, 1, center(2), "recruit", { wounded: true });
    const res = runCenter(state, data);
    expect(res).toMatchObject({ outcome: "uncontested", holder: 2, players: [2], participants: [a, b], survivors: [a, b], ticks: 0 });
    expect(eventsOf(state, "combat_started")).toHaveLength(0);
  });
});

describe("Mittelkampf (R-3.4, R-9.4, R-9.7)", () => {
  it("R-3.4: Einheiten starten auf den Feldern ihres Sitzes in der Mittelarena", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 0, center(2));
    const b = placeUnit(state, 1, center(0));
    const c = placeUnit(state, 3, center(4));
    runCenter(state, data);
    const started = eventsOf(state, "combat_started");
    expect(started).toHaveLength(1);
    const { centerArena, centerStartSlots } = data.config.arenas;
    expect(started[0]).toMatchObject({
      arena: CENTER_ARENA_ID,
      players: [0, 1, 3],
      fighters: [
        { unitId: a, player: 0, cell: centerPositionToArena(0, 2, centerArena, centerStartSlots) },
        { unitId: b, player: 1, cell: centerPositionToArena(1, 0, centerArena, centerStartSlots) },
        { unitId: c, player: 3, cell: centerPositionToArena(3, 4, centerArena, centerStartSlots) },
      ],
    });
  });

  it("R-9.4: in der Mitte kämpft jeder gegen jeden; Ziel ist die nächste Einheit eines beliebigen anderen Spielers", () => {
    const state = emptyBoard();
    // Sitz 0, Position 2 = (3,0); Sitz 1, Position 0 = (6,1) ist näher als Sitz 2, Position 2 = (3,6).
    const a = placeUnit(state, 0, center(2));
    const b = placeUnit(state, 1, center(0));
    const c = placeUnit(state, 2, center(2));
    runCenter(state, data);
    const firstTarget = (unit: UnitId): UnitId | undefined =>
      eventsOf(state, "combat_target_changed").find((e) => e.unit === unit)?.target;
    expect(firstTarget(a)).toBe(b);
    const owner = (id: UnitId): PlayerIndex => (state.units[id] as Unit).owner;
    expect(owner(firstTarget(c) as UnitId)).not.toBe(2);
    // Keine Einheit greift eine Einheit desselben Spielers an.
    for (const e of eventsOf(state, "combat_attack")) expect(owner(e.unit)).not.toBe(owner(e.target));
  });

  it("R-9.4: Einheiten desselben Spielers kämpfen in der Mitte zusammen", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(1), "bounty_hunter");
    placeUnit(state, 0, center(3), "bounty_hunter");
    placeUnit(state, 1, center(2));
    const res = runCenter(state, data);
    expect(res.outcome).toBe("combat");
    expect(res.holder).toBe(0);
  });

  it("R-9.7: Halter ist der einzige Spieler mit lebenden Einheiten; Überlebende stehen im Ergebnis", () => {
    const state = emptyBoard();
    const hunter = placeUnit(state, 0, center(2), "bounty_hunter");
    const r1 = placeUnit(state, 1, center(0));
    const r2 = placeUnit(state, 2, center(2));
    const res = runCenter(state, data);
    expect(res).toMatchObject({ outcome: "combat", holder: 0, players: [0, 1, 2], participants: [hunter, r1, r2] });
    expect(res.survivors.every((id) => (state.units[id] as Unit).owner === 0)).toBe(true);
    expect(res.ticks).toBeGreaterThan(0);
    const resolved = eventsOf(state, "center_resolved");
    expect(resolved).toEqual([expect.objectContaining({ outcome: "combat", holder: 0, survivors: res.survivors })]);
    const ended = centerEvents(state).find((e) => e.type === "combat_ended");
    expect(ended).toMatchObject({ winner: 0 });
  });

  it("R-9.7: leben nach dem letzten Tick noch mehrere Spieler, gibt es keinen Halter", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2), "bounty_hunter");
    placeUnit(state, 1, center(0), "shieldwall_veteran");
    placeUnit(state, 2, center(2), "shieldwall_veteran");
    const res = runCenter(state, withMaxTicks(1));
    expect(res).toMatchObject({ outcome: "combat", holder: null, ticks: 1 });
    expect(new Set(res.survivors.map((id) => (state.units[id] as Unit).owner)).size).toBeGreaterThan(1);
  });
});

describe("Kampfphase mit Mitte (R-9, R-1.4)", () => {
  it("R-9: die Rundenmaschine lässt in der Kampfphase auch die Mitte kämpfen und legt das Ergebnis ab", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2), "bounty_hunter");
    placeUnit(state, 3, center(2));
    playRound(state);
    expect(state.centerResult).toMatchObject({ round: 1, outcome: "combat", holder: 0 });
    expect(eventsOf(state, "center_resolved")).toHaveLength(1);
    for (const e of centerEvents(state)) expect((e as { arena: string }).arena).toBe(CENTER_ARENA_ID);
  });

  it("R-9: Fronten und Mitte nutzen denselben Ausgangszustand, Einheiten bleiben unverändert", () => {
    const state = emptyBoard();
    // Einheit von Spieler 1 kämpft vorn; dieselben Ausgangswerte gelten für die Mitte.
    placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    placeUnit(state, 1, front("left", 2, 2));
    placeUnit(state, 1, center(2), "bounty_hunter");
    placeUnit(state, 2, center(2));
    const before = JSON.stringify(state.units);
    const { fronts, center: res } = runCombatPhase(state, data);
    expect(JSON.stringify(state.units)).toBe(before);
    expect(fronts.find((r) => r.arena === "front:0-1")?.winner).toBe(0);
    expect(res.holder).toBe(1);
    expect(state.frontResults).toBe(fronts);
    expect(state.centerResult).toBe(res);
  });

  it("R-9.6: eine in der Mitte gestorbene Karten-Einheit steht nach dem Kampf wieder in ihrer Mittelzone", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2), "bounty_hunter");
    const recruit = placeUnit(state, 1, center(1));
    playRound(state);
    expect(state.centerResult?.survivors).not.toContain(recruit);
    expect(state.units[recruit]?.location).toEqual(center(1));
  });

  it("R-1.4: Tokens verschwinden nach dem Mittelkampf, auch wenn ihr Spieler ohne Simulation hält", () => {
    const state = emptyBoard();
    const token = placeUnit(state, 0, center(0), "goblin_token", { kind: "token" });
    const res = runCombatPhase(state, data).center;
    expect(res).toMatchObject({ outcome: "uncontested", holder: 0, survivors: [token] });
    expect(state.units[token]).toBeUndefined();
    expect(eventsOf(state, "token_removed").map((e) => e.unitId)).toEqual([token]);
  });

  it("R-1.4: Tokens aus Front und Mitte werden nach allen Kämpfen gemeinsam entfernt", () => {
    const state = emptyBoard();
    const t1 = placeUnit(state, 0, front("right", 0, 2), "goblin_token", { kind: "token" });
    const t2 = placeUnit(state, 2, center(0), "goblin_token", { kind: "token" });
    placeUnit(state, 3, center(1));
    runCombatPhase(state, data);
    const removed = eventsOf(state, "token_removed");
    expect(removed.map((e) => e.unitId)).toEqual([t1, t2]);
    // Entfernt wird erst, nachdem beide Kämpfe protokolliert sind.
    const lastResolved = state.log.findIndex((e) => e.type === "center_resolved");
    const firstRemoved = state.log.findIndex((e) => e.type === "token_removed");
    expect(firstRemoved).toBeGreaterThan(lastResolved);
  });
});

describe("Determinismus (R-1.8)", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben über eine Runde mit Mittelkampf dasselbe Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(42);
      placeUnit(state, 0, center(1), "blade_dancer");
      placeUnit(state, 0, center(3), "ranger");
      placeUnit(state, 1, center(2), "shieldwall_veteran");
      placeUnit(state, 2, center(0), "apprentice");
      leaderUnit(state, 3).location = center(2);
      playRound(state);
      return state;
    };
    const a = build();
    const b = build();
    expect(eventsOf(a, "combat_started").some((e) => e.arena === CENTER_ARENA_ID)).toBe(true);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(a.centerResult).toEqual(b.centerResult);
  });
});
