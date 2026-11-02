/**
 * Rassen-Resonanz mit Rundenwirkung (E10c3, Spec R-17.4, F35).
 *
 * - Gezählt wird zu Beginn des Rundenbeginns, bevor sich etwas ändert (vor Genesung durch Reserve und
 *   Anführer-Aufstieg). Das ist das Brett am Ende der Vorrunde: Zwischen Aufräumen und Rundenbeginn
 *   ändert sich das Brett nicht.
 * - `gainGold` mit `when: "roundStart"` (Zwerge) wirkt sofort, Ziel laut `to` (Zwerge: Schatzkammer).
 * - `gainLeaderXp` (Menschen) gibt dem eigenen Anführer XP; der Aufstieg desselben Rundenbeginns
 *   berücksichtigt sie schon (R-6.6 kommt danach, R-1.9: so früh wie möglich).
 * - Reihenfolge: Resonanz-Gold → Effekte „pro Runde“ (R-17a.1) → Markierungen (R-17a.2) → Zinsen (R-6.1)
 *   → Bonuszinsen.
 * - `bonusInterest` (Zwerge 4): zusätzlich `amount` Gold pro volle `perGold` Gold in der Schatzkammer,
 *   berechnet auf derselben Grundlage wie die normalen Zinsen (vor deren Auszahlung) und nicht durch
 *   `interestMax` gedeckelt (F35).
 */
import { applyStateEffect } from "./aftermath";
import type { GameData } from "./data";
import { priorityForRound } from "./marks";
import { activeResonance, type ResonanceTier } from "./resonance";
import { emit, type GameState, getPlayer, type PlayerIndex } from "./state";

/** Resonanzstufen je aktivem Spieler (Prioritätsreihenfolge), gezählt zu Rundenbeginn. */
export type RoundResonance = { player: PlayerIndex; tiers: ResonanceTier[] }[];

/** Zählt die Resonanz aller aktiven Spieler nach dem aktuellen Brett (R-17.1). */
export function countRoundResonance(state: GameState, data: GameData): RoundResonance {
  return priorityForRound(state.round)
    .filter((p) => !getPlayer(state, p).eliminated)
    .map((player) => ({ player, tiers: activeResonance(state, data, player) }));
}

function hasRoundEffect(tier: ResonanceTier): boolean {
  return tier.effects.some(
    (e) => (e.op === "gainGold" && e.when === "roundStart") || e.op === "gainLeaderXp" || e.op === "bonusInterest",
  );
}

/**
 * R-17.4: Resonanz-Gold (`gainGold`, `when: roundStart`) und Anführer-XP (`gainLeaderXp`). Spieler in
 * Prioritätsreihenfolge, Rassen nach ID. Vor jeder Rasse mit Rundenwirkung das Ereignis `resonance_round`.
 */
export function applyRoundResonance(state: GameState, data: GameData, resonance: RoundResonance): void {
  for (const { player, tiers } of resonance) {
    if (getPlayer(state, player).eliminated) continue;
    for (const tier of tiers) {
      if (!hasRoundEffect(tier)) continue;
      emit(state, { type: "resonance_round", player, race: tier.race, count: tier.count, tier: tier.tier });
      for (const effect of tier.effects) {
        if ((effect.op === "gainGold" && effect.when === "roundStart") || effect.op === "gainLeaderXp") {
          applyStateEffect(state, data, effect, { player, unitId: null, frontOpponent: null, duringPlanning: true });
        }
      }
    }
  }
}

/** Bonuszinsen je Spieler und Rasse, berechnet auf der aktuellen Schatzkammer (vor den normalen Zinsen). */
export interface BonusInterest {
  player: PlayerIndex;
  race: string;
  amount: number;
}

export function bonusInterestFor(state: GameState, resonance: RoundResonance): BonusInterest[] {
  const result: BonusInterest[] = [];
  for (const { player, tiers } of resonance) {
    const p = getPlayer(state, player);
    if (p.eliminated) continue;
    for (const tier of tiers) {
      let amount = 0;
      for (const effect of tier.effects) {
        if (effect.op === "bonusInterest") amount += effect.amount * Math.floor(Math.max(0, p.treasury) / effect.perGold);
      }
      if (amount > 0) result.push({ player, race: tier.race, amount });
    }
  }
  return result;
}

/** Zahlt die vorher berechneten Bonuszinsen in die Schatzkammer (Ereignis `bonus_interest_paid`). */
export function payBonusInterest(state: GameState, bonus: readonly BonusInterest[]): void {
  for (const { player, race, amount } of bonus) {
    const p = getPlayer(state, player);
    p.treasury += amount;
    emit(state, { type: "bonus_interest_paid", player, race, amount, treasury: p.treasury });
  }
}
