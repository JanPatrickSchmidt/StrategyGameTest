/**
 * Sitzordnung und Nachbarn im aktiven Ring (R-2).
 */
import { type GameState, PLAYER_INDICES, type PlayerIndex } from "./state";

/** R-2.2: nicht ausgeschiedene Spieler in Ringreihenfolge 0 → 1 → 2 → 3. */
export function activeRing(state: GameState): PlayerIndex[] {
  return PLAYER_INDICES.filter((p) => state.players[p] && !state.players[p].eliminated);
}

/**
 * R-2.2: rechter Nachbar = nächster Spieler im aktiven Ring, linker Nachbar = vorheriger.
 * `null`, wenn der Spieler nicht aktiv ist oder allein übrig ist. Bei 2 Spielern ist der andere
 * beides (R-2.5).
 */
export function neighborsOf(state: GameState, player: PlayerIndex): { left: PlayerIndex; right: PlayerIndex } | null {
  const ring = activeRing(state);
  const i = ring.indexOf(player);
  if (i < 0 || ring.length < 2) return null;
  const n = ring.length;
  return { left: ring[(i - 1 + n) % n] as PlayerIndex, right: ring[(i + 1) % n] as PlayerIndex };
}
