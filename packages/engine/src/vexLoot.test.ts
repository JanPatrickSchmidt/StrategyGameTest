import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex } from "./actions";
import { runFrontWinEffects } from "./aftermath";
import { runCombatPhase } from "./center";
import { loadGameData } from "./data";
import { resetLeaderAbilities } from "./leader";
import { resolveLeaderAbilities } from "./leaderAbilities";
import { advance } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type FrontResult, type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

const data = loadGameData();
// Standard-Anführer: 0 Brann, 1 Ilyra, 2 Vex, 3 Morgra. Vex' rechte Frontarena ist `front:2-3` (Vex Zeilen 0–2,
// Morgra Zeilen 3–5), die linke `front:1-2` (Ilyra Zeilen 0–2, Vex Zeilen 3–5).
const VEX: PlayerIndex = 2;
const MORGRA: PlayerIndex = 3;
const LOOT = { 2: 2, 3: 3, 4: 4 } as const;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const at = (arena: ArenaHex["arena"], col: number, row: number): ArenaHex => ({ arena, cell: { col, row } });
const moves = (...list: [UnitId, ArenaHex][]): ActionTarget => ({ kind: "moveUnits", moves: list.map(([unitId, to]) => ({ unitId, to })) });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 47): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, stars: 1 | 2 | 3 = 1): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: "recruit", owner: player };
  state.units[id] = { id, owner: player, kind: "card", sourceId: "recruit", cardInstanceIds: [instance], stars, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function setLoot(state: GameState, level: 2 | 3 | 4, target: ActionTarget): void {
  const p = getPlayer(state, VEX);
  p.leader.level = level;
  p.leader.branchId = "loot";
  p.leaderAbility = target;
}

/** Löst die Anführer-Fähigkeiten und die Kampfphase aus; liefert den Zuwachs der Schatzkammer von Vex. */
function playRound(state: GameState): { gained: number; from: number; fronts: FrontResult[] } {
  const before = getPlayer(state, VEX).treasury;
  const from = state.log.length;
  resolveLeaderAbilities(state, data);
  const { fronts } = runCombatPhase(state, data);
  return { gained: getPlayer(state, VEX).treasury - before, from, fronts };
}

function frontOf(fronts: FrontResult[], arena: string): FrontResult {
  const r = fronts.find((f) => f.arena === arena);
  if (!r) throw new Error(`Front ${arena} fehlt`);
  return r;
}

describe("E11c4b: Vex' „Beute“ – onFrontWinOfChosen (R-8.2, R-10.3, R-16.6)", () => {
  it("R-8.2: bei der Auflösung wird der Auslöser für die gewählte Einheit vorgemerkt", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("right", 2, 1));
    setLoot(state, 2, moves([id, at("right", 2, 4)]));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_trigger_armed", from)).toEqual([
      expect.objectContaining({ player: VEX, leaderId: "vex", trigger: "onFrontWinOfChosen", unitIds: [id] }),
    ]);
    expect(getPlayer(state, VEX).chosenFrontWinTrigger).toMatchObject({ leaderId: "vex", unitIds: [id] });
  });

  for (const level of [2, 3, 4] as const) {
    it(`R-10.3: Stufe ${level} – gewinnt die Front der gewählten Einheit im Kampf, kommen ${LOOT[level]} Gold sofort in die Schatzkammer`, () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1), 3);
      placeUnit(state, MORGRA, front("left", 2, 1));
      setLoot(state, level, moves([id, at("right", 2, 3)]));
      const { gained, from, fronts } = playRound(state);
      const r = frontOf(fronts, "front:2-3");
      expect(r).toMatchObject({ outcome: "combat", winner: VEX });
      expect(gained).toBe(LOOT[level]);
      expect(eventsOf(state, "leader_trigger_fired", from)).toEqual([
        expect.objectContaining({ player: VEX, leaderId: "vex", trigger: "onFrontWinOfChosen", arena: "front:2-3", unitIds: [id] }),
      ]);
      const fired = state.log.findIndex((e, i) => i >= from && e.type === "leader_trigger_fired");
      expect(state.log[fired + 1]).toMatchObject({ type: "gold_gained", player: VEX, amount: LOOT[level], treasury: getPlayer(state, VEX).treasury });
    });

    it(`R-10.3: Stufe ${level} – auch bei leerer Front (Gegenseite ohne Einheiten)`, () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      setLoot(state, level, moves([id, at("right", 2, 4)]));
      const { gained, fronts } = playRound(state);
      expect(frontOf(fronts, "front:2-3")).toMatchObject({ outcome: "emptyFront", winner: VEX });
      expect(gained).toBe(LOOT[level]);
    });

    it(`R-16.6: Stufe ${level} – verlorene Front: keine Beute`, () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      placeUnit(state, MORGRA, front("left", 2, 1), 3);
      placeUnit(state, MORGRA, front("left", 1, 1), 3);
      setLoot(state, level, moves([id, at("right", 2, 3)]));
      const { gained, from, fronts } = playRound(state);
      expect(frontOf(fronts, "front:2-3").winner).toBe(MORGRA);
      expect(gained).toBe(0);
      expect(eventsOf(state, "leader_trigger_fired", from)).toEqual([]);
    });

    it(`R-16.6: Stufe ${level} – in die Mitte versetzt: keine Beute, auch wenn Vex die Mitte hält und eine andere Front gewinnt`, () => {
      const state = emptyBoard();
      const id = placeUnit(state, VEX, front("right", 2, 1));
      placeUnit(state, VEX, front("right", 0, 0));
      setLoot(state, level, moves([id, at("center", 3, 3)]));
      const { gained, from, fronts } = playRound(state);
      expect(frontOf(fronts, "front:2-3")).toMatchObject({ winner: VEX });
      expect(frontOf(fronts, "front:2-3").participants).not.toContain(id);
      expect(state.centerResult).toMatchObject({ holder: VEX });
      expect(gained).toBe(0);
      expect(eventsOf(state, "leader_trigger_fired", from)).toEqual([]);
    });
  }

  it("R-1.9: scheitert die Bewegung (Feld besetzt), zählt die gewählte Einheit trotzdem an ihrer eigenen Front", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("right", 2, 1));
    placeUnit(state, VEX, front("right", 2, 2));
    // Zielfeld = eigene Einheit auf Zone right (2, 2) → Arena-Feld (2, 2) ist besetzt.
    setLoot(state, 3, moves([id, at("right", 2, 2)]));
    const { gained, from } = playRound(state);
    expect(eventsOf(state, "leader_ability_move_blocked", from)).toMatchObject([{ unitId: id, reason: "hexOccupied" }]);
    expect(gained).toBe(3);
  });

  it("R-16.6: eine Einheit der linken Front, die in die rechte Frontarena versetzt wird, bringt Beute nur dort", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, front("left", 1, 1));
    setLoot(state, 2, moves([id, at("right", 1, 4)]));
    const { gained, from, fronts } = playRound(state);
    expect(frontOf(fronts, "front:1-2").participants).not.toContain(id);
    expect(frontOf(fronts, "front:2-3")).toMatchObject({ winner: VEX });
    expect(eventsOf(state, "leader_trigger_fired", from)).toMatchObject([{ arena: "front:2-3" }]);
    expect(gained).toBe(2);
  });

  it("R-8.2: verpufft die Fähigkeit (gewählte Einheit in der Reserve), wird kein Auslöser vorgemerkt", () => {
    const state = emptyBoard();
    const id = placeUnit(state, VEX, { zone: "reserve", slot: 1 });
    placeUnit(state, VEX, front("right", 0, 0));
    setLoot(state, 4, moves([id, at("right", 2, 4)]));
    const { gained, from } = playRound(state);
    expect(eventsOf(state, "leader_ability_fizzled", from)).toMatchObject([{ player: VEX, reason: "noValidTarget" }]);
    expect(eventsOf(state, "leader_trigger_armed", from)).toEqual([]);
    expect(gained).toBe(0);
  });

  describe("Auswertung nach dem Kampf (runFrontWinEffects)", () => {
    function armed(unitIds: UnitId[]): GameState {
      const state = emptyBoard();
      getPlayer(state, VEX).chosenFrontWinTrigger = {
        leaderId: "vex",
        unitIds,
        effects: [{ op: "gainGold", amount: 3, when: "now", to: "treasury" }],
      };
      return state;
    }
    const result = (winner: PlayerIndex | null, participants: UnitId[]): FrontResult => ({
      round: 1,
      arena: "front:2-3",
      first: VEX,
      second: MORGRA,
      outcome: "combat",
      winner,
      ticks: 10,
      participants,
      survivors: [],
      winnerBreakthrough: 0,
      wounded: [],
    });

    it("F46: auch eine im Kampf gestorbene gewählte Einheit zählt (Teilnahme reicht, wie onFrontWin, F31)", () => {
      const state = armed([7]);
      const before = getPlayer(state, VEX).treasury;
      runFrontWinEffects(state, data, [result(VEX, [7, 8])]);
      expect(getPlayer(state, VEX).treasury - before).toBe(3);
    });

    it("F46: mehrere gewählte Einheiten an derselben Front: Beute nur einmal je Front", () => {
      const state = armed([7, 9]);
      const before = getPlayer(state, VEX).treasury;
      const from = state.log.length;
      runFrontWinEffects(state, data, [result(VEX, [7, 8, 9])]);
      expect(getPlayer(state, VEX).treasury - before).toBe(3);
      expect(eventsOf(state, "leader_trigger_fired", from)).toMatchObject([{ unitIds: [7, 9] }]);
    });

    it("R-16.6: Unentschieden oder Sieg des Gegners: keine Beute", () => {
      for (const winner of [null, MORGRA]) {
        const state = armed([7]);
        const before = getPlayer(state, VEX).treasury;
        runFrontWinEffects(state, data, [result(winner, [7, 8])]);
        expect(getPlayer(state, VEX).treasury - before).toBe(0);
      }
    });

    it("R-16.4: der Auslöser verfällt mit der Fähigkeit beim Aufräumen", () => {
      const state = armed([7]);
      getPlayer(state, VEX).leaderAbility = { kind: "none" };
      resetLeaderAbilities(state);
      expect(getPlayer(state, VEX).chosenFrontWinTrigger).toBeUndefined();
      const before = getPlayer(state, VEX).treasury;
      runFrontWinEffects(state, data, [result(VEX, [7])]);
      expect(getPlayer(state, VEX).treasury - before).toBe(0);
    });
  });
});
