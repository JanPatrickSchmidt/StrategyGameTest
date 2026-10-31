/**
 * Wirkungen außerhalb des Kampfes (E10b, Spec R-10.3, R-14.7, R-17a.1).
 *
 * - Vorgemerkte Kampf-Effekte (`DeferredEffect` aus `effects.ts`) werden nach allen Kämpfen der Runde auf den
 *   Spielzustand angewendet: `gainGold` (R-10.3: nach der Planung immer in die Schatzkammer), `gainLeaderXp`,
 *   dauerhafte Buffs (`buff` mit `duration: "permanent"`), außerdem `giveCurse` und `stealGold`.
 * - `onFrontWin`: Einheiten der Siegerseite, die am Frontkampf teilgenommen haben (auch bei leerer Front,
 *   auch wenn sie im Kampf gestorben sind, F31).
 * - `onRoundStart` (R-17a.1): zu Rundenbeginn, z. B. Hehler mit Bedingung `inReserve`.
 *
 * Reihenfolge zwischen Spielern nach Prioritätsreihenfolge (R-1.7), innerhalb eines Spielers nach Einheiten-ID.
 */
import type { GameData } from "./data";
import type { Ability, Amount, Condition, Effect, PlayerTarget, Trigger } from "./dataTypes";
import type { DeferredEffect } from "./effects";
import { gainGoldAfterPlanning, gainGoldDuringPlanning } from "./economy";
import { addRoundMark, priorityForRound } from "./marks";
import {
  emit,
  type CenterResult,
  type FrontResult,
  type GameState,
  getPlayer,
  type PlayerIndex,
  type Unit,
  type UnitId,
} from "./state";

/** Zusammenhang, in dem ein Effekt außerhalb der Simulation wirkt. */
export interface StateEffectContext {
  /** Spieler, dem die auslösende Einheit gehört. */
  player: PlayerIndex;
  /** Auslösende Einheit (`null`, falls sie nicht mehr im Spielzustand steht, z. B. ein Kampf-Token). */
  unitId: UnitId | null;
  /** Gegner der Front-Paarung, falls der Effekt aus einem Frontkampf stammt (`frontOpponent`). */
  frontOpponent: PlayerIndex | null;
  /** `true` während des Rundenbeginns: Gold mit `to: "pool"` geht in den Rundenvorrat (R-10.3, letzter Satz). */
  duringPlanning: boolean;
}

const priority = priorityForRound;

function abilitiesOf(data: GameData, unit: Unit): readonly Ability[] {
  if (unit.kind === "leader") return data.leaders.get(unit.sourceId)?.abilities ?? [];
  const card = data.cards.get(unit.sourceId);
  return card && card.type === "unit" ? (card.abilities ?? []) : [];
}

/** Außerhalb des Kampfes zählen nur feste Zahlen; berechnete Werte beziehen sich auf eine Arena (0 hier). */
function fixedAmount(amount: Amount): number {
  return typeof amount === "number" ? amount : 0;
}

function resolvePlayer(target: PlayerTarget, ctx: StateEffectContext): PlayerIndex | null {
  switch (target) {
    case "frontOpponent":
    case "frontOpponentTreasury":
      return ctx.frontOpponent;
    case "targetPlayer":
      // Gewählte Spieler gibt es nur bei Zaubern (E11).
      return null;
  }
}

/** Karten-ID des Fluch-Stapels (erste Fluch-Karte der Daten, R-14.7). */
function curseCardId(data: GameData): string | null {
  for (const card of data.cards.values()) if (card.type === "curse") return card.id;
  return null;
}

/** R-14.7: legt einen Fluch aus dem Fluch-Stapel auf den Ablagestapel von `to`. Leerer Stapel: nichts. */
export function giveCurse(state: GameState, data: GameData, from: PlayerIndex, to: PlayerIndex, sourceUnitId: UnitId | null): boolean {
  const cardId = curseCardId(data);
  if (cardId === null) return false;
  const remaining = state.supply[cardId] ?? 0;
  if (remaining <= 0) return false;
  const target = getPlayer(state, to);
  if (target.eliminated) return false;
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: to };
  target.discard.push(id);
  state.supply[cardId] = remaining - 1;
  emit(state, { type: "curse_given", player: from, to, cardId, cardInstanceId: id, sourceUnitId });
  emit(state, { type: "pile_changed", pile: cardId, owner: null, remaining: remaining - 1, created: 0 });
  return true;
}

/** `stealGold`: höchstens so viel, wie die fremde Schatzkammer enthält, sofort in die eigene (R-10.3). */
export function stealGold(state: GameState, to: PlayerIndex, from: PlayerIndex, amount: number, sourceUnitId: UnitId | null): number {
  if (to === from) return 0;
  const victim = getPlayer(state, from);
  const thief = getPlayer(state, to);
  const stolen = Math.max(0, Math.min(Math.floor(amount), victim.treasury));
  if (stolen === 0) return 0;
  victim.treasury -= stolen;
  thief.treasury += stolen;
  emit(state, {
    type: "gold_stolen",
    player: to,
    from,
    amount: stolen,
    treasury: thief.treasury,
    fromTreasury: victim.treasury,
    sourceUnitId,
  });
  return stolen;
}

/** Eigener Anführer erhält XP; der Aufstieg folgt zu Rundenbeginn (R-6.6). */
export function gainLeaderXp(state: GameState, player: PlayerIndex, amount: number): void {
  if (amount <= 0) return;
  const p = getPlayer(state, player);
  if (p.eliminated) return;
  p.leader.xp += amount;
  emit(state, { type: "leader_xp_gained", player, amount, xp: p.leader.xp });
}

/**
 * Wendet einen Baustein auf den Spielzustand an, der außerhalb der Kampfsimulation wirkt. `amount` überschreibt
 * den Wert aus den Daten (z. B. der im Kampf berechnete Wert). Bausteine ohne Wirkung außerhalb des Kampfes
 * (Kampf-Bausteine, Resonanz-Bausteine E10c, Zauber-Bausteine E11) tun hier nichts. Effekte „nächste Runde“
 * werden als Markierung gespeichert (R-17a.2, `marks.ts`).
 */
export function applyStateEffect(state: GameState, data: GameData, effect: Effect, ctx: StateEffectContext, amount?: number): void {
  if (getPlayer(state, ctx.player).eliminated) return;
  switch (effect.op) {
    case "gainGold": {
      const value = amount ?? fixedAmount(effect.amount);
      if (value <= 0) return;
      // R-17a.2: „nächste Runde“ bzw. „zu Rundenbeginn“ außerhalb des Rundenbeginns → Markierung.
      if (effect.when === "nextRound" || (effect.when === "roundStart" && !ctx.duringPlanning)) {
        addRoundMark(state, ctx.player, { kind: "gold", round: state.round + 1, amount: value, to: effect.to ?? "pool" });
        return;
      }
      // R-10.3: nach der Planung immer in die Schatzkammer; zu Rundenbeginn nach `to` (Standard: Rundenvorrat).
      if (ctx.duringPlanning && (effect.to ?? "pool") === "pool") gainGoldDuringPlanning(state, ctx.player, value);
      else gainGoldAfterPlanning(state, ctx.player, value);
      return;
    }
    case "startManaPercent": {
      // R-17a.2: Start-Mana „nächste Runde“ (Funkenschmiede) als Markierung; `now` wirkt im Kampf (E10c).
      if (effect.when !== "nextRound") return;
      const value = amount ?? fixedAmount(effect.amount);
      if (value <= 0) return;
      addRoundMark(state, ctx.player, { kind: "startMana", round: state.round + 1, percent: value, target: effect.target, classId: effect.class ?? null });
      return;
    }
    case "gainLeaderXp":
      gainLeaderXp(state, ctx.player, amount ?? fixedAmount(effect.amount));
      return;
    case "stealGold": {
      const from = resolvePlayer(effect.from, ctx);
      if (from !== null) stealGold(state, ctx.player, from, amount ?? fixedAmount(effect.amount), ctx.unitId);
      return;
    }
    case "giveCurse": {
      const to = resolvePlayer(effect.to, ctx);
      if (to !== null) giveCurse(state, data, ctx.player, to, ctx.unitId);
      return;
    }
    default:
      return;
  }
}

/** Dauerhafter Buff auf eine Einheit des Spielzustands (Tokens nicht: sie verschwinden nach dem Kampf, R-1.4). */
export function addPermanentBuff(state: GameState, unitId: UnitId, stat: Extract<Effect, { op: "buff" }>["stat"], amount: number, sourceUnitId: UnitId): void {
  const unit = state.units[unitId];
  if (!unit || unit.kind === "token" || amount === 0) return;
  const buffs = unit.permanentBuffs ?? {};
  const total = (buffs[stat] ?? 0) + amount;
  buffs[stat] = total;
  unit.permanentBuffs = buffs;
  emit(state, { type: "unit_buffed_permanently", player: unit.owner, unitId, stat, amount, total, sourceUnitId });
}

/** Vorgemerkte Effekte eines Kampfes anwenden, in Auslösereihenfolge. */
export function applyDeferredEffects(
  state: GameState,
  data: GameData,
  deferred: readonly DeferredEffect[],
  frontOpponentOf: (player: PlayerIndex) => PlayerIndex | null,
): void {
  for (const d of deferred) {
    const player = d.team as PlayerIndex;
    const unitId = state.units[d.unit] ? d.unit : null;
    if (d.effect.op === "buff") {
      if (d.effect.duration !== "permanent") continue;
      for (const t of d.targets ?? []) addPermanentBuff(state, t, d.effect.stat, d.amount ?? fixedAmount(d.effect.amount), d.unit);
      continue;
    }
    applyStateEffect(state, data, d.effect, { player, unitId, frontOpponent: frontOpponentOf(player), duringPlanning: false }, d.amount);
  }
}

/** Bedingungen außerhalb des Kampfes (`data/README.md`). */
function conditionHolds(state: GameState, unit: Unit, condition: Condition | undefined, wonFront: boolean): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case "inReserve":
      return unit.location.zone === "reserve";
    case "wonFrontThisRound":
      return wonFront;
  }
}

function runUnitTrigger(
  state: GameState,
  data: GameData,
  unit: Unit,
  trigger: Trigger,
  arena: string | null,
  ctx: StateEffectContext,
  wonFront: boolean,
): void {
  for (const ability of abilitiesOf(data, unit)) {
    if (ability.trigger !== trigger || !conditionHolds(state, unit, ability.condition, wonFront)) continue;
    emit(state, { type: "ability_triggered", player: unit.owner, unitId: unit.id, sourceId: unit.sourceId, trigger, arena });
    for (const effect of ability.effects) {
      if (effect.op === "buff") {
        if (effect.duration === "permanent" && effect.target === "self") {
          addPermanentBuff(state, unit.id, effect.stat, fixedAmount(effect.amount), unit.id);
        }
        continue;
      }
      applyStateEffect(state, data, effect, ctx);
    }
  }
}

/**
 * `onFrontWin`: Für jede gewonnene Front (Sieger in Prioritätsreihenfolge, R-1.7; bei mehreren Fronten eines
 * Siegers in Paarungsreihenfolge) lösen die teilnehmenden Einheiten des Siegers nach aufsteigender ID aus.
 * `frontOpponent` ist der Verlierer dieser Front.
 */
export function runFrontWinEffects(state: GameState, data: GameData, fronts: readonly FrontResult[]): void {
  const order = priority(state.round);
  const won = fronts
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.winner !== null)
    .sort((a, b) => order.indexOf(a.r.winner as PlayerIndex) - order.indexOf(b.r.winner as PlayerIndex) || a.i - b.i);
  for (const { r } of won) {
    const winner = r.winner as PlayerIndex;
    const loser = winner === r.first ? r.second : r.first;
    for (const id of r.participants) {
      const unit = state.units[id];
      if (!unit || unit.owner !== winner) continue;
      runUnitTrigger(state, data, unit, "onFrontWin", r.arena, { player: winner, unitId: id, frontOpponent: loser, duringPlanning: false }, true);
    }
  }
}

/** Kampf-Ergebnisse samt vorgemerkter Effekte einer Kampfphase. */
export interface CombatPhaseOutcome {
  fronts: { result: FrontResult; deferred: DeferredEffect[] }[];
  center: { result: CenterResult; deferred: DeferredEffect[] } | null;
}

/**
 * Nach allen Kämpfen der Runde (R-9: gemeinsamer Ausgangszustand): erst die vorgemerkten Kampf-Effekte
 * (Fronten in Paarungsreihenfolge, dann die Mitte), dann `onFrontWin`.
 */
export function applyCombatAftermath(state: GameState, data: GameData, outcome: CombatPhaseOutcome): void {
  for (const { result, deferred } of outcome.fronts) {
    const opponent = (p: PlayerIndex): PlayerIndex | null => (p === result.first ? result.second : p === result.second ? result.first : null);
    applyDeferredEffects(state, data, deferred, opponent);
  }
  if (outcome.center) applyDeferredEffects(state, data, outcome.center.deferred, () => null);
  runFrontWinEffects(state, data, outcome.fronts.map((f) => f.result));
}

/**
 * R-17a.1: Effekte „pro Runde“ bzw. „in der Reserve“ (`onRoundStart`) zu Rundenbeginn. Spieler in
 * Prioritätsreihenfolge, ihre Einheiten nach aufsteigender ID. Gold mit `to: "pool"` geht in den
 * Rundenvorrat dieser Runde (R-10.3), mit `to: "treasury"` in die Schatzkammer.
 */
export function runRoundStartEffects(state: GameState, data: GameData): void {
  for (const p of priority(state.round)) {
    if (getPlayer(state, p).eliminated) continue;
    const units = Object.values(state.units)
      .filter((u) => u.owner === p)
      .sort((a, b) => a.id - b.id);
    for (const unit of units) {
      runUnitTrigger(state, data, unit, "onRoundStart", null, { player: p, unitId: unit.id, frontOpponent: null, duringPlanning: true }, false);
    }
  }
}
