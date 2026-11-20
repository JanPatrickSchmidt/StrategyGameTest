import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView } from "@game/engine";
import { buildBoardLayout, cellOf, frontPairsFor } from "./boardLayout";
import { BASE_TICKS_PER_SECOND, combatReplays, ReplayPlayer } from "./combatReplay";
import {
  activeFighters,
  arenaCellPosition,
  arenaFocus,
  arenaName,
  DEATH_FADE_TICKS,
  fighterBadgeText,
  replayStatusText,
  roundFighters,
} from "./replayAnimation";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);
const base = { round: 1, phase: "combat" as const };
const FRONT = "front:0-1";

/** Zwei Kämpfe von Hand: an der Front bewegt sich Einheit 1 und besiegt Einheit 2; in der Mitte steht Einheit 5 allein gegen 6. */
function handLog(): GameEvent[] {
  return [
    {
      ...base,
      type: "combat_started",
      arena: FRONT,
      players: [0, 1],
      fighters: [
        { unitId: 1, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 2, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 3, maxHp: 3, shield: 2 },
      ],
    },
    { ...base, type: "combat_unit_moved", arena: FRONT, tick: 1, unit: 1, from: { col: 1, row: 2 }, to: { col: 2, row: 3 } },
    { ...base, type: "combat_damage", arena: FRONT, tick: 3, source: 1, target: 2, kind: "attack", amount: 2, absorbed: 2, hpLoss: 0, hp: 3 },
    { ...base, type: "combat_unit_stunned", arena: FRONT, tick: 4, unit: 2, ticks: 2 },
    { ...base, type: "combat_damage", arena: FRONT, tick: 13, source: 1, target: 2, kind: "attack", amount: 4, absorbed: 0, hpLoss: 3, hp: -1 },
    { ...base, type: "combat_unit_died", arena: FRONT, tick: 13, unit: 2, killer: 1 },
    { ...base, type: "combat_ended", arena: FRONT, tick: 30, winner: 0, survivors: [1] },
    {
      ...base,
      type: "combat_started",
      arena: "center",
      players: [2, 3],
      fighters: [
        { unitId: 5, player: 2, sourceId: "recruit", cell: { col: 0, row: 0 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 6, player: 3, sourceId: "recruit", cell: { col: 6, row: 6 }, hp: 3, maxHp: 3, shield: 0 },
      ],
    },
    { ...base, type: "combat_unit_died", arena: "center", tick: 2, unit: 6, killer: 5 },
    { ...base, type: "combat_ended", arena: "center", tick: 2, winner: 2, survivors: [5] },
  ] as GameEvent[];
}

const replays = combatReplays(data, handLog());
const front = replays[0]!;

describe("C4c1: Figuren der Kampfwiedergabe auf dem Brett", () => {
  it("R-19.2: Startaufstellung steht genau auf den Feldern der Arena aus `combat_started`", () => {
    const figures = activeFighters(layout, front, -1, 0);
    const arena = layout.arenas.find((a) => a.id === FRONT)!;
    expect(figures.map((f) => f.position)).toEqual([cellOf(arena, { col: 1, row: 2 })!.position, cellOf(arena, { col: 3, row: 3 })!.position]);
    expect(figures.every((f) => f.opacity === 1 && f.active && f.arena === FRONT)).toBe(true);
  });

  it("C4c1: Bewegung gleitet zwischen zwei Ticks vom alten zum neuen Feld", () => {
    const from = arenaCellPosition(layout, FRONT, { col: 1, row: 2 })!;
    const to = arenaCellPosition(layout, FRONT, { col: 2, row: 3 })!;
    const mover = (tick: number, fraction: number) => activeFighters(layout, front, tick, fraction).find((f) => f.unitId === 1)!.position;
    expect(mover(0, 0)).toEqual(from);
    const mid = mover(0, 0.5);
    expect(mid.x).toBeCloseTo((from.x + to.x) / 2);
    expect(mid.z).toBeCloseTo((from.z + to.z) / 2);
    expect(mover(1, 0)).toEqual(to);
    expect(mover(1, 0.7)).toEqual(to);
  });

  it("C4c1: Leben, Schild und Betäubung kommen aus dem Bild des Ticks", () => {
    const enemy = (tick: number) => activeFighters(layout, front, tick, 0).find((f) => f.unitId === 2)!;
    expect(enemy(2)).toMatchObject({ hp: 3, shield: 2, stunned: false });
    expect(enemy(3)).toMatchObject({ hp: 3, shield: 0 });
    expect(enemy(4).stunned).toBe(true);
    expect(fighterBadgeText(enemy(2))).toBe("3♥ (+2)");
    expect(fighterBadgeText(enemy(4))).toBe("3♥ zZ");
    expect(fighterBadgeText({ hp: -1, shield: 0, stunned: false })).toBe("0♥");
  });

  it("C4c1: Gestorbene blenden ab dem Tick vor ihrem Tod aus und verschwinden dann", () => {
    const opacity = (tick: number, fraction = 0) => activeFighters(layout, front, tick, fraction).find((f) => f.unitId === 2)?.opacity;
    expect(opacity(11)).toBe(1);
    expect(opacity(12)).toBe(1);
    expect(opacity(13)).toBeCloseTo(1 - 1 / DEATH_FADE_TICKS);
    expect(opacity(12 + DEATH_FADE_TICKS / 2)).toBeCloseTo(0.5);
    expect(opacity(12 + DEATH_FADE_TICKS)).toBeUndefined();
    expect(opacity(30)).toBeUndefined();
  });

  it("C4c1: gespielte Kämpfe im Endbild, laufender animiert, kommende in der Startaufstellung", () => {
    const during = roundFighters(layout, replays, { index: 0, tick: 1, fraction: 0 });
    expect(during.map((f) => [f.arena, f.unitId, f.active])).toEqual([
      [FRONT, 1, true],
      [FRONT, 2, true],
      ["center", 5, false],
      ["center", 6, false],
    ]);
    const later = roundFighters(layout, replays, { index: 1, tick: -1, fraction: 0 });
    expect(later.map((f) => [f.arena, f.unitId, f.active])).toEqual([
      [FRONT, 1, false],
      ["center", 5, true],
      ["center", 6, true],
    ]);
    expect(later[0]!.position).toEqual(arenaCellPosition(layout, FRONT, { col: 2, row: 3 }));
    expect(roundFighters(layout, replays, { index: null, tick: 0, fraction: 0 })).toEqual([]);
  });

  it("C4c1: Statuszeile, Arenanamen und Kamera-Ziel", () => {
    expect(arenaName("center", HUMAN)).toBe("Mitte");
    expect(arenaName("front:3-0", HUMAN)).toBe("Bot 4 – Du");
    expect(replayStatusText(replays, { index: 0, tick: 9, fraction: 0.5 }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Kampf 1 von 2: Du – Bot 2 · 0,5 s von 1,5 s");
    expect(replayStatusText(replays, { index: 0, tick: -1, fraction: 0 }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Kampf 1 von 2: Du – Bot 2 · 0,0 s von 1,5 s");
    expect(replayStatusText(replays, { index: null, tick: 0, fraction: 0 }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Wiedergabe beendet.");
    expect(replayStatusText([], { index: null, tick: 0, fraction: 0 }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Keine Kämpfe in dieser Runde.");
    const focus = arenaFocus(layout, FRONT)!;
    expect(focus.target).toEqual(layout.arenas.find((a) => a.id === FRONT)!.center);
    expect(focus.radius).toBeGreaterThan(10);
    expect(arenaFocus(layout, "front:9-9")).toBeNull();
  });
});

/** Partie mit Autopilot; Protokoll aus Sicht des Menschen (R-19.3). */
function playedSession(seed: number, rounds: number): GameSession {
  const session = new GameSession(data, { seed });
  for (let i = 0; i < rounds && session.status === "waitingForHuman"; i++) session.autopilot();
  return session;
}

describe("C4c1: Wiedergabe echter Bot-Runden", () => {
  it("R-19.2: jede Figur steht während der ganzen Wiedergabe auf oder zwischen Feldern ihrer Arena, auch aus serialisiertem Protokoll", () => {
    let checkedFrames = 0;
    for (const seed of [3, 8]) {
      const session = playedSession(seed, 6);
      const log = playerView(session.state, HUMAN).log;
      const rounds = [...new Set(log.filter((e) => e.type === "combat_started").map((e) => e.round))];
      for (const round of rounds) {
        // Brett der Runde: Front-Paarungen vor der Runde (ausgeschieden ist, wer vorher schon raus war).
        const before = new Set(log.filter((e) => e.type === "player_eliminated" && e.round < round).map((e) => ("player" in e ? e.player : -1)));
        const roundLayout = buildBoardLayout(layout.config, frontPairsFor(([0, 1, 2, 3] as const).map((p) => before.has(p))), 4);
        const own = combatReplays(data, log, round);
        expect(combatReplays(data, JSON.parse(JSON.stringify(log)) as GameEvent[], round)).toEqual(own);
        const player = new ReplayPlayer(own);
        const ids = new Set(own.flatMap((r) => [...r.start, ...r.summons].map((f) => `${r.arena}:${f.unitId}`)));
        while (!player.finished) {
          const figures = roundFighters(roundLayout, own, player.position());
          for (const f of figures) {
            expect(ids.has(`${f.arena}:${f.unitId}`)).toBe(true);
            const arena = roundLayout.arenas.find((a) => a.id === f.arena)!;
            const nearest = Math.min(...arena.cells.map((c) => Math.hypot(c.position.x - f.position.x, c.position.z - f.position.z)));
            // Höchstens ein halbes Feld neben einem Feld (zwischen zwei Nachbarfeldern unterwegs).
            expect(nearest).toBeLessThanOrEqual(0.9);
            expect(f.opacity).toBeGreaterThan(0);
          }
          // Jede Figur nur einmal.
          expect(new Set(figures.map((f) => `${f.arena}:${f.unitId}`)).size).toBe(figures.length);
          checkedFrames++;
          player.advance(137);
        }
      }
    }
    expect(checkedFrames).toBeGreaterThan(50);
  });
});
