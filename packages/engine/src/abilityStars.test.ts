import { describe, expect, it } from "vitest";
import { type CombatEvent, type CombatSim, createCombat, type Fighter, fighterFromData, type FighterInit, stepCombat } from "./combat";
import { loadGameData } from "./data";
import type { Ability, UnitStats } from "./dataTypes";
import { effectHooks } from "./effects";
import { fighterForUnit } from "./fronts";
import { frontArenaSize, type OffsetCoord } from "./hex";
import { advance } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { getPlayer, type Unit } from "./state";

const data = loadGameData();
const SIZE = frontArenaSize(data.config.arenas.frontZone);
const at = (col: number, row: number): OffsetCoord => ({ col, row });

function card(id: number, team: number, sourceId: string, stars: 1 | 2 | 3, pos: OffsetCoord, extra: Partial<FighterInit> = {}): FighterInit {
  return { ...fighterFromData(data, { id, team, kind: "card", sourceId, stars, pos }), ...extra };
}

function dummy(id: number, team: number, pos: OffsetCoord, stats: Partial<UnitStats> = {}): FighterInit {
  return {
    id,
    team,
    sourceId: "dummy",
    behavior: "default",
    pos,
    stats: { attack: 0, hp: 50, breakthrough: 0, range: 1, ...stats },
    hasManaAbility: false,
  };
}

function run(inits: FighterInit[]): CombatSim {
  const fx = effectHooks(data);
  const sim = createCombat(data.config, SIZE, inits, fx.hooks);
  stepCombat(sim);
  return sim;
}

function get(sim: CombatSim, id: number): Fighter {
  const f = sim.fighters.find((x) => x.id === id);
  if (!f) throw new Error(`Kämpfer ${id} fehlt`);
  return f;
}

function abilityDamage(sim: CombatSim, source: number): Extract<CombatEvent, { type: "combat_damage" }>[] {
  return sim.events.filter(
    (e): e is Extract<CombatEvent, { type: "combat_damage" }> => e.type === "combat_damage" && e.kind === "ability" && e.source === source,
  );
}

describe("Sternfaktor für Fähigkeitszahlen (R-15.2)", () => {
  it.each([
    [1, 2],
    [2, 3],
    [3, 6],
  ] as const)("R-15.2: Lehrling ★%i fügt %i Fähigkeitsschaden zu", (stars, expected) => {
    const sim = run([card(1, 0, "apprentice", stars, at(2, 0), { startMana: 100 }), dummy(2, 1, at(2, 5))]);
    expect(abilityDamage(sim, 1).map((e) => e.amount)).toEqual([expected]);
    expect(get(sim, 2).hp).toBe(50 - expected);
  });

  it.each([
    [1, 6],
    [2, 10],
    [3, 19],
  ] as const)("R-15.2: Mondpriesterin ★%i gibt %i Schild", (stars, expected) => {
    const sim = run([
      card(1, 0, "moon_priestess", stars, at(2, 0), { startMana: 100 }),
      dummy(2, 0, at(0, 0), { hp: 3 }),
      dummy(3, 1, at(2, 5)),
    ]);
    expect(get(sim, 2).shield).toBe(expected);
    expect(sim.events).toContainEqual({ type: "combat_shielded", tick: 1, source: 1, target: 2, amount: expected, shield: expected });
  });

  it("R-15.2: `selfAttackTimes` wird bei ★2 nicht doppelt skaliert (bezieht sich schon auf den skalierten Angriff)", () => {
    const ability: Ability = {
      trigger: "onManaFull",
      effects: [{ op: "damage", amount: { kind: "selfAttackTimes", factor: 2 }, target: "currentTarget" }],
    };
    const striker: FighterInit = {
      ...dummy(1, 0, at(2, 0), { attack: 5, range: 6 }),
      abilities: [ability],
      hasManaAbility: true,
      startMana: 100,
      stars: 2,
    };
    const sim = run([striker, dummy(2, 1, at(2, 5))]);
    expect(abilityDamage(sim, 1).map((e) => e.amount)).toEqual([10]);
  });

  it("R-15.2: Kämpfer tragen den Stern der Einheit; Anführer und Tokens gelten als ★1", () => {
    expect(card(1, 0, "apprentice", 3, at(0, 0)).stars).toBe(3);
    expect(fighterFromData(data, { id: 2, team: 0, kind: "leader", sourceId: "ilyra", stars: 3, pos: at(0, 0) }).stars).toBe(1);
    expect(fighterFromData(data, { id: 3, team: 0, kind: "token", sourceId: "goblin_token", stars: 1, pos: at(0, 0) }).stars).toBe(1);
    // Ohne Angabe ★1 (z. B. selbst gebaute Kämpfer).
    const sim = createCombat(data.config, SIZE, [dummy(4, 0, at(0, 0)), dummy(5, 1, at(2, 5))]);
    expect(get(sim, 4).stars).toBe(1);
  });

  it("R-15.2: Anführer-Fähigkeiten skalieren nicht (Ilyra bleibt bei 4 Schaden)", () => {
    const ilyra = fighterFromData(data, { id: 1, team: 0, kind: "leader", sourceId: "ilyra", stars: 3, pos: at(2, 0) });
    const sim = run([{ ...ilyra, startMana: 100 }, dummy(2, 1, at(2, 5))]);
    expect(abilityDamage(sim, 1).map((e) => e.amount)).toEqual([4]);
  });

  it("R-15.2: Im Spielzustand gibt `fighterForUnit` den Stern einer verschmolzenen Einheit an den Kampf weiter", () => {
    const state = createGame(data, defaultLeaders(data), 5);
    advance(state, data);
    const id = state.nextUnitId++;
    const instance = state.nextCardInstanceId++;
    state.cards[instance] = { id: instance, cardId: "apprentice", owner: 0 };
    const u: Unit = {
      id,
      owner: 0,
      kind: "card",
      sourceId: "apprentice",
      cardInstanceIds: [instance],
      stars: 3,
      xp: 0,
      wounded: false,
      restedInReserve: false,
      location: { zone: "right", cell: { col: 0, row: 0 } },
    };
    state.units[id] = u;
    expect(fighterForUnit(state, data, u, at(2, 0)).stars).toBe(3);
    const leader = state.units[getPlayer(state, 0).leader.unitId] as Unit;
    expect(fighterForUnit(state, data, leader, at(1, 0)).stars).toBe(1);
  });
});
