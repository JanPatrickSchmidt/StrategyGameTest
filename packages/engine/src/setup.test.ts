import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { createClassPool, createGame, createSupply, defaultLeaders, pileSizeOf, SetupError, startingDeckCardIds } from "./setup";
import { cloneState, getPlayer, getUnit, PLAYER_INDICES } from "./state";

const data = loadGameData();
const config = data.config;

function cardIdsOf(state: ReturnType<typeof createGame>, ids: number[]): string[] {
  return ids.map((id) => state.cards[id]?.cardId ?? "?");
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}

describe("R-4.1: Anführer-Zuteilung", () => {
  it("R-4.1: Standard – jeder Anführer genau einmal, Spieler p bekommt den p-ten Anführer", () => {
    const state = createGame(data);
    const leaders = state.players.map((p) => p.leader.leaderId);
    expect(leaders).toEqual(defaultLeaders(data));
    expect(new Set(leaders).size).toBe(4);
    expect(leaders.sort()).toEqual([...data.leaders.keys()].sort());
  });

  it("R-4.1: Anführer per Konfiguration frei wählbar", () => {
    const ids = [...data.leaders.keys()].reverse();
    const state = createGame(data, ids, 1);
    expect(state.players.map((p) => p.leader.leaderId)).toEqual(ids);
  });

  it("R-4.1/R-1.1: falsche Anzahl oder unbekannte Anführer werden abgelehnt", () => {
    const ids = defaultLeaders(data);
    expect(() => createGame(data, ids.slice(0, 3), 1)).toThrow(SetupError);
    expect(() => createGame(data, [...ids, ids[0] as string], 1)).toThrow(SetupError);
    expect(() => createGame(data, ["gibtsnicht", ...ids.slice(1)], 1)).toThrow(/Unbekannter Anführer/);
    expect(() => createGame(data, ids, 1.5)).toThrow(/Seed/);
  });
});

describe("R-4.2: Startdeck", () => {
  it("R-4.2: 6× Münze, 2× Rekrut, 2× Klassen-Starter der Anführer-Klasse", () => {
    const state = createGame(data, defaultLeaders(data), 7);
    for (const p of state.players) {
      const leaderClass = data.leaders.get(p.leader.leaderId)?.class;
      const starter = [...data.cards.values()].find((c) => c.type === "unit" && c.starterFor === leaderClass);
      expect(starter).toBeDefined();
      const counts = countBy(cardIdsOf(state, p.deck));
      expect(counts).toEqual({
        coin: config.startingDeck.coin,
        recruit: config.startingDeck.recruit,
        [starter?.id ?? "?"]: config.startingDeck.classStarter,
      });
      expect(p.hand).toEqual([]);
      expect(p.discard).toEqual([]);
    }
  });

  it("R-4.2: jede Klasse hat einen Starter, Zusammensetzung kommt aus config.startingDeck", () => {
    for (const cls of data.classes.keys()) {
      const ids = startingDeckCardIds(data, cls);
      const total = config.startingDeck.coin + config.startingDeck.recruit + config.startingDeck.classStarter;
      expect(ids).toHaveLength(total);
    }
    expect(() => startingDeckCardIds(data, "bard")).toThrow(SetupError);
  });

  it("R-1.2: jede Karteninstanz hat eine eigene ID und gehört ihrem Spieler", () => {
    const state = createGame(data);
    const all = state.players.flatMap((p) => p.deck);
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(state.cards)).toHaveLength(all.length);
    for (const p of state.players) {
      for (const id of p.deck) expect(state.cards[id]?.owner).toBe(p.index);
    }
  });

  it("R-4.2: Decks werden mit dem Partie-Zufall gemischt", () => {
    // Über mehrere Seeds muss mindestens ein Deck von der ungemischten Reihenfolge abweichen
    // und die Reihenfolge muss vom Seed abhängen.
    const orders = new Set<string>();
    let anyShuffled = false;
    for (let seed = 1; seed <= 10; seed++) {
      const state = createGame(data, defaultLeaders(data), seed);
      const p0 = getPlayer(state, 0);
      const ordered = [...p0.deck].sort((a, b) => a - b);
      const order = cardIdsOf(state, p0.deck).join(",");
      orders.add(order);
      if (p0.deck.join() !== ordered.join()) anyShuffled = true;
    }
    expect(anyShuffled).toBe(true);
    expect(orders.size).toBeGreaterThan(1);
    const shuffleEvents = createGame(data).log.filter((e) => e.type === "deck_shuffled");
    expect(shuffleEvents.map((e) => (e.type === "deck_shuffled" ? e.player : -1))).toEqual([0, 1, 2, 3]);
  });
});

describe("R-4.3: Startwerte", () => {
  it("R-4.3: Leben 30, Machtpunkte 0, Schatzkammer 0, Anführer-XP 0, Anführer-Stufe 1", () => {
    const state = createGame(data);
    expect(state.players).toHaveLength(4);
    for (const p of state.players) {
      expect(p.life).toBe(config.startingLife);
      expect(p.life).toBe(30);
      expect(p.power).toBe(0);
      expect(p.treasury).toBe(0);
      expect(p.roundGold).toBe(0);
      expect(p.leader.xp).toBe(0);
      expect(p.leader.level).toBe(1);
      expect(p.leader.branchId).toBeNull();
      expect(p.eliminated).toBe(false);
      expect(p.nextRound).toEqual({ gold: 0, cards: 0 });
      expect([p.winStreak, p.lossStreak, p.centerStreak]).toEqual([0, 0, 0]);
    }
    expect(state.round).toBe(1);
    expect(state.phase).toBe("roundStart");
  });
});

describe("R-4.4: Anführer-Startposition", () => {
  it("R-4.4: Anführer steht als Einheit in Zone left auf Feld (2, 1)", () => {
    const state = createGame(data);
    for (const p of state.players) {
      const unit = getUnit(state, p.leader.unitId);
      expect(unit.kind).toBe("leader");
      expect(unit.owner).toBe(p.index);
      expect(unit.sourceId).toBe(p.leader.leaderId);
      expect(unit.location).toEqual({ zone: "left", cell: { col: 2, row: 1 } });
      expect(unit.wounded).toBe(false);
      expect(unit.cardInstanceIds).toEqual([]);
    }
    expect(Object.keys(state.units)).toHaveLength(4);
    const placed = state.log.filter((e) => e.type === "unit_placed");
    expect(placed).toHaveLength(4);
  });
});

describe("R-4.5: Königreich und Klassen-Pools", () => {
  it("R-4.5: alle Basisstapel und alle 16 Königreich-Karten mit Stapelgrößen laut Daten", () => {
    const state = createGame(data);
    const basic = [...data.cards.values()].filter((c) => c.pool === "basic");
    const kingdom = [...data.cards.values()].filter((c) => c.pool === "kingdom");
    expect(kingdom).toHaveLength(16);
    expect(Object.keys(state.supply).sort()).toEqual([...basic, ...kingdom].map((c) => c.id).sort());
    for (const card of [...basic, ...kingdom]) {
      expect(state.supply[card.id]).toBe(pileSizeOf(card, config));
    }
    // Explizite Stapelgrößen aus den Daten.
    expect(state.supply.silver).toBe(20);
    expect(state.supply.curse).toBe(16);
    // Starter und Tokens liegen nicht im Königreich.
    expect(state.supply.coin).toBeUndefined();
    expect(state.supply.recruit).toBeUndefined();
    expect(state.supply.goblin_token).toBeUndefined();
  });

  it("R-4.5: Stapelgröße ohne pileSize nach config.pileSizeByCost", () => {
    const supply = createSupply(data);
    for (const card of data.cards.values()) {
      if (card.pool !== "kingdom" || card.pileSize !== undefined) continue;
      const rule = config.pileSizeByCost.find((r) => card.cost <= r.maxCost);
      expect(supply[card.id]).toBe(rule?.copies);
    }
  });

  it("R-4.5: jeder Spieler hat eigene Stapel für die 3 Karten seines Klassen-Pools", () => {
    const state = createGame(data);
    for (const p of state.players) {
      const cls = data.leaders.get(p.leader.leaderId)?.class ?? "?";
      const expected = [...data.cards.values()].filter((c) => c.pool === `class:${cls}`);
      expect(expected).toHaveLength(3);
      expect(Object.keys(p.classPool).sort()).toEqual(expected.map((c) => c.id).sort());
      for (const card of expected) expect(p.classPool[card.id]).toBe(pileSizeOf(card, config));
    }
    // Eigene Stapel: gleiche Klasse bei zwei Spielern ergibt getrennte Objekte.
    const brann = defaultLeaders(data)[0] as string;
    const same = createGame(data, [brann, brann, brann, brann], 3);
    const pool0 = getPlayer(same, 0).classPool;
    const pool1 = getPlayer(same, 1).classPool;
    expect(pool0).toEqual(pool1);
    expect(pool0).not.toBe(pool1);
    expect(createClassPool(data, "bard")).toEqual({});
  });
});

describe("R-1.8: Determinismus des Aufbaus", () => {
  it("R-1.8: gleicher Seed ergibt identischen Zustand und identisches Protokoll", () => {
    const a = createGame(data, defaultLeaders(data), 42);
    const b = createGame(data, defaultLeaders(data), 42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("R-1.8: anderer Seed ergibt andere Deckreihenfolgen", () => {
    const a = createGame(data, defaultLeaders(data), 1);
    const b = createGame(data, defaultLeaders(data), 2);
    const decks = (s: typeof a) => PLAYER_INDICES.map((i) => getPlayer(s, i).deck.join(",")).join("|");
    expect(decks(a)).not.toBe(decks(b));
  });

  it("cloneState erzeugt eine unabhängige, gleichwertige Kopie", () => {
    const a = createGame(data, defaultLeaders(data), 5);
    const b = cloneState(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    getPlayer(b, 0).deck.pop();
    expect(getPlayer(a, 0).deck).toHaveLength(10);
  });
});
