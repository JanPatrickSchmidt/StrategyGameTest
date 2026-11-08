/**
 * Siegprüfung (E12e, R-13.3–R-13.5).
 *
 * - Machtsieg (R-13.3) am Ende der Kampfauswertung, nach dem Ausscheiden (R-13.1): Wer als aktiver Spieler
 *   `config.powerToWin` Machtpunkte hat, gewinnt sofort; Nachkampf-Zauber und Rundenende entfallen (F51).
 * - Letzter Spieler (R-13.4) und Rundenlimit (R-13.5) in der Phase `victoryCheck` am Ende der Runde.
 * - Scheiden alle übrigen Spieler in derselben Runde aus, endet die Partie ebenfalls; Platz 1 hat dann, wer nach
 *   R-13.2 am besten platziert ist (F51).
 */
import type { GameData } from "./data";
import { emit, type GameState, type PlayerIndex, type PlayerState, type VictoryReason } from "./state";

/**
 * Platzierung nach Leben, dann Machtpunkten, sonst geteilt (R-13.3, R-13.5). Geteilte Plätze bekommen die
 * bessere Zahl, die nächste wird übersprungen (F50 b). `start` = erster zu vergebender Platz.
 */
export function placeByLifeThenPower(
  players: readonly { player: PlayerIndex; life: number; power: number }[],
  start: number,
): Map<PlayerIndex, number> {
  const placements = new Map<PlayerIndex, number>();
  for (const e of players) {
    const better = players.filter((o) => o.life > e.life || (o.life === e.life && o.power > e.power)).length;
    placements.set(e.player, start + better);
  }
  return placements;
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}

/** Beendet die Partie: setzt die Platzierungen der noch aktiven Spieler, `state.result` und `game_ended`. */
function endGame(state: GameState, reason: VictoryReason, activePlacements: Map<PlayerIndex, number>): void {
  for (const [player, placement] of activePlacements) {
    const p = state.players[player];
    if (p) p.placement = placement;
  }
  const winners = state.players.filter((p) => p.placement === 1).map((p) => p.index);
  state.result = { reason, round: state.round, winners };
  emit(state, {
    type: "game_ended",
    reason,
    winners,
    placements: state.players.map((p) => p.placement ?? state.players.length),
  });
}

/**
 * R-13.3: Machtsieg am Ende der Kampfauswertung. Alle aktiven Spieler mit mindestens `config.powerToWin`
 * Machtpunkten teilen sich Platz 1 (F51 b); die übrigen aktiven Spieler werden nach Leben, dann Machtpunkten
 * platziert, sonst geteilt. Gibt `true` zurück, wenn die Partie damit endet.
 */
export function checkPowerVictory(state: GameState, data: GameData): boolean {
  if (state.result !== null) return true;
  const active = activePlayers(state);
  const winners = active.filter((p) => p.power >= data.config.powerToWin);
  if (winners.length === 0) return false;
  const placements = new Map<PlayerIndex, number>(winners.map((p) => [p.index, 1]));
  const others = active.filter((p) => !winners.includes(p));
  const rest = placeByLifeThenPower(
    others.map((p) => ({ player: p.index, life: p.life, power: p.power })),
    winners.length + 1,
  );
  for (const [player, placement] of rest) placements.set(player, placement);
  endGame(state, "power", placements);
  return true;
}

/**
 * Siegprüfung am Ende der Runde (Phase `victoryCheck`): letzter Spieler (R-13.4), alle ausgeschieden (F51 c),
 * Rundenlimit nach Runde `config.maxRounds` (R-13.5, Platzierung nach Leben, dann Machtpunkten, sonst geteilt).
 * Gibt `true` zurück, wenn die Partie damit endet.
 */
export function checkEndOfRoundVictory(state: GameState, data: GameData): boolean {
  if (state.result !== null) return true;
  const active = activePlayers(state);
  if (active.length === 0) {
    endGame(state, "allEliminated", new Map());
    return true;
  }
  if (active.length === 1) {
    const last = active[0] as PlayerState;
    endGame(state, "lastPlayer", new Map([[last.index, 1]]));
    return true;
  }
  if (state.round >= data.config.maxRounds) {
    endGame(
      state,
      "roundLimit",
      placeByLifeThenPower(
        active.map((p) => ({ player: p.index, life: p.life, power: p.power })),
        1,
      ),
    );
    return true;
  }
  return false;
}
