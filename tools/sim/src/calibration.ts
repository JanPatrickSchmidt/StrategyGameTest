/**
 * Kampf-Kalibrierung (B0, Spec B-1/B-3): Armeen gleichen Goldwerts aus dem Mini-Set kämpfen in der
 * Frontarena gegeneinander, über viele zufällige Aufstellungen und Seeds.
 *
 * - Armeen: zufällig gewählte Einheitenkarten (ohne Tokens) bis genau zum Goldbudget, höchstens
 *   `maxUnits` Einheiten; eine ★2-Einheit kostet das Dreifache der Karte (drei Kopien, R-15.1).
 * - Jede Paarung wird zweimal gespielt, mit getauschten Seiten (gespiegelte Aufstellung, R-3.2), damit
 *   weder Seite noch Feld einen Vorteil bringen. Kämpfer-IDs (Handlungsreihenfolge, R-9.3) werden gemischt.
 * - Ausgewertet wird je Karte und Sternstufe: Anteil der Kämpfe, die eine Armee mit dieser Karte gewinnt
 *   (Unentschieden zählt halb). Ziel nach B-3: 45–55 %.
 * - Zweikampf ★2 gegen dreifache Kosten: die ★2-Einheit einer Karte mit Kosten k gegen jede ★1-Karte mit
 *   Kosten 3·k; gibt es keine, gegen die teuersten ★1-Karten unter 3·k, aufgefüllt mit zufälligen ★1-Karten
 *   bis 3·k Gold. Ziel nach B-3: 50–65 %.
 *
 * Nicht berücksichtigt: Rassen-Resonanz (R-17), Anführer, Zauber und Wirkungen außerhalb des Kampfes
 * (z. B. Gold bei Frontsieg); Karten mit solchen Wirkungen werden gekennzeichnet.
 * Rein und deterministisch: gleiche Optionen = gleiche Ergebnisse. Ein-/Ausgabe nur in `calibrationCli.ts`.
 */
import {
  COMBAT_TRIGGERS,
  createCombat,
  createRngState,
  effectHooks,
  type FighterInit,
  fighterFromData,
  frontArenaSize,
  frontToArena,
  type GameData,
  type GridSize,
  nextInt,
  type OffsetCoord,
  type RngState,
  shuffleInPlace,
  stepCombat,
  type UnitCard,
} from "@game/engine";

export type Stars = 1 | 2;

/** Eine Einheit einer Armee: Karte, Stern, Goldwert (★2 = dreifache Kosten). */
export interface ArmyUnit {
  cardId: string;
  stars: Stars;
  value: number;
}

export interface CalibrationOptions {
  /** Anzahl Armee-Paarungen; jede wird zweimal gespielt (Seiten getauscht). */
  battles: number;
  seed: number;
  /** Goldwerte der Armeen; Paarung i nutzt `budgets[i % budgets.length]` für beide Armeen. */
  budgets: number[];
  /** Höchstzahl Einheiten je Armee (Vorgabe: `boardCapacity`). */
  maxUnits: number;
  /** Erlaubt ★2-Einheiten (dreifache Kosten) in den Armeen. */
  allowStar2: boolean;
  /** Wiederholungen je Paarung im Zweikampf ★2 gegen dreifache Kosten (je Gegner, je Seite). */
  duelRepeats: number;
}

export const DEFAULT_CALIBRATION_OPTIONS: Omit<CalibrationOptions, "maxUnits"> = {
  battles: 2000,
  seed: 1,
  budgets: [10],
  allowStar2: true,
  duelRepeats: 40,
};

/** Kartenwahl: alle Einheitenkarten außer Tokens (Startkarten, Königreich, Klassen-Pools). */
export function calibrationCards(data: GameData): UnitCard[] {
  const cards: UnitCard[] = [];
  for (const card of data.cards.values()) {
    if (card.type === "unit" && card.pool !== "token") cards.push(card);
  }
  return cards.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
}

/** Hat die Karte Fähigkeiten, die nicht im Kampf wirken (dann misst die Kalibrierung nur einen Teil)? */
export function hasNonCombatAbility(card: UnitCard): boolean {
  return (card.abilities ?? []).some((a) => !COMBAT_TRIGGERS.includes(a.trigger));
}

interface Entry {
  cardId: string;
  stars: Stars;
  value: number;
}

/**
 * Zufällige Armee mit genau `budget` Gold und höchstens `maxUnits` Einheiten. Gewählt wird gleichverteilt
 * unter allen Einträgen, nach denen das Restbudget noch genau erreichbar ist.
 */
export function randomArmy(
  rng: RngState,
  cards: readonly UnitCard[],
  budget: number,
  maxUnits: number,
  allowStar2: boolean,
): ArmyUnit[] {
  const entries: Entry[] = [];
  for (const card of cards) {
    entries.push({ cardId: card.id, stars: 1, value: card.cost });
    if (allowStar2) entries.push({ cardId: card.id, stars: 2, value: card.cost * 3 });
  }
  // reachable[n][v]: Lässt sich der Goldwert v mit höchstens n Einheiten genau erreichen?
  const values = [...new Set(entries.map((e) => e.value))];
  const reachable: boolean[][] = [Array.from({ length: budget + 1 }, (_, v) => v === 0)];
  for (let n = 1; n <= maxUnits; n++) {
    const prev = reachable[n - 1] as boolean[];
    reachable.push(prev.map((ok, v) => ok || values.some((x) => x <= v && prev[v - x] === true)));
  }
  if (reachable[maxUnits]?.[budget] !== true) {
    throw new RangeError(`Budget ${budget} ist mit höchstens ${maxUnits} Einheiten nicht erreichbar`);
  }
  const army: ArmyUnit[] = [];
  let remaining = budget;
  while (remaining > 0) {
    const slotsAfter = maxUnits - army.length - 1;
    const feasible = entries.filter((e) => e.value <= remaining && reachable[slotsAfter]?.[remaining - e.value] === true);
    if (feasible.length === 0) throw new RangeError(`Keine Armee mit ${budget} Gold möglich`);
    const pick = feasible[nextInt(rng, feasible.length)] as Entry;
    army.push({ cardId: pick.cardId, stars: pick.stars, value: pick.value });
    remaining -= pick.value;
  }
  return army;
}

/** Zufällige, verschiedene Felder der eigenen Frontzone (Koordinaten der Frontzone, R-3.2). */
export function randomPlacement(rng: RngState, zone: GridSize, count: number): OffsetCoord[] {
  const cells: OffsetCoord[] = [];
  for (let row = 0; row < zone.rows; row++) {
    for (let col = 0; col < zone.cols; col++) cells.push({ col, row });
  }
  if (count > cells.length) throw new RangeError(`${count} Einheiten passen nicht in die Frontzone`);
  return shuffleInPlace(rng, cells).slice(0, count);
}

export interface PlacedArmy {
  units: readonly ArmyUnit[];
  /** Frontzonen-Feld je Einheit. */
  cells: readonly OffsetCoord[];
}

/** Ergebnis eines Kampfs aus Sicht der ersten Armee: 1 Sieg, 0,5 Unentschieden, 0 Niederlage. */
export type Score = 0 | 0.5 | 1;

/**
 * Ein Frontkampf (R-9) mit allen Kampf-Fähigkeiten (E10a). `firstSide` = Seite der Armee `a` (R-3.2).
 * Die Kämpfer-IDs werden über `rng` gemischt.
 */
export function fightArmies(
  data: GameData,
  rng: RngState,
  a: PlacedArmy,
  b: PlacedArmy,
  aSide: "first" | "second",
): Score {
  const zone = data.config.arenas.frontZone;
  const bSide = aSide === "first" ? "second" : "first";
  const placed = [
    ...a.units.map((u, i) => ({ unit: u, team: 0, pos: frontToArena(aSide, a.cells[i] as OffsetCoord, zone) })),
    ...b.units.map((u, i) => ({ unit: u, team: 1, pos: frontToArena(bSide, b.cells[i] as OffsetCoord, zone) })),
  ];
  const ids = shuffleInPlace(
    rng,
    placed.map((_, i) => i + 1),
  );
  const inits: FighterInit[] = placed.map((p, i) =>
    fighterFromData(data, {
      id: ids[i] as number,
      team: p.team,
      kind: "card",
      sourceId: p.unit.cardId,
      stars: p.unit.stars,
      pos: p.pos,
    }),
  );
  const sim = createCombat(data.config, frontArenaSize(zone), inits, effectHooks(data).hooks);
  while (stepCombat(sim)) {
    // bis zum Kampfende (R-9.7)
  }
  if (sim.winner === null) return 0.5;
  return sim.winner === 0 ? 1 : 0;
}

/** Zählwerk je Karte und Sternstufe. */
export interface Tally {
  fights: number;
  wins: number;
  draws: number;
  losses: number;
}

function emptyTally(): Tally {
  return { fights: 0, wins: 0, draws: 0, losses: 0 };
}

function addScore(t: Tally, score: Score): void {
  t.fights += 1;
  if (score === 1) t.wins += 1;
  else if (score === 0.5) t.draws += 1;
  else t.losses += 1;
}

/** Siegquote mit halben Unentschieden; `null` ohne Kämpfe. */
export function winRate(t: Tally): number | null {
  return t.fights === 0 ? null : (t.wins + t.draws / 2) / t.fights;
}

export interface CardRow {
  cardId: string;
  name: string;
  cost: number;
  stars: Stars;
  /** Goldwert dieser Sternstufe (★2 = dreifache Kosten). */
  value: number;
  /** Kämpfe, in denen eine Armee mit dieser Karte in dieser Sternstufe kämpfte (aus deren Sicht). */
  tally: Tally;
  nonCombatAbility: boolean;
}

export interface DuelRow {
  cardId: string;
  name: string;
  cost: number;
  /** Gegner: Karten-ID der ★1-Hauptkarte (genau 3·k Gold oder teuerste darunter, dann mit ★1-Auffüllung). */
  opponent: string;
  opponentName: string;
  /** Aus Sicht der ★2-Einheit. */
  tally: Tally;
}

export interface CalibrationResult {
  options: CalibrationOptions;
  cards: CardRow[];
  duels: DuelRow[];
  /** Anteil Unentschieden aller Armee-Kämpfe. */
  drawShare: number;
  armyFights: number;
}

const key = (cardId: string, stars: Stars): string => `${cardId}#${stars}`;

/** Führt die Kalibrierung aus (Armee-Kämpfe und Zweikämpfe ★2 gegen dreifache Kosten). */
export function runCalibration(data: GameData, options: CalibrationOptions): CalibrationResult {
  const cards = calibrationCards(data);
  const zone = data.config.arenas.frontZone;
  const rng = createRngState(options.seed);
  const tallies = new Map<string, Tally>();
  const tallyFor = (cardId: string, stars: Stars): Tally => {
    const k = key(cardId, stars);
    let t = tallies.get(k);
    if (!t) {
      t = emptyTally();
      tallies.set(k, t);
    }
    return t;
  };
  let draws = 0;
  let fights = 0;
  for (let i = 0; i < options.battles; i++) {
    const budget = options.budgets[i % options.budgets.length] as number;
    const unitsA = randomArmy(rng, cards, budget, options.maxUnits, options.allowStar2);
    const unitsB = randomArmy(rng, cards, budget, options.maxUnits, options.allowStar2);
    const a: PlacedArmy = { units: unitsA, cells: randomPlacement(rng, zone, unitsA.length) };
    const b: PlacedArmy = { units: unitsB, cells: randomPlacement(rng, zone, unitsB.length) };
    for (const aSide of ["first", "second"] as const) {
      const score = fightArmies(data, rng, a, b, aSide);
      fights += 1;
      if (score === 0.5) draws += 1;
      const scoreB: Score = score === 1 ? 0 : score === 0 ? 1 : 0.5;
      // Je Armee zählt eine Karte (mit Stern) einmal pro Kampf, auch bei mehreren Kopien.
      for (const k of new Set(unitsA.map((u) => key(u.cardId, u.stars)))) addTally(k, score);
      for (const k of new Set(unitsB.map((u) => key(u.cardId, u.stars)))) addTally(k, scoreB);
    }
  }
  function addTally(k: string, score: Score): void {
    const [cardId, stars] = k.split("#") as [string, string];
    addScore(tallyFor(cardId, Number(stars) as Stars), score);
  }

  const cardRows: CardRow[] = [];
  for (const card of cards) {
    for (const stars of options.allowStar2 ? ([1, 2] as const) : ([1] as const)) {
      cardRows.push({
        cardId: card.id,
        name: card.name,
        cost: card.cost,
        stars,
        value: card.cost * (stars === 2 ? 3 : 1),
        tally: tallies.get(key(card.id, stars)) ?? emptyTally(),
        nonCombatAbility: hasNonCombatAbility(card),
      });
    }
  }

  return {
    options,
    cards: cardRows,
    duels: runDuels(data, cards, options),
    drawShare: fights === 0 ? 0 : draws / fights,
    armyFights: fights,
  };
}

/** Zweikämpfe ★2 (Kosten k) gegen ★1 mit Kosten 3·k (B-1, B-3). */
export function runDuels(data: GameData, cards: readonly UnitCard[], options: CalibrationOptions): DuelRow[] {
  const zone = data.config.arenas.frontZone;
  const rng = createRngState(options.seed + 1_000_003);
  const rows: DuelRow[] = [];
  for (const card of cards) {
    const target = card.cost * 3;
    const star2: ArmyUnit = { cardId: card.id, stars: 2, value: target };
    const exact = cards.filter((c) => c.cost === target);
    const below = cards.filter((c) => c.cost < target);
    const bestBelow = Math.max(...below.map((c) => c.cost));
    // Ohne Karte mit genau 3·k: die teuersten ★1-Karten unter 3·k, aufgefüllt mit zufälligen ★1-Karten bis 3·k.
    const opponents = exact.length > 0 ? exact : below.filter((c) => c.cost === bestBelow);
    const matchups: { opponent: string; opponentName: string; army: () => ArmyUnit[] }[] = opponents.map((o) => {
      const filler = target - o.cost;
      const main: ArmyUnit = { cardId: o.id, stars: 1, value: o.cost };
      return {
        opponent: o.id,
        opponentName: filler === 0 ? o.name : `${o.name} + ${filler} Gold ★1`,
        army: () => (filler === 0 ? [main] : [main, ...randomArmy(rng, cards, filler, options.maxUnits - 1, false)]),
      };
    });
    for (const m of matchups) {
      const tally = emptyTally();
      for (let r = 0; r < options.duelRepeats; r++) {
        const enemy = m.army();
        const a: PlacedArmy = { units: [star2], cells: randomPlacement(rng, zone, 1) };
        const b: PlacedArmy = { units: enemy, cells: randomPlacement(rng, zone, enemy.length) };
        for (const aSide of ["first", "second"] as const) addScore(tally, fightArmies(data, rng, a, b, aSide));
      }
      rows.push({ cardId: card.id, name: card.name, cost: card.cost, opponent: m.opponent, opponentName: m.opponentName, tally });
    }
  }
  return rows;
}

/** B-3: Zielbereiche. */
export const ARMY_TARGET = { min: 0.45, max: 0.55 } as const;
export const DUEL_TARGET = { min: 0.5, max: 0.65 } as const;

export type Verdict = "ok" | "zu stark" | "zu schwach" | "zu wenig Daten";

/** Mindestzahl Kämpfe, ab der eine Siegquote bewertet wird. */
export const MIN_FIGHTS = 30;

export function verdict(t: Tally, target: { min: number; max: number }): Verdict {
  const rate = winRate(t);
  if (rate === null || t.fights < MIN_FIGHTS) return "zu wenig Daten";
  if (rate > target.max) return "zu stark";
  if (rate < target.min) return "zu schwach";
  return "ok";
}

function pct(rate: number | null): string {
  return rate === null ? "" : (rate * 100).toFixed(1);
}

/** CSV je Karte und Sternstufe. */
export function cardsCsv(result: CalibrationResult): string {
  const lines = ["card,name,cost,stars,value,fights,wins,draws,losses,win_rate_pct,verdict,non_combat_ability"];
  for (const r of result.cards) {
    lines.push(
      [
        r.cardId,
        csvText(r.name),
        r.cost,
        r.stars,
        r.value,
        r.tally.fights,
        r.tally.wins,
        r.tally.draws,
        r.tally.losses,
        pct(winRate(r.tally)),
        verdict(r.tally, ARMY_TARGET),
        r.nonCombatAbility ? "yes" : "no",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** CSV der Zweikämpfe ★2 gegen dreifache Kosten. */
export function duelsCsv(result: CalibrationResult): string {
  const lines = ["card,name,cost,opponent,opponent_name,fights,wins,draws,losses,win_rate_pct,verdict"];
  for (const r of result.duels) {
    lines.push(
      [
        r.cardId,
        csvText(r.name),
        r.cost,
        r.opponent,
        csvText(r.opponentName),
        r.tally.fights,
        r.tally.wins,
        r.tally.draws,
        r.tally.losses,
        pct(winRate(r.tally)),
        verdict(r.tally, DUEL_TARGET),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvText(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Kurze Zusammenfassung als Markdown-Tabellen (für die Konsole und als Grundlage des Berichts). */
export function summarizeCalibration(result: CalibrationResult): string {
  const o = result.options;
  const out: string[] = [];
  out.push(
    `Kampf-Kalibrierung: ${o.battles} Paarungen × 2 Seiten = ${result.armyFights} Kämpfe, Budget ${o.budgets.join("/")} Gold, ` +
      `höchstens ${o.maxUnits} Einheiten, ★2 ${o.allowStar2 ? "erlaubt" : "aus"}, Seed ${o.seed}. ` +
      `Unentschieden: ${(result.drawShare * 100).toFixed(1)} %.`,
  );
  out.push("");
  out.push("| Karte | Kosten | ★ | Kämpfe | Siegquote | Bewertung (45–55 %) |");
  out.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const r of result.cards) {
    const note = r.nonCombatAbility ? " (Wirkung auch außerhalb des Kampfes)" : "";
    out.push(
      `| ${r.name} | ${r.cost} | ${r.stars} | ${r.tally.fights} | ${pct(winRate(r.tally))} % | ${verdict(r.tally, ARMY_TARGET)}${note} |`,
    );
  }
  out.push("");
  out.push("| ★2-Einheit | Kosten ×3 | Gegner | Kämpfe | Siegquote ★2 | Bewertung (50–65 %) |");
  out.push("| --- | ---: | --- | ---: | ---: | --- |");
  for (const r of result.duels) {
    out.push(
      `| ${r.name} | ${r.cost * 3} | ${r.opponentName} | ${r.tally.fights} | ${pct(winRate(r.tally))} % | ${verdict(r.tally, DUEL_TARGET)} |`,
    );
  }
  return out.join("\n");
}

/** Befehlszeilen-Optionen: `--battles`, `--seed`, `--budget`, `--max-units`, `--no-star2`, `--duel-repeats`, `--out`. */
export interface CalibrationCliOptions extends CalibrationOptions {
  /** Ordner für die CSVs. */
  out: string | undefined;
}

export function parseCalibrationArgs(argv: readonly string[], boardCapacity: number): CalibrationCliOptions {
  const options: CalibrationCliOptions = { ...DEFAULT_CALIBRATION_OPTIONS, maxUnits: boardCapacity, out: undefined };
  const intArg = (name: string, value: string | undefined, min: number): number => {
    const n = Number(value);
    if (value === undefined || !Number.isInteger(n) || n < min) {
      throw new Error(`${name} braucht eine ganze Zahl ≥ ${min}`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--battles":
        options.battles = intArg(arg, argv[++i], 1);
        break;
      case "--seed":
        options.seed = intArg(arg, argv[++i], 0);
        break;
      case "--budget": {
        const value = argv[++i];
        options.budgets = (value ?? "").split(",").map((part) => intArg(arg, part, 1));
        break;
      }
      case "--max-units":
        options.maxUnits = intArg(arg, argv[++i], 1);
        break;
      case "--duel-repeats":
        options.duelRepeats = intArg(arg, argv[++i], 1);
        break;
      case "--no-star2":
        options.allowStar2 = false;
        break;
      case "--out":
        options.out = argv[++i];
        if (options.out === undefined) throw new Error("--out braucht einen Ordner");
        break;
      default:
        throw new Error(`Unbekannte Option: ${arg}`);
    }
  }
  return options;
}
