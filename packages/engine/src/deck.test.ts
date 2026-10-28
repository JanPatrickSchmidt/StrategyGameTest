import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { checkOwnCardsChoice, drawCards, drawForRound, ownDeckContents, roundDrawCount, trashCards } from "./deck";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer } from "./state";

const data = loadGameData();
const config = data.config;
const newGame = (seed = 11) => createGame(data, defaultLeaders(data), seed);

describe("R-6.3: Ziehen", () => {
  it("R-6.3: zu Rundenbeginn zieht jeder Spieler 5 Karten von oben vom Deck", () => {
    const state = newGame();
    const tops = state.players.map((p) => p.deck.slice(0, config.handSize));
    drawForRound(state, config);
    for (const p of state.players) {
      expect(p.hand).toEqual(tops[p.index]);
      expect(p.hand).toHaveLength(5);
      expect(p.deck).toHaveLength(10 - 5);
    }
  });

  it("R-6.3: fällige Mitte-Belohnung „Karte“ gibt +1 Karte und wird verbraucht", () => {
    const state = newGame();
    getPlayer(state, 2).nextRound.cards = 1;
    drawForRound(state, config);
    expect(getPlayer(state, 2).hand).toHaveLength(6);
    expect(getPlayer(state, 2).nextRound.cards).toBe(0);
    expect(getPlayer(state, 1).hand).toHaveLength(5);
    expect(roundDrawCount(config, 1)).toBe(config.handSize + 1);
  });

  it("R-6.3: ist das Deck leer, wird der Ablagestapel gemischt und wird zum Deck", () => {
    const state = newGame();
    const p = getPlayer(state, 0);
    // 8 Karten ablegen, 2 im Deck lassen.
    p.discard = p.deck.splice(2);
    const remaining = [...p.deck];
    const discarded = [...p.discard];
    const drawn = drawCards(state, 0, 5);
    expect(drawn).toHaveLength(5);
    // Zuerst die verbliebenen Deckkarten, dann Karten aus dem gemischten Ablagestapel.
    expect(drawn.slice(0, 2)).toEqual(remaining);
    for (const id of drawn.slice(2)) expect(discarded).toContain(id);
    expect(p.discard).toEqual([]);
    expect(p.deck).toHaveLength(5);
    expect([...p.deck, ...drawn.slice(2)].sort((a, b) => a - b)).toEqual([...discarded].sort((a, b) => a - b));
    const reshuffles = state.log.filter((e) => e.type === "discard_reshuffled");
    expect(reshuffles).toEqual([expect.objectContaining({ player: 0, size: 8 })]);
  });

  it("R-6.3: das Nachmischen nutzt den Partie-Zufall (Reihenfolge hängt vom Seed ab)", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const state = newGame(seed);
      const p = getPlayer(state, 0);
      p.discard = [...p.deck].sort((a, b) => a - b);
      p.deck = [];
      drawCards(state, 0, 10);
      orders.add(p.hand.join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("R-6.3: sind Deck und Ablagestapel leer, wird nicht weiter gezogen", () => {
    const state = newGame();
    const p = getPlayer(state, 1);
    p.discard = p.deck.splice(7); // 7 im Deck, 3 im Ablagestapel
    const drawn = drawCards(state, 1, 12);
    expect(drawn).toHaveLength(10);
    expect(p.hand).toHaveLength(10);
    expect(p.deck).toEqual([]);
    expect(p.discard).toEqual([]);
    expect(drawCards(state, 1, 5)).toEqual([]);
    const stopped = state.log.filter((e) => e.type === "draw_stopped");
    expect(stopped).toEqual([
      expect.objectContaining({ player: 1, missing: 2 }),
      expect.objectContaining({ player: 1, missing: 5 }),
    ]);
  });

  it("R-6.3: leerer Ablagestapel bei leerem Deck löst kein Nachmischen aus", () => {
    const state = newGame();
    drawCards(state, 3, 10);
    drawCards(state, 3, 1);
    expect(state.log.some((e) => e.type === "discard_reshuffled")).toBe(false);
  });

  it("R-6.3: ausgeschiedene Spieler ziehen nicht", () => {
    const state = newGame();
    getPlayer(state, 3).eliminated = true;
    drawForRound(state, config);
    expect(getPlayer(state, 3).hand).toEqual([]);
    expect(getPlayer(state, 0).hand).toHaveLength(5);
  });

  it("R-6.3/R-19.3: gezogene Karten sind ein privates Ereignis, die Anzahl ist öffentlich", () => {
    const state = newGame();
    drawCards(state, 2, 3);
    const priv = state.log.filter((e) => e.type === "cards_drawn");
    const pub = state.log.filter((e) => e.type === "cards_drawn_count");
    expect(priv).toEqual([expect.objectContaining({ player: 2, visibleTo: [2], cardInstanceIds: getPlayer(state, 2).hand })]);
    expect(pub).toEqual([expect.objectContaining({ player: 2, count: 3 })]);
    expect(pub[0]?.visibleTo).toBeUndefined();
  });

  it("R-6.3: ungültige Anzahl wird abgelehnt", () => {
    const state = newGame();
    expect(() => drawCards(state, 0, -1)).toThrow(RangeError);
    expect(() => drawCards(state, 0, 1.5)).toThrow(RangeError);
    expect(drawCards(state, 0, 0)).toEqual([]);
  });

  it("R-1.8: gleicher Seed und gleiche Ziehfolge ergeben identisches Protokoll", () => {
    const run = () => {
      const s = newGame(99);
      for (let i = 0; i < 4; i++) {
        drawForRound(s, config);
        for (const p of s.players) p.discard.push(...p.hand.splice(0));
      }
      return JSON.stringify(s.log);
    };
    expect(run()).toBe(run());
  });
});

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("R-14.8: Läutern", () => {
  const purifyTarget = () => {
    const card = data.cards.get("purify");
    if (card?.type !== "spell" || card.target.kind !== "ownCards") throw new Error("purify muss ownCards wählen");
    return card.target;
  };

  it("R-14.8: Läutern wählt bis zu 2 eigene Karten aus Deck oder Ablagestapel (Daten)", () => {
    expect(purifyTarget()).toEqual({ kind: "ownCards", max: 2, from: ["deck", "discard"] });
    const card = data.cards.get("purify");
    expect(card?.type === "spell" ? card.effects : []).toEqual([{ op: "trash", from: "chosenOwnCards" }]);
  });

  it("R-14.8: Wahl aus Deck und Ablagestapel gültig, Hand, ausgespielte und fremde Karten nicht", () => {
    const state = newGame();
    drawCards(state, 0, 5);
    const p = getPlayer(state, 0);
    const [d1, d2] = p.deck as [number, number];
    const handCard = p.hand[0] as number;
    p.discard.push(p.hand.pop() as number);
    const discardCard = p.discard[0] as number;
    p.played.push(p.hand.pop() as number);
    const playedCard = p.played[0] as number;
    const foreign = getPlayer(state, 1).deck[0] as number;
    const spec = purifyTarget();
    expect(checkOwnCardsChoice(state, 0, spec, [])).toBeNull();
    expect(checkOwnCardsChoice(state, 0, spec, [d1])).toBeNull();
    expect(checkOwnCardsChoice(state, 0, spec, [d1, discardCard])).toBeNull();
    expect(checkOwnCardsChoice(state, 0, spec, [d1, d2, discardCard])).toBe("tooManyCards");
    expect(checkOwnCardsChoice(state, 0, spec, [handCard])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, [playedCard])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, [foreign])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, [d1, d1])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, [9999])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, ["1"])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, spec, "1")).toBe("malformed");
    // Nur Ablagestapel erlaubt → Deckkarte abgelehnt.
    expect(checkOwnCardsChoice(state, 0, { max: 2, from: ["discard"] }, [d1])).toBe("invalidCardChoice");
    expect(checkOwnCardsChoice(state, 0, { max: 2, from: ["discard"] }, [discardCard])).toBeNull();
  });

  it("R-14.8: Entfernen ändert die Reihenfolge der übrigen Deckkarten nicht und mischt nicht", () => {
    const state = newGame();
    const p = getPlayer(state, 0);
    const deckBefore = [...p.deck];
    const [, second, , fourth] = deckBefore as [number, number, number, number];
    p.discard.push(p.deck.pop() as number);
    const discardCard = p.discard[0] as number;
    const logBefore = state.log.length;
    expect(trashCards(state, 0, [fourth, discardCard, second])).toEqual([fourth, discardCard, second]);
    expect(p.deck).toEqual(deckBefore.slice(0, -1).filter((id) => id !== second && id !== fourth));
    expect(p.discard).toEqual([]);
    const newEvents = state.log.slice(logBefore);
    expect(newEvents.some((e) => e.type === "deck_shuffled" || e.type === "discard_reshuffled")).toBe(false);
    expect(eventsOf(state, "cards_trashed")).toEqual([
      expect.objectContaining({
        player: 0,
        cards: [
          expect.objectContaining({ cardInstanceId: fourth, from: "deck" }),
          expect.objectContaining({ cardInstanceId: discardCard, from: "discard" }),
          expect.objectContaining({ cardInstanceId: second, from: "deck" }),
        ],
      }),
    ]);
  });

  it("R-14.8: nicht mehr vorhandene Karten werden übersprungen, ohne Ereignis wenn nichts entfernt wird", () => {
    const state = newGame();
    drawCards(state, 0, 1);
    const p = getPlayer(state, 0);
    const drawn = p.hand[0] as number;
    expect(trashCards(state, 0, [drawn])).toEqual([]);
    expect(p.hand).toEqual([drawn]);
    expect(eventsOf(state, "cards_trashed")).toEqual([]);
  });
});

describe("R-18.2a: Sicht auf das eigene Deck", () => {
  it("R-18.2a: Inhalt des eigenen Decks vollständig, aber unabhängig von der Reihenfolge", () => {
    const a = newGame(1);
    const b = newGame(2);
    const p = getPlayer(a, 0);
    const contents = ownDeckContents(a, 0);
    expect(contents.map((c) => c.cardInstanceId).sort((x, y) => x - y)).toEqual([...p.deck].sort((x, y) => x - y));
    for (const c of contents) expect(a.cards[c.cardInstanceId]?.cardId).toBe(c.cardId);
    // Gleiche Karten, andere Mischung → gleiche Sicht.
    expect(p.deck).not.toEqual(getPlayer(b, 0).deck);
    expect(ownDeckContents(b, 0)).toEqual(contents);
    // Umsortieren des Decks ändert die Sicht nicht.
    p.deck.reverse();
    expect(ownDeckContents(a, 0)).toEqual(contents);
  });
});
