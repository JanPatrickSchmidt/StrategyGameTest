import { describe, expect, it } from "vitest";
import type { Bot } from "./bots/bot";
import { GreedyBot } from "./bots/greedyBot";
import { RandomBot } from "./bots/randomBot";
import { playBotGame } from "./bots/runner";
import { loadGameData } from "./data";
import { auditPhase, EventAuditor, locationKey, takeSnapshot } from "./eventAudit";
import { ROUND_PHASES } from "./round";
import { createGame } from "./setup";
import { getPlayer, type GameEvent, type GameState, type Phase } from "./state";

const data = loadGameData();
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

function auditedGame(seed: number, makeBot: (seed: number, player: number) => Bot): { state: GameState; auditor: EventAuditor } {
  const auditor = new EventAuditor();
  const bots = [0, 1, 2, 3].map((p) => makeBot(seed * 10 + p, p));
  const state = playBotGame(data, { seed, bots, onGameCreated: auditor.start, onPhaseEnd: auditor.onPhaseEnd });
  return { state, auditor };
}

function eventsSince(state: GameState, from: number): GameEvent[] {
  return state.log.slice(from);
}

describe("R-19.1: Zustandsänderungen gegen Ereignisse (E16c3)", () => {
  it("R-19.1: GreedyBot-Partien (Seeds 1–20): Leben, Macht, Schatzkammer, Hand, Ablagestapel und Einheiten-Orte sind nach jeder Phase durch Ereignisse erklärt", () => {
    for (const seed of SEEDS) {
      const { state, auditor } = auditedGame(seed, (s) => new GreedyBot(s));
      expect(state.result).not.toBeNull();
      expect(auditor.phases).toBeGreaterThan(ROUND_PHASES.length);
      expect(auditor.findings, `Seed ${seed}`).toEqual([]);
    }
  }, 60000);

  it("R-19.1: RandomBot-Partien (Seeds 1–20): alle beobachteten Änderungen sind durch Ereignisse der Phase erklärt", () => {
    for (const seed of SEEDS) {
      const { auditor } = auditedGame(seed, (s) => new RandomBot(s));
      expect(auditor.findings, `Seed ${seed}`).toEqual([]);
    }
  }, 60000);

  it("R-19.1: gemischte Partien (zwei GreedyBots, zwei RandomBots, Seeds 1–20): keine Änderung ohne Ereignis", () => {
    for (const seed of SEEDS) {
      const { auditor } = auditedGame(seed, (s, p) => (p % 2 === 0 ? new GreedyBot(s) : new RandomBot(s)));
      expect(auditor.findings, `Seed ${seed}`).toEqual([]);
    }
  }, 60000);
});

describe("E16c3: Prüfwerkzeug auditPhase", () => {
  function base(): GameState {
    return createGame(data, undefined, 7);
  }

  it("R-19.1: Lebensverlust ohne Ereignis wird gemeldet, mit passendem Ereignis nicht", () => {
    const state = base();
    const before = takeSnapshot(state);
    getPlayer(state, 1).life -= 3;
    expect(auditPhase(before, takeSnapshot(state), [], "combatResolution")).toEqual([
      `combatResolution: life von Spieler 1 ist ${getPlayer(state, 1).life}, aus Ereignissen ${getPlayer(state, 1).life + 3}`,
    ]);
    const event: GameEvent = {
      round: 1,
      phase: "combatResolution",
      type: "breakthrough_damage",
      arena: "front:0-1",
      winner: 0,
      loser: 1,
      breakthrough: 1,
      baseDamage: 2,
      amount: 3,
      life: getPlayer(state, 1).life,
    };
    expect(auditPhase(before, takeSnapshot(state), [event], "combatResolution")).toEqual([]);
  });

  it("R-19.1: falscher absoluter Wert im Ereignis wird gemeldet (Schatzkammer)", () => {
    const state = base();
    const before = takeSnapshot(state);
    const p = getPlayer(state, 0);
    p.treasury += 2;
    const wrong: GameEvent = { round: 1, phase: "roundStart", type: "interest_paid", player: 0, amount: 2, treasury: p.treasury + 1 };
    const findings = auditPhase(before, takeSnapshot(state), [wrong], "roundStart");
    // Gemeldet werden der falsche Wert im Ereignis und der Endstand, der nicht zum gemeldeten Wert passt.
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("interest_paid meldet treasury");
    expect(findings[1]).toContain("treasury von Spieler 0");
  });

  it("R-19.1: Karte wandert ohne Ereignis von der Hand auf den Ablagestapel → zwei Befunde", () => {
    const state = base();
    const before = takeSnapshot(state);
    const p = getPlayer(state, 2);
    const card = p.hand.shift();
    expect(card).toBeDefined();
    p.discard.push(card as number);
    const findings = auditPhase(before, takeSnapshot(state), [], "cleanup");
    expect(findings.some((f) => f.startsWith("cleanup: Hand von Spieler 2"))).toBe(true);
    expect(findings.some((f) => f.startsWith("cleanup: Ablagestapel von Spieler 2"))).toBe(true);
    const event: GameEvent = { round: 1, phase: "cleanup", type: "hand_discarded", player: 2, cardInstanceIds: [card as number] };
    expect(auditPhase(before, takeSnapshot(state), [event], "cleanup")).toEqual([]);
  });

  it("R-19.1: Einheit wechselt ohne Ereignis den Ort, verschwindet oder erscheint → Befund", () => {
    const state = base();
    const before = takeSnapshot(state);
    const leader = state.units[getPlayer(state, 3).leader.unitId];
    expect(leader).toBeDefined();
    if (!leader) return;
    const from = leader.location;
    leader.location = { zone: "reserve", slot: 0 };
    expect(auditPhase(before, takeSnapshot(state), [], "reveal")).toEqual([`reveal: Einheit ${leader.id} steht auf reserve:0, aus Ereignissen ${locationKey(from)}`]);
    const moved: GameEvent = { round: 1, phase: "reveal", type: "unit_moved", player: 3, unitId: leader.id, from, to: { zone: "reserve", slot: 0 } };
    expect(auditPhase(before, takeSnapshot(state), [moved], "reveal")).toEqual([]);
    delete state.units[leader.id];
    expect(auditPhase(before, takeSnapshot(state), [], "reveal")).toHaveLength(1);
  });

  it("E16c3: onPhaseEnd läuft am Ende jeder Phase in Reihenfolge und verändert die Partie nicht (Determinismus)", () => {
    const phases: Phase[] = [];
    const bots = (seed: number): Bot[] => [0, 1, 2, 3].map((p) => new GreedyBot(seed * 10 + p));
    const observed = playBotGame(data, { seed: 3, bots: bots(3), onPhaseEnd: (_s, phase) => phases.push(phase) });
    const plain = playBotGame(data, { seed: 3, bots: bots(3) });
    expect(observed.log).toEqual(plain.log);
    expect(phases.slice(0, ROUND_PHASES.length)).toEqual([...ROUND_PHASES]);
    expect(phases.at(-1)).toMatch(/^(combatResolution|victoryCheck)$/);
    expect(phases).not.toContain("gameOver");
  });

  it("E16c3: Ereignisse einer Phase stammen aus dem Protokollabschnitt seit dem letzten Aufruf", () => {
    const state = base();
    const auditor = new EventAuditor();
    auditor.start(state);
    const from = state.log.length;
    getPlayer(state, 0).power += 1;
    state.log.push({ round: 1, phase: "roundStart", type: "power_gained", player: 0, amount: 1, power: getPlayer(state, 0).power });
    auditor.onPhaseEnd(state, "roundStart");
    expect(eventsSince(state, from)).toHaveLength(1);
    expect(auditor.findings).toEqual([]);
    getPlayer(state, 0).power += 1;
    auditor.onPhaseEnd(state, "planning");
    expect(auditor.findings).toEqual([`Runde 1, planning: power von Spieler 0 ist ${getPlayer(state, 0).power}, aus Ereignissen ${getPlayer(state, 0).power - 1}`]);
  });
});
