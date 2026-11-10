import { describe, expect, it } from "vitest";
import { loadGameData } from "@game/engine";
import { botsForGame, buyableCardIds, csvHeader, DEFAULT_SIM_OPTIONS, leadersForGame, parseArgs, runSimulation, type SimOptions, summarize, toCsv } from "./sim";

const data = loadGameData();
const players = data.config.players;

function options(overrides: Partial<SimOptions> = {}): SimOptions {
  return { ...DEFAULT_SIM_OPTIONS, ...overrides };
}

/** Einfacher CSV-Leser für die Tests (die Simulation erzeugt keine Anführungszeichen). */
function parseCsv(csv: string): string[][] {
  expect(csv.endsWith("\n")).toBe(true);
  return csv.slice(0, -1).split("\n").map((line) => line.split(","));
}

describe("Simulations-Werkzeug (E15)", () => {
  it("E15: erzeugt eine gültige CSV mit einer Zeile je Partie und Spieler", () => {
    const result = runSimulation(data, options({ games: 6, seed: 40 }));
    expect(result.failures).toEqual([]);
    const table = parseCsv(toCsv(result));
    const header = table[0] as string[];
    expect(header).toEqual(csvHeader(buyableCardIds(data)));
    expect(header.slice(0, 13)).toEqual(["game", "seed", "player", "leader", "bot", "placement", "winner", "victory", "rounds", "life", "power", "eliminated", "buys_total"]);
    expect(new Set(header).size).toBe(header.length);
    expect(table).toHaveLength(1 + 6 * players);
    for (const row of table.slice(1)) {
      expect(row).toHaveLength(header.length);
      const field = (name: string): string => row[header.indexOf(name)] as string;
      expect(data.leaders.has(field("leader"))).toBe(true);
      expect(["greedy", "random"]).toContain(field("bot"));
      expect(["power", "lastPlayer", "allEliminated", "roundLimit"]).toContain(field("victory"));
      for (const name of ["game", "seed", "player", "placement", "rounds", "power", "buys_total"]) expect(field(name)).toMatch(/^\d+$/);
      expect(field("life")).toMatch(/^-?\d+$/);
      expect(Number(field("rounds"))).toBeLessThanOrEqual(data.config.maxRounds);
      const buySum = header.filter((h) => h.startsWith("buy_")).reduce((sum, h) => sum + Number(field(h)), 0);
      expect(buySum).toBe(Number(field("buys_total")));
    }
  });

  it("E15, R-13.2: je Partie hat jeder Spieler einen Platz, mindestens einer ist Sieger, Sieger haben Platz 1", () => {
    const result = runSimulation(data, options({ games: 4, seed: 7, bots: ["greedy", "random", "greedy", "random"] }));
    for (let game = 0; game < 4; game++) {
      const rows = result.rows.filter((r) => r.game === game);
      expect(rows.map((r) => r.player)).toEqual([0, 1, 2, 3]);
      expect(rows.some((r) => r.winner)).toBe(true);
      for (const r of rows) {
        expect(r.placement).toBeGreaterThanOrEqual(1);
        expect(r.placement).toBeLessThanOrEqual(players);
        expect(r.winner).toBe(r.placement === 1);
      }
      expect(new Set(rows.map((r) => r.rounds)).size).toBe(1);
      expect(new Set(rows.map((r) => r.victory)).size).toBe(1);
    }
  });

  it("E15: gleiche Optionen ergeben dieselbe CSV (deterministisch), andere Seeds eine andere", () => {
    const a = toCsv(runSimulation(data, options({ games: 3, seed: 11 })));
    const b = toCsv(runSimulation(data, options({ games: 3, seed: 11 })));
    const c = toCsv(runSimulation(data, options({ games: 3, seed: 12 })));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("E15: Partie g hat den Seed seed + g", () => {
    const result = runSimulation(data, options({ games: 3, seed: 100 }));
    expect([...new Set(result.rows.map((r) => `${r.game}:${r.seed}`))]).toEqual(["0:100", "1:101", "2:102"]);
  });

  it("E15: Käufe stimmen mit den Kauf-Ereignissen überein", () => {
    const result = runSimulation(data, options({ games: 2, seed: 5 }));
    const total = result.rows.reduce((sum, r) => sum + Object.values(r.buys).reduce((a, b) => a + b, 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(result.buyColumns).not.toContain("coin");
    expect(result.buyColumns).not.toContain("goblin_token");
    expect(result.buyColumns).toContain("silver");
  });

  it("E15: Bot-Mischung je Platz, je Partie um einen Platz weitergeschoben", () => {
    const mix = options({ bots: ["greedy", "random", "random", "random"] });
    expect(botsForGame(mix, players, 0)).toEqual(["greedy", "random", "random", "random"]);
    expect(botsForGame(mix, players, 1)).toEqual(["random", "random", "random", "greedy"]);
    expect(botsForGame({ ...mix, rotateBots: false }, players, 1)).toEqual(["greedy", "random", "random", "random"]);
    expect(botsForGame(options({ bots: ["random"] }), players, 3)).toEqual(["random", "random", "random", "random"]);
    expect(() => botsForGame(options({ bots: ["greedy", "random"] }), players, 0)).toThrow(RangeError);
    const result = runSimulation(data, options({ games: 4, seed: 3, bots: ["greedy", "random", "random", "random"] }));
    for (let game = 0; game < 4; game++) {
      expect(result.rows.filter((r) => r.game === game && r.bot === "greedy").map((r) => r.player)).toEqual([(players - game) % players]);
    }
  });

  it("E15: Anführer-Verteilung random, rotate und fest", () => {
    const all = [...data.leaders.keys()];
    const random = leadersForGame(data, { kind: "random" }, 0, 9);
    expect([...random].sort()).toEqual([...all].sort().slice(0, players));
    expect(leadersForGame(data, { kind: "random" }, 0, 9)).toEqual(random);
    const seen = new Set<string>();
    for (let s = 0; s < 20; s++) seen.add(leadersForGame(data, { kind: "random" }, 0, s).join(","));
    expect(seen.size).toBeGreaterThan(1);
    expect(leadersForGame(data, { kind: "rotate" }, 0, 1)).toEqual(all.slice(0, players));
    expect(leadersForGame(data, { kind: "rotate" }, 1, 1)[0]).toBe(all[1]);
    const fixed = ["vex", "vex", "brann", "ilyra"];
    expect(leadersForGame(data, { kind: "fixed", leaders: fixed }, 5, 1)).toEqual(fixed);
    expect(() => leadersForGame(data, { kind: "fixed", leaders: ["brann"] }, 0, 1)).toThrow(RangeError);
    expect(() => leadersForGame(data, { kind: "fixed", leaders: ["brann", "ilyra", "vex", "nobody"] }, 0, 1)).toThrow(/nobody/);
  });

  it("E15: Fehler einer Partie werden gesammelt, die übrigen laufen weiter", () => {
    const result = runSimulation(data, options({ games: 2, leaders: { kind: "fixed", leaders: ["brann", "ilyra", "vex", "nobody"] } }));
    expect(result.rows).toEqual([]);
    expect(result.failures.map((f) => f.game)).toEqual([0, 1]);
    expect(result.failures[0]?.message).toMatch(/nobody/);
    expect(summarize(result)).toMatch(/FEHLER Partie 0 \(Seed 1\): .*nobody/);
  });

  it("E15: Zusammenfassung nennt Partien, Siegarten und Siegquoten", () => {
    const text = summarize(runSimulation(data, options({ games: 4, seed: 2, leaders: { kind: "rotate" } })));
    expect(text).toMatch(/^Partien: 4 beendet, 0 mit Fehler/);
    expect(text).toContain("Siegarten:");
    for (const id of data.leaders.keys()) expect(text).toContain(id);
  });

  it("E15: Befehlszeile", () => {
    expect(parseArgs([])).toEqual({ ...DEFAULT_SIM_OPTIONS, out: null });
    expect(parseArgs(["--games", "100"]).games).toBe(100);
    const parsed = parseArgs(["--games", "5", "--seed", "0", "--bots", "greedy,random,random,random", "--leaders", "rotate", "--no-rotate-bots", "--out", "-"]);
    expect(parsed).toEqual({ games: 5, seed: 0, bots: ["greedy", "random", "random", "random"], leaders: { kind: "rotate" }, rotateBots: false, out: "-" });
    expect(parseArgs(["--leaders", "brann,ilyra,vex,morgra"]).leaders).toEqual({ kind: "fixed", leaders: ["brann", "ilyra", "vex", "morgra"] });
    expect(() => parseArgs(["--games"])).toThrow(/Wert/);
    expect(() => parseArgs(["--games", "0"])).toThrow(/mindestens 1/);
    expect(() => parseArgs(["--games", "x"])).toThrow(/ganze Zahl/);
    expect(() => parseArgs(["--bots", "smart"])).toThrow(/Unbekannter Bot/);
    expect(() => parseArgs(["--fast"])).toThrow(/Unbekannte Option/);
  });
});
