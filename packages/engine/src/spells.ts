/**
 * Zauber legen in der Planung (R-7.3, E7c) und Auflösen (R-8.3 bis R-8.6, E11).
 *
 * E11a: Nachkampf-Zauber (R-8.4) lösen nach Tempo auf (1 vor 2 vor 3), bei gleichem Tempo in
 * Prioritätsreihenfolge (R-1.7), bei einem Spieler in der Reihenfolge des Legens; jeder Zauber wird
 * vollständig abgehandelt und geht danach sofort auf den Ablagestapel (R-8.6). Die Vorkampf-Zauber
 * (R-8.3) lösen in der Phase `preCombatSpells` genauso auf (E11b1: Schild, Buff, Schlüsselwort auf eigene
 * Einheiten, `preCombat.ts`; E11b2: Verwunden; E11b3: Schaden). Vorkampf-Zauber mit noch fehlenden Bausteinen
 * (Beschwören, E11b4) bleiben vorerst liegen und gehen beim Rundenende ungenutzt auf den Ablagestapel.
 */
import type { ArenaRef, RejectionReason } from "./actions";
import { applyStateEffect } from "./aftermath";
import type { GameData } from "./data";
import type { Amount, Condition, SpellCard } from "./dataTypes";
import { trashCards } from "./deck";
import { payGold } from "./economy";
import { priorityForRound } from "./marks";
import { fighterForUnit } from "./fronts";
import {
  addRoundBuff,
  addRoundKeyword,
  addRoundShield,
  dealPreCombatDamage,
  PRE_COMBAT_OPS,
  preCombatAllies,
  preCombatEnemies,
  summonZoneTokens,
  zoneFreeLocations,
} from "./preCombat";
import { checkTarget } from "./targets";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type SetSpell, type SpellSlot, type Unit } from "./state";
import { woundUnit } from "./wounds";

const SLOTS: readonly SpellSlot[] = ["pre", "post"];

/**
 * R-7.3: Zauber legen. Karte auf der Hand, Zauberkarte, Slot = Slot der Karte (F22), freier Platz im
 * Slot (`config.spellSlots`), Ziel passt zur Ziel-Angabe (R-14.2, R-14.8). Alle Prüfungen vor dem
 * Bezahlen; die Kosten werden sofort bezahlt (zuerst Rundenvorrat, dann Schatzkammer). Die Karte
 * verlässt die Hand und liegt bis zur Auflösung im Slot.
 */
export function setSpell(
  state: GameState,
  data: GameData,
  player: PlayerIndex,
  cardInstanceId: unknown,
  slot: unknown,
  target: unknown,
): RejectionReason | null {
  const p = getPlayer(state, player);
  if (typeof cardInstanceId !== "number" || !p.hand.includes(cardInstanceId)) return "cardNotInHand";
  const card = data.cards.get(getCard(state, cardInstanceId).cardId);
  if (!card || card.type !== "spell") return "notASpellCard";
  if (!(SLOTS as readonly unknown[]).includes(slot)) return "malformed";
  if (slot !== card.slot) return "wrongSlot";
  if (p.spells[card.slot].length >= data.config.spellSlots[card.slot]) return "slotFull";
  const checked = checkTarget(state, data, player, card.target, {}, target);
  if (typeof checked === "string") return checked;
  const payment = payGold(p, card.cost);
  if (!payment) return "notEnoughGold";

  p.hand = p.hand.filter((id) => id !== cardInstanceId);
  p.spells[card.slot].push({ cardInstanceId, cardId: card.id, target: checked });
  emit(state, {
    type: "spell_set",
    player,
    cardInstanceId,
    cardId: card.id,
    slot: card.slot,
    target: JSON.parse(JSON.stringify(checked)) as typeof checked,
    paidFromRoundGold: payment.fromRoundGold,
    paidFromTreasury: payment.fromTreasury,
  });
  return null;
}

/**
 * R-8.6: gelegte Zauber gehen auf den Ablagestapel. Wird beim Rundenende für alle noch liegenden
 * Zauber aufgerufen (Zauber ausgeschiedener Spieler und Vorkampf-Zauber mit noch fehlenden Bausteinen).
 */
export function discardSetSpells(state: GameState): void {
  for (const p of state.players) {
    for (const slot of SLOTS) {
      for (const spell of p.spells[slot]) {
        p.discard.push(spell.cardInstanceId);
        emit(state, { type: "spell_discarded", player: p.index, cardInstanceId: spell.cardInstanceId, slot });
      }
      p.spells[slot] = [];
    }
  }
}

/** Ein gelegter Zauber samt Karte und Besitzer, bereit zur Auflösung. */
interface QueuedSpell {
  player: PlayerIndex;
  spell: SetSpell;
  card: SpellCard;
}

function spellCard(data: GameData, cardId: string): SpellCard {
  const card = data.cards.get(cardId);
  if (!card || card.type !== "spell") throw new RangeError(`Keine Zauberkarte: ${cardId}`);
  return card;
}

/**
 * R-8.3/R-8.4: Auflösungsreihenfolge der Zauber eines Slots: Tempo aufsteigend, dann
 * Prioritätsreihenfolge der Runde (R-1.7), dann Reihenfolge des Legens. Ausgeschiedene Spieler zaubern nicht.
 */
export function spellResolutionOrder(state: GameState, data: GameData, slot: SpellSlot): QueuedSpell[] {
  const queue: (QueuedSpell & { prio: number; index: number })[] = [];
  priorityForRound(state.round).forEach((player, prio) => {
    const p = getPlayer(state, player);
    if (p.eliminated) return;
    p.spells[slot].forEach((spell, index) => queue.push({ player, spell, card: spellCard(data, spell.cardId), prio, index }));
  });
  queue.sort((a, b) => a.card.tempo - b.card.tempo || a.prio - b.prio || a.index - b.index);
  return queue.map(({ player, spell, card }) => ({ player, spell, card }));
}

/** Bedingung einer Zauberkarte zum Zeitpunkt der Auflösung (`data/README.md`). */
function spellConditionHolds(state: GameState, player: PlayerIndex, condition: Condition | undefined): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case "wonFrontThisRound":
      // Mindestens eine Front dieser Runde gewonnen (auch leere Front, R-10.2).
      return state.frontResults.some((r) => r.round === state.round && r.winner === player);
    case "inReserve":
      // Nur für Einheiten sinnvoll; ein Zauber steht nie in der Reserve.
      return false;
  }
}

/** R-8.6: Zauber verlässt den Slot und geht auf den Ablagestapel. */
function discardSpell(state: GameState, player: PlayerIndex, slot: SpellSlot, cardInstanceId: number): void {
  const p = getPlayer(state, player);
  const pos = p.spells[slot].findIndex((s) => s.cardInstanceId === cardInstanceId);
  if (pos < 0) return;
  p.spells[slot].splice(pos, 1);
  p.discard.push(cardInstanceId);
  emit(state, { type: "spell_discarded", player, cardInstanceId, slot });
}

/** Ziel-Spieler eines Zaubers, falls er noch gültig ist (nicht ausgeschieden). */
function targetPlayerOf(state: GameState, spell: SetSpell): PlayerIndex | null | "invalid" {
  if (spell.target.kind !== "player") return null;
  return getPlayer(state, spell.target.player).eliminated ? "invalid" : spell.target.player;
}

/**
 * Wirkt einen Zauber ohne Kampfbezug (E11a): `trash` (R-14.8), `giveCurse` (R-14.7), `gainGold` (R-10.3,
 * nach der Planung immer in die Schatzkammer), `startManaPercent` mit `when: "nextRound"` (R-17a.2,
 * Markierung). Bausteine für Einheiten vor dem Kampf folgen mit den Vorkampf-Zaubern (E11b).
 */
function resolveSpell(state: GameState, data: GameData, queued: QueuedSpell, slot: SpellSlot): void {
  const { player, spell, card } = queued;
  const base = { player, cardInstanceId: spell.cardInstanceId, cardId: card.id, slot };
  const targetPlayer = targetPlayerOf(state, spell);
  if (targetPlayer === "invalid") {
    emit(state, { type: "spell_fizzled", ...base, reason: "noValidTarget" });
    return;
  }
  if (!spellConditionHolds(state, player, card.condition)) {
    emit(state, { type: "spell_fizzled", ...base, reason: "conditionNotMet" });
    return;
  }
  emit(state, { type: "spell_resolved", ...base, tempo: card.tempo });
  for (const effect of card.effects) {
    switch (effect.op) {
      case "trash":
        if (spell.target.kind === "ownCards") trashCards(state, player, spell.target.cardInstanceIds);
        break;
      default:
        applyStateEffect(state, data, effect, { player, unitId: null, frontOpponent: null, duringPlanning: false, targetPlayer });
    }
  }
}

/**
 * R-8.4: Nachkampf-Zauber nach der Kampfauswertung auflösen (Reihenfolge `spellResolutionOrder`), jeden
 * vollständig, und danach auf den Ablagestapel legen (R-8.6), auch wenn er verpufft ist (R-8.5).
 */
export function resolvePostCombatSpells(state: GameState, data: GameData): void {
  for (const queued of spellResolutionOrder(state, data, "post")) {
    resolveSpell(state, data, queued, "post");
    discardSpell(state, queued.player, "post", queued.spell.cardInstanceId);
  }
}

/** Kann ein Vorkampf-Zauber aufgelöst werden (alle Bausteine in `PRE_COMBAT_OPS`, E11b1–E11b4)? */
export function isPreCombatSpellSupported(card: SpellCard): boolean {
  return card.effects.every((e) => PRE_COMBAT_OPS.has(e.op));
}

/**
 * R-14.4: Kann die Einheit verwundet werden? `unwoundable` aus Karte, Vorkampf-Zaubern oder Rassen-Resonanz
 * (Zwerge 4, gezählt nach dem aktuellen Brett) schützt (F39).
 */
export function isUnwoundable(state: GameState, data: GameData, unit: Unit): boolean {
  return (fighterForUnit(state, data, unit, { col: 0, row: 0 }).keywords ?? []).includes("unwoundable");
}

/**
 * Wirkt einen Vorkampf-Zauber (R-8.3): auf eigene Einheiten (E11b1), Verwunden gegnerischer Einheiten
 * (`wound`, Frostlanze, E11b2), Schaden an gegnerischen Einheiten (`damage`, Feuerball, E11b3, R-14.2) oder
 * Beschwören in eine eigene Zone (`summon` mit `zoneFree`, Geistertrommel, E11b4). Gibt es für keinen Effekt
 * eine gültige Einheit bzw. kein freies Feld (Feld leer, nur verwundete oder schon besiegte Einheiten, Zone leer,
 * nur Gegner mit `unwoundable`, Zone voll), verpufft er (R-8.5).
 */
function resolvePreCombatSpell(state: GameState, data: GameData, queued: QueuedSpell): void {
  const { player, spell, card } = queued;
  const base = { player, cardInstanceId: spell.cardInstanceId, cardId: card.id, slot: "pre" as const };
  if (!spellConditionHolds(state, player, card.condition)) {
    emit(state, { type: "spell_fizzled", ...base, reason: "conditionNotMet" });
    return;
  }
  const targetsOf = (effect: SpellCard["effects"][number]): Unit[] => {
    if (!("target" in effect) || typeof effect.target !== "string") return [];
    if (effect.op === "damage") return preCombatEnemies(state, data.config, player, spell, effect.target);
    if (effect.op === "wound") {
      return preCombatEnemies(state, data.config, player, spell, effect.target).filter((u) => !isUnwoundable(state, data, u));
    }
    return preCombatAllies(state, data.config, player, spell, effect.target);
  };
  // Ziele werden vor dem ersten Effekt festgelegt (R-8.5 gilt für den Zauber als Ganzes).
  const targets = card.effects.map(targetsOf);
  // `summon` mit `zoneFree` (Geistertrommel, E11b4): gültig, solange eine gewählte eigene Zone ein freies Feld hat.
  const summonZones: readonly ArenaRef[] = spell.target.kind === "zone" ? spell.target.arenas : [];
  const canSummon = (effect: SpellCard["effects"][number]): boolean =>
    effect.op === "summon" &&
    effect.where === "zoneFree" &&
    summonZones.some((zone) => zoneFreeLocations(state, data.config, player, zone).length > 0);
  if (targets.every((t) => t.length === 0) && !card.effects.some(canSummon)) {
    emit(state, { type: "spell_fizzled", ...base, reason: "noValidTarget" });
    return;
  }
  emit(state, { type: "spell_resolved", ...base, tempo: card.tempo });
  card.effects.forEach((effect, i) => {
    if (effect.op === "summon") {
      // R-8.3: je gewählter Zone `count` Tokens auf freie Felder; fehlen Felder, entstehen weniger (F41).
      if (effect.where === "zoneFree") {
        for (const zone of summonZones) summonZoneTokens(state, data.config, player, zone, effect.token, effect.count, card.id);
      }
      return;
    }
    for (const unit of targets[i] ?? []) {
      switch (effect.op) {
        case "shield":
          addRoundShield(state, unit, fixedAmount(effect.amount), card.id);
          break;
        case "buff":
          // `permanent` gibt es bei Vorkampf-Zaubern nicht; es würde wie `round` wirken.
          addRoundBuff(state, unit, effect.stat, fixedAmount(effect.amount), effect.duration === "combat" ? "combat" : "round", card.id);
          break;
        case "grantKeyword":
          addRoundKeyword(state, unit, effect.keyword, card.id);
          break;
        case "wound":
          // R-14.4: sofort verwundet, nimmt an keinem Kampf dieser Runde teil.
          woundUnit(state, unit, { cardId: card.id });
          break;
        case "damage": {
          // R-14.2, R-9.5: wie Fähigkeitsschaden durch Schild und Panzer; bleibt für alle Kämpfe der Runde.
          const stats = fighterForUnit(state, data, unit, { col: 0, row: 0 }).stats;
          const defeated = dealPreCombatDamage(state, unit, fixedAmount(effect.amount), { hp: stats.hp, armor: stats.armor ?? 0 }, card.id);
          // R-14.4: besiegt ein Schaden mit `wound` die Einheit, ist sie verwundet (außer `unwoundable`).
          if (defeated && effect.wound === true && unit.kind !== "token" && !isUnwoundable(state, data, unit)) {
            woundUnit(state, unit, { cardId: card.id });
          }
          break;
        }
        default:
          break;
      }
    }
  });
}

/** Außerhalb des Kampfes zählen nur feste Zahlen (berechnete Werte beziehen sich auf eine Arena). */
function fixedAmount(amount: Amount): number {
  return typeof amount === "number" ? amount : 0;
}

/**
 * R-8.3: Vorkampf-Zauber nach dem Aufdecken (und den Anführer-Fähigkeiten, E11c) auflösen, Reihenfolge wie
 * `spellResolutionOrder`, jeden vollständig; danach auf den Ablagestapel (R-8.6), auch wenn er verpufft (R-8.5).
 * Zauber mit unbekannten Bausteinen würden übersprungen; seit E11b4 sind alle Vorkampf-Zauber der Daten abgedeckt.
 */
export function resolvePreCombatSpells(state: GameState, data: GameData): void {
  for (const queued of spellResolutionOrder(state, data, "pre")) {
    if (!isPreCombatSpellSupported(queued.card)) continue;
    resolvePreCombatSpell(state, data, queued);
    discardSpell(state, queued.player, "pre", queued.spell.cardInstanceId);
  }
}
