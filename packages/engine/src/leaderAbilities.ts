/**
 * Anführer-Fähigkeiten auflösen (R-8.2, R-16.2, R-16.4, E11c).
 *
 * Die in der Planung gewählten Fähigkeiten (R-7.4) lösen in der Phase `leaderAbilities` nach Kategorien aus:
 * `summon` und `move` → `buff` → `damage`. Innerhalb einer Kategorie wirken sie gleichzeitig: alle Ziele einer
 * Kategorie werden festgelegt, bevor die erste Wirkung eintritt. Ereignisse erscheinen in Prioritätsreihenfolge
 * (R-1.7). Die Fähigkeit wirkt unabhängig davon, wo die Kampfeinheit des Anführers steht oder ob sie verwundet
 * ist (R-16.4); Stufe und Ast sind die der Planung (Aufstieg nur zu Rundenbeginn, R-6.6).
 *
 * E11c1: Rahmen und Kategorie `buff` (Brann, alle Äste). Die Kategorien `damage` (Ilyra, E11c2), `summon`
 * (Morgra, E11c3) und `move` (Vex, E11c4) folgen; bis dahin bleiben diese Fähigkeiten ohne Wirkung.
 */
import type { ActionTarget } from "./actions";
import type { GameData } from "./data";
import type { Amount, Effect, LeaderCategory, LeaderData } from "./dataTypes";
import { leaderAbilityParams } from "./leader";
import { priorityForRound } from "./marks";
import { addRoundBuff, preCombatAllies } from "./preCombat";
import { emit, type GameState, getPlayer, type PlayerIndex, type Unit } from "./state";

/** R-8.2: Reihenfolge der Kategorien; `summon` und `move` bilden eine gemeinsame Kategorie. */
export const LEADER_CATEGORY_STEPS: readonly (readonly LeaderCategory[])[] = [["summon", "move"], ["buff"], ["damage"]];

/** Kategorien, deren Wirkung schon umgesetzt ist (E11c1: `buff`). */
export const SUPPORTED_LEADER_CATEGORIES: ReadonlySet<LeaderCategory> = new Set(["buff"]);

/** Eine gewählte Fähigkeit, bereit zur Auflösung. */
interface QueuedAbility {
  player: PlayerIndex;
  leader: LeaderData;
  target: ActionTarget;
  effects: Effect[];
}

function fixedAmount(amount: Amount): number {
  return typeof amount === "number" ? amount : 0;
}

/**
 * Gewählte Fähigkeiten einer Kategorie in Prioritätsreihenfolge der Runde (R-1.7). Ausgeschiedene Spieler und
 * „keine Fähigkeit“ (`{ kind: "none" }`) lösen nichts aus.
 */
function abilitiesOf(state: GameState, data: GameData, categories: readonly LeaderCategory[]): QueuedAbility[] {
  const queue: QueuedAbility[] = [];
  for (const player of priorityForRound(state.round)) {
    const p = getPlayer(state, player);
    if (p.eliminated || p.leaderAbility === null || p.leaderAbility.kind === "none") continue;
    const leader = data.leaders.get(p.leader.leaderId);
    if (!leader || !categories.includes(leader.active.category)) continue;
    const params = leaderAbilityParams(leader, p.leader.level, p.leader.branchId);
    queue.push({ player, leader, target: p.leaderAbility, effects: params.effects });
  }
  return queue;
}

/**
 * Kategorie `buff` (Brann): Ziel `zoneAllies` = alle eigenen, nicht verwundeten und nicht vor dem Kampf besiegten
 * Einheiten der gewählten Zone(n) zum Zeitpunkt der Auflösung, inkl. Anführer und Tokens (wie bei Vorkampf-
 * Zaubern). Buffs `combat`/`round` liegen als `unit.roundEffects` an der Einheit und verfallen beim Aufräumen.
 * Hat kein Effekt eine gültige Einheit, verpufft die Fähigkeit (`leader_ability_fizzled`, analog R-8.5, F42).
 */
function resolveBuffAbilities(state: GameState, data: GameData, queue: QueuedAbility[]): void {
  // Gleichzeitig: erst alle Ziele festlegen, dann wirken.
  const planned = queue.map((a) => ({
    ability: a,
    targets: a.effects.map((e): Unit[] =>
      "target" in e && typeof e.target === "string" ? preCombatAllies(state, data.config, a.player, { target: a.target }, e.target) : [],
    ),
  }));
  for (const { ability, targets } of planned) {
    const { player, leader } = ability;
    const base = { player, leaderId: leader.id, category: leader.active.category };
    if (targets.every((t) => t.length === 0)) {
      emit(state, { type: "leader_ability_fizzled", ...base, reason: "noValidTarget" });
      continue;
    }
    const l = getPlayer(state, player).leader;
    emit(state, { type: "leader_ability_resolved", ...base, level: l.level, branchId: l.level === 1 ? null : l.branchId });
    ability.effects.forEach((effect, i) => {
      if (effect.op !== "buff") return;
      const duration = effect.duration === "combat" ? "combat" : "round";
      for (const unit of targets[i] ?? []) addRoundBuff(state, unit, effect.stat, fixedAmount(effect.amount), duration, leader.id);
    });
  }
}

/**
 * R-8.2: Phase `leaderAbilities` nach dem Aufdecken und vor den Vorkampf-Zaubern. Kategorien nacheinander,
 * innerhalb einer Kategorie gleichzeitig. Noch nicht umgesetzte Kategorien (E11c2–E11c4) bleiben ohne Wirkung.
 */
export function resolveLeaderAbilities(state: GameState, data: GameData): void {
  for (const step of LEADER_CATEGORY_STEPS) {
    const queue = abilitiesOf(state, data, step).filter((a) => SUPPORTED_LEADER_CATEGORIES.has(a.leader.active.category));
    if (queue.length === 0) continue;
    if (step.includes("buff")) resolveBuffAbilities(state, data, queue);
  }
}
