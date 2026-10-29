/**
 * Deck, Mischen, Ziehen und Läutern (R-4.2, R-4.6, R-12.6, R-14.8, R-18.2a).
 */
import type { RejectionReason } from "./actions";
import type { ConfigData } from "./data";
import type { OwnCardZone } from "./dataTypes";
import { shuffleInPlace } from "./rng";
import { type CardInstanceId, emit, type GameState, getPlayer, type PlayerIndex } from "./state";

/** Mischt das Deck eines Spielers mit dem Partie-Zufall (R-1.8, R-4.2). */
export function shuffleDeck(state: GameState, player: PlayerIndex): void {
  const p = getPlayer(state, player);
  shuffleInPlace(state.rng, p.deck);
  emit(state, { type: "deck_shuffled", player, size: p.deck.length });
}

/**
 * R-12.6: Zieht bis zu `count` Karten von oben vom Deck. Enthält das Deck weniger Karten, als zu
 * ziehen sind, werden vorher Deck und Ablagestapel zusammen gemischt und bilden das neue Deck
 * (Ereignis `discard_reshuffled`, `size` = Größe des neuen Decks). Reicht auch das nicht, werden
 * alle vorhandenen Karten gezogen (`draw_stopped`). Ist der Ablagestapel leer, wird nicht gemischt:
 * dann werden ohnehin alle Deckkarten gezogen. Gilt auch für die Starthand (R-4.6).
 * Gibt die gezogenen Karteninstanzen zurück.
 */
export function drawCards(state: GameState, player: PlayerIndex, count: number): CardInstanceId[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`drawCards: Anzahl muss eine nicht-negative ganze Zahl sein, war ${count}`);
  }
  const p = getPlayer(state, player);
  if (p.deck.length < count && p.discard.length > 0) {
    p.deck = [...p.deck, ...p.discard];
    p.discard = [];
    shuffleInPlace(state.rng, p.deck);
    emit(state, { type: "discard_reshuffled", player, size: p.deck.length });
  }
  const drawn = p.deck.splice(0, count);
  p.hand.push(...drawn);
  if (drawn.length > 0) {
    emit(state, { type: "cards_drawn", player, cardInstanceIds: [...drawn] }, [player]);
    emit(state, { type: "cards_drawn_count", player, count: drawn.length });
  }
  if (drawn.length < count) {
    emit(state, { type: "draw_stopped", player, missing: count - drawn.length });
  }
  return drawn;
}

/** R-12.6: Anzahl Karten beim Nachziehen am Rundenende (Handgröße plus fällige Bonuskarten, R-10.4). */
export function endOfRoundDrawCount(config: ConfigData, bonusCards: number): number {
  return config.handSize + bonusCards;
}

/** R-4.6: Starthand – nach dem Mischen zieht jeder Spieler `handSize` Karten, in Spielerreihenfolge. */
export function drawStartingHands(state: GameState, config: ConfigData): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    drawCards(state, p.index, config.handSize);
  }
}

/**
 * R-12.6: Nachziehen am Rundenende für alle aktiven Spieler in Spielerreihenfolge.
 * Fällige Bonuskarten (Mitte-Belohnung R-10.4) werden mitgezogen und verbraucht.
 */
export function drawEndOfRound(state: GameState, config: ConfigData): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    const bonus = p.nextRound.cards;
    p.nextRound.cards = 0;
    drawCards(state, p.index, endOfRoundDrawCount(config, bonus));
  }
}

export interface OwnCardEntry {
  cardInstanceId: CardInstanceId;
  cardId: string;
}

/**
 * R-18.2a: Inhalt des eigenen Decks ohne Reihenfolge (für die Wahl beim Läutern, R-14.8).
 * Sortiert nach Karten-ID und dann nach Instanz-ID; Instanz-IDs entstehen beim Erzeugen der Karte
 * und verraten nichts über die Position im Deck.
 */
export function ownDeckContents(state: GameState, player: PlayerIndex): OwnCardEntry[] {
  return getPlayer(state, player)
    .deck.map((id) => ({ cardInstanceId: id, cardId: state.cards[id]?.cardId ?? "" }))
    .sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.cardInstanceId - b.cardInstanceId));
}

/**
 * R-14.8: prüft die Kartenwahl beim Legen eines Läutern-Zaubers: höchstens `max` verschiedene
 * eigene Karteninstanzen, jede in einem der erlaubten Bereiche (`from`). Hand und ausgespielte
 * Karten sind nie erlaubt. Gibt bei Ablehnung den Grund zurück.
 */
export function checkOwnCardsChoice(
  state: GameState,
  player: PlayerIndex,
  spec: { max: number; from: readonly OwnCardZone[] },
  cardInstanceIds: unknown,
): RejectionReason | null {
  if (!Array.isArray(cardInstanceIds)) return "malformed";
  if (cardInstanceIds.length > spec.max) return "tooManyCards";
  const p = getPlayer(state, player);
  const seen = new Set<number>();
  for (const id of cardInstanceIds) {
    if (typeof id !== "number" || !Number.isInteger(id) || seen.has(id)) return "invalidCardChoice";
    seen.add(id);
    if (state.cards[id]?.owner !== player) return "invalidCardChoice";
    const inAllowedZone = spec.from.some((zone) => p[zone].includes(id));
    if (!inAllowedZone) return "invalidCardChoice";
  }
  return null;
}

/**
 * R-14.8: entfernt die Karten dauerhaft aus Deck oder Ablagestapel des Spielers. Die Reihenfolge
 * der übrigen Deckkarten bleibt unverändert, es wird nicht gemischt. Karten, die inzwischen nicht
 * mehr in Deck oder Ablagestapel liegen (z. B. gezogen), werden übersprungen. Gibt die entfernten
 * Karteninstanzen zurück.
 */
export function trashCards(state: GameState, player: PlayerIndex, cardInstanceIds: readonly CardInstanceId[]): CardInstanceId[] {
  const p = getPlayer(state, player);
  const trashed: { cardInstanceId: CardInstanceId; cardId: string; from: OwnCardZone }[] = [];
  for (const id of cardInstanceIds) {
    for (const zone of ["deck", "discard"] as const) {
      const pos = p[zone].indexOf(id);
      if (pos < 0) continue;
      p[zone].splice(pos, 1);
      trashed.push({ cardInstanceId: id, cardId: state.cards[id]?.cardId ?? "", from: zone });
      break;
    }
  }
  if (trashed.length > 0) emit(state, { type: "cards_trashed", player, cards: trashed });
  return trashed.map((t) => t.cardInstanceId);
}
