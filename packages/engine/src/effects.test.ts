import { describe, expect, it } from "vitest";
import {
  type CombatEvent,
  type CombatSim,
  createCombat,
  dealDamage,
  type Fighter,
  fighterFromData,
  type FighterInit,
  killFighter,
  simulateCombat,
  stepCombat,
} from "./combat";
import { loadGameData } from "./data";
import type { UnitStats } from "./dataTypes";
import { COMBAT_TRIGGERS, effectHooks, type EffectHooks } from "./effects";
import { compareRowCol, frontArenaSize, hexDistance, neighbors, type OffsetCoord } from "./hex";
import { runFrontCombats } from "./fronts";
import { advance } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, getPlayer, PLAYER_INDICES, type Unit } from "./state";

const data = loadGameData();
const config = data.config;
const SIZE = frontArenaSize(config.arenas.frontZone);

const at = (col: number, row: number): OffsetCoord => ({ col, row });

/** Kämpfer aus den echten Kartendaten (bzw. `leaders.json` mit `leader: true`). */
function unit(id: number, team: number, sourceId: string, pos: OffsetCoord, extra: Partial<FighterInit> = {}): FighterInit {
  const kind = data.leaders.has(sourceId) ? "leader" : "card";
  return { ...fighterFromData(data, { id, team, kind, sourceId, stars: 1, pos }), ...extra };
}

/** Kämpfer ohne Fähigkeit, Werte frei wählbar (Standard: harmlos, robust). */
function dummy(id: number, team: number, pos: OffsetCoord, stats: Partial<UnitStats> = {}, extra: Partial<FighterInit> = {}): FighterInit {
  return {
    id,
    team,
    sourceId: "dummy",
    behavior: "default",
    pos,
    stats: { attack: 0, hp: 50, breakthrough: 0, range: 1, ...stats },
    hasManaAbility: false,
    ...extra,
  };
}

function setup(inits: FighterInit[], firstSummonId?: number): { sim: CombatSim; fx: EffectHooks } {
  const fx = effectHooks(data);
  return { sim: createCombat(config, SIZE, inits, fx.hooks, firstSummonId), fx };
}

function get(sim: CombatSim, id: number): Fighter {
  const f = sim.fighters.find((x) => x.id === id);
  if (!f) throw new Error(`Kämpfer ${id} fehlt`);
  return f;
}

function ofType<T extends CombatEvent["type"]>(events: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

/** Kampfbeginn (Tick 0) und Tick 1 abhandeln; Gegner sind in diesen Tests harmlos und weit weg. */
function startOnly(sim: CombatSim): void {
  stepCombat(sim);
}

describe("Kampfbeginn (R-9.0)", () => {
  it("R-9.0: Kesselflicker erzeugt ein Goblin-Token auf dem freien Nachbarfeld mit kleinstem (row, col)", () => {
    const pos = at(2, 2);
    const blocked = neighbors(pos, SIZE).sort(compareRowCol)[0] as OffsetCoord;
    const { sim } = setup([unit(1, 0, "tinker", pos), dummy(2, 0, blocked), dummy(3, 1, at(2, 5))], 40);
    startOnly(sim);
    const summoned = ofType(sim.events, "combat_unit_summoned");
    expect(summoned).toHaveLength(1);
    const expected = neighbors(pos, SIZE).sort(compareRowCol)[1] as OffsetCoord;
    expect(summoned[0]).toMatchObject({ tick: 0, unit: 40, team: 0, sourceId: "goblin_token", cell: expected, summoner: 1 });
    const token = get(sim, 40);
    expect(token.summoned).toBe(true);
    expect(token.attack).toBe(1);
    expect(token.race).toBe("goblin");
    expect(sim.nextSummonId).toBe(41);
  });

  it("R-9.0: ohne freies Nachbarfeld erzeugt der Kesselflicker kein Token", () => {
    const pos = at(0, 0);
    const inits = [unit(1, 0, "tinker", pos)];
    neighbors(pos, SIZE).forEach((c, i) => inits.push(dummy(10 + i, 0, c)));
    inits.push(dummy(30, 1, at(4, 5)));
    const { sim } = setup(inits);
    startOnly(sim);
    expect(ofType(sim.events, "combat_unit_summoned")).toHaveLength(0);
  });

  it("R-9.0: im Kampf erzeugte Tokens bekommen ohne Vorgabe die nächste ID nach allen Kämpfern", () => {
    const { sim } = setup([unit(3, 0, "tinker", at(2, 2)), dummy(7, 1, at(2, 5))]);
    startOnly(sim);
    expect(ofType(sim.events, "combat_unit_summoned")[0]?.unit).toBe(8);
  });

  it("R-9.0: Runenschmied gibt benachbarten Verbündeten +1 Panzer, nicht sich selbst und nicht Entfernten", () => {
    const pos = at(2, 1);
    const near = neighbors(pos, SIZE).sort(compareRowCol)[0] as OffsetCoord;
    const { sim } = setup([unit(1, 0, "runesmith", pos), dummy(2, 0, near), dummy(3, 0, at(0, 0)), dummy(4, 1, at(2, 5))]);
    expect(hexDistance(pos, at(0, 0))).toBeGreaterThan(1);
    startOnly(sim);
    expect(get(sim, 2).armor).toBe(1);
    expect(get(sim, 1).armor).toBe(0);
    expect(get(sim, 3).armor).toBe(0);
    expect(get(sim, 4).armor).toBe(0);
    expect(ofType(sim.events, "combat_buffed")).toEqual([
      { type: "combat_buffed", tick: 0, source: 1, target: 2, stat: "armor", amount: 1, value: 1 },
    ]);
  });

  it("R-9.0: Bannerträger gibt allen Verbündeten der Arena (auch sich selbst) +1 Angriff, Gegnern nicht", () => {
    const { sim } = setup([unit(1, 0, "banner_bearer", at(2, 1)), dummy(2, 0, at(0, 0), { attack: 3 }), dummy(3, 1, at(2, 5), { attack: 3 })]);
    startOnly(sim);
    expect(get(sim, 1).attack).toBe(3);
    expect(get(sim, 2).attack).toBe(4);
    expect(get(sim, 3).attack).toBe(3);
  });

  it("R-9.0: Ahnenpfahl gibt Verbündeten im Abstand 2 Angriff in Höhe der verschiedenen eigenen Rassen", () => {
    const pole = at(2, 0);
    const far = at(2, 4 - 1);
    expect(hexDistance(pole, far)).toBe(3);
    const { sim } = setup([
      unit(1, 0, "ancestor_pole", pole), // ohne Rasse
      unit(2, 0, "goblin_skirmisher", at(1, 0)), // Goblin, Abstand 1
      unit(3, 0, "runesmith", at(3, 1)), // Zwerg
      unit(4, 0, "ranger", far), // Elf, Abstand 3: zählt als Rasse, bekommt aber nichts
      unit(5, 0, "thunder_gun", at(0, 0)), // Zwerg (doppelt), Abstand 2
      dummy(6, 1, at(4, 5)),
    ]);
    startOnly(sim);
    // Goblin, Zwerg, Elf = 3 Rassen.
    expect(get(sim, 1).attack).toBe(0 + 3);
    expect(get(sim, 2).attack).toBe(2 + 3);
    expect(get(sim, 5).attack).toBe(3 + 3);
    expect(get(sim, 4).attack).toBe(3);
  });

  it("R-9.0: Kampfbeginn-Effekte laufen in aufsteigender ID (Ahnenpfahl zählt das Token des früheren Kesselflickers)", () => {
    const { sim } = setup([unit(1, 0, "tinker", at(1, 1)), unit(2, 0, "ancestor_pole", at(2, 0)), dummy(3, 1, at(4, 5))], 50);
    startOnly(sim);
    // Token (Goblin) zählt als Rasse; Kesselflicker selbst ist auch Goblin → 1 Rasse.
    expect(get(sim, 50).race).toBe("goblin");
    expect(get(sim, 2).attack).toBe(1);
  });
});

describe("Mana-Fähigkeiten (R-9.3 Schritt 3, R-9.5)", () => {
  it("R-9.3: Lehrling fügt bei vollem Mana seinem Ziel 2 Fähigkeitsschaden zu, Mana auf 0", () => {
    const { sim } = setup([unit(1, 0, "apprentice", at(2, 0), { startMana: 100 }), dummy(2, 1, at(2, 5))]);
    stepCombat(sim);
    const dmg = ofType(sim.events, "combat_damage");
    expect(dmg).toEqual([expect.objectContaining({ tick: 1, source: 1, target: 2, kind: "ability", amount: 2, hpLoss: 2 })]);
    expect(get(sim, 1).mana).toBe(0);
  });

  it("R-9.5: Fähigkeitsschaden geht durch Schild und Panzer", () => {
    const { sim } = setup([unit(1, 0, "apprentice", at(2, 0), { startMana: 100 }), dummy(2, 1, at(2, 5), { armor: 5 }, { shield: 1 })]);
    stepCombat(sim);
    expect(ofType(sim.events, "combat_damage")[0]).toMatchObject({ amount: 2, absorbed: 1, hpLoss: 1 });
  });

  it("R-9.3: Donnerbüchse trifft ihr Ziel und dessen gegnerische Nachbarn mit je 3 Schaden", () => {
    const target = at(2, 4);
    const [n1, n2] = neighbors(target, SIZE).filter((c) => c.row >= 4).sort(compareRowCol) as [OffsetCoord, OffsetCoord];
    const far = at(0, 1);
    const { sim } = setup([
      unit(1, 0, "thunder_gun", at(2, 2), { startMana: 100 }),
      dummy(2, 1, target, { hp: 5 }), // nächstes Ziel (wenigste LP bei gleichem Abstand nicht nötig)
      dummy(3, 1, n1),
      dummy(4, 1, n2),
      dummy(5, 1, far),
      dummy(6, 0, at(4, 0)),
    ]);
    // Ziel festlegen: der Kämpfer wählt nach R-9.4 selbst; wir prüfen relativ zum gewählten Ziel.
    stepCombat(sim);
    const caster = get(sim, 1);
    const ability = ofType(sim.events, "combat_ability")[0];
    const chosen = get(sim, ability?.target as number);
    const hit = ofType(sim.events, "combat_damage").filter((e) => e.source === 1);
    const expected = sim.fighters
      .filter((f) => f.team === 1 && (f.id === chosen.id || hexDistance(f.pos, chosen.pos) === 1))
      .map((f) => f.id);
    expect(hit.map((e) => e.target)).toEqual(expected);
    expect(hit.every((e) => e.amount === 3 && e.kind === "ability")).toBe(true);
    expect(expected).not.toContain(6);
    expect(caster.mana).toBe(0);
  });

  it("R-9.3: Waldläuferin trifft die 3 nächsten Gegner mit je 2 Schaden", () => {
    const pos = at(2, 0);
    const foes = [at(2, 2), at(1, 3), at(3, 4), at(0, 5)];
    const { sim } = setup([unit(1, 0, "ranger", pos, { startMana: 100 }), ...foes.map((c, i) => dummy(10 + i, 1, c))]);
    stepCombat(sim);
    const nearest = foes
      .map((c, i) => ({ id: 10 + i, d: hexDistance(pos, c) }))
      .sort((a, b) => a.d - b.d || a.id - b.id)
      .slice(0, 3)
      .map((x) => x.id)
      .sort((a, b) => a - b);
    const hit = ofType(sim.events, "combat_damage").filter((e) => e.source === 1);
    expect(hit.map((e) => e.target)).toEqual(nearest);
    expect(hit.every((e) => e.amount === 2)).toBe(true);
  });

  it("R-14.3: Mondpriesterin gibt dem Verbündeten mit den wenigsten Lebenspunkten 6 Schild", () => {
    const { sim } = setup([
      unit(1, 0, "moon_priestess", at(2, 0), { startMana: 100 }),
      dummy(2, 0, at(0, 0), { hp: 3 }),
      dummy(3, 0, at(4, 0), { hp: 9 }),
      dummy(4, 1, at(2, 5)),
    ]);
    stepCombat(sim);
    expect(get(sim, 2).shield).toBe(6);
    expect(get(sim, 3).shield).toBe(0);
    expect(ofType(sim.events, "combat_shielded")).toEqual([
      { type: "combat_shielded", tick: 1, source: 1, target: 2, amount: 6, shield: 6 },
    ]);
  });

  it("R-14.3: Schilde addieren sich", () => {
    const { sim } = setup([unit(1, 0, "moon_priestess", at(2, 0), { startMana: 100, shield: 2 }), dummy(4, 1, at(2, 5))]);
    stepCombat(sim);
    expect(get(sim, 1).shield).toBe(8);
  });

  it("R-9.3: Erzmagier trifft Ziel und dessen Nachbarn mit 6 Schaden", () => {
    const { sim } = setup([unit(1, 0, "archmage", at(2, 0), { startMana: 100 }), dummy(2, 1, at(2, 5)), dummy(3, 1, at(1, 5))]);
    stepCombat(sim);
    const hit = ofType(sim.events, "combat_damage").filter((e) => e.source === 1);
    expect(hit.map((e) => [e.target, e.amount])).toEqual([
      [2, 6],
      [3, 6],
    ]);
  });
});

describe("Mana-Fähigkeiten der Anführer (R-9.3)", () => {
  it("R-9.3: Brann (Schildstoß) betäubt sein Ziel für 15 Ticks", () => {
    const { sim } = setup([unit(1, 0, "brann", at(2, 2), { startMana: 100 }), dummy(2, 1, at(2, 3))]);
    stepCombat(sim);
    expect(ofType(sim.events, "combat_unit_stunned")).toEqual([{ type: "combat_unit_stunned", tick: 1, unit: 2, ticks: 15 }]);
  });

  it("R-9.3: Ilyra (Arkanbolzen) fügt ihrem Ziel 4 Schaden zu", () => {
    const { sim } = setup([unit(1, 0, "ilyra", at(2, 0), { startMana: 100 }), dummy(2, 1, at(2, 5))]);
    stepCombat(sim);
    expect(ofType(sim.events, "combat_damage")[0]).toMatchObject({ source: 1, target: 2, amount: 4, kind: "ability" });
  });

  it("R-9.3: Vex (Rückenstich) fügt das Doppelte ihres aktuellen Angriffs zu", () => {
    const vex = unit(1, 0, "vex", at(2, 0), { startMana: 100 });
    const { sim } = setup([vex, dummy(2, 1, at(2, 5))]);
    stepCombat(sim);
    const dmg = ofType(sim.events, "combat_damage").find((e) => e.kind === "ability");
    expect(dmg?.amount).toBe(vex.stats.attack * 2);
  });

  it("R-9.3: Morgra (Lebensband) heilt Verbündete im Abstand 2 um 4, höchstens bis zum Maximum", () => {
    const { sim } = setup([
      unit(1, 0, "morgra", at(2, 0), { startMana: 100 }),
      dummy(2, 0, at(1, 0), { hp: 10 }),
      dummy(3, 0, at(3, 0), { hp: 10 }),
      dummy(4, 0, at(2, 3), { hp: 10 }),
      dummy(5, 1, at(2, 5)),
    ]);
    get(sim, 2).hp = 4;
    get(sim, 3).hp = 8;
    get(sim, 4).hp = 1;
    stepCombat(sim);
    expect(get(sim, 2).hp).toBe(8);
    expect(get(sim, 3).hp).toBe(10);
    expect(get(sim, 4).hp).toBe(1);
    expect(ofType(sim.events, "combat_healed").map((e) => [e.target, e.amount])).toEqual([
      [2, 4],
      [3, 2],
    ]);
  });
});

describe("Tod, Bezwingen, Tod eines Verbündeten (R-9.6)", () => {
  it("R-9.6: Totengräber gibt beim Tod eines Verbündeten allen Verbündeten mit Mana-Fähigkeit 10 Mana", () => {
    const { sim } = setup([
      unit(1, 0, "gravedigger", at(2, 0)),
      unit(2, 0, "apprentice", at(1, 0)),
      dummy(3, 0, at(3, 0)),
      unit(4, 1, "apprentice", at(2, 5)),
    ]);
    killFighter(sim, get(sim, 3), null);
    expect(get(sim, 2).mana).toBe(10);
    expect(get(sim, 4).mana).toBe(0);
    expect(ofType(sim.events, "combat_mana_gained")).toEqual([
      { type: "combat_mana_gained", tick: 0, source: 1, target: 2, amount: 10, mana: 10 },
    ]);
  });

  it("R-9.6: der eigene Tod löst onAllyDeath nicht aus", () => {
    const { sim } = setup([unit(1, 0, "gravedigger", at(2, 0)), unit(2, 0, "apprentice", at(1, 0)), dummy(4, 1, at(2, 5))]);
    killFighter(sim, get(sim, 1), null);
    expect(get(sim, 2).mana).toBe(0);
  });

  it("R-9.6: Champion der Arena erhält beim Bezwingen eines Gegners sofort +1 Angriff (dauerhaft vorgemerkt)", () => {
    const { sim, fx } = setup([unit(1, 0, "arena_champion", at(2, 2)), dummy(2, 1, at(2, 3), { hp: 1 }), dummy(3, 1, at(4, 5))]);
    dealDamage(sim, get(sim, 1), get(sim, 2), 6, "attack");
    expect(get(sim, 1).attack).toBe(7);
    expect(fx.deferred).toEqual([
      expect.objectContaining({ unit: 1, team: 0, sourceId: "arena_champion", trigger: "onKill", targets: [1] }),
    ]);
  });

  it("R-9.6: Bezwingen einer verbündeten Einheit zählt nicht als onKill", () => {
    const { sim } = setup([unit(1, 0, "arena_champion", at(2, 2)), dummy(2, 0, at(2, 1), { hp: 1 }), dummy(3, 1, at(4, 5))]);
    dealDamage(sim, get(sim, 1), get(sim, 2), 6, "ability");
    expect(get(sim, 1).attack).toBe(6);
  });

  it("R-9.6: Goblin-Plänkler merkt beim Tod 1 Gold für die Schatzkammer vor", () => {
    const { sim, fx } = setup([unit(1, 0, "goblin_skirmisher", at(2, 2)), dummy(2, 1, at(4, 5))]);
    killFighter(sim, get(sim, 1), get(sim, 2));
    expect(fx.deferred).toEqual([
      expect.objectContaining({
        unit: 1,
        trigger: "onDeath",
        effect: { op: "gainGold", amount: 1, when: "now", to: "treasury" },
      }),
    ]);
  });

  it("R-9.6: Seelenhirte merkt beim Tod eines Verbündeten 1 Anführer-XP vor", () => {
    const { sim, fx } = setup([unit(1, 0, "soul_shepherd", at(2, 2)), dummy(2, 0, at(0, 0)), dummy(3, 1, at(4, 5))]);
    killFighter(sim, get(sim, 2), null);
    expect(fx.deferred).toEqual([
      expect.objectContaining({ unit: 1, trigger: "onAllyDeath", effect: { op: "gainLeaderXp", amount: 1 } }),
    ]);
  });

  it("R-9.6: Fähigkeiten außerhalb des Kampfes (onFrontWin, onRoundStart) lösen im Kampf nicht aus", () => {
    const fx = effectHooks(data);
    const result = simulateCombat(
      config,
      SIZE,
      [unit(1, 0, "curse_weaver", at(2, 2)), unit(2, 0, "master_thief", at(1, 2)), unit(3, 0, "fence", at(3, 2)), dummy(4, 1, at(2, 3), { hp: 1 })],
      fx.hooks,
    );
    expect(result.winner).toBe(0);
    expect(fx.deferred).toEqual([]);
  });
});

describe("Abdeckung und Einbindung", () => {
  it("R-14.1: jede Karte und jeder Anführer mit Kampf-Fähigkeit hat hier einen Test", () => {
    const covered = new Set([
      "tinker",
      "runesmith",
      "banner_bearer",
      "ancestor_pole",
      "apprentice",
      "thunder_gun",
      "ranger",
      "moon_priestess",
      "archmage",
      "gravedigger",
      "arena_champion",
      "goblin_skirmisher",
      "soul_shepherd",
      "brann",
      "ilyra",
      "vex",
      "morgra",
    ]);
    const withCombatAbility = [
      ...[...data.cards.values()].filter(
        (c) => c.type === "unit" && (c.abilities ?? []).some((a) => COMBAT_TRIGGERS.includes(a.trigger)),
      ),
      ...[...data.leaders.values()].filter((l) => l.abilities.some((a) => COMBAT_TRIGGERS.includes(a.trigger))),
    ].map((x) => x.id);
    expect(withCombatAbility.filter((id) => !covered.has(id))).toEqual([]);
  });

  it("R-9.0: Frontkampf in der Rundenmaschine wertet Fähigkeiten aus; Tokens aus dem Kampf belegen neue IDs", () => {
    const state = createGame(data, defaultLeaders(data), 11);
    advance(state, data);
    for (const p of PLAYER_INDICES) {
      (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
    }
    const place = (owner: 0 | 1, zone: "left" | "right", cell: OffsetCoord, sourceId: string): number => {
      const id = state.nextUnitId++;
      const inst = state.nextCardInstanceId++;
      state.cards[inst] = { id: inst, cardId: sourceId, owner };
      state.units[id] = {
        id,
        owner,
        kind: "card",
        sourceId,
        cardInstanceIds: [inst],
        stars: 1,
        xp: 0,
        wounded: false,
        restedInReserve: false,
        location: { zone, cell },
      };
      return id;
    };
    place(0, "right", at(2, 1), "tinker");
    place(1, "left", at(2, 1), "recruit");
    const before = state.nextUnitId;
    runFrontCombats(state, data);
    const summoned = state.log.filter((e): e is Extract<GameEvent, { type: "combat_unit_summoned" }> => e.type === "combat_unit_summoned");
    expect(summoned).toHaveLength(1);
    expect(summoned[0]?.unit).toBe(before);
    expect(summoned[0]?.arena).toBe("front:0-1");
    expect(state.nextUnitId).toBe(before + 1);
    expect(state.units[before]).toBeUndefined();
  });

  it("Determinismus: gleicher Kampf mit Fähigkeiten ergibt identische Ereignisse", () => {
    const inits = (): FighterInit[] => [
      unit(1, 0, "tinker", at(1, 1)),
      unit(2, 0, "thunder_gun", at(2, 0), { startMana: 90 }),
      unit(3, 0, "moon_priestess", at(3, 0)),
      unit(4, 1, "ranger", at(2, 5)),
      unit(5, 1, "arena_champion", at(1, 3)),
      unit(6, 1, "gravedigger", at(3, 4)),
      unit(7, 1, "vex", at(0, 5)),
    ];
    const a = simulateCombat(config, SIZE, inits(), effectHooks(data).hooks, 100);
    const b = simulateCombat(config, SIZE, inits(), effectHooks(data).hooks, 100);
    expect(a.events).toEqual(b.events);
    expect(a.events.some((e) => e.type === "combat_ability")).toBe(true);
  });
});
