/**
 * Anführer-Fähigkeiten auflösen (R-8.2, R-16.2, R-16.4, E11c).
 *
 * Die in der Planung gewählten Fähigkeiten (R-7.4) lösen in der Phase `leaderAbilities` nach Kategorien aus:
 * `summon` und `move` → `buff` → `damage`. Innerhalb einer Kategorie wirken sie gleichzeitig: alle Ziele einer
 * Kategorie werden festgelegt, bevor die erste Wirkung eintritt. Ereignisse erscheinen in Prioritätsreihenfolge
 * (R-1.7). Die Fähigkeit wirkt unabhängig davon, wo die Kampfeinheit des Anführers steht oder ob sie verwundet
 * ist (R-16.4); Stufe und Ast sind die der Planung (Aufstieg nur zu Rundenbeginn, R-6.6).
 *
 * E11c1: Rahmen und Kategorie `buff` (Brann, alle Äste). E11c2: Kategorie `damage` (Ilyra, alle Äste). E11c3:
 * Kategorie `summon` (Morgra, alle Äste) mit Feldkonflikt. Die Kategorie `move` (Vex, E11c4) folgt; bis dahin
 * bleibt sie ohne Wirkung.
 */
import type { ActionTarget, ArenaHex } from "./actions";
import { unitAt } from "./board";
import { compareRowCol, neighbors } from "./hex";
import type { GameData } from "./data";
import type { Amount, Effect, LeaderCategory, LeaderData } from "./dataTypes";
import { fighterForUnit } from "./fronts";
import { leaderAbilityParams } from "./leader";
import { priorityForRound } from "./marks";
import { addRoundBuff, createToken, dealPreCombatDamage, preCombatAllies, preCombatEnemies } from "./preCombat";
import { isUnwoundable } from "./spells";
import { emit, type GameState, getPlayer, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { arenaSize, globalHexKey, isOwnHex, ownLocationOfHex } from "./targets";
import { woundUnit } from "./wounds";

/** R-8.2: Reihenfolge der Kategorien; `summon` und `move` bilden eine gemeinsame Kategorie. */
export const LEADER_CATEGORY_STEPS: readonly (readonly LeaderCategory[])[] = [["summon", "move"], ["buff"], ["damage"]];

/** Kategorien, deren Wirkung schon umgesetzt ist (E11c1: `buff`, E11c2: `damage`, E11c3: `summon`). */
export const SUPPORTED_LEADER_CATEGORIES: ReadonlySet<LeaderCategory> = new Set(["buff", "damage", "summon"]);

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

/** Ein geplantes Feld einer Beschwörung (Kategorie `summon`). */
interface PlannedPlacement {
  hex: ArenaHex;
  location: UnitLocation;
  key: string;
}

type SummonEffect = Extract<Effect, { op: "summon" }>;

function compareLocations(a: UnitLocation, b: UnitLocation): number {
  if (a.zone === "center" && b.zone === "center") return a.position - b.position;
  if ((a.zone === "left" || a.zone === "right") && (b.zone === "left" || b.zone === "right")) return compareRowCol(a.cell, b.cell);
  return 0;
}

/**
 * `where: targetHexThenAdjacentFree` (E11c3): zuerst das gewählte Feld, dann die freien Nachbarfelder in eigenen
 * Zonen derselben Arena (Frontzone nach kleinstem `(row, col)` in Zonen-Koordinaten, Mitte nach Position; in der
 * Mitte nur der eigene Startbereich, F24), höchstens `count` Felder. Frei = keine eigene Einheit auf dem Ort
 * (verwundete und vor dem Kampf besiegte belegen ihr Feld, F41). Ist das gewählte Feld bei der Auflösung besetzt,
 * kommen die Tokens auf die Nachbarfelder (R-1.9, F44).
 */
function summonPlacements(state: GameState, data: GameData, player: PlayerIndex, hex: ArenaHex, count: number): PlannedPlacement[] {
  const { config } = data;
  const isFree = (loc: UnitLocation): boolean => unitAt(state, player, loc) === undefined;
  const result: PlannedPlacement[] = [];
  const target = ownLocationOfHex(config, player, hex);
  if (target && isFree(target)) result.push({ hex, location: target, key: globalHexKey(state, player, hex) });
  const adjacent = neighbors(hex.cell, arenaSize(config, hex.arena))
    .map((cell): ArenaHex => ({ arena: hex.arena, cell }))
    .filter((h) => isOwnHex(config, player, h))
    .map((h) => ({ hex: h, location: ownLocationOfHex(config, player, h) }))
    .filter((p): p is { hex: ArenaHex; location: UnitLocation } => p.location !== null && isFree(p.location))
    .sort((a, b) => compareLocations(a.location, b.location));
  for (const p of adjacent) result.push({ ...p, key: globalHexKey(state, player, p.hex) });
  return result.slice(0, Math.max(0, count));
}

/**
 * Kategorie `summon` (Morgra, E11c3, R-8.2): Jede Beschwörung erzeugt bis zu `count` Tokens (`summonPlacements`),
 * mit `statOverride` (ersetzt die Grundwerte des Tokens) und `countsForResonance` (Seelenband: zählt für die
 * Resonanz, R-17.1). Gleichzeitig: Erst werden für alle Fähigkeiten der Kategorie die Felder bestimmt; will mehr
 * als eine Fähigkeit dasselbe freie Feld belegen, scheitern dort alle (`leader_ability_hex_conflict`), Ersatzfelder
 * gibt es nicht. Die Tokens kämpfen in dieser Runde mit und werden wie alle Tokens nach den Kämpfen entfernt
 * (R-1.4). Ohne freies Feld verpufft die Fähigkeit (`noValidTarget`), wenn alle Felder am Konflikt scheitern
 * (`hexConflict`).
 */
function resolveSummonAbilities(state: GameState, data: GameData, queue: QueuedAbility[]): void {
  // 1. Planen: Felder aller Beschwörungen vor dem ersten Token.
  const planned = queue.map((a) => {
    const t = a.target;
    const hexes: ArenaHex[] = t.kind === "hexes" ? t.hexes : t.kind === "hex" ? [{ arena: t.arena, cell: t.cell }] : [];
    const summons = a.effects
      .filter((e): e is SummonEffect => e.op === "summon" && e.where === "targetHexThenAdjacentFree")
      .map((effect) => ({ effect, places: hexes.length > 0 ? summonPlacements(state, data, a.player, hexes[0] as ArenaHex, effect.count) : [] }));
    return { ability: a, summons };
  });
  // 2. Feldkonflikt: Felder, die mehr als eine Fähigkeit belegen will.
  const claims = new Map<string, number>();
  planned.forEach(({ summons }) => {
    for (const key of new Set(summons.flatMap((s) => s.places.map((p) => p.key)))) claims.set(key, (claims.get(key) ?? 0) + 1);
  });
  const contested = new Set([...claims].filter(([, n]) => n > 1).map(([key]) => key));
  // 3. Wirken in Prioritätsreihenfolge.
  for (const { ability, summons } of planned) {
    const { player, leader } = ability;
    const base = { player, leaderId: leader.id, category: leader.active.category };
    const lost = summons.flatMap((s) => s.places.filter((p) => contested.has(p.key)));
    for (const p of lost) emit(state, { type: "leader_ability_hex_conflict", player, leaderId: leader.id, hex: { arena: p.hex.arena, cell: { ...p.hex.cell } } });
    const kept = summons.map((s) => ({ effect: s.effect, places: s.places.filter((p) => !contested.has(p.key)) }));
    if (kept.every((s) => s.places.length === 0)) {
      emit(state, { type: "leader_ability_fizzled", ...base, reason: lost.length > 0 ? "hexConflict" : "noValidTarget" });
      continue;
    }
    emitResolved(state, ability);
    for (const { effect, places } of kept) {
      const options: { statOverride?: SummonEffect["statOverride"]; countsForResonance?: boolean } = {};
      if (effect.statOverride) options.statOverride = effect.statOverride;
      if (effect.countsForResonance === true) options.countsForResonance = true;
      for (const p of places) createToken(state, player, effect.token, p.location, leader.id, options);
    }
  }
}

/**
 * R-8.2: Phase `leaderAbilities` nach dem Aufdecken und vor den Vorkampf-Zaubern. Kategorien nacheinander,
 * innerhalb einer Kategorie gleichzeitig. Noch nicht umgesetzte Kategorien (`move`, E11c4) bleiben ohne Wirkung.
 */
export function resolveLeaderAbilities(state: GameState, data: GameData): void {
  for (const step of LEADER_CATEGORY_STEPS) {
    const queue = abilitiesOf(state, data, step).filter((a) => SUPPORTED_LEADER_CATEGORIES.has(a.leader.active.category));
    if (queue.length === 0) continue;
    if (step.includes("summon")) resolveSummonAbilities(state, data, queue);
    else if (step.includes("buff")) resolveBuffAbilities(state, data, queue);
    else if (step.includes("damage")) resolveDamageAbilities(state, data, queue);
  }
}
