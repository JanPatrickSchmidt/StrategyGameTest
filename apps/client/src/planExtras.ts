/**
 * Genesen, Entnahme und alternative Kosten in der Planung (C3c2, R-7.5, R-7.6, R-14.6): reine Logik ohne DOM.
 *
 * - Genesen (R-7.5): angeboten werden die eigenen verwundeten Einheiten vom Beginn der Planung, mit den Kosten
 *   1 Gold je Stern aus den Daten (`healCostPerStar`).
 * - Entnahme (R-7.6): Gold aus der Schatzkammer in den Rundenvorrat, in jedem Schritt erlaubt.
 * - Alternative Kosten (R-14.6): eine Einheitenkarte mit `altCost` kann normal oder alternativ bezahlt werden
 *   (Blutzoll in Leben, Opfer eigener Karten-Einheiten, Restgold). Das Feld eines Opfers wird sofort frei und
 *   ist deshalb als Zielort wählbar.
 * Ob eine Aktion gültig ist, entscheidet allein die Engine über den `PlanBuilder`.
 */
import type { AltCost, CardData, CardInstanceId, GameData, PlanningAction, PlayerView, RejectionReason, Unit, UnitId, UnitLocation } from "@game/engine";
import { altCostText, handCards, locationKey, ownEntry, type PlanBuilder, unitOptionText } from "./planner";

/** Eine Einheit zur Auswahl (Genesen, Opfer) mit Text nach R-3.8. */
export interface UnitOption {
  unitId: UnitId;
  label: string;
}

/** Wie eine Einheitenkarte bezahlt wird: normal (Gold) oder mit den alternativen Kosten samt gewählten Opfern. */
export type Payment = { kind: "normal" } | { kind: "alt"; sacrifice: UnitId[] };

export const NORMAL_PAYMENT: Payment = { kind: "normal" };

// ---------------------------------------------------------------------------------------------------------------
// R-7.5 Genesen

export interface HealOption extends UnitOption {
  cost: number;
}

/**
 * Verwundete eigene Einheiten, die genesen werden können. Nur Einheiten vom Beginn der Planung (neu
 * ausgespielte sind nie verwundet, und ihre IDs vergibt erst das Aufdecken).
 */
export function healOptions(data: GameData, builder: PlanBuilder): HealOption[] {
  return builder
    .movableUnits()
    .filter((u) => u.wounded)
    .map((u) => ({ unitId: u.id, label: unitOptionText(data, u), cost: data.config.healCostPerStar * u.stars }));
}

/** R-7.5: Genesen planen (Schritt Ausspielen, wechselt dorthin). Liefert den Ablehnungsgrund oder `null`. */
export function addHeal(builder: PlanBuilder, unitId: UnitId): RejectionReason | null {
  if (builder.step !== "play") builder.setStep("play");
  return builder.add({ type: "heal", unitId });
}

// ---------------------------------------------------------------------------------------------------------------
// R-7.6 Entnahme

/** Höchstens entnehmbares Gold: die Schatzkammer im Entwurf. */
export function withdrawMax(view: PlayerView): number {
  return ownEntry(view).treasury;
}

/** R-7.6: Entnahme im aktuellen Schritt planen (in jedem Schritt erlaubt). */
export function addWithdraw(builder: PlanBuilder, amount: number): RejectionReason | null {
  return builder.add({ type: "withdraw", amount });
}

// ---------------------------------------------------------------------------------------------------------------
// R-14.6 Alternative Kosten

/** Alternative Kosten einer Karte (`null` = keine). */
export function altCostOf(card: CardData): AltCost | null {
  return card.type === "unit" && card.altCost ? card.altCost : null;
}

/** Bezahlwahl für eine Einheitenkarte der Hand: normale Kosten und, falls vorhanden, die alternativen. */
export interface PaymentChoice {
  normalText: string;
  alt: { text: string; sacrifice: number; candidates: UnitOption[] } | null;
}

/**
 * Mögliche Opfer (R-14.6): eigene Karten-Einheiten (nicht Anführer, nicht Tokens) vom Beginn der Planung, auf
 * dem Brett oder in der Reserve, auch verwundete. Neu ausgespielte fallen weg, weil ihre IDs erst beim Aufdecken
 * feststehen.
 */
export function sacrificeCandidates(data: GameData, builder: PlanBuilder): UnitOption[] {
  return builder
    .movableUnits()
    .filter((u) => u.kind === "card")
    .map((u) => ({ unitId: u.id, label: unitOptionText(data, u) }));
}

/** Bezahlwahl für eine Einheitenkarte der Hand (`null`, wenn die Karte keine Einheit auf der Hand ist). */
export function paymentChoice(data: GameData, builder: PlanBuilder, cardInstanceId: CardInstanceId): PaymentChoice | null {
  const entry = handCards(data, builder.preview()).find((c) => c.instanceId === cardInstanceId);
  if (!entry || entry.card.type !== "unit") return null;
  const alt = altCostOf(entry.card);
  return {
    normalText: `${entry.card.cost} Gold`,
    alt: alt ? { text: altCostText(alt), sacrifice: alt.sacrifice ?? 0, candidates: alt.sacrifice ? sacrificeCandidates(data, builder) : [] } : null,
  };
}

/** Die Ausspiel-Aktion mit Bezahlwahl (R-7.1, R-14.6). */
export function playAction(cardInstanceId: CardInstanceId, to: UnitLocation, payment: Payment = NORMAL_PAYMENT): PlanningAction {
  const action: PlanningAction = { type: "playUnit", cardInstanceId, to: { ...to } as UnitLocation };
  if (payment.kind === "alt") {
    action.useAltCost = true;
    if (payment.sacrifice.length > 0) action.sacrifice = payment.sacrifice.slice();
  }
  return action;
}

/**
 * Zielorte zum Ausspielen: alle freien eigenen Orte und, bei alternativen Kosten mit Opfern, die Orte der
 * gewählten Opfer (sie werden sofort frei, R-14.6). Reihenfolge wie `allLocations`.
 */
export function playLocations(builder: PlanBuilder, payment: Payment = NORMAL_PAYMENT): UnitLocation[] {
  const free = builder.freeLocations();
  if (payment.kind !== "alt" || payment.sacrifice.length === 0) return free;
  const units = new Map<UnitId, Unit>(builder.movableUnits().map((u) => [u.id, u]));
  const keys = new Set(free.map(locationKey));
  const extra = payment.sacrifice
    .map((id) => units.get(id)?.location)
    .filter((loc): loc is UnitLocation => loc !== undefined && !keys.has(locationKey(loc)));
  return [...free, ...extra];
}
