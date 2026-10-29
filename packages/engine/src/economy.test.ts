import { describe, expect, it } from "vitest";
import type { Planning, PlanningAction } from "./actions";
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
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type CardInstanceId, type GameEvent, type GameState, getCard, getPlayer, PLAYER_INDICES, type PlayerIndex } from "./state";

const data = loadGameData();
const config = data.config;
const newGame = (seed = 7): GameState => createGame(data, defaultLeaders(data), seed);

/**
 * Ersetzt die Hand eines Spielers (vor der ersten Runde, R-4.6) durch neue Karteninstanzen in dieser
 * Reihenfolge; die bisherige Starthand kommt zurück oben aufs Deck.
 */
function setHand(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  const p = getPlayer(state, player);
  const ids = cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    return id;
  });
  p.deck = [...p.hand, ...p.deck];
  p.hand = ids;
  return ids;
}

/** Legt neue Karteninstanzen oben auf das Deck (für das Nachziehen am Rundenende, R-12.6). */
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

/** Spielt eine Runde mit den angegebenen Planungen bis zur Planung der nächsten Runde. */
function playRound(state: GameState, planning: Partial<Record<PlayerIndex, Partial<Planning>>> = {}): void {
  expect(advance(state, data).waitingFor).toBe("planning");
  for (const p of PLAYER_INDICES) expect(submitPlanning(state, p, planning[p] ?? {})).toEqual({ ok: true });
  expect(advance(state, data).waitingFor).toBe("planning");
}

function purchases(buys: Partial<Record<PlayerIndex, string[]>>): string[][] {
  return PLAYER_INDICES.map((p) => buys[p] ?? []);
}

function setGold(state: GameState, player: PlayerIndex, roundGold: number, treasury: number): void {
  const p = getPlayer(state, player);
  p.roundGold = roundGold;
  p.treasury = treasury;
}

describe("R-6.1: Zinsen", () => {
  it("R-6.1: min(2, floor(Schatzkammer / 5))", () => {
    expect(interestFor(0, config)).toBe(0);
    expect(interestFor(4, config)).toBe(0);
    expect(interestFor(5, config)).toBe(1);
    expect(interestFor(9, config)).toBe(1);
    expect(interestFor(10, config)).toBe(2);
  });

  it("R-6.1: Zinsen sind auf 2 gedeckelt, die Schatzkammer nicht; Werte aus der Konfiguration", () => {
    expect(interestFor(17, config)).toBe(2);
    expect(interestFor(100, config)).toBe(2);
    const other: ConfigData = { ...config, interestPer: 3, interestMax: 3 };
    expect(interestFor(9, other)).toBe(3);
    expect(interestFor(40, other)).toBe(3);
  });

  it("R-6.1/R-11.5: config.json kennt keine Obergrenze der Schatzkammer mehr", () => {
    expect("treasuryMax" in config).toBe(false);
  });

  it("R-6.1: zu Rundenbeginn gehen die Zinsen in die Schatzkammer, mit Ereignis", () => {
    const state = newGame();
    getPlayer(state, 0).treasury = 6;
    getPlayer(state, 1).treasury = 23;
    getPlayer(state, 2).treasury = 3;
    getPlayer(state, 3).treasury = 5;
    getPlayer(state, 3).eliminated = true;
    advance(state, data);
    expect(getPlayer(state, 0).treasury).toBe(7);
    expect(getPlayer(state, 1).treasury).toBe(25);
    expect(getPlayer(state, 2).treasury).toBe(3);
    expect(getPlayer(state, 3).treasury).toBe(5);
    expect(eventsOf(state, "interest_paid")).toEqual([
      expect.objectContaining({ player: 0, amount: 1, treasury: 7, phase: "roundStart" }),
      expect.objectContaining({ player: 1, amount: 2, treasury: 25, phase: "roundStart" }),
    ]);
  });
});

describe("R-6.2: Rundenvorrat", () => {
  it("R-6.2: der Rundenvorrat beginnt bei 0, nur Ressourcen füllen ihn", () => {
    const state = newGame();
    setHand(state, 0, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    advance(state, data);
    expect(getPlayer(state, 0).roundGold).toBe(0);
  });

  it("R-6.2/R-11.5: übriges Gold liegt in der Schatzkammer, die nächste Runde beginnt wieder bei 0", () => {
    const state = newGame();
    // Runde 1: drei Münzen; Runde 2: nur Rekruten.
    setHand(state, 1, ["coin", "coin", "coin", "recruit", "recruit"]);
    stackDeck(state, 1, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    advance(state, data);
    const p = getPlayer(state, 1);
    expect(p.roundGold).toBe(3);
    p.treasury = 12;
    gainGoldAfterPlanning(state, 1, 5);
    expect(p.treasury).toBe(17);
    playRound(state);
    // Einzahlung am Rundenende: 17 + 3 = 20; Runde 2: Zinsen +2, Rundenvorrat 0 (nur Rekruten auf der Hand).
    expect(p.roundGold).toBe(0);
    expect(p.treasury).toBe(22);
    expect(state.round).toBe(2);
  });
});

describe("R-6.4: Ressourcen", () => {
  it("R-6.4: Ressourcen auf der Hand werden automatisch ausgespielt, Gold in den Rundenvorrat", () => {
    const state = newGame();
    const [silver, coin, recruit, gold, coin2] = setHand(state, 0, ["silver", "coin", "recruit", "gold_bar", "coin"]);
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
    setHand(state, 2, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    advance(state, data);
    expect(getPlayer(state, 2).roundGold).toBe(0);
    expect(eventsOf(state, "resources_played").some((e) => e.player === 2)).toBe(false);
  });

  it("R-6.4/R-12.1: ausgespielte Ressourcen gehen beim Aufräumen auf den Ablagestapel", () => {
    const state = newGame();
    const ids = setHand(state, 0, ["coin", "coin", "recruit", "silver", "recruit"]);
    playRound(state);
    const p = getPlayer(state, 0);
    expect([...p.discard].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    expect(p.played.length + p.hand.length).toBe(config.handSize);
    expect(eventsOf(state, "hand_discarded").find((e) => e.player === 0 && e.round === 1)?.cardInstanceIds).toHaveLength(5);
  });
});

describe("R-7.6: Entnahme", () => {
  it("R-7.6: verschiebt Gold aus der Schatzkammer in den Rundenvorrat", () => {
    const state = newGame();
    setHand(state, 0, ["recruit", "recruit", "recruit", "recruit", "recruit"]);
    getPlayer(state, 0).treasury = 5;
    playRound(state, { 0: { play: [{ type: "withdraw", amount: 3 }] } });
    const p = getPlayer(state, 0);
    // Zinsen +1 zu Rundenbeginn → 6, Entnahme 3 → Schatzkammer 3, Rundenvorrat 3.
    expect(eventsOf(state, "gold_withdrawn")).toEqual([expect.objectContaining({ player: 0, amount: 3, treasury: 3, phase: "reveal" })]);
    // Ungenutztes Gold geht am Rundenende zurück (R-12.5): 3 + 3 = 6, Runde 2 Zinsen +1.
    expect(eventsOf(state, "gold_deposited").filter((e) => e.player === 0)).toEqual([expect.objectContaining({ amount: 3, treasury: 6 })]);
    expect(p.treasury).toBe(7);
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
    playRound(state, { 1: { play: actions } });
    const rejected = eventsOf(state, "action_rejected").filter((e) => e.player === 1);
    expect(rejected.map((e) => [e.index, e.reason])).toEqual([
      [0, "notEnoughTreasury"],
      [1, "invalidAmount"],
      [2, "invalidAmount"],
      [3, "invalidAmount"],
      [4, "invalidAmount"],
      [6, "notEnoughTreasury"],
    ]);
    expect(eventsOf(state, "gold_withdrawn").filter((e) => e.player === 1)).toEqual([expect.objectContaining({ amount: 4, treasury: 0 })]);
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
  it("R-10.3: nach der Planung sofort und vollständig in die Schatzkammer, ohne Obergrenze", () => {
    const state = newGame();
    const p = getPlayer(state, 2);
    p.treasury = 6;
    gainGoldAfterPlanning(state, 2, 2);
    expect([p.treasury, p.roundGold]).toEqual([8, 0]);
    gainGoldAfterPlanning(state, 2, 4);
    expect([p.treasury, p.roundGold]).toEqual([12, 0]);
    gainGoldAfterPlanning(state, 2, 0);
    expect(eventsOf(state, "gold_gained")).toEqual([
      expect.objectContaining({ player: 2, amount: 2, treasury: 8 }),
      expect.objectContaining({ player: 2, amount: 4, treasury: 12 }),
    ]);
    expect(() => gainGoldAfterPlanning(state, 2, -1)).toThrow(RangeError);
  });

  it("R-10.3: Gold-Gewinne während der Planung gehen in den Rundenvorrat dieser Runde", () => {
    const state = newGame();
    const p = getPlayer(state, 3);
    gainGoldDuringPlanning(state, 3, 2);
    expect([p.roundGold, p.treasury]).toEqual([2, 0]);
    expect(eventsOf(state, "round_gold_gained")).toEqual([expect.objectContaining({ player: 3, amount: 2 })]);
  });
});

describe("R-11: Kaufen", () => {
  it("R-11.2: Kauf aus dem Königreich legt eine neue Karte auf den Ablagestapel und bezahlt", () => {
    const state = newGame();
    setGold(state, 0, 4, 3);
    const before = state.supply.silver ?? 0;
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["silver", "mercenary"] }));
    expect(rejected).toEqual([]);
    const p = getPlayer(state, 0);
    expect(p.discard.map((id) => getCard(state, id).cardId)).toEqual(["silver", "mercenary"]);
    expect(p.discard.every((id) => getCard(state, id).owner === 0)).toBe(true);
    expect([p.roundGold, p.treasury]).toEqual([0, 2]);
    expect(state.supply.silver).toBe(before - 1);
    expect(eventsOf(state, "purchase_paid")).toEqual([
      expect.objectContaining({ player: 0, cardId: "silver", source: "supply", paidFromRoundGold: 3, paidFromTreasury: 0 }),
      expect.objectContaining({ player: 0, cardId: "mercenary", source: "supply", paidFromRoundGold: 1, paidFromTreasury: 1 }),
    ]);
    expect(eventsOf(state, "card_bought")).toEqual([
      expect.objectContaining({ player: 0, cardId: "silver", source: "supply", cardInstanceId: p.discard[0] }),
      expect.objectContaining({ player: 0, cardId: "mercenary", source: "supply", cardInstanceId: p.discard[1] }),
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

  it("R-11.2: fehlt Gold, wird nur dieser Kauf übersprungen; kein allgemeines Kauflimit", () => {
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
    // Spieler 3 darf nur 1 Kopie kaufen (Stapelstand zu Beginn der Runde).
    expect(rejected).toEqual([{ player: 3, index: 1, cardId: "blade_dancer", reason: "pileLimitReached" }]);
    expect(state.supply.blade_dancer).toBe(0);
    const bought = eventsOf(state, "card_bought");
    // Ausgabe in Prioritätsreihenfolge.
    expect(bought.map((e) => e.player)).toEqual([1, 3, 0]);
    expect(eventsOf(state, "pile_changed")).toEqual([
      expect.objectContaining({ pile: "blade_dancer", owner: null, remaining: 0, created: 2 }),
    ]);
    for (const p of [0, 1, 3] as const) {
      expect(getPlayer(state, p).discard.every((id) => getCard(state, id).cardId === "blade_dancer")).toBe(true);
    }
  });

  it("R-11.3: Käufe anderer Spieler nehmen niemandem eine Kopie weg (Stand zu Beginn der Runde)", () => {
    const state = newGame();
    state.supply.ranger = 2;
    for (const p of PLAYER_INDICES) setGold(state, p, 9, 0);
    resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["ranger", "ranger"], 1: ["ranger"] }));
    expect(eventsOf(state, "card_bought").map((e) => e.player)).toEqual([0, 0, 1]);
    expect(state.supply.ranger).toBe(0);
  });

  it("R-11.3: ein einzelner Spieler kauft höchstens den Stapelstand; allein entstehen keine Extra-Kopien", () => {
    const state = newGame();
    state.supply.silver = 2;
    setGold(state, 0, 12, 0);
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 0: ["silver", "silver", "silver", "purify"] }));
    expect(rejected).toEqual([{ player: 0, index: 2, cardId: "silver", reason: "pileLimitReached" }]);
    // Abgelehnter Kauf kostet nichts: 2 × 3 + 2 = 8.
    expect(getPlayer(state, 0).roundGold).toBe(4);
    expect(state.supply.silver).toBe(0);
    expect(eventsOf(state, "pile_changed")).toEqual(
      expect.arrayContaining([expect.objectContaining({ pile: "silver", remaining: 0, created: 0 })]),
    );
  });

  it("R-11.3: auch im eigenen Klassen-Pool höchstens der Stapelstand, nie zusätzliche Kopien", () => {
    const state = newGame();
    setGold(state, 1, 50, 0);
    const p = getPlayer(state, 1);
    const cardId = Object.keys(p.classPool)[0] as string;
    p.classPool[cardId] = 1;
    const rejected = resolvePurchases(state, data, [0, 1, 2, 3], purchases({ 1: [cardId, cardId] }));
    expect(rejected).toEqual([{ player: 1, index: 1, cardId, reason: "pileLimitReached" }]);
    expect(p.classPool[cardId]).toBe(0);
    expect(eventsOf(state, "pile_changed")).toEqual([expect.objectContaining({ pile: cardId, owner: 1, remaining: 0, created: 0 })]);
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

  it("R-11.5: nach den Käufen geht das gesamte übrige Gold in die Schatzkammer, nichts verfällt", () => {
    const state = newGame();
    setGold(state, 0, 9, 4);
    setGold(state, 1, 3, 10);
    setGold(state, 2, 0, 1);
    setGold(state, 3, 5, 0);
    getPlayer(state, 3).eliminated = true;
    depositRoundGold(state);
    expect([getPlayer(state, 0).treasury, getPlayer(state, 0).roundGold]).toEqual([13, 0]);
    expect([getPlayer(state, 1).treasury, getPlayer(state, 1).roundGold]).toEqual([13, 0]);
    expect([getPlayer(state, 2).treasury, getPlayer(state, 2).roundGold]).toEqual([1, 0]);
    expect(getPlayer(state, 3).roundGold).toBe(5);
    expect(eventsOf(state, "gold_deposited")).toEqual([
      expect.objectContaining({ player: 0, amount: 9, treasury: 13 }),
      expect.objectContaining({ player: 1, amount: 3, treasury: 13 }),
    ]);
    expect(state.log.some((e) => (e.type as string) === "gold_forfeited")).toBe(false);
  });

  it("R-11.1/R-11.3/R-12.5: Kaufen im Planungsblock, Karte beim Aufdecken, Rest am Rundenende in die Schatzkammer", () => {
    const state = newGame();
    setHand(state, 0, ["coin", "coin", "coin", "coin", "recruit"]);
    playRound(state, { 0: { buy: [{ type: "buy", cardId: "silver" }] } });
    const p = getPlayer(state, 0);
    expect(eventsOf(state, "purchase_paid")).toEqual([
      expect.objectContaining({ player: 0, cardId: "silver", paidFromRoundGold: 3, paidFromTreasury: 0, phase: "reveal" }),
    ]);
    expect(eventsOf(state, "card_bought")).toEqual([expect.objectContaining({ player: 0, cardId: "silver", phase: "reveal" })]);
    expect(p.discard.map((id) => getCard(state, id).cardId)).toContain("silver");
    // 4 Gold − 3 für Silber = 1 eingezahlt; in Runde 2 noch keine Zinsen (1 < 5).
    expect(p.treasury).toBe(1);
    expect(eventsOf(state, "gold_deposited").filter((e) => e.player === 0)).toEqual([
      expect.objectContaining({ amount: 1, round: 1, phase: "cleanup" }),
    ]);
    expect(state.phase).toBe("planning");
    expect(state.round).toBe(2);
  });

  it("R-11.1: Abschnitte laufen in der Reihenfolge play → buy → position, Gold wird sofort abgezogen", () => {
    const state = newGame();
    setHand(state, 0, ["coin", "coin", "coin", "recruit", "recruit"]);
    advance(state, data);
    const p = getPlayer(state, 0);
    p.treasury = 1;
    const recruit = p.hand[0] as number;
    // Reihenfolge der Schlüssel spielt keine Rolle: erst play (Rekrut 1 Gold), dann buy (Silber 3), dann position.
    const planning = {
      position: [{ type: "withdraw", amount: 1 }],
      buy: [{ type: "buy", cardId: "silver" }, { type: "buy", cardId: "silver" }],
      play: [{ type: "playUnit", cardInstanceId: recruit, to: { zone: "reserve", slot: 0 } }],
    } as Planning;
    for (const pl of PLAYER_INDICES) submitPlanning(state, pl, pl === 0 ? planning : {});
    advance(state, data);
    const mine = state.log.filter((e) => e.round === 1 && "player" in e && e.player === 0);
    const order = mine
      .filter((e) => ["unit_played", "purchase_paid", "action_rejected", "gold_withdrawn", "card_bought"].includes(e.type))
      .map((e) => e.type);
    expect(order).toEqual(["unit_played", "purchase_paid", "action_rejected", "action_rejected", "card_bought"]);
    // 3 + 1 = 4 Gold: Rekrut 1, Silber 3 (davon 1 aus der Schatzkammer), zweites Silber fehlt Gold;
    // die Entnahme im Abschnitt position findet eine leere Schatzkammer vor.
    expect(eventsOf(state, "purchase_paid")).toEqual([expect.objectContaining({ paidFromRoundGold: 2, paidFromTreasury: 1 })]);
    expect(eventsOf(state, "action_rejected").filter((e) => e.player === 0)).toEqual([
      expect.objectContaining({ section: "buy", index: 1, reason: "notEnoughGold" }),
      expect.objectContaining({ section: "position", index: 0, reason: "notEnoughTreasury" }),
    ]);
  });

  it("R-11.3: im Rundenlauf verteilen sich Käufe gleichzeitig in Prioritätsreihenfolge, Limit je Spieler", () => {
    const state = newGame();
    state.supply.blade_dancer = 1;
    for (const p of PLAYER_INDICES) getPlayer(state, p).treasury = 20;
    const buy = (n: number): Partial<Planning> => ({ buy: Array.from({ length: n }, () => ({ type: "buy" as const, cardId: "blade_dancer" })) });
    playRound(state, { 0: buy(1), 2: buy(2), 3: buy(1) });
    expect(eventsOf(state, "card_bought").map((e) => e.player)).toEqual([0, 2, 3]);
    expect(eventsOf(state, "action_rejected")).toEqual([
      expect.objectContaining({ player: 2, section: "buy", index: 1, reason: "pileLimitReached" }),
    ]);
    expect(state.supply.blade_dancer).toBe(0);
    expect(eventsOf(state, "pile_changed")).toEqual([expect.objectContaining({ pile: "blade_dancer", remaining: 0, created: 2 })]);
  });
});
