import { describe, expect, it } from "vitest";
import {
  type CombatHooks,
  type CombatResult,
  type CombatSim,
  createCombat,
  createRngState,
  effectHooks,
  type Fighter,
  fighterById,
  fighterFromData,
  type FighterInit,
  fighterStartValues,
  frontArenaSize,
  type GameEvent,
  loadGameData,
  nextInt,
  type OffsetCoord,
  type PlayerIndex,
  type RngState,
  simulateCombat,
  stepCombat,
  stunFighter,
} from "@game/engine";
import { type CombatReplay, combatReplays, replayFrameAt } from "./combatReplay";

/**
 * P15 (R-19.2, R-9.3): Die Wiedergabe übernimmt Betäubungsende und HP-Buffs aus den Ereignissen, statt sie
 * nachzurechnen. Hier wird ihr Endbild gegen das Ergebnis von `simulateCombat` gehalten.
 */
const data = loadGameData();
const SIZE = frontArenaSize(data.config.arenas.frontZone);
const ARENA = "front:0-1";
const base = { round: 1, phase: "combat" as const };

/** Protokoll eines Kampfs wie in `fronts.ts`: `combat_started`, dann die Tick-Ereignisse mit Arena. */
function logOf(inits: readonly FighterInit[], events: CombatResult["events"]): GameEvent[] {
  return [
    {
      ...base,
      type: "combat_started",
      arena: ARENA,
      players: [0, 1],
      fighters: inits.map((f) => ({ unitId: f.id, player: f.team as PlayerIndex, sourceId: f.sourceId, cell: { ...f.pos }, ...fighterStartValues(f) })),
    },
    ...events.map((e) => ({ ...base, ...e, arena: ARENA }) as GameEvent),
  ];
}

function only(replays: CombatReplay[]): CombatReplay {
  expect(replays).toHaveLength(1);
  return replays[0] as CombatReplay;
}

/** Zufällige Aufstellung aus Einheitenkarten und Anführern (Sterne 1–3, manchmal Schild, Anführer mit vollem Mana). */
function randomArmies(rng: RngState): FighterInit[] {
  const units = [...data.cards.values()].filter((c) => c.type === "unit").map((c) => c.id);
  const leaders = [...data.leaders.keys()];
  const inits: FighterInit[] = [];
  let id = 1;
  for (const team of [0, 1]) {
    const rows = team === 0 ? [0, 1, 2] : [3, 4, 5];
    const cells: OffsetCoord[] = [];
    for (const row of rows) for (let col = 0; col < SIZE.cols; col++) cells.push({ col, row });
    const count = 2 + nextInt(rng, 5);
    for (let i = 0; i < count && cells.length > 0; i++) {
      const pos = cells.splice(nextInt(rng, cells.length), 1)[0] as OffsetCoord;
      const isLeader = i === 0;
      const sourceId = isLeader ? (leaders[nextInt(rng, leaders.length)] as string) : (units[nextInt(rng, units.length)] as string);
      const stars = (1 + nextInt(rng, 3)) as 1 | 2 | 3;
      const shield = nextInt(rng, 4) === 0 ? 1 + nextInt(rng, 4) : undefined;
      inits.push(
        fighterFromData(data, {
          id: id++,
          team,
          kind: isLeader ? "leader" : "card",
          sourceId,
          stars,
          pos,
          ...(isLeader ? { startMana: 100 } : {}),
          ...(shield !== undefined ? { shield } : {}),
        }),
      );
    }
  }
  return inits;
}

/** Endbild der Wiedergabe = Ergebnis der Simulation: Überlebende, Leben, Maximum, Schild, Betäubung. */
function expectEndMatches(replay: CombatReplay, result: CombatResult): void {
  const end = replayFrameAt(replay, replay.endTick);
  expect(replay.endTick).toBe(result.ticks);
  expect(end.filter((f) => f.alive).map((f) => f.unitId)).toEqual([...result.survivors].sort((a, b) => a - b));
  expect(end.map((f) => f.unitId)).toEqual(result.fighters.map((f) => f.id).sort((a, b) => a - b));
  for (const f of result.fighters) {
    const shown = end.find((x) => x.unitId === f.id);
    expect(shown?.alive, `Einheit ${f.id} lebt`).toBe(f.alive);
    if (!shown || !f.alive) continue;
    expect([shown.hp, shown.maxHp, shown.shield], `Einheit ${f.id}`).toEqual([f.hp, f.maxHp, f.shield]);
    // Betäubt über das Kampfende hinaus genau dann, wenn die Engine noch Betäubungs-Züge übrig hat.
    expect((shown.stunnedUntil ?? -1) > f.lastTurnTick, `Einheit ${f.id} betäubt`).toBe(f.stun > 0);
    if (f.stun > 0) expect(shown.stunnedUntil).toBe(f.lastTurnTick + f.stun);
  }
}

describe("P15: Kampfwerte der Wiedergabe aus Ereignissen (R-19.2, R-9.3)", () => {
  it("R-19.2: Endbild jeder Wiedergabe stimmt mit `simulateCombat` überein (hp, maxHp, Schild, Betäubung, Überlebende)", () => {
    let stuns = 0;
    let lateStuns = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rng = createRngState(seed);
      const inits = randomArmies(rng);
      const result = simulateCombat(data.config, SIZE, inits, effectHooks(data).hooks, 100);
      const stunEvents = result.events.filter((e) => e.type === "combat_unit_stunned");
      stuns += stunEvents.length;
      lateStuns += stunEvents.filter((e) => e.tick > 0).length;
      expectEndMatches(only(combatReplays(data, logOf(inits, result.events))), result);
    }
    // Die Seeds decken Betäubungen im laufenden Kampf ab (Brann, Schildstoß).
    expect(stuns).toBeGreaterThan(10);
    expect(lateStuns).toBeGreaterThan(10);
  });

  it("R-9.3: kurze Betäubung auf ein schon länger betäubtes Ziel – das Bild folgt der Engine in jedem Tick", () => {
    // Einheit 2 ist zu Kampfbeginn 12 Ticks betäubt, in Tick 3 kommen 2 Ticks dazu (zählt nicht, das längere gilt),
    // in Tick 20 noch einmal 4 Ticks (nach Ablauf, gilt neu).
    const hooks: CombatHooks = {
      onCombatStart: (sim, f) => {
        if (f.id === 2) stunFighter(sim, f, 12);
      },
    };
    const inits: FighterInit[] = [
      fighterFromData(data, { id: 1, team: 0, kind: "card", sourceId: "recruit", stars: 3, pos: { col: 2, row: 1 } }),
      fighterFromData(data, { id: 2, team: 1, kind: "card", sourceId: "recruit", stars: 3, pos: { col: 2, row: 4 } }),
    ].map((f) => ({ ...f, stats: { ...f.stats, attack: 0, hp: 1000 } }));
    const sim: CombatSim = createCombat({ ...data.config, combat: { ...data.config.combat, maxTicks: 40 } }, SIZE, inits, hooks);
    const target = fighterById(sim, 2) as Fighter;
    const stunnedAfter: boolean[] = [];
    while (stepCombat(sim)) {
      if (sim.tick === 3) stunFighter(sim, target, 2);
      if (sim.tick === 20) stunFighter(sim, target, 4);
      stunnedAfter[sim.tick] = target.stun > 0;
    }
    const events = sim.events;
    expect(events.filter((e) => e.type === "combat_unit_stunned").map((e) => [e.tick, e.ticks, e.untilTick])).toEqual([
      [0, 12, 12],
      [3, 2, 12],
      [20, 4, 24],
    ]);
    const replay = only(combatReplays(data, logOf(inits, events)));
    for (let tick = 1; tick < stunnedAfter.length; tick++) {
      const shown = replayFrameAt(replay, tick).find((f) => f.unitId === 2);
      // Nach Tick `tick` noch betäubt ⇔ das Bild zeigt eine Betäubung über diesen Tick hinaus.
      expect((shown?.stunnedUntil ?? -1) > tick, `Tick ${tick}`).toBe(stunnedAfter[tick]);
    }
    // Die alte Nachrechnung (Tick + ticks − 1) hätte nach Tick 4 das Ende gezeigt.
    expect(replayFrameAt(replay, 6).find((f) => f.unitId === 2)?.stunnedUntil).toBe(12);
  });

  it("R-19.2: HP-Buff im Kampf – das Bild übernimmt neue `hp` und `maxHp` aus `combat_buffed`", () => {
    const log: GameEvent[] = [
      {
        ...base,
        type: "combat_started",
        arena: ARENA,
        players: [0, 1],
        fighters: [
          { unitId: 1, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 3, maxHp: 5, shield: 0 },
          { unitId: 2, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 5, maxHp: 5, shield: 0 },
        ],
      },
      { ...base, type: "combat_buffed", arena: ARENA, tick: 2, source: 2, target: 1, stat: "hp", amount: 3, value: 8, hp: 6, maxHp: 8 },
      { ...base, type: "combat_buffed", arena: ARENA, tick: 3, source: 2, target: 1, stat: "attack", amount: 1, value: 3 },
      { ...base, type: "combat_ended", arena: ARENA, tick: 4, winner: null, survivors: [1, 2] },
    ];
    const replay = only(combatReplays(data, log));
    const at = (tick: number) => replayFrameAt(replay, tick).find((f) => f.unitId === 1);
    expect(at(1)).toMatchObject({ hp: 3, maxHp: 5 });
    expect(at(2)).toMatchObject({ hp: 6, maxHp: 8 });
    expect(at(4)).toMatchObject({ hp: 6, maxHp: 8 });
  });
});
