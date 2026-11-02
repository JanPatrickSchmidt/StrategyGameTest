import { describe, expect, it } from "vitest";
import { runCombatPhase } from "./center";
import { loadGameData } from "./data";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { countCombatResonance, resonanceBonusXp } from "./unitXp";

const data = loadGameData();

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const center = (position: number): UnitLocation => ({ zone: "center", position });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. Anführer: 0 Brann (Zwerg), 1 Ilyra (Elf), 2 Vex (Goblin), 3 Morgra (Mensch). */
function emptyBoard(seed = 11): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string, kind: "card" | "token" = "card"): UnitId {
  const id = state.nextUnitId++;
  const cardInstanceIds: number[] = [];
  if (kind === "card") {
    const instance = state.nextCardInstanceId++;
    state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
    cardInstanceIds.push(instance);
  }
  state.units[id] = { id, owner: player, kind, sourceId, cardInstanceIds, stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function leaderTo(state: GameState, player: PlayerIndex, location: UnitLocation): UnitId {
  const id = getPlayer(state, player).leader.unitId;
  (state.units[id] as Unit).location = location;
  return id;
}

const xpOf = (state: GameState, id: UnitId): number => (state.units[id] as Unit).xp;

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("Einheiten-XP (E10c4, R-10.7)", () => {
  it("R-10.7: eine überlebende Karten-Einheit erhält +1 XP, eine gestorbene nicht", () => {
    const state = emptyBoard();
    const hunter = placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    const recruit = placeUnit(state, 1, front("left", 2, 2), "recruit");
    const from = state.log.length;
    const { fronts } = runCombatPhase(state, data);
    const result = fronts.find((r) => r.arena === "front:0-1");
    expect(result?.winner).toBe(0);
    expect(result?.survivors).toEqual([hunter]);
    expect(xpOf(state, hunter)).toBe(1);
    expect(xpOf(state, recruit)).toBe(0);
    expect(eventsOf(state, "unit_xp_gained", from)).toEqual([
      expect.objectContaining({ player: 0, unitId: hunter, amount: 1, bonus: 0, xp: 1, arena: "front:0-1" }),
    ]);
  });

  it("R-10.7: XP werden zu vorhandenen XP addiert, die Menge kommt aus config.unitXpPerSurvivedFight", () => {
    const state = emptyBoard();
    const hunter = placeUnit(state, 0, front("right", 2, 2), "bounty_hunter");
    (state.units[hunter] as Unit).xp = 4;
    runCombatPhase(state, data);
    expect(xpOf(state, hunter)).toBe(4 + data.config.unitXpPerSurvivedFight);
  });

  it("R-10.7: Anführer und Tokens erhalten keine Einheiten-XP", () => {
    const state = emptyBoard();
    const leader = leaderTo(state, 0, front("right", 0, 0));
    const token = placeUnit(state, 0, front("right", 1, 0), "goblin_token", "token");
    const card = placeUnit(state, 0, front("right", 2, 0), "recruit");
    const leaderXpBefore = getPlayer(state, 0).leader.xp;
    const from = state.log.length;
    const { fronts } = runCombatPhase(state, data);
    expect(fronts.find((r) => r.arena === "front:0-1")?.survivors).toEqual(expect.arrayContaining([leader, token, card]));
    expect(xpOf(state, leader)).toBe(0);
    expect(getPlayer(state, 0).leader.xp).toBe(leaderXpBefore);
    expect(eventsOf(state, "unit_xp_gained", from).map((e) => e.unitId)).toEqual([card]);
  });

  it("R-10.7: bei leerer Front erhalten alle Einheiten des Siegers XP, ohne Kampf niemand", () => {
    const state = emptyBoard();
    const a = placeUnit(state, 0, front("right", 0, 0), "recruit");
    const b = placeUnit(state, 0, front("right", 1, 0), "squire");
    const reserve = placeUnit(state, 1, { zone: "reserve", slot: 1 }, "recruit");
    const { fronts } = runCombatPhase(state, data);
    expect(fronts.find((r) => r.arena === "front:0-1")?.outcome).toBe("emptyFront");
    expect(fronts.filter((r) => r.outcome === "noFight").length).toBeGreaterThan(0);
    expect([xpOf(state, a), xpOf(state, b)]).toEqual([1, 1]);
    expect(xpOf(state, reserve)).toBe(0);
  });

  it("R-10.7: auch die Mitte zählt, eine unbestrittene Mitte gibt dem Halter XP", () => {
    const state = emptyBoard();
    const unitInCenter = placeUnit(state, 2, center(0), "spark_rider");
    const { center: res } = runCombatPhase(state, data);
    expect(res).toMatchObject({ outcome: "uncontested", holder: 2 });
    expect(xpOf(state, unitInCenter)).toBe(1);
    expect(eventsOf(state, "unit_xp_gained").at(-1)).toMatchObject({ unitId: unitInCenter, arena: "center" });
  });

  it("R-10.7: verwundete Einheiten nehmen nicht teil und erhalten keine XP", () => {
    const state = emptyBoard();
    const wounded = placeUnit(state, 0, front("right", 0, 0), "recruit");
    (state.units[wounded] as Unit).wounded = true;
    placeUnit(state, 0, front("right", 1, 0), "recruit");
    runCombatPhase(state, data);
    expect(xpOf(state, wounded)).toBe(0);
  });
});

describe("Bonus-XP der Menschen (E10c4, R-17.5)", () => {
  it("R-17.5: Menschen 2: überlebende Menschen-Einheiten erhalten +1 zusätzlich, andere Rassen nicht", () => {
    const state = emptyBoard();
    const merc = placeUnit(state, 3, front("right", 0, 0), "mercenary");
    const weaver = placeUnit(state, 3, front("right", 1, 0), "curse_weaver");
    const goblin = placeUnit(state, 3, front("right", 2, 0), "spark_rider");
    const from = state.log.length;
    runCombatPhase(state, data);
    expect([xpOf(state, merc), xpOf(state, weaver), xpOf(state, goblin)]).toEqual([2, 2, 1]);
    expect(eventsOf(state, "unit_xp_gained", from).find((e) => e.unitId === merc)).toMatchObject({ amount: 2, bonus: 1, xp: 2 });
  });

  it("R-17.5: Menschen 4: +2 zusätzlich (ersetzt Stufe 2), der Anführer zählt mit, erhält aber keine Einheiten-XP", () => {
    const state = emptyBoard();
    const merc = placeUnit(state, 3, front("right", 0, 0), "mercenary");
    const weaver = placeUnit(state, 3, front("right", 1, 0), "curse_weaver");
    const hunter = placeUnit(state, 3, center(0), "bounty_hunter");
    const leader = leaderTo(state, 3, front("right", 2, 0)); // Morgra ist Mensch
    runCombatPhase(state, data);
    expect([xpOf(state, merc), xpOf(state, weaver), xpOf(state, hunter)]).toEqual([3, 3, 3]);
    expect(xpOf(state, leader)).toBe(0);
  });

  it("R-17.5: nur eine Menschen-Karte (keine Resonanz): keine Bonus-XP", () => {
    const state = emptyBoard();
    const merc = placeUnit(state, 3, front("right", 0, 0), "mercenary");
    placeUnit(state, 3, front("right", 1, 0), "mercenary"); // Kopie zählt nicht doppelt (R-17.1)
    runCombatPhase(state, data);
    expect(xpOf(state, merc)).toBe(1);
  });

  it("R-17.5: die Resonanz eines anderen Spielers hilft nicht", () => {
    const state = emptyBoard();
    placeUnit(state, 3, front("right", 0, 0), "mercenary");
    placeUnit(state, 3, front("right", 1, 0), "curse_weaver");
    const otherMerc = placeUnit(state, 2, front("right", 0, 0), "mercenary");
    runCombatPhase(state, data);
    expect(xpOf(state, otherMerc)).toBe(1);
  });

  it("R-17.5: maßgeblich ist die Resonanz zu Beginn der Kampfphase, auch wenn eine mitzählende Einheit stirbt", () => {
    const state = emptyBoard();
    // Front 3-0: Söldner (Spieler 3, rechts) stirbt gegen den Kopfgeldjäger (Spieler 0, links); die Resonanz gilt weiter.
    const weaver = placeUnit(state, 3, center(0), "curse_weaver");
    const merc = placeUnit(state, 3, front("right", 2, 2), "mercenary");
    placeUnit(state, 0, front("left", 2, 2), "bounty_hunter");
    const resonance = countCombatResonance(state, data);
    expect(resonanceBonusXp(data, state.units[weaver] as Unit, resonance.get(3) ?? [])).toBe(1);
    const { fronts } = runCombatPhase(state, data);
    expect(fronts.find((r) => r.arena === "front:3-0")?.survivors).not.toContain(merc);
    expect(xpOf(state, merc)).toBe(0);
    expect(xpOf(state, weaver)).toBe(2);
  });

  it("R-17.5: Bonus-XP über eine ganze Runde der Rundenmaschine, deterministisch", () => {
    const build = (): GameState => {
      const state = emptyBoard(7);
      placeUnit(state, 3, front("right", 0, 0), "mercenary");
      placeUnit(state, 3, front("right", 1, 0), "curse_weaver");
      placeUnit(state, 0, front("left", 0, 0), "recruit");
      for (const p of PLAYER_INDICES) submitPlanning(state, p, { play: [], buy: [], position: [] });
      advance(state, data);
      expect(state.round).toBe(2);
      return state;
    };
    const a = build();
    const b = build();
    expect(eventsOf(a, "unit_xp_gained").length).toBeGreaterThan(0);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });
});
