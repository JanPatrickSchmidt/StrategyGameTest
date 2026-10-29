import { describe, expect, it } from "vitest";
import type { Planning, PlanningAction } from "./actions";
import { loadGameData } from "./data";
import { activePlayersInPriority, advance, priorityOrder, ROUND_PHASES, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameState, getPlayer, PLAYER_INDICES } from "./state";

const data = loadGameData();
const newGame = (seed = 3): GameState => createGame(data, defaultLeaders(data), seed);

const EMPTY: Planning = { play: [], buy: [], position: [] };

function submitAllEmpty(state: GameState): void {
  for (const p of activePlayersInPriority(state)) {
    expect(submitPlanning(state, p, EMPTY)).toEqual({ ok: true });
  }
}

/** Spielt eine Runde ohne Aktionen: genau ein Wartepunkt (Planung). */
function playEmptyRound(state: GameState): void {
  expect(advance(state, data).waitingFor).toBe("planning");
  submitAllEmpty(state);
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

  it("R-5: der Planungsblock ist der einzige Wartepunkt und wartet auf alle aktiven Spieler", () => {
    const state = newGame();
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [0, 1, 2, 3] });
    submitPlanning(state, 2, EMPTY);
    submitPlanning(state, 0, EMPTY);
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [1, 3] });
    expect(state.phase).toBe("planning");
    submitPlanning(state, 1, EMPTY);
    submitPlanning(state, 3, EMPTY);
    // Danach läuft die Runde ohne weiteren Halt bis zur Planung der nächsten Runde.
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [1, 2, 3, 0] });
    expect(state.round).toBe(2);
    expect((ROUND_PHASES as readonly string[]).includes("buy")).toBe(false);
  });

  it("R-5: ausgeschiedene Spieler werden nicht erwartet und ziehen nicht", () => {
    const state = newGame();
    getPlayer(state, 1).eliminated = true;
    const logStart = state.log.length;
    expect(advance(state, data)).toEqual({ waitingFor: "planning", players: [0, 2, 3] });
    submitAllEmpty(state);
    advance(state, data);
    const later = state.log.slice(logStart);
    expect(later.some((e) => e.type === "cards_drawn" && e.player === 1)).toBe(false);
    expect(later.some((e) => e.type === "cards_drawn" && e.player === 0)).toBe(true);
    expect(later.some((e) => e.type === "leader_xp_gained" && e.player === 1)).toBe(false);
    expect(submitPlanning(state, 1, EMPTY)).toEqual({ ok: false, reason: "playerEliminated" });
  });

  it("R-13.4 (vorläufig): mit nur einem aktiven Spieler endet die Partie bei der Siegprüfung", () => {
    const state = newGame();
    for (const p of [1, 2, 3] as const) getPlayer(state, p).eliminated = true;
    advance(state, data);
    submitAllEmpty(state);
    expect(advance(state, data)).toEqual({ waitingFor: "nothing", gameOver: true });
    expect(state.phase).toBe("gameOver");
    expect(advance(state, data)).toEqual({ waitingFor: "nothing", gameOver: true });
  });
});

describe("R-6.3/R-12: Karten im Rundenlauf", () => {
  it("R-6.3: zu Rundenbeginn wird nicht gezogen, die Hand stammt aus dem Aufbau (R-4.6)", () => {
    const state = newGame();
    const hands = state.players.map((p) => [...p.hand]);
    advance(state, data);
    for (const p of state.players) expect([...p.hand, ...p.played].sort((a, b) => a - b)).toEqual([...(hands[p.index] ?? [])].sort((a, b) => a - b));
    expect(state.log.some((e) => e.type === "cards_drawn" && e.phase === "roundStart")).toBe(false);
  });

  it("R-12.1/R-12.6: am Rundenende wird abgelegt und nachgezogen; Mischen erst, wenn das Deck nicht reicht", () => {
    const state = newGame();
    advance(state, data);
    const p = getPlayer(state, 0);
    const hand1 = [...p.hand, ...p.played];
    const deck1 = [...p.deck];
    submitAllEmpty(state);
    advance(state, data); // Rundenende Runde 1: ablegen, 5 nachziehen (Deck hat genau 5, kein Mischen)
    expect(p.discard).toEqual(hand1);
    expect([...p.hand, ...p.played].sort((a, b) => a - b)).toEqual([...deck1].sort((a, b) => a - b));
    expect(p.deck).toEqual([]);
    expect(state.log.some((e) => e.type === "hand_discarded" && e.player === 0 && e.round === 1)).toBe(true);
    expect(state.log.filter((e) => e.type === "cards_drawn" && e.player === 0 && e.round === 1 && e.phase === "cleanup")).toHaveLength(1);
    expect(state.log.some((e) => e.type === "discard_reshuffled" && e.round === 1)).toBe(false);
    // Rundenende Runde 2: Deck leer → Deck und Ablagestapel (10 Karten) werden gemischt.
    submitAllEmpty(state);
    advance(state, data);
    expect(p.hand.length + p.played.length).toBe(5);
    expect(p.discard).toEqual([]);
    expect(p.deck.length + p.hand.length + p.played.length).toBe(10);
    expect(state.log.filter((e) => e.type === "discard_reshuffled" && e.player === 0)).toEqual([
      expect.objectContaining({ round: 2, phase: "cleanup", size: 10 }),
    ]);
  });

  it("R-12.6: Bonuskarte der Mitte (R-10.4) wird beim Nachziehen am Rundenende mitgezogen", () => {
    const state = newGame();
    advance(state, data);
    getPlayer(state, 2).nextRound.cards = 1;
    submitAllEmpty(state);
    advance(state, data);
    const p = getPlayer(state, 2);
    expect(p.hand.length + p.played.length).toBe(6);
    expect(p.nextRound.cards).toBe(0);
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
    submitAllEmpty(state);
    advance(state, data);
    expect(state.units[99]).toBeUndefined();
    expect(state.log.some((e) => e.type === "token_removed" && e.unitId === 99)).toBe(true);
    expect(Object.keys(state.units)).toHaveLength(4); // Anführer bleiben
  });
});

describe("R-7.9: Timeout", () => {
  it("R-7.9: wer keine Planung einreicht, plant leere Abschnitte; die Runde läuft durch", () => {
    const state = newGame();
    advance(state, data);
    submitPlanning(state, 0, EMPTY);
    const r = advance(state, data, { timeout: true });
    // Timeout gilt nur für die aktuelle Planung; die nächste Runde wartet wieder.
    expect(r).toEqual({ waitingFor: "planning", players: [1, 2, 3, 0] });
    const timeouts = state.log.filter((e) => e.type === "submission_timeout");
    expect(timeouts.map((e) => (e.type === "submission_timeout" ? e.player : null))).toEqual([1, 2, 3]);
    const revealed = state.log.filter((e) => e.type === "planning_revealed" && e.player === 2);
    expect(revealed).toEqual([expect.objectContaining({ planning: EMPTY })]);
  });
});

describe("R-7: Eingaben und Ablehnungen", () => {
  it("R-7: Planung außerhalb der Planungsphase wird abgelehnt", () => {
    const state = newGame();
    expect(submitPlanning(state, 0, EMPTY)).toEqual({ ok: false, reason: "wrongPhase" });
    advance(state, data);
    submitAllEmpty(state);
    expect(submitPlanning(state, 0, EMPTY)).toEqual({ ok: false, reason: "alreadySubmitted" });
    state.phase = "reveal";
    expect(submitPlanning(state, 1, EMPTY)).toEqual({ ok: false, reason: "wrongPhase" });
    expect(state.log.filter((e) => e.type === "submission_rejected")).toHaveLength(3);
  });

  it("R-7: genau eine Planung pro Spieler und Runde", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPlanning(state, 0, EMPTY)).toEqual({ ok: true });
    expect(submitPlanning(state, 0, EMPTY)).toEqual({ ok: false, reason: "alreadySubmitted" });
  });

  it("R-5: Planung mit drei Abschnitten; fehlende Abschnitte sind leer, falsche Form wird abgelehnt", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPlanning(state, 0, { buy: [{ type: "buy", cardId: "silver" }] })).toEqual({ ok: true });
    expect(state.pendingPlanning[0]).toEqual({ play: [], buy: [{ type: "buy", cardId: "silver" }], position: [] });
    expect(submitPlanning(state, 1, [] as unknown as Planning)).toEqual({ ok: false, reason: "malformed" });
    expect(submitPlanning(state, 1, { play: "x" } as unknown as Planning)).toEqual({ ok: false, reason: "malformed" });
    expect(submitPlanning(state, 1, { play: [], shop: [] } as unknown as Planning)).toEqual({ ok: false, reason: "malformed" });
    expect(submitPlanning(state, 1, null as unknown as Planning)).toEqual({ ok: false, reason: "malformed" });
    expect(submitPlanning(state, 1, {})).toEqual({ ok: true });
    expect(state.log.filter((e) => e.type === "planning_submitted").map((e) => (e.type === "planning_submitted" ? e.actionCount : -1))).toEqual([1, 0]);
  });

  it("unbekannte Spieler und kaputte Planungen werden abgelehnt", () => {
    const state = newGame();
    advance(state, data);
    expect(submitPlanning(state, 7, EMPTY)).toEqual({ ok: false, reason: "unknownPlayer" });
    expect(submitPlanning(state, 0, "x" as unknown as Planning)).toEqual({ ok: false, reason: "malformed" });
  });

  it("R-7: ungültige Aktionen werden übersprungen und als action_rejected gemeldet", () => {
    const state = newGame();
    advance(state, data);
    const play = [{ type: "fly" }, { type: "chooseBranch", branchId: "x" }, null] as unknown as PlanningAction[];
    submitPlanning(state, 0, { play });
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, EMPTY);
    advance(state, data);
    const rejected = state.log.filter((e) => e.type === "action_rejected");
    expect(rejected).toEqual([
      expect.objectContaining({ player: 0, section: "play", index: 0, action: "fly", reason: "unknownActionType", phase: "reveal" }),
      // Ausführung folgt in E7c.
      expect.objectContaining({ player: 0, section: "play", index: 1, action: "chooseBranch", reason: "notImplemented" }),
      expect.objectContaining({ player: 0, section: "play", index: 2, reason: "malformed" }),
    ]);
  });

  it("R-18.2/R-8.1: Planungsinhalt ist bis zum Aufdecken privat, dann öffentlich", () => {
    const state = newGame();
    advance(state, data);
    const actions: PlanningAction[] = [{ type: "withdraw", amount: 2 }];
    submitPlanning(state, 0, { play: actions });
    const submitted = state.log.filter((e) => e.type === "planning_submitted");
    expect(submitted).toEqual([expect.objectContaining({ player: 0, actionCount: 1 })]);
    expect(JSON.stringify(submitted)).not.toContain("withdraw");
    // Spätere Änderung am übergebenen Array wirkt nicht auf die eingereichte Planung.
    actions.push({ type: "withdraw", amount: 5 });
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, EMPTY);
    advance(state, data);
    const revealed = state.log.filter((e) => e.type === "planning_revealed");
    expect(revealed.map((e) => (e.type === "planning_revealed" ? e.player : -1))).toEqual([0, 1, 2, 3]);
    expect(revealed[0]).toEqual(
      expect.objectContaining({ phase: "reveal", planning: { play: [{ type: "withdraw", amount: 2 }], buy: [], position: [] } }),
    );
    expect(revealed[0]?.visibleTo).toBeUndefined();
  });

  it("R-11: unbekannte Käufe werden abgelehnt und gemeldet", () => {
    const state = newGame();
    advance(state, data);
    submitPlanning(state, 0, { buy: [{ type: "buy", cardId: "dragon" }, { type: "buy", cardId: 5 } as unknown as PlanningAction] });
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, EMPTY);
    advance(state, data);
    expect(state.log.filter((e) => e.type === "action_rejected")).toEqual([
      expect.objectContaining({ player: 0, section: "buy", index: 0, action: "buy", phase: "reveal", reason: "unknownCard" }),
      expect.objectContaining({ player: 0, section: "buy", index: 1, action: "buy", reason: "malformed" }),
    ]);
  });

  it("R-5/R-7/R-7b/R-11: Aktionen nur im passenden Abschnitt, Entnahme in jedem", () => {
    const state = newGame();
    advance(state, data);
    getPlayer(state, 0).treasury = 6;
    submitPlanning(state, 0, {
      play: [{ type: "buy", cardId: "silver" }, { type: "moveUnit", unitId: 1, to: { zone: "reserve", slot: 0 } }, { type: "withdraw", amount: 1 }],
      buy: [{ type: "heal", unitId: 1 }, { type: "setLeaderAbility", target: { kind: "none" } }, { type: "withdraw", amount: 1 }],
      position: [
        { type: "playUnit", cardInstanceId: 1, to: { zone: "reserve", slot: 0 } },
        { type: "setSpell", cardInstanceId: 1, slot: "pre", target: { kind: "none" } },
        { type: "chooseBranch", branchId: "x" },
        { type: "withdraw", amount: 1 },
      ],
    });
    for (const p of [1, 2, 3] as const) submitPlanning(state, p, EMPTY);
    advance(state, data);
    const rejected = state.log.filter((e) => e.type === "action_rejected");
    expect(rejected.map((e) => (e.type === "action_rejected" ? [e.section, e.index, e.reason] : null))).toEqual([
      ["play", 0, "wrongSection"],
      ["play", 1, "wrongSection"],
      ["buy", 0, "wrongSection"],
      ["buy", 1, "wrongSection"],
      ["position", 0, "wrongSection"],
      ["position", 1, "wrongSection"],
      ["position", 2, "wrongSection"],
    ]);
    expect(state.log.filter((e) => e.type === "gold_withdrawn" && e.player === 0)).toHaveLength(3);
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
    submitAllEmpty(state);
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
        for (const p of PLAYER_INDICES) {
          submitPlanning(
            state,
            p,
            i % 2 === 0 ? EMPTY : { play: [{ type: "withdraw", amount: 1 }], buy: [{ type: "buy", cardId: "silver" }], position: [] },
          );
        }
      }
      advance(state, data);
      return JSON.stringify(state.log);
    };
    expect(run()).toBe(run());
  });
});
