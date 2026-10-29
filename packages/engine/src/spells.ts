/**
 * Zauber legen in der Planung (R-7.3, E7c). Die Auflösung (R-8.3 bis R-8.5) folgt in E11.
 */
import type { RejectionReason } from "./actions";
import type { GameData } from "./data";
import { payGold } from "./economy";
import { checkTarget } from "./targets";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type SpellSlot } from "./state";

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
 * Zauber aufgerufen (solange die Auflösung aus E11 fehlt, sind das alle).
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
