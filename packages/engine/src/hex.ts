/**
 * Hex-Geometrie (Spec R-3).
 *
 * Alle Arenen nutzen versetzte Koordinaten „odd-r“: ungerade Zeilen sind um eine
 * halbe Zelle nach rechts versetzt. Abstände werden über Würfelkoordinaten berechnet.
 * Abmessungen kommen immer als Parameter herein (aus `config.json`), nie als feste Werte.
 */

export interface OffsetCoord {
  readonly col: number;
  readonly row: number;
}

export interface CubeCoord {
  readonly q: number;
  readonly r: number;
  readonly s: number;
}

export interface GridSize {
  readonly cols: number;
  readonly rows: number;
}

/** Spielersitz 0–3 (R-2.1). */
export type Seat = 0 | 1 | 2 | 3;

/** Welche der beiden Frontzonen einer Frontarena (R-3.2). */
export type FrontSide = "first" | "second";

export function offsetToCube(c: OffsetCoord): CubeCoord {
  const q = c.col - (c.row - (c.row & 1)) / 2;
  const r = c.row;
  return { q, r, s: 0 - q - r };
}

export function cubeToOffset(c: CubeCoord): OffsetCoord {
  const col = c.q + (c.r - (c.r & 1)) / 2;
  return { col, row: c.r };
}

/** Hex-Abstand zweier Felder (R-3). */
export function hexDistance(a: OffsetCoord, b: OffsetCoord): number {
  const ca = offsetToCube(a);
  const cb = offsetToCube(b);
  return Math.max(Math.abs(ca.q - cb.q), Math.abs(ca.r - cb.r), Math.abs(ca.s - cb.s));
}

export function coordEquals(a: OffsetCoord, b: OffsetCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Ordnung nach `(row, col)`, wie sie die Spec für Gleichstände verwendet (R-9.3). */
export function compareRowCol(a: OffsetCoord, b: OffsetCoord): number {
  return a.row !== b.row ? a.row - b.row : a.col - b.col;
}

export function coordKey(c: OffsetCoord): string {
  return `${c.col},${c.row}`;
}

export function inBounds(c: OffsetCoord, size: GridSize): boolean {
  return c.col >= 0 && c.col < size.cols && c.row >= 0 && c.row < size.rows;
}

/** Alle Felder eines Gitters, sortiert nach `(row, col)`. */
export function allCells(size: GridSize): OffsetCoord[] {
  const cells: OffsetCoord[] = [];
  for (let row = 0; row < size.rows; row++) {
    for (let col = 0; col < size.cols; col++) cells.push({ col, row });
  }
  return cells;
}

const CUBE_DIRECTIONS: readonly CubeCoord[] = [
  { q: 1, r: 0, s: -1 },
  { q: 1, r: -1, s: 0 },
  { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 },
  { q: -1, r: 1, s: 0 },
  { q: 0, r: 1, s: -1 },
];

/**
 * Nachbarfelder innerhalb des Gitters, sortiert nach `(row, col)`.
 * Ohne `size` werden alle sechs Nachbarn geliefert (auch außerhalb).
 */
export function neighbors(c: OffsetCoord, size?: GridSize): OffsetCoord[] {
  const cube = offsetToCube(c);
  const result = CUBE_DIRECTIONS.map((d) =>
    cubeToOffset({ q: cube.q + d.q, r: cube.r + d.r, s: cube.s + d.s }),
  ).filter((n) => size === undefined || inBounds(n, size));
  return result.sort(compareRowCol);
}

export type CellPredicate = (c: OffsetCoord) => boolean;

/**
 * Breitensuche ab `start` über freie Felder. Liefert die Schrittzahl zu jedem
 * erreichbaren Feld (Schlüssel: `coordKey`). Das Startfeld selbst muss nicht frei sein.
 */
export function bfsDistances(
  start: OffsetCoord,
  size: GridSize,
  isFree: CellPredicate,
): Map<string, number> {
  const dist = new Map<string, number>();
  if (!inBounds(start, size)) return dist;
  dist.set(coordKey(start), 0);
  const queue: OffsetCoord[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as OffsetCoord;
    const d = dist.get(coordKey(cur)) as number;
    for (const n of neighbors(cur, size)) {
      const k = coordKey(n);
      if (dist.has(k) || !isFree(n)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * Nächster Schritt von `start` auf einem kürzesten Weg zu `goal` (R-9.3 Schritt 5).
 * Der Weg führt nur über freie Felder; `goal` selbst darf belegt sein (dort steht das Ziel).
 * Bei mehreren kürzesten Wegen wird das Feld mit der kleinsten `(row, col)` gewählt.
 * Liefert `null`, wenn kein Weg existiert oder `start` schon neben `goal` (oder darauf) steht.
 */
export function nextStepToward(
  start: OffsetCoord,
  goal: OffsetCoord,
  size: GridSize,
  isFree: CellPredicate,
): OffsetCoord | null {
  if (hexDistance(start, goal) <= 1) return null;
  const fromGoal = bfsDistances(goal, size, isFree);
  let best: OffsetCoord | null = null;
  let bestDist = Infinity;
  for (const n of neighbors(start, size)) {
    if (!isFree(n)) continue;
    const d = fromGoal.get(coordKey(n));
    if (d === undefined) continue;
    if (d < bestDist || (d === bestDist && best !== null && compareRowCol(n, best) < 0)) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

/** Abmessungen der Frontarena aus zwei Frontzonen (R-3.2). */
export function frontArenaSize(frontZone: GridSize): GridSize {
  return { cols: frontZone.cols, rows: frontZone.rows * 2 };
}

/**
 * Frontzone-Feld → Frontarena-Feld (R-3.2). Die Zone des ersten Spielers (`right`-Zone
 * laut R-2.3) bleibt unverändert, die des Gegners wird um 180° gedreht.
 */
export function frontToArena(side: FrontSide, c: OffsetCoord, frontZone: GridSize): OffsetCoord {
  if (!inBounds(c, frontZone)) throw new RangeError(`Feld ${coordKey(c)} liegt nicht in der Frontzone`);
  if (side === "first") return { col: c.col, row: c.row };
  return { col: frontZone.cols - 1 - c.col, row: frontZone.rows * 2 - 1 - c.row };
}

/** Frontarena-Feld → Seite und Frontzone-Feld (Umkehrung von `frontToArena`). */
export function arenaToFront(
  c: OffsetCoord,
  frontZone: GridSize,
): { side: FrontSide; coord: OffsetCoord } {
  if (!inBounds(c, frontArenaSize(frontZone))) {
    throw new RangeError(`Feld ${coordKey(c)} liegt nicht in der Frontarena`);
  }
  if (c.row < frontZone.rows) return { side: "first", coord: { col: c.col, row: c.row } };
  return {
    side: "second",
    coord: { col: frontZone.cols - 1 - c.col, row: frontZone.rows * 2 - 1 - c.row },
  };
}

/**
 * Startbereich eines Sitzes in der Mittelarena (R-3.4), geordnet nach Position 0…n-1.
 * Sitz 0 = oberste Zeile, Sitz 1 = rechte Spalte, Sitz 2 = unterste Zeile, Sitz 3 = linke Spalte,
 * jeweils ohne die Eckfelder. Position zählt aufsteigend nach Spalte bzw. Zeile (siehe F10).
 */
export function centerStartCells(seat: Seat, centerArena: GridSize, slots: number): OffsetCoord[] {
  const horizontal = seat === 0 || seat === 2;
  const length = (horizontal ? centerArena.cols : centerArena.rows) - 2;
  if (length !== slots) {
    throw new RangeError(
      `Mittelarena ${centerArena.cols}×${centerArena.rows} passt nicht zu ${slots} Startfeldern`,
    );
  }
  return Array.from({ length: slots }, (_, i) => {
    const p = i + 1;
    switch (seat) {
      case 0:
        return { col: p, row: 0 };
      case 1:
        return { col: centerArena.cols - 1, row: p };
      case 2:
        return { col: p, row: centerArena.rows - 1 };
      case 3:
        return { col: 0, row: p };
    }
  });
}

/** Mittelzonen-Position (0…slots-1) eines Sitzes → Feld der Mittelarena (R-3.4). */
export function centerPositionToArena(
  seat: Seat,
  position: number,
  centerArena: GridSize,
  slots: number,
): OffsetCoord {
  if (!Number.isInteger(position) || position < 0 || position >= slots) {
    throw new RangeError(`Mittelzonen-Position ${position} ungültig`);
  }
  return centerStartCells(seat, centerArena, slots)[position] as OffsetCoord;
}
