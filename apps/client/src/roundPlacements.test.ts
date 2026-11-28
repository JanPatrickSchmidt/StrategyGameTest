import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView, type UnitId } from "@game/engine";
import { buildBoardLayout, frontPairsFor, locationPosition } from "./boardLayout";
import { RoundReplayPlayer, roundReplay, roundSegments } from "./effectReplay";
import { HIT_AT, type Locate, type RoundCursor, roundFrame } from "./roundAnimation";
import { roundPlacements } from "./roundPlacements";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);
const R = 4;
const ev = (phase: string, payload: Record<string, unknown>, round = R): GameEvent => ({ round, phase, ...payload }) as GameEvent;
const at = (index: number, fraction: number): RoundCursor => ({ index, tick: 0, fraction, clock: null });
/** Die Planungsansicht kennt die neue Einheit nicht (beim Gegner verdeckt, R-18). */
const nowhere: Locate = () => null;

const PLAYED = { zone: "left", cell: { col: 1, row: 0 } } as const;
const MOVED = { zone: "left", cell: { col: 2, row: 1 } } as const;

/**
 * Runde von Hand: Spieler 2 spielt einen Rekruten (50) und versetzt ihn in der Planung, Ilyras Fähigkeit
 * (Spieler 1) besiegt ihn vor dem Kampf. Ereignisse aus anderen Runden und nach den Kämpfen zählen nicht.
 */
function handLog(): GameEvent[] {
  return [
    ev("reveal", { type: "unit_played", player: 3, unitId: 49, cardInstanceId: 1, sourceId: "recruit", location: PLAYED, paidFromRoundGold: 1, paidFromTreasury: 0, altCost: false }, R - 1),
    ev("reveal", { type: "unit_played", player: 2, unitId: 50, cardInstanceId: 7, sourceId: "recruit", location: PLAYED, paidFromRoundGold: 1, paidFromTreasury: 0, altCost: false }),
    ev("reveal", { type: "unit_moved", player: 2, unitId: 50, from: PLAYED, to: MOVED }),
    ev("leaderAbilities", { type: "leader_ability_resolved", player: 1, leaderId: "ilyra", category: "damage", level: 2, branchId: null }),
    ev("leaderAbilities", { type: "unit_damaged", player: 2, unitId: 50, amount: 2, absorbed: 0, hpLoss: 2, hp: 0, cardId: "ilyra" }),
    ev("leaderAbilities", { type: "unit_defeated", player: 2, unitId: 50, cardId: "ilyra" }),
    ev("postCombatSpells", { type: "unit_moved", player: 2, unitId: 50, from: MOVED, to: PLAYED }),
  ];
}

describe("P16: Figuren ohne Kampf aus Ereignissen", () => {
  it("R-19.2: Ort neuer Einheiten kommt aus unit_played/unit_summoned und unit_moved der Runde vor den Kämpfen", () => {
    const log = [
      ...handLog(),
      ev("preCombatSpells", { type: "unit_summoned", player: 1, unitId: 60, sourceId: "spirit", location: { zone: "reserve", slot: 0 }, cardId: "drum", statOverride: { hp: 5 } }),
    ];
    const placements = roundPlacements(data, log, R);
    expect([...placements.keys()]).toEqual([50, 60]);
    expect(placements.get(50)).toEqual({ unit: 50, owner: 2, sourceId: "recruit", kind: "card", shape: "melee", hp: 2, location: MOVED });
    expect(placements.get(60)).toMatchObject({ owner: 1, kind: "token", shape: "token", hp: 5, location: { zone: "reserve", slot: 0 } });
    expect(roundPlacements(data, log, R - 1).get(49)?.location).toEqual(PLAYED);
  });

  it("R-19.2: gegnerische neue Einheit, die vor dem Kampf besiegt wird, erscheint in der Wiedergabe an ihrem Ort", () => {
    const log = handLog();
    const player = new RoundReplayPlayer(roundReplay(data, log, R), roundPlacements(data, log, R));
    const s = player.segments;
    expect(s.map((x) => x.kind)).toEqual(["effects"]);
    const where = locationPosition(layout, 2, MOVED);
    expect(where).not.toBeNull();
    const before = roundFrame(layout, s, at(0, HIT_AT - 0.01), nowhere, player.placements);
    expect(before.boardUnits).toEqual([]);
    expect(before.newUnits).toEqual([{ unit: 50, owner: 2, shape: "melee", position: where, hp: 2, shield: 0, opacity: 1 }]);
    // Der Strahl von Ilyras Säule geht zur neuen Figur, der Schaden steigt dort auf.
    expect(before.effects.lines.map((l) => l.to)).toEqual([where]);
    const hit = roundFrame(layout, s, at(0, HIT_AT + 0.2), nowhere, player.placements);
    expect(hit.newUnits).toHaveLength(1);
    expect(hit.newUnits[0]?.hp).toBe(0);
    expect(hit.newUnits[0]?.opacity).toBeGreaterThan(0);
    expect(hit.newUnits[0]?.opacity).toBeLessThan(1);
    expect(hit.effects.texts.map((t) => t.position)).toContainEqual(where);
    expect(roundFrame(layout, s, at(0, 0.99), nowhere, player.placements).newUnits).toEqual([]);
    // Ohne Ereignis-Orte (alter Weg) fehlte die Figur ganz.
    expect(roundFrame(layout, s, at(0, HIT_AT - 0.01), nowhere).newUnits).toEqual([]);
  });

  it("R-19.2, R-8.3: eine vor dem Kampf beschworene Einheit ohne Kampf erscheint erst mit ihrer Beschwörung", () => {
    const log = [
      ev("preCombatSpells", { type: "spell_resolved", player: 1, cardInstanceId: 41, cardId: "drum", slot: 1, tempo: 3 }),
      ev("preCombatSpells", { type: "unit_summoned", player: 1, unitId: 60, sourceId: "spirit", location: { zone: "reserve", slot: 0 }, cardId: "drum" }),
    ];
    const placements = roundPlacements(data, log, R);
    const s = roundSegments(roundReplay(data, log, R));
    expect(roundFrame(layout, s, at(0, HIT_AT - 0.01), nowhere, placements).newUnits).toEqual([]);
    const shown = roundFrame(layout, s, at(0, 0.9), nowhere, placements).newUnits;
    expect(shown.map((b) => [b.unit, b.opacity, b.hp])).toEqual([[60, 1, 2]]);
    expect(shown[0]?.position).toEqual(locationPosition(layout, 1, { zone: "reserve", slot: 0 }));
  });

  it("R-19.2 (P16): in echten Bot-Partien steht jede Einheit ohne Kampf, die in der Runde neu kam, an ihrem Ort aus den Ereignissen", () => {
    let opponentPlays = 0;
    for (const seed of [3, 5, 8]) {
      const session = new GameSession(data, { seed });
      for (let i = 0; i < 8 && session.status === "waitingForHuman"; i++) session.autopilot();
      const log = playerView(session.state, HUMAN).log;
      for (const round of [...new Set(log.map((e) => e.round))]) {
        const placements = roundPlacements(data, log, round);
        for (const e of log) if (e.round === round && e.type === "unit_played" && e.player !== HUMAN) opponentPlays++;
        const s = roundSegments(roundReplay(data, log, round));
        for (const [index, seg] of s.entries()) {
          if (seg.kind !== "effects") continue;
          const frame = roundFrame(layout, s, at(index, 0.1), () => ({ x: 0, z: 0 }), placements);
          for (const b of frame.boardUnits) expect(placements.has(b.unit as UnitId)).toBe(false);
          for (const b of frame.newUnits) {
            const p = placements.get(b.unit);
            expect(p && b.position).toEqual(p && locationPosition(layout, p.owner, p.location));
          }
        }
      }
    }
    // Gegnerische Ausspielungen stehen im Protokoll der eigenen Sicht (sonst ginge P16 nicht).
    expect(opponentPlays).toBeGreaterThan(0);
  });
});
