import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";

const data = loadGameData();

/**
 * Startwerte des Mini-Sets für Karten, deren Werte die Kampf-Kalibrierung (B0c) geändert hat.
 * B-3 erlaubt Agenten höchstens ±50 % Abweichung vom Startwert; Änderungen stehen in `docs/ENTSCHEIDUNGEN.md`.
 */
const startValues: Record<string, { attack: number; hp: number; breakthrough: number }> = {
  arena_champion: { attack: 6, hp: 12, breakthrough: 3 },
  banner_bearer: { attack: 2, hp: 6, breakthrough: 1 },
  shieldwall_veteran: { attack: 2, hp: 8, breakthrough: 0 },
  recruit: { attack: 2, hp: 3, breakthrough: 1 },
  squire: { attack: 1, hp: 5, breakthrough: 0 },
};

function statsOf(id: string): { attack: number; hp: number; breakthrough: number } {
  const card = data.cards.get(id);
  if (card?.type !== "unit") throw new Error(`Einheit ${id} erwartet`);
  return { attack: card.stats.attack, hp: card.stats.hp, breakthrough: card.stats.breakthrough };
}

describe("B-3: Kartenwerte nach der Kampf-Kalibrierung", () => {
  it("B-3: geänderte Kartenwerte bleiben innerhalb ±50 % der Startwerte", () => {
    for (const [id, start] of Object.entries(startValues)) {
      const now = statsOf(id);
      for (const stat of ["attack", "hp", "breakthrough"] as const) {
        expect(now[stat], `${id}.${stat}`).toBeGreaterThanOrEqual(Math.ceil(start[stat] * 0.5));
        expect(now[stat], `${id}.${stat}`).toBeLessThanOrEqual(Math.floor(start[stat] * 1.5));
      }
    }
  });

  it("B-3: B0c2 – Champion der Arena 5/9, Bannerträger Leben 4, Schildwall-Veteran Leben 6 (V2–V4)", () => {
    expect(statsOf("arena_champion")).toEqual({ attack: 5, hp: 9, breakthrough: 3 });
    expect(statsOf("banner_bearer")).toEqual({ attack: 2, hp: 4, breakthrough: 1 });
    expect(statsOf("shieldwall_veteran")).toEqual({ attack: 2, hp: 6, breakthrough: 0 });
  });

  it("B-3: B0c3a – Rekrut Leben 2, Schildknappe Leben 3 (V5, ★2 zu stark)", () => {
    expect(statsOf("recruit")).toEqual({ attack: 2, hp: 2, breakthrough: 1 });
    expect(statsOf("squire")).toEqual({ attack: 1, hp: 3, breakthrough: 0 });
  });
});
