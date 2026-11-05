import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, Planning } from "./actions";
import { loadGameData } from "./data";
import { fighterForUnit } from "./fronts";
import { compareRowCol, neighbors } from "./hex";
import { resolveLeaderAbilities, SUPPORTED_LEADER_CATEGORIES } from "./leaderAbilities";
import { resonanceCounts } from "./resonance";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { globalHexKey, ownLocationOfHex, unitArenaHex } from "./targets";

const data = loadGameData();
const config = data.config;
const EMPTY: Planning = { play: [], buy: [], position: [] };
// Standard-Anführer: 0 Brann, 1 Ilyra, 2 Vex, 3 Morgra. Morgras rechte Frontarena ist `front:3-0`, die linke `front:2-3`.
const MORGRA: PlayerIndex = 3;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const hex = (arena: ArenaHex["arena"], col: number, row: number): ActionTarget => ({ kind: "hex", arena, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(leaders: readonly string[] = defaultLeaders(data), seed = 41): GameState {
  const state = createGame(data, leaders, seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit"): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = { id, owner: player, kind: "card", sourceId, cardInstanceIds: [instance], stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function setLeader(state: GameState, player: PlayerIndex, level: 1 | 2 | 3 | 4, branchId: string | null, target: ActionTarget): void {
  const p = getPlayer(state, player);
  p.leader.level = level;
  p.leader.branchId = branchId;
  p.leaderAbility = target;
}

function tokensOf(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units)
    .filter((u) => u.owner === player && u.kind === "token")
    .sort((a, b) => a.id - b.id);
}

/** Erwartete Nachbarfelder in Morgras rechter Frontzone (Zonen- = Arena-Koordinaten), nach `(row, col)`. */
function ownRightNeighbors(col: number, row: number): UnitLocation[] {
  return neighbors({ col, row }, config.arenas.frontZone)
    .sort(compareRowCol)
    .map((c) => front("right", c.col, c.row));
}

function statsOf(state: GameState, unit: Unit): { attack: number; hp: number } {
  const s = fighterForUnit(state, data, unit, { col: 0, row: 0 }).stats;
  return { attack: s.attack, hp: s.hp };
}

describe("E11c3: Morgras Beschwörung – Kategorie summon (R-8.2, R-1.4)", () => {
  it("R-8.2: die Kategorie summon ist umgesetzt", () => {
    expect(SUPPORTED_LEADER_CATEGORIES.has("summon")).toBe(true);
  });

  it("R-8.2: Morgra Stufe 1 beschwört einen Geist (2/2) auf das gewählte freie Feld", () => {
    const state = emptyBoard();
    setLeader(state, MORGRA, 1, null, hex("right", 2, 1));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_resolved", from)).toMatchObject([
      { player: MORGRA, leaderId: "morgra", category: "summon", level: 1, branchId: null },
    ]);
    const tokens = tokensOf(state, MORGRA);
    expect(tokens.map((t) => [t.sourceId, t.location])).toEqual([["spirit", front("right", 2, 1)]]);
    expect(tokens[0]?.statOverride).toBeUndefined();
    expect(tokens[0]?.countsForResonance).toBeUndefined();
    expect(statsOf(state, tokens[0] as Unit)).toEqual({ attack: 2, hp: 2 });
    expect(eventsOf(state, "unit_summoned", from)).toEqual([
      expect.objectContaining({ player: MORGRA, unitId: tokens[0]?.id, sourceId: "spirit", location: front("right", 2, 1), cardId: "morgra" }),
    ]);
  });

  it("R-8.2: in der linken Frontarena (gedrehte Hälfte) landet der Geist auf dem passenden Feld der linken Zone", () => {
    const state = emptyBoard();
    // Arena-Feld (1, 4) der linken Frontarena = Zone `left`, Feld (5-1-1, 6-1-4) = (3, 1).
    setLeader(state, MORGRA, 1, null, hex("left", 1, 4));
    resolveLeaderAbilities(state, data);
    const [token] = tokensOf(state, MORGRA);
    expect(token?.location).toEqual(front("left", 3, 1));
    expect(unitArenaHex(config, token as Unit)).toEqual({ arena: "left", cell: { col: 1, row: 4 } });
  });

  it("R-1.9: ist das gewählte Feld bei der Auflösung besetzt, kommt der Geist auf das erste freie Nachbarfeld", () => {
    const state = emptyBoard();
    placeUnit(state, MORGRA, front("right", 2, 1));
    setLeader(state, MORGRA, 1, null, hex("right", 2, 1));
    resolveLeaderAbilities(state, data);
    expect(tokensOf(state, MORGRA).map((t) => t.location)).toEqual([ownRightNeighbors(2, 1)[0]]);
  });

  it("R-8.2: Morgra verpufft, wenn weder das Feld noch ein Nachbarfeld frei ist (verwundete Einheiten belegen ihr Feld)", () => {
    const state = emptyBoard();
    placeUnit(state, MORGRA, front("right", 0, 0));
    for (const loc of ownRightNeighbors(0, 0)) {
      const id = placeUnit(state, MORGRA, loc);
      (state.units[id] as Unit).wounded = true;
    }
    setLeader(state, MORGRA, 2, "horde", hex("right", 0, 0));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_fizzled", from)).toMatchObject([
      { player: MORGRA, leaderId: "morgra", category: "summon", reason: "noValidTarget" },
    ]);
    expect(eventsOf(state, "leader_ability_resolved", from)).toEqual([]);
    expect(tokensOf(state, MORGRA)).toEqual([]);
  });

  it("R-8.2: in der Mitte beschwört Morgra nur in den eigenen Startbereich (Nachbarn nach Position)", () => {
    const state = emptyBoard();
    // Sitz 3 = linke Spalte, Position 2 = Feld (0, 3); Schar Stufe 4: 3 Geister → Positionen 2, 1, 3.
    setLeader(state, MORGRA, 4, "horde", hex("center", 0, 3));
    resolveLeaderAbilities(state, data);
    expect(tokensOf(state, MORGRA).map((t) => t.location)).toEqual([
      { zone: "center", position: 2 },
      { zone: "center", position: 1 },
      { zone: "center", position: 3 },
    ]);
  });

  describe("Ast „Schar“", () => {
    it("R-16.2: Stufe 2 – 2 Geister 2/2 (gewähltes Feld, dann Nachbarfeld)", () => {
      const state = emptyBoard();
      setLeader(state, MORGRA, 2, "horde", hex("right", 2, 1));
      resolveLeaderAbilities(state, data);
      const tokens = tokensOf(state, MORGRA);
      expect(tokens.map((t) => t.location)).toEqual([front("right", 2, 1), ownRightNeighbors(2, 1)[0]]);
      expect(tokens.map((t) => statsOf(state, t))).toEqual([
        { attack: 2, hp: 2 },
        { attack: 2, hp: 2 },
      ]);
    });

    it("R-16.2: Stufe 3 – 2 Geister 3/3", () => {
      const state = emptyBoard();
      setLeader(state, MORGRA, 3, "horde", hex("right", 2, 1));
      resolveLeaderAbilities(state, data);
      const tokens = tokensOf(state, MORGRA);
      expect(tokens).toHaveLength(2);
      expect(tokens.map((t) => statsOf(state, t))).toEqual([
        { attack: 3, hp: 3 },
        { attack: 3, hp: 3 },
      ]);
      expect(tokens[0]?.statOverride).toEqual({ attack: 3, hp: 3 });
    });

    it("R-16.2: Stufe 4 – 3 Geister 3/3; fehlen freie Felder, entstehen weniger", () => {
      const state = emptyBoard();
      setLeader(state, MORGRA, 4, "horde", hex("right", 2, 1));
      resolveLeaderAbilities(state, data);
      expect(tokensOf(state, MORGRA).map((t) => t.location)).toEqual([front("right", 2, 1), ...ownRightNeighbors(2, 1).slice(0, 2)]);

      const crowded = emptyBoard();
      for (const loc of ownRightNeighbors(2, 1).slice(1)) placeUnit(crowded, MORGRA, loc);
      setLeader(crowded, MORGRA, 4, "horde", hex("right", 2, 1));
      resolveLeaderAbilities(crowded, data);
      expect(tokensOf(crowded, MORGRA).map((t) => t.location)).toEqual([front("right", 2, 1), ownRightNeighbors(2, 1)[0]]);
    });
  });

  describe("Ast „Ahnen“", () => {
    for (const [level, attack, hp] of [
      [2, 4, 4],
      [3, 5, 6],
      [4, 6, 9],
    ] as const) {
      it(`R-16.2: Stufe ${level} – ein Geist ${attack}/${hp} (statOverride)`, () => {
        const state = emptyBoard();
        setLeader(state, MORGRA, level, "ancestors", hex("right", 1, 0));
        const from = state.log.length;
        resolveLeaderAbilities(state, data);
        const tokens = tokensOf(state, MORGRA);
        expect(tokens).toHaveLength(1);
        expect(statsOf(state, tokens[0] as Unit)).toEqual({ attack, hp });
        expect(eventsOf(state, "unit_summoned", from)[0]?.statOverride).toEqual({ attack, hp });
      });
    }
  });

  describe("Ast „Seelenband“", () => {
    it("R-17.1: Stufe 2 – der Geist zählt für die Resonanz (Mensch), ein normaler Geist nicht", () => {
      const state = emptyBoard();
      placeUnit(state, MORGRA, front("right", 0, 0), "mercenary");
      expect(resonanceCounts(state, data, MORGRA).get("human")).toBe(1);
      setLeader(state, MORGRA, 2, "soulbond", hex("right", 3, 0));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      const [token] = tokensOf(state, MORGRA);
      expect(token?.countsForResonance).toBe(true);
      expect(statsOf(state, token as Unit)).toEqual({ attack: 2, hp: 2 });
      expect(eventsOf(state, "unit_summoned", from)[0]?.countsForResonance).toBe(true);
      expect(resonanceCounts(state, data, MORGRA).get("human")).toBe(2);

      const plain = emptyBoard();
      placeUnit(plain, MORGRA, front("right", 0, 0), "mercenary");
      setLeader(plain, MORGRA, 1, null, hex("right", 3, 0));
      resolveLeaderAbilities(plain, data);
      expect(resonanceCounts(plain, data, MORGRA).get("human")).toBe(1);
    });

    it("R-17.1: Stufe 3 – ein Geist 3/3, der mitzählt", () => {
      const state = emptyBoard();
      setLeader(state, MORGRA, 3, "soulbond", hex("right", 3, 0));
      resolveLeaderAbilities(state, data);
      const tokens = tokensOf(state, MORGRA);
      expect(tokens).toHaveLength(1);
      expect(statsOf(state, tokens[0] as Unit)).toEqual({ attack: 3, hp: 3 });
      expect(resonanceCounts(state, data, MORGRA).get("human")).toBe(1);
    });

    it("R-17.1: Stufe 4 – zwei Geister 3/3 zählen als eine Karten-ID", () => {
      const state = emptyBoard();
      setLeader(state, MORGRA, 4, "soulbond", hex("right", 3, 0));
      resolveLeaderAbilities(state, data);
      const tokens = tokensOf(state, MORGRA);
      expect(tokens).toHaveLength(2);
      expect(tokens.every((t) => t.countsForResonance === true)).toBe(true);
      expect(resonanceCounts(state, data, MORGRA).get("human")).toBe(1);
    });
  });

  describe("Feldkonflikt (R-8.2)", () => {
    it("R-8.2: globalHexKey – dasselbe Feld einer Frontarena hat für beide Spieler dieselbe Kennung", () => {
      const state = emptyBoard();
      // Morgras rechte Frontarena = Branns linke (front:3-0).
      const cell = { col: 2, row: 1 };
      expect(globalHexKey(state, MORGRA, { arena: "right", cell })).toBe("front:3-0:2,1");
      expect(globalHexKey(state, 0, { arena: "left", cell })).toBe("front:3-0:2,1");
      expect(globalHexKey(state, 0, { arena: "right", cell })).not.toBe(globalHexKey(state, MORGRA, { arena: "right", cell }));
      expect(globalHexKey(state, 1, { arena: "center", cell })).toBe(globalHexKey(state, MORGRA, { arena: "center", cell }));
    });

    it("R-8.2: zwei Morgras beschwören gleichzeitig in getrennte eigene Hälften; keine kommt der anderen in die Quere", () => {
      // Spieler 0 und 3 führen beide Morgra; Spieler 3s rechte Frontarena ist Spieler 0s linke.
      const state = emptyBoard(["morgra", "ilyra", "vex", "morgra"]);
      setLeader(state, 0, 4, "horde", hex("left", 2, 4));
      setLeader(state, MORGRA, 4, "horde", hex("right", 2, 1));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_hex_conflict", from)).toEqual([]);
      expect(tokensOf(state, 0)).toHaveLength(3);
      expect(tokensOf(state, MORGRA)).toHaveLength(3);
      // Beschwörungen beider Spieler: erst alle Felder geplant, dann Ereignisse in Prioritätsreihenfolge (Runde 1: 0 zuerst).
      expect(eventsOf(state, "leader_ability_resolved", from).map((e) => e.player)).toEqual([0, MORGRA]);
    });

    it("R-8.2: ownLocationOfHex – Felder der gegnerischen Hälfte und außerhalb des Startbereichs sind keine eigenen Orte", () => {
      expect(ownLocationOfHex(config, MORGRA, { arena: "right", cell: { col: 2, row: 3 } })).toBeNull();
      expect(ownLocationOfHex(config, MORGRA, { arena: "center", cell: { col: 3, row: 3 } })).toBeNull();
      expect(ownLocationOfHex(config, MORGRA, { arena: "center", cell: { col: 0, row: 1 } })).toEqual({ zone: "center", position: 0 });
    });
  });

  it("R-8.2: summon vor damage – Ilyras Blitzschlag trifft den eben beschworenen Geist in der Mitte", () => {
    const state = emptyBoard();
    setLeader(state, MORGRA, 1, null, hex("center", 0, 3));
    setLeader(state, 1, 1, null, hex("center", 0, 3));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    const [token] = tokensOf(state, MORGRA);
    expect(eventsOf(state, "leader_ability_resolved", from).map((e) => e.category)).toEqual(["summon", "damage"]);
    expect(eventsOf(state, "unit_defeated", from)).toEqual([expect.objectContaining({ unitId: token?.id, cardId: "ilyra" })]);
  });

  it("R-1.4: die beschworenen Geister kämpfen in der Runde mit und verschwinden danach", () => {
    const state = emptyBoard();
    setLeader(state, MORGRA, 2, "horde", hex("right", 2, 1));
    for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
    const from = state.log.length;
    advance(state, data);
    const summoned = eventsOf(state, "unit_summoned", from).map((e) => e.unitId);
    expect(summoned).toHaveLength(2);
    const result = state.frontResults.find((r) => r.first === MORGRA);
    expect(result?.participants).toEqual(expect.arrayContaining(summoned));
    expect(eventsOf(state, "token_removed", from).map((e) => e.unitId)).toEqual(summoned);
    expect(tokensOf(state, MORGRA)).toEqual([]);
  });

  it("Determinismus: gleiche Beschwörung, gleicher Zustand = gleiches Protokoll", () => {
    const run = (): GameEvent[] => {
      const state = emptyBoard();
      placeUnit(state, MORGRA, front("right", 2, 1));
      setLeader(state, MORGRA, 4, "horde", hex("right", 2, 1));
      resolveLeaderAbilities(state, data);
      return state.log;
    };
    expect(run()).toEqual(run());
  });
});
