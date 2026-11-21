import { describe, expect, it } from "vitest";
import { getPlayer, loadGameData, type PlayerView } from "@game/engine";
import { addBuy } from "./buyOffer";
import { boughtInRound, boughtNote, cardCountText, cardZoneOf, ownCardOverview, zoneLine } from "./cardOverview";
import { ownEntry } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();

/** Runde 1 mit 10 Gold: Mensch kauft Silber und Schutzrune, dann wird die Runde aufgelöst. */
function afterBuyRound(): { session: GameSession; view: PlayerView; round: number } {
  const session = new GameSession(data, { seed: 3 });
  const round = session.view().round;
  getPlayer(session.state, HUMAN).roundGold = 10;
  const builder = session.planner();
  expect(addBuy(builder, "silver")).toBeNull();
  expect(addBuy(builder, "rune_shield")).toBeNull();
  expect(session.submitHuman(builder.planning())).toEqual({ ok: true });
  return { session, view: session.view(), round };
}

describe("C5b1: Übersicht der eigenen Karten", () => {
  it("R-11.2: die Käufe der Runde stehen im Protokoll der eigenen Sicht, mit Karte und Instanz", () => {
    const { view, round } = afterBuyRound();
    const bought = boughtInRound(view.log, round, HUMAN);
    expect(bought.map((b) => b.cardId)).toEqual(["silver", "rune_shield"]);
    expect(boughtInRound(view.log, round + 1, HUMAN)).toEqual([]);
  });

  it("R-11.2, R-18.1: gekaufte Karten erscheinen in der Übersicht und sind als neu markiert", () => {
    const { view, round } = afterBuyRound();
    const fresh = new Set(boughtInRound(view.log, round, HUMAN).map((b) => b.cardInstanceId));
    const overview = ownCardOverview(data, view, fresh);
    const all = overview.flatMap((z) => z.cards);
    const silver = all.filter((c) => c.cardId === "silver");
    const rune = all.filter((c) => c.cardId === "rune_shield");
    expect(silver.reduce((n, c) => n + c.newCount, 0)).toBe(1);
    expect(rune.reduce((n, c) => n + c.newCount, 0)).toBe(1);
    // Ohne Markierung keine „neu“-Angabe.
    expect(ownCardOverview(data, view).every((z) => z.cards.every((c) => c.newCount === 0))).toBe(true);
  });

  it("R-18.1, R-18.2a: die Übersicht deckt genau Hand, Ausgespielt, Deck und Ablage ab, mit Kartennamen", () => {
    const { view } = afterBuyRound();
    const own = ownEntry(view);
    const overview = ownCardOverview(data, view);
    expect(overview.map((z) => z.zone)).toEqual(["hand", "played", "deck", "discard"]);
    const totals = Object.fromEntries(overview.map((z) => [z.zone, z.total]));
    expect(totals).toEqual({ hand: own.hand.length, played: own.played.length, deck: own.deckContents.length, discard: own.discard.length });
    for (const zone of overview) {
      expect(zone.cards.reduce((n, c) => n + c.count, 0)).toBe(zone.total);
      for (const card of zone.cards) expect(card.name).toBe(data.cards.get(card.cardId)?.name);
    }
  });

  it("R-18.2a: das Deck erscheint ohne Reihenfolge – Umsortieren ändert die Übersicht nicht", () => {
    const { session, view } = afterBuyRound();
    const p = getPlayer(session.state, HUMAN);
    p.deck.reverse();
    expect(ownCardOverview(data, session.view())).toEqual(ownCardOverview(data, view));
  });

  it("R-11.2: Meldung nach der Runde nennt die gekauften Karten und wo sie jetzt liegen", () => {
    const { view, round } = afterBuyRound();
    const bought = boughtInRound(view.log, round, HUMAN);
    const zones = bought.map((b) => cardZoneOf(view, b.cardInstanceId));
    // Käufe landen im Deck: jede gekaufte Karte liegt bei den eigenen Karten.
    expect(zones.every((z) => z !== null)).toBe(true);
    const note = boughtNote(data, view, round);
    expect(note).toMatch(new RegExp(`^Neu gekauft in Runde ${round}: Silber \\(jetzt in (Hand|Deck|Ablage)\\), Schutzrune \\(jetzt in (Hand|Deck|Ablage)\\)\\.$`));
  });

  it("R-11.2: ohne Kauf keine Meldung", () => {
    const session = new GameSession(data, { seed: 3 });
    const round = session.view().round;
    expect(session.pass()).toEqual({ ok: true });
    expect(boughtNote(data, session.view(), round)).toBe("");
  });

  it("R-14.8: eine gekaufte, inzwischen entfernte Karte wird als nicht mehr vorhanden gemeldet", () => {
    const { session, round } = afterBuyRound();
    const view = session.view();
    const silver = boughtInRound(view.log, round, HUMAN)[0];
    if (!silver) throw new Error("Kauf fehlt");
    const p = getPlayer(session.state, HUMAN);
    for (const zone of [p.deck, p.discard, p.hand, p.played]) {
      const i = zone.indexOf(silver.cardInstanceId);
      if (i >= 0) zone.splice(i, 1);
    }
    expect(boughtNote(data, session.view(), round)).toContain("Silber (nicht mehr bei deinen Karten)");
  });

  it("C5b1: Texte der Übersicht", () => {
    expect(cardCountText({ cardId: "silver", name: "Silber", count: 2, newCount: 1 })).toBe("Silber ×2 (1 neu)");
    expect(cardCountText({ cardId: "fireball", name: "Feuerball", count: 1, newCount: 1 })).toBe("Feuerball (neu)");
    expect(cardCountText({ cardId: "coin", name: "Münze", count: 3, newCount: 0 })).toBe("Münze ×3");
    expect(zoneLine({ zone: "discard", total: 0, cards: [] })).toBe("Ablage (0): –");
    expect(
      zoneLine({ zone: "deck", total: 3, cards: [{ cardId: "coin", name: "Münze", count: 2, newCount: 0 }, { cardId: "silver", name: "Silber", count: 1, newCount: 1 }] }),
    ).toBe("Deck (3): Münze ×2, Silber (neu)");
  });
});
