import { describe, expect, it } from "vitest";
import { type GameData, loadGameData } from "./data";
import { eliminatePlayers } from "./resolution";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import {
  type GameEvent,
  type GameState,
  getPlayer,
  PLAYER_INDICES,
  type PlayerIndex,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "./state";
import { checkEndOfRoundVictory, checkPowerVictory, placeByLifeThenPower } from "./victory";

const data = loadGameData();

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });
const center = (position: number): UnitLocation => ({ zone: "center", position });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(seed = 51, gameData: GameData = data): GameState {
  const state = createGame(gameData, defaultLeaders(gameData), seed);
  advance(state, gameData);
  for (const p of PLAYER_INDICES) {
    const leader = state.units[getPlayer(state, p).leader.unitId] as Unit;
    leader.location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit", stars: Unit["stars"] = 1): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = {
    id,
    owner: player,
    kind: "card",
    sourceId,
    cardInstanceIds: [instance],
    stars,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location,
  };
  return id;
}

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return state.log.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function playRound(state: GameState, gameData: GameData = data): ReturnType<typeof advance> {
  for (const p of PLAYER_INDICES) {
    if (!getPlayer(state, p).eliminated) submitPlanning(state, p, {});
  }
  return advance(state, gameData);
}

function phasesOfRound(state: GameState, round: number): string[] {
  return eventsOf(state, "phase_started")
    .filter((e) => e.round === round)
    .map((e) => e.phase);
}

/** Spieler manuell als ausgeschieden markieren (für Endspiel-Aufstellungen). */
function markEliminated(state: GameState, player: PlayerIndex, placement: number): void {
  const p = getPlayer(state, player);
  p.eliminated = true;
  p.placement = placement;
  p.life = 0;
  for (const unit of Object.values(state.units)) if (unit.owner === player) delete state.units[unit.id];
}

describe("R-13.3: Machtsieg", () => {
  it("R-13.3: wer 5 Machtpunkte erreicht, gewinnt sofort am Ende der Kampfauswertung", () => {
    const state = emptyBoard();
    const p0 = getPlayer(state, 0);
    p0.power = 4;
    p0.centerStreak = 2;
    placeUnit(state, 0, center(2));
    const result = playRound(state);
    expect(p0.power).toBe(5);
    expect(result).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.phase).toBe("gameOver");
    expect(state.result).toEqual({ reason: "power", round: 1, winners: [0] });
    const [ended] = eventsOf(state, "game_ended");
    expect(ended).toEqual(expect.objectContaining({ phase: "combatResolution", reason: "power", winners: [0] }));
    // „sofort“: kein Nachkampf, kein Rundenende, keine Siegprüfung mehr in dieser Runde.
    expect(phasesOfRound(state, 1).slice(-2)).toEqual(["combatResolution", "gameOver"]);
    expect(p0.placement).toBe(1);
    // Das Spielende kommt nach dem Machtpunkt.
    const powerIdx = state.log.findIndex((e) => e.type === "power_gained");
    expect(state.log.findIndex((e) => e.type === "game_ended")).toBeGreaterThan(powerIdx);
  });

  it("R-13.3: die anderen werden nach Leben platziert, Gleichstand: Machtpunkte, dann geteilt", () => {
    const state = emptyBoard();
    const p0 = getPlayer(state, 0);
    p0.power = 4;
    p0.centerStreak = 2;
    placeUnit(state, 0, center(2));
    getPlayer(state, 1).life = 10;
    getPlayer(state, 2).life = 20;
    getPlayer(state, 3).life = 10;
    getPlayer(state, 3).power = 1;
    playRound(state);
    expect(PLAYER_INDICES.map((p) => getPlayer(state, p).placement)).toEqual([1, 4, 2, 3]);
    expect(eventsOf(state, "game_ended")[0]?.placements).toEqual([1, 4, 2, 3]);
  });

  it("R-13.3: gleiches Leben und gleiche Machtpunkte – die Platzierung der anderen wird geteilt", () => {
    const state = emptyBoard();
    for (const p of [1, 2, 3] as const) getPlayer(state, p).life = 12;
    getPlayer(state, 0).power = 5;
    expect(checkPowerVictory(state, data)).toBe(true);
    expect(PLAYER_INDICES.map((p) => getPlayer(state, p).placement)).toEqual([1, 2, 2, 2]);
  });

  it("R-13.3: mit 4 Machtpunkten geht die Partie weiter", () => {
    const state = emptyBoard();
    getPlayer(state, 0).power = 3;
    getPlayer(state, 0).centerStreak = 2;
    placeUnit(state, 0, center(2));
    const result = playRound(state);
    expect(getPlayer(state, 0).power).toBe(4);
    expect(result).toEqual(expect.objectContaining({ waitingFor: "planning" }));
    expect(state.result).toBe(null);
    expect(eventsOf(state, "game_ended")).toEqual([]);
    expect(state.round).toBe(2);
  });

  it("R-13.3: die Schwelle kommt aus config.powerToWin", () => {
    const custom: GameData = { ...data, config: { ...data.config, powerToWin: 1 } };
    const state = emptyBoard(52, custom);
    getPlayer(state, 2).centerStreak = 2;
    placeUnit(state, 2, center(1));
    playRound(state, custom);
    expect(state.result).toEqual({ reason: "power", round: 1, winners: [2] });
  });

  it("R-13.3/R-13.1: wer in derselben Runde ausscheidet, gewinnt nicht mehr durch Macht (F51 a)", () => {
    const state = emptyBoard();
    const p1 = getPlayer(state, 1);
    p1.life = 1;
    p1.power = 5;
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    playRound(state);
    expect(p1.eliminated).toBe(true);
    expect(state.result).toBe(null);
    expect(state.phase).toBe("planning");
  });

  it("R-13.3: erreichen mehrere aktive Spieler gleichzeitig die Schwelle, teilen sie sich Platz 1 (F51 b)", () => {
    const state = emptyBoard();
    getPlayer(state, 0).power = 5;
    getPlayer(state, 2).power = 6;
    getPlayer(state, 1).life = 30;
    getPlayer(state, 3).life = 10;
    expect(checkPowerVictory(state, data)).toBe(true);
    expect(state.result?.winners).toEqual([0, 2]);
    expect(PLAYER_INDICES.map((p) => getPlayer(state, p).placement)).toEqual([1, 3, 1, 4]);
  });
});

describe("R-13.4: Letzter Spieler", () => {
  it("R-13.4: ist nur noch ein Spieler übrig, gewinnt er in der Siegprüfung am Ende der Runde", () => {
    const state = emptyBoard();
    markEliminated(state, 1, 4);
    markEliminated(state, 2, 3);
    getPlayer(state, 3).life = 1;
    // Bei 2 Spielern zwei Fronten zwischen denselben beiden (R-2.5); Spieler 3 verliert beide.
    placeUnit(state, 0, front("right", 2, 0), "recruit", 3);
    placeUnit(state, 0, front("left", 2, 0), "recruit", 3);
    const result = playRound(state);
    expect(getPlayer(state, 3).eliminated).toBe(true);
    expect(getPlayer(state, 3).placement).toBe(2);
    expect(result).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.result).toEqual({ reason: "lastPlayer", round: 1, winners: [0] });
    expect(getPlayer(state, 0).placement).toBe(1);
    const [ended] = eventsOf(state, "game_ended");
    expect(ended).toEqual(expect.objectContaining({ phase: "victoryCheck", placements: [1, 4, 3, 2] }));
    // Siegprüfung erst nach dem Rundenende (R-5 Schritt 12).
    expect(phasesOfRound(state, 1).slice(-4)).toEqual(["postCombatSpells", "cleanup", "victoryCheck", "gameOver"]);
  });

  it("R-13.4/R-13.2: scheiden alle übrigen in derselben Runde aus, hat Platz 1, wer nach R-13.2 vorne liegt (F51 c)", () => {
    const state = emptyBoard();
    markEliminated(state, 1, 4);
    markEliminated(state, 3, 3);
    getPlayer(state, 0).life = -2;
    getPlayer(state, 2).life = -1;
    eliminatePlayers(state, [5, 0, 5, 0]);
    expect(getPlayer(state, 0).placement).toBe(1);
    expect(getPlayer(state, 2).placement).toBe(1);
    expect(checkEndOfRoundVictory(state, data)).toBe(true);
    expect(state.result).toEqual({ reason: "allEliminated", round: 1, winners: [0, 2] });
  });

  it("R-13.4: mit zwei aktiven Spielern geht die Partie weiter", () => {
    const state = emptyBoard();
    markEliminated(state, 1, 4);
    markEliminated(state, 2, 3);
    expect(checkEndOfRoundVictory(state, data)).toBe(false);
    expect(state.result).toBe(null);
  });
});

describe("R-13.5: Rundenlimit", () => {
  it("R-13.5: nach Runde 30 endet die Partie, vorher nicht", () => {
    expect(data.config.maxRounds).toBe(30);
    const state = emptyBoard();
    for (let r = 1; r < 30; r++) {
      expect(playRound(state)).toEqual(expect.objectContaining({ waitingFor: "planning" }));
    }
    expect(state.round).toBe(30);
    expect(state.result).toBe(null);
    expect(playRound(state)).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.result?.reason).toBe("roundLimit");
    expect(state.result?.round).toBe(30);
    expect(eventsOf(state, "game_ended")[0]?.phase).toBe("victoryCheck");
  });

  it("R-13.5: Platzierung nach Leben, dann Machtpunkten, sonst geteilt; Ausgeschiedene behalten ihren Platz", () => {
    const custom: GameData = { ...data, config: { ...data.config, maxRounds: 2 } };
    const state = emptyBoard(53, custom);
    markEliminated(state, 3, 4);
    getPlayer(state, 0).life = 8;
    getPlayer(state, 1).life = 8;
    getPlayer(state, 1).power = 2;
    getPlayer(state, 2).life = 8;
    getPlayer(state, 2).power = 2;
    playRound(state, custom);
    expect(state.result).toBe(null);
    playRound(state, custom);
    expect(state.result).toEqual({ reason: "roundLimit", round: 2, winners: [1, 2] });
    expect(PLAYER_INDICES.map((p) => getPlayer(state, p).placement)).toEqual([3, 1, 1, 4]);
  });

  it("R-13.5: placeByLifeThenPower – mehr Leben vor mehr Machtpunkten", () => {
    const placements = placeByLifeThenPower(
      [
        { player: 0, life: 5, power: 4 },
        { player: 1, life: 6, power: 0 },
        { player: 2, life: 5, power: 1 },
      ],
      1,
    );
    expect([0, 1, 2].map((p) => placements.get(p as PlayerIndex))).toEqual([2, 1, 3]);
  });
});

describe("E12e: Partie bis zum Ende", () => {
  it("R-13.3: wer die Mitte hält, gewinnt nach 7 Runden durch Macht (Serie 3 bis 7 je +1)", () => {
    const state = emptyBoard();
    placeUnit(state, 0, center(2));
    for (let r = 1; r <= 6; r++) {
      expect(playRound(state)).toEqual(expect.objectContaining({ waitingFor: "planning" }));
    }
    expect(getPlayer(state, 0).power).toBe(4);
    expect(playRound(state)).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.result).toEqual({ reason: "power", round: 7, winners: [0] });
    // Nach dem Ende nimmt die Partie keine Planung mehr an.
    expect(submitPlanning(state, 1, {})).toEqual({ ok: false, reason: "wrongPhase" });
    expect(advance(state, data)).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(eventsOf(state, "game_ended")).toHaveLength(1);
  });

  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben dasselbe Protokoll bis zum Spielende", () => {
    const run = () => {
      const state = emptyBoard(54);
      placeUnit(state, 0, center(2));
      placeUnit(state, 1, front("right", 2, 0), "recruit", 2);
      for (let r = 0; r < 10 && state.result === null; r++) playRound(state);
      return state;
    };
    const a = run();
    const b = run();
    expect(a.result).not.toBe(null);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });
});
