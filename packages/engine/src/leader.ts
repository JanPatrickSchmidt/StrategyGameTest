/**
 * Anführer-XP und Aufstieg (R-6.6, R-12.3, R-16.1).
 */
import type { ConfigData } from "./data";
import { emit, type GameState, type LeaderState } from "./state";

const LEVELS = [2, 3, 4] as const;

/** R-16.1: Stufe, die zu einer XP-Zahl gehört (Schwellen aus `config.leader.levelThresholds`). */
export function levelForXp(xp: number, config: ConfigData): LeaderState["level"] {
  let level: LeaderState["level"] = 1;
  for (const l of LEVELS) {
    if (xp >= config.leader.levelThresholds[l]) level = l;
  }
  return level;
}

/** R-12.3: Jeder aktive Anführer erhält am Rundenende `config.leader.xpPerRound` XP. Aufgestiegen wird erst in R-6.6. */
export function grantRoundXp(state: GameState, config: ConfigData): void {
  const amount = config.leader.xpPerRound;
  if (amount <= 0) return;
  for (const p of state.players) {
    if (p.eliminated) continue;
    p.leader.xp += amount;
    emit(state, { type: "leader_xp_gained", player: p.index, amount, xp: p.leader.xp });
  }
}

/**
 * R-6.6: Zu Rundenbeginn steigt jeder aktive Anführer auf die Stufe auf, die seine XP erreichen.
 * Stufen sinken nie. Werden mehrere Stufen auf einmal erreicht, gibt es ein Ereignis je Stufe.
 * Die Astwahl bei Stufe 2 erfolgt in derselben Planung (R-7.7, E7c).
 */
export function levelUpLeaders(state: GameState, config: ConfigData): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    const target = levelForXp(p.leader.xp, config);
    for (const l of LEVELS) {
      if (l <= p.leader.level || l > target) continue;
      p.leader.level = l;
      emit(state, { type: "leader_leveled_up", player: p.index, level: l, xp: p.leader.xp });
    }
  }
}
