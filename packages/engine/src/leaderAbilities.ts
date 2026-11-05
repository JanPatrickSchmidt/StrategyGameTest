/**
 * Anführer-Fähigkeiten auflösen (R-8.2, R-16.2, R-16.4, E11c).
 *
 * Die in der Planung gewählten Fähigkeiten (R-7.4) lösen in der Phase `leaderAbilities` nach Kategorien aus:
 * `summon` und `move` → `buff` → `damage`. Innerhalb einer Kategorie wirken sie gleichzeitig: alle Ziele einer
 * Kategorie werden festgelegt, bevor die erste Wirkung eintritt. Ereignisse erscheinen in Prioritätsreihenfolge
 * (R-1.7). Die Fähigkeit wirkt unabhängig davon, wo die Kampfeinheit des Anführers steht oder ob sie verwundet
 * ist (R-16.4); Stufe und Ast sind die der Planung (Aufstieg nur zu Rundenbeginn, R-6.6).
 *
 * E11c1: Rahmen und Kategorie `buff` (Brann, alle Äste). E11c2: Kategorie `damage` (Ilyra, alle Äste). Die
 * Kategorien `summon` (Morgra, E11c3) und `move` (Vex, E11c4) folgen; bis dahin bleiben diese Fähigkeiten ohne
 * Wirkung.
 */
import type { ActionTarget } from "./actions";
import type { GameData } from "./data";
import type { Amount, Effect, LeaderCategory, LeaderData } from "./dataTypes";
import { fighterForUnit } from "./fronts";
import { leaderAbilityParams } from "./leader";
import { priorityForRound } from "./marks";
import { addRoundBuff, dealPreCombatDamage, preCombatAllies, preCombatEnemies } from "./preCombat";
import { isUnwoundable } from "./spells";
import { emit, type GameState, getPlayer, type PlayerIndex, type Unit, type UnitId } from "./state";
import { woundUnit } from "./wounds";

/** R-8.2: Reihenfolge der Kategorien; `summon` und `move` bilden eine gemeinsame Kategorie. */
export const LEADER_CATEGORY_STEPS: readonly (readonly LeaderCategory[])[] = [["summon", "move"], ["buff"], ["damage"]];

/** Kategorien, deren Wirkung schon umgesetzt ist (E11c1: `buff`, E11c2: `damage`). */
export const SUPPORTED_LEADER_CATEGORIES: ReadonlySet<LeaderCategory> = new Set(["buff", "damage"]);

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
    emitResolved(state, ability);
    ability.effects.forEach((effect, i) => {
      if (effect.op !== "buff") return;
      const duration = effect.duration === "combat" ? "combat" : "round";
      for (const unit of targets[i] ?? []) addRoundBuff(state, unit, effect.stat, fixedAmount(effect.amount), duration, leader.id);
    });
  }
}

/** Ereignis `leader_ability_resolved` mit Stufe und Ast der Planung. */
function emitResolved(state: GameState, ability: QueuedAbility): void {
  const { player, leader } = ability;
  const l = getPlayer(state, player).leader;
  emit(state, {
    type: "leader_ability_resolved",
    player,
    leaderId: leader.id,
    category: leader.active.category,
    level: l.level,
    branchId: l.level === 1 ? null : l.branchId,
  });
}

/** Ein geplanter Treffer der Kategorie `damage`. */
interface PlannedHit {
  unit: Unit;
  amount: number;
  wound: boolean;
}

/**
 * Kategorie `damage` (Ilyra, E11c2, R-8.2, R-14.2): Schaden trifft nur gegnerische Einheiten (`hexEnemies` auf den
 * gewählten Feldern – bei „Kette“ bis zu `hexes` Felder –, `hexAndNeighborEnemies` auf dem Feld und seinen
 * Nachbarfeldern innerhalb der Arena, „Sturm“), die in dieser Runde kämpfen würden. Gleichzeitig: Zuerst werden für
 * alle Fähigkeiten der Kategorie die Ziele und die Kampfwerte (Leben, Panzer) bestimmt, dann wird der Schaden
 * angewendet; ein Treffer trifft deshalb auch eine Einheit, die ein anderer Treffer desselben Schritts schon
 * besiegt hat. Wie Feuerball (R-9.5): erst Schild aus Vorkampf-Effekten, dann Panzer (mindestens 1). Wird eine
 * Einheit in diesem Schritt besiegt und traf sie ein Schaden mit `wound` („Wucht“), ist sie verwundet (R-14.4;
 * außer `unwoundable`, keine Tokens). Ohne Ziel verpufft die Fähigkeit (F42).
 */
function resolveDamageAbilities(state: GameState, data: GameData, queue: QueuedAbility[]): void {
  // 1. Berechnen: Ziele und Kampfwerte aller Fähigkeiten vor dem ersten Schaden.
  const stats = new Map<UnitId, { hp: number; armor: number }>();
  const planned = queue.map((a) => {
    const hits: PlannedHit[] = [];
    for (const effect of a.effects) {
      if (effect.op !== "damage" || typeof effect.target !== "string") continue;
      for (const unit of preCombatEnemies(state, data.config, a.player, { target: a.target }, effect.target)) {
        if (!stats.has(unit.id)) {
          const s = fighterForUnit(state, data, unit, { col: 0, row: 0 }).stats;
          stats.set(unit.id, { hp: s.hp, armor: s.armor ?? 0 });
        }
        hits.push({ unit, amount: fixedAmount(effect.amount), wound: effect.wound === true });
      }
    }
    return { ability: a, hits };
  });
  // 2. Anwenden, Ereignisse in Prioritätsreihenfolge.
  const defeated: Unit[] = [];
  const woundHit = new Set<UnitId>();
  for (const { ability, hits } of planned) {
    if (hits.length === 0) {
      const { player, leader } = ability;
      emit(state, { type: "leader_ability_fizzled", player, leaderId: leader.id, category: leader.active.category, reason: "noValidTarget" });
      continue;
    }
    emitResolved(state, ability);
    for (const hit of hits) {
      if (hit.wound) woundHit.add(hit.unit.id);
      const s = stats.get(hit.unit.id) as { hp: number; armor: number };
      if (dealPreCombatDamage(state, hit.unit, hit.amount, s, ability.leader.id, { simultaneous: true })) defeated.push(hit.unit);
    }
  }
  // 3. R-14.4: Verwunden nach dem gleichzeitigen Schaden.
  for (const unit of defeated) {
    if (!woundHit.has(unit.id) || unit.kind === "token" || unit.wounded || isUnwoundable(state, data, unit)) continue;
    const cardId = planned.find((p) => p.hits.some((h) => h.unit.id === unit.id && h.wound))?.ability.leader.id ?? "";
    woundUnit(state, unit, { cardId });
  }
}

/**
 * R-8.2: Phase `leaderAbilities` nach dem Aufdecken und vor den Vorkampf-Zaubern. Kategorien nacheinander,
 * innerhalb einer Kategorie gleichzeitig. Noch nicht umgesetzte Kategorien (E11c3, E11c4) bleiben ohne Wirkung.
 */
export function resolveLeaderAbilities(state: GameState, data: GameData): void {
  for (const step of LEADER_CATEGORY_STEPS) {
    const queue = abilitiesOf(state, data, step).filter((a) => SUPPORTED_LEADER_CATEGORIES.has(a.leader.active.category));
    if (queue.length === 0) continue;
    if (step.includes("buff")) resolveBuffAbilities(state, data, queue);
    else if (step.includes("damage")) resolveDamageAbilities(state, data, queue);
  }
}
