/**
 * Markierungen „nächste Runde“ (E10b2, Spec R-17a.2).
 *
 * Effekte mit `when: "nextRound"` (bzw. `gainGold` mit `when: "roundStart"`, ausgelöst außerhalb des
 * Rundenbeginns) wirken nicht sofort, sondern werden am Spieler als Markierung gespeichert:
 * - `gold` wirkt beim Rundenbeginn der nächsten Runde (nach den Effekten „pro Runde“, vor den Zinsen, F32)
 *   und wird danach gelöscht.
 * - `startMana` wirkt beim Kampfbeginn der nächsten Runde in allen Kämpfen dieser Runde und wird nach der
 *   Kampfphase gelöscht.
 * Eine Markierung wirkt genau in einer Runde; ist ihre Runde vorbei, wird sie beim Rundenbeginn gelöscht.
 */
import type { GameData } from "./data";
import { gainGoldAfterPlanning, gainGoldDuringPlanning } from "./economy";
import { emit, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type RoundMark, type Unit, type UnitId } from "./state";

/** R-1.7: Prioritätsreihenfolge in Runde r (wie `priorityOrder` in `round.ts`, eigene Kopie gegen Import-Kreise). */
export function priorityForRound(round: number): PlayerIndex[] {
  const start = (round - 1) % PLAYER_INDICES.length;
  return PLAYER_INDICES.map((_, i) => ((start + i) % PLAYER_INDICES.length) as PlayerIndex);
}

/** Speichert eine Markierung am Spieler (ausgeschiedene Spieler bekommen keine). */
export function addRoundMark(state: GameState, player: PlayerIndex, mark: RoundMark): void {
  const p = getPlayer(state, player);
  if (p.eliminated) return;
  p.roundMarks.push(mark);
  emit(state, { type: "round_mark_set", player, mark });
}

function clearMarks(state: GameState, player: PlayerIndex, remove: (m: RoundMark) => boolean): void {
  const p = getPlayer(state, player);
  const kept: RoundMark[] = [];
  for (const mark of p.roundMarks) {
    if (remove(mark)) emit(state, { type: "round_mark_cleared", player, mark });
    else kept.push(mark);
  }
  p.roundMarks = kept;
}

/**
 * Rundenbeginn (R-17a.2): abgelaufene Markierungen löschen, Gold-Markierungen dieser Runde anwenden
 * (`to: "pool"` in den Rundenvorrat, `to: "treasury"` in die Schatzkammer, R-10.3) und löschen.
 * Spieler in Prioritätsreihenfolge, Markierungen in der Reihenfolge ihres Entstehens.
 */
export function applyRoundStartMarks(state: GameState): void {
  for (const player of priorityForRound(state.round)) {
    const p = getPlayer(state, player);
    if (p.eliminated) {
      clearMarks(state, player, () => true);
      continue;
    }
    clearMarks(state, player, (m) => m.round < state.round);
    for (const mark of p.roundMarks) {
      if (mark.kind !== "gold" || mark.round !== state.round) continue;
      emit(state, { type: "round_mark_applied", player, mark, unitIds: [] });
      if (mark.to === "pool") gainGoldDuringPlanning(state, player, mark.amount);
      else gainGoldAfterPlanning(state, player, mark.amount);
    }
    clearMarks(state, player, (m) => m.kind === "gold" && m.round === state.round);
  }
}

/** Klasse einer Einheit (Karte bzw. Anführer). */
function unitClass(data: GameData, unit: Unit): string | null {
  if (unit.kind === "leader") return data.leaders.get(unit.sourceId)?.class ?? null;
  const card = data.cards.get(unit.sourceId);
  return card && card.type === "unit" ? card.class : null;
}

/** Trifft eine Start-Mana-Markierung diese Einheit? Unterstützte Ziele: `ownClassUnits`, `allAllies`. */
function markHits(data: GameData, mark: Extract<RoundMark, { kind: "startMana" }>, unit: Unit): boolean {
  switch (mark.target) {
    case "ownClassUnits":
      return mark.classId === null || unitClass(data, unit) === mark.classId;
    case "allAllies":
      return true;
    default:
      return false;
  }
}

/**
 * Summe der Start-Mana-Prozente aus Markierungen der laufenden Runde für eine Einheit des Spielzustands
 * (mehrere Markierungen addieren sich; die Kampfsimulation deckelt bei `manaMax`).
 */
export function markedStartManaPercent(state: GameState, data: GameData, unit: Unit): number {
  const p = getPlayer(state, unit.owner);
  if (p.eliminated) return 0;
  let percent = 0;
  for (const mark of p.roundMarks) {
    if (mark.kind === "startMana" && mark.round === state.round && markHits(data, mark, unit)) percent += mark.percent;
  }
  return percent;
}

/**
 * Kampfbeginn (R-17a.2): meldet je Start-Mana-Markierung der laufenden Runde, welche teilnehmenden
 * Einheiten sie trifft. Die Wirkung selbst steckt in `fighterForUnit`.
 */
export function announceCombatMarks(state: GameState, data: GameData, participants: readonly Unit[]): void {
  for (const player of priorityForRound(state.round)) {
    const p = getPlayer(state, player);
    if (p.eliminated) continue;
    for (const mark of p.roundMarks) {
      if (mark.kind !== "startMana" || mark.round !== state.round) continue;
      const unitIds: UnitId[] = participants
        .filter((u) => u.owner === player && markHits(data, mark, u))
        .map((u) => u.id)
        .sort((a, b) => a - b);
      emit(state, { type: "round_mark_applied", player, mark, unitIds });
    }
  }
}

/** Nach der Kampfphase: Start-Mana-Markierungen der laufenden Runde löschen. */
export function clearCombatMarks(state: GameState): void {
  for (const player of priorityForRound(state.round)) {
    clearMarks(state, player, (m) => m.kind === "startMana" && m.round <= state.round);
  }
}
