/**
 * Einheiten-XP nach den Kämpfen (E10c4, Spec R-10.7, R-17.5, F36).
 *
 * - R-10.7: Jede Karten-Einheit, die einen Kampf überlebt hat, erhält `config.unitXpPerSurvivedFight` XP.
 *   Anführer (eigene XP, R-10.8, E12) und Tokens (verschwinden nach dem Kampf) erhalten keine Einheiten-XP.
 * - „Überlebt“ heißt: steht in `survivors` des Kampfergebnisses. Das gilt auch bei Unentschieden für die
 *   Überlebenden beider Seiten und bei leerer Front bzw. unbestrittener Mitte für alle Einheiten des
 *   Siegers bzw. Halters (R-1.9: zugunsten des Spielers).
 * - R-17.5: Menschen-Einheiten erhalten zusätzlich die `bonusXp` der aktiven Menschen-Resonanz (`target:
 *   raceUnits`). Maßgeblich ist die Resonanz nach dem Brett zu Beginn der Kampfphase, wie für alle
 *   Kampfboni der Runde (R-17.2).
 * - Vergabe direkt nach allen Kämpfen und den Kampf-Folgen; Reihenfolge der Kämpfe wie im Ergebnis
 *   (Fronten, dann Mitte), innerhalb eines Kampfes nach Einheiten-ID. Ereignis `unit_xp_gained`.
 */
import type { GameData } from "./data";
import { activeResonance, type ResonanceTier, unitRace } from "./resonance";
import { type CenterResult, emit, type FrontResult, type GameState, getPlayer, type PlayerIndex, type Unit } from "./state";
import { PLAYER_INDICES } from "./state";

/** Resonanzstufen je Spieler, gezählt zu Beginn der Kampfphase. */
export type CombatResonance = ReadonlyMap<PlayerIndex, readonly ResonanceTier[]>;

/** Zählt die Resonanz aller nicht ausgeschiedenen Spieler nach dem aktuellen Brett (R-17.1). */
export function countCombatResonance(state: GameState, data: GameData): CombatResonance {
  const result = new Map<PlayerIndex, readonly ResonanceTier[]>();
  for (const player of PLAYER_INDICES) {
    if (getPlayer(state, player).eliminated) continue;
    result.set(player, activeResonance(state, data, player));
  }
  return result;
}

/** R-17.5: zusätzliche XP für eine Einheit aus `bonusXp` (Ziel `raceUnits`) der aktiven Resonanz ihrer Rasse. */
export function resonanceBonusXp(data: GameData, unit: Unit, tiers: readonly ResonanceTier[]): number {
  const race = unitRace(data, unit);
  if (race === null) return 0;
  let bonus = 0;
  for (const tier of tiers) {
    if (tier.race !== race) continue;
    for (const effect of tier.effects) {
      if (effect.op === "bonusXp" && effect.target === "raceUnits" && typeof effect.amount === "number") {
        bonus += effect.amount;
      }
    }
  }
  return Math.max(0, bonus);
}

/** R-10.7, R-17.5: vergibt die XP an alle überlebenden Karten-Einheiten der Kämpfe dieser Runde. */
export function grantSurvivorXp(
  state: GameState,
  data: GameData,
  fights: { fronts: readonly FrontResult[]; center: CenterResult },
  resonance: CombatResonance,
): void {
  const base = data.config.unitXpPerSurvivedFight;
  const results: { arena: string; survivors: readonly number[] }[] = [...fights.fronts, fights.center];
  for (const { arena, survivors } of results) {
    for (const id of [...survivors].sort((a, b) => a - b)) {
      const unit = state.units[id];
      if (!unit || unit.kind !== "card") continue;
      if (getPlayer(state, unit.owner).eliminated) continue;
      const bonus = resonanceBonusXp(data, unit, resonance.get(unit.owner) ?? []);
      const amount = base + bonus;
      if (amount <= 0) continue;
      unit.xp += amount;
      emit(state, { type: "unit_xp_gained", player: unit.owner, unitId: unit.id, amount, bonus, xp: unit.xp, arena });
    }
  }
}
