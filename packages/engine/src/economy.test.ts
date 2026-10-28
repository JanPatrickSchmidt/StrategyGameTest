import { describe, expect, it } from "vitest";
import type { PlanningAction, PurchaseList } from "./actions";
import { type ConfigData, loadGameData } from "./data";
import {
  availableGold,
  depositRoundGold,
  gainGoldAfterPlanning,
  gainGoldDuringPlanning,
  interestFor,
  payGold,
  resolvePurchases,
} from "./economy";
import { advance, submitPlanning, submitPurchases } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type CardInstanceId, type GameEvent, type GameState, getCard, getPlayer, PLAYER_INDICES, type PlayerIndex } from "./state";

const data = loadGameData();
const config = data.config;
const newGame = (seed = 7): GameState => createGame(data, defaultLeaders(data), seed);

/** Legt neue Karteninstanzen oben auf das Deck eines Spielers (in dieser Reihenfolge). */
function stackDeck(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  const p = getPlayer(state, player);
  const ids = cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    return id;
  });
  p.deck = [...ids, ...p.deck];
  return ids;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Bis in die Kaufphase von Runde 1, mit den angegebenen Planungen. */
function toBuyPhase(state: GameState, planning: Partial<Record<PlayerIndex, PlanningAction[]>> = {}): void {
  expect(advance(state, data).waitingFor).toBe("planning");
  for (const p of PLAYER_INDICES) submitPlanning(state, p, planning[p] ?? []);
  expect(advance(state, data).waitingFor).toBe("purchases");
}

function finishBuy(state: GameState, buys: Partial<Record<PlayerIndex, string[]>>): void {
  for (const p of PLAYER_INDICES) submitPurchases(state, p, { buys: buys[p] ?? [] });
  advance(state, data);
}

function purchases(buys: Partial<Record<PlayerIndex, string[]>>): PurchaseList[] {
  return PLAYER_INDICES.map((p) => ({ buys: buys[p] ?? [] }));
}

function setGold(state: GameState, player: PlayerIndex, roundGold: number, treasury: number): void {
  const p = getPlayer(state, player);
  p.roundGold = roundGold;
  p.treasury = treasury;
}

describe("R-6.1: Zinsen", () => {
  it("R-6.1: min(2, floor(Schatzkammer / 5)), ohne das Maximum zu überschreiten", () => {
    expect(interestFor(0, config)).toBe(0);
    expect(interestFor(4, config)).toBe(0);
    expect(interestFor(5, config)).toBe(1);
    expect(interestFor(9, config)).toBe(1);
    // Maximum 10: eine volle Schatzkammer bekommt keine Zinsen.
    expect(interestFor(10, config)).toBe(0);
  });

  it("R-6.1: Obergrenze 2 und Deckelung am Maximum, Werte aus der Konfiguration", () => {
    const big: ConfigData = { ...config, treasuryMax: 20 };
    expect(interestFor(10, big)).toBe(2);
    expect(interestFor(17, big)).toBe(2);
    expect(interestFor(19, big)).toBe(1);
    expect(interestFor(20, big)).toBe(0);
    const other: ConfigData = { ...config, interestPer: 3, interestMax: 3, treasuryMax: 30 };
    expect(interestFor(9, other)).toBe(3);
  });

  it("R-6.1: zu Rundenbeginn gehen die Zinsen in die Schatzkammer, mit Ereignis", () => {
    const state = newGame();
    getPlayer(state, 0).treasury = 6;
    getPlayer(state, 1).treasury = 10;
    getPlayer(state, 2).treasury = 3;
    getPlayer(state, 3).treasury = 5;
    getPlayer(state, 3).eliminated = true;
    advance(state, data);
    expect(getPlayer(state, 0).treasury).toBe(7);
    expect(getPlayer(state, 1).treasury).toBe(10);
    expect(getPlayer(state, 2).treasury).toBe(3);
    expect(getPlayer(state, 3).treasury).toBe(5);
    expect(eventsOf(state, "interest_paid")).toEqual([
      expect.objectContaining({ player: 0, amount: 1, treasury: 7, phase: "roundStart" }),
    ]);
  });
});

describe("R-6.2: Rundenvorrat", () => {
  it("R-6.2: der Rundenvorrat startet mit dem Überlauf der Vorrunde", () => {
    const state = newGame();
    const p = getPlayer(state, 0);
    p.nextRound.gold = 3;
    p.deck = [];
    p.discard = [];
    advance(state, data);
    expect(p.roundGold).toBe(3);
    expect(p.nextRound.gold).toBe(0);
    expect(eventsOf(state, "round_gold_started")).toEqual([expect.objectContaining({ player: 0, amount: 3 })]);
  });

  it("R-6.2/R-10.3: Überlauf aus einem Gold-Gewinn landet im Rundenvorrat der nächsten Runde", () => {
    const state = newGame();
    toBuyPhase(state);
    const p = getPlayer(state, 1);
    p.treasury = 8;
    gainGoldAfterPlanning(state, config, 1, 5);
    expect(p.treasury).toBe(10);
    expect(p.nextRound.gold).toBe(3);
    finishBuy(state, {});
    // Runde 2: Zinsen 0 (volle Schatzkammer), Rundenvorrat = 3 + Ressourcen.
    const resourceGold = eventsOf(state, "resources_played")
      .filter((e) => e.round === 2 && e.player === 1)
      .reduce((sum, e) => sum + e.gold, 0);
    expect(p.roundGold).toBe(3 + resourceGold);
    expect(p.nextRound.gold).toBe(0);
  });
});

describe("R-6.4: Ressourcen", () => {
  it("R-6.4: Ressourcen auf der Hand werden automatisch ausgespielt, Gold in den Rundenvorrat", () => {
    const state = newGame();
    const [silver, coin, recruit, gold, coin2] = stackDeck(state, 0, ["silver", "coin", "recruit", "gold_bar", "coin"]);
    advance(state, data);
    const p = getPlayer(state, 0);
    expect(p.hand).toEqual([recruit]);
    expect(p.played).toEqual([silver, coin, gold, coin2]);
    expect(p.roundGold).toBe(2 + 1 + 3 + 1);
    const priv = eventsOf(state, "resources_played").filter((e) => e.player === 0);
    expect(priv).toEqual([expect.objectContaining({ cardInstanceIds: [silver, coin, gold, coin2], gold: 7, phase: "roundStart" })]);
    expect(priv[0]?.visibleTo).toEqual([0]);
    const pub = eventsOf(state, "resources_played_count").filter((e) => e.player === 0);
    expect(pub).toEqual([expect.objectContaining({ count: 4 })]);
    expect(pub[0]?.visibleTo).toBeUndefined();
  });

  it("R-6.4: ohne Ressourcen auf der Hand gibt es kein Gold und kein Ereignis", () => {
    const state = newGame();
    stackDeck(state, 2, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    advance(state, data);
    expect(getPlayer(state, 2).roundGold).toBe(0);
    expect(eventsOf(state, "resources_played").some((e) => e.player === 2)).toBe(false);
  });

  it("R-6.4/R-12.1: ausgespielte Ressourcen gehen beim Aufräumen auf den Ablagestapel", () => {
    const state = newGame();
    const ids = stackDeck(state, 0, ["coin", "coin", "recruit", "silver", "recruit"]);
    toBuyPhase(state);
    finishBuy(state, {});
    const p = getPlayer(state, 0);
    expect([...p.discard].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    expect(p.played.length + p.hand.length).toBe(config.handSize);
    expect(eventsOf(state, "hand_discarded").find((e) => e.player === 0 && e.round === 1)?.cardInstanceIds).toHaveLength(5);
  });
});

describe("R-7.6: Entnahme", () => {
  it("R-7.6: verschiebt Gold aus der Schatzkammer in den Rundenvorrat", () => {
    const state = newGame();
    stackDeck(state, 0, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    getPlayer(state, 0).treasury = 5;
    toBuyPhase(state, { 0: [{ type: "withdraw", amount: 3 }] });
    const p = getPlayer(state, 0);
    // Zinsen +1 zu Rundenbeginn → 6, Entnahme 3.
    expect(p.treasury).toBe(3);
    expect(p.roundGold).toBe(3);
    expect(eventsOf(state, "gold_withdrawn")).toEqual([expect.objectContaining({ player: 0, amount: 3, treasury: 3, phase: "reveal" })]);
  });

  it("R-7.6: zu große und ungültige Beträge werden abgelehnt, die übrigen Aktionen laufen weiter", () => {
    const state = newGame();
    getPlayer(state, 1).treasury = 4;
    const actions = [
      { type: "withdraw", amount: 5 },
      { type: "withdraw", amount: 0 },
      { type: "withdraw", amount: -1 },
      { type: "withdraw", amount: 1.5 },
      { type: "withdraw", amount: "2" },
      { type: "withdraw", amount: 4 },
      { type: "withdraw", amount: 1 },
    ] as unknown as PlanningAction[];
    toBuyPhase(state, { 1: actions });
    const rejected = eventsOf(state, "action_rejected").filter((e) => e.player === 1);
    expect(rejected.map((e) => [e.index, e.reason])).toEqual([
      [0, "notEnoughTreasury"],
      [1, "invalidAmount"],
      [2, "invalidAmount"],
      [3, "invalidAmount"],
      [4, "invalidAmount"],
      [6, "notEnoughTreasury"],
    ]);
    expect(getPlayer(state, 1).treasury).toBe(0);
    expect(eventsOf(state, "gold_withdrawn").filter((e) => e.player === 1)).toHaveLength(1);
  });
});

describe("R-7/R-11.2: Bezahlen", () => {
  it("R-11.2: Kosten zuerst aus dem Rundenvorrat, dann aus der Schatzkammer", () => {
    const state = newGame();
    const p = getPlayer(state, 0);
    p.roundGold = 2;
    p.treasury = 5;
    expect(availableGold(p)).toBe(7);
    expect(payGold(p, 4)).toEqual({ fromRoundGold: 2, fromTreasury: 2 });
    expect([p.roundGold, p.treasury]).toEqual([0, 3]);
    expect(payGold(p, 4)).toBeNull();
    expect([p.roundGold, p.treasury]).toEqual([0, 3]);
    expect(payGold(p, 0)).toEqual({ fromRoundGold: 0, fromTreasury: 0 });
    expect(() => payGold(p, -1)).toThrow(RangeError);
  });
});

describe("R-10.3: Gold-Gewinne", () => {
  it("R-10.3: nach der Planung sofort in die Schatzkammer, Überlauf in die nächste Runde", () => {
    const state = newGame();
    const p = getPlayer(state, 2);
    p.treasury = 6;
    gainGoldAfterPlanning(state, config, 2, 2);
    expect([p.treasury, p.nextRound.gold]).toEqual([8, 0]);
    gainGoldAfterPlanning(state, config, 2, 4);
    expect([p.treasury, p.nextRound.gold]).toEqual([10, 2]);
    gainGoldAfterPlanning(state, config, 2, 0);
    expect(eventsOf(state, "gold_gained")).toEqual([
      expect.objectContaining({ player: 2, amount: 2, toTreasury: 2, toNextRound: 0, treasury: 8 }),
      expect.objectContaining({ player: 2, amount: 4, toTreasury: 2, toNextRound: 2, treasury: 10 }),
    ]);
  });

  it("R-10.3: Gold-Gewinne während der Planung gehen in den Rundenvorrat dieser Runde", () => {
    const state = newGame();
    const p = getPlayer(state, 3);
    gainGoldDuringPlanning(state, 3, 2);
    expect([p.roundGold, p.treasury]).toEqual([2, 0]);
    expect(eventsOf(state, "round_gold_gained")).toEqual([expect.objectContaining({ player: 3, amount: 2 })]);
  });
});

describe("R-11: Kaufphase", () => {
  it("R-11.2: Kauf aus dem Königreich legt eine neue Karte auf den Ablagestapel und bezahlt", () => {
    const state = newGame();
    setGold(state, 0, 4, 3);
    const before = state.supply.silver ?? 0;
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["silver", "bone_soldier"] }));
    expect(rejected).toEqual([]);
    const p = getPlayer(state, 0);
    expect(p.discard.map((id) => getCard(state, id).cardId)).toEqual(["silver", "bone_soldier"]);
    expect(p.discard.every((id) => getCard(state, id).owner === 0)).toBe(true);
    expect([p.roundGold, p.treasury]).toEqual([0, 2]);
    expect(state.supply.silver).toBe(before - 1);
    expect(eventsOf(state, "card_bought")).toEqual([
      expect.objectContaining({ player: 0, cardId: "silver", source: "supply", paidFromRoundGold: 3, paidFromTreasury: 0 }),
      expect.objectContaining({ player: 0, cardId: "bone_soldier", source: "supply", paidFromRoundGold: 1, paidFromTreasury: 1 }),
    ]);
    expect(eventsOf(state, "pile_changed")).toEqual(
      expect.arrayContaining([expect.objectContaining({ pile: "silver", owner: null, remaining: before - 1, created: 0 })]),
    );
  });

  it("R-11.2: Kauf aus dem eigenen Klassen-Pool; fremder Klassen-Pool ist nicht kaufbar", () => {
    const state = newGame();
    setGold(state, 0, 20, 0);
    const own = Object.keys(getPlayer(state, 0).classPool);
    const foreign = Object.keys(getPlayer(state, 1).classPool).filter((id) => !own.includes(id));
    const ownCard = own[0] as string;
    const foreignCard = foreign[0] as string;
    const pileBefore = getPlayer(state, 0).classPool[ownCard] ?? 0;
    const otherBefore = { ...getPlayer(state, 1).classPool };
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: [ownCard, foreignCard] }));
    expect(rejected).toEqual([{ player: 0, index: 1, cardId: foreignCard, reason: "notBuyable" }]);
    expect(getPlayer(state, 0).classPool[ownCard]).toBe(pileBefore - 1);
    expect(getPlayer(state, 1).classPool).toEqual(otherBefore);
    expect(eventsOf(state, "pile_changed")).toEqual([
      expect.objectContaining({ pile: ownCard, owner: 0, remaining: pileBefore - 1, created: 0 }),
    ]);
  });

  it("R-11.2: Starter, Tokens, Fluch und unbekannte Karten sind nicht kaufbar", () => {
    const state = newGame();
    setGold(state, 0, 20, 0);
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["coin", "recruit", "goblin_token", "curse", "dragon"] }));
    expect(rejected.map((r) => [r.cardId, r.reason])).toEqual([
      ["coin", "notBuyable"],
      ["recruit", "notBuyable"],
      ["goblin_token", "notBuyable"],
      ["curse", "notBuyable"],
      ["dragon", "unknownCard"],
    ]);
    expect(getPlayer(state, 0).roundGold).toBe(20);
    expect(getPlayer(state, 0).discard).toEqual([]);
  });

  it("R-11.2: fehlt Gold, wird nur dieser Kauf übersprungen; kein Kauflimit", () => {
    const state = newGame();
    setGold(state, 2, 5, 0);
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 2: ["gold_bar", "purify", "purify", "purify"] }));
    expect(rejected).toEqual([
      { player: 2, index: 0, cardId: "gold_bar", reason: "notEnoughGold" },
      { player: 2, index: 3, cardId: "purify", reason: "notEnoughGold" },
    ]);
    expect(getPlayer(state, 2).discard).toHaveLength(2);
    expect(getPlayer(state, 2).roundGold).toBe(1);
  });

  it("R-11.3: gleichzeitige Käufe – alle bekommen ihre Kopien, der Stapel geht auf 0, fehlende werden erzeugt", () => {
    const state = newGame();
    state.supply.blade_dancer = 1;
    for (const p of PLAYER_INDICES) setGold(state, p, 10, 0);
    const rejected = resolvePurchases(state, data, [1, 2, 3, 0], purchases({ 0: ["blade_dancer"], 1: ["blade_dancer"], 3: ["blade_dancer", "blade_dancer"] }));
    expect(rejected).toEqual([]);
    expect(state.supply.blade_dancer).toBe(0);
    const bought = eventsOf(state, "card_bought");
    // Ausgabe in Prioritätsreihenfolge.
    expect(bought.map((e) => e.player)).toEqual([1, 3, 3, 0]);
    expect(eventsOf(state, "pile_changed")).toEqual([
      expect.objectContaining({ pile: "blade_dancer", owner: null, remaining: 0, created: 3 }),
    ]);
    for (const p of [0, 1, 3] as const) {
      expect(getPlayer(state, p).discard.every((id) => getCard(state, id).cardId === "blade_dancer")).toBe(true);
    }
  });

  it("R-11.3: Käufe anderer Spieler nehmen niemandem eine Kopie weg (Stand zu Beginn der Kaufphase)", () => {
    const state = newGame();
    state.supply.ranger = 2;
    for (const p of PLAYER_INDICES) setGold(state, p, 9, 0);
    resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["ranger", "ranger"], 1: ["ranger"] }));
    expect(eventsOf(state, "card_bought").map((e) => e.player)).toEqual([0, 0, 1]);
    expect(state.supply.ranger).toBe(0);
  });

  it("R-11.4: aus einem leeren Stapel kann nicht gekauft werden", () => {
    const state = newGame();
    state.supply.silver = 0;
    setGold(state, 0, 10, 0);
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["silver", "purify"] }));
    expect(rejected).toEqual([{ player: 0, index: 0, cardId: "silver", reason: "pileEmpty" }]);
    expect(getPlayer(state, 0).roundGold).toBe(8);
    expect(state.supply.silver).toBe(0);
  });

  it("R-11.5: nach den Käufen wird eingezahlt bis zum Maximum, der Rest verfällt", () => {
    const state = newGame();
    setGold(state, 0, 9, 4);
    setGold(state, 1, 3, 10);
    setGold(state, 2, 2, 1);
    setGold(state, 3, 5, 0);
    getPlayer(state, 3).eliminated = true;
    depositRoundGold(state, config);
    expect([getPlayer(state, 0).treasury, getPlayer(state, 0).roundGold]).toEqual([10, 0]);
    expect([getPlayer(state, 1).treasury, getPlayer(state, 1).roundGold]).toEqual([10, 0]);
    expect([getPlayer(state, 2).treasury, getPlayer(state, 2).roundGold]).toEqual([3, 0]);
    expect(getPlayer(state, 3).roundGold).toBe(5);
    expect(eventsOf(state, "gold_deposited")).toEqual([
      expect.objectContaining({ player: 0, amount: 6, treasury: 10 }),
      expect.objectContaining({ player: 2, amount: 2, treasury: 3 }),
    ]);
    expect(eventsOf(state, "gold_forfeited")).toEqual([
      expect.objectContaining({ player: 0, amount: 3 }),
      expect.objectContaining({ player: 1, amount: 3 }),
    ]);
  });

  it("R-11: Kaufen in der Rundenmaschine mit Gold aus Ressourcen, danach Einzahlung (R-11.5)", () => {
    const state = newGame();
    stackDeck(state, 0, ["coin", "coin", "coin", "coin", "recruit"]);
    toBuyPhase(state);
    expect(getPlayer(state, 0).roundGold).toBe(4);
    finishBuy(state, { 0: ["silver"] });
    const p = getPlayer(state, 0);
    expect(eventsOf(state, "card_bought")).toEqual([expect.objectContaining({ player: 0, cardId: "silver", phase: "buy" })]);
    expect(p.discard.map((id) => getCard(state, id).cardId)).toContain("silver");
    // 4 Gold − 3 für Silber = 1 eingezahlt; in Runde 2 noch keine Zinsen (1 < 5).
    expect(p.treasury).toBe(1);
    expect(eventsOf(state, "gold_deposited").filter((e) => e.player === 0)).toEqual([expect.objectContaining({ amount: 1, round: 1 })]);
    expect(state.phase).toBe("planning");
    expect(state.round).toBe(2);
  });
});
