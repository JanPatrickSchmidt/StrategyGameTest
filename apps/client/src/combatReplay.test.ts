import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView } from "@game/engine";
import {
  BASE_TICKS_PER_SECOND,
  type CombatReplay,
  combatReplays,
  END_PAUSE_MS,
  ReplayPlayer,
  replayFrameAt,
  replayShape,
  stepsAt,
} from "./combatReplay";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();

/** Partie mit Autopilot über einige Runden; Protokoll aus Sicht des Menschen (R-19.3). */
function playedLog(seed: number, rounds: number): GameEvent[] {
  const session = new GameSession(data, { seed });
  for (let i = 0; i < rounds && session.status === "waitingForHuman"; i++) session.autopilot();
  return playerView(session.state, HUMAN).log;
}

const base = { round: 1, phase: "combat" as const };
const ARENA = "front:0-1";

/** Kleiner Kampf von Hand: Rekrut (1) gegen Rekrut (2), Bewegung, Treffer mit Schild, Beschwörung, Tod. */
function handLog(): GameEvent[] {
  return [
    { ...base, type: "phase_started", phase: "combat" },
    {
      ...base,
      type: "combat_started",
      arena: ARENA,
      players: [0, 1],
      fighters: [
        { unitId: 1, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 2, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 3, maxHp: 3, shield: 2 },
      ],
    },
    { ...base, type: "combat_target_changed", arena: ARENA, tick: 1, unit: 1, target: 2 },
    { ...base, type: "combat_unit_moved", arena: ARENA, tick: 1, unit: 1, from: { col: 1, row: 2 }, to: { col: 2, row: 3 } },
    { ...base, type: "combat_attack", arena: ARENA, tick: 3, unit: 1, target: 2 },
    { ...base, type: "combat_damage", arena: ARENA, tick: 3, source: 1, target: 2, kind: "attack", amount: 2, absorbed: 2, hpLoss: 0, hp: 3 },
    { ...base, type: "combat_mana_gained", arena: ARENA, tick: 3, source: 1, target: 2, amount: 10, mana: 10 },
    { ...base, type: "combat_unit_stunned", arena: ARENA, tick: 4, unit: 1, ticks: 2, untilTick: 5 },
    {
      ...base,
      type: "combat_unit_summoned",
      arena: ARENA,
      tick: 5,
      unit: 9,
      team: 1,
      sourceId: "skeleton",
      cell: { col: 4, row: 4 },
      summoner: 2,
      hp: 1,
      maxHp: 1,
      shield: 0,
    },
    { ...base, type: "combat_attack", arena: ARENA, tick: 13, unit: 1, target: 2 },
    { ...base, type: "combat_damage", arena: ARENA, tick: 13, source: 1, target: 2, kind: "attack", amount: 4, absorbed: 0, hpLoss: 3, hp: -1 },
    { ...base, type: "combat_unit_died", arena: ARENA, tick: 13, unit: 2, killer: 1 },
    { ...base, type: "combat_unit_died", arena: ARENA, tick: 14, unit: 9, killer: 1 },
    { ...base, type: "combat_ended", arena: ARENA, tick: 14, winner: 0, survivors: [1] },
    {
      ...base,
      type: "front_resolved",
      arena: ARENA,
      first: 0,
      second: 1,
      outcome: "combat",
      winner: 0,
      survivors: [1],
      winnerBreakthrough: 1,
    },
  ] as GameEvent[];
}

function only(replays: CombatReplay[]): CombatReplay {
  expect(replays).toHaveLength(1);
  return replays[0] as CombatReplay;
}

describe("C4a: Kampfwiedergabe aus dem Ereignisprotokoll", () => {
  it("C4a: Startaufstellung, Kampfende und Sieger kommen aus `combat_started` und `combat_ended`", () => {
    const replay = only(combatReplays(data, handLog()));
    expect(replay).toMatchObject({ arena: ARENA, round: 1, players: [0, 1], endTick: 14, winner: 0, survivors: [1] });
    expect(replay.start.map((f) => [f.unitId, f.player, f.shape, f.hp, f.maxHp, f.shield])).toEqual([
      [1, 0, "melee", 3, 3, 0],
      [2, 1, "melee", 3, 3, 2],
    ]);
  });

  it("C4a: Schritte sind nach Tick gruppiert; Zielwechsel und Mana erzeugen keinen sichtbaren Schritt", () => {
    const replay = only(combatReplays(data, handLog()));
    expect(replay.ticks.map((t) => [t.tick, t.steps.map((s) => s.kind)])).toEqual([
      [1, ["move"]],
      [3, ["attack", "damage"]],
      [4, ["stun"]],
      [5, ["summon"]],
      [13, ["attack", "damage", "death"]],
      [14, ["death"]],
    ]);
    expect(stepsAt(replay, 3)[1]).toMatchObject({ kind: "damage", amount: 2, absorbed: 2, hpLoss: 0, damageKind: "attack" });
    expect(stepsAt(replay, 2)).toEqual([]);
  });

  it("C4a: das Bild zu einem Tick zeigt Ort, Leben, Schild, Betäubung, Beschworene und Tote", () => {
    const replay = only(combatReplays(data, handLog()));
    const at = (tick: number, id: number) => replayFrameAt(replay, tick).find((f) => f.unitId === id);
    expect(at(-1, 1)?.cell).toEqual({ col: 1, row: 2 });
    expect(at(1, 1)?.cell).toEqual({ col: 2, row: 3 });
    expect(at(3, 2)).toMatchObject({ hp: 3, shield: 0, alive: true });
    expect(at(4, 1)?.stunnedUntil).toBe(5);
    expect(at(6, 1)?.stunnedUntil).toBeNull();
    expect(at(4, 9)).toBeUndefined();
    expect(at(5, 9)).toMatchObject({ player: 1, summoned: true, shape: "token", hp: 1, cell: { col: 4, row: 4 } });
    expect(at(13, 2)).toMatchObject({ alive: false, hp: -1 });
    const end = replayFrameAt(replay, replay.endTick);
    expect(end.filter((f) => f.alive).map((f) => f.unitId)).toEqual(replay.survivors);
  });

  it("C4a: Form der Figur aus den festen Daten (Anführer, Fernkampf, Nahkampf, Token)", () => {
    const leader = [...data.leaders.keys()][0] as string;
    const ranged = [...data.cards.values()].find((c) => c.type === "unit" && c.stats.range > 1);
    expect(replayShape(data, leader, false)).toBe("leader");
    expect(replayShape(data, ranged?.id ?? "", false)).toBe("ranged");
    expect(replayShape(data, "recruit", false)).toBe("melee");
    expect(replayShape(data, "recruit", true)).toBe("token");
    expect(replayShape(data, "unknown", false)).toBe("token");
  });

  it("C4a: Rundenfilter und abgeschnittenes Protokoll (ohne `combat_ended`) ergeben keine Wiedergabe", () => {
    expect(combatReplays(data, handLog(), 2)).toEqual([]);
    const cut = handLog().filter((e) => e.type !== "combat_ended");
    expect(combatReplays(data, cut)).toEqual([]);
  });

  it("R-19.2: die Wiedergabe entsteht nur aus dem Ereignisprotokoll (serialisiertes Protokoll genügt)", () => {
    const log = playedLog(3, 4);
    const fromLog = combatReplays(data, log);
    // Nur die Ereignisse als JSON, kein Spielzustand: dasselbe Ergebnis.
    const fromJson = combatReplays(data, JSON.parse(JSON.stringify(log)) as GameEvent[]);
    expect(fromJson).toEqual(fromLog);
    expect(fromLog.length).toBeGreaterThan(0);
    // Jeder simulierte Kampf des Protokolls ist genau einmal dabei, in Protokollreihenfolge.
    const started = log.filter((e) => e.type === "combat_started").map((e) => `${e.round}/${"arena" in e ? e.arena : ""}`);
    expect(fromLog.map((r) => `${r.round}/${r.arena}`)).toEqual(started);
  });

  it("R-19.2: Endbild jeder Wiedergabe passt zum Ergebnis im Protokoll (Überlebende, Lebenspunkte aus Schadensereignissen)", () => {
    for (const seed of [3, 5, 8]) {
      const log = playedLog(seed, 6);
      for (const replay of combatReplays(data, log)) {
        const end = replayFrameAt(replay, replay.endTick);
        expect(end.filter((f) => f.alive).map((f) => f.unitId).sort((a, b) => a - b)).toEqual([...replay.survivors].sort((a, b) => a - b));
        // Lebenspunkte im Endbild = letzter Wert aus `combat_damage`/`combat_healed` für diese Einheit, sonst Startwert.
        for (const f of end) {
          const last = log
            .filter(
              (e): e is Extract<GameEvent, { type: "combat_damage" | "combat_healed" }> =>
                (e.type === "combat_damage" || e.type === "combat_healed") && e.round === replay.round && e.arena === replay.arena && e.target === f.unitId,
            )
            .at(-1);
          const start = [...replay.start, ...replay.summons].find((s) => s.unitId === f.unitId);
          if (f.alive) expect(f.hp).toBe(last ? last.hp : start?.hp);
        }
      }
    }
  });

  it("R-19.2: ein geändertes Ereignis ändert die Wiedergabe (keine zweite Quelle)", () => {
    const log = handLog();
    const changed = log.map((e) =>
      e.type === "combat_unit_moved" ? { ...e, to: { col: 0, row: 0 } } : e.type === "combat_damage" && e.tick === 3 ? { ...e, absorbed: 1, hpLoss: 1, hp: 2 } : e,
    );
    const a = replayFrameAt(only(combatReplays(data, log)), 3);
    const b = replayFrameAt(only(combatReplays(data, changed)), 3);
    expect(b.find((f) => f.unitId === 1)?.cell).toEqual({ col: 0, row: 0 });
    expect(b.find((f) => f.unitId === 2)).toMatchObject({ hp: 2, shield: 1 });
    expect(a).not.toEqual(b);
  });
});

describe("C4a: Abspielen mit wählbarer Geschwindigkeit und Überspringen", () => {
  const twoFights = (): CombatReplay[] => {
    const first = only(combatReplays(data, handLog()));
    return [first, { ...first, arena: "front:1-2", endTick: 4 }];
  };
  const msPerTick = 1000 / BASE_TICKS_PER_SECOND;

  it("C4a: Ticks laufen mit der Grundgeschwindigkeit, Start bei der Aufstellung (Tick −1)", () => {
    const player = new ReplayPlayer(twoFights());
    expect(player.position()).toEqual({ index: 0, tick: -1, fraction: 0 });
    const reached = player.advance(msPerTick * 2.5);
    expect(reached).toEqual([
      { index: 0, tick: 0 },
      { index: 0, tick: 1 },
    ]);
    expect(player.position().tick).toBe(1);
    expect(player.position().fraction).toBeCloseTo(0.5);
    expect(player.frame().find((f) => f.unitId === 1)?.cell).toEqual({ col: 2, row: 3 });
  });

  it("C4a: doppelte Geschwindigkeit erreicht in derselben Zeit doppelt so viele Ticks, halbe halb so viele", () => {
    const fast = new ReplayPlayer(twoFights());
    fast.setSpeed(2);
    fast.advance(msPerTick * 4);
    const slow = new ReplayPlayer(twoFights());
    slow.setSpeed(0.5);
    slow.advance(msPerTick * 4);
    expect(fast.position().tick).toBe(7);
    expect(slow.position().tick).toBe(1);
    expect(() => fast.setSpeed(3 as 1)).toThrow(RangeError);
  });

  it("C4a: nach dem letzten Tick hält der Kampf kurz, dann beginnt der nächste; danach ist die Wiedergabe fertig", () => {
    const player = new ReplayPlayer(twoFights());
    player.advance(msPerTick * 15);
    expect(player.position()).toEqual({ index: 0, tick: 14, fraction: 0 });
    player.advance(END_PAUSE_MS);
    expect(player.position()).toEqual({ index: 1, tick: -1, fraction: 0 });
    player.advance(msPerTick * 5 + END_PAUSE_MS);
    expect(player.finished).toBe(true);
    expect(player.position().index).toBeNull();
    expect(player.frame()).toEqual([]);
  });

  it("C4a: Überspringen zeigt das Endbild des laufenden Kampfs, zweimal Überspringen geht zum nächsten", () => {
    const player = new ReplayPlayer(twoFights());
    player.skipCurrent();
    expect(player.position()).toEqual({ index: 0, tick: 14, fraction: 0 });
    expect(player.frame().filter((f) => f.alive).map((f) => f.unitId)).toEqual([1]);
    player.skipCurrent();
    expect(player.position()).toEqual({ index: 1, tick: -1, fraction: 0 });
    player.skipAll();
    expect(player.finished).toBe(true);
  });

  it("C4a: über mehrere Kämpfe hinweg werden die erreichten Ticks je Kampf gemeldet", () => {
    const player = new ReplayPlayer(twoFights());
    const reached = player.advance(msPerTick * 15 + END_PAUSE_MS + msPerTick * 1);
    expect(reached.filter((r) => r.index === 0)).toHaveLength(15);
    expect(reached.filter((r) => r.index === 1)).toEqual([{ index: 1, tick: 0 }]);
  });
});

describe("C4c1: Abspielen in krummen Zeitschritten", () => {
  it("R-19.2: ReplayPlayer endet auch bei Bildzeiten wie 137 ms oder 16,7 ms (Rundungsrest bleibt nicht hängen)", () => {
    const log = playedLog(3, 6);
    for (const round of [2, 3, 4]) {
      for (const ms of [137, 1000 / 60, 1000 / 30, 7.3]) {
        const player = new ReplayPlayer(combatReplays(data, log, round));
        let steps = 0;
        while (!player.finished && steps < 100_000) {
          player.advance(ms);
          steps++;
        }
        expect(player.finished).toBe(true);
      }
    }
  });
});
