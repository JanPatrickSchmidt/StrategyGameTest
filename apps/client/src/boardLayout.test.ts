import { describe, expect, it } from "vitest";
import {
  createGame,
  frontPairings,
  frontToArena,
  hexDistance,
  loadGameData,
  type PlayerIndex,
  type UnitLocation,
} from "@game/engine";
import {
  buildBoardLayout,
  frontPairsFor,
  type LayoutConfig,
  locationPosition,
  seatAngle,
  SQRT3,
  type WorldPoint,
} from "./boardLayout";
import { GameSession } from "./session";

const data = loadGameData();
const config: LayoutConfig = {
  frontZone: data.config.arenas.frontZone,
  centerArena: data.config.arenas.centerArena,
  centerStartSlots: data.config.arenas.centerStartSlots,
  reserveSlots: data.config.reserveSlots,
  hexSize: 1,
};
const STEP = SQRT3 * config.hexSize;
const EPS = 1e-9;
const ALL: PlayerIndex[] = [0, 1, 2, 3];

function dist(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function eliminationMasks(): boolean[][] {
  return Array.from({ length: 16 }, (_, m) => ALL.map((p) => ((m >> p) & 1) === 1));
}

const fullLayout = buildBoardLayout(config, frontPairsFor([false, false, false, false]));

describe("C2a: Brett-Aufteilung", () => {
  it("R-2.3, R-2.5: Front-Paarungen aus der Sicht stimmen für jede Kombination Ausgeschiedener mit der Engine überein", () => {
    for (const mask of eliminationMasks()) {
      const state = createGame(data, undefined, 1);
      for (const p of ALL) state.players[p]!.eliminated = mask[p]!;
      expect(frontPairsFor(mask)).toEqual(frontPairings(state));
    }
  });

  it("R-2.1: Sitz-Ecken liegen oben links, oben rechts, unten rechts, unten links", () => {
    const [s0, s1, s2, s3] = fullLayout.seatCorners as [WorldPoint, WorldPoint, WorldPoint, WorldPoint];
    expect(s0.x < 0 && s0.z > 0).toBe(true);
    expect(s1.x > 0 && s1.z > 0).toBe(true);
    expect(s2.x > 0 && s2.z < 0).toBe(true);
    expect(s3.x < 0 && s3.z < 0).toBe(true);
  });

  it("C2a: bei 4 Spielern gibt es die Mittelarena und vier Frontarenen an den vier Kanten", () => {
    expect(fullLayout.arenas.map((a) => a.id)).toEqual(["center", "front:0-1", "front:1-2", "front:2-3", "front:3-0"]);
    expect(fullLayout.arenas.filter((a) => a.kind === "front").map((a) => a.edge)).toEqual([0, 1, 2, 3]);
    const center = fullLayout.arenas[0]!;
    expect(center.cells).toHaveLength(config.centerArena.cols * config.centerArena.rows);
    for (const arena of fullLayout.arenas.slice(1)) expect(arena.cells).toHaveLength(config.frontZone.cols * config.frontZone.rows * 2);
  });

  it("R-3.2, R-3.4: Nachbarfelder liegen genau eine Hexbreite auseinander, alle anderen weiter", () => {
    for (const arena of fullLayout.arenas) {
      for (const a of arena.cells) {
        for (const b of arena.cells) {
          if (a === b) continue;
          const d = dist(a.position, b.position);
          if (hexDistance(a.coord, b.coord) === 1) expect(Math.abs(d - STEP)).toBeLessThan(EPS);
          else expect(d).toBeGreaterThan(STEP + 0.5);
        }
      }
    }
  });

  it("C2a: Felder verschiedener Arenen und Reserve-Plätze überlappen nicht", () => {
    const points: { arena: string; p: WorldPoint }[] = [];
    for (const arena of fullLayout.arenas) for (const c of arena.cells) points.push({ arena: arena.id, p: c.position });
    for (const owner of ALL) {
      for (let slot = 0; slot < config.reserveSlots; slot++) {
        points.push({ arena: `reserve:${owner}`, p: locationPosition(fullLayout, owner, { zone: "reserve", slot })! });
      }
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (points[i]!.arena === points[j]!.arena) continue;
        expect(dist(points[i]!.p, points[j]!.p)).toBeGreaterThan(STEP);
      }
    }
  });

  it("R-3.2: rechte Zone von p und linke Zone des rechten Nachbarn liegen in derselben Arena, Gegnerzone um 180° gedreht", () => {
    for (const arena of fullLayout.arenas.filter((a) => a.kind === "front")) {
      const { first, second } = arena.pair!;
      for (let col = 0; col < config.frontZone.cols; col++) {
        for (let row = 0; row < config.frontZone.rows; row++) {
          const own = locationPosition(fullLayout, first, { zone: "right", cell: { col, row } })!;
          const expectedOwn = arena.cells.find((c) => c.coord.col === col && c.coord.row === row)!;
          expect(own).toEqual(expectedOwn.position);
          expect(expectedOwn.owner).toBe(first);
          const enemy = locationPosition(fullLayout, second, { zone: "left", cell: { col, row } })!;
          const mirrored = frontToArena("second", { col, row }, config.frontZone);
          const expectedEnemy = arena.cells.find((c) => c.coord.col === mirrored.col && c.coord.row === mirrored.row)!;
          expect(enemy).toEqual(expectedEnemy.position);
          expect(expectedEnemy.owner).toBe(second);
        }
      }
      // Zeile 2 beider Zonen grenzt an die Front: Abstand quer über die Front eine Zeile.
      const frontRowOwn = locationPosition(fullLayout, first, { zone: "right", cell: { col: 2, row: 2 } })!;
      const frontRowEnemy = locationPosition(fullLayout, second, { zone: "left", cell: { col: 2, row: 2 } })!;
      expect(dist(frontRowOwn, frontRowEnemy)).toBeLessThan(STEP * 1.01);
      // Jede Zone liegt auf der Seite ihres Besitzers.
      const back = locationPosition(fullLayout, first, { zone: "right", cell: { col: 2, row: 0 } })!;
      const enemyBack = locationPosition(fullLayout, second, { zone: "left", cell: { col: 2, row: 0 } })!;
      expect(dist(back, fullLayout.seatCorners[first]!)).toBeLessThan(dist(enemyBack, fullLayout.seatCorners[first]!));
      expect(dist(enemyBack, fullLayout.seatCorners[second]!)).toBeLessThan(dist(back, fullLayout.seatCorners[second]!));
    }
  });

  it("R-3.4: der Startbereich jedes Sitzes in der Mittelarena zeigt zu seiner Ecke", () => {
    for (const owner of ALL) {
      for (let position = 0; position < config.centerStartSlots; position++) {
        const p = locationPosition(fullLayout, owner, { zone: "center", position })!;
        const towardOwn = p.x * Math.cos(seatAngle(owner)) + p.z * Math.sin(seatAngle(owner));
        expect(towardOwn).toBeGreaterThan(4);
        for (const other of ALL.filter((o) => o !== owner)) {
          expect(dist(p, fullLayout.seatCorners[owner]!)).toBeLessThan(dist(p, fullLayout.seatCorners[other]!));
        }
      }
      const center = fullLayout.arenas[0]!;
      expect(center.cells.filter((c) => c.owner === owner)).toHaveLength(config.centerStartSlots);
    }
  });

  it("R-2.2: scheidet Spieler 1 aus, gibt es drei Frontarenen, seine Frontzonen werden nicht gezeigt", () => {
    const layout = buildBoardLayout(config, frontPairsFor([false, true, false, false]));
    expect(layout.arenas.map((a) => a.id)).toEqual(["center", "front:0-2", "front:2-3", "front:3-0"]);
    expect(layout.arenas.filter((a) => a.kind === "front").map((a) => a.edge)).toEqual([0, 2, 3]);
    const cell = { col: 1, row: 1 };
    expect(locationPosition(layout, 1, { zone: "left", cell })).toBeNull();
    expect(locationPosition(layout, 0, { zone: "right", cell })).not.toBeNull();
    expect(locationPosition(layout, 2, { zone: "left", cell })).not.toBeNull();
  });

  it("R-2.5: bei 2 Spielern zwei getrennte Frontarenen, jede Zone genau einmal", () => {
    const layout = buildBoardLayout(config, frontPairsFor([false, true, false, true]));
    expect(layout.arenas.map((a) => a.id)).toEqual(["center", "front:0-2", "front:2-0"]);
    const cell = { col: 0, row: 0 };
    const zones: UnitLocation[] = [
      { zone: "left", cell },
      { zone: "right", cell },
    ];
    const seen = new Set<string>();
    for (const p of [0, 2] as PlayerIndex[]) {
      for (const z of zones) {
        const pos = locationPosition(layout, p, z)!;
        seen.add(`${pos.x.toFixed(6)},${pos.z.toFixed(6)}`);
      }
    }
    expect(seen.size).toBe(4);
  });

  it("C2a: in echten Partien hat jede Einheit einen sichtbaren Ort und keine zwei Einheiten teilen ihn", () => {
    for (const seed of [1, 2, 3]) {
      const session = new GameSession(data, { seed });
      for (let round = 0; round < 8 && session.status === "waitingForHuman"; round++) {
        session.autopilot();
        const view = session.view();
        const pairs = frontPairsFor(view.players.map((p) => p.eliminated));
        // Ist nur noch ein Spieler übrig, gibt es keine Frontarena mehr (R-2.2), die Partie ist vorbei.
        if (pairs.length === 0) break;
        const layout = buildBoardLayout(config, pairs);
        const taken = new Set<string>();
        for (const unit of Object.values(view.units)) {
          if (view.players[unit.owner]!.eliminated) continue;
          const pos = locationPosition(layout, unit.owner, unit.location);
          expect(pos, `${unit.id} in ${unit.location.zone}`).not.toBeNull();
          const key = `${pos!.x.toFixed(6)},${pos!.z.toFixed(6)}`;
          expect(taken.has(key), `${unit.id} doppelt`).toBe(false);
          taken.add(key);
        }
      }
    }
  });
});
