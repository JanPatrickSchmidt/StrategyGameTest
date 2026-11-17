import { describe, expect, it } from "vitest";
import { type CardInstanceId, type GameState, getPlayer, loadGameData, type Unit, type UnitId, type UnitLocation } from "@game/engine";
import { applyTarget, targetLocations } from "./boardInput";
import { addHeal, addWithdraw, healOptions, paymentChoice, playAction, playLocations, sacrificeCandidates, withdrawMax } from "./planExtras";
import { cardText, describeAction, handCards, locationKey, ownEntry, PlanBuilder } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();

const RESERVE_0: UnitLocation = { zone: "reserve", slot: 0 };
const RESERVE_1: UnitLocation = { zone: "reserve", slot: 1 };
const LEFT_A1: UnitLocation = { zone: "left", cell: { col: 0, row: 0 } };

interface Setup {
  state: GameState;
  builder: PlanBuilder;
  cards: CardInstanceId[];
  units: UnitId[];
}

/**
 * Planung des Menschen in Runde 1 mit zusätzlichen Handkarten und eigenen Karten-Einheiten. Gold und Leben
 * werden fest gesetzt, damit die Kosten eindeutig sind.
 */
function setup(options: {
  hand?: string[];
  units?: { cardId: string; location: UnitLocation; stars?: 1 | 2 | 3; wounded?: boolean }[];
  roundGold?: number;
  treasury?: number;
  life?: number;
  leaders?: string[];
}): Setup {
  const session = new GameSession(data, options.leaders ? { seed: 3, leaders: options.leaders } : { seed: 3 });
  const state = structuredClone(session.state);
  const p = getPlayer(state, HUMAN);
  const newCard = (cardId: string): CardInstanceId => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: HUMAN };
    return id;
  };
  const cards = (options.hand ?? []).map((cardId) => {
    const id = newCard(cardId);
    p.hand.push(id);
    return id;
  });
  const units = (options.units ?? []).map((u) => {
    const id = state.nextUnitId++;
    const unit: Unit = {
      id,
      owner: HUMAN,
      kind: "card",
      sourceId: u.cardId,
      cardInstanceIds: [newCard(u.cardId)],
      stars: u.stars ?? 1,
      xp: 0,
      wounded: u.wounded ?? false,
      location: u.location,
      restedInReserve: false,
    };
    state.units[id] = unit;
    return id;
  });
  p.roundGold = options.roundGold ?? 10;
  p.treasury = options.treasury ?? 0;
  if (options.life !== undefined) p.life = options.life;
  return { state, builder: new PlanBuilder(state, data, HUMAN), cards, units };
}

function only<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error("leer");
  return first;
}

describe("C3c2: Genesen, Entnahme, alternative Kosten", () => {
  it("R-7.5: angeboten werden nur eigene verwundete Einheiten, Kosten 1 Gold je Stern", () => {
    const { builder, units } = setup({
      units: [
        { cardId: "mercenary", location: RESERVE_0, stars: 2, wounded: true },
        { cardId: "mercenary", location: LEFT_A1 },
      ],
    });
    const options = healOptions(data, builder);
    expect(options).toHaveLength(1);
    const option = only(options);
    expect(option.unitId).toBe(units[0]);
    expect(option.cost).toBe(2 * data.config.healCostPerStar);
    expect(option.label).toBe("Söldner ★★ (Reserve 1)");
  });

  it("R-7.5: Genesen wechselt zu Ausspielen, bezahlt 1 Gold je Stern und hebt die Verwundung auf", () => {
    const { builder, units } = setup({ units: [{ cardId: "mercenary", location: RESERVE_0, stars: 2, wounded: true }], roundGold: 5 });
    const before = builder.preview();
    builder.setStep("position");
    expect(addHeal(builder, only(units))).toBeNull();
    expect(builder.step).toBe("play");
    const view = builder.preview();
    expect(view.units[only(units)]?.wounded).toBe(false);
    expect(ownEntry(view).roundGold).toBe(3);
    expect(healOptions(data, builder)).toEqual([]);
    expect(describeAction(data, before, only(builder.entries()).action)).toBe("Söldner ★★ genesen (2 Gold)");
  });

  it("R-7.5: ohne genug Gold lehnt die Engine das Genesen ab, die Planung bleibt leer", () => {
    const { builder, units } = setup({ units: [{ cardId: "mercenary", location: RESERVE_0, stars: 3, wounded: true }], roundGold: 2 });
    expect(addHeal(builder, only(units))).toBe("notEnoughGold");
    expect(builder.entries()).toEqual([]);
    expect(builder.preview().units[only(units)]?.wounded).toBe(true);
  });

  it("R-7.6: Entnahme verschiebt Gold aus der Schatzkammer in den Rundenvorrat, in jedem Schritt", () => {
    const { builder } = setup({ roundGold: 1, treasury: 6 });
    expect(withdrawMax(builder.preview())).toBe(6);
    for (const step of ["play", "buy", "position"] as const) {
      builder.setStep(step);
      expect(addWithdraw(builder, 2)).toBeNull();
    }
    const own = ownEntry(builder.preview());
    expect(own.treasury).toBe(0);
    expect(own.roundGold).toBe(7);
    expect(withdrawMax(builder.preview())).toBe(0);
    expect(builder.entries().map((e) => e.section)).toEqual(["play", "buy", "position"]);
  });

  it("R-7.6: mehr als die Schatzkammer oder kein positiver Betrag wird abgelehnt", () => {
    const { builder } = setup({ treasury: 3 });
    expect(addWithdraw(builder, 4)).toBe("notEnoughTreasury");
    expect(addWithdraw(builder, 0)).toBe("invalidAmount");
    expect(builder.entries()).toEqual([]);
  });

  it("R-14.6: Karten ohne alternative Kosten bieten nur die normale Bezahlung, Nicht-Einheiten gar keine", () => {
    const { builder, cards } = setup({ hand: ["mercenary", "fireball"] });
    expect(paymentChoice(data, builder, cards[0] ?? -1)).toEqual({ normalText: "2 Gold", alt: null });
    expect(paymentChoice(data, builder, cards[1] ?? -1)).toBeNull();
  });

  it("R-14.6: Blutzoll bezahlt mit Leben statt Gold", () => {
    const { builder, cards } = setup({ hand: ["spark_rider"], roundGold: 0, life: 10 });
    const card = only(cards);
    const before = builder.preview();
    expect(paymentChoice(data, builder, card)).toEqual({ normalText: "2 Gold", alt: { text: "2 Leben", sacrifice: 0, candidates: [] } });
    // Normal reicht das Gold nicht, alternativ schon.
    expect(builder.add(playAction(card, RESERVE_0))).toBe("notEnoughGold");
    expect(builder.add(playAction(card, RESERVE_0, { kind: "alt", sacrifice: [] }))).toBeNull();
    const own = ownEntry(builder.preview());
    expect(own.life).toBe(8);
    expect(own.roundGold).toBe(0);
    expect(describeAction(data, before, only(builder.entries()).action)).toBe("Funkenreiter ausspielen → Reserve 1 (alternativ: 2 Leben)");
  });

  it("R-14.6: Blutzoll ist nur erlaubt, wenn danach mindestens 1 Leben bleibt", () => {
    const { builder, cards } = setup({ hand: ["spark_rider"], life: 2 });
    expect(builder.add(playAction(only(cards), RESERVE_0, { kind: "alt", sacrifice: [] }))).toBe("notEnoughLife");
    expect(builder.entries()).toEqual([]);
  });

  it("R-14.6: Opfer sind eigene Karten-Einheiten auf Brett oder Reserve, auch verwundete, nicht der Anführer", () => {
    const { builder, cards, units } = setup({
      hand: ["bounty_hunter"],
      units: [
        { cardId: "mercenary", location: LEFT_A1, wounded: true },
        { cardId: "mercenary", location: RESERVE_1 },
      ],
    });
    const choice = paymentChoice(data, builder, only(cards));
    expect(choice?.normalText).toBe("5 Gold");
    expect(choice?.alt?.text).toBe("2 Gold + 1 Opfer");
    expect(choice?.alt?.sacrifice).toBe(1);
    expect(choice?.alt?.candidates.map((c) => c.unitId)).toEqual(units);
    expect(sacrificeCandidates(data, builder).map((c) => c.unitId)).toEqual(units);
  });

  it("R-14.6: Opfern macht das Feld sofort frei, die neue Einheit darf dorthin; falsche Opferzahl wird abgelehnt", () => {
    const { builder, cards, units } = setup({ hand: ["bounty_hunter"], units: [{ cardId: "mercenary", location: LEFT_A1 }], roundGold: 3 });
    const card = only(cards);
    const victim = only(units);
    const before = builder.preview();
    expect(builder.add(playAction(card, RESERVE_0, { kind: "alt", sacrifice: [] }))).toBe("wrongSacrificeCount");
    const payment = { kind: "alt" as const, sacrifice: [victim] };
    const locations = playLocations(builder, payment).map(locationKey);
    expect(playLocations(builder).map(locationKey)).not.toContain(locationKey(LEFT_A1));
    expect(locations).toContain(locationKey(LEFT_A1));
    expect(builder.add(playAction(card, LEFT_A1, payment))).toBeNull();
    const view = builder.preview();
    expect(view.units[victim]).toBeUndefined();
    expect(ownEntry(view).roundGold).toBe(1);
    expect(Object.values(view.units).some((u) => u.owner === HUMAN && u.sourceId === "bounty_hunter" && locationKey(u.location) === locationKey(LEFT_A1))).toBe(true);
    expect(describeAction(data, before, only(builder.entries()).action)).toBe("Kopfgeldjäger ausspielen → Linke Front a1 (alternativ: 2 Gold + 1 Opfer: Söldner)");
  });

  it("R-14.6: auf dem Brett gilt die gewählte Bezahlung, das Feld des Opfers wird hervorgehoben", () => {
    const { builder, cards, units } = setup({ hand: ["bounty_hunter"], units: [{ cardId: "mercenary", location: LEFT_A1 }], roundGold: 2 });
    const selection = { kind: "card" as const, cardInstanceId: only(cards), payment: { kind: "alt" as const, sacrifice: units } };
    expect(targetLocations(data, builder, selection).map(locationKey)).toContain(locationKey(LEFT_A1));
    expect(targetLocations(data, builder, { kind: "card", cardInstanceId: only(cards) }).map(locationKey)).not.toContain(locationKey(LEFT_A1));
    // Normal (5 Gold) reicht das Gold nicht; mit Opfer (2 Gold) schon.
    expect(applyTarget(data, builder, { kind: "card", cardInstanceId: only(cards) }, RESERVE_0)).toBe("notEnoughGold");
    expect(applyTarget(data, builder, selection, LEFT_A1)).toBeNull();
    expect(only(builder.entries()).action).toEqual({ type: "playUnit", cardInstanceId: only(cards), to: LEFT_A1, useAltCost: true, sacrifice: units });
  });
});

describe("P11b: angezeigte Kosten aus der Engine (R-17.3)", () => {
  const LEFT_B1: UnitLocation = { zone: "left", cell: { col: 0, row: 1 } };
  const RIGHT_A1: UnitLocation = { zone: "right", cell: { col: 0, row: 0 } };

  /** Mensch mit Vex (Goblin) und Funkenreiter + Plänkler auf dem Brett: 3 Goblins, eine Karte fehlt zu Goblins 4. */
  function goblins3(hand: string[]): Setup {
    return setup({
      leaders: ["vex", "brann", "ilyra", "morgra"],
      hand,
      units: [
        { cardId: "spark_rider", location: LEFT_A1 },
        { cardId: "goblin_skirmisher", location: RIGHT_A1 },
      ],
    });
  }

  function textOf(builder: PlanBuilder, instanceId: number): string {
    const entry = handCards(data, builder.preview()).find((c) => c.instanceId === instanceId);
    if (!entry) throw new Error("nicht auf der Hand");
    return cardText(builder, entry);
  }

  it("R-17.3: mit aktiver Goblin-Resonanz zeigen Handkarten und Bezahlwahl die verbilligten Kosten", () => {
    const { builder, cards } = setup({
      leaders: ["vex", "brann", "ilyra", "morgra"],
      hand: ["tinker", "spark_rider", "mercenary"],
      units: [
        { cardId: "spark_rider", location: LEFT_A1 },
        { cardId: "goblin_skirmisher", location: RIGHT_A1 },
        { cardId: "tinker", location: LEFT_B1 },
      ],
    });
    const [tinker, rider, mercenary] = cards as [number, number, number];
    expect(textOf(builder, tinker)).toBe("Kesselflicker (2)");
    expect(paymentChoice(data, builder, tinker)).toEqual({ normalText: "2 Gold", alt: null });
    // Blutzoll ohne Gold bleibt ohne Gold (nie unter 0), normal 2 − 1 = 1.
    expect(paymentChoice(data, builder, rider)).toEqual({ normalText: "1 Gold", alt: { text: "2 Leben", sacrifice: 0, candidates: [] } });
    // Karten anderer Rassen kosten unverändert.
    expect(textOf(builder, mercenary)).toBe("Söldner (2)");
  });

  it("R-17.3: die Anzeige folgt dem Brett des Entwurfs – nach dem Ausspielen der vierten Goblin-Karte wird die nächste billiger", () => {
    const { builder, cards } = goblins3(["tinker", "tinker"]);
    const [first, second] = cards as [number, number];
    expect(textOf(builder, second)).toBe("Kesselflicker (3)");
    expect(paymentChoice(data, builder, second)?.normalText).toBe("3 Gold");
    expect(builder.add(playAction(first, LEFT_B1))).toBeNull();
    expect(textOf(builder, second)).toBe("Kesselflicker (2)");
    expect(paymentChoice(data, builder, second)?.normalText).toBe("2 Gold");
    // Die Engine verlangt genau den angezeigten Betrag.
    const goldBefore = ownEntry(builder.preview()).roundGold;
    expect(builder.add(playAction(second, RESERVE_0))).toBeNull();
    expect(goldBefore - (ownEntry(builder.preview()).roundGold ?? 0)).toBe(2);
  });
});
