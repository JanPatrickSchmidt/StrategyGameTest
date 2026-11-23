import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView, type UnitId } from "@game/engine";
import { buildBoardLayout, frontPairsFor, locationPosition, seatPillarPosition, type WorldPoint } from "./boardLayout";
import { BASE_TICKS_PER_SECOND } from "./combatReplay";
import { EFFECT_GROUP_MS, type ReplaySegment, RoundReplayPlayer, roundReplay, roundSegments } from "./effectReplay";
import { arenaCellPosition, fixedFighters } from "./replayAnimation";
import { arenaHexPosition, HIT_AT, isSeatStep, seatStepTexts, type Locate, type RoundCursor, roundFrame, roundStatusText, SEAT_TEXT_HEIGHT } from "./roundAnimation";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);
const R = 3;
const ev = (phase: string, payload: Record<string, unknown>): GameEvent => ({ round: R, phase, ...payload }) as GameEvent;
const ARENA = "front:0-1";

/**
 * Runde von Hand: Ilyra (Spieler 1) trifft 6 (kämpft) und besiegt 5 (kämpft nicht), Vex (Spieler 0) versetzt 7
 * per Schattenschritt, Spieler 1 beschwört 30, Spieler 0s Feuerball verpufft; Kampf an der Front 0–1;
 * danach Durchbruch gegen Spieler 1 und ein Nachkampf-Zauber, der 6 Schild gibt.
 */
function handLog(): GameEvent[] {
  return [
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 1, leaderId: "ilyra", category: "damage", level: 2, branchId: null }),
    ev("leaderAbilities", { type: "unit_damaged", player: 0, unitId: 6, amount: 2, absorbed: 1, hpLoss: 1, hp: 2, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "unit_damaged", player: 0, unitId: 5, amount: 3, absorbed: 0, hpLoss: 3, hp: 0, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "unit_defeated", player: 0, unitId: 5, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 0, leaderId: "vex", category: "move", level: 1, branchId: null }),
    ev("leaderAbilities", {
      type: "unit_shadow_stepped",
      player: 0,
      unitId: 7,
      from: { zone: "right", cell: { col: 2, row: 1 } },
      to: { arena: "right", cell: { col: 2, row: 0 } },
      cardId: "vex",
    }),
    ev("preCombatSpells", { type: "spell_resolved", player: 1, cardInstanceId: 41, cardId: "drum", slot: 1, tempo: 3 }),
    ev("preCombatSpells", { type: "unit_summoned", player: 1, unitId: 30, sourceId: "spirit", location: { zone: "left", cell: { col: 0, row: 0 } }, cardId: "drum" }),
    ev("preCombatSpells", { type: "spell_fizzled", player: 0, cardInstanceId: 42, cardId: "fireball", slot: 2, reason: "noValidTarget" }),
    ev("combat", {
      type: "combat_started",
      arena: ARENA,
      players: [0, 1],
      fighters: [
        { unitId: 6, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 2, maxHp: 3, shield: 0 },
        { unitId: 7, player: 0, sourceId: "recruit", cell: { col: 2, row: 0 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 30, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 1, maxHp: 1, shield: 0 },
      ],
    }),
    ev("combat", { type: "combat_attack", arena: ARENA, tick: 2, unit: 6, target: 30 }),
    ev("combat", { type: "combat_damage", arena: ARENA, tick: 2, source: 6, target: 30, kind: "attack", amount: 2, absorbed: 0, hpLoss: 1, hp: -1 }),
    ev("combat", { type: "combat_unit_died", arena: ARENA, tick: 2, unit: 30, killer: 6 }),
    ev("combat", { type: "combat_ended", arena: ARENA, tick: 2, winner: 0, survivors: [6, 7] }),
    ev("combatResolution", { type: "breakthrough_damage", arena: ARENA, winner: 0, loser: 1, breakthrough: 2, baseDamage: 1, amount: 3, life: 17 }),
    ev("postCombatSpells", { type: "spell_resolved", player: 0, cardInstanceId: 43, cardId: "rune_shield", slot: 2, tempo: 1 }),
    ev("postCombatSpells", { type: "unit_shielded", player: 0, unitId: 6, amount: 2, shield: 2, cardId: "rune_shield" }),
  ];
}

const segments = (): ReplaySegment[] => roundSegments(roundReplay(data, handLog(), R));
/** Brett-Figur von 5 (kämpft nicht) steht an einem festen Punkt. */
const BOARD_POINT: WorldPoint = { x: 40, z: 40 };
const locate: Locate = (unit) => (unit === 5 ? BOARD_POINT : null);
const at = (index: number, fraction: number): RoundCursor => ({ index, tick: 0, fraction, clock: null });
const fighter = (frame: ReturnType<typeof roundFrame>, unit: UnitId) => frame.fighters.find((f) => f.unitId === unit);

describe("C4c2b: Vorkampf-Wirkungen auf dem Brett", () => {
  it("R-8.2, R-19.2: Anführer-Schaden ist erst ab dem Treffer an Leben und Schild zu sehen, mit Ring, Strahl und Zahlen", () => {
    const s = segments();
    expect(s.map((x) => x.kind)).toEqual(["effects", "effects", "effects", "effects", "combat", "effects", "effects"]);
    const early = roundFrame(layout, s, at(0, 0.1), locate);
    // Startaufstellung zeigt Werte nach allen Vorkampf-Wirkungen; vor dem Treffer wird zurückgerechnet.
    expect(fighter(early, 6)).toMatchObject({ hp: 3, shield: 1 });
    expect(early.effects.texts).toEqual([]);
    expect(early.effects.flashes.map((f) => f.kind)).toEqual(["ability"]);
    // Ilyra kämpft nicht: der Ring sitzt an der Säule von Spieler 1, die Strahlen gehen zu 6 und zu 5.
    expect(early.effects.flashes[0]?.position).toEqual(seatPillarPosition(layout, 1));
    expect(early.effects.lines.map((l) => l.to)).toEqual([arenaCellPosition(layout, ARENA, { col: 1, row: 2 }), BOARD_POINT]);
    const hit = roundFrame(layout, s, at(0, 0.5), locate);
    expect(fighter(hit, 6)).toMatchObject({ hp: 2, shield: 0 });
    expect(hit.effects.texts.map((t) => `${t.text}|${t.tone}`)).toEqual(["−1|damage", "−1 Schild|shield", "−3|damage"]);
    expect(hit.effects.texts[2]?.position).toEqual(BOARD_POINT);
    expect(hit.focusArena).toBeNull();
  });

  it("R-8.2: wer vor dem Kampf besiegt wird, steht als Brett-Figur da und blendet ab dem Treffer aus", () => {
    const s = segments();
    expect(roundFrame(layout, s, at(0, HIT_AT - 0.01), locate).boardUnits).toEqual([{ unit: 5, opacity: 1 }]);
    const fading = roundFrame(layout, s, at(0, HIT_AT + 0.2), locate).boardUnits;
    expect(fading).toHaveLength(1);
    expect(fading[0]?.opacity).toBeGreaterThan(0);
    expect(fading[0]?.opacity).toBeLessThan(1);
    expect(roundFrame(layout, s, at(1, 0), locate).boardUnits).toEqual([]);
  });

  it("R-8.2 (Schattenschritt), R-8.3 (Beschwörung): Figur gleitet vom alten Feld, Beschworene erscheint erst mit ihrem Zauber", () => {
    const s = segments();
    const from = locationPosition(layout, 0, { zone: "right", cell: { col: 2, row: 1 } });
    const to = arenaCellPosition(layout, ARENA, { col: 2, row: 0 });
    expect(from).not.toEqual(to);
    expect(fighter(roundFrame(layout, s, at(0, 0.5), locate), 7)?.position).toEqual(from);
    const moving = fighter(roundFrame(layout, s, at(1, 0.3), locate), 7)?.position;
    expect(moving).not.toEqual(from);
    expect(moving).not.toEqual(to);
    expect(fighter(roundFrame(layout, s, at(1, 0.9), locate), 7)?.position).toEqual(to);
    // 30 fehlt vor dem Trommel-Zauber und zu dessen Beginn, danach steht es da (mit Ring).
    expect(fighter(roundFrame(layout, s, at(1, 0.9), locate), 30)).toBeUndefined();
    expect(fighter(roundFrame(layout, s, at(2, 0.1), locate), 30)).toBeUndefined();
    const summoned = roundFrame(layout, s, at(2, 0.7), locate);
    expect(fighter(summoned, 30)?.opacity).toBe(1);
    expect(summoned.effects.flashes.map((f) => f.kind)).toContain("summon");
    // R-8.5: verpuffter Zauber zeigt „verpufft“ an der Säule des Zauberers.
    const fizzled = roundFrame(layout, s, at(3, 0.6), locate);
    expect(fizzled.effects.texts).toMatchObject([{ text: "verpufft", position: seatPillarPosition(layout, 0), height: SEAT_TEXT_HEIGHT }]);
  });

  it("R-14.2: Felder einer Fähigkeit liegen in der Arena aus Sicht des Besitzers", () => {
    expect(arenaHexPosition(layout, 0, { arena: "right", cell: { col: 2, row: 0 } })).toEqual(arenaCellPosition(layout, ARENA, { col: 2, row: 0 }));
    expect(arenaHexPosition(layout, 1, { arena: "left", cell: { col: 2, row: 0 } })).toEqual(arenaCellPosition(layout, ARENA, { col: 2, row: 0 }));
    expect(arenaHexPosition(layout, 0, { arena: "center", cell: { col: 3, row: 3 } })).toEqual(arenaCellPosition(layout, "center", { col: 3, row: 3 }));
  });
});

describe("C4c2b: Kampf und Nachkampf-Wirkungen auf dem Brett", () => {
  it("R-19.2: im Kampf-Abschnitt sind Figuren und Wirkungen die des Kampfs, die Kamera schaut auf seine Arena", () => {
    const s = segments();
    const frame = roundFrame(layout, s, { index: 4, tick: 2, fraction: 0, clock: 2 }, locate);
    expect(frame.focusArena).toBe(ARENA);
    expect(frame.fighters.every((f) => f.active)).toBe(true);
    expect(frame.effects.texts.map((t) => t.text)).toEqual(["−1"]);
  });

  it("R-10.1: Durchbruch fliegt von der Front zur Säule des Verlierers, dort Lebensverlust; die Säule zeigt danach das neue Leben", () => {
    const s = segments();
    const before = roundFrame(layout, s, at(5, 0.2), locate);
    expect(before.seatLife.size).toBe(0);
    expect(before.effects.lines).toMatchObject([{ kind: "shot", player: 0, to: seatPillarPosition(layout, 1) }]);
    // Nach dem Kampf stehen nur Überlebende im Endbild.
    expect(before.fighters.map((f) => f.unitId).sort()).toEqual([6, 7]);
    const hit = roundFrame(layout, s, at(5, 0.5), locate);
    expect(hit.seatLife).toEqual(new Map([[1, 17]]));
    expect(hit.effects.texts).toMatchObject([{ text: "−3 Leben", tone: "damage", height: SEAT_TEXT_HEIGHT }]);
    // Im folgenden Nachkampf-Zauber bleibt das neue Leben stehen; Schild erst ab dem Treffer.
    expect(fighter(roundFrame(layout, s, at(6, 0.1), locate), 6)?.shield).toBe(0);
    const shielded = roundFrame(layout, s, at(6, 0.6), locate);
    expect(shielded.seatLife.get(1)).toBe(17);
    expect(fighter(shielded, 6)?.shield).toBe(2);
    expect(shielded.effects.texts.map((t) => t.text)).toEqual(["+2 Schild"]);
  });

  it("C4c2b: Statuszeile nennt Abschnitt, Auslöser und Kampfzeit", () => {
    const s = segments();
    const ilyra = data.leaders.get("ilyra")?.name ?? "ilyra";
    expect(roundStatusText(data, s, at(0, 0.2), HUMAN, BASE_TICKS_PER_SECOND)).toBe(`Vor den Kämpfen 1 von 4: Fähigkeit von ${ilyra} (Bot 2)`);
    expect(roundStatusText(data, s, at(3, 0.2), HUMAN, BASE_TICKS_PER_SECOND)).toBe("Vor den Kämpfen 4 von 4: Zauber „Feuerball“ (Du) – verpufft");
    expect(roundStatusText(data, s, { index: 4, tick: 1, fraction: 0.5, clock: 1.5 }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Kampf 1 von 1: Du – Bot 2 · 0,1 s von 0,1 s");
    expect(roundStatusText(data, s, at(5, 0.2), HUMAN, BASE_TICKS_PER_SECOND)).toBe("Nach den Kämpfen 1 von 2: Durchbruch an der Front Du – Bot 2: Bot 2 verliert 3 Leben");
    expect(roundStatusText(data, s, { index: null, tick: 0, fraction: 0, clock: null }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Wiedergabe beendet.");
    expect(roundStatusText(data, [], { index: null, tick: 0, fraction: 0, clock: null }, HUMAN, BASE_TICKS_PER_SECOND)).toBe("Nichts abzuspielen in dieser Runde.");
  });

  it("C4c2b: RoundReplayPlayer.clock läuft im Kampf auch in der Pause weiter und ist bei Wirkungsgruppen null", () => {
    const player = new RoundReplayPlayer(roundReplay(data, handLog(), R));
    expect(player.clock()).toBeNull();
    player.advance(EFFECT_GROUP_MS * 4);
    expect(player.clock()).toBe(-1);
    player.skipCurrent();
    expect(player.clock()).toBe(2);
    player.advance(200);
    expect(player.clock()).toBeCloseTo(6);
    expect(player.position().tick).toBe(2);
  });
});

describe("P15b: Lebens-Buffs vor dem Kampf", () => {
  /** Ilyra trifft 6 für 1, danach Kriegsruf (Leben +2) auf 6; 6 startet mit 4 von 5 Leben (Grundwert 3). */
  function warCryLog(): GameEvent[] {
    return [
      ev("leaderAbilities", { type: "leader_ability_resolved", player: 1, leaderId: "ilyra", category: "damage", level: 1, branchId: null }),
      ev("leaderAbilities", { type: "unit_damaged", player: 0, unitId: 6, amount: 1, absorbed: 0, hpLoss: 1, hp: 2, cardId: "ilyra" }),
      ev("preCombatSpells", { type: "spell_resolved", player: 0, cardInstanceId: 44, cardId: "war_cry", slot: 1, tempo: 1 }),
      ev("preCombatSpells", { type: "unit_buffed", player: 0, unitId: 6, stat: "hp", amount: 2, duration: "combat", cardId: "war_cry" }),
      ev("combat", {
        type: "combat_started",
        arena: ARENA,
        players: [0, 1],
        fighters: [
          { unitId: 6, player: 0, sourceId: "recruit", cell: { col: 1, row: 2 }, hp: 4, maxHp: 5, shield: 0 },
          { unitId: 30, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 1, maxHp: 1, shield: 0 },
        ],
      }),
      ev("combat", { type: "combat_ended", arena: ARENA, tick: 1, winner: null, survivors: [6, 30] }),
    ];
  }

  it("R-19.2: Kriegsruf (Leben +2) – vor seiner Gruppe Leben und Maximum ohne Buff, ab dem Treffer mit Buff", () => {
    const s = roundSegments(roundReplay(data, warCryLog(), R));
    const kinds = s.map((g) => (g.kind === "effects" ? `${g.when}` : g.kind));
    expect(kinds.slice(0, 3)).toEqual(["pre", "pre", "combat"]);
    const show = (index: number, fraction: number) => fighter(roundFrame(layout, s, at(index, fraction), locate), 6);
    // Vor Ilyras Treffer: weder Schaden noch Buff.
    expect(show(0, 0.1)).toMatchObject({ hp: 3, maxHp: 3 });
    expect(show(0, HIT_AT)).toMatchObject({ hp: 2, maxHp: 3 });
    // Kriegsruf: bis zum Treffer ohne Buff, danach mit Leben und Maximum +2.
    expect(show(1, 0.1)).toMatchObject({ hp: 2, maxHp: 3 });
    expect(show(1, HIT_AT)).toMatchObject({ hp: 4, maxHp: 5 });
    expect(show(1, 0.99)).toMatchObject({ hp: 4, maxHp: 5 });
  });
});

describe("C4c2b: ganze Runden echter Bot-Partien", () => {
  function playedLog(seed: number, rounds: number): GameEvent[] {
    const session = new GameSession(data, { seed });
    for (let i = 0; i < rounds && session.status === "waitingForHuman"; i++) session.autopilot();
    return playerView(session.state, HUMAN).log;
  }

  it("R-19.2: jeder Vorkampf-/Nachkampf-Schaden erscheint als Zahl, jeder Durchbruch an der Säule, alle Positionen liegen auf dem Brett", () => {
    let damageSteps = 0;
    let breakthroughs = 0;
    for (const seed of [3, 5, 8]) {
      const log = playedLog(seed, 8);
      for (const round of [...new Set(log.map((e) => e.round))]) {
        const s = roundSegments(roundReplay(data, log, round));
        for (const [index, seg] of s.entries()) {
          if (seg.kind !== "effects") continue;
          const frame = roundFrame(layout, s, at(index, 0.5), () => ({ x: 0, z: 0 }));
          for (const p of [...frame.fighters.map((f) => f.position), ...frame.effects.texts.map((t) => t.position), ...frame.effects.lines.map((l) => l.to)]) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
          }
          // Schaden an Einheiten und Spieler-Wirkungen mit Schadens-Ton (P14: Fluch, gestohlenes Gold) an der Säule.
          const seatDamage = seg.group.steps.filter(isSeatStep).flatMap((st) => seatStepTexts(st)).filter((t) => t.tone === "damage").length;
          const expectedDamage = seg.group.steps.filter((st) => st.kind === "damage" && st.hpLoss > 0).length + seatDamage;
          const shownDamage = frame.effects.texts.filter((t) => t.tone === "damage" && !t.text.endsWith("Leben")).length;
          expect(shownDamage).toBe(expectedDamage);
          damageSteps += expectedDamage;
          for (const st of seg.group.steps) {
            if (st.kind !== "breakthrough") continue;
            breakthroughs++;
            expect(frame.seatLife.get(st.loser)).toBe(st.life);
            const text = frame.effects.texts.find((t) => t.text === `−${st.amount} Leben`);
            expect(text?.position).toEqual(seatPillarPosition(layout, st.loser));
            expect(text?.height).toBe(SEAT_TEXT_HEIGHT);
          }
        }
      }
    }
    expect(damageSteps).toBeGreaterThan(0);
    expect(breakthroughs).toBeGreaterThan(0);
  });

  it("R-19.2 (P15b): in echten Bot-Partien gilt vor der ersten Vorkampf-Gruppe gilt Leben ≤ Maximum, nach der letzten stehen die Startwerte des Kampfs (Bots spielen keinen Lebens-Buff; Gegenstück zum Kriegsruf-Test)", () => {
    for (const seed of [3, 5, 8, 13]) {
      const log = playedLog(seed, 8);
      for (const round of [...new Set(log.map((e) => e.round))]) {
        const s = roundSegments(roundReplay(data, log, round));
        const pre = [...s.entries()].filter(([, seg]) => seg.kind === "effects" && seg.when === "pre").map(([i]) => i);
        if (pre.length === 0) continue;
        const first = roundFrame(layout, s, at(pre[0] ?? 0, 0), () => ({ x: 0, z: 0 }));
        for (const f of first.fighters) {
          expect(f.maxHp).toBeGreaterThan(0);
          expect(f.hp).toBeLessThanOrEqual(f.maxHp);
        }
        const last = roundFrame(layout, s, at(pre[pre.length - 1] ?? 0, 0.99), () => ({ x: 0, z: 0 }));
        for (const seg of s) {
          if (seg.kind !== "combat") continue;
          for (const start of fixedFighters(layout, seg.replay, "start")) {
            const shown = last.fighters.find((f) => f.arena === start.arena && f.unitId === start.unitId);
            expect(shown && { hp: shown.hp, maxHp: shown.maxHp, shield: shown.shield }).toEqual({ hp: start.hp, maxHp: start.maxHp, shield: start.shield });
          }
        }
      }
    }
  });
});
