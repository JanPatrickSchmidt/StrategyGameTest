import { describe, expect, it } from "vitest";
import { type GameState, getPlayer, loadGameData } from "@game/engine";
import { addBuy, blockedText, boughtCounts, buyOptions, buyOptionText, buySpending, depositText, pileGroupName } from "./buyOffer";
import { describeAction, ownEntry, PlanBuilder, reasonText } from "./planner";
import { boughtInRound, cardZoneOf } from "./cardOverview";
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

describe("P18: Kaufen in Randfällen", () => {
  it("R-11.3: Kauflimit gilt auch für Karten aus dem Klassen-Pool", () => {
    const { builder: probe } = setup();
    const classCard = buyOptions(data, probe).find((o) => o.group === "class");
    if (!classCard) throw new Error("kein Klassen-Pool");
    const cardId = classCard.cardId;
    const { builder } = setup({ roundGold: 100, edit: (s) => (getPlayer(s, HUMAN).classPool[cardId] = 2) });
    expect(addBuy(builder, cardId)).toBeNull();
    expect(addBuy(builder, cardId)).toBeNull();
    // Gold reicht noch, aber der Stapel enthielt zu Rundenbeginn nur 2 Kopien.
    expect(ownEntry(builder.preview()).roundGold).toBeGreaterThanOrEqual(classCard.cost);
    expect(addBuy(builder, cardId)).toBe("pileLimitReached");
    const option = buyOptions(data, builder).find((o) => o.cardId === cardId);
    expect(option).toMatchObject({ group: "class", pileAtStart: 2, bought: 2, blocked: "pileLimitReached" });
    expect(boughtCounts(builder).get(cardId)).toBe(2);
    expect(builder.planning().buy.filter((a) => a.type === "buy" && a.cardId === cardId)).toHaveLength(2);
    // Andere Karten des Klassen-Pools sind davon nicht betroffen.
    const other = buyOptions(data, builder).find((o) => o.group === "class" && o.cardId !== cardId);
    expect(other?.blocked).toBeNull();
  });

  it("R-11.1: geplanter Kauf wird als abgelehnt angezeigt, wenn eine spätere Ausspiel-Aktion das Gold verbraucht", () => {
    // Söldner (2 Gold) auf der Hand, genau 2 Gold im Rundenvorrat, Kauf: Läutern (2 Gold).
    const unitId = "mercenary";
    const buyId = "purify";
    let unitCard = -1;
    const { builder } = setup({
      roundGold: 2,
      treasury: 0,
      edit: (s) => {
        unitCard = s.nextCardInstanceId++;
        s.cards[unitCard] = { id: unitCard, cardId: unitId, owner: HUMAN };
        getPlayer(s, HUMAN).hand.push(unitCard);
      },
    });
    const unitCost = data.cards.get(unitId)?.cost ?? 0;
    const buyCost = data.cards.get(buyId)?.cost ?? 0;
    expect(unitCost).toBe(2);
    expect(buyCost).toBe(2);
    // Zuerst der Kauf: das Gold reicht.
    expect(addBuy(builder, buyId)).toBeNull();
    expect(buySpending(builder)).toBe(buyCost);
    // Dann im Schritt Ausspielen (läuft vor dem Kaufen, R-5) eine Einheit, die das ganze Gold braucht.
    builder.setStep("play");
    expect(builder.add({ type: "playUnit", cardInstanceId: unitCard, to: { zone: "reserve", slot: 0 } })).toBeNull();
    const buyEntry = builder.entries().find((e) => e.section === "buy");
    expect(buyEntry).toMatchObject({ action: { type: "buy", cardId: buyId }, rejection: "notEnoughGold" });
    // Die Planungsliste zeigt den Kauf weiter, mit „wird abgelehnt: Gold reicht nicht“.
    expect(reasonText("notEnoughGold")).toBe("Gold reicht nicht");
    expect(boughtCounts(builder).get(buyId)).toBeUndefined();
    expect(buySpending(builder)).toBe(0);
    expect(builder.planning().buy).toEqual([]);
    expect(buyOptions(data, builder).find((o) => o.cardId === buyId)).toMatchObject({ bought: 0, blocked: "notEnoughGold" });
    // Wird die Einheit wieder entfernt, gilt der Kauf wieder.
    const play = builder.entries().find((e) => e.section === "play");
    if (!play) throw new Error("Ausspiel-Aktion fehlt");
    builder.remove(play.section, play.index);
    expect(builder.entries().find((e) => e.section === "buy")?.rejection).toBeNull();
    expect(buySpending(builder)).toBe(buyCost);
  });
});

describe("C5b3: Befunde der Bildschirmfoto-Prüfung und Abnahme C5", () => {
  it("R-11.1, R-11.3, R-11.4: gesperrte Karten nennen ihren Grund sichtbar, kaufbare keinen", () => {
    const { builder } = setup({ roundGold: 2, edit: (s) => (s.supply["silver"] = 0) });
    const byId = (id: string) => {
      const option = buyOptions(data, builder).find((o) => o.cardId === id);
      if (!option) throw new Error(`${id} fehlt im Angebot`);
      return option;
    };
    expect(blockedText(byId("purify"))).toBeNull();
    expect(blockedText(byId("gold_bar"))).toBe("Nicht möglich: Gold reicht nicht");
    expect(blockedText(byId("silver"))).toBe(`Nicht möglich: ${reasonText("pileEmpty")}`);
    expect(blockedText(byId("silver"))).toContain("R-11.4");
    const { builder: limited } = setup({ roundGold: 100, edit: (s) => (s.supply["gold_bar"] = 1) });
    expect(addBuy(limited, "gold_bar")).toBeNull();
    const bar = buyOptions(data, limited).find((o) => o.cardId === "gold_bar");
    if (!bar) throw new Error("Goldbarren fehlt");
    expect(blockedText(bar)).toBe(`Nicht möglich: ${reasonText("pileLimitReached")}`);
  });

  it("R-11.2: Abnahme C5 – Käufe aus Basis, Königreich und Klassen-Pool über mehrere Runden landen im Deck", () => {
    const session = new GameSession(data, { seed: 3 });
    const kingdom = buyOptions(data, session.planner()).find((o) => o.group === "kingdom" && o.cardId === "rune_shield");
    const classCard = buyOptions(data, session.planner()).find((o) => o.group === "class");
    if (!kingdom || !classCard) throw new Error("Angebot unvollständig");
    const plan: { group: string; cardId: string }[] = [
      { group: "basic", cardId: "silver" },
      { group: "kingdom", cardId: kingdom.cardId },
      { group: "class", cardId: classCard.cardId },
    ];
    const boughtIds: number[] = [];
    for (const { group, cardId } of plan) {
      expect(session.status).toBe("waitingForHuman");
      const round = session.state.round;
      getPlayer(session.state, HUMAN).roundGold = 10;
      const builder = session.planner();
      expect(buyOptions(data, builder).find((o) => o.cardId === cardId)?.group).toBe(group);
      // Wie in der Prüfung: kaufen, wieder entfernen, erneut kaufen, zwischen den Schritten wechseln.
      expect(addBuy(builder, cardId)).toBeNull();
      const entry = builder.entries().find((e) => e.section === "buy");
      if (!entry) throw new Error("Kauf fehlt in der Liste");
      builder.remove(entry.section, entry.index);
      expect(boughtCounts(builder).size).toBe(0);
      expect(addBuy(builder, cardId)).toBeNull();
      builder.setStep("play");
      builder.setStep("position");
      builder.setStep("buy");
      expect(boughtCounts(builder).get(cardId)).toBe(1);
      expect(session.submitHuman(builder.planning())).toEqual({ ok: true });
      const bought = boughtInRound(session.view().log, round, HUMAN);
      expect(bought.map((b) => b.cardId)).toEqual([cardId]);
      const first = bought[0];
      if (!first) throw new Error("Kauf fehlt im Protokoll");
      boughtIds.push(first.cardInstanceId);
    }
    // Alle gekauften Karten gehören dem Menschen und liegen bei seinen Karten (Hand, Ausgespielt, Deck, Ablage).
    const view = session.view();
    for (const id of boughtIds) {
      expect(session.state.cards[id]?.owner).toBe(HUMAN);
      expect(cardZoneOf(view, id)).not.toBeNull();
    }
  });
});

/** Käufe der Bots in der ersten Runde (gemeinsamer Stapel, R-11.3). */
function countBotBuys(state: GameState, cardId: string): number {
  return state.log.filter((e) => e.type === "card_bought" && e.cardId === cardId && e.player !== HUMAN).length;
}
