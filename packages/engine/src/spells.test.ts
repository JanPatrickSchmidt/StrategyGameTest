import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, Planning } from "./actions";
import { loadGameData } from "./data";
import { activePlayersInPriority, advance, submitPlanning } from "./round";
import { neighborsOf } from "./seating";
import { createGame, defaultLeaders } from "./setup";
import { setSpell } from "./spells";
import { isOwnHex, unitArenaHex } from "./targets";
import { type CardInstanceId, type GameEvent, type GameState, getPlayer, type PlayerIndex, type Unit, type UnitLocation } from "./state";

const data = loadGameData();
const config = data.config;
const EMPTY: Planning = { play: [], buy: [], position: [] };

function inPlanning(seed = 21): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  return state;
}

function addToHand(state: GameState, player: PlayerIndex, cardIds: string[]): CardInstanceId[] {
  return cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: player };
    getPlayer(state, player).hand.push(id);
    return id;
  });
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const hex = (arena: ArenaHex["arena"], col: number, row: number): ActionTarget => ({ kind: "hex", arena, cell: { col, row } });

function rich(state: GameState, player: PlayerIndex, roundGold = 10, treasury = 10): void {
  const p = getPlayer(state, player);
  p.roundGold = roundGold;
  p.treasury = treasury;
}

describe("R-7.3: Zauber legen", () => {
  it("R-7.3: Karte verlässt die Hand, liegt im Slot, Kosten sofort bezahlt (erst Rundenvorrat, dann Schatzkammer)", () => {
    const state = inPlanning();
    rich(state, 0, 1, 5);
    const [fireball] = addToHand(state, 0, ["fireball"]);
    expect(setSpell(state, data, 0, fireball, "pre", hex("right", 2, 4))).toBeNull();
    const p = getPlayer(state, 0);
    expect(p.hand).not.toContain(fireball);
    expect(p.spells.pre).toEqual([
      { cardInstanceId: fireball, cardId: "fireball", target: { kind: "hexes", hexes: [{ arena: "right", cell: { col: 2, row: 4 } }] } },
    ]);
    expect([p.roundGold, p.treasury]).toEqual([0, 2]);
    expect(eventsOf(state, "spell_set")).toEqual([
      expect.objectContaining({ player: 0, cardInstanceId: fireball, slot: "pre", paidFromRoundGold: 1, paidFromTreasury: 3 }),
    ]);
  });

  it("R-7.3: Karte nicht auf der Hand, keine Zauberkarte oder falscher Slot wird abgelehnt", () => {
    const state = inPlanning();
    rich(state, 0);
    const [fireball, recruit] = addToHand(state, 0, ["fireball", "recruit"]);
    expect(setSpell(state, data, 0, 9999, "pre", hex("right", 2, 4))).toBe("cardNotInHand");
    expect(setSpell(state, data, 0, recruit, "pre", hex("right", 2, 4))).toBe("notASpellCard");
    expect(setSpell(state, data, 0, fireball, "post", hex("right", 2, 4))).toBe("wrongSlot");
    expect(setSpell(state, data, 0, fireball, "middle", hex("right", 2, 4))).toBe("malformed");
    expect(getPlayer(state, 0).hand).toContain(fireball);
  });

  it("R-7.3: je Slot höchstens ein Zauber (config.spellSlots)", () => {
    const state = inPlanning();
    rich(state, 0);
    expect(config.spellSlots).toEqual({ pre: 1, post: 1 });
    const [a, b, c] = addToHand(state, 0, ["fireball", "rune_shield", "war_spoils"]);
    expect(setSpell(state, data, 0, a, "pre", hex("right", 2, 4))).toBeNull();
    expect(setSpell(state, data, 0, b, "pre", hex("right", 2, 1))).toBe("slotFull");
    expect(setSpell(state, data, 0, c, "post", { kind: "none" })).toBeNull();
    expect(getPlayer(state, 0).hand).toContain(b);
  });

  it("R-7.3: fehlendes Gold oder ungültiges Ziel ändert nichts", () => {
    const state = inPlanning();
    rich(state, 0, 1, 2);
    const [fireball] = addToHand(state, 0, ["fireball"]);
    expect(setSpell(state, data, 0, fireball, "pre", hex("right", 2, 4))).toBe("notEnoughGold");
    rich(state, 0);
    expect(setSpell(state, data, 0, fireball, "pre", hex("right", 9, 9))).toBe("invalidTarget");
    const p = getPlayer(state, 0);
    expect([p.roundGold, p.treasury]).toEqual([10, 10]);
    expect(p.hand).toContain(fireball);
    expect(p.spells.pre).toEqual([]);
  });
});

describe("R-14.2: Feldziel von Zaubern", () => {
  it("R-14.2: `participating` erlaubt jedes Feld der eigenen Fronten und der Mitte, auch in der gegnerischen Hälfte", () => {
    for (const target of [hex("right", 0, 5), hex("left", 4, 0), hex("center", 3, 3), hex("center", 6, 3)]) {
      const state = inPlanning();
      rich(state, 0);
      const [fireball] = addToHand(state, 0, ["fireball"]);
      expect(setSpell(state, data, 0, fireball, "pre", target)).toBeNull();
    }
  });

  it("R-14.2: `own` erlaubt nur eigene Felder: rechte Front Zeilen 0–2, linke Front Zeilen 3–5, eigener Startbereich der Mitte", () => {
    const allowed = [hex("right", 0, 0), hex("right", 4, 2), hex("left", 0, 3), hex("left", 4, 5), hex("center", 1, 0), hex("center", 5, 0)];
    const denied = [hex("right", 2, 3), hex("left", 2, 2), hex("center", 3, 3), hex("center", 0, 0), hex("center", 6, 1)];
    for (const [target, ok] of [...allowed.map((t) => [t, true] as const), ...denied.map((t) => [t, false] as const)]) {
      const state = inPlanning();
      rich(state, 0);
      const [shield] = addToHand(state, 0, ["rune_shield"]);
      expect(setSpell(state, data, 0, shield, "pre", target)).toBe(ok ? null : "invalidTarget");
    }
  });

  it("R-14.2: Zielart muss zur Karte passen; ein Feldzauber hat genau ein Feld", () => {
    const state = inPlanning();
    rich(state, 0);
    const [fireball] = addToHand(state, 0, ["fireball"]);
    expect(setSpell(state, data, 0, fireball, "pre", { kind: "none" })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, fireball, "pre", { kind: "zone", arenas: ["left"] })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, fireball, "pre", { kind: "hexes", hexes: [] })).toBe("invalidTarget");
    const two: ActionTarget = { kind: "hexes", hexes: [{ arena: "right", cell: { col: 1, row: 4 } }, { arena: "right", cell: { col: 2, row: 4 } }] };
    expect(setSpell(state, data, 0, fireball, "pre", two)).toBe("tooManyTargets");
    expect(setSpell(state, data, 0, fireball, "pre", { kind: "hex", arena: "north", cell: { col: 0, row: 0 } } as unknown as ActionTarget)).toBe("invalidTarget");
    expect(setSpell(state, data, 0, fireball, "pre", null)).toBe("malformed");
  });

  it("R-14.2: Zonenzauber wählt genau eine eigene Zone", () => {
    const state = inPlanning();
    rich(state, 0);
    const [a, b] = addToHand(state, 0, ["war_cry", "war_cry"]);
    expect(setSpell(state, data, 0, a, "pre", { kind: "zone", arenas: ["left", "right"] })).toBe("tooManyTargets");
    expect(setSpell(state, data, 0, a, "pre", { kind: "zone", arenas: ["top"] } as unknown as ActionTarget)).toBe("invalidTarget");
    expect(setSpell(state, data, 0, a, "pre", { kind: "zone", arenas: ["center"] })).toBeNull();
    expect(getPlayer(state, 0).spells.pre[0]?.target).toEqual({ kind: "zone", arenas: ["center"] });
    expect(b).toBeDefined();
  });

  it("R-14.2/R-2.2: Spielerziel `neighbors` nur linker oder rechter Nachbar im aktiven Ring", () => {
    const state = inPlanning();
    rich(state, 0);
    expect(neighborsOf(state, 0)).toEqual({ left: 3, right: 1 });
    const [a, b, c, d] = addToHand(state, 0, ["burden", "burden", "burden", "burden"]);
    expect(setSpell(state, data, 0, a, "post", { kind: "player", player: 2 })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, a, "post", { kind: "player", player: 0 })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, a, "post", { kind: "player", player: 3 })).toBeNull();
    getPlayer(state, 0).spells.post = [];
    expect(setSpell(state, data, 0, b, "post", { kind: "player", player: 1 })).toBeNull();
    getPlayer(state, 0).spells.post = [];
    // Scheidet Spieler 1 aus, ist Spieler 2 der rechte Nachbar (R-2.2).
    getPlayer(state, 1).eliminated = true;
    expect(neighborsOf(state, 0)).toEqual({ left: 3, right: 2 });
    expect(setSpell(state, data, 0, c, "post", { kind: "player", player: 1 })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, d, "post", { kind: "player", player: 2 })).toBeNull();
  });

  it("R-7.3: Zauber ohne Ziel (`none`) nehmen `none` oder kein Ziel", () => {
    const state = inPlanning();
    rich(state, 0);
    const [a, b] = addToHand(state, 0, ["war_spoils", "spark_forge"]);
    expect(setSpell(state, data, 0, a, "post", { kind: "player", player: 1 })).toBe("invalidTarget");
    expect(setSpell(state, data, 0, a, "post", undefined)).toBeNull();
    getPlayer(state, 0).spells.post = [];
    expect(setSpell(state, data, 0, b, "post", { kind: "none" })).toBeNull();
  });

  it("R-14.8: Läutern wählt beim Legen bis zu 2 eigene Karten aus Deck oder Ablagestapel, nicht von der Hand", () => {
    const state = inPlanning();
    rich(state, 0);
    const p = getPlayer(state, 0);
    const [purify] = addToHand(state, 0, ["purify"]);
    const deckCard = p.deck[0] as CardInstanceId;
    const handCard = p.hand.find((id) => id !== purify) as CardInstanceId;
    const foreign = getPlayer(state, 1).deck[0] as CardInstanceId;
    const choose = (ids: CardInstanceId[]): ActionTarget => ({ kind: "ownCards", cardInstanceIds: ids });
    expect(setSpell(state, data, 0, purify, "post", choose([handCard]))).toBe("invalidCardChoice");
    expect(setSpell(state, data, 0, purify, "post", choose([foreign]))).toBe("invalidCardChoice");
    expect(setSpell(state, data, 0, purify, "post", choose(p.deck.slice(0, 3)))).toBe("tooManyCards");
    expect(setSpell(state, data, 0, purify, "post", choose([deckCard]))).toBeNull();
    expect(p.spells.post[0]?.target).toEqual(choose([deckCard]));
  });
});

describe("R-7.3 im Rundenablauf", () => {
  it("R-7.3/R-8.1/R-8.6: Zauber im Abschnitt `play`, öffentlich beim Aufdecken, danach auf dem Ablagestapel", () => {
    const state = inPlanning();
    rich(state, 0);
    const [fireball, shield] = addToHand(state, 0, ["fireball", "rune_shield"]);
    submitPlanning(state, 0, {
      play: [{ type: "setSpell", cardInstanceId: fireball as number, slot: "pre", target: hex("center", 3, 3) }],
      position: [{ type: "setSpell", cardInstanceId: shield as number, slot: "pre", target: hex("right", 0, 0) }],
    });
    for (const p of activePlayersInPriority(state)) if (p !== 0) submitPlanning(state, p, EMPTY);
    advance(state, data);
    const set = eventsOf(state, "spell_set");
    expect(set).toEqual([expect.objectContaining({ player: 0, cardInstanceId: fireball, phase: "reveal" })]);
    expect(set[0]?.visibleTo).toBeUndefined();
    expect(eventsOf(state, "action_rejected")).toEqual([
      expect.objectContaining({ player: 0, section: "position", action: "setSpell", reason: "wrongSection" }),
    ]);
    const p = getPlayer(state, 0);
    expect(eventsOf(state, "spell_discarded")).toEqual([
      expect.objectContaining({ player: 0, cardInstanceId: fireball, slot: "pre", phase: "cleanup" }),
    ]);
    expect(p.spells).toEqual({ pre: [], post: [] });
    expect([...p.discard, ...p.deck, ...p.hand]).toContain(fireball);
  });
});

describe("R-3.2/R-3.4: eigene Einheiten in Arena-Koordinaten", () => {
  const unit = (owner: PlayerIndex, location: UnitLocation): Unit => ({
    id: 1, owner, kind: "card", sourceId: "recruit", cardInstanceIds: [], stars: 1, xp: 0, wounded: false, restedInReserve: false, location,
  });

  it("R-3.2: rechte Zone unverändert, linke Zone gedreht; R-3.4: Mitte nach Sitz; Reserve ohne Feld", () => {
    expect(unitArenaHex(config, unit(0, { zone: "right", cell: { col: 1, row: 2 } }))).toEqual({ arena: "right", cell: { col: 1, row: 2 } });
    expect(unitArenaHex(config, unit(0, { zone: "left", cell: { col: 2, row: 1 } }))).toEqual({ arena: "left", cell: { col: 2, row: 4 } });
    expect(unitArenaHex(config, unit(1, { zone: "center", position: 0 }))).toEqual({ arena: "center", cell: { col: 6, row: 1 } });
    expect(unitArenaHex(config, unit(1, { zone: "reserve", slot: 0 }))).toBeNull();
  });

  it("R-14.2: jedes eigene Feld liegt in der eigenen Hälfte", () => {
    for (const player of [0, 1, 2, 3] as const) {
      expect(isOwnHex(config, player, { arena: "center", cell: unitArenaHex(config, unit(player, { zone: "center", position: 4 }))!.cell })).toBe(true);
      expect(isOwnHex(config, player, unitArenaHex(config, unit(player, { zone: "left", cell: { col: 0, row: 0 } }))!)).toBe(true);
      expect(isOwnHex(config, player, unitArenaHex(config, unit(player, { zone: "right", cell: { col: 4, row: 2 } }))!)).toBe(true);
    }
  });
});
