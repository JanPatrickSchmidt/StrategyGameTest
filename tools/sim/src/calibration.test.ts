import { describe, expect, it } from "vitest";
import { createRngState, loadGameData } from "@game/engine";
import {
  ARMY_TARGET,
  type CalibrationOptions,
  calibrationCards,
  cardsCsv,
  DEFAULT_CALIBRATION_OPTIONS,
  DUEL_TARGET,
  duelsCsv,
  fightArmies,
  hasNonCombatAbility,
  parseCalibrationArgs,
  randomArmy,
  randomPlacement,
  runCalibration,
  summarizeCalibration,
  verdict,
  winRate,
} from "./calibration";

const data = loadGameData();
const zone = data.config.arenas.frontZone;

function options(overrides: Partial<CalibrationOptions> = {}): CalibrationOptions {
  return { ...DEFAULT_CALIBRATION_OPTIONS, maxUnits: data.config.boardCapacity, battles: 40, duelRepeats: 2, ...overrides };
}

describe("Kampf-Kalibrierung (B0a)", () => {
  it("B-3: nutzt alle Einheitenkarten des Mini-Sets außer Tokens", () => {
    const cards = calibrationCards(data);
    expect(cards.length).toBeGreaterThan(10);
    expect(cards.every((c) => c.type === "unit" && c.pool !== "token")).toBe(true);
    const allUnits = [...data.cards.values()].filter((c) => c.type === "unit" && c.pool !== "token");
    expect(cards.map((c) => c.id).sort()).toEqual(allUnits.map((c) => c.id).sort());
  });

  it("B-1/B-3: zufällige Armeen haben genau den Goldwert und höchstens maxUnits Einheiten (★2 = dreifache Kosten)", () => {
    const cards = calibrationCards(data);
    const rng = createRngState(7);
    let sawStar2 = false;
    for (const budget of [3, 6, 10, 15]) {
      for (let i = 0; i < 200; i++) {
        const army = randomArmy(rng, cards, budget, 5, true);
        expect(army.reduce((s, u) => s + u.value, 0)).toBe(budget);
        expect(army.length).toBeLessThanOrEqual(5);
        for (const u of army) {
          const card = data.cards.get(u.cardId);
          expect(card?.type).toBe("unit");
          expect(u.value).toBe((card?.cost ?? 0) * (u.stars === 2 ? 3 : 1));
          if (u.stars === 2) sawStar2 = true;
        }
      }
    }
    expect(sawStar2).toBe(true);
    const noStar2 = randomArmy(createRngState(1), cards, 10, 5, false);
    expect(noStar2.every((u) => u.stars === 1)).toBe(true);
    expect(() => randomArmy(rng, cards, 100, 5, false)).toThrow(RangeError);
  });

  it("B-3: Aufstellungen sind verschiedene Felder der eigenen Frontzone (R-3.2)", () => {
    const cells = randomPlacement(createRngState(3), zone, 5);
    expect(new Set(cells.map((c) => `${c.col},${c.row}`)).size).toBe(5);
    for (const c of cells) {
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(zone.rows);
      expect(c.col).toBeLessThan(zone.cols);
    }
  });

  it("B-3: ein Kampf ist ein echter Frontkampf (R-9) – der Champion der Arena besiegt einen Rekruten von beiden Seiten", () => {
    const champion = { units: [{ cardId: "arena_champion", stars: 1 as const, value: 6 }], cells: [{ col: 2, row: 2 }] };
    const recruit = { units: [{ cardId: "recruit", stars: 1 as const, value: 1 }], cells: [{ col: 2, row: 2 }] };
    expect(fightArmies(data, createRngState(1), champion, recruit, "first")).toBe(1);
    expect(fightArmies(data, createRngState(1), champion, recruit, "second")).toBe(1);
    expect(fightArmies(data, createRngState(1), recruit, champion, "first")).toBe(0);
  });

  it("B-3: gleiche Optionen ergeben identische Ergebnisse, anderer Seed andere", () => {
    const a = runCalibration(data, options({ seed: 5 }));
    const b = runCalibration(data, options({ seed: 5 }));
    expect(cardsCsv(a)).toBe(cardsCsv(b));
    expect(duelsCsv(a)).toBe(duelsCsv(b));
    const c = runCalibration(data, options({ seed: 6 }));
    expect(cardsCsv(c)).not.toBe(cardsCsv(a));
  });

  it("B-3: jede Paarung wird mit getauschten Seiten gespielt; Siege und Niederlagen gleichen sich über alle Karten aus", () => {
    const result = runCalibration(data, options({ battles: 30, budgets: [6, 10] }));
    expect(result.armyFights).toBe(60);
    for (const row of result.cards) {
      const t = row.tally;
      expect(t.wins + t.draws + t.losses).toBe(t.fights);
      expect(t.fights).toBeLessThanOrEqual(120);
    }
    // Eine Karte zählt je Armee und Kampf einmal, also höchstens zweimal je Kampf (in beiden Armeen).
    expect(result.cards.some((r) => r.stars === 2 && r.tally.fights > 0)).toBe(true);
    expect(result.drawShare).toBeGreaterThanOrEqual(0);
    expect(result.drawShare).toBeLessThanOrEqual(1);
  });

  it("B-1/B-3: Zweikampf ★2 gegen ★1 mit dreifachen Kosten, sonst teuerste Karte darunter plus ★1-Auffüllung", () => {
    const result = runCalibration(data, options({ battles: 1, duelRepeats: 3 }));
    const cards = calibrationCards(data);
    for (const card of cards) {
      const rows = result.duels.filter((d) => d.cardId === card.id);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.tally.fights).toBe(6);
        const opponent = data.cards.get(r.opponent);
        expect(opponent?.type).toBe("unit");
        const exact = cards.some((c) => c.cost === card.cost * 3);
        if (exact) {
          expect(opponent?.cost).toBe(card.cost * 3);
          expect(r.opponentName).toBe(opponent?.name);
        } else {
          expect(opponent?.cost).toBeLessThan(card.cost * 3);
          expect(r.opponentName).toContain(`+ ${card.cost * 3 - (opponent?.cost ?? 0)} Gold ★1`);
        }
      }
    }
    // Recruit (1 Gold) → ★1-Karten mit 3 Gold; Söldner (2 Gold) → 6 Gold.
    expect(result.duels.filter((d) => d.cardId === "recruit").every((d) => data.cards.get(d.opponent)?.cost === 3)).toBe(true);
    expect(result.duels.filter((d) => d.cardId === "mercenary").every((d) => data.cards.get(d.opponent)?.cost === 6)).toBe(true);
  });

  it("B-3: Bewertung nach Zielbereichen (45–55 % bzw. 50–65 %), Unentschieden zählen halb", () => {
    expect(winRate({ fights: 4, wins: 1, draws: 2, losses: 1 })).toBe(0.5);
    expect(winRate({ fights: 0, wins: 0, draws: 0, losses: 0 })).toBeNull();
    expect(verdict({ fights: 100, wins: 50, draws: 0, losses: 50 }, ARMY_TARGET)).toBe("ok");
    expect(verdict({ fights: 100, wins: 56, draws: 0, losses: 44 }, ARMY_TARGET)).toBe("zu stark");
    expect(verdict({ fights: 100, wins: 44, draws: 0, losses: 56 }, ARMY_TARGET)).toBe("zu schwach");
    expect(verdict({ fights: 100, wins: 60, draws: 0, losses: 40 }, DUEL_TARGET)).toBe("ok");
    expect(verdict({ fights: 100, wins: 49, draws: 0, losses: 51 }, DUEL_TARGET)).toBe("zu schwach");
    expect(verdict({ fights: 10, wins: 10, draws: 0, losses: 0 }, ARMY_TARGET)).toBe("zu wenig Daten");
  });

  it("B-3: Karten mit Wirkungen außerhalb des Kampfes werden gekennzeichnet", () => {
    const fence = data.cards.get("fence");
    const recruit = data.cards.get("recruit");
    if (fence?.type !== "unit" || recruit?.type !== "unit") throw new Error("Testdaten fehlen");
    expect(hasNonCombatAbility(fence)).toBe(true);
    expect(hasNonCombatAbility(recruit)).toBe(false);
    const result = runCalibration(data, options({ battles: 2 }));
    expect(result.cards.find((r) => r.cardId === "fence")?.nonCombatAbility).toBe(true);
  });

  it("B-3: CSV und Zusammenfassung haben je Karte und Sternstufe eine Zeile", () => {
    const result = runCalibration(data, options({ battles: 10 }));
    const lines = cardsCsv(result).trimEnd().split("\n");
    expect(lines[0]).toBe("card,name,cost,stars,value,fights,wins,draws,losses,win_rate_pct,verdict,non_combat_ability");
    expect(lines).toHaveLength(1 + calibrationCards(data).length * 2);
    for (const line of lines.slice(1)) expect(line.split(",")).toHaveLength(12);
    const duelLines = duelsCsv(result).trimEnd().split("\n");
    expect(duelLines).toHaveLength(1 + result.duels.length);
    const summary = summarizeCalibration(result);
    expect(summary).toContain("Kampf-Kalibrierung: 10 Paarungen × 2 Seiten = 20 Kämpfe");
    expect(summary).toContain("Champion der Arena");
  });

  it("B0a: Befehlszeile liest Optionen und lehnt Unsinn ab", () => {
    const o = parseCalibrationArgs(["--battles", "50", "--seed", "3", "--budget", "6,10,15", "--no-star2", "--duel-repeats", "5", "--out", "x"], 5);
    expect(o).toMatchObject({ battles: 50, seed: 3, budgets: [6, 10, 15], allowStar2: false, duelRepeats: 5, out: "x", maxUnits: 5 });
    expect(parseCalibrationArgs([], 5)).toMatchObject({ battles: 2000, budgets: [10], allowStar2: true, maxUnits: 5 });
    expect(() => parseCalibrationArgs(["--battles", "0"], 5)).toThrow();
    expect(() => parseCalibrationArgs(["--budget", "6,x"], 5)).toThrow();
    expect(() => parseCalibrationArgs(["--frobnicate"], 5)).toThrow();
  });
});
