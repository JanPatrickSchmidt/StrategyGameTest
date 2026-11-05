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
 * Kategorie `summon` (Morgra, alle Äste) mit Feldkonflikt. E11c4a: Kategorie `move` (Vex, R-16.6), gemeinsam mit
 * `summon` geplant (Feldkonflikt über beide); der verzögerte Auslöser `onFrontWinOfChosen` (Beute) folgt in E11c4b.
 */
import type { ActionTarget, ArenaHex } from "./actions";
import { compareRowCol, neighbors } from "./hex";
import type { GameData } from "./data";
import type { Amount, Effect, LeaderCategory, LeaderData } from "./dataTypes";
import { fighterForUnit } from "./fronts";
import { leaderAbilityParams } from "./leader";
import { priorityForRound } from "./marks";
import { addRoundBuff, addRoundKeyword, createToken, dealPreCombatDamage, preCombatAllies, preCombatEnemies } from "./preCombat";
import { isUnwoundable } from "./spells";
import { emit, type GameState, getPlayer, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { arenaSize, globalHexKey, isArenaHexFree, isOwnHex, locationArenaHex, ownLocationOfHex } from "./targets";
import { fightsThisRound, woundUnit } from "./wounds";
import { isValidLocation, sameLocation } from "./board";

/** R-8.2: Reihenfolge der Kategorien; `summon` und `move` bilden eine gemeinsame Kategorie. */
export const LEADER_CATEGORY_STEPS: readonly (readonly LeaderCategory[])[] = [["summon", "move"], ["buff"], ["damage"]];

/** Kategorien, deren Wirkung umgesetzt ist (E11c1: `buff`, E11c2: `damage`, E11c3: `summon`, E11c4: `move`). */
export const SUPPORTED_LEADER_CATEGORIES: ReadonlySet<LeaderCategory> = new Set(["buff", "damage", "summon", "move"]);

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
  // E11c4: frei nach dem Stand dieser Runde, für Einheiten aller Spieler auf dem Feld der gemeinsamen Arena.
  const isFree = (loc: UnitLocation): boolean => {
    const at = locationArenaHex(config, player, loc);
    return at !== null && isArenaHexFree(state, config, player, at);
  };
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

type MoveEffect = Extract<Effect, { op: "move" }>;

/** Eine geplante Bewegung des Schattenschritts (Kategorie `move`). */
interface PlannedMove {
  unitId: UnitId;
  hex: ArenaHex;
  key: string;
  /** Kämpft die Einheit in dieser Runde und steht sie auf dem Brett? */
  available: boolean;
  /** Ist das Zielfeld bei der Auflösung frei (Stand vor allen Wirkungen der Kategorie)? */
  free: boolean;
}

/**
 * R-16.6, R-8.2 (E11c4): Bewegungen einer `move`-Fähigkeit. Gültig ist eine eigene Einheit, die in dieser Runde
 * kämpft (nicht verwundet, nicht vor dem Kampf besiegt) und auf dem Brett steht (nicht Reserve, F45). Das Zielfeld
 * muss bei der Auflösung frei sein – keine Einheit irgendeines Spielers auf dem Feld der gemeinsamen Arena.
 */
function plannedMoves(state: GameState, data: GameData, a: QueuedAbility): PlannedMove[] {
  if (a.target.kind !== "moveUnits" || !a.effects.some((e) => e.op === "move")) return [];
  return a.target.moves.map((m) => {
    const unit = state.units[m.unitId];
    const available = unit !== undefined && unit.owner === a.player && fightsThisRound(unit) && unit.location.zone !== "reserve" && !unit.shadowStep;
    return {
      unitId: m.unitId,
      hex: { arena: m.to.arena, cell: { ...m.to.cell } },
      key: globalHexKey(state, a.player, m.to),
      available,
      free: available && isArenaHexFree(state, data.config, a.player, m.to),
    };
  });
}

/** R-16.6 (E11c4): Schattenschritt ausführen; `location` bleibt das Ausgangsfeld. */
function shadowStep(state: GameState, unit: Unit, hex: ArenaHex, cardId: string): void {
  unit.shadowStep = { hex: { arena: hex.arena, cell: { ...hex.cell } } };
  emit(state, {
    type: "unit_shadow_stepped",
    player: unit.owner,
    unitId: unit.id,
    from: JSON.parse(JSON.stringify(unit.location)) as UnitLocation,
    to: { arena: hex.arena, cell: { ...hex.cell } },
    cardId,
  });
}

/**
 * Kategorie `summon` und `move` (R-8.2; Morgra E11c3, Vex E11c4). Gleichzeitig: Erst werden für alle Fähigkeiten
 * der Kategorie die Felder bestimmt (Beschwörungen nach `summonPlacements`, Bewegungen nach `plannedMoves`); will
 * mehr als eine Fähigkeit dasselbe freie Feld belegen, scheitern dort alle (`leader_ability_hex_conflict`),
 * Ersatzfelder gibt es nicht. Dann wirken die Fähigkeiten in Prioritätsreihenfolge.
 *
 * Beschwörung: bis zu `count` Tokens mit `statOverride` und `countsForResonance` (Seelenband, R-17.1); sie kämpfen
 * in dieser Runde mit und werden nach den Kämpfen entfernt (R-1.4).
 *
 * Schattenschritt (R-16.6): Jede gewählte Einheit, deren Zielfeld frei und nicht umkämpft ist, kämpft in dieser
 * Runde von dort aus (`unit.shadowStep`), auch in der gegnerischen Hälfte und überall in der Mitte; sonst meldet
 * `leader_ability_move_blocked` den Grund. Buffs und Schlüsselwörter der Äste (`chosenUnits`) gelten für alle
 * gültigen gewählten Einheiten, auch wenn ihre Bewegung scheitert (R-1.9, F45). Die Fähigkeit verpufft nur, wenn
 * kein Effekt eine Einheit trifft (`hexConflict`, wenn dabei Felder am Konflikt scheiterten, sonst `noValidTarget`).
 */
function resolveSummonAndMoveAbilities(state: GameState, data: GameData, queue: QueuedAbility[]): void {
  // 1. Planen: Felder aller Beschwörungen und Bewegungen vor der ersten Wirkung.
  const planned = queue.map((a) => {
    const t = a.target;
    const hexes: ArenaHex[] = t.kind === "hexes" ? t.hexes : t.kind === "hex" ? [{ arena: t.arena, cell: t.cell }] : [];
    const summons = a.effects
      .filter((e): e is SummonEffect => e.op === "summon" && e.where === "targetHexThenAdjacentFree")
      .map((effect) => ({ effect, places: hexes.length > 0 ? summonPlacements(state, data, a.player, hexes[0] as ArenaHex, effect.count) : [] }));
    return { ability: a, summons, moves: plannedMoves(state, data, a) };
  });
  // 2. Feldkonflikt: Felder, die mehr als eine Fähigkeit belegen will.
  const claims = new Map<string, number>();
  planned.forEach(({ summons, moves }) => {
    const keys = new Set([...summons.flatMap((s) => s.places.map((p) => p.key)), ...moves.filter((m) => m.free).map((m) => m.key)]);
    for (const key of keys) claims.set(key, (claims.get(key) ?? 0) + 1);
  });
  const contested = new Set([...claims].filter(([, n]) => n > 1).map(([key]) => key));
  // 3. Wirken in Prioritätsreihenfolge.
  for (const { ability, summons, moves } of planned) {
    const { player, leader } = ability;
    const base = { player, leaderId: leader.id, category: leader.active.category };
    const lostHexes = [
      ...summons.flatMap((s) => s.places.filter((p) => contested.has(p.key)).map((p) => p.hex)),
      ...moves.filter((m) => m.free && contested.has(m.key)).map((m) => m.hex),
    ];
    for (const h of lostHexes) emit(state, { type: "leader_ability_hex_conflict", player, leaderId: leader.id, hex: { arena: h.arena, cell: { ...h.cell } } });
    for (const m of moves) {
      if (m.free) continue;
      emit(state, {
        type: "leader_ability_move_blocked",
        player,
        leaderId: leader.id,
        unitId: m.unitId,
        hex: { arena: m.hex.arena, cell: { ...m.hex.cell } },
        reason: m.available ? "hexOccupied" : "unitUnavailable",
      });
    }
    const kept = summons.map((s) => ({ effect: s.effect, places: s.places.filter((p) => !contested.has(p.key)) }));
    const moving = moves.filter((m) => m.free && !contested.has(m.key));
    const chosen = moves.filter((m) => m.available).map((m) => state.units[m.unitId] as Unit);
    const hits = ability.effects.some((e) => {
      if (e.op === "summon") return kept.some((s) => s.effect === e && s.places.length > 0);
      if (e.op === "move") return moving.length > 0;
      if ((e.op === "buff" || e.op === "grantKeyword") && e.target === "chosenUnits") return chosen.length > 0;
      return false;
    });
    if (!hits) {
      emit(state, { type: "leader_ability_fizzled", ...base, reason: lostHexes.length > 0 ? "hexConflict" : "noValidTarget" });
      continue;
    }
    emitResolved(state, ability);
    for (const { effect, places } of kept) {
      const options: { statOverride?: SummonEffect["statOverride"]; countsForResonance?: boolean } = {};
      if (effect.statOverride) options.statOverride = effect.statOverride;
      if (effect.countsForResonance === true) options.countsForResonance = true;
      for (const p of places) createToken(state, player, effect.token, p.location, leader.id, options);
    }
    for (const effect of ability.effects) {
      if (effect.op === "move") {
        for (const m of moving) shadowStep(state, state.units[m.unitId] as Unit, m.hex, leader.id);
      } else if (effect.op === "buff" && effect.target === "chosenUnits") {
        const duration = effect.duration === "combat" ? "combat" : "round";
        for (const unit of chosen) addRoundBuff(state, unit, effect.stat, fixedAmount(effect.amount), duration, leader.id);
      } else if (effect.op === "grantKeyword" && effect.target === "chosenUnits") {
        for (const unit of chosen) addRoundKeyword(state, unit, effect.keyword, leader.id);
      }
    }
  }
}

/**
 * R-16.6 (E11c4): Nach dem Aufräumen kehren alle Einheiten nach einem Schattenschritt auf ihr Ausgangsfeld zurück.
 * Ist es von einer anderen eigenen Einheit belegt: nächstes freies Feld derselben Zone (Frontzone nach kleinstem
 * `(row, col)`, Mitte nach Position), sonst der erste freie Reserveplatz; ist auch die Reserve voll, bleibt sie
 * auf dem Ausgangsfeld (F45). Ereignis `unit_returned`, nach ID.
 */
export function returnShadowSteppedUnits(state: GameState, data: GameData): void {
  const { config } = data;
  for (const unit of Object.values(state.units).sort((a, b) => a.id - b.id)) {
    if (!unit.shadowStep) continue;
    const from = unit.shadowStep.hex;
    delete unit.shadowStep;
    const isFree = (loc: UnitLocation): boolean => Object.values(state.units).every((u) => u.id === unit.id || u.owner !== unit.owner || u.shadowStep !== undefined || !sameLocation(u.location, loc));
    if (!isFree(unit.location)) {
      const zone = unit.location.zone;
      const candidates: UnitLocation[] = [];
      if (zone === "left" || zone === "right") {
        const { cols, rows } = config.arenas.frontZone;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) candidates.push({ zone, cell: { col, row } });
      } else if (zone === "center") {
        for (let position = 0; position < config.arenas.centerStartSlots; position++) candidates.push({ zone: "center", position });
      }
      for (let slot = 0; slot < config.reserveSlots; slot++) candidates.push({ zone: "reserve", slot });
      const next = candidates.find((loc) => isValidLocation(config, loc) && isFree(loc));
      if (next) unit.location = next;
    }
    emit(state, { type: "unit_returned", player: unit.owner, unitId: unit.id, from: { arena: from.arena, cell: { ...from.cell } }, to: JSON.parse(JSON.stringify(unit.location)) as UnitLocation });
  }
}

/**
 * R-8.2: Phase `leaderAbilities` nach dem Aufdecken und vor den Vorkampf-Zaubern. Kategorien nacheinander,
 * innerhalb einer Kategorie gleichzeitig.
 */
export function resolveLeaderAbilities(state: GameState, data: GameData): void {
  for (const step of LEADER_CATEGORY_STEPS) {
    const queue = abilitiesOf(state, data, step).filter((a) => SUPPORTED_LEADER_CATEGORIES.has(a.leader.active.category));
    if (queue.length === 0) continue;
    if (step.includes("summon")) resolveSummonAndMoveAbilities(state, data, queue);
    else if (step.includes("buff")) resolveBuffAbilities(state, data, queue);
    else if (step.includes("damage")) resolveDamageAbilities(state, data, queue);
  }
}
