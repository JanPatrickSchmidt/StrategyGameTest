/**
 * Deck, Mischen und Ziehen (R-4.2, R-6.3).
 */
import type { ConfigData } from "./data";
import { shuffleInPlace } from "./rng";
import { type CardInstanceId, emit, type GameState, getPlayer, type PlayerIndex } from "./state";

/** Mischt das Deck eines Spielers mit dem Partie-Zufall (R-1.8, R-4.2). */
export function shuffleDeck(state: GameState, player: PlayerIndex): void {
  const p = getPlayer(state, player);
  shuffleInPlace(state.rng, p.deck);
  emit(state, { type: "deck_shuffled", player, size: p.deck.length });
}

/**
 * R-6.3: Zieht bis zu `count` Karten. Ist das Deck leer, wird der Ablagestapel gemischt
 * und wird zum Deck. Sind beide leer, wird nicht weiter gezogen.
 * Gibt die gezogenen Karteninstanzen zurück.
 */
export function drawCards(state: GameState, player: PlayerIndex, count: number): CardInstanceId[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`drawCards: Anzahl muss eine nicht-negative ganze Zahl sein, war ${count}`);
  }
  const p = getPlayer(state, player);
  const drawn: CardInstanceId[] = [];
  while (drawn.length < count) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = p.discard;
      p.discard = [];
      shuffleInPlace(state.rng, p.deck);
      emit(state, { type: "discard_reshuffled", player, size: p.deck.length });
    }
    const card = p.deck.shift() as CardInstanceId;
    p.hand.push(card);
    drawn.push(card);
  }
  if (drawn.length > 0) {
    emit(state, { type: "cards_drawn", player, cardInstanceIds: [...drawn] }, [player]);
    emit(state, { type: "cards_drawn_count", player, count: drawn.length });
  }
  if (drawn.length < count) {
    emit(state, { type: "draw_stopped", player, missing: count - drawn.length });
  }
  return drawn;
}

/** R-6.3: Anzahl Karten, die ein Spieler zu Rundenbeginn zieht. */
export function roundDrawCount(config: ConfigData, bonusCards: number): number {
  return config.handSize + bonusCards;
}

/**
 * R-6.3: Rundenbeginn-Ziehen für alle aktiven Spieler in Spielerreihenfolge.
 * Fällige Bonuskarten (Mitte-Belohnung R-10.4) werden mitgezogen und verbraucht.
 */
export function drawForRound(state: GameState, config: ConfigData): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    const bonus = p.nextRound.cards;
    p.nextRound.cards = 0;
    drawCards(state, p.index, roundDrawCount(config, bonus));
  }
}
