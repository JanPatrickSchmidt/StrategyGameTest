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

/** Zweite Planung einer Partie, in der der Mensch zu Beginn Anführer A und eine Karten-Einheit B in der Reserve hat. */
function twoUnits(): { builder: PlanBuilder; a: number; b: number; x: UnitLocation } {
  const { session, builder: first, unitCard } = sessionWithUnitInHand();
  expect(first.add({ type: "playUnit", cardInstanceId: unitCard, to: RESERVE_0 })).toBeNull();
  session.submitHuman(first.planning());
  const builder = session.planner();
  const units = builder.movableUnits();
  const a = units.find((u) => u.kind === "leader");
  const b = units.find((u) => u.kind !== "leader" && u.cardInstanceIds.includes(unitCard));
  if (!a || !b) throw new Error("Anführer oder Einheit fehlt");
  expect(b.location).toEqual(RESERVE_0);
  return { builder, a: a.id, b: b.id, x: a.location };
}

const RESERVE_1: UnitLocation = { zone: "reserve", slot: 1 };
const RESERVE_2: UnitLocation = { zone: "reserve", slot: 2 };

describe("P7: erneutes Versetzen und abhängige Bewegungen", () => {
  it("R-7.2: erneutes Versetzen von A macht eine abhängige Bewegung von B nicht ungültig", () => {
    const { builder, a, b, x } = twoUnits();
    expect(builder.relocate(a, RESERVE_1)).toBeNull();
    expect(builder.relocate(b, x)).toBeNull();
    expect(builder.relocate(a, RESERVE_2)).toBeNull();
    // Die Bewegung von A behält ihren Platz vor der von B.
    expect(builder.planning().position).toEqual([
      { type: "moveUnit", unitId: a, to: RESERVE_2 },
      { type: "moveUnit", unitId: b, to: x },
    ]);
    expect(builder.entries().every((e) => e.rejection === null)).toBe(true);
    const preview = builder.preview();
    expect(preview.units[a]?.location).toEqual(RESERVE_2);
    expect(preview.units[b]?.location).toEqual(x);
  });

  it("R-7.2: A zurück auf sein Ausgangsfeld, auf das B schon geplant ist, wird abgelehnt und ändert nichts", () => {
    const { builder, a, b, x } = twoUnits();
    builder.relocate(a, RESERVE_1);
    builder.relocate(b, x);
    const before = JSON.stringify(builder.planning());
    expect(builder.relocate(a, x)).toBe("breaksPlannedAction");
    expect(JSON.stringify(builder.planning())).toBe(before);
    expect(builder.entries().every((e) => e.rejection === null)).toBe(true);
    expect(builder.preview().units[b]?.location).toEqual(x);
  });

  it("R-7.2: kann die Bewegung nicht an ihrem Platz bleiben, rückt sie ans Ende (Feld wird erst durch eine spätere Bewegung frei)", () => {
    const { builder, a, b } = twoUnits();
    builder.relocate(a, RESERVE_1);
    builder.relocate(b, RESERVE_2);
    // A auf den Reserveplatz 0, den B erst mit der späteren Bewegung räumt.
    expect(builder.relocate(a, RESERVE_0)).toBeNull();
    expect(builder.planning().position).toEqual([
      { type: "moveUnit", unitId: b, to: RESERVE_2 },
      { type: "moveUnit", unitId: a, to: RESERVE_0 },
    ]);
    expect(builder.preview().units[a]?.location).toEqual(RESERVE_0);
    expect(builder.preview().units[b]?.location).toEqual(RESERVE_2);
  });

  it("R-5: in keinem der Fälle zeigt die Vorschau eine Aktion, die nicht eingereicht wird", () => {
    const { builder, a, b, x } = twoUnits();
    const steps: [number, UnitLocation][] = [
      [a, RESERVE_1],
      [b, x],
      [a, RESERVE_2],
      [a, x],
      [b, RESERVE_1],
      [a, x],
      [b, RESERVE_0],
    ];
    for (const [unit, to] of steps) {
      builder.relocate(unit, to);
      const accepted = builder.entries().filter((e) => e.rejection === null).map((e) => e.action);
      expect(builder.entries().every((e) => e.rejection === null)).toBe(true);
      expect(builder.planning().position).toEqual(accepted);
    }
  });

  it("R-7.1: das Ausspielziel einer neuen Einheit lässt sich nicht auf ein Feld legen, das eine geplante Bewegung braucht", () => {
    const { builder, a } = twoUnits();
    const view = builder.preview();
    const card = handCards(data, view).find((c) => c.card.type === "unit" && c.card.cost <= ownEntry(view).roundGold);
    if (!card) throw new Error("Keine bezahlbare Einheit in der zweiten Hand");
    expect(builder.add({ type: "playUnit", cardInstanceId: card.instanceId, to: RESERVE_2 })).toBeNull();
    expect(builder.relocate(a, RESERVE_1)).toBeNull();
    const fresh = Object.values(builder.preview().units).find((u) => u.owner === HUMAN && u.cardInstanceIds.includes(card.instanceId));
    if (!fresh) throw new Error("Neue Einheit fehlt");
    // Reserveplatz 1 braucht die Bewegung von A (sie liegt im späteren Schritt Aufstellen).
    const before = JSON.stringify(builder.planning());
    expect(builder.relocate(fresh.id, RESERVE_1)).toBe("breaksPlannedAction");
    expect(JSON.stringify(builder.planning())).toBe(before);
    expect(builder.preview().units[a]?.location).toEqual(RESERVE_1);
  });
});
