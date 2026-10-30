import { describe, expect, it } from "vitest";
import {
  bestTarget,
  type CombatEvent,
  type CombatHooks,
  createCombat,
  dealDamage,
  fighterById,
  type Fighter,
  fighterFromData,
  type FighterInit,
  simulateCombat,
  stepCombat,
  stunFighter,
} from "./combat";
import { type ConfigData, loadGameData } from "./data";
import type { UnitStats } from "./dataTypes";
import { allCells, compareRowCol, frontArenaSize, frontToArena, hexDistance, neighbors, type OffsetCoord } from "./hex";

const data = loadGameData();
const config = data.config;
const SIZE = frontArenaSize(config.arenas.frontZone);

function withTicks(maxTicks: number): ConfigData {
  return { ...config, combat: { ...config.combat, maxTicks } };
}

function fighter(
  id: number,
  team: number,
  pos: OffsetCoord,
  stats: Partial<UnitStats> = {},
  extra: Partial<FighterInit> = {},
): FighterInit {
  return {
    id,
    team,
    sourceId: "test",
    behavior: "default",
    pos,
    stats: { attack: 2, hp: 10, breakthrough: 0, range: 1, ...stats },
    hasManaAbility: false,
    ...extra,
  };
}

/** Haken, der die genannten Einheiten zu Kampfbeginn für lange Zeit betäubt (sie stehen nur herum). */
function stunAtStart(ids: number[], ticks = 10_000): CombatHooks {
  return {
    onCombatStart: (sim, f) => {
      if (ids.includes(f.id)) stunFighter(sim, f, ticks);
    },
  };
}

function ofType<T extends CombatEvent["type"]>(events: CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

function get(sim: { fighters: Fighter[] }, id: number): Fighter {
  const f = sim.fighters.find((x) => x.id === id);
  if (!f) throw new Error(`Kämpfer ${id} fehlt`);
  return f;
}

function cellAtDistance(from: OffsetCoord, d: number, taken: OffsetCoord[]): OffsetCoord {
  const cell = allCells(SIZE).find(
    (c) => hexDistance(from, c) === d && !taken.some((t) => t.col === c.col && t.row === c.row),
  );
  if (!cell) throw new Error(`kein Feld im Abstand ${d}`);
  return cell;
}

describe("Kämpfer aus den Spieldaten", () => {
  it("R-9.2: Werte aus Kartendaten plus Sternfaktor, Standard-Intervalle und Mana aus config.json", () => {
    const init = fighterFromData(data, { id: 1, team: 0, kind: "card", sourceId: "recruit", stars: 2, pos: { col: 0, row: 0 } });
    const sim = createCombat(config, SIZE, [init]);
    const f = get(sim, 1);
    expect(f.attack).toBe(3); // 2 × 1,8 = 3,6 → 3
    expect(f.hp).toBe(5); // 3 × 1,8 = 5,4 → 5
    expect(f.range).toBe(1);
    expect(f.armor).toBe(0);
    expect(f.attackInterval).toBe(config.combat.defaultAttackInterval);
    expect(f.moveInterval).toBe(config.combat.defaultMoveInterval);
    expect(f.manaMax).toBe(config.combat.defaultManaMax);
    expect(f.mana).toBe(0);
    expect(f.behavior).toBe("taunt");
    expect(f.hasManaAbility).toBe(false);
  });

  it("R-9.2: Mana-Fähigkeit, Panzer, Schlüsselwort firstStrike und Klassenverhalten werden übernommen", () => {
    const apprentice = fighterFromData(data, { id: 1, team: 0, kind: "card", sourceId: "apprentice", stars: 1, pos: { col: 0, row: 0 } });
    expect(apprentice.hasManaAbility).toBe(true);
    expect(apprentice.behavior).toBe("default");
    const dancer = fighterFromData(data, { id: 2, team: 0, kind: "card", sourceId: "blade_dancer", stars: 1, pos: { col: 1, row: 0 } });
    expect(dancer.behavior).toBe("backlineJump");
    const sim = createCombat(config, SIZE, [apprentice, dancer]);
    expect(get(sim, 2).firstStrike).toBe(true);
    expect(get(sim, 1).firstStrike).toBe(false);
    const armored = [...data.cards.values()].find((c) => c.type === "unit" && (c.stats.armor ?? 0) > 0);
    expect(armored).toBeDefined();
    if (armored && armored.type === "unit") {
      const a = createCombat(config, SIZE, [
        fighterFromData(data, { id: 3, team: 0, kind: "card", sourceId: armored.id, stars: 1, pos: { col: 0, row: 0 } }),
      ]);
      expect(get(a, 3).armor).toBe(armored.stats.armor);
    }
  });

  it("R-9.2: Anführer nehmen ihre Werte aus leaders.json, mit Start-Mana", () => {
    const leader = data.leaders.get("brann");
    if (!leader) throw new Error("brann fehlt");
    const init = fighterFromData(data, { id: 1, team: 0, kind: "leader", sourceId: "brann", stars: 1, pos: { col: 0, row: 0 }, startMana: 30 });
    const f = get(createCombat(config, SIZE, [init]), 1);
    expect(f.attack).toBe(leader.stats.attack);
    expect(f.hp).toBe(leader.stats.hp);
    expect(f.hasManaAbility).toBe(true);
    expect(f.mana).toBe(30);
    expect(f.behavior).toBe("taunt");
  });

  it("R-9.2: ungültige Aufstellungen werden abgelehnt", () => {
    expect(() => createCombat(config, SIZE, [fighter(1, 0, { col: 5, row: 0 })])).toThrow(RangeError);
    expect(() => createCombat(config, SIZE, [fighter(1, 0, { col: 0, row: 0 }), fighter(2, 1, { col: 0, row: 0 })])).toThrow(RangeError);
    expect(() => createCombat(config, SIZE, [fighter(1, 0, { col: 0, row: 0 }), fighter(1, 1, { col: 1, row: 0 })])).toThrow(RangeError);
  });
});

describe("Tick-Ablauf", () => {
  it("R-9.3: Angriff alle attackInterval Ticks, beginnend in Tick 1", () => {
    const res = simulateCombat(
      withTicks(25),
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 1, hp: 100 }), fighter(2, 1, { col: 2, row: 3 }, { attack: 0, hp: 100 })],
      stunAtStart([2]),
    );
    expect(hexDistance({ col: 2, row: 2 }, { col: 2, row: 3 })).toBe(1);
    const ticks = ofType(res.events, "combat_attack").filter((e) => e.unit === 1).map((e) => e.tick);
    expect(ticks).toEqual([1, 11, 21]);
  });

  it("R-9.3: eigenes attackInterval aus den Daten wird verwendet", () => {
    const res = simulateCombat(
      withTicks(12),
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 1, hp: 100, attackInterval: 4 }), fighter(2, 1, { col: 2, row: 3 }, { attack: 0, hp: 100 })],
      stunAtStart([2]),
    );
    expect(ofType(res.events, "combat_attack").filter((e) => e.unit === 1).map((e) => e.tick)).toEqual([1, 5, 9]);
  });

  it("R-9.3: Bewegung Schritt für Schritt auf kürzestem Weg, kleinstes (row, col) bei Gleichstand, alle moveInterval Ticks", () => {
    const start = { col: 2, row: 0 };
    const goal = { col: 2, row: 5 };
    const res = simulateCombat(withTicks(60), SIZE, [fighter(1, 0, start, { attack: 0 }), fighter(2, 1, goal, { attack: 0 })], stunAtStart([2]));
    const moves = ofType(res.events, "combat_unit_moved").filter((e) => e.unit === 1);
    expect(moves.length).toBe(hexDistance(start, goal) - 1);
    expect(moves.map((m) => m.tick)).toEqual(moves.map((_, i) => 1 + i * config.combat.defaultMoveInterval));
    const firstMove = moves[0];
    if (!firstMove) throw new Error("keine Bewegung");
    const best = neighbors(start, SIZE)
      .filter((c) => hexDistance(c, goal) === hexDistance(start, goal) - 1)
      .sort(compareRowCol)[0];
    expect(firstMove.to).toEqual(best);
    const last = moves[moves.length - 1];
    expect(last && hexDistance(last.to, goal)).toBe(1);
  });

  it("R-9.3: ohne freien Weg bleibt die Einheit stehen", () => {
    const res = simulateCombat(
      withTicks(20),
      SIZE,
      [
        fighter(1, 0, { col: 0, row: 0 }),
        fighter(2, 0, { col: 1, row: 0 }),
        fighter(3, 0, { col: 0, row: 1 }),
        fighter(4, 1, { col: 4, row: 5 }),
      ],
      stunAtStart([2, 3, 4]),
    );
    expect(neighbors({ col: 0, row: 0 }, SIZE)).toEqual([{ col: 1, row: 0 }, { col: 0, row: 1 }]);
    expect(ofType(res.events, "combat_unit_moved")).toEqual([]);
    expect(res.winner).toBeNull();
  });

  it("R-9.3: Einheiten mit firstStrike handeln vor allen anderen, sonst nach aufsteigender ID", () => {
    const a = (fs: boolean): FighterInit[] => [
      fighter(1, 1, { col: 2, row: 3 }, { attack: 2, hp: 2 }),
      fighter(2, 0, { col: 2, row: 2 }, { attack: 2, hp: 2 }, { keywords: fs ? ["firstStrike"] : [] }),
    ];
    expect(simulateCombat(config, SIZE, a(false)).winner).toBe(1);
    expect(simulateCombat(config, SIZE, a(true)).winner).toBe(0);
  });

  it("R-9.3: betäubte Einheiten verringern nur ihren Zähler", () => {
    const hooks: CombatHooks = {
      onCombatStart: (sim, f) => stunFighter(sim, f, f.id === 1 ? 3 : 10_000),
    };
    const res = simulateCombat(
      withTicks(10),
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 1, hp: 100 }), fighter(2, 1, { col: 2, row: 3 }, { hp: 100 })],
      hooks,
    );
    expect(ofType(res.events, "combat_unit_stunned").map((e) => [e.unit, e.ticks])).toEqual([[1, 3], [2, 10_000]]);
    expect(ofType(res.events, "combat_attack").map((e) => e.tick)).toEqual([4]);
    expect(ofType(res.events, "combat_target_changed").filter((e) => e.unit === 1).map((e) => e.tick)).toEqual([4]);
  });

  it("R-9.3: bei vollem Mana wirkt die Einheit ihre Fähigkeit statt anzugreifen, Mana auf 0, Angriffs-Cooldown neu", () => {
    const casts: number[] = [];
    const hooks: CombatHooks = {
      ...stunAtStart([2]),
      onManaFull: (sim) => casts.push(sim.tick),
    };
    const sim = createCombat(
      withTicks(12),
      SIZE,
      [
        fighter(1, 0, { col: 2, row: 2 }, { attack: 1, hp: 100 }, { hasManaAbility: true, startMana: 100 }),
        fighter(2, 1, { col: 2, row: 3 }, { attack: 0, hp: 100 }),
      ],
      hooks,
    );
    stepCombat(sim);
    expect(casts).toEqual([1]);
    expect(ofType(sim.events, "combat_ability")).toEqual([{ type: "combat_ability", tick: 1, unit: 1, target: 2 }]);
    expect(ofType(sim.events, "combat_attack")).toEqual([]);
    expect(get(sim, 1).mana).toBe(0);
    while (stepCombat(sim)) {
      // bis zum Ende
    }
    expect(ofType(sim.events, "combat_attack").map((e) => e.tick)).toEqual([11]);
  });
});

describe("Zielwahl", () => {
  const me = { col: 2, row: 0 };

  it("R-9.4: kleinster Abstand zuerst", () => {
    const sim = createCombat(config, SIZE, [fighter(1, 0, me), fighter(2, 1, { col: 2, row: 5 }), fighter(3, 1, { col: 2, row: 2 })]);
    expect(bestTarget(sim, get(sim, 1))?.id).toBe(3);
  });

  it("R-9.4: bei gleichem Abstand die wenigsten Lebenspunkte, dann die kleinste ID", () => {
    const a = { col: 1, row: 1 };
    const b = { col: 2, row: 1 };
    expect(hexDistance(me, a)).toBe(hexDistance(me, b));
    const sim = createCombat(config, SIZE, [fighter(1, 0, me), fighter(2, 1, a, { hp: 5 }), fighter(3, 1, b, { hp: 3 })]);
    expect(bestTarget(sim, get(sim, 1))?.id).toBe(3);
    const sim2 = createCombat(config, SIZE, [fighter(1, 0, me), fighter(2, 1, a, { hp: 5 }), fighter(3, 1, b, { hp: 5 })]);
    expect(bestTarget(sim2, get(sim2, 1))?.id).toBe(2);
  });

  it("R-9.4: Krieger ziehen Angriffe auf sich (effektiver Abstand − 1)", () => {
    const near = cellAtDistance(me, 1, []);
    const far = cellAtDistance(me, 2, [near]);
    const init = (behavior: "taunt" | "default"): FighterInit[] => [
      fighter(1, 0, me),
      fighter(2, 1, near, { hp: 10 }),
      fighter(3, 1, far, { hp: 5 }, { behavior }),
    ];
    const plain = createCombat(config, SIZE, init("default"));
    expect(bestTarget(plain, get(plain, 1))?.id).toBe(2);
    const taunt = createCombat(config, SIZE, init("taunt"));
    expect(bestTarget(taunt, get(taunt, 1))?.id).toBe(3);
  });

  it("R-9.4: Ziel wechselt erst, wenn ein anderer Kandidat mindestens 2 näher ist", () => {
    const setup = (newDistance: number): number | null => {
      const e1 = cellAtDistance(me, 4, []);
      const e2 = cellAtDistance(me, 5, [e1]);
      const sim = createCombat(
        withTicks(50),
        SIZE,
        [fighter(1, 0, me, { attack: 0, range: 10 }), fighter(2, 1, e1, { attack: 0 }), fighter(3, 1, e2, { attack: 0 })],
        stunAtStart([2, 3]),
      );
      stepCombat(sim);
      expect(get(sim, 1).targetId).toBe(2);
      get(sim, 3).pos = cellAtDistance(me, newDistance, [e1, me]);
      for (let i = 0; i < 3; i++) stepCombat(sim);
      return get(sim, 1).targetId;
    };
    expect(setup(3)).toBe(2);
    expect(setup(2)).toBe(3);
  });

  it("R-9.4: ein gestorbenes Ziel wird ersetzt", () => {
    const sim = createCombat(
      config,
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 5 }), fighter(2, 1, { col: 2, row: 3 }, { hp: 5 }), fighter(3, 1, { col: 1, row: 3 }, { hp: 50 })],
      stunAtStart([2, 3]),
    );
    stepCombat(sim);
    expect(get(sim, 2).alive).toBe(false);
    stepCombat(sim);
    expect(get(sim, 1).targetId).toBe(3);
    expect(ofType(sim.events, "combat_target_changed").filter((e) => e.unit === 1).map((e) => e.target)).toEqual([2, 3]);
  });

  it("R-9.4: Schurken springen in Tick 0 neben den entferntesten Gegner, auf das kleinste freie Feld", () => {
    const rogue = { col: 2, row: 1 };
    const near = { col: 2, row: 3 };
    const far = { col: 2, row: 5 };
    const sim = createCombat(config, SIZE, [
      fighter(1, 0, rogue, {}, { behavior: "backlineJump" }),
      fighter(2, 1, near),
      fighter(3, 1, far),
    ]);
    stepCombat(sim);
    const jump = ofType(sim.events, "combat_unit_jumped");
    const expected = neighbors(far, SIZE).sort(compareRowCol)[0];
    expect(jump).toEqual([{ type: "combat_unit_jumped", tick: 0, unit: 1, from: rogue, to: expected, target: 3 }]);
    expect(get(sim, 1).targetId).toBe(3);
  });

  it("R-9.4: Schurken-Sprung – Gleichstand nach kleinster Ziel-ID, Gegner ohne freies Nachbarfeld wird übergangen", () => {
    const rogue = { col: 2, row: 0 };
    const a = { col: 0, row: 5 };
    const b = { col: 4, row: 5 };
    expect(hexDistance(rogue, a)).toBe(hexDistance(rogue, b));
    const tie = createCombat(config, SIZE, [fighter(1, 0, rogue, {}, { behavior: "backlineJump" }), fighter(3, 1, a), fighter(2, 1, b)]);
    stepCombat(tie);
    expect(get(tie, 1).targetId).toBe(2);

    // Feld a eingemauert durch Verbündete des Schurken → Sprung zum nächsten Gegner.
    const blockers = neighbors(a, SIZE);
    const near = { col: 2, row: 2 };
    const blocked = createCombat(config, SIZE, [
      fighter(1, 0, rogue, {}, { behavior: "backlineJump" }),
      fighter(2, 1, a),
      fighter(3, 1, near),
      ...blockers.map((c, i) => fighter(10 + i, 0, c)),
    ]);
    stepCombat(blocked);
    const jump = ofType(blocked.events, "combat_unit_jumped")[0];
    expect(jump?.target).toBe(3);
    expect(hexDistance(jump?.to ?? rogue, near)).toBe(1);
  });
});

describe("Angriff und Schaden", () => {
  it("R-9.5: Schild zuerst, dann Schaden minus Panzer, mindestens 1", () => {
    const sim = createCombat(config, SIZE, [
      fighter(1, 0, { col: 0, row: 0 }, { hp: 20, armor: 1 }, { shield: 3 }),
      fighter(2, 1, { col: 4, row: 5 }, { hp: 20, armor: 5 }),
      fighter(3, 1, { col: 3, row: 5 }, { hp: 20 }, { shield: 5 }),
    ]);
    dealDamage(sim, null, get(sim, 1), 5, "ability");
    expect(get(sim, 1).shield).toBe(0);
    expect(get(sim, 1).hp).toBe(19); // 5 − 3 Schild = 2, − 1 Panzer = 1
    dealDamage(sim, null, get(sim, 2), 2, "attack");
    expect(get(sim, 2).hp).toBe(19); // mindestens 1
    dealDamage(sim, null, get(sim, 3), 5, "attack");
    expect(get(sim, 3).hp).toBe(20); // vollständig vom Schild aufgefangen
    expect(get(sim, 3).shield).toBe(0);
    expect(ofType(sim.events, "combat_damage").map((e) => [e.absorbed, e.hpLoss])).toEqual([[3, 1], [0, 1], [5, 0]]);
  });

  it("R-9.5: Mana – Angreifer +10, getroffene Einheit +5, nur mit Mana-Fähigkeit", () => {
    const sim = createCombat(
      withTicks(5),
      SIZE,
      [
        fighter(1, 0, { col: 2, row: 2 }, { attack: 1, hp: 100 }, { hasManaAbility: true }),
        fighter(2, 1, { col: 2, row: 3 }, { attack: 1, hp: 100 }, { hasManaAbility: true }),
        fighter(3, 0, { col: 0, row: 0 }, { attack: 1, hp: 100 }),
        fighter(4, 1, { col: 1, row: 0 }, { attack: 1, hp: 100 }),
      ],
      stunAtStart([2]),
    );
    stepCombat(sim);
    // Einheit 1 greift 2 an (+10), wird nicht getroffen; 2 wird getroffen (+5).
    expect(get(sim, 1).mana).toBe(config.combat.manaPerAttack);
    expect(get(sim, 2).mana).toBe(config.combat.manaPerHitTaken);
    // 3 und 4 kämpfen gegeneinander, ohne Mana-Fähigkeit bleibt Mana 0.
    expect(get(sim, 3).mana).toBe(0);
    expect(get(sim, 4).mana).toBe(0);
  });
});

describe("Tod und Kampfende", () => {
  it("R-9.6: Lebenspunkte ≤ 0 → sofortiger Tod, Feld frei, Tod-Haken sofort mit Angreifer", () => {
    const deaths: [number, number | null, number][] = [];
    const sim = createCombat(
      config,
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 5 }), fighter(2, 1, { col: 2, row: 3 }, { hp: 5 })],
      {
        ...stunAtStart([2]),
        onDeath: (s, f, killer) => deaths.push([f.id, killer ? killer.id : null, s.tick]),
      },
    );
    stepCombat(sim);
    expect(get(sim, 2).alive).toBe(false);
    expect(deaths).toEqual([[2, 1, 1]]);
    expect(ofType(sim.events, "combat_unit_died")).toEqual([{ type: "combat_unit_died", tick: 1, unit: 2, killer: 1 }]);
    expect(fighterById(sim, 2)?.alive).toBe(false);
  });

  it("R-9.7: Kampf endet, sobald nur noch ein Team lebt; Sieger und Überlebende", () => {
    const res = simulateCombat(config, SIZE, [fighter(1, 0, { col: 2, row: 2 }, { attack: 5 }), fighter(2, 1, { col: 2, row: 3 }, { hp: 5 })], stunAtStart([2]));
    expect(res.winner).toBe(0);
    expect(res.ticks).toBe(1);
    expect(res.survivors).toEqual([1]);
    expect(res.events[res.events.length - 1]).toEqual({ type: "combat_ended", tick: 1, winner: 0, survivors: [1] });
  });

  it("R-9.7: nach maxTicks mit zwei lebenden Teams → Unentschieden", () => {
    const res = simulateCombat(withTicks(30), SIZE, [fighter(1, 0, { col: 0, row: 0 }), fighter(2, 1, { col: 4, row: 5 })], stunAtStart([1, 2]));
    expect(res.winner).toBeNull();
    expect(res.ticks).toBe(30);
    expect(res.survivors).toEqual([1, 2]);
  });

  it("R-9.7: leben am Ende keine Einheiten mehr → Unentschieden", () => {
    const res = simulateCombat(
      config,
      SIZE,
      [fighter(1, 0, { col: 2, row: 2 }, { attack: 5 }), fighter(2, 1, { col: 2, row: 3 }, { hp: 5 })],
      {
        ...stunAtStart([2]),
        onDeath: (sim, _f, killer) => {
          if (killer) dealDamage(sim, null, killer, 1000, "ability");
        },
      },
    );
    expect(res.winner).toBeNull();
    expect(res.survivors).toEqual([]);
  });

  it("R-9.7: hat nur ein Team Einheiten, ist der Kampf vor Tick 1 entschieden", () => {
    const res = simulateCombat(config, SIZE, [fighter(1, 0, { col: 0, row: 0 })]);
    expect(res).toMatchObject({ winner: 0, ticks: 0, survivors: [1] });
    expect(simulateCombat(config, SIZE, [])).toMatchObject({ winner: null, ticks: 0, survivors: [] });
  });
});

describe("Ganzer Kampf mit echten Daten", () => {
  const zone = config.arenas.frontZone;
  const units: [number, number, string, 1 | 2 | 3, number, number][] = [
    // id, team, Karte, Stern, col, row (Frontzone-Koordinaten des Besitzers)
    [1, 0, "recruit", 1, 1, 2],
    [2, 0, "apprentice", 1, 2, 0],
    [3, 0, "pickpocket", 2, 3, 1],
    [4, 0, "squire", 1, 2, 2],
    [5, 1, "recruit", 2, 2, 2],
    [6, 1, "blade_dancer", 1, 0, 1],
    [7, 1, "gravedigger", 1, 4, 0],
    [8, 1, "spark_rider", 1, 1, 2],
  ];
  const inits = (): FighterInit[] =>
    units.map(([id, team, sourceId, stars, col, row]) =>
      fighterFromData(data, { id, team, kind: "card", sourceId, stars, pos: frontToArena(team === 0 ? "first" : "second", { col, row }, zone) }),
    );

  it("R-1.8: Determinismus – gleiche Aufstellung ergibt exakt dasselbe Kampfprotokoll", () => {
    const a = simulateCombat(config, SIZE, inits());
    const b = simulateCombat(config, SIZE, inits());
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(a.ticks).toBeGreaterThan(0);
    expect(a.ticks).toBeLessThanOrEqual(config.combat.maxTicks);
    expect(ofType(a.events, "combat_ended")).toHaveLength(1);
  });

  it("R-9.7: die klar stärkere Seite gewinnt", () => {
    const strong = [1, 2, 3, 4].map((id, i) =>
      fighterFromData(data, { id, team: 0, kind: "card", sourceId: "recruit", stars: 2, pos: frontToArena("first", { col: i, row: 2 }, zone) }),
    );
    const weak = fighterFromData(data, { id: 5, team: 1, kind: "card", sourceId: "recruit", stars: 1, pos: frontToArena("second", { col: 2, row: 2 }, zone) });
    const res = simulateCombat(config, SIZE, [...strong, weak]);
    expect(res.winner).toBe(0);
    expect(res.survivors.every((id) => id <= 4)).toBe(true);
  });
});
