/**
 * Zauber legen in der Planung (R-7.3, E7c) und Auflösen (R-8.3 bis R-8.6, E11).
 *
 * E11a: Nachkampf-Zauber (R-8.4) lösen nach Tempo auf (1 vor 2 vor 3), bei gleichem Tempo in
 * Prioritätsreihenfolge (R-1.7), bei einem Spieler in der Reihenfolge des Legens; jeder Zauber wird
 * vollständig abgehandelt und geht danach sofort auf den Ablagestapel (R-8.6). Die Vorkampf-Zauber
 * (R-8.3) folgen in E11b und gehen bis dahin beim Rundenende ungenutzt auf den Ablagestapel.
 */
import type { RejectionReason } from "./actions";
import { applyStateEffect } from "./aftermath";
import type { GameData } from "./data";
import type { Condition, SpellCard } from "./dataTypes";
import { trashCards } from "./deck";
import { payGold } from "./economy";
import { priorityForRound } from "./marks";
import { checkTarget } from "./targets";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type SetSpell, type SpellSlot } from "./state";

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
 * Zauber aufgerufen (solange die Vorkampf-Zauber aus E11b fehlen, sind das die Vorkampf-Zauber).
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
