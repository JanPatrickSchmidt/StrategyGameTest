/**
 * Bedienung auf dem 3D-Brett (C3b): reine Logik ohne Babylon und ohne DOM.
 *
 * Der Spieler wählt entweder eine Einheitenkarte aus der Hand oder eine eigene Einheit auf dem Brett. Danach
 * werden die freien eigenen Orte hervorgehoben (`targetLocations`), und ein Klick auf ein Feld (oder das
 * Loslassen einer gezogenen Einheit) wird zur Planungsaktion (`applyTarget`). Welcher Ort unter dem Mauszeiger
 * liegt, bestimmt `nearestLocation` aus der Brett-Geometrie. Ob die Aktion gültig ist, entscheidet allein die
 * Engine über den `PlanBuilder`.
 */
import { allLocations, type GameData, type PlayerIndex, type UnitId, type UnitLocation } from "@game/engine";
import { type BoardLayout, locationPosition, type WorldPoint } from "./boardLayout";
import { type Payment, playAction, playLocations } from "./planExtras";
import { handCards, type PlanBuilder, type PlanReason } from "./planner";

/**
 * Auswahl für das Brett: eine Einheitenkarte der Hand (C3c2: mit Bezahlwahl, fehlt = normale Kosten, R-14.6)
 * oder eine eigene Einheit.
 */
export type BoardSelection = { kind: "card"; cardInstanceId: number; payment?: Payment } | { kind: "unit"; unitId: UnitId } | null;

/** Darf diese Einheit auf dem Brett gewählt bzw. gezogen werden? */
export function isRelocatable(builder: PlanBuilder, unitId: UnitId): boolean {
  return builder.relocatableUnits().some((u) => u.id === unitId);
}

/** Ist die Auswahl (noch) gültig, z. B. die Karte noch auf der Hand? Sonst `null`. */
export function validSelection(data: GameData, builder: PlanBuilder, selection: BoardSelection): BoardSelection {
  if (!selection) return null;
  if (selection.kind === "unit") return isRelocatable(builder, selection.unitId) ? selection : null;
  const card = handCards(data, builder.preview()).find((c) => c.instanceId === selection.cardInstanceId);
  return card && card.card.type === "unit" ? selection : null;
}

/**
 * Hervorzuhebende Zielorte: alle eigenen Orte ohne eigene Einheit im Entwurf (Felder der eigenen Frontzonen,
 * Startbereich der Mitte, Reserve), beim Ausspielen mit Opfern zusätzlich deren Orte. Kapazität (R-3.6) und Kosten prüft erst die Engine beim Anwenden.
 */
export function targetLocations(data: GameData, builder: PlanBuilder, selection: BoardSelection): UnitLocation[] {
  const valid = validSelection(data, builder, selection);
  if (!valid) return [];
  // R-14.6: bei Opfern werden deren Felder sofort frei und sind ebenfalls Ziel.
  return valid.kind === "card" ? playLocations(builder, valid.payment) : builder.freeLocations();
}

/**
 * Wendet einen gewählten Ort an: Karte → Einheit ausspielen (R-7.1, Schritt Ausspielen), Einheit → versetzen
 * (`PlanBuilder.relocate`, R-7.2). Liefert den Ablehnungsgrund oder `null`.
 */
export function applyTarget(data: GameData, builder: PlanBuilder, selection: BoardSelection, to: UnitLocation): PlanReason | null {
  const valid = validSelection(data, builder, selection);
  if (!valid) return "unknownUnit";
  if (valid.kind === "unit") return builder.relocate(valid.unitId, to);
  if (builder.step !== "play") builder.setStep("play");
  return builder.add(playAction(valid.cardInstanceId, to, valid.payment));
}

/**
 * Eigener Ort, dessen Feld bzw. Reserveplatz einem Punkt auf dem Brett am nächsten liegt, höchstens
 * `maxDistance` entfernt (sonst `null`). Kandidaten sind standardmäßig alle eigenen Orte; Orte von Zonen, die
 * gerade an keinem Kampf teilnehmen, haben keine Position und fallen weg.
 */
export function nearestLocation(
  data: GameData,
  layout: BoardLayout,
  owner: PlayerIndex,
  point: WorldPoint,
  maxDistance: number,
  candidates: readonly UnitLocation[] = allLocations(data.config),
): UnitLocation | null {
  let best: UnitLocation | null = null;
  let bestDistance = maxDistance;
  for (const loc of candidates) {
    const pos = locationPosition(layout, owner, loc);
    if (!pos) continue;
    const d = Math.hypot(pos.x - point.x, pos.z - point.z);
    if (d <= bestDistance) {
      best = loc;
      bestDistance = d;
    }
  }
  return best;
}
