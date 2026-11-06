import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, Planning } from "./actions";
import { centerParticipants, runCenter } from "./center";
import { loadGameData } from "./data";
import { fighterForUnit, frontParticipants, runFront } from "./fronts";
import { leaderAbilityParams } from "./leader";
import { resolveLeaderAbilities, returnShadowSteppedUnits, SUPPORTED_LEADER_CATEGORIES } from "./leaderAbilities";
import { preCombatAllies, zoneFreeLocations } from "./preCombat";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { checkTarget, globalHexKey, isArenaHexFree, unitArenaHex } from "./targets";

const data = loadGameData();
const config = data.config;
const EMPTY: Planning = { play: [], buy: [], position: [] };
// Standard-Anführer: 0 Brann, 1 Ilyra, 2 Vex, 3 Morgra. Vex' rechte Frontarena ist `front:2-3` (Morgras linke,
// Vex Zeilen 0–2, Morgra Zeilen 3–5), die linke `front:1-2` (Ilyras rechte, Ilyra Zeilen 0–2, Vex Zeilen 3–5).
const VEX: PlayerIndex = 2;
const MORGRA: PlayerIndex = 3;
const ILYRA: PlayerIndex = 1;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const at = (arena: ArenaHex["arena"], col: number, row: number): ArenaHex => ({ arena, cell: { col, row } });
const moves = (...list: [UnitId, ArenaHex][]): ActionTarget => ({ kind: "moveUnits", moves: list.map(([unitId, to]) => ({ unitId, to })) });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 43): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
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

function unit(state: GameState, id: UnitId): Unit {
  return state.units[id] as Unit;
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

function stats(state: GameState, id: UnitId) {
  return fighterForUnit(state, data, unit(state, id), { col: 0, row: 0 });
}

const vex = data.leaders.get("vex");
if (!vex) throw new Error("Vex fehlt in den Daten");

describe("E11c4a: Vex' Schattenschritt – Kategorie move (R-8.2, R-16.6)", () => {
  it("R-8.2: die Kategorie move ist umgesetzt", () => {
    expect(SUPPORTED_LEADER_CATEGORIES.has("move")).toBe(true);
  });

  it("R-16.6: Stufe 1 setzt eine eigene Einheit in die gegnerische Hälfte der Frontarena; das Ausgangsfeld bleibt gespeichert", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("right", 2, 1));
    setLeader(state, VEX, 1, null, moves([id, at("right", 2, 4)]));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_resolved", from)).toMatchObject([{ player: VEX, leaderId: "vex", category: "move", level: 1, branchId: null }]);
    expect(eventsOf(state, "unit_shadow_stepped", from)).toEqual([
      expect.objectContaining({ player: VEX, unitId: id, from: front("right", 2, 1), to: at("right", 2, 4), cardId: "vex" }),
    ]);
    expect(unit(state, id).location).toEqual(front("right", 2, 1));
    expect(unitArenaHex(config, unit(state, id))).toEqual(at("right", 2, 4));
  });

  it("R-16.6: die Einheit kämpft in dieser Runde in dieser Arena von diesem Feld aus", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("right", 2, 1));
    const enemy = placeUnit(state, MORGRA, front("left", 0, 0));
    setLeader(state, VEX, 1, null, moves([id, at("right", 2, 4)]));
    resolveLeaderAbilities(state, data);
    expect(frontParticipants(state, { first: VEX, second: MORGRA }).first.map((u) => u.id)).toEqual([id]);
    const from = state.log.length;
    runFront(state, data, { first: VEX, second: MORGRA });
    const started = eventsOf(state, "combat_started", from)[0];
    expect(started?.fighters).toEqual(expect.arrayContaining([expect.objectContaining({ unitId: id, cell: { col: 2, row: 4 } })]));
    expect(started?.fighters.map((f) => f.unitId).sort((a, b) => a - b)).toEqual([id, enemy].sort((a, b) => a - b));
  });

  it("R-16.6: in die Mittelarena auf ein beliebiges freies Feld – die Einheit kämpft dann nur dort, nicht mehr an ihrer Front", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("left", 1, 1));
    placeUnit(state, MORGRA, { zone: "center", position: 0 });
    setLeader(state, VEX, 1, null, moves([id, at("center", 3, 3)]));
    resolveLeaderAbilities(state, data);
    expect(centerParticipants(state).map((u) => u.id)).toContain(id);
    expect(frontParticipants(state, { first: ILYRA, second: VEX }).second).toEqual([]);
    const from = state.log.length;
    runCenter(state, data);
    const started = eventsOf(state, "combat_started", from)[0];
    expect(started?.fighters).toEqual(expect.arrayContaining([expect.objectContaining({ unitId: id, cell: { col: 3, row: 3 } })]));
  });

  it("R-16.6: eine Einheit aus der Mitte an die Front verlässt den Mittelkampf", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, { zone: "center", position: 2 });
    setLeader(state, VEX, 1, null, moves([id, at("left", 0, 1)]));
    resolveLeaderAbilities(state, data);
    expect(centerParticipants(state).map((u) => u.id)).not.toContain(id);
    expect(frontParticipants(state, { first: ILYRA, second: VEX }).second.map((u) => u.id)).toEqual([id]);
  });

  describe("Äste und Stufen", () => {
    it("R-16.6: „Doppelt“ Stufe 2 bewegt bis zu 2 Einheiten ohne Buff, Stufe 3 mit +1 Angriff", () => {
      for (const level of [2, 3] as const) {
        const state = emptyBoard();
        const a = placeUnit(state, VEX, front("right", 0, 0));
        const b = placeUnit(state, VEX, front("right", 1, 0));
        const before = stats(state, a).stats.attack;
        setLeader(state, VEX, level, "double", moves([a, at("right", 0, 3)], [b, at("center", 3, 3)]));
        resolveLeaderAbilities(state, data);
        expect(unitArenaHex(config, unit(state, a))).toEqual(at("right", 0, 3));
        expect(unitArenaHex(config, unit(state, b))).toEqual(at("center", 3, 3));
        expect(stats(state, a).stats.attack).toBe(before + (level === 3 ? 1 : 0));
        expect(stats(state, b).stats.attack).toBe(before + (level === 3 ? 1 : 0));
      }
    });

    it("R-16.6: „Doppelt“ Stufe 4 bewegt bis zu 3 Einheiten mit +1 Angriff; mehr lehnt die Planung ab (F23)", () => {
      const state = emptyBoard();
      const ids = [0, 1, 2, 3].map((col) => placeUnit(state, VEX, front("right", col, 0)));
      const params = leaderAbilityParams(vex, 4, "double");
      expect(params.limits.count).toBe(3);
      const four = moves(...ids.map((id, i): [UnitId, ArenaHex] => [id, at("right", i, 4)]));
      expect(checkTarget(state, data, VEX, params.target, params.limits, four)).toBe("tooManyTargets");
      const three = moves(...ids.slice(0, 3).map((id, i): [UnitId, ArenaHex] => [id, at("right", i, 4)]));
      expect(checkTarget(state, data, VEX, params.target, params.limits, three)).toEqual(three);
      setLeader(state, VEX, 4, "double", three);
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "unit_shadow_stepped", from).map((e) => e.unitId)).toEqual(ids.slice(0, 3));
      expect(eventsOf(state, "unit_buffed", from).map((e) => [e.unitId, e.stat, e.amount, e.duration])).toEqual(
        ids.slice(0, 3).map((id) => [id, "attack", 1, "combat"]),
      );
    });

    it("R-16.6: Stufe 1 und „Hinterhalt“/„Beute“ bewegen höchstens eine Einheit", () => {
      const state = emptyBoard();
      const a = placeUnit(state, VEX, front("right", 0, 0));
      const b = placeUnit(state, VEX, front("right", 1, 0));
      const two = moves([a, at("right", 0, 4)], [b, at("right", 1, 4)]);
      for (const [level, branch] of [[1, null], [2, "ambush"], [4, "loot"]] as const) {
        const params = leaderAbilityParams(vex, level, branch);
        expect(checkTarget(state, data, VEX, params.target, params.limits, two)).toBe("tooManyTargets");
      }
    });

    it("R-16.6: „Hinterhalt“ gibt der Einheit +2/+3/+4 Durchbruch für die Runde, Stufe 4 zusätzlich Erstschlag", () => {
      for (const [level, amount] of [[2, 2], [3, 3], [4, 4]] as const) {
        const state = emptyBoard();
        const id = placeUnit(state, VEX, front("right", 2, 1));
        const before = stats(state, id).stats.breakthrough;
        setLeader(state, VEX, level, "ambush", moves([id, at("right", 2, 4)]));
        const from = state.log.length;
        resolveLeaderAbilities(state, data);
        expect(unitArenaHex(config, unit(state, id))).toEqual(at("right", 2, 4));
        expect(stats(state, id).stats.breakthrough).toBe(before + amount);
        expect(eventsOf(state, "unit_buffed", from)).toEqual([expect.objectContaining({ unitId: id, stat: "breakthrough", amount, duration: "round", cardId: "vex" })]);
        const keywords = eventsOf(state, "unit_keyword_granted", from);
        expect(keywords).toEqual(level === 4 ? [expect.objectContaining({ unitId: id, keyword: "firstStrike", cardId: "vex" })] : []);
        expect(stats(state, id).keywords ?? []).toEqual(level === 4 ? expect.arrayContaining(["firstStrike"]) : []);
      }
    });

    it("R-16.6: „Beute“ bewegt die Einheit auf allen Stufen (die Beute selbst: vexLoot.test.ts)", () => {
      for (const level of [2, 3, 4] as const) {
        const state = emptyBoard();
        const id = placeUnit(state, VEX, front("right", 2, 1));
        setLeader(state, VEX, level, "loot", moves([id, at("right", 2, 4)]));
        const from = state.log.length;
        resolveLeaderAbilities(state, data);
        expect(eventsOf(state, "leader_ability_resolved", from)).toMatchObject([{ player: VEX, level, branchId: "loot" }]);
        expect(unitArenaHex(config, unit(state, id))).toEqual(at("right", 2, 4));
      }
    });
  });

  describe("Gültigkeit bei der Auflösung (R-8.2, R-1.9)", () => {
    it("R-16.6: steht auf dem Zielfeld bei der Auflösung eine gegnerische Einheit, scheitert die Bewegung; ohne weiteren Effekt verpufft die Fähigkeit", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      // Morgras linke Zone, Zonenfeld (2, 1) = Arena-Feld (5-1-2, 6-1-1) = (2, 4).
      placeUnit(state, MORGRA, front("left", 2, 1));
      setLeader(state, VEX, 1, null, moves([id, at("right", 2, 4)]));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_move_blocked", from)).toEqual([
        expect.objectContaining({ player: VEX, unitId: id, hex: at("right", 2, 4), reason: "hexOccupied" }),
      ]);
      expect(eventsOf(state, "leader_ability_fizzled", from)).toEqual([expect.objectContaining({ player: VEX, reason: "noValidTarget" })]);
      expect(unit(state, id).shadowStep).toBeUndefined();
    });

    it("R-1.9: scheitert die Bewegung beim „Hinterhalt“, bekommt die gewählte Einheit den Durchbruch trotzdem (F45)", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      placeUnit(state, MORGRA, front("left", 2, 1));
      const before = stats(state, id).stats.breakthrough;
      setLeader(state, VEX, 2, "ambush", moves([id, at("right", 2, 4)]));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_resolved", from)).toHaveLength(1);
      expect(unit(state, id).shadowStep).toBeUndefined();
      expect(stats(state, id).stats.breakthrough).toBe(before + 2);
    });

    it("R-16.6: verwundete Einheiten und Einheiten in der Reserve werden nicht bewegt (F45)", () => {
      const state = emptyBoard();
      const wounded = placeUnit(state, VEX, front("right", 0, 0));
      unit(state, wounded).wounded = true;
      const reserve = placeUnit(state, VEX, { zone: "reserve", slot: 1 });
      const ok = placeUnit(state, VEX, front("right", 2, 0));
      setLeader(state, VEX, 4, "double", moves([wounded, at("right", 0, 4)], [reserve, at("right", 1, 4)], [ok, at("right", 2, 4)]));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_move_blocked", from).map((e) => [e.unitId, e.reason])).toEqual([
        [wounded, "unitUnavailable"],
        [reserve, "unitUnavailable"],
      ]);
      expect(eventsOf(state, "unit_shadow_stepped", from).map((e) => e.unitId)).toEqual([ok]);
      expect(eventsOf(state, "unit_buffed", from).map((e) => e.unitId)).toEqual([ok]);
    });

    it("R-16.6: auch der Anführer selbst kann versetzt werden", () => {
      const state = emptyBoard();
      const leader = getPlayer(state, VEX).leader.unitId;
      unit(state, leader).location = front("right", 2, 2);
      setLeader(state, VEX, 1, null, moves([leader, at("center", 3, 3)]));
      resolveLeaderAbilities(state, data);
      expect(centerParticipants(state).map((u) => u.id)).toContain(leader);
    });
  });

  describe("Feldkonflikt mit Beschwörungen (R-8.2)", () => {
    it("R-8.2: Vex und Morgra wollen dasselbe freie Feld belegen – beide scheitern und verpuffen", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      // Dasselbe Feld der Arena front:2-3: für Vex `right` (2, 4), für Morgra `left` (2, 4).
      expect(globalHexKey(state, VEX, at("right", 2, 4))).toBe(globalHexKey(state, MORGRA, at("left", 2, 4)));
      setLeader(state, VEX, 1, null, moves([id, at("right", 2, 4)]));
      setLeader(state, MORGRA, 1, null, { kind: "hex", arena: "left", cell: { col: 2, row: 4 } });
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_hex_conflict", from).map((e) => [e.player, e.hex])).toEqual(
        expect.arrayContaining([
          [VEX, at("right", 2, 4)],
          [MORGRA, at("left", 2, 4)],
        ]),
      );
      expect(eventsOf(state, "leader_ability_fizzled", from).map((e) => [e.player, e.reason]).sort()).toEqual([
        [VEX, "hexConflict"],
        [MORGRA, "hexConflict"],
      ].sort());
      expect(unit(state, id).shadowStep).toBeUndefined();
      expect(Object.values(state.units).filter((u) => u.kind === "token")).toEqual([]);
    });

    it("R-8.2: bei „Schar“ scheitert nur der Geist auf dem umkämpften Feld, die übrigen entstehen", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      setLeader(state, VEX, 1, null, moves([id, at("right", 2, 4)]));
      setLeader(state, MORGRA, 2, "horde", { kind: "hex", arena: "left", cell: { col: 2, row: 4 } });
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "leader_ability_resolved", from).map((e) => e.player)).toEqual([MORGRA]);
      const tokens = Object.values(state.units).filter((u) => u.kind === "token");
      expect(tokens).toHaveLength(1);
      expect(unitArenaHex(config, tokens[0] as Unit)?.cell).not.toEqual({ col: 2, row: 4 });
    });
  });

  describe("Folgen in derselben Runde", () => {
    it("R-8.2: move vor damage – Ilyras Blitzschlag trifft die Einheit auf ihrem neuen Feld in Ilyras Hälfte", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("left", 2, 1));
      // Vex' linke Arena ist Ilyras rechte (front:1-2); Ilyras Hälfte = Zeilen 0–2.
      setLeader(state, VEX, 1, null, moves([id, at("left", 2, 1)]));
      setLeader(state, ILYRA, 1, null, { kind: "hexes", hexes: [at("right", 2, 1)] });
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(eventsOf(state, "unit_damaged", from)).toEqual([expect.objectContaining({ unitId: id, cardId: "ilyra" })]);
    });

    it("R-16.6: Brann-artige Zonen-Ziele zählen die Einheit in der Arena, in der sie jetzt steht", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      setLeader(state, VEX, 1, null, moves([id, at("center", 3, 3)]));
      resolveLeaderAbilities(state, data);
      expect(preCombatAllies(state, config, VEX, { target: { kind: "zone", arenas: ["center"] } }, "zoneAllies").map((u) => u.id)).toEqual([id]);
      expect(preCombatAllies(state, config, VEX, { target: { kind: "zone", arenas: ["right"] } }, "zoneAllies")).toEqual([]);
    });

    it("R-16.6: das Ausgangsfeld ist für spätere Beschwörungen frei, das Zielfeld in der gegnerischen Hälfte belegt", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 0, 0));
      expect(zoneFreeLocations(state, config, MORGRA, "left")).toContainEqual(front("left", 0, 2));
      setLeader(state, VEX, 1, null, moves([id, at("right", 4, 3)]));
      resolveLeaderAbilities(state, data);
      expect(isArenaHexFree(state, config, VEX, at("right", 0, 0))).toBe(true);
      expect(zoneFreeLocations(state, config, VEX, "right")[0]).toEqual(front("right", 0, 0));
      // Morgras linke Zone: Arena-Feld (4, 3) = Zonenfeld (0, 2).
      expect(zoneFreeLocations(state, config, MORGRA, "left")).not.toContainEqual(front("left", 0, 2));
    });
  });

  describe("Rückkehr nach dem Aufräumen (R-16.6)", () => {
    it("R-16.6: nach einer ganzen Runde steht die Einheit wieder auf ihrem Ausgangsfeld", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1), "shieldwall_veteran");
      setLeader(state, VEX, 2, "ambush", moves([id, at("right", 2, 4)]));
      for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
      const from = state.log.length;
      advance(state, data);
      expect(eventsOf(state, "unit_shadow_stepped", from).map((e) => e.unitId)).toEqual([id]);
      const result = state.frontResults.find((r) => r.first === VEX);
      expect(result?.participants).toContain(id);
      expect(eventsOf(state, "unit_returned", from)).toEqual([
        expect.objectContaining({ player: VEX, unitId: id, from: at("right", 2, 4), to: front("right", 2, 1) }),
      ]);
      // Die Rückkehr folgt nach dem Aufräumen (Buffs schon verfallen).
      const cleared = state.log.findIndex((e, i) => i >= from && e.type === "unit_round_effects_cleared" && e.unitId === id);
      const returned = state.log.findIndex((e, i) => i >= from && e.type === "unit_returned");
      expect(cleared).toBeGreaterThan(-1);
      expect(returned).toBeGreaterThan(cleared);
      expect(unit(state, id).shadowStep).toBeUndefined();
      expect(unit(state, id).location).toEqual(front("right", 2, 1));
    });

    it("R-16.6: ist das Ausgangsfeld belegt, kommt die Einheit auf das nächste freie Feld derselben Zone", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 0, 0));
      unit(state, id).shadowStep = { hex: at("right", 0, 4) };
      placeUnit(state, VEX, front("right", 0, 0));
      placeUnit(state, VEX, front("right", 1, 0));
      returnShadowSteppedUnits(state, data);
      expect(unit(state, id).location).toEqual(front("right", 2, 0));
      expect(unit(state, id).shadowStep).toBeUndefined();
    });

    it("R-16.6: ist die ganze Zone belegt, kommt die Einheit in die Reserve", () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, { zone: "center", position: 0 });
      unit(state, id).shadowStep = { hex: at("right", 0, 4) };
      for (let position = 0; position < config.arenas.centerStartSlots; position++) placeUnit(state, VEX, { zone: "center", position });
      const from = state.log.length;
      returnShadowSteppedUnits(state, data);
      // Reserveplatz 0 ist von Vex' Anführer belegt.
      expect(unit(state, id).location).toEqual({ zone: "reserve", slot: 1 });
      expect(eventsOf(state, "unit_returned", from)).toEqual([expect.objectContaining({ unitId: id, to: { zone: "reserve", slot: 1 } })]);
    });
  });

  it("Determinismus: gleicher Schattenschritt, gleicher Zustand = gleiches Protokoll", () => {
    const run = (): GameEvent[] => {
      const state = emptyBoard();
      const a = placeUnit(state, VEX, front("right", 0, 0));
      const b = placeUnit(state, VEX, front("left", 1, 1));
      setLeader(state, VEX, 4, "double", moves([a, at("right", 0, 4)], [b, at("center", 3, 3)]));
      for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
      advance(state, data);
      return state.log;
    };
    expect(run()).toEqual(run());
  });
});
