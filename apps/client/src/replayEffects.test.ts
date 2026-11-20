import { describe, expect, it } from "vitest";
import { type GameEvent, loadGameData, playerView } from "@game/engine";
import { buildBoardLayout, frontPairsFor } from "./boardLayout";
import { combatReplays, ReplayPlayer } from "./combatReplay";
import { arenaCellPosition } from "./replayAnimation";
import {
  buffText,
  combatEffects,
  FLASH_TICKS,
  FLOAT_TICKS,
  keywordText,
  LINE_TICKS,
  LUNGE_SHARE,
  LUNGE_TICKS,
  stepTexts,
} from "./replayEffects";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);
const base = { round: 1, phase: "combat" as const, arena: "center" };

/**
 * Kampf in der Mitte von Hand: 1 (Nahkampf, 2|3) schlägt 2 (3|3) zweimal, 3 (Fernkampf, 6|6) schießt auf 2,
 * 4 wirkt eine Fähigkeit auf 2, heilt, gibt Schild, bufft, beschwört 9 und betäubt 2.
 */
function handLog(): GameEvent[] {
  return [
    {
      ...base,
      type: "combat_started",
      players: [0, 1],
      fighters: [
        { unitId: 1, player: 0, sourceId: "recruit", cell: { col: 2, row: 3 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 2, player: 1, sourceId: "recruit", cell: { col: 3, row: 3 }, hp: 6, maxHp: 6, shield: 2 },
        { unitId: 3, player: 0, sourceId: "recruit", cell: { col: 6, row: 6 }, hp: 3, maxHp: 3, shield: 0 },
        { unitId: 4, player: 0, sourceId: "recruit", cell: { col: 0, row: 0 }, hp: 3, maxHp: 3, shield: 0 },
      ],
    },
    { ...base, type: "combat_attack", tick: 3, unit: 1, target: 2 },
    { ...base, type: "combat_damage", tick: 3, source: 1, target: 2, kind: "attack", amount: 3, absorbed: 2, hpLoss: 1, hp: 5 },
    { ...base, type: "combat_attack", tick: 20, unit: 3, target: 2 },
    { ...base, type: "combat_damage", tick: 20, source: 3, target: 2, kind: "attack", amount: 1, absorbed: 0, hpLoss: 1, hp: 4 },
    { ...base, type: "combat_ability", tick: 40, unit: 4, target: 2 },
    { ...base, type: "combat_damage", tick: 40, source: 4, target: 2, kind: "ability", amount: 2, absorbed: 0, hpLoss: 2, hp: 2 },
    { ...base, type: "combat_unit_stunned", tick: 40, unit: 2, ticks: 10 },
    { ...base, type: "combat_ability", tick: 60, unit: 4, target: null },
    { ...base, type: "combat_healed", tick: 60, source: 4, target: 1, amount: 2, hp: 3 },
    { ...base, type: "combat_shielded", tick: 60, source: 4, target: 3, amount: 4, shield: 4 },
    { ...base, type: "combat_buffed", tick: 60, source: 4, target: 1, stat: "attack", amount: 2, value: 4 },
    { ...base, type: "combat_keyword_granted", tick: 60, source: 4, target: 1, keyword: "firstStrike" },
    { ...base, type: "combat_unit_summoned", tick: 60, unit: 9, team: 0, sourceId: "recruit", cell: { col: 1, row: 0 }, summoner: 4, hp: 1, maxHp: 1, shield: 0 },
    { ...base, type: "combat_ended", tick: 100, winner: 0, survivors: [1, 2, 3, 4, 9] },
  ] as GameEvent[];
}

const replay = combatReplays(data, handLog())[0]!;
const at = (col: number, row: number) => arenaCellPosition(layout, "center", { col, row })!;

describe("C4c2a: Wirkungen im Kampf", () => {
  it("R-19.2: Nahkampfangriff ist ein Ausfallschritt zum Ziel, der nach LUNGE_TICKS endet", () => {
    expect(combatEffects(layout, replay, 2, 0.9).offsets.size).toBe(0);
    const from = at(2, 3);
    const to = at(3, 3);
    const peak = combatEffects(layout, replay, 3, LUNGE_TICKS / 2).offsets.get(1)!;
    expect(peak.x).toBeCloseTo((to.x - from.x) * LUNGE_SHARE);
    expect(peak.z).toBeCloseTo((to.z - from.z) * LUNGE_SHARE);
    expect(combatEffects(layout, replay, 3, 0).offsets.get(1)).toEqual({ x: 0, z: 0 });
    expect(combatEffects(layout, replay, 3 + LUNGE_TICKS, 0).offsets.has(1)).toBe(false);
    // Kein Geschoss beim Nahkampf.
    expect(combatEffects(layout, replay, 4, 0).lines).toEqual([]);
  });

  it("R-19.2: Schadenszahl mit Schild-Anteil steigt über dem Ziel auf und verschwindet nach FLOAT_TICKS", () => {
    const now = combatEffects(layout, replay, 3, 0.5);
    expect(now.texts.map((t) => [t.text, t.tone, t.stack])).toEqual([
      ["−1", "damage", 0],
      ["−2 Schild", "shield", 1],
    ]);
    for (const t of now.texts) {
      expect(t.position).toEqual(at(3, 3));
      expect(t.age).toBeCloseTo(0.5 / FLOAT_TICKS);
    }
    expect(combatEffects(layout, replay, 2 + FLOAT_TICKS, 0.99).texts.filter((t) => t.key.startsWith("3:"))).toHaveLength(2);
    expect(combatEffects(layout, replay, 3 + FLOAT_TICKS, 0).texts.filter((t) => t.key.startsWith("3:"))).toEqual([]);
  });

  it("R-19.2: Fernangriff zeigt ein Geschoss vom Schützen zum Ziel statt eines Ausfallschritts", () => {
    const fx = combatEffects(layout, replay, 21, 0);
    expect(fx.offsets.has(3)).toBe(false);
    expect(fx.lines).toEqual([{ key: "20:0", kind: "shot", from: at(6, 6), to: at(3, 3), player: 0, age: 1 / LINE_TICKS }]);
    expect(combatEffects(layout, replay, 20 + LINE_TICKS, 0).lines).toEqual([]);
  });

  it("R-19.2: Fähigkeit blitzt am Wirker, mit Ziel fliegt ein Strahl; Betäubung wird angezeigt", () => {
    const fx = combatEffects(layout, replay, 40, 0);
    expect(fx.flashes).toEqual([{ key: "40:0", kind: "ability", position: at(0, 0), player: 0, age: 0 }]);
    expect(fx.lines.map((l) => [l.kind, l.from, l.to])).toEqual([["ability", at(0, 0), at(3, 3)]]);
    expect(fx.texts.map((t) => t.text)).toEqual(["−2", "betäubt"]);
    expect(combatEffects(layout, replay, 40 + FLASH_TICKS, 0).flashes).toEqual([]);
  });

  it("R-19.2: Heilung, Schild, Buff, Schlüsselwort und Beschwörung sind sichtbar", () => {
    const fx = combatEffects(layout, replay, 60, 0.25);
    // Fähigkeit ohne Ziel: nur der Blitz am Wirker, kein Strahl.
    expect(fx.lines).toEqual([]);
    expect(fx.flashes.map((f) => [f.kind, f.position])).toEqual([
      ["ability", at(0, 0)],
      ["shield", at(6, 6)],
      ["summon", at(1, 0)],
    ]);
    expect(fx.texts.map((t) => [t.text, t.tone, t.position, t.stack])).toEqual([
      ["+2", "heal", at(2, 3), 0],
      ["+4 Schild", "shield", at(6, 6), 0],
      ["+2 Angriff", "buff", at(2, 3), 1],
      ["Erstschlag", "buff", at(2, 3), 2],
    ]);
  });

  it("Texte: Buffs mit Vorzeichen und deutschem Wertnamen, unbekannte Schlüsselwörter roh, Null-Werte ohne Zahl", () => {
    expect(buffText("attackInterval", -2)).toBe("−2 Angriffstakt");
    expect(buffText("hp", 3)).toBe("+3 Leben");
    expect(keywordText("woundOnKill")).toBe("Verwundet beim Töten");
    expect(keywordText("neu")).toBe("neu");
    expect(stepTexts({ kind: "damage", source: 1, target: 2, damageKind: "attack", amount: 0, absorbed: 0, hpLoss: 0, hp: 3 })).toEqual([]);
    expect(stepTexts({ kind: "wound", unit: 2, source: 1 })).toEqual([{ target: 2, text: "verwundet", tone: "status" }]);
    expect(stepTexts({ kind: "move", unit: 1, from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, jump: false })).toEqual([]);
  });
});

describe("C4c2a: Wirkungen echter Bot-Runden", () => {
  it("R-19.2: jede Wirkung liegt auf einem Feld ihrer Arena und jeder Schaden des Protokolls erscheint als Zahl", () => {
    let texts = 0;
    let lines = 0;
    let lunges = 0;
    for (const seed of [3, 8]) {
      const session = new GameSession(data, { seed });
      for (let i = 0; i < 5 && session.status === "waitingForHuman"; i++) session.autopilot();
      const log = playerView(session.state, HUMAN).log;
      const rounds = [...new Set(log.filter((e) => e.type === "combat_started").map((e) => e.round))];
      for (const round of rounds) {
        const before = new Set(log.filter((e) => e.type === "player_eliminated" && e.round < round).map((e) => ("player" in e ? e.player : -1)));
        const roundLayout = buildBoardLayout(layout.config, frontPairsFor(([0, 1, 2, 3] as const).map((p) => before.has(p))), 4);
        for (const r of combatReplays(data, log, round)) {
          const cells = roundLayout.arenas.find((a) => a.id === r.arena)!.cells.map((c) => c.position);
          const onCell = (p: { x: number; z: number }): boolean => cells.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 1e-9);
          for (const t of r.ticks) {
            const fx = combatEffects(roundLayout, r, t.tick, 0);
            const expectedDamage = t.steps.filter((s) => s.kind === "damage" && s.hpLoss > 0).length;
            expect(fx.texts.filter((x) => x.tone === "damage" && x.age === 0).length).toBe(expectedDamage);
            for (const x of fx.texts) expect(onCell(x.position)).toBe(true);
            for (const l of fx.lines) expect(onCell(l.from) && onCell(l.to)).toBe(true);
            for (const f of fx.flashes) expect(onCell(f.position)).toBe(true);
            for (const o of fx.offsets.values()) expect(Math.hypot(o.x, o.z)).toBeLessThan(LUNGE_SHARE * 2.2);
            texts += fx.texts.length;
            lines += fx.lines.length;
            lunges += combatEffects(roundLayout, r, t.tick, 1).offsets.size;
          }
        }
        // Abspielen mit dem Player liefert dieselben Wirkungen ohne Fehler.
        const player = new ReplayPlayer(combatReplays(data, log, round));
        while (!player.finished) {
          const p = player.position();
          const running = p.index === null ? null : player.replays[p.index]!;
          if (running) combatEffects(roundLayout, running, p.tick, p.fraction);
          player.advance(250);
        }
      }
    }
    expect(texts).toBeGreaterThan(20);
    expect(lines + lunges).toBeGreaterThan(10);
  });
});

describe("C4c2a: Wirkungen laufen in der Pause nach dem Kampf aus", () => {
  it("R-19.2: `ReplayPlayer.clock` läuft über `endTick` hinaus, Zahlen des letzten Ticks altern weiter", () => {
    const short = combatReplays(data, [
      ...handLog().slice(0, 3),
      { ...base, type: "combat_ended", tick: 3, winner: 0, survivors: [1, 2, 3, 4] },
    ] as GameEvent[])[0]!;
    const player = new ReplayPlayer([short]);
    expect(player.clock()).toBe(-1);
    player.advance(400); // 8 Ticks bei 1×: −1 + 8 = 7, also 4 Ticks nach dem Ende
    expect(player.position().tick).toBe(3);
    expect(player.clock()).toBeCloseTo(7);
    const clock = player.clock()!;
    const fx = combatEffects(layout, short, Math.floor(clock), clock - Math.floor(clock));
    expect(fx.texts.length).toBe(2);
    for (const t of fx.texts) expect(t.age).toBeCloseTo(4 / FLOAT_TICKS);
    player.skipAll();
    expect(player.clock()).toBeNull();
  });
});
