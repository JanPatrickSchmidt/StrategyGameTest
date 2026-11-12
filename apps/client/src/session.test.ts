import { describe, expect, it } from "vitest";
import { loadGameData } from "@game/engine";
import { botSeed, GameSession, HUMAN } from "./session";

const data = loadGameData();

describe("C1: Partie im Browser gegen Bots", () => {
  it("C1: eine neue Partie läuft bis zur Planung der ersten Runde und wartet auf den Menschen", () => {
    const session = new GameSession(data, { seed: 1 });
    expect(session.status).toBe("waitingForHuman");
    expect(session.state.round).toBe(1);
    expect(session.state.phase).toBe("planning");
    expect(session.state.pendingPlanning[HUMAN] ?? null).toBeNull();
  });

  it("C1: die drei Bots haben ihre Planung schon eingereicht", () => {
    const session = new GameSession(data, { seed: 1 });
    for (const player of [1, 2, 3]) expect(session.state.pendingPlanning[player]).not.toBeNull();
  });

  it("R-7.9: eine leere Planung des Menschen führt in die Planung der nächsten Runde", () => {
    const session = new GameSession(data, { seed: 2 });
    expect(session.pass()).toEqual({ ok: true });
    expect(session.status).toBe("waitingForHuman");
    expect(session.state.round).toBe(2);
    expect(session.state.phase).toBe("planning");
  });

  it("C1: der Autopilot plant eine Runde für den Menschen", () => {
    const session = new GameSession(data, { seed: 3 });
    expect(session.autopilot()).toEqual({ ok: true });
    expect(session.state.round).toBe(2);
    const played = session.state.log.filter((e) => e.type === "unit_played" && e.player === HUMAN);
    expect(played.length).toBeGreaterThan(0);
  });

  it("R-13: mit dem Autopiloten endet die Partie mit einem Ergebnis, danach nimmt sie keine Planung mehr an", () => {
    const session = new GameSession(data, { seed: 4 });
    session.autopilotToEnd();
    expect(session.status).toBe("gameOver");
    expect(session.state.phase).toBe("gameOver");
    expect(session.state.result).not.toBeNull();
    expect(session.state.round).toBeLessThanOrEqual(data.config.maxRounds);
    expect(session.pass()).toEqual({ ok: false, reason: "wrongPhase" });
    expect(session.autopilot()).toEqual({ ok: false, reason: "wrongPhase" });
  });

  it("C1: nur leere Planungen des Menschen – die Bots spielen nach seinem Ausscheiden allein zu Ende", () => {
    const session = new GameSession(data, { seed: 5 });
    let guard = 0;
    while (session.status === "waitingForHuman" && guard++ < data.config.maxRounds + 1) session.pass();
    expect(session.status).toBe("gameOver");
    expect(session.state.result).not.toBeNull();
  });

  it("C1: gleicher Seed und gleiche Eingaben ergeben dasselbe Ereignisprotokoll (deterministisch)", () => {
    const play = (): unknown[] => {
      const session = new GameSession(data, { seed: 7 });
      session.autopilot();
      session.pass();
      session.autopilot();
      return session.state.log;
    };
    expect(play()).toEqual(play());
  });

  it("C1: Bots verschiedener Plätze bekommen verschiedene Seeds", () => {
    const seeds = new Set([0, 1, 2, 3].map((p) => botSeed(9, p as 0 | 1 | 2 | 3)));
    expect(seeds.size).toBe(4);
  });

  it("R-18.3: die Sicht des Menschen enthält keine fremden Handkarten", () => {
    const session = new GameSession(data, { seed: 1 });
    const view = session.view();
    expect(view.viewer).toBe(HUMAN);
    for (const entry of view.players) expect("hand" in entry).toBe(entry.index === HUMAN);
  });
});
