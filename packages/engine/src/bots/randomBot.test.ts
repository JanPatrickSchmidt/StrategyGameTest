import { describe, expect, it } from "vitest";
import { PLANNING_SECTIONS } from "../actions";
import { loadGameData } from "../data";
import { createRngState, shuffleInPlace } from "../rng";
import { advance, PlanningDraft, submitPlanning } from "../round";
import { createGame } from "../setup";
import type { GameState, PlayerIndex } from "../state";
import { candidateActions } from "./candidates";
import { RandomBot } from "./randomBot";
import { playBotGame } from "./runner";

const data = loadGameData();

function randomBots(seed: number): RandomBot[] {
  return [0, 1, 2, 3].map((p) => new RandomBot(seed * 4 + p + 1));
}

function withoutLog(state: GameState): string {
  return JSON.stringify({ ...state, log: [] });
}

function planningState(seed: number): GameState {
  const state = createGame(data, undefined, seed);
  advance(state, data);
  return state;
}

describe("PlanningDraft (E14)", () => {
  it("R-8.1: der Entwurf verändert den Originalzustand nicht", () => {
    const state = planningState(3);
    const before = JSON.stringify(state);
    new RandomBot(9).plan(state, data, 0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("R-5: abgeschlossene Abschnitte lassen sich nicht wieder öffnen", () => {
    const draft = new PlanningDraft(planningState(1), data, 0);
    draft.enter("buy");
    expect(draft.section).toBe("buy");
    expect(() => draft.enter("play")).toThrow();
  });

  it("R-7: abgelehnte Kandidaten verändern den Entwurf nicht", () => {
    const rng = createRngState(42);
    for (const seed of [1, 2]) {
      const state = planningState(seed);
      for (const player of [0, 1, 2, 3] as PlayerIndex[]) {
        const draft = new PlanningDraft(state, data, player);
        for (const section of PLANNING_SECTIONS) {
          draft.enter(section);
          const candidates = shuffleInPlace(rng, candidateActions(draft, data, rng)).slice(0, 120);
          for (const action of candidates) {
            const before = withoutLog(draft.state);
            const reason = draft.attempt(action);
            if (reason !== null) expect(withoutLog(draft.state)).toBe(before);
          }
        }
      }
    }
  });

  it("R-8.1: eine Planung aus dem Entwurf wird beim Aufdecken ohne Ablehnung ausgeführt", () => {
    const state = planningState(5);
    const bots = randomBots(5);
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      expect(submitPlanning(state, p, (bots[p] as RandomBot).plan(state, data, p))).toEqual({ ok: true });
    }
    advance(state, data);
    expect(state.log.filter((e) => e.type === "action_rejected")).toEqual([]);
    expect(state.log.some((e) => e.type === "unit_played" || e.type === "purchase_paid")).toBe(true);
  });
});

describe("RandomBot (E14a)", () => {
  it("E14: vier RandomBots spielen vollständige Partien bis zum Spielende (R-13)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = playBotGame(data, { seed, bots: randomBots(seed) });
      expect(state.phase).toBe("gameOver");
      expect(state.result).not.toBeNull();
      expect(state.round).toBeLessThanOrEqual(data.config.maxRounds);
    }
  });

  it("E14: RandomBot plant nur gültige Aktionen (keine Ablehnung beim Aufdecken in ganzen Partien)", () => {
    for (const seed of [11, 12, 13]) {
      const state = playBotGame(data, { seed, bots: randomBots(seed) });
      const rejected = state.log.filter((e) => e.type === "action_rejected" || e.type === "submission_rejected");
      expect(rejected).toEqual([]);
    }
  });

  it("E14: RandomBot nutzt verschiedene Aktionsarten", () => {
    const state = playBotGame(data, { seed: 21, bots: randomBots(21) });
    const types = new Set(state.log.map((e) => e.type));
    for (const t of ["unit_played", "purchase_paid", "unit_moved"]) expect(types).toContain(t);
  });

  it("R-1.8: gleicher Seed und gleiche Bot-Seeds ergeben dasselbe Ereignisprotokoll", () => {
    const a = playBotGame(data, { seed: 7, bots: randomBots(7) });
    const b = playBotGame(data, { seed: 7, bots: randomBots(7) });
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    const c = playBotGame(data, { seed: 7, bots: randomBots(8) });
    expect(JSON.stringify(c.log)).not.toBe(JSON.stringify(a.log));
  });
});
