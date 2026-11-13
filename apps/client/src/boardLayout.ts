/**
 * Brett-Aufteilung (C2a): reine Geometrie ohne Babylon. Legt fest, wo jede Arena und jedes Hexfeld in der
 * Welt liegt und wo ein Einheiten-Ort (Frontzone, Mittelzone, Reserve) zu sehen ist.
 *
 * Welt: Ebene mit `x` nach rechts (Osten) und `z` nach oben (Norden), von oben gesehen. Die Sitze liegen in
 * den Ecken wie in R-2.1 (0 oben links, 1 oben rechts, 2 unten rechts, 3 unten links). Die Mittelarena liegt
 * in der Mitte und ist um 45° gedreht, sodass der Startbereich jedes Sitzes (R-3.4) zu seiner Ecke zeigt.
 * Jede Frontarena (R-3.2) liegt an der Kante zwischen dem Sitz ihres ersten Spielers und dem folgenden Sitz
 * (oben, rechts, unten, links), die Zone des ersten Spielers auf seiner Seite.
 *
 * Hexfelder sind „spitz oben“ in der eigenen Ebene der Arena: Spalte nach rechts, Zeile nach unten, ungerade
 * Zeilen um eine halbe Zelle versetzt (odd-r wie `packages/engine/src/hex.ts`). Gedreht wird die ganze Arena.
 */
import {
  allCells,
  centerPositionToArena,
  frontArenaSize,
  frontToArena,
  type GridSize,
  type OffsetCoord,
  type PlayerIndex,
  type Seat,
  type UnitLocation,
} from "@game/engine";

export const SQRT3 = Math.sqrt(3);

/** Abmessungen aus `config.arenas` und die Größe eines Hexfelds (Umkreisradius in Welteinheiten). */
export interface LayoutConfig {
  frontZone: GridSize;
  centerArena: GridSize;
  centerStartSlots: number;
  reserveSlots: number;
  hexSize: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

/** R-2.3: `first.right` kämpft gegen `second.left`. */
export interface FrontPair {
  first: PlayerIndex;
  second: PlayerIndex;
}

export interface ArenaCell {
  coord: OffsetCoord;
  position: WorldPoint;
  /** Besitzer des Felds: in Frontarenen der Spieler der Zone, in der Mitte der Sitz des Startbereichs, sonst `null`. */
  owner: PlayerIndex | null;
}

export interface ArenaLayout {
  /** `front:<first>-<second>` wie `frontArenaId` der Engine, oder `center`. */
  id: string;
  kind: "front" | "center";
  pair: FrontPair | null;
  /** Mittelpunkt der Arena. */
  center: WorldPoint;
  /** Drehung der Arena gegen den Uhrzeigersinn (von oben gesehen), im Bogenmaß. */
  rotation: number;
  /** Kante 0 oben, 1 rechts, 2 unten, 3 links (nur Frontarenen). */
  edge: number | null;
  size: GridSize;
  cells: ArenaCell[];
}

export interface BoardLayout {
  config: LayoutConfig;
  arenas: ArenaLayout[];
  /** Ecke jedes Sitzes (für Beschriftung, Reserve und Kamera). */
  seatCorners: WorldPoint[];
  /** Ungefährer Radius des ganzen Bretts (für die Kamera). */
  radius: number;
}

/** Richtung jeder Sitz-Ecke (R-2.1) als Winkel gegen den Uhrzeigersinn ab Osten. */
export function seatAngle(seat: number): number {
  return (Math.PI * 3) / 4 - (Math.PI / 2) * seat;
}

/** Drehung einer Frontarena an Kante `edge`: Zeilenachse zeigt im Uhrzeigersinn von Sitz `edge` zu `edge + 1`. */
export function edgeRotation(edge: number): number {
  return Math.PI / 2 - (Math.PI / 2) * edge;
}

/** Drehung der Mittelarena: Zeile 0 (Sitz 0) zeigt nach oben links. */
export const CENTER_ROTATION = Math.PI / 4;

/** Position eines Felds in der eigenen Ebene einer Arena, bezogen auf den Arena-Mittelpunkt (vor dem Drehen). */
export function localCellPosition(c: OffsetCoord, size: GridSize, hexSize: number): WorldPoint {
  const width = SQRT3 * hexSize;
  const x = width * (c.col + (c.row & 1 ? 0.5 : 0));
  const y = 1.5 * hexSize * c.row;
  const maxX = width * (size.cols - 1 + (size.rows > 1 ? 0.5 : 0));
  const maxY = 1.5 * hexSize * (size.rows - 1);
  // Zeile wächst nach unten, also z negativ.
  return { x: x - maxX / 2, z: -(y - maxY / 2) };
}

export function rotate(p: WorldPoint, angle: number): WorldPoint {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}

function add(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: a.x + b.x, z: a.z + b.z };
}

/** Halbe Ausdehnung einer Arena entlang ihrer eigenen Achsen (bis zum Rand der äußeren Felder). */
function halfExtent(size: GridSize, hexSize: number): { x: number; z: number } {
  const width = SQRT3 * hexSize;
  return {
    x: (width * (size.cols - 1 + (size.rows > 1 ? 0.5 : 0))) / 2 + width / 2,
    z: (1.5 * hexSize * (size.rows - 1)) / 2 + hexSize,
  };
}

/**
 * R-2.2, R-2.3, R-2.5: Front-Paarungen aus den nicht ausgeschiedenen Spielern in Ringreihenfolge, wie
 * `frontPairings` der Engine, aber nur aus der Liste der Ausgeschiedenen (die Sicht hat keinen Spielzustand).
 */
export function frontPairsFor(eliminated: readonly boolean[]): FrontPair[] {
  const ring = eliminated.map((out, p) => (out ? -1 : p)).filter((p) => p >= 0) as PlayerIndex[];
  if (ring.length < 2) return [];
  return ring.map((first, i) => ({ first, second: ring[(i + 1) % ring.length] as PlayerIndex }));
}

/** Baut das Brett für die aktuellen Front-Paarungen. */
export function buildBoardLayout(config: LayoutConfig, pairs: readonly FrontPair[], seats = 4): BoardLayout {
  const h = config.hexSize;
  const centerHalf = halfExtent(config.centerArena, h);
  const frontSize = frontArenaSize(config.frontZone);
  const frontHalf = halfExtent(frontSize, h);
  // Ausdehnung der gedrehten Mittelarena entlang einer Hauptachse.
  const centerReach = (centerHalf.x + centerHalf.z) * Math.SQRT1_2;
  // Die Frontarena liegt quer: ihre Spaltenachse zeigt zur Mitte.
  const frontDistance = centerReach + frontHalf.x + 1.2 * h;

  const arenas: ArenaLayout[] = [];
  const centerCells: ArenaCell[] = [];
  const owners = new Map<string, PlayerIndex>();
  for (let seat = 0; seat < Math.min(seats, 4); seat++) {
    for (let pos = 0; pos < config.centerStartSlots; pos++) {
      const c = centerPositionToArena(seat as Seat, pos, config.centerArena, config.centerStartSlots);
      owners.set(`${c.col},${c.row}`, seat as PlayerIndex);
    }
  }
  for (const coord of allCells(config.centerArena)) {
    centerCells.push({
      coord,
      position: rotate(localCellPosition(coord, config.centerArena, h), CENTER_ROTATION),
      owner: owners.get(`${coord.col},${coord.row}`) ?? null,
    });
  }
  arenas.push({
    id: "center",
    kind: "center",
    pair: null,
    center: { x: 0, z: 0 },
    rotation: CENTER_ROTATION,
    edge: null,
    size: config.centerArena,
    cells: centerCells,
  });

  for (const pair of pairs) {
    const edge = pair.first;
    const rotation = edgeRotation(edge);
    // Die Kante liegt in derselben Richtung von der Mitte aus, in die die Zeilenachse gedreht wird (oben = 90°).
    const center = { x: Math.cos(rotation) * frontDistance, z: Math.sin(rotation) * frontDistance };
    const cells: ArenaCell[] = allCells(frontSize).map((coord) => ({
      coord,
      position: add(center, rotate(localCellPosition(coord, frontSize, h), rotation)),
      owner: coord.row < config.frontZone.rows ? pair.first : pair.second,
    }));
    arenas.push({ id: `front:${pair.first}-${pair.second}`, kind: "front", pair, center, rotation, edge, size: frontSize, cells });
  }

  const cornerDistance = frontDistance * Math.SQRT2 * 0.75;
  const seatCorners = Array.from({ length: seats }, (_, s) => ({
    x: Math.cos(seatAngle(s)) * cornerDistance,
    z: Math.sin(seatAngle(s)) * cornerDistance,
  }));
  return { config, arenas, seatCorners, radius: frontDistance + frontHalf.x + frontHalf.z };
}

/** Feld einer Arena nach Koordinate. */
export function cellOf(arena: ArenaLayout, coord: OffsetCoord): ArenaCell | undefined {
  return arena.cells.find((c) => c.coord.col === coord.col && c.coord.row === coord.row);
}

/**
 * Wo eine Einheit des Spielers `owner` an ihrem Ort zu sehen ist (R-3.2, R-3.4, R-3.5). `null`, wenn die Zone
 * gerade an keinem Kampf teilnimmt (z. B. Frontzone eines Spielers, der allein übrig ist).
 * Reserve-Plätze liegen nebeneinander an der Sitz-Ecke, quer zur Richtung zur Mitte.
 */
export function locationPosition(layout: BoardLayout, owner: PlayerIndex, location: UnitLocation): WorldPoint | null {
  const { config } = layout;
  switch (location.zone) {
    case "right":
    case "left": {
      const side = location.zone === "right" ? "first" : "second";
      const arena = layout.arenas.find((a) => a.pair && (side === "first" ? a.pair.first : a.pair.second) === owner);
      if (!arena) return null;
      const coord = frontToArena(side, location.cell, config.frontZone);
      return cellOf(arena, coord)?.position ?? null;
    }
    case "center": {
      const arena = layout.arenas.find((a) => a.kind === "center");
      if (!arena) return null;
      const coord = centerPositionToArena(owner as Seat, location.position, config.centerArena, config.centerStartSlots);
      return cellOf(arena, coord)?.position ?? null;
    }
    case "reserve": {
      const corner = layout.seatCorners[owner];
      if (!corner) return null;
      const angle = seatAngle(owner) + Math.PI / 2;
      const step = SQRT3 * config.hexSize * 1.1;
      const offset = (location.slot - (config.reserveSlots - 1) / 2) * step;
      return { x: corner.x + Math.cos(angle) * offset, z: corner.z + Math.sin(angle) * offset };
    }
  }
}
