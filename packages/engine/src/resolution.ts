/**
 * Kampfauswertung (E12, R-10), Phase `combatResolution`.
 *
 * E12a: Durchbruch-Schaden und Grundschaden an den Fronten (R-10.1, R-10.5) sowie die Beute bei leerer
 * Front (R-10.2, Gold sofort in die Schatzkammer nach R-10.3). Mitte, Schwung/Trotz und Anführer-XP folgen
 * in E12b/E12c, das Ausscheiden in E12d.
 */
import type { ConfigData, GameData } from "./data";
import { gainGoldAfterPlanning } from "./economy";
import { emit, type FrontResult, type GameState, getPlayer, type PlayerIndex } from "./state";

/** R-10.5: Grundschaden einer Runde = `base + max(0, Runde − rampStartsAfterRound) × perRound` aus `config.baseDamage`. */
export function baseDamage(config: ConfigData, round: number): number {
  const b = config.baseDamage;
  return b.base + Math.max(0, round - b.rampStartsAfterRound) * b.perRound;
}

/** Verlierer einer Front-Paarung mit Sieger, sonst `null` (Unentschieden oder kein Kampf). */
export function frontLoser(result: FrontResult): PlayerIndex | null {
  if (result.winner === null) return null;
  return result.winner === result.first ? result.second : result.first;
}

/**
 * R-10.1, R-10.2, R-10.5: Für jede Front-Paarung der Runde (in der Reihenfolge der Ergebnisse) verliert der
 * Verlierer Leben = Durchbruch der überlebenden Einheiten des Siegers + Grundschaden. Bei leerer Front bekommt
 * der Sieger zusätzlich `config.emptyFrontLoot` Gold sofort in die Schatzkammer. Unentschieden und Fronten
 * ohne Kampf richten keinen Schaden an. Leben darf unter 0 fallen; ausgeschieden wird erst nach der ganzen
 * Kampfauswertung (R-13.1, E12d).
 */
export function resolveFrontDamage(state: GameState, data: GameData): void {
  const base = baseDamage(data.config, state.round);
  for (const result of state.frontResults) {
    if (result.round !== state.round) continue;
    const loser = frontLoser(result);
    if (loser === null || result.winner === null) continue;
    const winner = result.winner;
    const amount = result.winnerBreakthrough + base;
    const p = getPlayer(state, loser);
    p.life -= amount;
    emit(state, {
      type: "breakthrough_damage",
      arena: result.arena,
      winner,
      loser,
      breakthrough: result.winnerBreakthrough,
      baseDamage: base,
      amount,
      life: p.life,
    });
    if (result.outcome === "emptyFront") {
      const loot = data.config.emptyFrontLoot;
      emit(state, { type: "front_loot", arena: result.arena, player: winner, amount: loot });
      gainGoldAfterPlanning(state, winner, loot);
    }
  }
}

/** R-10: Kampfauswertung in der Phase `combatResolution` (bisher E12a). */
export function runCombatResolution(state: GameState, data: GameData): void {
  resolveFrontDamage(state, data);
}
