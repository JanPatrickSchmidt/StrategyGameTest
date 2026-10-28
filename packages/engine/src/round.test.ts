import { describe, expect, it } from "vitest";
import type { PlanningAction } from "./actions";
import { loadGameData } from "./data";
import { activePlayersInPriority, advance, priorityOrder, ROUND_PHASES, submitPlanning, submitPurchases } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameState, getPlayer, PLAYER_INDICES } from "./state";

const data = loadGameData();
const newGame = (seed = 3): GameState => createGame(data, defaultLeaders(data), seed);

function submitAllEmpty(state: GameState, kind: "planning" | "purchases"): void {
  for (const p of activePlayersInPriority(state)) {
    const r = kind === "planning" ? submitPlanning(state, p, []) : submitPurchases(state, p, { buys: [] });
    expect(r).toEqual({ ok: true });
  }
}

/** Spielt eine Runde ohne Aktionen und gibt die Phasen dieser Runde in Reihenfolge zurück. */
function playEmptyRound(state: GameState): void {
  expect(advance(state, data).waitingFor).toBe("planning");
  submitAllEmpty(state, "planning");
  expect(advance(state, data).waitingFor).toBe("purchases");
  submitAllEmpty(state, "purchases");
  expect(advance(state, data).waitingFor).toBe("planning");
}

function phasesOfRound(state: GameState, round: number): string[] {
  return state.log.filter((e) => e.type === "phase_started" && e.round === round).map((e) => (e.type === "phase_started" ? e.phase : ""));
}

describe("R-5: Rundenablauf", () => {
  it("R-5: eine Runde ohne Aktionen läuft vollständig durch, in genau der Phasenreihenfolge", () => {
    const state = newGame();
    playEmptyRound(state);
    expect(phasesOfRound(state, 1)).toEqual(ROUND_PHASES);
    expect(ROUND_PHASES).toEqual([
      "roundStart",
      "planning",
      "reveal",
      "leaderAbilities",
      "preCombatSpells",
      "combat",
      "combatResolution",
      "postCombatSpells",
      "buy",
      "cleanup",
      "victoryCheck",
    ]);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("planning");
    expect(phasesOfRound(state, 2)).toEqual(["roundStart", "planning"]);
    expect(state.log.filter((e) => e.type === "round_started").map((e) => e.round)).toEqual([2]);
  });

  it("R-5: mehrere leere Runden hintereinander, jede mit vollständiger Phasenfolge", () => {
    const state = newGame();
    for (let i = 0; i < 5; i++) playEmptyRound(state);
    for (let r = 1; r <= 5; r++) expect(phasesOfRound(state, r)).toEqual(ROUND_PHASES);
    expect(state.round).toBe(6);
  });

  it("R-5 Schritt 2: Planung wartet auf alle aktiven Spieler", () => {
    const state = newGame();
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [0, 1, 2, 3] });
    submitPlanning(state, 2, []);
    submitPlanning(state, 0, []);
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [1, 3] });
    expect(state.phase).toBe("planning");
    submitPlanning(state, 1, []);
    submitPlanning(state, 3, []);
    expect(advance(state, data)).toEqual({ waitingFor: "purchases", players: [0, 1, 2, 3] });
    expect(state.phase).toBe("buy");
  });

  it("R-5 Schritt 9: Kaufphase wartet auf alle aktiven Spieler", () => {
    const state = newGame();
    advance(state, data);
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitPurchases(state, 3, { buys: [] });
    expect(advance(state, data)).toEqual({ waitingFor: "purchases", players: [0, 1, 2] });
  });

  it("R-5: ausgeschiedene Spieler werden nicht erwartet und ziehen nicht", () => {
    const state = newGame();
    getPlayer(state, 1).eliminated = true;
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [0, 2, 3] });
    expect(getPlayer(state, 1).hand).toEqual([]);
    expect(submitPlanning(state, 1, [])).toEqual({ ok: false, reason: "playerEliminated" });
  });

  it("R-13.4 (vorläufig): mit nur einem aktiven Spieler endet die Partie bei der Siegprüfung", () => {
    const state = newGame();
    for (const p of [1, 2, 3] as const) getPlayer(state, p).eliminated = true;
    advance(state, data);
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitAllEmpty(state, "purchases");
    expect(advance(state, data)).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.phase).toBe("gameOver");
    expect(advance(state, data)).toEqual({ waitingFor: "nothing", gameOver: true });
  });
});

describe("R-6.3/R-12.1: Karten im Rundenlauf", () => {
  it("R-6.3: zu Rundenbeginn werden 5 Karten gezogen", () => {
    const state = newGame();
    advance(state, data);
    for (const p of state.players) expect(p.hand).toHaveLength(data.config.handSize);
  });

  it("R-12.1: beim Aufräumen gehen alle Handkarten auf den Ablagestapel; Runde 3 mischt nach", () => {
    const state = newGame();
    advance(state, data);
    const hand1 = [...getPlayer(state, 0).hand];
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitAllEmpty(state, "purchases");
    advance(state, data); // Aufräumen, Runde 2 beginnt und zieht
    const p = getPlayer(state, 0);
    expect(p.discard).toEqual(hand1);
    expect(p.hand).toHaveLength(5);
    expect(p.deck).toEqual([]);
    expect(state.log.some((e) => e.type === "hand_discarded" && e.player === 0 && e.round === 1)).toBe(true);
    // Runde 2 durchspielen: Runde 3 muss den Ablagestapel nachmischen.
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitAllEmpty(state, "purchases");
    advance(state, data);
    expect(p.hand).toHaveLength(5);
    expect(p.deck.length + p.hand.length + p.discard.length).toBe(10);
    expect(state.log.some((e) => e.type === "discard_reshuffled" && e.round === 3)).toBe(true);
  });

  it("R-12.2: Tokens werden beim Aufräumen entfernt", () => {
    const state = newGame();
    advance(state, data);
    state.units[99] = {
      id: 99,
      owner: 0,
      kind: "token",
      sourceId: "goblin_token",
      cardInstanceIds: [],
      stars: 1,
      xp: 0,
      wounded: false,
      location: { zone: "right", cell: { col: 0, row: 0 } },
    };
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitAllEmpty(state, "purchases");
    advance(state, data);
    expect(state.units[99]).toBeUndefined();
    expect(state.log.some((e) => e.type === "token_removed" && e.unitId === 99)).toBe(true);
    expect(Object.keys(state.units)).toHaveLength(4); // Anführer bleiben
  });
});

describe("R-7.9: Timeout", () => {
  it("R-7.9: wer keine Planung einreicht, plant eine leere Liste", () => {
    const state = newGame();
    advance(state, data);
    submitPlanning(state, 0, []);
    const r = advance(state, data, { timeout: true });
    // Timeout gilt nur für die Planung; danach wartet die Kaufphase normal.
    expect(r).toEqual({ waitingFor: "purchases", players: [0, 1, 2, 3] });
    const timeouts = state.log.filter((e) => e.type === "submission_timeout");
    expect(timeouts.map((e) => (e.type === "submission_timeout" ? [e.player, e.kind] : null))).toEqual([
      [1, "planning"],
      [2, "planning"],
      [3, "planning"],
    ]);
  });

  it("R-7.9: Timeout in der Kaufphase ergibt leere Käufe, die nächste Planung wartet wieder", () => {
    const state = newGame();
    advance(state, data, { timeout: true });
    const r = advance(state, data, { timeout: true });
    // Runde 2: wartende Spieler in Prioritätsreihenfolge (R-1.7).
    expect(r).toEqual({ waitingFor: "planning", players: [1, 2, 3, 0] });
    expect(state.round).toBe(2);
  });
});

describe("R-7: Eingaben und Ablehnungen", () => {
  it("R-7: Planung außerhalb der Planungsphase wird abgelehnt", () => {
    const state = newGame();
    expect(submitPlanning(state, 0, [])).toEqual({ ok: false, reason: "wrongPhase" });
    advance(state, data);
    submitAllEmpty(state, "planning");
    advance(state, data);
    expect(submitPlanning(state, 0, [])).toEqual({ ok: false, reason: "wrongPhase" });
    expect(state.log.filter((e) => e.type === "submission_rejected")).toHaveLength(2);
  });

  it("R-7: genau eine Planung pro Spieler und Runde", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPlanning(state, 0, [])).toEqual({ ok: true });
    expect(submitPlanning(state, 0, [])).toEqual({ ok: false, reason: "alreadySubmitted" });
  });

  it("R-11.1: Käufe nur in der Kaufphase, einmal pro Spieler, Form wird geprüft", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPurchases(state, 0, { buys: [] })).toEqual({ ok: false, reason: "wrongPhase" });
    submitAllEmpty(state, "planning");
    advance(state, data);
    expect(submitPurchases(state, 0, { buys: [1] } as unknown as { buys: string[] })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(submitPurchases(state, 0, { buys: [] })).toEqual({ ok: true });
    expect(submitPurchases(state, 0, { buys: [] })).toEqual({ ok: false, reason: "alreadySubmitted" });
  });

  it("unbekannte Spieler und kaputte Planungen werden abgelehnt", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPlanning(state, 7, [])).toEqual({ ok: false, reason: "unknownPlayer" });
    expect(submitPlanning(state, 0, "x" as unknown as PlanningAction[])).toEqual({ ok: false, reason: "malformed" });
  });

  it("R-7: ungültige Aktionen werden übersprungen und als action_rejected gemeldet", () => {
    const state = newGame();
    advance(state, data);
    const actions = [
      { type: "fly" },
      { type: "withdraw", amount: 1 },
    ] as unknown as PlanningAction[];
    submitPlanning(state, 0, actions);
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, []);
    advance(state, data);
    const rejected = state.log.filter((e) => e.type === "action_rejected");
    expect(rejected).toEqual([
      expect.objectContaining({ player: 0, kind: "planning", index: 0, action: "fly", reason: "unknownActionType", phase: "reveal" }),
      // Ausführung folgt in E6/E7.
      expect.objectContaining({ player: 0, kind: "planning", index: 1, action: "withdraw", reason: "notImplemented" }),
    ]);
  });

  it("R-18.2/R-8.1: Planungsinhalt ist bis zum Aufdecken privat, dann öffentlich", () => {
    const state = newGame();
    advance(state, data);
    const actions: PlanningAction[] = [{ type: "withdraw", amount: 2 }];
    submitPlanning(state, 0, actions);
    const submitted = state.log.filter((e) => e.type === "planning_submitted");
    expect(submitted).toEqual([expect.objectContaining({ player: 0, actionCount: 1 })]);
    expect(JSON.stringify(submitted)).not.toContain("withdraw");
    // Spätere Änderung am übergebenen Array wirkt nicht auf die eingereichte Planung.
    actions.push({ type: "withdraw", amount: 5 });
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, []);
    advance(state, data);
    const revealed = state.log.filter((e) => e.type === "planning_revealed");
    expect(revealed.map((e) => (e.type === "planning_revealed" ? e.player : -1))).toEqual([0, 1, 2, 3]);
    expect(revealed[0]).toEqual(expect.objectContaining({ phase: "reveal", actions: [{ type: "withdraw", amount: 2 }] }));
    expect(revealed[0]?.visibleTo).toBeUndefined();
  });

  it("R-11: Käufe werden bis zur Umsetzung in E6 abgelehnt und gemeldet", () => {
    const state = newGame();
    advance(state, data);
    submitAllEmpty(state, "planning");
    advance(state, data);
    submitPurchases(state, 0, { buys: ["silver"] });
    for (const p of [1, 2, 3] as const) submitPurchases(state, p, { buys: [] });
    advance(state, data);
    expect(state.log.filter((e) => e.type === "action_rejected")).toEqual([
      expect.objectContaining({ player: 0, kind: "purchases", index: 0, action: "silver", phase: "buy" }),
    ]);
  });
});

describe("R-1.7: Prioritätsreihenfolge", () => {
  it("R-1.7: Runde r beginnt mit Spieler (r-1) mod 4, aufsteigend zyklisch", () => {
    expect(priorityOrder(1)).toEqual([0, 1, 2, 3]);
    expect(priorityOrder(2)).toEqual([1, 2, 3, 0]);
    expect(priorityOrder(4)).toEqual([3, 0, 1, 2]);
    expect(priorityOrder(5)).toEqual([0, 1, 2, 3]);
    expect(() => priorityOrder(0)).toThrow(RangeError);
  });

  it("R-1.7: Aufdecken folgt der Prioritätsreihenfolge der Runde", () => {
    const state = newGame();
    playEmptyRound(state);
    submitAllEmpty(state, "planning");
    advance(state, data);
    const revealed = state.log.filter((e) => e.type === "planning_revealed" && e.round === 2);
    expect(revealed.map((e) => (e.type === "planning_revealed" ? e.player : -1))).toEqual([1, 2, 3, 0]);
  });

  it("R-1.7: aktive Spieler in Priorität ohne Ausgeschiedene", () => {
    const state = newGame();
    state.round = 3;
    getPlayer(state, 3).eliminated = true;
    expect(activePlayersInPriority(state)).toEqual([2, 0, 1]);
  });
});

describe("R-1.8: Determinismus", () => {
  it("R-1.8: gleicher Seed und gleiche Eingaben ergeben ein identisches Ereignisprotokoll über mehrere Runden", () => {
    const run = (): string => {
      const state = newGame(1234);
      for (let i = 0; i < 6; i++) {
        advance(state, data);
        for (const p of PLAYER_INDICES) submitPlanning(state, p, i % 2 === 0 ? [] : [{ type: "withdraw", amount: 1 }]);
        advance(state, data);
        for (const p of PLAYER_INDICES) submitPurchases(state, p, { buys: [] });
      }
      advance(state, data);
      return JSON.stringify(state.log);
    };
    expect(run()).toBe(run());
  });
});
