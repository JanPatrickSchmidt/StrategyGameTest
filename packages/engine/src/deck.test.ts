import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { drawCards, drawForRound, roundDrawCount } from "./deck";
import { createGame, defaultLeaders } from "./setup";
import { getPlayer } from "./state";

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
