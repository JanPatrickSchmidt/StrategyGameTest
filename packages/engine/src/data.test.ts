import { describe, expect, it } from "vitest";
import { loadGameData } from "./data";

describe("Daten laden (Vorstufe zu E2)", () => {
  const data = loadGameData();

  it("enthält die vier Anführer des Mini-Sets", () => {
    expect([...data.leaders.keys()].sort()).toEqual(["brann", "ilyra", "morgra", "vex"]);
  });

  it("enthält 16 Königreich-Karten", () => {
    const kingdom = [...data.cards.values()].filter((c) => c.pool === "kingdom");
    expect(kingdom).toHaveLength(16);
  });

  it("enthält je 3 Karten pro Klassen-Pool und einen Starter pro Klasse", () => {
    for (const cls of data.classes.keys()) {
      const pool = [...data.cards.values()].filter((c) => c.pool === `class:${cls}`);
      expect(pool, cls).toHaveLength(3);
      const starters = [...data.cards.values()].filter((c) => c.starterFor === cls);
      expect(starters, cls).toHaveLength(1);
    }
  });

  it("jeder Anführer hat eine bekannte Klasse und Rasse und drei Äste", () => {
    for (const leader of data.leaders.values()) {
      expect(data.classes.has(leader.class), leader.id).toBe(true);
      expect(data.races.has(leader.race), leader.id).toBe(true);
      const active = leader.active as { branches: unknown[] };
      expect(active.branches, leader.id).toHaveLength(3);
    }
  });
});
