import { describe, expect, it } from "vitest";
import { runCombatPhase } from "./center";
import { createCombat, stepCombat } from "./combat";
import { loadGameData } from "./data";
import { effectHooks } from "./effects";
import { fighterForUnit } from "./fronts";
import { frontArenaSize } from "./hex";
import { addRoundMark } from "./marks";
import { activeResonance, resonanceCounts, resonanceSummonAdjuster, resonanceTier } from "./resonance";
import { advance } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();
const manaMax = data.config.combat.defaultManaMax;

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
  state.units[id] = {
    id,
    owner: player,
    kind,
    sourceId,
    cardInstanceIds,
    stars: 1,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location,
  };
  return id;
}

function leaderTo(state: GameState, player: PlayerIndex, location: UnitLocation): UnitId {
  const id = getPlayer(state, player).leader.unitId;
  (state.units[id] as Unit).location = location;
  return id;
}

function unit(state: GameState, id: UnitId): Unit {
  return state.units[id] as Unit;
}

function fighter(state: GameState, id: UnitId) {
  return fighterForUnit(state, data, unit(state, id), { col: 0, row: 0 });
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("Rassen-Resonanz: Zählung (E10c1, R-17.1)", () => {
  it("R-17.1: gezählt werden verschiedene Karten-IDs, Kopien zählen einmal", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 0), "spark_rider");
    placeUnit(state, 0, front("left", 1, 0), "spark_rider");
    placeUnit(state, 0, front("right", 0, 0), "spark_rider");
    expect(resonanceCounts(state, data, 0).get("goblin")).toBe(1);
    placeUnit(state, 0, front("right", 1, 0), "tinker");
    expect(resonanceCounts(state, data, 0).get("goblin")).toBe(2);
  });

  it("R-17.1: left, right und center zählen zusammen, die Reserve nicht", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 0), "spark_rider");
    placeUnit(state, 0, front("right", 0, 0), "tinker");
    placeUnit(state, 0, center(0), "goblin_skirmisher");
    expect(resonanceCounts(state, data, 0).get("goblin")).toBe(3);
    placeUnit(state, 1, { zone: "reserve", slot: 1 }, "spark_rider");
    placeUnit(state, 1, { zone: "reserve", slot: 2 }, "tinker");
    expect(resonanceCounts(state, data, 1).get("goblin")).toBeUndefined();
  });

  it("R-17.1: verwundete Einheiten und Tokens zählen nicht, der Anführer zählt", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 2, front("left", 0, 0), "spark_rider");
    placeUnit(state, 2, front("left", 1, 0), "goblin_token", "token");
    expect(resonanceCounts(state, data, 2).get("goblin")).toBe(1);
    leaderTo(state, 2, front("left", 2, 0)); // Vex ist Goblin
    expect(resonanceCounts(state, data, 2).get("goblin")).toBe(2);
    unit(state, rider).wounded = true;
    expect(resonanceCounts(state, data, 2).get("goblin")).toBe(1);
  });

  it("R-17.1: Stufe ist die höchste erreichte Schwelle laut Daten", () => {
    expect(resonanceTier(data, "goblin", 0)).toBe(0);
    expect(resonanceTier(data, "goblin", 1)).toBe(0);
    expect(resonanceTier(data, "goblin", 2)).toBe(2);
    expect(resonanceTier(data, "goblin", 3)).toBe(2);
    expect(resonanceTier(data, "goblin", 4)).toBe(4);
    expect(resonanceTier(data, "unknown", 4)).toBe(0);
  });

  it("R-17.1: ausgeschiedene Spieler haben keine Resonanz", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 0), "spark_rider");
    placeUnit(state, 0, front("left", 1, 0), "tinker");
    getPlayer(state, 0).eliminated = true;
    expect(activeResonance(state, data, 0)).toEqual([]);
  });
});

describe("Rassen-Resonanz: Kampfboni (E10c1, R-17.2)", () => {
  it("R-17.2: Goblins 2: +1 Durchbruch für alle Goblins des Spielers, andere Einheiten unverändert", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 0, front("left", 0, 0), "spark_rider");
    const tinker = placeUnit(state, 0, center(0), "tinker");
    const recruit = placeUnit(state, 0, front("left", 1, 0), "recruit");
    const enemyRider = placeUnit(state, 1, front("right", 0, 0), "spark_rider");
    expect(fighter(state, rider).stats.breakthrough).toBe(3 + 1);
    expect(fighter(state, tinker).stats.breakthrough).toBe(0 + 1);
    expect(fighter(state, recruit).stats.breakthrough).toBe(1);
    expect(fighter(state, enemyRider).stats.breakthrough).toBe(3);
  });

  it("R-17.2: Goblins 4: +2 Durchbruch (ersetzt Stufe 2, nicht zusätzlich)", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 2, front("left", 0, 0), "spark_rider");
    placeUnit(state, 2, front("left", 1, 0), "tinker");
    placeUnit(state, 2, front("right", 0, 0), "goblin_skirmisher");
    const vex = leaderTo(state, 2, front("right", 1, 0));
    expect(resonanceCounts(state, data, 2).get("goblin")).toBe(4);
    expect(fighter(state, rider).stats.breakthrough).toBe(3 + 2);
    const vexBase = data.leaders.get("vex")?.stats.breakthrough ?? 0;
    expect(fighter(state, vex).stats.breakthrough).toBe(vexBase + 2);
  });

  it("R-17.2: Tokens der Rasse bekommen die Boni, zählen aber nicht", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("left", 0, 0), "spark_rider");
    placeUnit(state, 0, front("left", 1, 0), "tinker");
    const token = placeUnit(state, 0, front("left", 2, 0), "goblin_token", "token");
    expect(fighter(state, token).stats.breakthrough).toBe(1 + 1);
  });

  it("R-17.2: im Kampf erzeugte Tokens (Kesselflicker) bekommen die Boni ihres Besitzers", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 0, front("right", 0, 0), "spark_rider");
    const tinker = placeUnit(state, 0, front("right", 2, 0), "tinker");
    const enemy = placeUnit(state, 1, front("left", 2, 0), "squire");
    const inits = [
      fighterForUnit(state, data, unit(state, rider), { col: 0, row: 0 }),
      fighterForUnit(state, data, unit(state, tinker), { col: 2, row: 0 }),
      fighterForUnit(state, data, unit(state, enemy), { col: 2, row: 5 }),
    ];
    const fx = effectHooks(data, { adjustSummon: resonanceSummonAdjuster(state, data) });
    const sim = createCombat(data.config, frontArenaSize(data.config.arenas.frontZone), inits, fx.hooks, state.nextUnitId);
    stepCombat(sim);
    const token = sim.fighters.find((f) => f.sourceId === "goblin_token");
    expect(token?.breakthrough).toBe(1 + 1);
  });

  it("R-17.2: Zwerge 2: +1 Panzer für Zwerge (auch ohne eigenen Panzer)", () => {
    const state = emptyBoard();
    const veteran = placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    const smith = placeUnit(state, 0, front("left", 1, 0), "runesmith");
    expect(fighter(state, veteran).stats.armor).toBe(1 + 1);
    expect(fighter(state, smith).stats.armor).toBe(0 + 1);
    expect(fighter(state, veteran).keywords ?? []).not.toContain("unwoundable");
  });

  it("R-17.2: Zwerge 4: +2 Panzer und unverwundbar für die Runde", () => {
    const state = emptyBoard();
    const veteran = placeUnit(state, 0, front("left", 0, 0), "shieldwall_veteran");
    placeUnit(state, 0, front("left", 1, 0), "runesmith");
    placeUnit(state, 0, front("right", 0, 0), "thunder_gun");
    const brann = leaderTo(state, 0, front("right", 1, 0));
    expect(fighter(state, veteran).stats.armor).toBe(1 + 2);
    expect(fighter(state, veteran).keywords).toContain("unwoundable");
    expect(fighter(state, brann).keywords).toContain("unwoundable");
    const brannArmor = data.leaders.get("brann")?.stats.armor ?? 0;
    expect(fighter(state, brann).stats.armor).toBe(brannArmor + 2);
  });

  it("R-17.2: Elfen 2: 30 % Start-Mana für Elfen", () => {
    const state = emptyBoard();
    const ranger = placeUnit(state, 1, front("left", 0, 0), "ranger");
    const priestess = placeUnit(state, 1, front("left", 1, 0), "moon_priestess");
    const rangerMax = fighter(state, ranger).stats.manaMax ?? manaMax;
    expect(fighter(state, ranger).startMana).toBe(Math.floor((rangerMax * 30) / 100));
    expect(fighter(state, priestess).startMana).toBeGreaterThan(0);
  });

  it("R-17.2: Elfen 4: 60 % Start-Mana, zusammen mit Markierungen (R-17a.2) addiert", () => {
    const state = emptyBoard();
    const ranger = placeUnit(state, 1, front("left", 0, 0), "ranger");
    placeUnit(state, 1, front("left", 1, 0), "moon_priestess");
    placeUnit(state, 1, front("right", 0, 0), "blade_dancer");
    leaderTo(state, 1, front("right", 1, 0)); // Ilyra ist Elfe
    const max = fighter(state, ranger).stats.manaMax ?? manaMax;
    expect(fighter(state, ranger).startMana).toBe(Math.floor((max * 60) / 100));
    addRoundMark(state, 1, { kind: "startMana", round: state.round, percent: 50, target: "ownClassUnits", classId: "mage" });
    expect(fighter(state, ranger).startMana).toBe(Math.floor((max * 110) / 100));
  });

  it("R-17.2: Menschen 2 und 4 haben keine Kampfwerte, die Stufe wird aber erkannt", () => {
    const state = emptyBoard();
    const merc = placeUnit(state, 3, front("left", 0, 0), "mercenary");
    placeUnit(state, 3, front("left", 1, 0), "curse_weaver");
    expect(activeResonance(state, data, 3).map((t) => [t.race, t.tier])).toEqual([["human", 2]]);
    expect(fighter(state, merc).stats).toEqual({ attack: 2, hp: 4, breakthrough: 1, range: 1 });
    placeUnit(state, 3, front("right", 0, 0), "bounty_hunter");
    leaderTo(state, 3, front("right", 1, 0)); // Morgra ist Mensch
    expect(activeResonance(state, data, 3).map((t) => [t.race, t.tier])).toEqual([["human", 4]]);
  });

  it("R-17.2: Kampfphase meldet die Resonanz je Spieler und wirkt im Frontkampf (leere Front: Durchbruch mit Bonus)", () => {
    const state = emptyBoard();
    const rider = placeUnit(state, 0, front("right", 0, 0), "spark_rider");
    const tinker = placeUnit(state, 0, front("right", 1, 0), "tinker");
    const from = state.log.length;
    runCombatPhase(state, data);
    const announced = eventsOf(state, "resonance_active", from);
    expect(announced).toEqual([
      expect.objectContaining({ type: "resonance_active", player: 0, race: "goblin", count: 2, tier: 2, unitIds: [rider, tinker] }),
    ]);
    const result = state.frontResults.find((r) => r.first === 0 && r.outcome === "emptyFront");
    expect(result?.winnerBreakthrough).toBe(3 + 1 + 0 + 1);
  });

  it("R-17.2: Resonanz gilt in allen Kämpfen der Runde, auch in der Mitte", () => {
    const state = emptyBoard();
    placeUnit(state, 0, front("right", 0, 0), "spark_rider");
    const centerTinker = placeUnit(state, 0, center(0), "tinker");
    placeUnit(state, 1, center(0), "squire");
    const from = state.log.length;
    runCombatPhase(state, data);
    const started = eventsOf(state, "combat_started", from).find((e) => e.arena === "center");
    expect(started?.fighters.map((f) => f.unitId)).toContain(centerTinker);
    const announced = eventsOf(state, "resonance_active", from);
    expect(announced[0]?.unitIds).toContain(centerTinker);
  });

  it("R-17.2: Determinismus: gleicher Seed und gleiche Aufstellung ergeben dasselbe Protokoll", () => {
    const build = (): GameState => {
      const state = emptyBoard(5);
      placeUnit(state, 0, front("right", 0, 0), "spark_rider");
      placeUnit(state, 0, front("right", 2, 0), "tinker");
      placeUnit(state, 1, front("left", 0, 0), "ranger");
      placeUnit(state, 1, front("left", 2, 0), "moon_priestess");
      placeUnit(state, 1, front("left", 1, 1), "shieldwall_veteran");
      runCombatPhase(state, data);
      return state;
    };
    expect(build().log).toEqual(build().log);
  });
});
