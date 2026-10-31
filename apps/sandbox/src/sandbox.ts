/**
 * Kampf-Sandbox (D1): reine Logik ohne DOM, damit sie getestet werden kann.
 *
 * Zwei Seiten stellen Einheiten aus dem Mini-Set in einer Frontarena auf (R-3.2: Seite A belegt die
 * Arena-Zeilen 0–2, Seite B die Zeilen 3–5). Der Kampf läuft über die echte Engine (`createCombat`,
 * `stepCombat`), das Ergebnis folgt R-9.1, R-9.7 und R-10.1/R-10.2/R-10.5.
 */
import {
  arenaToFront,
  type CombatSim,
  type ConfigData,
  type FighterInit,
  fighterFromData,
  frontArenaSize,
  type GameData,
  type GridSize,
  inBounds,
  livingFighters,
  type OffsetCoord,
  type UnitStats,
  createCombat,
  stepCombat,
} from "@game/engine";

/** 0 = Seite A (oben, Arena-Zeilen 0–2), 1 = Seite B (unten, Zeilen 3–5). */
export type SandboxSide = 0 | 1;
export type SandboxKind = "card" | "token" | "leader";
export type Stars = 1 | 2 | 3;

export interface SandboxUnit {
  kind: SandboxKind;
  sourceId: string;
  /** Anführer haben immer 1 Stern (R-15.3). */
  stars: Stars;
  /** Arena-Koordinaten der Frontarena. */
  pos: OffsetCoord;
}

export interface CatalogEntry {
  kind: SandboxKind;
  sourceId: string;
  name: string;
  cost: number;
  classId: string;
  className: string;
  raceName: string | null;
  stats: UnitStats;
  /** Hat die Einheit eine Fähigkeit? Fähigkeiten wirken erst mit E10. */
  hasAbility: boolean;
}

/** Alle Einheiten, die man in der Sandbox aufstellen kann: Einheitenkarten, Tokens und Anführer. */
export function sandboxCatalog(data: GameData): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const className = (id: string): string => data.classes.get(id)?.name ?? id;
  const raceName = (id: string | null): string | null => (id === null ? null : (data.races.get(id)?.name ?? id));
  for (const card of data.cards.values()) {
    if (card.type !== "unit") continue;
    entries.push({
      kind: card.pool === "token" ? "token" : "card",
      sourceId: card.id,
      name: card.name,
      cost: card.cost,
      classId: card.class,
      className: className(card.class),
      raceName: raceName(card.race),
      stats: card.stats,
      hasAbility: (card.abilities ?? []).length > 0,
    });
  }
  for (const leader of data.leaders.values()) {
    entries.push({
      kind: "leader",
      sourceId: leader.id,
      name: leader.name,
      cost: 0,
      classId: leader.class,
      className: className(leader.class),
      raceName: raceName(leader.race),
      stats: leader.stats,
      hasAbility: leader.abilities.length > 0,
    });
  }
  const kindOrder: Record<SandboxKind, number> = { leader: 0, card: 1, token: 2 };
  return entries.sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.cost - b.cost || a.name.localeCompare(b.name, "de"),
  );
}

export function sandboxArenaSize(data: GameData): GridSize {
  return frontArenaSize(data.config.arenas.frontZone);
}

/** R-3.2: zu welcher Seite gehört ein Feld der Frontarena? */
export function sideOfCell(data: GameData, pos: OffsetCoord): SandboxSide {
  return arenaToFront(pos, data.config.arenas.frontZone).side === "first" ? 0 : 1;
}

function sameCell(a: OffsetCoord, b: OffsetCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

export function unitAt(units: readonly SandboxUnit[], pos: OffsetCoord): SandboxUnit | undefined {
  return units.find((u) => sameCell(u.pos, pos));
}

/**
 * Setzt eine Einheit auf ein Feld (ersetzt eine dort stehende). Liefert die neue Liste oder `null`, wenn das
 * Feld außerhalb der Arena liegt, die Einheit unbekannt ist oder ein zweiter Anführer auf dieselbe Seite käme.
 */
export function placeUnit(data: GameData, units: readonly SandboxUnit[], unit: SandboxUnit): SandboxUnit[] | null {
  if (!inBounds(unit.pos, sandboxArenaSize(data))) return null;
  if (!isKnownUnit(data, unit.kind, unit.sourceId)) return null;
  const rest = units.filter((u) => !sameCell(u.pos, unit.pos));
  const side = sideOfCell(data, unit.pos);
  if (unit.kind === "leader" && rest.some((u) => u.kind === "leader" && sideOfCell(data, u.pos) === side)) return null;
  const stars: Stars = unit.kind === "leader" ? 1 : unit.stars;
  return [...rest, { kind: unit.kind, sourceId: unit.sourceId, stars, pos: { col: unit.pos.col, row: unit.pos.row } }];
}

export function removeUnit(units: readonly SandboxUnit[], pos: OffsetCoord): SandboxUnit[] {
  return units.filter((u) => !sameCell(u.pos, pos));
}

function isKnownUnit(data: GameData, kind: SandboxKind, sourceId: string): boolean {
  if (kind === "leader") return data.leaders.has(sourceId);
  const card = data.cards.get(sourceId);
  if (!card || card.type !== "unit") return false;
  return (card.pool === "token") === (kind === "token");
}

/**
 * R-9.2: Kämpfer aus der Aufstellung. IDs in Aufstellungsreihenfolge ab 1 (sie bestimmen die
 * Handlungsreihenfolge nach R-9.3), Team = Seite.
 */
export function buildFighters(data: GameData, units: readonly SandboxUnit[]): FighterInit[] {
  return units.map((u, i) =>
    fighterFromData(data, {
      id: i + 1,
      team: sideOfCell(data, u.pos),
      kind: u.kind,
      sourceId: u.sourceId,
      stars: u.kind === "leader" ? 1 : u.stars,
      pos: u.pos,
    }),
  );
}

export type SandboxOutcomeKind = "combat" | "emptyFront" | "noFight";

export interface SandboxRun {
  /** Art des Kampfs nach R-9.1. Nur bei `combat` wird simuliert. */
  kind: SandboxOutcomeKind;
  sim: CombatSim;
  fighters: FighterInit[];
}

/** Startet einen Kampf (noch kein Tick abgearbeitet). */
export function startSandbox(data: GameData, units: readonly SandboxUnit[]): SandboxRun {
  const fighters = buildFighters(data, units);
  const teams = new Set(fighters.map((f) => f.team));
  const kind: SandboxOutcomeKind = teams.size === 0 ? "noFight" : teams.size === 1 ? "emptyFront" : "combat";
  const sim = createCombat(data.config, sandboxArenaSize(data), fighters);
  return { kind, sim, fighters };
}

/** Einen Tick weiter. Liefert `false`, wenn der Kampf beendet ist (ohne Simulation sofort). */
export function stepSandbox(run: SandboxRun): boolean {
  if (run.kind !== "combat") return false;
  return stepCombat(run.sim);
}

export function isFinished(run: SandboxRun): boolean {
  return run.kind !== "combat" || run.sim.ended;
}

/** Spielt den Kampf bis zum Ende. */
export function finishSandbox(run: SandboxRun): void {
  while (stepSandbox(run)) {
    // weiter
  }
}

/** R-10.5: Grundschaden einer Runde aus `config.baseDamage`. */
export function baseDamage(config: ConfigData, round: number): number {
  const b = config.baseDamage;
  return b.base + Math.max(0, round - b.rampStartsAfterRound) * b.perRound;
}

export interface SandboxOutcome {
  kind: SandboxOutcomeKind;
  /** Gewinnende Seite oder `null` (Unentschieden bzw. kein Kampf). */
  winner: SandboxSide | null;
  ticks: number;
  /** Überlebende Kämpfer-IDs des Siegers bzw. aller Seiten bei Unentschieden. */
  survivors: number[];
  /** Summe `breakthrough` der überlebenden Einheiten des Siegers (R-10.1). */
  breakthrough: number;
  baseDamage: number;
  /** Lebensverlust des Verlierers (R-10.1); 0 bei Unentschieden (F2). */
  damage: number;
  /** Beute für den Sieger bei leerer Front (R-10.2). */
  loot: number;
}

/** Ergebnis eines beendeten Kampfs. `round` bestimmt den Grundschaden (R-10.5). */
export function sandboxOutcome(data: GameData, run: SandboxRun, round: number): SandboxOutcome {
  const base = baseDamage(data.config, round);
  if (run.kind === "noFight") {
    return { kind: "noFight", winner: null, ticks: 0, survivors: [], breakthrough: 0, baseDamage: base, damage: 0, loot: 0 };
  }
  if (run.kind === "emptyFront") {
    // R-9.1, R-10.2: die einzige Seite gewinnt ohne Simulation mit allen Einheiten.
    const winner = (run.fighters[0]?.team ?? 0) as SandboxSide;
    const breakthrough = run.fighters.reduce((s, f) => s + f.stats.breakthrough, 0);
    return {
      kind: "emptyFront",
      winner,
      ticks: 0,
      survivors: run.fighters.map((f) => f.id),
      breakthrough,
      baseDamage: base,
      damage: breakthrough + base,
      loot: data.config.emptyFrontLoot,
    };
  }
  if (!run.sim.ended) throw new Error("Der Kampf ist noch nicht beendet");
  const living = livingFighters(run.sim);
  const winner = run.sim.winner === null ? null : (run.sim.winner as SandboxSide);
  const breakthrough = winner === null ? 0 : living.filter((f) => f.team === winner).reduce((s, f) => s + f.breakthrough, 0);
  return {
    kind: "combat",
    winner,
    ticks: run.sim.tick,
    survivors: living.map((f) => f.id),
    breakthrough,
    baseDamage: base,
    damage: winner === null ? 0 : breakthrough + base,
    loot: 0,
  };
}

// ---------------------------------------------------------------------------
// Aufstellung als Text (für Links zum Teilen)
// ---------------------------------------------------------------------------

const KIND_CODE: Record<SandboxKind, string> = { card: "c", token: "t", leader: "l" };

/** Aufstellung als kurzer Text, z. B. `c.recruit.1.2.1~l.brann.1.2.4`. */
export function encodeSetup(units: readonly SandboxUnit[]): string {
  return units.map((u) => [KIND_CODE[u.kind], u.sourceId, u.stars, u.pos.col, u.pos.row].join(".")).join("~");
}

/** Umkehrung von `encodeSetup`; ungültige Teile werden übersprungen. */
export function decodeSetup(data: GameData, text: string): SandboxUnit[] {
  let units: SandboxUnit[] = [];
  for (const part of text.split("~")) {
    const [k, sourceId, s, c, r] = part.split(".");
    const kind = (Object.keys(KIND_CODE) as SandboxKind[]).find((key) => KIND_CODE[key] === k);
    const stars = Number(s);
    const col = Number(c);
    const row = Number(r);
    if (!kind || sourceId === undefined || ![1, 2, 3].includes(stars)) continue;
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue;
    if (unitAt(units, { col, row })) continue;
    const next = placeUnit(data, units, { kind, sourceId, stars: stars as Stars, pos: { col, row } });
    if (next) units = next;
  }
  return units;
}
