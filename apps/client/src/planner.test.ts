import { describe, expect, it } from "vitest";
import { loadGameData, type UnitLocation } from "@game/engine";
import { describeAction, goldSummary, handCards, ownEntry, PlanBuilder, playedCards } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();

/** Partie, in deren erster Hand des Menschen eine Einheitenkarte liegt. */
function sessionWithUnitInHand(): { session: GameSession; builder: PlanBuilder; unitCard: number } {
  for (let seed = 1; seed < 50; seed++) {
    const session = new GameSession(data, { seed });
    const builder = session.planner();
    const unit = handCards(data, builder.preview()).find((c) => c.card.type === "unit" && c.card.cost <= ownEntry(builder.preview()).roundGold);
    if (unit) return { session, builder, unitCard: unit.instanceId };
  }
  throw new Error("Keine Partie mit bezahlbarer Einheit auf der Hand gefunden");
}

const RESERVE_0: UnitLocation = { zone: "reserve", slot: 0 };

describe("C3a: Planungsentwurf im Client", () => {
  it("R-5: die Planung ist in die Schritte Ausspielen, Kaufen, Aufstellen gegliedert, Wechsel jederzeit möglich", () => {
    const { builder } = sessionWithUnitInHand();
    expect(builder.step).toBe("play");
    builder.setStep("position");
    expect(builder.step).toBe("position");
    builder.setStep("play");
    expect(builder.step).toBe("play");
  });

  it("R-6.4: die automatisch ausgespielten Münzen sind sichtbar, die Hand enthält sie nicht mehr", () => {
    const { builder } = sessionWithUnitInHand();
    const view = builder.preview();
    const played = playedCards(data, view);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((c) => c.card.type === "resource")).toBe(true);
    expect(handCards(data, view).some((c) => c.card.type === "resource")).toBe(false);
    expect(goldSummary(view)).toMatch(/^Rundenvorrat \d+ Gold · Schatzkammer \d+ Gold$/);
  });

  it("R-7.1: eine ausgespielte Einheit verschwindet in der Vorschau von der Hand, kostet Gold und steht am gewählten Ort", () => {
    const { builder, unitCard } = sessionWithUnitInHand();
    const before = builder.preview();
    const goldBefore = ownEntry(before).roundGold;
    expect(builder.add({ type: "playUnit", cardInstanceId: unitCard, to: RESERVE_0 })).toBeNull();
    const after = builder.preview();
    expect(ownEntry(after).hand).not.toContain(unitCard);
    expect(ownEntry(after).roundGold).toBeLessThan(goldBefore);
    expect(Object.values(after.units).some((u) => u.owner === HUMAN && u.cardInstanceIds.includes(unitCard) && u.location.zone === "reserve")).toBe(true);
    expect(builder.planning().play).toHaveLength(1);
    expect(builder.entries()[0]?.rejection).toBeNull();
  });

  it("C3a: eine abgelehnte Aktion wird nicht übernommen und liefert den Grund", () => {
    const { builder, unitCard } = sessionWithUnitInHand();
    builder.add({ type: "playUnit", cardInstanceId: unitCard, to: RESERVE_0 });
    // Dieselbe Karte ein zweites Mal: nicht mehr auf der Hand.
    expect(builder.add({ type: "playUnit", cardInstanceId: unitCard, to: { zone: "reserve", slot: 1 } })).toBe("cardNotInHand");
    expect(builder.entries()).toHaveLength(1);
  });

  it("R-5: Aktionen im falschen Schritt lehnt die Engine ab (Bewegen gehört zu Aufstellen)", () => {
    const { builder } = sessionWithUnitInHand();
    const leader = builder.movableUnits().find((u) => u.kind === "leader");
    if (!leader) throw new Error("Anführer fehlt");
    expect(builder.add({ type: "moveUnit", unitId: leader.id, to: RESERVE_0 })).toBe("wrongSection");
    builder.setStep("position");
    expect(builder.add({ type: "moveUnit", unitId: leader.id, to: RESERVE_0 })).toBeNull();
    expect(builder.preview().units[leader.id]?.location).toEqual(RESERVE_0);
  });

  it("R-5: nach einem Wechsel zurück zum Ausspielen wird die ganze Planung neu durchgespielt; ungültig gewordene Aktionen werden markiert", () => {
    const { builder, unitCard } = sessionWithUnitInHand();
    const leader = builder.movableUnits().find((u) => u.kind === "leader");
    if (!leader) throw new Error("Anführer fehlt");
    builder.setStep("position");
    expect(builder.add({ type: "moveUnit", unitId: leader.id, to: RESERVE_0 })).toBeNull();
    builder.setStep("play");
    // Ausspielen auf denselben Reserveplatz: angenommen, weil Ausspielen vor Aufstellen ausgeführt wird (R-5) …
    expect(builder.add({ type: "playUnit", cardInstanceId: unitCard, to: RESERVE_0 })).toBeNull();
    // … dadurch ist der Platz beim Aufstellen besetzt.
    const move = builder.entries().find((e) => e.section === "position");
    expect(move?.rejection).toBe("cellOccupied");
    expect(builder.planning().position).toHaveLength(0);
    // Entfernen des Ausspielens macht die Bewegung wieder gültig.
    builder.remove("play", 0);
    expect(builder.entries().find((e) => e.section === "position")?.rejection).toBeNull();
  });

  it("C3a: freie Orte enthalten keine Felder mit eigener Einheit; bewegbar sind nur Einheiten vom Beginn der Planung", () => {
    const { builder, unitCard } = sessionWithUnitInHand();
    const leader = builder.movableUnits().find((u) => u.kind === "leader");
    if (!leader) throw new Error("Anführer fehlt");
    expect(builder.freeLocations()).not.toContainEqual(leader.location);
    builder.add({ type: "playUnit", cardInstanceId: unitCard, to: RESERVE_0 });
    expect(builder.freeLocations()).not.toContainEqual(RESERVE_0);
    expect(builder.movableUnits().map((u) => u.id)).toEqual([leader.id]);
  });

  it("C3a: die bestätigte Planung wird eingereicht und die Partie läuft weiter", () => {
    const { session, builder, unitCard } = sessionWithUnitInHand();
    builder.add({ type: "playUnit", cardInstanceId: unitCard, to: { zone: "right", cell: { col: 2, row: 2 } } });
    expect(session.submitHuman(builder.planning())).toEqual({ ok: true });
    expect(session.state.round).toBe(2);
    expect(Object.values(session.state.units).some((u) => u.owner === HUMAN && u.cardInstanceIds.includes(unitCard))).toBe(true);
  });

  it("R-3.8: geplante Aktionen werden mit Feldnamen beschrieben", () => {
    const { builder, unitCard } = sessionWithUnitInHand();
    const before = builder.preview();
    const name = data.cards.get(before.cards[unitCard]?.cardId ?? "")?.name;
    expect(describeAction(data, before, { type: "playUnit", cardInstanceId: unitCard, to: { zone: "left", cell: { col: 2, row: 2 } } })).toBe(
      `${name} ausspielen → Linke Front c3`,
    );
    const leader = builder.movableUnits()[0];
    if (!leader) throw new Error("Anführer fehlt");
    expect(describeAction(data, before, { type: "moveUnit", unitId: leader.id, to: { zone: "center", position: 2 } })).toMatch(/bewegen → Mitte d1$/);
  });
});
