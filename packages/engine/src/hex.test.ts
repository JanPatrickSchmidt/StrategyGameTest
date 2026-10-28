import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import {
  allCells,
  arenaToFront,
  bfsDistances,
  centerPositionToArena,
  centerStartCells,
  coordKey,
  cubeToOffset,
  frontArenaSize,
  frontToArena,
  hexDistance,
  inBounds,
  neighbors,
  nextStepToward,
  offsetToCube,
  type OffsetCoord,
  type Seat,
} from "./hex";

const config = loadGameData().config;
const FRONT = config.arenas.frontZone;
const CENTER = config.arenas.centerArena;
const SLOTS = config.arenas.centerStartSlots;
const ARENA = frontArenaSize(FRONT);

const c = (col: number, row: number): OffsetCoord => ({ col, row });
const keys = (cells: OffsetCoord[]): string[] => cells.map(coordKey);
const freeExcept =
  (...blocked: OffsetCoord[]) =>
  (x: OffsetCoord): boolean =>
    !blocked.some((b) => b.col === x.col && b.row === x.row);

describe("R-3: odd-r-Koordinaten und Würfelkoordinaten", () => {
  it("Umrechnung hin und zurück ist für alle Felder verlustfrei", () => {
    for (const cell of [...allCells(ARENA), ...allCells(CENTER), c(-3, -1), c(9, -4)]) {
      const cube = offsetToCube(cell);
      expect(cube.q + cube.r + cube.s).toBe(0);
      expect(cubeToOffset(cube)).toEqual(cell);
    }
  });

  it("bekannte Werte: ungerade Zeilen sind nach rechts versetzt", () => {
    expect(offsetToCube(c(0, 0))).toEqual({ q: 0, r: 0, s: 0 });
    expect(offsetToCube(c(0, 1))).toEqual({ q: 0, r: 1, s: -1 });
    expect(offsetToCube(c(0, 2))).toEqual({ q: -1, r: 2, s: -1 });
    expect(offsetToCube(c(3, 3))).toEqual({ q: 2, r: 3, s: -5 });
  });
});

describe("R-3: Hex-Abstand", () => {
  it("Abstand zu sich selbst ist 0, ist symmetrisch", () => {
    for (const a of allCells(ARENA)) {
      expect(hexDistance(a, a)).toBe(0);
      for (const b of allCells(ARENA)) expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    }
  });

  it("Nachbarn haben Abstand 1", () => {
    for (const a of allCells(ARENA)) {
      for (const n of neighbors(a)) expect(hexDistance(a, n)).toBe(1);
    }
  });

  it("bekannte Abstände inklusive Versatz", () => {
    expect(hexDistance(c(0, 0), c(4, 0))).toBe(4);
    expect(hexDistance(c(0, 0), c(0, 5))).toBe(5);
    expect(hexDistance(c(0, 0), c(2, 5))).toBe(5);
    expect(hexDistance(c(0, 0), c(4, 5))).toBe(7);
    expect(hexDistance(c(4, 0), c(0, 5))).toBe(6);
    expect(hexDistance(c(0, 1), c(1, 0))).toBe(1);
    expect(hexDistance(c(1, 0), c(0, 1))).toBe(1);
    expect(hexDistance(c(2, 0), c(0, 1))).toBe(2);
  });

  it("Dreiecksungleichung gilt", () => {
    const cells = allCells(ARENA);
    for (const a of cells)
      for (const b of cells)
        for (const m of [c(2, 2), c(0, 3)])
          expect(hexDistance(a, b)).toBeLessThanOrEqual(hexDistance(a, m) + hexDistance(m, b));
  });
});

describe("R-3: Nachbarn", () => {
  it("gerade Zeile: Nachbarn links oben/unten versetzt", () => {
    expect(keys(neighbors(c(2, 2)))).toEqual(["1,1", "2,1", "1,2", "3,2", "1,3", "2,3"]);
  });

  it("ungerade Zeile: Nachbarn rechts oben/unten versetzt", () => {
    expect(keys(neighbors(c(2, 1)))).toEqual(["2,0", "3,0", "1,1", "3,1", "2,2", "3,2"]);
  });

  it("Randfall Ecke oben links: nur Felder im Gitter", () => {
    expect(keys(neighbors(c(0, 0), ARENA))).toEqual(["1,0", "0,1"]);
  });

  it("Randfall rechter Rand ungerade Zeile", () => {
    expect(keys(neighbors(c(4, 1), ARENA))).toEqual(["4,0", "3,1", "4,2"]);
  });

  it("Randfall unterste Zeile der Frontarena", () => {
    expect(keys(neighbors(c(4, 5), ARENA))).toEqual(["4,4", "3,5"]);
  });

  it("innere Felder haben immer 6 Nachbarn, Ergebnis nach (row, col) sortiert", () => {
    const inner = neighbors(c(3, 3), CENTER);
    expect(inner).toHaveLength(6);
    const sorted = [...inner].sort((a, b) => a.row - b.row || a.col - b.col);
    expect(inner).toEqual(sorted);
  });

  it("inBounds erkennt Ränder", () => {
    expect(inBounds(c(0, 0), ARENA)).toBe(true);
    expect(inBounds(c(4, 5), ARENA)).toBe(true);
    expect(inBounds(c(5, 0), ARENA)).toBe(false);
    expect(inBounds(c(0, 6), ARENA)).toBe(false);
    expect(inBounds(c(-1, 0), ARENA)).toBe(false);
  });
});

describe("R-9.3: Breitensuche über freie Felder", () => {
  it("ohne Hindernisse entspricht die Schrittzahl dem Hex-Abstand", () => {
    const start = c(1, 2);
    const dist = bfsDistances(start, ARENA, () => true);
    expect(dist.size).toBe(ARENA.cols * ARENA.rows);
    for (const cell of allCells(ARENA)) {
      expect(dist.get(coordKey(cell))).toBe(hexDistance(start, cell));
    }
  });

  it("belegte Felder werden umgangen und nicht betreten", () => {
    // Wand in Zeile 2 mit Lücke bei Spalte 4
    const wall = [c(0, 2), c(1, 2), c(2, 2), c(3, 2)];
    const dist = bfsDistances(c(0, 0), ARENA, freeExcept(...wall));
    for (const w of wall) expect(dist.has(coordKey(w))).toBe(false);
    expect(dist.get(coordKey(c(0, 4)))).toBeGreaterThan(hexDistance(c(0, 0), c(0, 4)));
  });

  it("Startfeld darf belegt sein", () => {
    const start = c(2, 2);
    const dist = bfsDistances(start, ARENA, freeExcept(start));
    expect(dist.get(coordKey(start))).toBe(0);
    expect(dist.get(coordKey(c(2, 3)))).toBe(1);
  });

  it("Randfall: eingeschlossenes Feld erreicht nichts", () => {
    const start = c(0, 0);
    const dist = bfsDistances(start, ARENA, freeExcept(c(1, 0), c(0, 1)));
    expect(dist.size).toBe(1);
  });

  it("Randfall: Start außerhalb liefert leeres Ergebnis", () => {
    expect(bfsDistances(c(9, 9), ARENA, () => true).size).toBe(0);
  });
});

describe("R-9.3: Schritt auf kürzestem Weg", () => {
  it("geht einen Schritt näher zum Ziel", () => {
    const step = nextStepToward(c(2, 0), c(2, 5), ARENA, freeExcept(c(2, 0), c(2, 5)));
    expect(step).not.toBeNull();
    expect(hexDistance(step as OffsetCoord, c(2, 5))).toBe(hexDistance(c(2, 0), c(2, 5)) - 1);
  });

  it("bei mehreren kürzesten Wegen gewinnt das Feld mit der kleinsten (row, col)", () => {
    // Von (2,0) nach (2,2): über (1,1) und (2,1) gleich lang → (1,1)
    expect(nextStepToward(c(2, 0), c(2, 2), ARENA, () => true)).toEqual(c(1, 1));
    // Von (2,2) nach (2,0): über (1,1) und (2,1) → (1,1)
    expect(nextStepToward(c(2, 2), c(2, 0), ARENA, () => true)).toEqual(c(1, 1));
    // Waagerecht: von (0,0) nach (3,0): nur (1,0) liegt auf einem kürzesten Weg
    expect(nextStepToward(c(0, 0), c(3, 0), ARENA, () => true)).toEqual(c(1, 0));
  });

  it("weicht Hindernissen aus", () => {
    const step = nextStepToward(c(2, 0), c(2, 2), ARENA, freeExcept(c(1, 1)));
    expect(step).toEqual(c(2, 1));
  });

  it("nimmt einen Umweg, wenn der direkte Weg versperrt ist", () => {
    const wall = [c(0, 2), c(1, 2), c(2, 2), c(3, 2)];
    const step = nextStepToward(c(0, 0), c(0, 4), ARENA, freeExcept(...wall));
    expect(step).toEqual(c(1, 0));
  });

  it("Randfall: steht schon neben dem Ziel → kein Schritt", () => {
    expect(nextStepToward(c(2, 2), c(2, 3), ARENA, () => true)).toBeNull();
  });

  it("Randfall: kein Weg → kein Schritt (bleibt stehen)", () => {
    const wall = allCells(FRONT).filter((x) => x.row === 2);
    expect(nextStepToward(c(0, 0), c(0, 5), ARENA, freeExcept(...wall))).toBeNull();
  });

  it("Randfall: Ziel ist umzingelt → kein Schritt", () => {
    const goal = c(2, 4);
    const ring = neighbors(goal, ARENA);
    expect(nextStepToward(c(0, 0), goal, ARENA, freeExcept(...ring))).toBeNull();
  });
});

describe("R-3.2: Frontzone → Frontarena", () => {
  it("Frontarena ist 5 × 6", () => {
    expect(ARENA).toEqual({ cols: 5, rows: 6 });
  });

  it("erster Spieler (right-Zone) belegt Zeilen 0–2 unverändert", () => {
    for (const cell of allCells(FRONT)) expect(frontToArena("first", cell, FRONT)).toEqual(cell);
  });

  it("Gegner wird um 180° gedreht: arenaRow = 5 - row, arenaCol = 4 - col", () => {
    expect(frontToArena("second", c(0, 0), FRONT)).toEqual(c(4, 5));
    expect(frontToArena("second", c(4, 2), FRONT)).toEqual(c(0, 3));
    expect(frontToArena("second", c(2, 1), FRONT)).toEqual(c(2, 4));
    for (const cell of allCells(FRONT)) {
      expect(frontToArena("second", cell, FRONT)).toEqual(c(4 - cell.col, 5 - cell.row));
    }
  });

  it("beide Zonen zusammen decken die Arena genau einmal ab", () => {
    const mapped = new Set<string>();
    for (const side of ["first", "second"] as const)
      for (const cell of allCells(FRONT)) mapped.add(coordKey(frontToArena(side, cell, FRONT)));
    expect(mapped.size).toBe(30);
  });

  it("Frontreihen (row 2) beider Zonen liegen sich gegenüber (Arena-Zeilen 2 und 3)", () => {
    expect(frontToArena("first", c(1, 2), FRONT).row).toBe(2);
    expect(frontToArena("second", c(1, 2), FRONT).row).toBe(3);
  });

  it("arenaToFront ist die Umkehrung", () => {
    for (const side of ["first", "second"] as const)
      for (const cell of allCells(FRONT))
        expect(arenaToFront(frontToArena(side, cell, FRONT), FRONT)).toEqual({ side, coord: cell });
  });

  it("Randfall: Felder außerhalb werden abgelehnt", () => {
    expect(() => frontToArena("first", c(0, 3), FRONT)).toThrow(RangeError);
    expect(() => frontToArena("second", c(5, 0), FRONT)).toThrow(RangeError);
    expect(() => arenaToFront(c(0, 6), FRONT)).toThrow(RangeError);
  });
});

describe("R-3.4: Startbereiche der Mittelarena", () => {
  it("Sitz 0 = Zeile 0, Spalten 1–5", () => {
    expect(keys(centerStartCells(0, CENTER, SLOTS))).toEqual(["1,0", "2,0", "3,0", "4,0", "5,0"]);
  });

  it("Sitz 1 = Spalte 6, Zeilen 1–5", () => {
    expect(keys(centerStartCells(1, CENTER, SLOTS))).toEqual(["6,1", "6,2", "6,3", "6,4", "6,5"]);
  });

  it("Sitz 2 = Zeile 6, Spalten 1–5", () => {
    expect(keys(centerStartCells(2, CENTER, SLOTS))).toEqual(["1,6", "2,6", "3,6", "4,6", "5,6"]);
  });

  it("Sitz 3 = Spalte 0, Zeilen 1–5", () => {
    expect(keys(centerStartCells(3, CENTER, SLOTS))).toEqual(["0,1", "0,2", "0,3", "0,4", "0,5"]);
  });

  it("Startbereiche überschneiden sich nicht und liegen in der Arena", () => {
    const all = ([0, 1, 2, 3] as Seat[]).flatMap((s) => centerStartCells(s, CENTER, SLOTS));
    expect(new Set(keys(all)).size).toBe(20);
    for (const cell of all) expect(inBounds(cell, CENTER)).toBe(true);
  });

  it("Position 0–4 wird auf die Felder abgebildet", () => {
    expect(centerPositionToArena(0, 0, CENTER, SLOTS)).toEqual(c(1, 0));
    expect(centerPositionToArena(1, 4, CENTER, SLOTS)).toEqual(c(6, 5));
    expect(centerPositionToArena(2, 2, CENTER, SLOTS)).toEqual(c(3, 6));
    expect(centerPositionToArena(3, 1, CENTER, SLOTS)).toEqual(c(0, 2));
  });

  it("Randfall: ungültige Positionen werden abgelehnt", () => {
    expect(() => centerPositionToArena(0, -1, CENTER, SLOTS)).toThrow(RangeError);
    expect(() => centerPositionToArena(0, 5, CENTER, SLOTS)).toThrow(RangeError);
    expect(() => centerPositionToArena(0, 1.5, CENTER, SLOTS)).toThrow(RangeError);
  });

  it("Randfall: Abmessungen passen nicht zur Anzahl Startfelder", () => {
    expect(() => centerStartCells(0, { cols: 6, rows: 7 }, SLOTS)).toThrow(RangeError);
  });
});
