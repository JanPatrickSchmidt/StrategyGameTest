/**
 * Übersicht der eigenen Karten (C5b1, R-11.2, R-18.1, R-18.2a): reine Logik ohne DOM.
 *
 * - Zeigt Hand, ausgespielte Karten, Deck und Ablagestapel des Betrachters mit Kartennamen und Anzahl.
 * - Das Deck erscheint ohne Reihenfolge (R-18.2a): `deckContents` ist nach Instanz sortiert, die Übersicht
 *   fasst gleiche Karten zusammen und sortiert nach Name.
 * - Karten, die der Betrachter in der zuletzt aufgelösten Runde gekauft hat, sind als „neu“ markiert, egal wo
 *   sie inzwischen liegen: Gekaufte Karten kommen beim Aufdecken auf den Ablagestapel (R-11.2), können aber beim
 *   Nachziehen am Rundenende ins Deck gemischt und gezogen werden (R-12.6).
 * - Grundlage für „neu“ sind allein die `card_bought`-Ereignisse der eigenen Sicht (R-19.3).
 */
import type { CardInstanceId, GameData, GameEvent, PlayerIndex, PlayerView } from "@game/engine";
import { ownEntry } from "./planner";

export type CardZone = "hand" | "played" | "deck" | "discard";

export const CARD_ZONE_NAMES: Record<CardZone, string> = {
  hand: "Hand",
  played: "Ausgespielt",
  deck: "Deck",
  discard: "Ablage",
};

export interface CardCount {
  cardId: string;
  name: string;
  count: number;
  /** Davon in der zuletzt aufgelösten Runde gekauft. */
  newCount: number;
}

export interface ZoneOverview {
  zone: CardZone;
  total: number;
  cards: CardCount[];
}

export interface BoughtCard {
  cardId: string;
  cardInstanceId: CardInstanceId;
}

/** R-11.2: Karten, die `player` in Runde `round` gekauft hat, in Kaufreihenfolge. */
export function boughtInRound(log: readonly GameEvent[], round: number, player: PlayerIndex): BoughtCard[] {
  const bought: BoughtCard[] = [];
  for (const event of log) {
    if (event.type === "card_bought" && event.round === round && event.player === player) {
      bought.push({ cardId: event.cardId, cardInstanceId: event.cardInstanceId });
    }
  }
  return bought;
}

function cardName(data: GameData, cardId: string): string {
  return data.cards.get(cardId)?.name ?? cardId;
}

function zoneCards(data: GameData, view: PlayerView, ids: readonly CardInstanceId[], fresh: ReadonlySet<CardInstanceId>): CardCount[] {
  const byCard = new Map<string, CardCount>();
  for (const id of ids) {
    const cardId = view.cards[id]?.cardId ?? "?";
    const entry = byCard.get(cardId) ?? { cardId, name: cardId === "?" ? "?" : cardName(data, cardId), count: 0, newCount: 0 };
    entry.count++;
    if (fresh.has(id)) entry.newCount++;
    byCard.set(cardId, entry);
  }
  return [...byCard.values()].sort((a, b) => a.name.localeCompare(b.name, "de") || a.cardId.localeCompare(b.cardId));
}

function zoneIds(view: PlayerView): Record<CardZone, readonly CardInstanceId[]> {
  const own = ownEntry(view);
  return { hand: own.hand, played: own.played, deck: own.deckContents, discard: own.discard };
}

/**
 * R-18.1, R-18.2a: eigene Karten je Bereich (Hand, Ausgespielt, Deck, Ablage). `fresh` = Instanzen, die als
 * „neu“ markiert werden (z. B. aus `boughtInRound`).
 */
export function ownCardOverview(data: GameData, view: PlayerView, fresh: ReadonlySet<CardInstanceId> = new Set()): ZoneOverview[] {
  const ids = zoneIds(view);
  return (Object.keys(CARD_ZONE_NAMES) as CardZone[]).map((zone) => ({
    zone,
    total: ids[zone].length,
    cards: zoneCards(data, view, ids[zone], fresh),
  }));
}

/** Eine Karte in der Übersicht, z. B. „Silber ×2 (1 neu)“ oder „Feuerball (neu)“. */
export function cardCountText(card: CardCount): string {
  const base = card.count > 1 ? `${card.name} ×${card.count}` : card.name;
  if (card.newCount === 0) return base;
  return card.count > 1 ? `${base} (${card.newCount} neu)` : `${base} (neu)`;
}

/** Zeile eines Bereichs, z. B. „Ablage (3): Münze ×2, Silber (neu)“. */
export function zoneLine(zone: ZoneOverview): string {
  const cards = zone.cards.length === 0 ? "–" : zone.cards.map(cardCountText).join(", ");
  return `${CARD_ZONE_NAMES[zone.zone]} (${zone.total}): ${cards}`;
}

/** Wo eine eigene Karteninstanz gerade liegt; `null` = nicht mehr bei den eigenen Karten (z. B. geläutert). */
export function cardZoneOf(view: PlayerView, id: CardInstanceId): CardZone | null {
  const ids = zoneIds(view);
  return (Object.keys(CARD_ZONE_NAMES) as CardZone[]).find((zone) => ids[zone].includes(id)) ?? null;
}

/**
 * Meldung nach einer Runde: was der Betrachter in Runde `round` gekauft hat und wo die Karten jetzt liegen,
 * z. B. „Neu gekauft in Runde 3: Silber (jetzt in Ablage), Feuerball (jetzt in Hand).“ Leer, wenn nichts gekauft.
 */
export function boughtNote(data: GameData, view: PlayerView, round: number): string {
  const bought = boughtInRound(view.log, round, view.viewer);
  if (bought.length === 0) return "";
  const parts = bought.map((b) => {
    const zone = cardZoneOf(view, b.cardInstanceId);
    return `${cardName(data, b.cardId)} (${zone ? `jetzt in ${CARD_ZONE_NAMES[zone]}` : "nicht mehr bei deinen Karten"})`;
  });
  return `Neu gekauft in Runde ${round}: ${parts.join(", ")}.`;
}
