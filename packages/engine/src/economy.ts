/**
 * Wirtschaft (E6): Zinsen, Rundenvorrat, Ressourcen, Entnahme, Bezahlen, Gold-Gewinne,
 * gleichzeitige Käufe und Einzahlung am Rundenende (R-6.1, R-6.4, R-7.6, R-10.3, R-11, R-12.5).
 */
import type { RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type PlayerState } from "./state";

/** R-6.1: Zinsen = min(interestMax, floor(Schatzkammer / interestPer)); die Schatzkammer hat keine Obergrenze (R-11.5). */
export function interestFor(treasury: number, config: ConfigData): number {
  return Math.max(0, Math.min(config.interestMax, Math.floor(treasury / config.interestPer)));
}

/** R-6.1: zahlt allen aktiven Spielern Zinsen in die Schatzkammer. */
export function payInterest(state: GameState, config: ConfigData): void {
  for (const p of activePlayers(state)) {
    const amount = interestFor(p.treasury, config);
    if (amount <= 0) continue;
    p.treasury += amount;
    emit(state, { type: "interest_paid", player: p.index, amount, treasury: p.treasury });
  }
}

/**
 * R-6.4: Alle Ressourcenkarten auf der Hand werden automatisch ausgespielt; ihr Gold geht in
 * den Rundenvorrat. Sie liegen bis zum Aufräumen im Spielbereich `played` (R-12.1).
 */
export function playResources(state: GameState, data: GameData): void {
  for (const p of activePlayers(state)) {
    const resources: number[] = [];
    let gold = 0;
    const rest: number[] = [];
    for (const id of p.hand) {
      const card = data.cards.get(getCard(state, id).cardId);
      if (card?.type === "resource") {
        resources.push(id);
        gold += card.gold;
      } else {
        rest.push(id);
      }
    }
    if (resources.length === 0) continue;
    p.hand = rest;
    p.played.push(...resources);
    p.roundGold += gold;
    emit(state, { type: "resources_played", player: p.index, cardInstanceIds: [...resources], gold }, [p.index]);
    emit(state, { type: "resources_played_count", player: p.index, count: resources.length });
  }
}

/** Verfügbares Gold in der Planung: Rundenvorrat plus Schatzkammer (R-7, R-11.1). */
export function availableGold(player: PlayerState): number {
  return player.roundGold + player.treasury;
}

export interface Payment {
  fromRoundGold: number;
  fromTreasury: number;
}

/**
 * Bezahlt `amount` Gold, zuerst aus dem Rundenvorrat, dann aus der Schatzkammer (R-7, R-11.1).
 * Gibt `null` zurück und ändert nichts, wenn das Gold nicht reicht.
 */
export function payGold(player: PlayerState, amount: number): Payment | null {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`payGold: ungültiger Betrag ${amount}`);
  if (availableGold(player) < amount) return null;
  const fromRoundGold = Math.min(player.roundGold, amount);
  const fromTreasury = amount - fromRoundGold;
  player.roundGold -= fromRoundGold;
  player.treasury -= fromTreasury;
  return { fromRoundGold, fromTreasury };
}

/** R-7.6: Entnahme aus der Schatzkammer in den Rundenvorrat. Gibt bei Ablehnung den Grund zurück. */
export function withdraw(state: GameState, player: PlayerIndex, amount: unknown): RejectionReason | null {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return "invalidAmount";
  const p = getPlayer(state, player);
  if (p.treasury < amount) return "notEnoughTreasury";
  p.treasury -= amount;
  p.roundGold += amount;
  emit(state, { type: "gold_withdrawn", player, amount, treasury: p.treasury });
  return null;
}

/** R-10.3: Gold-Gewinn nach der Planung geht sofort und vollständig in die Schatzkammer (keine Obergrenze, R-11.5). */
export function gainGoldAfterPlanning(state: GameState, player: PlayerIndex, amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`gainGold: ungültiger Betrag ${amount}`);
  if (amount === 0) return;
  const p = getPlayer(state, player);
  p.treasury += amount;
  emit(state, { type: "gold_gained", player, amount, treasury: p.treasury });
}

/** R-10.3, letzter Satz: Gold-Gewinne während der Planung gehen in den Rundenvorrat dieser Runde. */
export function gainGoldDuringPlanning(state: GameState, player: PlayerIndex, amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`gainGold: ungültiger Betrag ${amount}`);
  if (amount === 0) return;
  getPlayer(state, player).roundGold += amount;
  emit(state, { type: "round_gold_gained", player, amount });
}

export interface PurchaseRejection {
  player: PlayerIndex;
  index: number;
  cardId: string;
  reason: RejectionReason;
}

type PurchaseSource = "supply" | "classPool";

/**
 * Laufende Käufe einer Runde (R-11.1, R-11.3). Ob ein Stapel leer ist (R-11.4) und wie viele Kopien ein
 * Spieler höchstens kaufen darf, entscheidet der Stand **zu Beginn der Runde**; Käufe anderer Spieler
 * nehmen niemandem eine Kopie weg.
 */
export interface PurchaseSession {
  supplyAtStart: Record<string, number>;
  classPoolAtStart: Record<string, number>[];
  /** Je Spieler: Karten-ID → bisher bezahlte Kopien (Königreich/Basis bzw. Klassen-Pool getrennt). */
  supplyBought: Record<string, number>[];
  classBought: Record<string, number>[];
  /** Bezahlte, noch nicht verteilte Käufe in Ausführungsreihenfolge. */
  pending: { player: PlayerIndex; cardId: string; source: PurchaseSource }[];
}

/** R-11.3: hält den Stapelstand zu Beginn der Runde fest. */
export function startPurchases(state: GameState): PurchaseSession {
  return {
    supplyAtStart: { ...state.supply },
    classPoolAtStart: state.players.map((p) => ({ ...p.classPool })),
    supplyBought: state.players.map(() => ({})),
    classBought: state.players.map(() => ({})),
    pending: [],
  };
}

/**
 * R-11.1/R-11.2: ein Kauf im Abschnitt `buy`. Prüft Kaufbarkeit, leeren Stapel (R-11.4) und das
 * Limit pro Spieler (R-11.3) und zieht das Gold sofort ab (zuerst Rundenvorrat, dann Schatzkammer).
 * Die Karte wird erst in `finishPurchases` verteilt. Gibt bei Ablehnung den Grund zurück.
 */
export function buyCard(
  session: PurchaseSession,
  state: GameState,
  data: GameData,
  player: PlayerIndex,
  cardId: unknown,
): RejectionReason | null {
  if (typeof cardId !== "string") return "malformed";
  const card = data.cards.get(cardId);
  if (!card) return "unknownCard";
  if (card.buyable === false) return "notBuyable";
  const classAtStart = session.classPoolAtStart[player] ?? {};
  let source: PurchaseSource;
  if ((card.pool === "basic" || card.pool === "kingdom") && cardId in session.supplyAtStart) source = "supply";
  else if (card.pool.startsWith("class:") && cardId in classAtStart) source = "classPool";
  else return "notBuyable";
  const atStart = (source === "supply" ? session.supplyAtStart[cardId] : classAtStart[cardId]) ?? 0;
  const bought = (source === "supply" ? session.supplyBought : session.classBought)[player] ?? {};
  if (atStart <= 0) return "pileEmpty";
  if ((bought[cardId] ?? 0) >= atStart) return "pileLimitReached";
  const p = getPlayer(state, player);
  const payment = payGold(p, card.cost);
  if (!payment) return "notEnoughGold";
  bought[cardId] = (bought[cardId] ?? 0) + 1;
  session.pending.push({ player, cardId, source });
  emit(state, {
    type: "purchase_paid",
    player,
    cardId,
    source,
    paidFromRoundGold: payment.fromRoundGold,
    paidFromTreasury: payment.fromTreasury,
  });
  return null;
}

/**
 * R-11.3: verteilt alle bezahlten Käufe gleichzeitig. Jede Karte kommt als neue Instanz auf den
 * Ablagestapel ihres Käufers (Reihenfolge der Ausführung, also Prioritätsreihenfolge R-1.7). Danach
 * werden die Stapel verringert; wollen mehrere Spieler zusammen mehr Kopien als vorhanden, geht der
 * Stapel auf 0 und die fehlenden Kopien werden erzeugt. Klassen-Pools gehören einem Spieler allein,
 * dort entstehen wegen des Limits nie zusätzliche Kopien.
 */
export function finishPurchases(session: PurchaseSession, state: GameState): void {
  for (const { player, cardId, source } of session.pending) {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    getPlayer(state, player).discard.push(id);
    emit(state, { type: "card_bought", player, cardId, cardInstanceId: id, source });
  }
  const seen = new Set<PlayerIndex>();
  for (const { player } of session.pending) {
    if (seen.has(player)) continue;
    seen.add(player);
    const p = getPlayer(state, player);
    for (const [cardId, count] of Object.entries(session.classBought[player] ?? {})) {
      const before = p.classPool[cardId] ?? 0;
      p.classPool[cardId] = Math.max(0, before - count);
      emit(state, { type: "pile_changed", pile: cardId, owner: player, remaining: p.classPool[cardId] ?? 0, created: Math.max(0, count - before) });
    }
  }
  const supplyDemand: Record<string, number> = {};
  for (const { cardId, source } of session.pending) {
    if (source === "supply") supplyDemand[cardId] = (supplyDemand[cardId] ?? 0) + 1;
  }
  for (const [cardId, count] of Object.entries(supplyDemand)) {
    const before = state.supply[cardId] ?? 0;
    state.supply[cardId] = Math.max(0, before - count);
    emit(state, { type: "pile_changed", pile: cardId, owner: null, remaining: state.supply[cardId] ?? 0, created: Math.max(0, count - before) });
  }
  session.pending = [];
}

/**
 * R-11: Hilfsfunktion für Werkzeuge und Tests – alle Kauflisten in der angegebenen Reihenfolge
 * bezahlen und danach gleichzeitig verteilen. Fehlt das Gold für einen Kauf, wird nur dieser übersprungen.
 */
export function resolvePurchases(
  state: GameState,
  data: GameData,
  order: readonly PlayerIndex[],
  purchases: readonly (readonly string[] | null | undefined)[],
): PurchaseRejection[] {
  const session = startPurchases(state);
  const rejections: PurchaseRejection[] = [];
  for (const player of order) {
    (purchases[player] ?? []).forEach((cardId, index) => {
      const reason = buyCard(session, state, data, player, cardId);
      if (reason) rejections.push({ player, index, cardId, reason });
    });
  }
  finishPurchases(session, state);
  return rejections;
}

/**
 * R-12.5: am Rundenende geht das gesamte übrige Gold des Rundenvorrats automatisch in die
 * Schatzkammer. Gold verfällt nie (R-11.5); der Rundenvorrat der nächsten Runde beginnt bei 0 (R-6.2).
 */
export function depositRoundGold(state: GameState): void {
  for (const p of activePlayers(state)) {
    const amount = p.roundGold;
    if (amount <= 0) continue;
    p.treasury += amount;
    p.roundGold = 0;
    emit(state, { type: "gold_deposited", player: p.index, amount, treasury: p.treasury });
  }
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
