/**
 * Verwunden (R-14.4, E11b2): Verwundete Einheiten nehmen an keinem Kampf teil, bis sie genesen sind
 * (R-7.5, R-6.5), zählen aber gegen die Kapazität.
 *
 * - Vor dem Kampf: Zauber mit `wound` (Frostlanze) verwunden sofort (`woundUnit` mit `cardId`).
 * - Im Kampf: Wer von einem Effekt mit `wound` (`damage` mit `wound: true`) oder von einem Bezwinger mit
 *   `woundOnKill` (Giftklinge) besiegt wird, ist nach dem Kampf verwundet, außer er hat `unwoundable`
 *   (Zwerge 4). Die Kampfsimulation sammelt diese Einheiten (`CombatResult.wounded`), angewendet wird nach
 *   allen Kämpfen der Runde (`applyCombatWounds`), weil alle Kämpfe denselben Ausgangszustand nutzen (R-9).
 */
import { emit, type CenterResult, type FrontResult, type GameState, type Unit, type UnitId } from "./state";

/** Im Kampf verwundet besiegte Kämpfer, die Einheiten des Spielzustands sind (ohne Tokens), nach ID. */
export function woundedUnits(state: GameState, ids: readonly UnitId[]): UnitId[] {
  return ids.filter((id) => {
    const unit = state.units[id];
    return unit !== undefined && unit.kind !== "token";
  });
}

/** R-14.4: Einheit verwunden (ein schon verwundete bleibt es, ohne neues Ereignis). */
export function woundUnit(state: GameState, unit: Unit, cause: { cardId?: string; arena?: string }): void {
  if (unit.wounded) return;
  unit.wounded = true;
  emit(state, { type: "unit_wounded", player: unit.owner, unitId: unit.id, cardId: cause.cardId ?? null, arena: cause.arena ?? null });
}

/** R-14.4: nach allen Kämpfen der Runde die im Kampf verwundet besiegten Einheiten verwunden. */
export function applyCombatWounds(state: GameState, results: readonly (FrontResult | CenterResult)[]): void {
  for (const result of results) {
    for (const id of result.wounded) {
      const unit = state.units[id];
      if (unit && unit.kind !== "token") woundUnit(state, unit, { arena: result.arena });
    }
  }
}
