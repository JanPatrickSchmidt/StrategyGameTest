import { describe, expect, it } from "vitest";
import { type GameState, getPlayer, loadGameData } from "@game/engine";
import { addBuy, boughtCounts, buyOptions, buyOptionText, buySpending, depositText, pileGroupName } from "./buyOffer";
import { describeAction, ownEntry, PlanBuilder } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();

/** Planung des Menschen in Runde 1 mit festem Gold (Anführer der Standardverteilung, Sitz 0). */
function setup(options: { roundGold?: number; treasury?: number; edit?: (state: GameState) => void } = {}): { state: GameState; builder: PlanBuilder } {
  const session = new GameSession(data, { seed: 3 });
  const state = structuredClone(session.state);
  const p = getPlayer(state, HUMAN);
  p.roundGold = options.roundGold ?? 10;
  p.treasury = options.treasury ?? 0;
  options.edit?.(state);
  return { state, builder: new PlanBuilder(state, data, HUMAN) };
}

function ownClass(state: GameState): string {
  const leaderId = getPlayer(state, HUMAN).leader.leaderId;
  const leader = data.leaders.get(leaderId);
  if (!leader) throw new Error("Anführer fehlt");
  return leader.class;
}

describe("C5a: Kaufangebot", () => {
  it("R-4.5: Angebot = alle kaufbaren Basisstapel, alle 16 Königreich-Karten und die 3 Karten des eigenen Klassen-Pools", () => {
    const { state, builder } = setup();
    const options = buyOptions(data, builder);
    const kingdom = options.filter((o) => o.group === "kingdom");
    const basic = options.filter((o) => o.group === "basic");
    const cls = options.filter((o) => o.group === "class");
    expect(kingdom).toHaveLength(16);
    expect(cls).toHaveLength(3);
    expect(cls.every((o) => o.card.pool === `class:${ownClass(state)}`)).toBe(true);
    expect(basic.map((o) => o.cardId).sort()).toEqual(["gold_bar", "purify", "silver"]);
    // Fluch ist nicht kaufbar (buyable: false) und erscheint nicht.
    expect(options.some((o) => o.cardId === "curse")).toBe(false);
    // Reihenfolge: Basis, Königreich, Klassen-Pool; innerhalb nach Kosten.
    const groups = options.map((o) => o.group);
    expect(groups.indexOf("kingdom")).toBeGreaterThan(groups.lastIndexOf("basic"));
    expect(groups.indexOf("class")).toBeGreaterThan(groups.lastIndexOf("kingdom"));
    expect(kingdom.map((o) => o.cost)).toEqual([...kingdom.map((o) => o.cost)].sort((a, b) => a - b));
  });

  it("R-4.5: Stapelgrößen laut Daten (Silber 20, Goldbarren 12, Klassen-Pool aus der Konfiguration)", () => {
    const { builder } = setup();
    const options = buyOptions(data, builder);
    const pile = (id: string): number | undefined => options.find((o) => o.cardId === id)?.pileAtStart;
    expect(pile("silver")).toBe(20);
    expect(pile("gold_bar")).toBe(12);
    for (const o of options.filter((x) => x.group === "class")) expect(o.pileAtStart).toBe(data.config.classPoolPileSize);
    expect(buyOptionText(options.find((o) => o.cardId === "silver")!)).toBe("Silber · 3 Gold · Stapel 20");
  });

  it("C5a: Gruppenname des Klassen-Pools nennt die Klasse", () => {
    const { state, builder } = setup();
    const options = buyOptions(data, builder);
    const name = data.classes.get(ownClass(state))?.name;
    expect(pileGroupName(data, "class", options)).toBe(`Klassen-Pool (${name})`);
    expect(pileGroupName(data, "kingdom", options)).toBe("Königreich");
  });

  it("R-11.2: Kauf wird im Schritt Kaufen geplant, Gold sofort abgezogen, Text in der Liste", () => {
    const { builder } = setup({ roundGold: 10 });
    const before = builder.preview();
    builder.setStep("play");
    expect(addBuy(builder, "silver")).toBeNull();
    expect(builder.step).toBe("buy");
    expect(ownEntry(builder.preview()).roundGold).toBe(7);
    expect(boughtCounts(builder).get("silver")).toBe(1);
    expect(buySpending(builder)).toBe(3);
    const entry = builder.entries().find((e) => e.section === "buy");
    expect(entry && describeAction(data, before, entry.action)).toBe("Silber kaufen");
    expect(buyOptions(data, builder).find((o) => o.cardId === "silver")?.bought).toBe(1);
  });

  it("R-11.2: mehrere Käufe pro Runde, auch derselben Karte, bis das Gold nicht mehr reicht", () => {
    const { builder } = setup({ roundGold: 7 });
    expect(addBuy(builder, "silver")).toBeNull();
    expect(addBuy(builder, "silver")).toBeNull();
    expect(addBuy(builder, "silver")).toBe("notEnoughGold");
    expect(boughtCounts(builder).get("silver")).toBe(2);
    const silver = buyOptions(data, builder).find((o) => o.cardId === "silver");
    expect(silver?.blocked).toBe("notEnoughGold");
  });

  it("R-11.1: Gold kommt zuerst aus dem Rundenvorrat, dann aus der Schatzkammer", () => {
    const { builder } = setup({ roundGold: 2, treasury: 5 });
    expect(addBuy(builder, "gold_bar")).toBeNull();
    const own = ownEntry(builder.preview());
    expect(own.roundGold).toBe(0);
    expect(own.treasury).toBe(1);
  });

  it("R-11.3: von einem Stapel höchstens so viele Kopien, wie er zu Rundenbeginn enthält", () => {
    const { builder } = setup({ roundGold: 100, edit: (s) => (s.supply["gold_bar"] = 2) });
    expect(addBuy(builder, "gold_bar")).toBeNull();
    expect(addBuy(builder, "gold_bar")).toBeNull();
    expect(addBuy(builder, "gold_bar")).toBe("pileLimitReached");
    const bar = buyOptions(data, builder).find((o) => o.cardId === "gold_bar");
    expect(bar).toMatchObject({ pileAtStart: 2, bought: 2, blocked: "pileLimitReached" });
  });

  it("R-11.4: aus einem leeren Stapel kann nicht gekauft werden", () => {
    const { builder } = setup({ edit: (s) => (s.supply["silver"] = 0) });
    expect(buyOptions(data, builder).find((o) => o.cardId === "silver")?.blocked).toBe("pileEmpty");
    expect(addBuy(builder, "silver")).toBe("pileEmpty");
    expect(boughtCounts(builder).size).toBe(0);
  });

  it("R-12.5: Einzahlen automatisch – übriges Gold des Rundenvorrats geht in die Schatzkammer", () => {
    const { builder } = setup({ roundGold: 5, treasury: 3 });
    expect(depositText(builder.preview())).toBe(
      "Übrig: 5 Gold im Rundenvorrat – geht am Rundenende automatisch in die Schatzkammer (Stand vor dem Kampf: dann 8 Gold; Kampf-Folgen können das noch ändern).",
    );
    addBuy(builder, "silver");
    expect(depositText(builder.preview())).toContain("Übrig: 2 Gold");
    addBuy(builder, "rune_shield");
    expect(depositText(builder.preview())).toBe(
      "Kein Gold im Rundenvorrat übrig; die Schatzkammer steht vor dem Kampf bei 3 Gold (Kampf-Folgen können das noch ändern).",
    );
  });

  it("R-11.1: bezahltes Gold kommt aus den purchase_paid-Ereignissen des Entwurfs, auch aus der Schatzkammer", () => {
    const { builder } = setup({ roundGold: 2, treasury: 10 });
    const before = ownEntry(builder.preview());
    expect(addBuy(builder, "gold_bar")).toBeNull();
    expect(addBuy(builder, "silver")).toBeNull();
    const paid = builder.purchasesPaid();
    expect(paid.map((e) => e.cardId)).toEqual(["gold_bar", "silver"]);
    expect(paid[0]).toMatchObject({ paidFromRoundGold: 2, paidFromTreasury: 4 });
    const after = ownEntry(builder.preview());
    const drop = before.roundGold - after.roundGold + (before.treasury - after.treasury);
    expect(buySpending(builder)).toBe(drop);
    expect(buySpending(builder)).toBe(paid.reduce((s, e) => s + e.paidFromRoundGold + e.paidFromTreasury, 0));
    // Ein abgelehnter Kauf erzeugt kein Ereignis und zählt nicht.
    expect(addBuy(builder, "gold_bar")).toBe("notEnoughGold");
    expect(buySpending(builder)).toBe(drop);
  });

  it("R-12.5: Einzahl-Text nennt die Schatzkammer als Stand vor dem Kampf", () => {
    const { builder } = setup({ roundGold: 3, treasury: 1 });
    const text = depositText(builder.preview());
    expect(text).toContain("Stand vor dem Kampf: dann 4 Gold");
    expect(text).toContain("Kampf-Folgen können das noch ändern");
  });

  it("R-11.2: Probe ändert die Planung nicht", () => {
    const { builder } = setup();
    addBuy(builder, "silver");
    const planning = JSON.stringify(builder.planning());
    buyOptions(data, builder);
    expect(JSON.stringify(builder.planning())).toBe(planning);
  });

  it("R-11.2: nach dem Bestätigen liegt die gekaufte Karte im Deck des Menschen (Ablage oder nachgemischt)", () => {
    const session = new GameSession(data, { seed: 3 });
    getPlayer(session.state, HUMAN).roundGold = 10;
    const builder = session.planner();
    expect(addBuy(builder, "silver")).toBeNull();
    expect(addBuy(builder, "rune_shield")).toBeNull();
    expect(session.submitHuman(builder.planning())).toEqual({ ok: true });
    const owned = Object.values(session.state.cards).filter((c) => c.owner === HUMAN);
    expect(owned.filter((c) => c.cardId === "silver")).toHaveLength(1);
    expect(owned.filter((c) => c.cardId === "rune_shield")).toHaveLength(1);
    const p = getPlayer(session.state, HUMAN);
    const inDeck = new Set([...p.deck, ...p.discard, ...p.hand, ...p.played]);
    for (const c of owned.filter((x) => x.cardId === "silver" || x.cardId === "rune_shield")) expect(inDeck.has(c.id)).toBe(true);
    expect(session.state.supply["silver"]).toBe(19 - countBotBuys(session.state, "silver"));
  });
});

/** Käufe der Bots in der ersten Runde (gemeinsamer Stapel, R-11.3). */
function countBotBuys(state: GameState, cardId: string): number {
  return state.log.filter((e) => e.type === "card_bought" && e.cardId === cardId && e.player !== HUMAN).length;
}
