/**
 * Feldnamen in der Oberfläche (R-3.8, C3a): schachähnlich, Spalte als Buchstabe (a, b, c …), Zeile als Zahl
 * (1, 2, 3 …), jeweils aus Sicht des Spielers. Intern bleiben die Koordinaten aus R-3.1 bis R-3.4.
 *
 * Auslegung „aus Sicht des Spielers“:
 * - Eigene Frontzone: Zeile 1 ist die hinterste Reihe (`row` 0), Zeile 3 die Reihe direkt an der Front; Spalte a
 *   ist `col` 0. In einer Frontarena zählen die Zeilen über die Front hinweg weiter (4–6 = gegnerische Zone),
 *   in den Koordinaten des Spielers (die gegnerische Zone ist nach R-3.2 gedreht).
 * - Mittelarena: so gedreht, dass der eigene Startbereich Zeile 1 ist und die Positionen 0–4 die Buchstaben b–f
 *   tragen (für jeden Sitz gleich, passend zur Positionszählung der Engine, R-3.4); Zeile 7 ist die
 *   gegenüberliegende Seite.
 */
import type { ArenaHex, ConfigData, OffsetCoord, PlayerIndex, UnitLocation } from "@game/engine";

/** Buchstabe einer Spalte (0 → a). */
export function columnLetter(col: number): string {
  if (!Number.isInteger(col) || col < 0 || col >= 26) throw new RangeError(`Spalte ${col} ohne Buchstaben`);
  return String.fromCharCode(97 + col);
}

/** Name eines Felds in den Koordinaten des Spielers (`col` 0, `row` 0 → „a1“). */
export function coordName(c: OffsetCoord): string {
  return `${columnLetter(c.col)}${c.row + 1}`;
}

/** Feld der eigenen Frontzone (R-3.1) → Name, z. B. `row` 2, `col` 4 → „e3“. */
export function frontCellName(cell: OffsetCoord): string {
  return coordName(cell);
}

/**
 * Arena-Feld (R-14.2, aus Sicht von `viewer`) in die Koordinaten des Spielers umrechnen: eigene Seite unten
 * (Zeile 0), Gegner oben.
 */
export function arenaHexToViewer(config: ConfigData, viewer: PlayerIndex, hex: ArenaHex): OffsetCoord {
  const { col, row } = hex.cell;
  if (hex.arena === "right") return { col, row };
  if (hex.arena === "left") {
    const { cols, rows } = config.arenas.frontZone;
    return { col: cols - 1 - col, row: rows * 2 - 1 - row };
  }
  const last = config.arenas.centerArena.cols - 1;
  const lastRow = config.arenas.centerArena.rows - 1;
  switch (viewer) {
    case 0:
      return { col, row };
    case 1:
      // Startbereich Spalte 6, Position p = Zeile p+1.
      return { col: row, row: last - col };
    case 2:
      // Startbereich Zeile 6, Position p = Spalte p+1.
      return { col, row: lastRow - row };
    case 3:
      // Startbereich Spalte 0, Position p = Zeile p+1.
      return { col: row, row: col };
  }
}

const ARENA_NAMES: Record<ArenaHex["arena"], string> = { left: "Linke Front", right: "Rechte Front", center: "Mitte" };

/** Name eines Arena-Felds, z. B. „Rechte Front c5“ oder „Mitte d1“. */
export function arenaHexName(config: ConfigData, viewer: PlayerIndex, hex: ArenaHex): string {
  return `${ARENA_NAMES[hex.arena]} ${coordName(arenaHexToViewer(config, viewer, hex))}`;
}

/** Name eines eigenen Einheiten-Orts, z. B. „Linke Front b2“, „Mitte c1“, „Reserve 2“. */
export function locationName(config: ConfigData, owner: PlayerIndex, loc: UnitLocation): string {
  switch (loc.zone) {
    case "left":
    case "right":
      return `${ARENA_NAMES[loc.zone]} ${frontCellName(loc.cell)}`;
    case "center":
      // Position p liegt für jeden Sitz auf Buchstabe p+1 in Zeile 1 (siehe `arenaHexToViewer`).
      return `Mitte ${coordName({ col: loc.position + 1, row: 0 })}`;
    case "reserve":
      return `Reserve ${loc.slot + 1}`;
  }
}
