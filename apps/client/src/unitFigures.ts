/**
 * Einheiten-Figuren (C2b): reine Logik ohne Babylon. Bestimmt aus der Sicht des Spielers, welche Einheit mit
 * welcher Form wo auf dem Brett steht. `scene.ts` zeichnet nur, was hier herauskommt.
 *
 * Formen nach Einheitenart (Lesbarkeit vor Schönheit, `docs/stil/visuelle-richtung.md`):
 * - `leader`: Anführer, hohe Figur mit Kopf, auf jedem Brett genau eine je Spieler.
 * - `melee`: Karten-Einheit mit Reichweite 1 (Nahkampf), gedrungener Block.
 * - `ranged`: Karten-Einheit mit Reichweite über 1 (Fernkampf), Kegel.
 * - `token`: beschworenes Token (R-1.4), kleine Kugel.
 */
import type { GameData, PlayerIndex, PlayerView, Unit, UnitId, UnitLocation } from "@game/engine";
import { type BoardLayout, locationPosition, type WorldPoint } from "./boardLayout";

export type FigureShape = "leader" | "melee" | "ranged" | "token";

export interface UnitFigure {
  unitId: UnitId;
  owner: PlayerIndex;
  shape: FigureShape;
  stars: 1 | 2 | 3;
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
      stars: unit.stars,
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
