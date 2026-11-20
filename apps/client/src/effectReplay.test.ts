import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView } from "@game/engine";
import { BASE_TICKS_PER_SECOND, END_PAUSE_MS } from "./combatReplay";
import { EFFECT_GROUP_MS, type EffectGroup, type RoundReplay, RoundReplayPlayer, roundReplay, roundSegments } from "./effectReplay";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const R = 4;
const ev = (phase: string, payload: Record<string, unknown>): GameEvent => ({ round: R, phase, ...payload }) as GameEvent;

/** Eine Runde von Hand: Anführer-Fähigkeiten, Vorkampf-Zauber, ein kleiner Kampf, Durchbruch, Nachkampf-Zauber. */
function handLog(): GameEvent[] {
  return [
    ev("leaderAbilities", { type: "phase_started" }),
    // Vex: eine Bewegung scheitert (steht vor der Fähigkeit im Protokoll), eine gelingt, Buff, Beute vorgemerkt.
    ev("leaderAbilities", { type: "leader_ability_move_blocked", player: 2, leaderId: "vex", unitId: 8, hex: { arena: "left", cell: { col: 1, row: 1 } }, reason: "hexOccupied" }),
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 2, leaderId: "vex", category: "move", level: 3, branchId: "double" }),
    ev("leaderAbilities", {
      type: "unit_shadow_stepped",
      player: 2,
      unitId: 3,
      from: { zone: "left", cell: { col: 2, row: 1 } },
      to: { arena: "left", cell: { col: 2, row: 0 } },
      cardId: "vex",
    }),
    ev("leaderAbilities", { type: "unit_buffed", player: 2, unitId: 3, stat: "attack", amount: 1, duration: "combat", cardId: "vex" }),
    ev("leaderAbilities", { type: "leader_trigger_armed", player: 2, leaderId: "vex", trigger: "onFrontWinOfChosen", unitIds: [3, 8] }),
    // Morgra verpufft wegen Feldkonflikt.
    ev("leaderAbilities", { type: "leader_ability_hex_conflict", player: 3, leaderId: "morgra", hex: { arena: "front:2-3", cell: { col: 2, row: 2 } } }),
    ev("leaderAbilities", { type: "leader_ability_fizzled", player: 3, leaderId: "morgra", category: "summon", reason: "hexConflict" }),
    // Ilyra: Schaden; die Verwundung folgt erst nach dem gleichzeitigen Schaden aller Fähigkeiten (nach Brann).
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 1, leaderId: "ilyra", category: "damage", level: 2, branchId: "force" }),
    ev("leaderAbilities", { type: "unit_damaged", player: 0, unitId: 5, amount: 4, absorbed: 1, hpLoss: 3, hp: -1, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "unit_defeated", player: 0, unitId: 5, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 0, leaderId: "brann", category: "buff", level: 1, branchId: null }),
    ev("leaderAbilities", { type: "unit_buffed", player: 0, unitId: 6, stat: "attack", amount: 2, duration: "combat", cardId: "brann" }),
    ev("leaderAbilities", { type: "unit_wounded", player: 0, unitId: 5, cardId: "ilyra", arena: null }),
    ev("preCombatSpells", { type: "phase_started" }),
    ev("preCombatSpells", { type: "spell_resolved", player: 0, cardInstanceId: 40, cardId: "shield_spell", slot: 1, tempo: 2 }),
    ev("preCombatSpells", { type: "unit_shielded", player: 0, unitId: 6, amount: 3, shield: 3, cardId: "shield_spell" }),
    ev("preCombatSpells", { type: "unit_keyword_granted", player: 0, unitId: 6, keyword: "taunt", cardId: "shield_spell" }),
    ev("preCombatSpells", { type: "spell_resolved", player: 1, cardInstanceId: 41, cardId: "drum", slot: 1, tempo: 3 }),
    ev("preCombatSpells", {
      type: "unit_summoned",
      player: 1,
      unitId: 30,
      sourceId: "spirit",
      location: { zone: "left", cell: { col: 0, row: 0 } },
      cardId: "drum",
    }),
    ev("preCombatSpells", { type: "spell_fizzled", player: 3, cardInstanceId: 42, cardId: "fireball", slot: 2, reason: "noValidTarget" }),
    ev("combat", { type: "phase_started" }),
    ev("combat", {
      type: "combat_started",
      arena: "front:0-1",
      players: [0, 1],
      fighters: [
        { unitId: 6, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 3, maxHp: 3, shield: 3 },
        { unitId: 30, player: 1, sourceId: "spirit", cell: { col: 3, row: 3 }, hp: 1, maxHp: 1, shield: 0 },
      ],
    }),
    ev("combat", { type: "combat_attack", arena: "front:0-1", tick: 2, unit: 6, target: 30 }),
    ev("combat", { type: "combat_damage", arena: "front:0-1", tick: 2, source: 6, target: 30, kind: "attack", amount: 2, absorbed: 0, hpLoss: 1, hp: -1 }),
    ev("combat", { type: "combat_unit_died", arena: "front:0-1", tick: 2, unit: 30, killer: 6 }),
    ev("combat", { type: "combat_ended", arena: "front:0-1", tick: 2, winner: 0, survivors: [6] }),
    // Verwundung nach dem Kampf gehört nicht zu einer Vorkampf-Wirkung.
    ev("combat", { type: "unit_wounded", player: 1, unitId: 30, cardId: null, arena: "front:0-1" }),
    ev("combatResolution", { type: "phase_started" }),
    ev("combatResolution", { type: "breakthrough_damage", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 2, baseDamage: 1, amount: 3, life: 17 }),
    ev("combatResolution", { type: "gold_gained", player: 0, amount: 1, treasury: 3 }),
    ev("postCombatSpells", { type: "phase_started" }),
    ev("postCombatSpells", { type: "spell_resolved", player: 2, cardInstanceId: 43, cardId: "loot", slot: 2, tempo: 1 }),
    ev("cleanup", { type: "phase_started" }),
  ];
}

const sourceName = (g: EffectGroup): string =>
  g.source.kind === "leader" ? g.source.leaderId : g.source.kind === "spell" ? g.source.cardId : `breakthrough ${g.source.arena}`;

describe("C4b: Vorkampf- und Nachkampf-Wirkungen als Wiedergabe-Schritte", () => {
  it("R-8.2: je Anführer-Fähigkeit eine Gruppe in Protokollreihenfolge, verpuffte Fähigkeiten eingeschlossen", () => {
    const replay = roundReplay(data, handLog(), R);
    expect(replay.preCombat.filter((g) => g.phase === "leaderAbilities").map((g) => [sourceName(g), g.outcome, g.fizzleReason])).toEqual([
      ["vex", "resolved", null],
      ["morgra", "fizzled", "hexConflict"],
      ["ilyra", "resolved", null],
      ["brann", "resolved", null],
    ]);
    const vex = replay.preCombat[0] as EffectGroup;
    expect(vex.source).toEqual({ kind: "leader", player: 2, leaderId: "vex", category: "move", level: 3, branchId: "double" });
    // Gescheiterte Bewegung (vor der Fähigkeit im Protokoll) steht in ihrer Gruppe vor den Wirkungen.
    expect(vex.steps.map((s) => s.kind)).toEqual(["blocked", "shadowStep", "buff", "mark"]);
    expect(vex.steps[0]).toEqual({ kind: "blocked", unit: 8, hex: { arena: "left", cell: { col: 1, row: 1 } }, reason: "hexOccupied" });
    expect(vex.steps[1]).toMatchObject({ kind: "shadowStep", unit: 3, owner: 2, to: { arena: "left", cell: { col: 2, row: 0 } } });
    expect(vex.steps[3]).toEqual({ kind: "mark", units: [3, 8] });
    expect((replay.preCombat[1] as EffectGroup).steps).toEqual([{ kind: "blocked", unit: null, hex: { arena: "front:2-3", cell: { col: 2, row: 2 } }, reason: "hexConflict" }]);
  });

  it("R-8.2, R-14.4: Schaden, besiegt und die nachträgliche Verwundung gehören zur auslösenden Fähigkeit", () => {
    const replay = roundReplay(data, handLog(), R);
    const ilyra = replay.preCombat.find((g) => sourceName(g) === "ilyra") as EffectGroup;
    expect(ilyra.steps).toEqual([
      { kind: "damage", unit: 5, owner: 0, arena: null, amount: 4, absorbed: 1, hpLoss: 3, hp: -1 },
      { kind: "defeat", unit: 5, owner: 0, arena: null },
      { kind: "wound", unit: 5, owner: 0, arena: null },
    ]);
    const brann = replay.preCombat.find((g) => sourceName(g) === "brann") as EffectGroup;
    expect(brann.steps).toEqual([{ kind: "buff", unit: 6, owner: 0, arena: "front:0-1", stat: "attack", amount: 2, duration: "combat" }]);
  });

  it("R-8.3: Vorkampf-Zauber mit Schild, Schlüsselwort und Beschwörung; Arena aus `combat_started`; verpuffter Zauber", () => {
    const replay = roundReplay(data, handLog(), R);
    const spells = replay.preCombat.filter((g) => g.phase === "preCombatSpells");
    expect(spells.map((g) => [sourceName(g), g.outcome])).toEqual([
      ["shield_spell", "resolved"],
      ["drum", "resolved"],
      ["fireball", "fizzled"],
    ]);
    expect(spells[0]?.source).toEqual({ kind: "spell", player: 0, cardId: "shield_spell", slot: 1 });
    expect(spells[0]?.steps).toEqual([
      { kind: "shield", unit: 6, owner: 0, arena: "front:0-1", amount: 3, shield: 3 },
      { kind: "keyword", unit: 6, owner: 0, arena: "front:0-1", keyword: "taunt" },
    ]);
    expect(spells[1]?.steps).toEqual([
      { kind: "summon", unit: 30, owner: 1, arena: "front:0-1", sourceId: "spirit", location: { zone: "left", cell: { col: 0, row: 0 } } },
    ]);
    expect(spells[2]).toMatchObject({ fizzleReason: "noValidTarget", steps: [] });
  });

  it("R-10.1: Durchbruch-Schaden an den Sitzen und Nachkampf-Zauber nach den Kämpfen; Verwundung im Kampf bleibt außen vor", () => {
    const replay = roundReplay(data, handLog(), R);
    expect(replay.combats.map((c) => c.arena)).toEqual(["front:0-1"]);
    expect(replay.postCombat.map((g) => [sourceName(g), g.phase])).toEqual([
      ["breakthrough front:0-1", "combatResolution"],
      ["loot", "postCombatSpells"],
    ]);
    expect(replay.postCombat[0]?.steps).toEqual([{ kind: "breakthrough", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 2, baseDamage: 1, amount: 3, life: 17 }]);
    expect(replay.preCombat.flatMap((g) => g.steps).filter((s) => s.kind === "wound")).toHaveLength(1);
    expect(roundReplay(data, handLog(), R + 1)).toEqual({ round: R + 1, preCombat: [], combats: [], postCombat: [] });
  });

  it("R-19.2: ein geändertes Ereignis ändert die Wirkungsschritte (keine zweite Quelle)", () => {
    const changed = handLog().map((e) => (e.type === "unit_damaged" ? { ...e, amount: 9, hpLoss: 8, hp: -6 } : e));
    const step = roundReplay(data, changed, R).preCombat.find((g) => sourceName(g) === "ilyra")?.steps[0];
    expect(step).toMatchObject({ kind: "damage", amount: 9, hpLoss: 8, hp: -6 });
  });
});

/** Partie mit Autopilot; Protokoll aus Sicht des Menschen (R-19.3). */
function playedLog(seed: number, rounds: number): GameEvent[] {
  const session = new GameSession(data, { seed });
  for (let i = 0; i < rounds && session.status === "waitingForHuman"; i++) session.autopilot();
  return playerView(session.state, HUMAN).log;
}

const PRE = new Set(["leaderAbilities", "preCombatSpells"]);
const POST = new Set(["combatResolution", "postCombatSpells"]);
const UNIT_EFFECT_TYPES = new Set(["unit_damaged", "unit_defeated", "unit_shielded", "unit_buffed", "unit_keyword_granted", "unit_summoned", "unit_shadow_stepped"]);

describe("C4b: Wirkungsschritte in echten Bot-Partien", () => {
  const logs = [3, 5, 8, 11].map((seed) => playedLog(seed, 10));

  it("R-19.2: jede sichtbare Vorkampf- und Nachkampf-Wirkung des Protokolls erscheint genau einmal (auch nach JSON)", () => {
    const kinds = new Set<string>();
    for (const log of logs) {
      const rounds = [...new Set(log.map((e) => e.round))];
      for (const round of rounds) {
        const replay = roundReplay(data, log, round);
        expect(roundReplay(data, JSON.parse(JSON.stringify(log)) as GameEvent[], round)).toEqual(replay);
        const inRound = log.filter((e) => e.round === round);
        const headers = (phases: Set<string>) =>
          inRound.filter((e) => phases.has(e.phase) && ["leader_ability_resolved", "leader_ability_fizzled", "spell_resolved", "spell_fizzled", "breakthrough_damage"].includes(e.type)).length;
        expect(replay.preCombat).toHaveLength(headers(PRE));
        expect(replay.postCombat).toHaveLength(headers(POST));
        const unitEvents = inRound.filter((e) => PRE.has(e.phase) && (UNIT_EFFECT_TYPES.has(e.type) || (e.type === "unit_wounded" && e.cardId !== null))).length;
        const unitSteps = replay.preCombat.flatMap((g) => g.steps).filter((s) => "owner" in s).length;
        expect(unitSteps).toBe(unitEvents);
        // Wer im Kampf steht, hat eine Arena; wer vor dem Kampf besiegt wurde, nicht.
        for (const s of replay.preCombat.flatMap((g) => g.steps)) {
          if (s.kind === "defeat") expect(s.arena).toBeNull();
          if (s.kind === "summon" || s.kind === "shadowStep") expect(s.arena).not.toBeNull();
        }
        for (const g of [...replay.preCombat, ...replay.postCombat]) kinds.add(`${g.phase}:${g.source.kind}`);
      }
    }
    // Die Partien decken Anführer-Fähigkeiten, Vorkampf- und Nachkampf-Zauber und Durchbruch ab.
    expect([...kinds].sort()).toEqual(["combatResolution:breakthrough", "leaderAbilities:leader", "postCombatSpells:spell", "preCombatSpells:spell"]);
  });

  it("R-10.1: Durchbruch-Gruppen nennen dieselbe Arena wie ein Kampf bzw. Frontergebnis dieser Runde", () => {
    for (const log of logs) {
      for (const round of [...new Set(log.map((e) => e.round))]) {
        const fronts = new Set(log.filter((e) => e.round === round && e.type === "front_resolved").map((e) => ("arena" in e ? e.arena : "")));
        for (const g of roundReplay(data, log, round).postCombat) if (g.source.kind === "breakthrough") expect(fronts.has(g.source.arena)).toBe(true);
      }
    }
  });
});

describe("C4b: Abspielen einer ganzen Runde", () => {
  const replay = (): RoundReplay => roundReplay(data, handLog(), R);
  const msPerTick = 1000 / BASE_TICKS_PER_SECOND;

  it("C4b: Reihenfolge Vorkampf-Gruppen, Kämpfe, Nachkampf-Gruppen", () => {
    expect(roundSegments(replay()).map((s) => (s.kind === "combat" ? `combat ${s.replay.arena}` : `${s.when} ${sourceName(s.group)}`))).toEqual([
      "pre vex",
      "pre morgra",
      "pre ilyra",
      "pre brann",
      "pre shield_spell",
      "pre drum",
      "pre fireball",
      "combat front:0-1",
      "post breakthrough front:0-1",
      "post loot",
    ]);
  });

  it("C4b: eine Wirkungsgruppe steht EFFECT_GROUP_MS, ein Kampf läuft Tick für Tick und hält danach", () => {
    const player = new RoundReplayPlayer(replay());
    player.advance(EFFECT_GROUP_MS / 2);
    expect(player.position()).toEqual({ index: 0, tick: 0, fraction: 0.5 });
    expect(player.frame()).toEqual([]);
    player.advance(EFFECT_GROUP_MS / 2 + EFFECT_GROUP_MS * 6);
    expect(player.segment?.kind).toBe("combat");
    expect(player.position()).toEqual({ index: 7, tick: -1, fraction: 0 });
    const reached = player.advance(msPerTick * 3);
    expect(reached).toEqual([
      { index: 7, tick: 0 },
      { index: 7, tick: 1 },
      { index: 7, tick: 2 },
    ]);
    expect(player.frame().filter((f) => f.alive).map((f) => f.unitId)).toEqual([6]);
    player.advance(END_PAUSE_MS);
    expect(player.position().index).toBe(8);
    player.advance(EFFECT_GROUP_MS * 2);
    expect(player.finished).toBe(true);
    expect(player.position().index).toBeNull();
  });

  it("C4b: Geschwindigkeit gilt auch für Wirkungsgruppen; Überspringen springt weiter bzw. ans Kampfende", () => {
    const fast = new RoundReplayPlayer(replay());
    fast.setSpeed(4);
    fast.advance(EFFECT_GROUP_MS);
    expect(fast.position().index).toBe(4);
    expect(() => fast.setSpeed(3 as 1)).toThrow(RangeError);

    const player = new RoundReplayPlayer(replay());
    for (let i = 0; i < 7; i++) player.skipCurrent();
    expect(player.position()).toEqual({ index: 7, tick: -1, fraction: 0 });
    player.skipCurrent();
    expect(player.position()).toEqual({ index: 7, tick: 2, fraction: 0 });
    player.skipCurrent();
    expect(player.segment).toMatchObject({ kind: "effects", when: "post" });
    player.skipAll();
    expect(player.finished).toBe(true);
    expect(player.frame()).toEqual([]);
  });
});

describe("C4c1: ganze Runde in krummen Zeitschritten", () => {
  it("R-19.2: RoundReplayPlayer endet auch bei Bildzeiten wie 137 ms oder 16,7 ms", () => {
    const log = playedLog(3, 6);
    for (const round of [2, 3, 4]) {
      for (const ms of [137, 1000 / 60, 1000 / 30, 7.3]) {
        const player = new RoundReplayPlayer(roundReplay(data, log, round));
        let steps = 0;
        while (!player.finished && steps < 100_000) {
          player.advance(ms);
          steps++;
        }
        expect(player.finished).toBe(true);
      }
    }
  });
});
