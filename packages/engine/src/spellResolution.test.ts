import { describe, expect, it } from "vitest";
import type { ActionTarget, Planning } from "./actions";
import { loadGameData } from "./data";
import { advance, submitPlanning } from "./round";
import { neighborsOf } from "./seating";
import { createGame, defaultLeaders } from "./setup";
import { resolvePostCombatSpells, spellResolutionOrder } from "./spells";
import { type CardInstanceId, cloneState, type FrontResult, type GameEvent, type GameState, getPlayer, type PlayerIndex } from "./state";

const data = loadGameData();
const EMPTY: Planning = { play: [], buy: [], position: [] };
const NONE: ActionTarget = { kind: "none" };

function inPlanning(seed = 31): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  return state;
}

function newCard(state: GameState, player: PlayerIndex, cardId: string): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  return id;
}

/** Legt einen Nachkampf-Zauber direkt in den Slot (wie nach `setSpell`, ohne Planung). */
function setPost(state: GameState, player: PlayerIndex, cardId: string, target: ActionTarget = NONE): CardInstanceId {
  const id = newCard(state, player, cardId);
  getPlayer(state, player).spells.post.push({ cardInstanceId: id, cardId, target });
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function wonFront(state: GameState, winner: PlayerIndex, loser: PlayerIndex, round = state.round): FrontResult {
  return {
    round,
    arena: `front:${winner}-${loser}`,
    first: winner,
    second: loser,
    outcome: "emptyFront",
    winner,
    ticks: 0,
    participants: [],
    survivors: [],
    winnerBreakthrough: 0,
    wounded: [],
  };
}

/** Reihenfolge der Spieler, deren Zauber aufgelöst wurden oder verpufft sind. */
function resolutionPlayers(state: GameState, from: number): PlayerIndex[] {
  return state.log
    .slice(from)
    .filter((e) => e.type === "spell_resolved" || e.type === "spell_fizzled")
    .map((e) => (e as Extract<GameEvent, { type: "spell_resolved" }>).player);
}

describe("R-8.4: Nachkampf-Zauber nach Tempo und Prioritätsreihenfolge", () => {
  function fourSpells(state: GameState): void {
    setPost(state, 0, "purify", { kind: "ownCards", cardInstanceIds: [] }); // Tempo 1
    const n1 = neighborsOf(state, 1);
    setPost(state, 1, "burden", { kind: "player", player: n1?.left ?? 0 }); // Tempo 2
    setPost(state, 2, "spark_forge"); // Tempo 1
    setPost(state, 3, "purify", { kind: "ownCards", cardInstanceIds: [] }); // Tempo 1
  }

  it("R-8.4: Tempo 1 vor Tempo 2, bei gleichem Tempo Prioritätsreihenfolge (Runde 1: 0, 1, 2, 3)", () => {
    const state = inPlanning();
    fourSpells(state);
    expect(spellResolutionOrder(state, data, "post").map((q) => q.player)).toEqual([0, 2, 3, 1]);
    const from = state.log.length;
    resolvePostCombatSpells(state, data);
    expect(resolutionPlayers(state, from)).toEqual([0, 2, 3, 1]);
  });

  it("R-8.4: in Runde 2 beginnt die Prioritätsreihenfolge bei Spieler 1 (R-1.7)", () => {
    const state = inPlanning();
    state.round = 2;
    fourSpells(state);
    const from = state.log.length;
    resolvePostCombatSpells(state, data);
    expect(resolutionPlayers(state, from)).toEqual([2, 3, 0, 1]);
  });

  it("R-8.4: ausgeschiedene Spieler zaubern nicht", () => {
    const state = inPlanning();
    fourSpells(state);
    getPlayer(state, 2).eliminated = true;
    expect(spellResolutionOrder(state, data, "post").map((q) => q.player)).toEqual([0, 3, 1]);
  });
});

describe("R-8.6: aufgelöste Zauber gehen auf den Ablagestapel", () => {
  it("R-8.6: jeder Zauber geht direkt nach seiner Auflösung auf den Ablagestapel, der Slot ist danach leer", () => {
    const state = inPlanning();
    const a = setPost(state, 0, "spark_forge");
    const b = setPost(state, 1, "spark_forge");
    const from = state.log.length;
    resolvePostCombatSpells(state, data);
    const types = state.log
      .slice(from)
      .filter((e) => ["spell_resolved", "spell_discarded", "spell_fizzled"].includes(e.type))
      .map((e) => `${e.type}:${(e as Extract<GameEvent, { type: "spell_discarded" }>).cardInstanceId}`);
    expect(types).toEqual([`spell_resolved:${a}`, `spell_discarded:${a}`, `spell_resolved:${b}`, `spell_discarded:${b}`]);
    expect(getPlayer(state, 0).spells.post).toEqual([]);
    expect(getPlayer(state, 0).discard).toContain(a);
    expect(getPlayer(state, 1).discard).toContain(b);
  });

  it("R-8.6: auch ein verpuffter Zauber geht auf den Ablagestapel (R-8.5: Kosten bleiben bezahlt)", () => {
    const state = inPlanning();
    const spoils = setPost(state, 0, "war_spoils");
    resolvePostCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 0, cardInstanceId: spoils, reason: "conditionNotMet" })]);
    expect(getPlayer(state, 0).discard).toContain(spoils);
    expect(getPlayer(state, 0).spells.post).toEqual([]);
  });

  it("R-8.4: im Rundenablauf wird ein gelegter Nachkampf-Zauber genau einmal aufgelöst und abgelegt", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    const forge = newCard(state, 0, "spark_forge");
    p.hand.push(forge);
    const planning: Planning = { play: [{ type: "setSpell", cardInstanceId: forge, slot: "post", target: NONE }], buy: [], position: [] };
    expect(submitPlanning(state, 0, planning)).toEqual({ ok: true });
    for (const other of [1, 2, 3] as const) submitPlanning(state, other, EMPTY);
    const from = state.log.length;
    advance(state, data);
    const resolved = eventsOf(state, "spell_resolved", from);
    expect(resolved).toEqual([expect.objectContaining({ player: 0, cardInstanceId: forge, slot: "post", tempo: 1, phase: "postCombatSpells" })]);
    expect(eventsOf(state, "spell_discarded", from).filter((e) => e.cardInstanceId === forge)).toHaveLength(1);
    expect(getPlayer(state, 0).roundMarks).toEqual([
      { kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" },
    ]);
  });
});

describe("E11a: Zauber ohne Kampfbezug", () => {
  it("R-14.8: Läutern entfernt die gewählten Karten aus Deck und Ablagestapel, inzwischen gezogene werden übersprungen", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    const [d0, d1] = p.deck as [CardInstanceId, CardInstanceId];
    const inDiscard = newCard(state, 0, "coin");
    p.discard.push(inDiscard);
    const restDeck = p.deck.filter((id) => id !== d0);
    setPost(state, 0, "purify", { kind: "ownCards", cardInstanceIds: [d0, inDiscard] });
    resolvePostCombatSpells(state, data);
    expect(p.deck).toEqual(restDeck);
    expect(p.discard).not.toContain(inDiscard);
    expect(eventsOf(state, "cards_trashed")).toEqual([expect.objectContaining({ player: 0, cards: [expect.objectContaining({ cardInstanceId: d0, from: "deck" }), expect.objectContaining({ cardInstanceId: inDiscard, from: "discard" })] })]);

    // Karte inzwischen auf der Hand: wird übersprungen.
    p.deck = p.deck.filter((id) => id !== d1);
    p.hand.push(d1);
    setPost(state, 0, "purify", { kind: "ownCards", cardInstanceIds: [d1] });
    const from = state.log.length;
    resolvePostCombatSpells(state, data);
    expect(p.hand).toContain(d1);
    expect(eventsOf(state, "cards_trashed", from)).toEqual([]);
    expect(eventsOf(state, "spell_resolved", from)).toHaveLength(1);
  });

  it("R-10.3: Kriegsbeute gibt nach einer gewonnenen Front 3 Gold in die Schatzkammer", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.treasury = 4;
    p.roundGold = 2;
    state.frontResults = [wonFront(state, 0, 1)];
    setPost(state, 0, "war_spoils");
    resolvePostCombatSpells(state, data);
    expect([p.treasury, p.roundGold]).toEqual([7, 2]);
    expect(eventsOf(state, "spell_fizzled")).toEqual([]);
  });

  it("R-8.5: Kriegsbeute verpufft ohne gewonnene Front dieser Runde (Sieg der Vorrunde zählt nicht)", () => {
    const state = inPlanning();
    state.round = 2;
    const p = getPlayer(state, 0);
    p.treasury = 4;
    state.frontResults = [wonFront(state, 1, 0), wonFront(state, 0, 3, 1)];
    setPost(state, 0, "war_spoils");
    resolvePostCombatSpells(state, data);
    expect(p.treasury).toBe(4);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 0, cardId: "war_spoils", reason: "conditionNotMet" })]);
    expect(eventsOf(state, "spell_resolved")).toEqual([]);
  });

  it("R-14.7: Bürde legt einen Fluch auf den Ablagestapel des gewählten Nachbarn", () => {
    const state = inPlanning();
    const target = neighborsOf(state, 0)?.right as PlayerIndex;
    const before = state.supply.curse ?? 0;
    setPost(state, 0, "burden", { kind: "player", player: target });
    resolvePostCombatSpells(state, data);
    const curses = eventsOf(state, "curse_given");
    expect(curses).toEqual([expect.objectContaining({ player: 0, to: target, sourceUnitId: null })]);
    const curseId = curses[0]?.cardInstanceId as CardInstanceId;
    expect(getPlayer(state, target).discard).toContain(curseId);
    expect(state.supply.curse).toBe(before - 1);
  });

  it("R-14.7: Bürde bei leerem Fluch-Stapel wird aufgelöst, bewirkt aber nichts", () => {
    const state = inPlanning();
    const target = neighborsOf(state, 0)?.right as PlayerIndex;
    state.supply.curse = 0;
    const discardBefore = [...getPlayer(state, target).discard];
    setPost(state, 0, "burden", { kind: "player", player: target });
    resolvePostCombatSpells(state, data);
    expect(eventsOf(state, "spell_resolved")).toHaveLength(1);
    expect(eventsOf(state, "curse_given")).toEqual([]);
    expect(getPlayer(state, target).discard).toEqual(discardBefore);
  });

  it("R-8.5: Bürde verpufft, wenn der Ziel-Spieler inzwischen ausgeschieden ist", () => {
    const state = inPlanning();
    const target = neighborsOf(state, 0)?.right as PlayerIndex;
    getPlayer(state, target).eliminated = true;
    setPost(state, 0, "burden", { kind: "player", player: target });
    resolvePostCombatSpells(state, data);
    expect(eventsOf(state, "spell_fizzled")).toEqual([expect.objectContaining({ player: 0, reason: "noValidTarget" })]);
    expect(eventsOf(state, "curse_given")).toEqual([]);
  });

  it("R-17a.2: Funkenschmiede setzt eine Start-Mana-Markierung für die nächste Runde", () => {
    const state = inPlanning();
    setPost(state, 1, "spark_forge");
    resolvePostCombatSpells(state, data);
    expect(getPlayer(state, 1).roundMarks).toEqual([
      { kind: "startMana", round: 2, percent: 50, target: "ownClassUnits", classId: "mage" },
    ]);
    expect(eventsOf(state, "round_mark_set")).toHaveLength(1);
  });

  it("Determinismus: gleiche Zauber, gleicher Zustand = gleiches Protokoll", () => {
    const a = inPlanning(77);
    setPost(a, 0, "purify", { kind: "ownCards", cardInstanceIds: [a.players[0]?.deck[0] as number] });
    setPost(a, 1, "burden", { kind: "player", player: neighborsOf(a, 1)?.left as PlayerIndex });
    setPost(a, 2, "spark_forge");
    const b = cloneState(a);
    resolvePostCombatSpells(a, data);
    resolvePostCombatSpells(b, data);
    expect(b.log).toEqual(a.log);
  });
});
