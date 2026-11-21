/**
 * Kaufangebot der Planung (C5a, R-4.5, R-11): reine Logik ohne DOM.
 *
 * - Angeboten werden alle Basisstapel, alle Königreich-Karten (gemeinsame Stapel) und der eigene Klassen-Pool,
 *   jeweils mit Kosten und Stapelstand zu Beginn der Runde (R-4.5). Nicht kaufbare Karten (z. B. Fluch,
 *   `buyable: false`) erscheinen nicht.
 * - Ein Spieler kauft von einem Stapel höchstens so viele Kopien, wie er zu Rundenbeginn enthält (R-11.3); aus
 *   einem leeren Stapel nichts (R-11.4). Ob ein Kauf jetzt möglich ist, entscheidet allein die Engine
 *   (`PlanBuilder.probe`), also auch das Gold (Rundenvorrat, dann Schatzkammer, R-11.1).
 * - Gekaufte Karten kommen beim Aufdecken auf den Ablagestapel (R-11.2, R-11.3).
 * - Einzahlen geschieht automatisch: übriges Gold des Rundenvorrats geht am Rundenende in die Schatzkammer
 *   (R-12.5, F12).
 */
import type { CardData, GameData, PlanningAction, PlayerView, RejectionReason } from "@game/engine";
import { ownEntry, type PlanBuilder } from "./planner";

export type PileGroup = "basic" | "kingdom" | "class";

export const PILE_GROUP_NAMES: Record<PileGroup, string> = {
  basic: "Basis",
  kingdom: "Königreich",
  class: "Klassen-Pool",
};

export interface BuyOption {
  cardId: string;
  card: CardData;
  group: PileGroup;
  cost: number;
  /** Kopien im Stapel zu Beginn der Runde (bei gemeinsamen Stapeln vor den Käufen aller Spieler). */
  pileAtStart: number;
  /** In dieser Planung schon (angenommen) gekaufte Kopien. */
  bought: number;
  /** `null` = jetzt kaufbar, sonst der Grund der Engine (z. B. `notEnoughGold`, `pileEmpty`). */
  blocked: RejectionReason | null;
}

function buyAction(cardId: string): PlanningAction {
  return { type: "buy", cardId };
}

/** In dieser Planung angenommene Käufe je Karte. */
export function boughtCounts(builder: PlanBuilder): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of builder.entries()) {
    if (entry.rejection || entry.action.type !== "buy") continue;
    counts.set(entry.action.cardId, (counts.get(entry.action.cardId) ?? 0) + 1);
  }
  return counts;
}

/**
 * R-4.5, R-11.2: alle Stapel, aus denen der Spieler kaufen darf, in der Reihenfolge Basis, Königreich,
 * Klassen-Pool, innerhalb einer Gruppe nach Kosten und Name.
 */
export function buyOptions(data: GameData, builder: PlanBuilder): BuyOption[] {
  const view = builder.preview();
  const own = ownEntry(view);
  const counts = boughtCounts(builder);
  const options: BuyOption[] = [];
  const add = (cardId: string, pileAtStart: number, group: PileGroup): void => {
    const card = data.cards.get(cardId);
    if (!card || card.buyable === false) return;
    options.push({
      cardId,
      card,
      group,
      cost: card.cost,
      pileAtStart,
      bought: counts.get(cardId) ?? 0,
      blocked: builder.probe("buy", buyAction(cardId)),
    });
  };
  for (const [cardId, count] of Object.entries(view.supply)) {
    const pool = data.cards.get(cardId)?.pool;
    if (pool === "basic" || pool === "kingdom") add(cardId, count, pool);
  }
  for (const [cardId, count] of Object.entries(own.classPool)) add(cardId, count, "class");
  const order: PileGroup[] = ["basic", "kingdom", "class"];
  return options.sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.cost - b.cost || a.card.name.localeCompare(b.card.name, "de"),
  );
}

/** Überschrift einer Gruppe; beim Klassen-Pool mit dem Namen der Klasse, z. B. „Klassen-Pool (Krieger)“. */
export function pileGroupName(data: GameData, group: PileGroup, options: readonly BuyOption[]): string {
  if (group !== "class") return PILE_GROUP_NAMES[group];
  const pool = options.find((o) => o.group === "class")?.card.pool;
  const classId = pool?.startsWith("class:") ? pool.slice("class:".length) : null;
  const name = classId ? data.classes.get(classId)?.name : undefined;
  return name ? `${PILE_GROUP_NAMES.class} (${name})` : PILE_GROUP_NAMES.class;
}

/** Kurzbeschreibung einer Karte für das Angebot, z. B. „Einheit · Angriff 3 · Leben 5“ oder „+2 Gold“. */
export function cardSummary(data: GameData, card: CardData): string {
  switch (card.type) {
    case "resource":
      return `Ressource · +${card.gold} Gold`;
    case "unit": {
      const race = card.race ? data.races.get(card.race)?.name : undefined;
      const cls = data.classes.get(card.class)?.name ?? card.class;
      const kind = [race, cls].filter(Boolean).join(" ");
      return `Einheit (${kind}) · Angriff ${card.stats.attack} · Leben ${card.stats.hp}${card.stats.range > 1 ? ` · Reichweite ${card.stats.range}` : ""}`;
    }
    case "spell":
      return `Zauber (${card.slot === "pre" ? "vor" : "nach"} dem Kampf)`;
    case "curse":
      return "Fluch";
  }
}

/** Text einer Angebotszeile: Name, Kosten, Stapel, z. B. „Silber · 3 Gold · Stapel 20 · gekauft 1“. */
export function buyOptionText(option: BuyOption): string {
  const parts = [option.card.name, `${option.cost} Gold`, `Stapel ${option.pileAtStart}`];
  if (option.bought > 0) parts.push(`gekauft ${option.bought}`);
  return parts.join(" · ");
}

/** R-11.2: Kauf planen (wechselt in den Schritt Kaufen). Liefert den Ablehnungsgrund oder `null`. */
export function addBuy(builder: PlanBuilder, cardId: string): RejectionReason | null {
  if (builder.step !== "buy") builder.setStep("buy");
  return builder.add(buyAction(cardId));
}

/** Summe des in dieser Planung für Käufe bezahlten Golds. */
export function buySpending(data: GameData, builder: PlanBuilder): number {
  let sum = 0;
  for (const [cardId, count] of boughtCounts(builder)) sum += (data.cards.get(cardId)?.cost ?? 0) * count;
  return sum;
}

/**
 * R-12.5 (F12): Einzahlen geschieht automatisch. Text zum übrigen Gold nach der Planung, z. B.
 * „Übrig: 2 Gold im Rundenvorrat – geht am Rundenende automatisch in die Schatzkammer (dann 5 Gold).“
 */
export function depositText(view: PlayerView): string {
  const own = ownEntry(view);
  if (own.roundGold <= 0) return `Kein Gold im Rundenvorrat übrig; die Schatzkammer bleibt bei ${own.treasury} Gold.`;
  return `Übrig: ${own.roundGold} Gold im Rundenvorrat – geht am Rundenende automatisch in die Schatzkammer (dann ${own.treasury + own.roundGold} Gold).`;
}
