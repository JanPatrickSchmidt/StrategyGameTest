import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";
import { mergeUnits, scaleByStars, unitStats } from "./merge";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type CardInstanceId, type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();
const config = data.config;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const reserve = (slot: number): UnitLocation => ({ zone: "reserve", slot });

function inPlanning(): GameState {
  const state = createGame(data, defaultLeaders(data), 7);
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

/** Legt eine Karten-Einheit direkt auf einen Ort (für Testaufbauten), mit eigener Karteninstanz. */
function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, extra: Partial<Unit> = {}): UnitId {
  const id = state.nextUnitId++;
  const cardId = extra.sourceId ?? "recruit";
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId, owner: player };
  state.units[id] = {
    id,
    owner: player,
    kind: "card",
    sourceId: cardId,
    cardInstanceIds: [instance],
    stars: 1,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location,
    ...extra,
  };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function ownCardUnits(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.kind === "card");
}

describe("R-15.1: Verschmelzen", () => {
  it("R-15.1: drei gleiche ★1-Einheiten werden zu einer ★2-Einheit mit allen drei Karteninstanzen", () => {
    const state = inPlanning();
    const a = placeUnit(state, 0, front("left", 0, 0));
    const b = placeUnit(state, 0, front("left", 1, 0));
    const c = placeUnit(state, 0, front("left", 3, 0));
    const cards = [a, b, c].flatMap((id) => state.units[id]?.cardInstanceIds ?? []);
    expect(mergeUnits(state, 0)).toEqual([a]);
    const units = ownCardUnits(state, 0);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual(expect.objectContaining({ id: a, stars: 2, sourceId: "recruit", cardInstanceIds: cards }));
    expect(eventsOf(state, "units_merged")).toEqual([
      expect.objectContaining({ player: 0, unitId: a, mergedUnitIds: [a, b, c], stars: 2, sourceId: "recruit", location: front("left", 0, 0) }),
    ]);
  });

  it("R-15.1: Brett und Reserve zählen zusammen", () => {
    const state = inPlanning();
    placeUnit(state, 0, front("right", 0, 0));
    placeUnit(state, 0, { zone: "center", position: 2 });
    placeUnit(state, 0, reserve(1));
    mergeUnits(state, 0);
    expect(ownCardUnits(state, 0).map((u) => u.stars)).toEqual([2]);
  });

  it("R-15.1: Einheit steht auf dem Feld der Einheit mit den meisten XP, XP werden addiert", () => {
    const state = inPlanning();
    placeUnit(state, 0, front("left", 0, 0), { xp: 1 });
    const most = placeUnit(state, 0, reserve(0), { xp: 3 });
    placeUnit(state, 0, front("left", 4, 2), { xp: 2 });
    mergeUnits(state, 0);
    const [unit] = ownCardUnits(state, 0);
    expect(unit).toEqual(expect.objectContaining({ id: most, xp: 6, location: reserve(0) }));
  });

  it("R-15.1: bei gleichen XP gilt die kleinste ID", () => {
    const state = inPlanning();
    const first = placeUnit(state, 0, front("left", 2, 2), { xp: 2 });
    placeUnit(state, 0, front("left", 0, 0), { xp: 2 });
    placeUnit(state, 0, front("left", 1, 0), { xp: 0 });
    mergeUnits(state, 0);
    expect(ownCardUnits(state, 0)[0]).toEqual(expect.objectContaining({ id: first, location: front("left", 2, 2) }));
  });

  it("R-15.1: verwundet nur, wenn alle drei verwundet waren", () => {
    const some = inPlanning();
    placeUnit(some, 0, front("left", 0, 0), { wounded: true });
    placeUnit(some, 0, front("left", 1, 0), { wounded: true });
    placeUnit(some, 0, front("left", 2, 0));
    mergeUnits(some, 0);
    expect(ownCardUnits(some, 0)[0]?.wounded).toBe(false);

    const all = inPlanning();
    for (let col = 0; col < 3; col++) placeUnit(all, 0, front("left", col, 0), { wounded: true });
    mergeUnits(all, 0);
    expect(ownCardUnits(all, 0)[0]?.wounded).toBe(true);
  });

  it("R-15.1: verschiedene Karten-IDs, verschiedene Sterne und fremde Einheiten verschmelzen nicht", () => {
    const state = inPlanning();
    placeUnit(state, 0, front("left", 0, 0));
    placeUnit(state, 0, front("left", 1, 0));
    placeUnit(state, 0, front("left", 2, 0), { sourceId: "mercenary" });
    placeUnit(state, 0, front("left", 3, 0), { stars: 2 });
    placeUnit(state, 1, front("left", 0, 0));
    expect(mergeUnits(state, 0)).toEqual([]);
    expect(mergeUnits(state, 1)).toEqual([]);
    expect(eventsOf(state, "units_merged")).toEqual([]);
  });

  it("R-15.1: Verkettung – das dritte ★2 aus einer Verschmelzung ergibt sofort ★3", () => {
    const state = inPlanning();
    const s1 = placeUnit(state, 0, front("left", 0, 0), { stars: 2, xp: 1 });
    const s2 = placeUnit(state, 0, front("left", 1, 0), { stars: 2 });
    const r1 = placeUnit(state, 0, front("left", 2, 0));
    placeUnit(state, 0, front("left", 3, 0));
    placeUnit(state, 0, front("left", 4, 0));
    expect(mergeUnits(state, 0)).toEqual([r1, s1]);
    const units = ownCardUnits(state, 0);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual(expect.objectContaining({ id: s1, stars: 3, xp: 1 }));
    expect(units[0]?.cardInstanceIds).toHaveLength(5);
    expect(state.units[s2]).toBeUndefined();
    expect(eventsOf(state, "units_merged").map((e) => e.stars)).toEqual([2, 3]);
  });

  it("R-15.1: höchste Stufe ★3 – drei ★3 verschmelzen nicht", () => {
    const state = inPlanning();
    for (let col = 0; col < 3; col++) placeUnit(state, 0, front("left", col, 0), { stars: 3 });
    expect(mergeUnits(state, 0)).toEqual([]);
    expect(ownCardUnits(state, 0)).toHaveLength(3);
  });

  it("R-15.1: bei mehr als drei gleichen verschmelzen die drei mit den meisten XP (F25)", () => {
    const state = inPlanning();
    const low = placeUnit(state, 0, front("left", 0, 0), { xp: 0 });
    const a = placeUnit(state, 0, front("left", 1, 0), { xp: 2 });
    placeUnit(state, 0, front("left", 2, 0), { xp: 1 });
    placeUnit(state, 0, front("left", 3, 0), { xp: 1 });
    mergeUnits(state, 0);
    expect(state.units[low]).toEqual(expect.objectContaining({ stars: 1 }));
    expect(state.units[a]).toEqual(expect.objectContaining({ stars: 2, xp: 4 }));
  });

  it("R-15.3: Anführer und Tokens verschmelzen nicht", () => {
    const state = inPlanning();
    for (let col = 0; col < 3; col++) placeUnit(state, 0, front("right", col, 0), { kind: "token", sourceId: "goblin_token", cardInstanceIds: [] });
    // Zwei weitere Anführer-Einheiten desselben Anführers (künstlich), zusammen mit dem echten drei.
    const leader = state.units[getPlayer(state, 0).leader.unitId] as Unit;
    for (let col = 0; col < 2; col++) placeUnit(state, 0, front("right", col, 2), { kind: "leader", sourceId: leader.sourceId, cardInstanceIds: [] });
    expect(mergeUnits(state, 0)).toEqual([]);
  });

  it("R-15.1: Wird die verschmolzene Einheit geopfert, gehen alle drei Karten auf den Ablagestapel", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    for (let col = 0; col < 3; col++) placeUnit(state, 0, front("left", col, 0));
    const [merged] = mergeUnits(state, 0);
    const cards = state.units[merged as UnitId]?.cardInstanceIds ?? [];
    expect(cards).toHaveLength(3);
    const [hand] = addToHand(state, 0, ["bounty_hunter"]);
    p.roundGold = 99;
    submitPlanning(state, 0, { play: [{ type: "playUnit", cardInstanceId: hand as number, to: front("left", 4, 2), useAltCost: true, sacrifice: [merged as UnitId] }] });
    for (const other of PLAYER_INDICES.filter((i) => i !== 0)) submitPlanning(state, other, {});
    advance(state, data);
    expect(eventsOf(state, "action_rejected").filter((e) => e.player === 0)).toEqual([]);
    expect(eventsOf(state, "unit_sacrificed")[0]?.cardInstanceIds).toEqual(cards);
    // Am Rundenende kann der Ablagestapel ins Deck gemischt werden; die Karten sind dann dort oder auf der Hand.
    for (const c of cards) expect([...p.discard, ...p.deck, ...p.hand]).toContain(c);
  });
});

describe("R-7.8: Verschmelzen nach jeder Aktion", () => {
  function submitOthersEmpty(state: GameState, except: PlayerIndex): void {
    for (const other of PLAYER_INDICES.filter((i) => i !== except)) submitPlanning(state, other, {});
  }

  it("R-7.8: das Ausspielen der dritten Kopie verschmilzt sofort; eine spätere Aktion derselben Planung nutzt die neue Einheit", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    const keeper = placeUnit(state, 0, front("left", 0, 0), { xp: 1 });
    placeUnit(state, 0, front("left", 1, 0));
    const [card] = addToHand(state, 0, ["recruit"]);
    submitPlanning(state, 0, {
      play: [{ type: "playUnit", cardInstanceId: card as number, to: front("left", 2, 0) }],
      position: [{ type: "moveUnit", unitId: keeper, to: reserve(0) }],
    });
    submitOthersEmpty(state, 0);
    advance(state, data);
    expect(eventsOf(state, "action_rejected").filter((e) => e.player === 0)).toEqual([]);
    const merges = eventsOf(state, "units_merged");
    expect(merges).toHaveLength(1);
    const played = state.log.findIndex((e) => e.type === "unit_played" && e.player === 0);
    const merged = state.log.findIndex((e) => e.type === "units_merged");
    const moved = state.log.findIndex((e) => e.type === "unit_moved" && e.player === 0);
    expect(played).toBeLessThan(merged);
    expect(merged).toBeLessThan(moved);
    const unit = state.units[keeper];
    expect(unit).toEqual(expect.objectContaining({ stars: 2, location: reserve(0) }));
    expect(unit?.cardInstanceIds).toContain(card);
  });

  it("R-7.8: nach dem Verschmelzen ist Kapazität frei für weitere Einheiten derselben Planung", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.roundGold = 10;
    const cap = config.boardCapacity;
    // Brett voll: zwei Rekruten und (cap - 2) verschiedene andere Einheiten. Die dritte Rekruten-Karte geht in die
    // Reserve und verschmilzt; danach ist auf dem Brett ein Platz frei.
    placeUnit(state, 0, front("left", 0, 0));
    placeUnit(state, 0, front("left", 1, 0));
    const others = ["mercenary", "goblin_skirmisher", "tinker", "ranger", "runesmith"];
    for (let i = 0; i < cap - 2; i++) placeUnit(state, 0, front("right", i % 5, Math.floor(i / 5)), { sourceId: others[i] ?? "mercenary" });
    const [r, m] = addToHand(state, 0, ["recruit", "spark_rider"]);
    submitPlanning(state, 0, {
      play: [
        { type: "playUnit", cardInstanceId: r as number, to: reserve(0) },
        { type: "playUnit", cardInstanceId: m as number, to: front("left", 3, 0) },
      ],
    });
    submitOthersEmpty(state, 0);
    advance(state, data);
    expect(eventsOf(state, "action_rejected").filter((e) => e.player === 0)).toEqual([]);
    expect(ownCardUnits(state, 0)).toHaveLength(cap);
  });
});

describe("R-15.2: Sternfaktor", () => {
  it("R-15.2: ★1 = Grundwert, ★2 = ×1,8, ★3 = ×3,2, abgerundet", () => {
    expect(scaleByStars(config, 5, 1)).toBe(5);
    expect(scaleByStars(config, 5, 2)).toBe(9);
    expect(scaleByStars(config, 5, 3)).toBe(16);
    expect(scaleByStars(config, 3, 2)).toBe(5);
    expect(scaleByStars(config, 3, 3)).toBe(9);
  });

  it("R-15.2: mindestens der ★1-Wert, auch bei kleinem Faktor", () => {
    const weak = { ...config, starMultiplier: { "1": 1, "2": 0.5, "3": 1.2 } };
    expect(scaleByStars(weak, 1, 2)).toBe(1);
    expect(scaleByStars(weak, 4, 3)).toBe(4);
    expect(scaleByStars(config, 1, 2)).toBe(1);
    expect(scaleByStars(config, 0, 3)).toBe(0);
  });

  it("R-15.2: Gleitkomma-Reste runden nicht falsch ab", () => {
    const tricky = { ...config, starMultiplier: { "1": 1, "2": 1.1, "3": 3.2 } };
    // 10 × 1,1 = 11,000000000000002 und 5 × 3,2 = 16 → nicht 10 bzw. 15
    expect(scaleByStars(tricky, 10, 2)).toBe(11);
    expect(scaleByStars(tricky, 5, 3)).toBe(16);
  });

  it("R-15.2: Kampfwerte skalieren attack, hp und breakthrough, sonst nichts", () => {
    const card = data.cards.get("recruit");
    if (!card || card.type !== "unit") throw new Error("recruit fehlt");
    const base = card.stats;
    expect(unitStats(data, { kind: "card", sourceId: "recruit", stars: 1 })).toEqual(base);
    const two = unitStats(data, { kind: "card", sourceId: "recruit", stars: 2 });
    expect(two).toEqual({
      ...base,
      attack: Math.max(base.attack, Math.floor(base.attack * 1.8)),
      hp: Math.max(base.hp, Math.floor(base.hp * 1.8)),
      breakthrough: Math.max(base.breakthrough, Math.floor(base.breakthrough * 1.8)),
    });
    const three = unitStats(data, { kind: "card", sourceId: "recruit", stars: 3 });
    expect(three.attack).toBe(Math.floor(base.attack * 3.2));
    expect(three.range).toBe(base.range);
  });

  it("R-15.3: Anführer haben keinen Sternfaktor", () => {
    expect(() => unitStats(data, { kind: "leader", sourceId: "x", stars: 1 })).toThrow(RangeError);
  });

  it("R-7.5 mit R-15: Genesen einer ★2-Einheit kostet 2 Gold", () => {
    const state = inPlanning();
    const p = getPlayer(state, 0);
    p.treasury = 0;
    p.roundGold = 2;
    for (let col = 0; col < 3; col++) placeUnit(state, 0, front("left", col, 0), { wounded: true });
    const [id] = mergeUnits(state, 0);
    submitPlanning(state, 0, { play: [{ type: "heal", unitId: id as UnitId }] });
    for (const other of PLAYER_INDICES.filter((i) => i !== 0)) submitPlanning(state, other, {});
    advance(state, data);
    expect(eventsOf(state, "unit_healed")).toEqual([expect.objectContaining({ unitId: id, paidFromRoundGold: 2 })]);
  });
});
