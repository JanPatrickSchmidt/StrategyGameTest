import { describe, expect, it } from "vitest";
import type { Planning } from "../actions";
import { loadGameData } from "../data";
import { advance } from "../round";
import { createGame, defaultLeaders } from "../setup";
import { getPlayer, PLAYER_INDICES, type CardInstanceId, type GameState, type PlayerIndex, type Unit } from "../state";
import type { Bot } from "./bot";
import { ownCardPool } from "./candidates";
import { GreedyBot } from "./greedyBot";
import { RandomBot } from "./randomBot";

const data = loadGameData();

function newCard(state: GameState, player: PlayerIndex, cardId: string): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  return id;
}

/**
 * Planung der ersten Runde: Spieler 0 hat Läutern auf der Hand und im Deck mehr Flüche, als Läutern
 * entfernen kann (max 2), gemischt mit anderen Karten. Die übrigen Hände sind leer.
 */
function purifyState(seed: number): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    const player = getPlayer(state, p);
    (state.units[player.leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
    player.discard.push(...player.hand);
    player.hand = [];
  }
  const me = getPlayer(state, 0);
  me.hand.push(newCard(state, 0, "purify"));
  for (let i = 0; i < 4; i++) me.deck.push(newCard(state, 0, "curse"));
  me.deck.push(newCard(state, 0, "recruit"));
  return state;
}

/** Kopie des Zustands, in der nur die verdeckte Reihenfolge des Decks von Spieler 0 anders ist. */
function withReversedDeck(state: GameState): GameState {
  const copy = structuredClone(state);
  getPlayer(copy, 0).deck.reverse();
  return copy;
}

function plan(bot: Bot, state: GameState): Planning {
  return bot.plan(state, data, 0);
}

function purifyTargets(planning: Planning): CardInstanceId[][] {
  return [...planning.play, ...planning.buy, ...planning.position].flatMap((a) =>
    a.type === "setSpell" && a.target.kind === "ownCards" ? [a.target.cardInstanceIds] : [],
  );
}

describe("Bots und verdecktes Deck (P13, R-18.3)", () => {
  it("R-18.3: ownCardPool sortiert das Deck nach Instanz-ID, Ablagestapel bleibt in seiner Reihenfolge", () => {
    const state = purifyState(5);
    const me = getPlayer(state, 0);
    me.deck.reverse();
    const pool = ownCardPool(state, 0, ["deck", "discard"]);
    expect(pool.slice(0, me.deck.length)).toEqual([...me.deck].sort((a, b) => a - b));
    expect(pool.slice(me.deck.length)).toEqual(me.discard);
    expect(ownCardPool(withReversedDeck(state), 0, ["deck"])).toEqual(ownCardPool(state, 0, ["deck"]));
  });

  it("R-18.3: Umsortieren des eigenen Decks ändert die Planung des GreedyBots nicht", () => {
    for (const seed of [3, 11, 29]) {
      const state = purifyState(seed);
      const a = plan(new GreedyBot(seed), state);
      const b = plan(new GreedyBot(seed), withReversedDeck(state));
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      // Der Fall ist nicht trivial: Läutern wird gelegt und wählt 2 der 4 Flüche.
      const targets = purifyTargets(a);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveLength(2);
    }
  });

  it("R-18.3: Umsortieren des eigenen Decks ändert die Planung des RandomBots bei gleichem Bot-Seed nicht", () => {
    let withPurify = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = purifyState(seed);
      const a = plan(new RandomBot(seed), state);
      const b = plan(new RandomBot(seed), withReversedDeck(state));
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      if (purifyTargets(a).length > 0) withPurify++;
    }
    // Mindestens einige Planungen legen Läutern mit einer Auswahl aus dem Deck.
    expect(withPurify).toBeGreaterThan(0);
  });
});
