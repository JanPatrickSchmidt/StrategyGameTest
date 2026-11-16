import { describe, expect, it } from "vitest";
import type { Bot } from "./bots/bot";
import { GreedyBot } from "./bots/greedyBot";
import { RandomBot } from "./bots/randomBot";
import { playBotGame } from "./bots/runner";
import { loadGameData } from "./data";
import { auditPhase, EventAuditor, locationKey, takeSnapshot } from "./eventAudit";
import { ROUND_PHASES } from "./round";
import { createGame } from "./setup";
import { getPlayer, type GameEvent, type GameState, type Phase, type SetSpell, type Unit } from "./state";

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
  it("R-19.1: GreedyBot-Partien (Seeds 1–20): der ganze geprüfte Zustand (Spieler, Stapel, Einheiten, Anführer, Zauber, Serien) ist nach jeder Phase durch Ereignisse erklärt", () => {
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

describe("P9: Schnappschuss deckt den ganzen Zustand ab (R-19.1)", () => {
  function base(): GameState {
    return createGame(data, undefined, 7);
  }
  function firstUnit(state: GameState): Unit {
    const unit = Object.values(state.units)[0];
    if (!unit) throw new Error("keine Einheit");
    return unit;
  }

  it("R-19.1: Bot-Partien enthalten die neu geprüften Ereignisarten (Einheiten-XP, Aufstieg, Ast, Zauber, Stapel, Mischen, Serien, Rundenvorrat)", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { state } = auditedGame(seed, (s, p) => (p % 2 === 0 ? new GreedyBot(s) : new RandomBot(s)));
      for (const e of state.log) seen.add(e.type);
    }
    for (const type of ["unit_xp_gained", "leader_leveled_up", "branch_chosen", "spell_set", "spell_discarded", "pile_changed", "discard_reshuffled", "round_outcome", "center_held", "gold_deposited"]) {
      expect(seen.has(type), type).toBe(true);
    }
  }, 60000);

  it("R-19.1: Verwundung ohne Ereignis wird gemeldet, mit unit_wounded nicht", () => {
    const state = base();
    const before = takeSnapshot(state);
    const unit = firstUnit(state);
    unit.wounded = true;
    expect(auditPhase(before, takeSnapshot(state), [], "combatResolution")).toEqual([`combatResolution: Einheit ${unit.id} ist verwundet, aus Ereignissen nicht verwundet`]);
    const event: GameEvent = { round: 1, phase: "combatResolution", type: "unit_wounded", player: unit.owner, unitId: unit.id, cardId: null, arena: "front:0-1" };
    expect(auditPhase(before, takeSnapshot(state), [event], "combatResolution")).toEqual([]);
  });

  it("R-19.1: Genesung ohne Ereignis wird gemeldet, mit unit_recovered nicht", () => {
    const state = base();
    const unit = firstUnit(state);
    unit.wounded = true;
    const before = takeSnapshot(state);
    unit.wounded = false;
    expect(auditPhase(before, takeSnapshot(state), [], "roundStart")).toHaveLength(1);
    const event: GameEvent = { round: 1, phase: "roundStart", type: "unit_recovered", player: unit.owner, unitId: unit.id };
    expect(auditPhase(before, takeSnapshot(state), [event], "roundStart")).toEqual([]);
  });

  it("R-19.1: Sterne und XP einer Einheit ändern sich ohne Ereignis → Befund", () => {
    const state = base();
    const before = takeSnapshot(state);
    const unit = firstUnit(state);
    unit.stars = 2;
    expect(auditPhase(before, takeSnapshot(state), [], "reveal")).toEqual([`reveal: Einheit ${unit.id} hat 2 Sterne, aus Ereignissen 1`]);
    unit.stars = 1;
    unit.xp += 2;
    expect(auditPhase(before, takeSnapshot(state), [], "combatResolution")).toEqual([`combatResolution: Einheit ${unit.id} hat ${unit.xp} XP, aus Ereignissen ${unit.xp - 2}`]);
    const event: GameEvent = { round: 1, phase: "combatResolution", type: "unit_xp_gained", player: unit.owner, unitId: unit.id, amount: 2, bonus: 0, xp: unit.xp, arena: "front:0-1" };
    expect(auditPhase(before, takeSnapshot(state), [event], "combatResolution")).toEqual([]);
  });

  it("R-19.1: Anführer-Stufe, -XP und -Ast ändern sich ohne Ereignis → Befund", () => {
    const state = base();
    const before = takeSnapshot(state);
    const p = getPlayer(state, 1);
    p.leader.level = 2;
    expect(auditPhase(before, takeSnapshot(state), [], "roundStart")).toEqual(["roundStart: leaderLevel von Spieler 1 ist 2, aus Ereignissen 1"]);
    const leveled: GameEvent = { round: 2, phase: "roundStart", type: "leader_leveled_up", player: 1, level: 2, xp: p.leader.xp };
    expect(auditPhase(before, takeSnapshot(state), [leveled], "roundStart")).toEqual([]);
    p.leader.xp += 3;
    p.leader.branchId = "test-branch";
    const findings = auditPhase(before, takeSnapshot(state), [leveled], "cleanup");
    expect(findings).toEqual([`cleanup: leaderXp von Spieler 1 ist ${p.leader.xp}, aus Ereignissen ${p.leader.xp - 3}`, "cleanup: leaderBranch von Spieler 1 ist test-branch, aus Ereignissen —"]);
  });

  it("R-19.1: Deck, ausgespielte Karten und Rundenvorrat ändern sich ohne Ereignis → Befund; resources_played erklärt sie", () => {
    const state = base();
    const p = getPlayer(state, 0);
    const before = takeSnapshot(state);
    const card = p.hand[0];
    expect(card).toBeDefined();
    if (card === undefined) return;
    p.hand.shift();
    p.played.push(card);
    p.roundGold += 1;
    const findings = auditPhase(before, takeSnapshot(state), [], "planning");
    expect(findings.some((f) => f.startsWith("planning: roundGold von Spieler 0"))).toBe(true);
    expect(findings.some((f) => f.startsWith("planning: Ausgespielt von Spieler 0"))).toBe(true);
    const played: GameEvent = { round: 1, phase: "planning", type: "resources_played", player: 0, cardInstanceIds: [card], gold: 1 };
    expect(auditPhase(before, takeSnapshot(state), [played], "planning")).toEqual([]);
    const top = p.deck.pop();
    expect(top).toBeDefined();
    expect(auditPhase(before, takeSnapshot(state), [played], "planning").some((f) => f.startsWith("planning: Deck von Spieler 0"))).toBe(true);
  });

  it("R-19.1: gelegte Zauber, Vorrat, Klassen-Pool und Serien ändern sich ohne Ereignis → Befund", () => {
    const state = base();
    const before = takeSnapshot(state);
    const p = getPlayer(state, 2);
    const spell: SetSpell = { cardInstanceId: 999, cardId: "fireball", target: { kind: "none" } };
    p.spells.pre.push(spell);
    const pile = Object.keys(state.supply)[0];
    const poolPile = Object.keys(p.classPool)[0];
    expect(pile).toBeDefined();
    expect(poolPile).toBeDefined();
    if (pile === undefined || poolPile === undefined) return;
    state.supply[pile] = (state.supply[pile] ?? 0) - 1;
    p.classPool[poolPile] = (p.classPool[poolPile] ?? 0) - 1;
    p.winStreak = 1;
    p.centerStreak = 1;
    const findings = auditPhase(before, takeSnapshot(state), [], "reveal");
    expect(findings.some((f) => f.startsWith("reveal: Zauber von Spieler 2"))).toBe(true);
    expect(findings.some((f) => f.startsWith("reveal: Vorrat ist"))).toBe(true);
    expect(findings.some((f) => f.startsWith("reveal: Klassen-Pool von Spieler 2"))).toBe(true);
    expect(findings).toContain("reveal: winStreak von Spieler 2 ist 1, aus Ereignissen 0");
    expect(findings).toContain("reveal: centerStreak von Spieler 2 ist 1, aus Ereignissen 0");
  });
});

