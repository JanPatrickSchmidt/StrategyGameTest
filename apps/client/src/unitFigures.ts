/**
 * Einheiten-Figuren (C2b): reine Logik ohne Babylon. Bestimmt aus der Sicht des Spielers, welche Einheit mit
 * welcher Form wo auf dem Brett steht. `scene.ts` zeichnet nur, was hier herauskommt.
 *
 * Formen nach Einheitenart (Lesbarkeit vor Schönheit, `docs/stil/visuelle-richtung.md`):
 * - `leader`: Anführer, hohe Figur mit Kopf, auf jedem Brett genau eine je Spieler.
 * - `melee`: Karten-Einheit mit Reichweite 1 (Nahkampf), gedrungener Block.
 * - `ranged`: Karten-Einheit mit Reichweite über 1 (Fernkampf), Kegel.
 * - `token`: beschworenes Token (R-1.4), kleine Kugel.
 *
 * C2c: Jede Figur trägt Sterne bzw. Anführer-Stufe und Lebenspunkte für die Anzeige über der Figur.
 */
import { type GameData, type PlayerIndex, type PlayerView, type Unit, type UnitId, type UnitLocation, unitBaseStats } from "@game/engine";
import { type BoardLayout, locationPosition, type WorldPoint } from "./boardLayout";

export type FigureShape = "leader" | "melee" | "ranged" | "token";

export interface UnitFigure {
  unitId: UnitId;
  owner: PlayerIndex;
  shape: FigureShape;
  kind: Unit["kind"];
  stars: 1 | 2 | 3;
  /** C2c: Lebenspunkte für die Anzeige (`unitDisplayHp`). */
  hp: number;
  /** C2c: Stufe des Anführers (nur bei `kind === "leader"`). */
  leaderLevel?: number;
  wounded: boolean;
  zone: UnitLocation["zone"];
  position: WorldPoint;
}

/** Form einer Einheit; Karten-Einheiten nach Reichweite aus den Kartendaten. */
export function figureShape(data: GameData, unit: Pick<Unit, "kind" | "sourceId">): FigureShape {
  if (unit.kind === "leader") return "leader";
  if (unit.kind === "token") return "token";
  const card = data.cards.get(unit.sourceId);
  if (card && card.type === "unit" && card.stats.range > 1) return "ranged";
  return "melee";
}

/**
 * Alle sichtbaren Figuren nach Einheiten-ID sortiert. Einheiten in einer Zone, die gerade an keinem Kampf
 * teilnimmt (`locationPosition` liefert `null`), werden nicht gezeichnet.
 */
export function unitFigures(data: GameData, view: PlayerView, layout: BoardLayout): UnitFigure[] {
  const figures: UnitFigure[] = [];
  const units = Object.values(view.units).sort((a, b) => a.id - b.id);
  for (const unit of units) {
    const position = locationPosition(layout, unit.owner, unit.location);
    if (!position) continue;
    figures.push({
      unitId: unit.id,
      owner: unit.owner,
      shape: figureShape(data, unit),
      kind: unit.kind,
      stars: unit.stars,
      hp: unitDisplayHp(data, view, unit),
      ...(unit.kind === "leader" ? { leaderLevel: view.players[unit.owner]?.leader.level ?? 1 } : {}),
      wounded: unit.wounded,
      zone: unit.location.zone,
      position,
    });
  }
  return figures;
}

/** Schlüssel der Mesh-Vorlage: gleiche Form, gleicher Besitzer, gleicher Verwundungszustand teilen eine Vorlage. */
export function figureSourceKey(figure: Pick<UnitFigure, "shape" | "owner" | "wounded">): string {
  return `${figure.shape}-${figure.owner}${figure.wounded ? "-w" : ""}`;
}

/**
 * C2c: Lebenspunkte einer Einheit außerhalb des Kampfes, so wie sie in den nächsten Kampf geht, bevor
 * Rundenwirkungen greifen: Grundwert aus den Daten mit Sternfaktor (R-15.2), Ersatzwerte beschworener Tokens,
 * Anführer-Stufe 3 (R-16.3) und dauerhafte Buffs. Seit P11 direkt aus `unitBaseStats` der Engine, auf der auch
 * `fighterForUnit` aufbaut; Vorkampf-Zauber und Rassen-Resonanz (erst zu Beginn der Kampfphase) zählen nicht mit.
 */
export function unitDisplayHp(data: GameData, view: PlayerView, unit: Unit): number {
  return unitBaseStats(data, unit, view.players[unit.owner]?.leader.level ?? 1).hp;
}

/**
 * C2c: Text der Anzeige über einer Figur. Karten-Einheiten und Tokens zeigen ihre Sterne, Anführer (ohne Sterne,
 * R-15.3) ihre Stufe; dahinter die Lebenspunkte mit Herz. Verwundete sind mit „verw.“ markiert.
 */
export function unitBadgeText(figure: Pick<UnitFigure, "kind" | "stars" | "hp" | "wounded" | "leaderLevel">): string {
  const rank = figure.kind === "leader" ? `St.${figure.leaderLevel ?? 1}` : "★".repeat(figure.stars);
  return `${rank} ${figure.hp}♥${figure.wounded ? " verw." : ""}`;
}
