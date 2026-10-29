/**
 * Anführer-XP und Aufstieg (R-6.6, R-12.3, R-16.1), Astwahl (R-7.7) und Wahl der aktiven Fähigkeit
 * (R-7.4, R-16.4). Die Auflösung der Fähigkeit (R-8.2) folgt in E11.
 */
import type { RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
import type { Effect, LeaderData, TargetSpec } from "./dataTypes";
import { checkTarget, type TargetLimits } from "./targets";
import { emit, type GameState, getPlayer, type LeaderState, type PlayerIndex } from "./state";

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

/** Ziel-Angabe, Höchstzahlen und Effekte der aktiven Fähigkeit auf der aktuellen Stufe (R-16.2). */
export interface LeaderAbilityParams {
  target: TargetSpec;
  limits: TargetLimits;
  effects: Effect[];
}

/**
 * R-16.2: Stufe 1 nutzt `base`; ab Stufe 2 die Stufe des gewählten Asts (ohne Ast vorerst `base`;
 * beim Aufdecken wird nach dem Abschnitt `play` ohnehin der erste Ast gesetzt, R-7.7).
 */
export function leaderAbilityParams(leader: LeaderData, level: LeaderState["level"], branchId: string | null): LeaderAbilityParams {
  const branch = branchId === null ? undefined : leader.active.branches.find((b) => b.id === branchId);
  if (level === 1 || !branch) return { target: leader.active.target, limits: {}, effects: leader.active.base.effects };
  const lv = branch.levels[String(level) as "2" | "3" | "4"];
  const limits: TargetLimits = {};
  if (lv.hexes !== undefined) limits.hexes = lv.hexes;
  if (lv.zones !== undefined) limits.zones = lv.zones;
  if (lv.count !== undefined) limits.count = lv.count;
  return { target: leader.active.target, limits, effects: lv.effects };
}

function leaderData(data: GameData, leader: LeaderState): LeaderData {
  const l = data.leaders.get(leader.leaderId);
  if (!l) throw new RangeError(`Unbekannter Anführer ${leader.leaderId}`);
  return l;
}

/** R-7.7: Astwahl, nur ab Stufe 2 und solange noch kein Ast gewählt ist. */
export function chooseBranch(state: GameState, data: GameData, player: PlayerIndex, branchId: unknown): RejectionReason | null {
  const leader = getPlayer(state, player).leader;
  if (leader.level < 2 || leader.branchId !== null) return "branchNotAvailable";
  if (typeof branchId !== "string") return "malformed";
  if (!leaderData(data, leader).active.branches.some((b) => b.id === branchId)) return "unknownBranch";
  leader.branchId = branchId;
  emit(state, { type: "branch_chosen", player, branchId, auto: false });
  return null;
}

/**
 * R-7.7: Hat der Anführer Stufe 2 erreicht und der Spieler keinen Ast gewählt, wird beim Aufdecken der
 * erste Ast genommen – so früh wie möglich (R-1.9), also direkt nach dem Abschnitt `play`, damit eine
 * Anführer-Fähigkeit im Abschnitt `position` schon mit dem Ast gewählt wird.
 */
export function autoChooseBranch(state: GameState, data: GameData, player: PlayerIndex): void {
  const leader = getPlayer(state, player).leader;
  if (leader.level < 2 || leader.branchId !== null) return;
  const first = leaderData(data, leader).active.branches[0];
  if (!first) return;
  leader.branchId = first.id;
  emit(state, { type: "branch_chosen", player, branchId: first.id, auto: true });
}

/**
 * R-7.4: Anführer-Fähigkeit wählen, höchstens einmal pro Runde, kostenlos, unabhängig davon, wo die
 * Kampfeinheit steht oder ob sie verwundet ist (R-16.4). `{ kind: "none" }` = bewusst keine Fähigkeit.
 * Das Ziel wird nach der Ziel-Angabe der aktuellen Stufe und des Asts geprüft (R-14.2, R-16.2, R-16.6).
 */
export function setLeaderAbility(state: GameState, data: GameData, player: PlayerIndex, target: unknown): RejectionReason | null {
  const p = getPlayer(state, player);
  if (p.leaderAbility !== null) return "abilityAlreadySet";
  const params = leaderAbilityParams(leaderData(data, p.leader), p.leader.level, p.leader.branchId);
  const checked = checkTarget(state, data, player, params.target, params.limits, target, { allowNone: true });
  if (typeof checked === "string") return checked;
  p.leaderAbility = checked;
  emit(state, { type: "leader_ability_set", player, target: JSON.parse(JSON.stringify(checked)) as typeof checked });
  return null;
}

/** Rundenende: die gewählte Anführer-Fähigkeit gilt nur für diese Runde (R-16.4). */
export function resetLeaderAbilities(state: GameState): void {
  for (const p of state.players) p.leaderAbility = null;
}
