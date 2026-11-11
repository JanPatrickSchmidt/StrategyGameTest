/**
 * Vernichten (R-14.5, E16c2a): Die Einheit verlässt das Brett (oder die Reserve); ihre Karteninstanzen – nach
 * dem Verschmelzen alle drei (R-15.1) – gehen auf den Ablagestapel ihres Besitzers. Tokens haben keine Karte und
 * verschwinden (R-1.4). Feld und Kapazitätsplatz sind sofort frei.
 *
 * Anführer (R-1.5) werden hier noch nicht vernichtet: Ihre Rückkehr in der übernächsten Planung folgt mit E16c2b.
 */
import { emit, getPlayer, type GameState, type Unit, type UnitLocation } from "./state";

/** R-14.5: vernichtet eine Karten-Einheit oder ein Token sofort (Ereignis `unit_destroyed`). */
export function destroyUnit(state: GameState, unit: Unit, cardId: string): void {
  if (unit.kind === "leader") throw new RangeError("Anführer können noch nicht vernichtet werden (E16c2b)");
  if (state.units[unit.id] !== unit) throw new RangeError(`Einheit ${unit.id} steht nicht auf dem Brett`);
  delete state.units[unit.id];
  getPlayer(state, unit.owner).discard.push(...unit.cardInstanceIds);
  emit(state, {
    type: "unit_destroyed",
    player: unit.owner,
    unitId: unit.id,
    kind: unit.kind,
    sourceId: unit.sourceId,
    cardInstanceIds: [...unit.cardInstanceIds],
    from: copyLocation(unit.location),
    cardId,
  });
}

function copyLocation(loc: UnitLocation): UnitLocation {
  if (loc.zone === "center") return { zone: "center", position: loc.position };
  if (loc.zone === "reserve") return { zone: "reserve", slot: loc.slot };
  return { zone: loc.zone, cell: { col: loc.cell.col, row: loc.cell.row } };
}
