/**
 * Simulations-Werkzeug (E15): spielt N Partien mit Bots und liefert je Partie und Spieler eine Zeile
 * (Seed, Anführer, Bot, Platz, Siegart, Runden, Leben, Machtpunkte, Käufe nach Karte).
 * Rein und deterministisch: gleiche Optionen = gleiche Zeilen. Ein-/Ausgabe nur in `cli.ts`.
 */
import {
  type Bot,
  createRngState,
  type GameData,
  type GameState,
  GreedyBot,
  playBotGame,
  RandomBot,
  shuffleInPlace,
} from "@game/engine";

export const BOT_KINDS = ["greedy", "random"] as const;
export type BotKind = (typeof BOT_KINDS)[number];

/**
 * Anführer-Verteilung: `random` = je Partie zufällige Zuordnung über den Seed, `rotate` = Anführer-Liste je
 * Partie um einen Platz weiterschieben (jeder Anführer gleich oft auf jedem Platz), `fixed` = feste Liste.
 */
export type LeaderMode = { kind: "random" } | { kind: "rotate" } | { kind: "fixed"; leaders: string[] };

export interface SimOptions {
  games: number;
  /** Seed der ersten Partie; Partie g hat den Seed `seed + g`. */
  seed: number;
  /** Bot je Platz (Länge = Spielerzahl) oder ein einziger Bot für alle Plätze. */
  bots: BotKind[];
  /** Bots je Partie um einen Platz weiterschieben, damit kein Bot dauerhaft auf demselben Platz sitzt. */
  rotateBots: boolean;
  leaders: LeaderMode;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  games: 100,
  seed: 1,
  bots: ["greedy"],
  rotateBots: true,
  leaders: { kind: "random" },
};

export interface SimRow {
  game: number;
  seed: number;
  player: number;
  leader: string;
  bot: BotKind;
  /** 1 = beste; geteilte Plätze möglich (R-13.2). */
  placement: number;
  winner: boolean;
  victory: string;
  rounds: number;
  life: number;
  power: number;
  eliminated: boolean;
  /** Käufe je Karten-ID (nur kaufbare Karten, siehe `buyableCardIds`). */
  buys: Record<string, number>;
}

export interface SimFailure {
  game: number;
  seed: number;
  message: string;
}

/** Kennzahlen einer beendeten Partie für die Abnahme (E16a); nicht Teil der CSV. */
export interface SimGame {
  game: number;
  seed: number;
  rounds: number;
  victory: string;
  /** Phase am Ende (erwartet `gameOver`). */
  phase: string;
  /** Anzahl `action_rejected`-Ereignisse; Bots planen mit `PlanningDraft`, erwartet 0. */
  rejectedActions: number;
}

export interface SimResult {
  rows: SimRow[];
  games: SimGame[];
  failures: SimFailure[];
  /** Spalten der Käufe in fester Reihenfolge (Datenreihenfolge). */
  buyColumns: string[];
}

/** Karten, die gekauft werden können: Basisstapel, Königreich und Klassen-Pools (R-4.5), ohne `buyable: false`. */
export function buyableCardIds(data: GameData): string[] {
  return [...data.cards.values()]
    .filter((c) => c.buyable !== false && (c.pool === "basic" || c.pool === "kingdom" || c.pool.startsWith("class:")))
    .map((c) => c.id);
}

/** Seed eines Bots aus Partie-Seed und Platz (eigener Zufall, unabhängig vom Zufall der Partie). */
export function botSeed(gameSeed: number, player: number): number {
  let z = (Math.imul(gameSeed >>> 0, 0x9e3779b1) + Math.imul(player + 1, 0x85ebca6b)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x7feb352d) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

export function createBot(kind: BotKind, seed: number): Bot {
  return kind === "greedy" ? new GreedyBot(seed) : new RandomBot(seed);
}

/** Bot-Art je Platz für Partie `game`. */
export function botsForGame(options: SimOptions, players: number, game: number): BotKind[] {
  const mix = options.bots.length === 1 ? Array.from({ length: players }, () => options.bots[0] as BotKind) : options.bots;
  if (mix.length !== players) throw new RangeError(`--bots braucht 1 oder ${players} Einträge, erhalten: ${mix.length}`);
  const shift = options.rotateBots ? game % players : 0;
  return mix.map((_, p) => mix[(p + shift) % players] as BotKind);
}

/** Anführer je Platz für Partie `game` mit Seed `gameSeed`. */
export function leadersForGame(data: GameData, mode: LeaderMode, game: number, gameSeed: number): string[] {
  const players = data.config.players;
  const all = [...data.leaders.keys()];
  if (mode.kind === "fixed") {
    if (mode.leaders.length !== players) throw new RangeError(`--leaders braucht ${players} Anführer, erhalten: ${mode.leaders.length}`);
    for (const id of mode.leaders) if (!data.leaders.has(id)) throw new RangeError(`Unbekannter Anführer: ${id}`);
    return [...mode.leaders];
  }
  if (all.length < players) throw new RangeError(`Zu wenige Anführer (${all.length}) für ${players} Spieler`);
  if (mode.kind === "rotate") return Array.from({ length: players }, (_, p) => all[(p + game) % all.length] as string);
  // Eigener Zufall für die Verteilung, damit sie nicht vom Zufall der Partie abhängt.
  return shuffleInPlace(createRngState(botSeed(gameSeed, 1000)), all).slice(0, players);
}

/** Zeilen einer beendeten Partie. */
export function rowsOfGame(state: GameState, data: GameData, game: number, leaders: readonly string[], bots: readonly BotKind[], buyColumns: readonly string[]): SimRow[] {
  const result = state.result;
  if (!result) throw new Error("Partie ist nicht beendet");
  const buys = state.players.map(() => Object.fromEntries(buyColumns.map((id) => [id, 0])) as Record<string, number>);
  for (const event of state.log) {
    if (event.type !== "card_bought") continue;
    const perPlayer = buys[event.player] as Record<string, number>;
    perPlayer[event.cardId] = (perPlayer[event.cardId] ?? 0) + 1;
  }
  return state.players.map((p, i) => {
    if (p.placement === null) throw new Error(`Spieler ${i} hat keine Platzierung`);
    return {
      game,
      seed: state.seed,
      player: i,
      leader: leaders[i] as string,
      bot: bots[i] as BotKind,
      placement: p.placement,
      winner: p.placement === 1,
      victory: result.reason,
      rounds: result.round,
      life: p.life,
      power: p.power,
      eliminated: p.eliminated,
      buys: buys[i] as Record<string, number>,
    };
  });
}

export function runSimulation(data: GameData, options: SimOptions): SimResult {
  if (!Number.isInteger(options.games) || options.games < 1) throw new RangeError(`--games muss eine positive ganze Zahl sein, erhalten: ${options.games}`);
  const buyColumns = buyableCardIds(data);
  const rows: SimRow[] = [];
  const games: SimGame[] = [];
  const failures: SimFailure[] = [];
  for (let game = 0; game < options.games; game++) {
    const seed = (options.seed + game) >>> 0;
    const kinds = botsForGame(options, data.config.players, game);
    try {
      const leaders = leadersForGame(data, options.leaders, game, seed);
      const bots = kinds.map((kind, p) => createBot(kind, botSeed(seed, p)));
      const state = playBotGame(data, { seed, bots, leaders });
      rows.push(...rowsOfGame(state, data, game, leaders, kinds, buyColumns));
      games.push({
        game,
        seed,
        rounds: state.result?.round ?? state.round,
        victory: state.result?.reason ?? "none",
        phase: state.phase,
        rejectedActions: state.log.filter((e) => e.type === "action_rejected").length,
      });
    } catch (error) {
      failures.push({ game, seed, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rows, games, failures, buyColumns };
}

const BASE_COLUMNS = ["game", "seed", "player", "leader", "bot", "placement", "winner", "victory", "rounds", "life", "power", "eliminated", "buys_total"] as const;

export function csvHeader(buyColumns: readonly string[]): string[] {
  return [...BASE_COLUMNS, ...buyColumns.map((id) => `buy_${id}`)];
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV mit Kopfzeile, Komma als Trenner, Zeilenende `\n`. */
export function toCsv(result: SimResult): string {
  const lines = [csvHeader(result.buyColumns).join(",")];
  for (const r of result.rows) {
    const buyCounts = result.buyColumns.map((id) => r.buys[id] ?? 0);
    const total = Object.values(r.buys).reduce((a, b) => a + b, 0);
    const fields: (string | number)[] = [r.game, r.seed, r.player, r.leader, r.bot, r.placement, r.winner ? 1 : 0, r.victory, r.rounds, r.life, r.power, r.eliminated ? 1 : 0, total, ...buyCounts];
    lines.push(fields.map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${((100 * part) / whole).toFixed(1)} %`;
}

/** Kurze Zusammenfassung zum Lesen in der Konsole (Siegquoten je Anführer und Bot, Siegarten, Runden). */
export function summarize(result: SimResult): string {
  const games = new Map<number, SimRow>();
  for (const r of result.rows) if (!games.has(r.game)) games.set(r.game, r);
  const gameCount = games.size;
  const lines = [`Partien: ${gameCount} beendet, ${result.failures.length} mit Fehler`];
  if (gameCount > 0) {
    const rounds = [...games.values()].map((r) => r.rounds);
    lines.push(`Runden: Schnitt ${(rounds.reduce((a, b) => a + b, 0) / gameCount).toFixed(1)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}`);
    const reasons = new Map<string, number>();
    for (const r of games.values()) reasons.set(r.victory, (reasons.get(r.victory) ?? 0) + 1);
    lines.push(`Siegarten: ${[...reasons].sort().map(([k, n]) => `${k} ${n} (${percent(n, gameCount)})`).join(", ")}`);
    for (const [label, key] of [["Anführer", "leader"], ["Bot", "bot"]] as const) {
      const stats = new Map<string, { seats: number; wins: number; placement: number }>();
      for (const r of result.rows) {
        const s = stats.get(r[key]) ?? { seats: 0, wins: 0, placement: 0 };
        s.seats++;
        if (r.winner) s.wins++;
        s.placement += r.placement;
        stats.set(r[key], s);
      }
      lines.push(`Siegquote je ${label} (Platz 1, geteilt zählt mit; Schnitt Platz):`);
      for (const [name, s] of [...stats].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  ${name.padEnd(8)} ${percent(s.wins, s.seats).padStart(8)} von ${s.seats} Plätzen, Platz ${(s.placement / s.seats).toFixed(2)}`);
      }
    }
  }
  for (const f of result.failures) lines.push(`FEHLER Partie ${f.game} (Seed ${f.seed}): ${f.message}`);
  return lines.join("\n");
}

/** Befehlszeile: `--games N --seed S --bots greedy[,random,…] --leaders random|rotate|id,id,id,id --no-rotate-bots --check --out DATEI`. */
export interface CliOptions extends SimOptions {
  /** Zieldatei; `-` = Standardausgabe; `null` = Vorgabe des CLI. */
  out: string | null;
  /** Abnahmeprüfung (E16a) ausführen; Exit-Code 1 bei Befund. */
  check: boolean;
}

export function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_SIM_OPTIONS, bots: [...DEFAULT_SIM_OPTIONS.bots], out: null, check: false };
  const value = (i: number, flag: string): string => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} braucht einen Wert`);
    return v;
  };
  const integer = (text: string, flag: string): number => {
    if (!/^\d+$/.test(text)) throw new Error(`${flag} braucht eine ganze Zahl ≥ 0, erhalten: ${text}`);
    return Number(text);
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] as string;
    switch (flag) {
      case "--games":
        options.games = integer(value(i, flag), flag);
        i++;
        break;
      case "--seed":
        options.seed = integer(value(i, flag), flag);
        i++;
        break;
      case "--bots": {
        const kinds = value(i, flag).split(",").map((s) => s.trim());
        for (const k of kinds) if (!(BOT_KINDS as readonly string[]).includes(k)) throw new Error(`Unbekannter Bot: ${k} (erlaubt: ${BOT_KINDS.join(", ")})`);
        options.bots = kinds as BotKind[];
        i++;
        break;
      }
      case "--leaders": {
        const v = value(i, flag);
        options.leaders = v === "random" || v === "rotate" ? { kind: v } : { kind: "fixed", leaders: v.split(",").map((s) => s.trim()) };
        i++;
        break;
      }
      case "--no-rotate-bots":
        options.rotateBots = false;
        break;
      case "--check":
        options.check = true;
        break;
      case "--out":
        options.out = value(i, flag);
        i++;
        break;
      default:
        throw new Error(`Unbekannte Option: ${flag}`);
    }
  }
  if (options.games < 1) throw new Error("--games muss mindestens 1 sein");
  return options;
}
