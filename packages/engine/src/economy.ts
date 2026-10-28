/**
 * Wirtschaft (E6): Zinsen, Rundenvorrat, Ressourcen, Entnahme, Bezahlen, Gold-Gewinne,
 * gleichzeitige Käufe und Einzahlung (R-6.1, R-6.2, R-6.4, R-7.6, R-10.3, R-11).
 */
import type { PurchaseList, RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type PlayerState } from "./state";

/** R-6.1: Zinsen = min(interestMax, floor(Schatzkammer / interestPer)), ohne das Maximum (R-11.5) zu überschreiten. */
export function interestFor(treasury: number, config: ConfigData): number {
  const raw = Math.min(config.interestMax, Math.floor(treasury / config.interestPer));
  return Math.max(0, Math.min(raw, config.treasuryMax - treasury));
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

/** R-6.2: Rundenvorrat startet mit dem Überlauf der Vorrunde (R-10.3). */
export function startRoundGold(state: GameState): void {
  for (const p of activePlayers(state)) {
    const amount = p.nextRound.gold;
    p.nextRound.gold = 0;
    p.roundGold = amount;
    if (amount > 0) emit(state, { type: "round_gold_started", player: p.index, amount });
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

/** Verfügbares Gold in Planung und Kaufphase: Rundenvorrat plus Schatzkammer (R-7, R-11.2). */
export function availableGold(player: PlayerState): number {
  return player.roundGold + player.treasury;
}

export interface Payment {
  fromRoundGold: number;
  fromTreasury: number;
}

/**
 * Bezahlt `amount` Gold, zuerst aus dem Rundenvorrat, dann aus der Schatzkammer (R-7, R-11.2;
 * Reihenfolge nach R-1.9 zugunsten des Spielers, weil der Rundenvorrat sonst verfallen kann).
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

/**
 * R-10.3: Gold-Gewinn nach der Planung geht sofort in die Schatzkammer; was über das Maximum
 * (R-11.5) hinausgeht, geht in den Rundenvorrat der nächsten Runde.
 */
export function gainGoldAfterPlanning(state: GameState, config: ConfigData, player: PlayerIndex, amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`gainGold: ungültiger Betrag ${amount}`);
  if (amount === 0) return;
  const p = getPlayer(state, player);
  const toTreasury = Math.max(0, Math.min(amount, config.treasuryMax - p.treasury));
  const toNextRound = amount - toTreasury;
  p.treasury += toTreasury;
  p.nextRound.gold += toNextRound;
  emit(state, { type: "gold_gained", player, amount, toTreasury, toNextRound, treasury: p.treasury });
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

/**
 * R-11.2 bis R-11.4: wertet alle Käufe gleichzeitig aus.
 *
 * Jeder Spieler kauft in der Reihenfolge seiner Liste; fehlt das Gold für einen Kauf, wird nur dieser
 * übersprungen. Ob ein Stapel leer ist (R-11.4), entscheidet der Stand **zu Beginn der Kaufphase**:
 * Käufe anderer Spieler in derselben Phase nehmen niemandem eine Kopie weg (R-11.3). Wollen alle
 * zusammen mehr Kopien als vorhanden, bekommen alle ihre Kopien, der Stapel geht auf 0 und die
 * fehlenden Kopien werden erzeugt. Die Kartenaustellung läuft in Prioritätsreihenfolge (R-1.7).
 */
export function resolvePurchases(
  state: GameState,
  data: GameData,
  order: readonly PlayerIndex[],
  purchases: readonly (PurchaseList | null | undefined)[],
): PurchaseRejection[] {
  const rejections: PurchaseRejection[] = [];
  const supplyAtStart = { ...state.supply };
  const supplyDemand: Record<string, number> = {};

  for (const playerIndex of order) {
    const p = getPlayer(state, playerIndex);
    const classPoolAtStart = { ...p.classPool };
    const classDemand: Record<string, number> = {};
    const buys = purchases[playerIndex]?.buys ?? [];

    buys.forEach((cardId, index) => {
      const card = data.cards.get(cardId);
      let source: "supply" | "classPool" | null = null;
      let reason: RejectionReason | null = null;
      if (!card) {
        reason = "unknownCard";
      } else if (card.buyable === false) {
        reason = "notBuyable";
      } else if ((card.pool === "basic" || card.pool === "kingdom") && cardId in supplyAtStart) {
        source = "supply";
      } else if (card.pool.startsWith("class:") && cardId in classPoolAtStart) {
        source = "classPool";
      } else {
        reason = "notBuyable";
      }
      if (!reason && source) {
        const atStart = source === "supply" ? supplyAtStart[cardId] : classPoolAtStart[cardId];
        if ((atStart ?? 0) <= 0) reason = "pileEmpty";
      }
      let payment: Payment | null = null;
      if (!reason && card) {
        payment = payGold(p, card.cost);
        if (!payment) reason = "notEnoughGold";
      }
      if (reason || !payment || !source) {
        rejections.push({ player: playerIndex, index, cardId, reason: reason ?? "malformed" });
        return;
      }
      const id = state.nextCardInstanceId++;
      state.cards[id] = { id, cardId, owner: playerIndex };
      p.discard.push(id);
      const demand = source === "supply" ? supplyDemand : classDemand;
      demand[cardId] = (demand[cardId] ?? 0) + 1;
      emit(state, {
        type: "card_bought",
        player: playerIndex,
        cardId,
        cardInstanceId: id,
        source,
        paidFromRoundGold: payment.fromRoundGold,
        paidFromTreasury: payment.fromTreasury,
      });
    });

    for (const [cardId, count] of Object.entries(classDemand)) {
      const before = p.classPool[cardId] ?? 0;
      p.classPool[cardId] = Math.max(0, before - count);
      emit(state, {
        type: "pile_changed",
        pile: cardId,
        owner: playerIndex,
        remaining: p.classPool[cardId] ?? 0,
        created: Math.max(0, count - before),
      });
    }
  }

  for (const [cardId, count] of Object.entries(supplyDemand)) {
    const before = state.supply[cardId] ?? 0;
    state.supply[cardId] = Math.max(0, before - count);
    emit(state, {
      type: "pile_changed",
      pile: cardId,
      owner: null,
      remaining: state.supply[cardId] ?? 0,
      created: Math.max(0, count - before),
    });
  }
  return rejections;
}

/** R-11.5: nach den Käufen wird aus dem Rundenvorrat eingezahlt, bis die Schatzkammer voll ist; der Rest verfällt. */
export function depositRoundGold(state: GameState, config: ConfigData): void {
  for (const p of activePlayers(state)) {
    const amount = Math.max(0, Math.min(p.roundGold, config.treasuryMax - p.treasury));
    const forfeited = p.roundGold - amount;
    p.treasury += amount;
    p.roundGold = 0;
    if (amount > 0) emit(state, { type: "gold_deposited", player: p.index, amount, treasury: p.treasury });
    if (forfeited > 0) emit(state, { type: "gold_forfeited", player: p.index, amount: forfeited });
  }
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}
