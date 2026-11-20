/**
 * Kampfwiedergabe (C4a): reine Logik ohne Babylon und ohne Spielzustand.
 *
 * R-19.2: Das Ereignisprotokoll ist die einzige Quelle für die Animation. Dieses Modul liest deshalb nur
 * * Ereignisse (`combat_started` bis `combat_ended` mit den Tick-Ereignissen dazwischen) und die festen
 * Spieldaten (für die Form der Figur); es bekommt nie einen `GameState`. Daraus entstehen
 * - je Kampf eine `CombatReplay` mit Startaufstellung und den sichtbaren Schritten je Tick,
 * - `replayFrameAt`: wer zu einem Tick wo steht, mit wie vielen Lebenspunkten und Schild, wer tot ist,
 * - `ReplayPlayer`: Abspielen nacheinander in der Reihenfolge des Protokolls, Geschwindigkeit wählbar,
 *   aktuellen Kampf oder alle Kämpfe überspringen.
 * `scene.ts` (C4c) zeichnet nur, was hier herauskommt.
 */
import type { GameData, GameEvent, OffsetCoord, PlayerIndex, Stat, UnitId } from "@game/engine";
import type { FigureShape } from "./unitFigures";

/** Kämpfer in einem Bild der Wiedergabe. */
export interface ReplayFighter {
  unitId: UnitId;
  player: PlayerIndex;
  sourceId: string;
  shape: FigureShape;
  /** Im Kampf beschworen (`combat_unit_summoned`), nicht in der Startaufstellung. */
  summoned: boolean;
  cell: OffsetCoord;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
  /** Bis einschließlich dieses Ticks betäubt (`combat_unit_stunned`); sonst `null`. */
  stunnedUntil: number | null;
}

/** Ein sichtbarer Schritt der Animation. Jeder Schritt stammt aus genau einem Ereignis. */
export type ReplayStep =
  | { kind: "move"; unit: UnitId; from: OffsetCoord; to: OffsetCoord; jump: boolean }
  | { kind: "attack"; unit: UnitId; target: UnitId }
  | { kind: "ability"; unit: UnitId; target: UnitId | null }
  /** Schadenszahl: `amount` vor Schild, `absorbed` vom Schild geschluckt, `hpLoss` an Leben verloren. */
  | { kind: "damage"; source: UnitId | null; target: UnitId; damageKind: "attack" | "ability"; amount: number; absorbed: number; hpLoss: number; hp: number }
  | { kind: "heal"; source: UnitId | null; target: UnitId; amount: number; hp: number }
  | { kind: "shield"; source: UnitId | null; target: UnitId; amount: number; shield: number }
  | { kind: "buff"; source: UnitId | null; target: UnitId; stat: Stat; amount: number }
  | { kind: "keyword"; source: UnitId | null; target: UnitId; keyword: string }
  | { kind: "stun"; unit: UnitId; ticks: number }
  | { kind: "summon"; unit: UnitId; summoner: UnitId | null; cell: OffsetCoord }
  | { kind: "death"; unit: UnitId; killer: UnitId | null }
  | { kind: "wound"; unit: UnitId; source: UnitId | null };

export interface ReplayTick {
  tick: number;
  steps: ReplayStep[];
}

export interface CombatReplay {
  arena: string;
  round: number;
  players: PlayerIndex[];
  /** Startaufstellung vor Tick 0 (aus `combat_started`). */
  start: ReplayFighter[];
  /** Beschworene Kämpfer mit ihren Startwerten, nach ID (aus `combat_unit_summoned`). */
  summons: ReplayFighter[];
  /** Nur Ticks mit sichtbaren Schritten, aufsteigend. Tick 0 = Kampfbeginn (R-9.0). */
  ticks: ReplayTick[];
  /** Letzter Tick des Kampfs (`combat_ended`). */
  endTick: number;
  /** Siegende Seite laut `combat_ended`; `null` = Unentschieden bzw. kein Halter. */
  winner: PlayerIndex | null;
  survivors: UnitId[];
}

/** Form der Figur aus den festen Spieldaten (wie `figureShape`, aber nur aus der Quell-ID). */
export function replayShape(data: GameData, sourceId: string, summoned: boolean): FigureShape {
  if (data.leaders.has(sourceId)) return "leader";
  const card = data.cards.get(sourceId);
  if (summoned || !card || card.type !== "unit") return "token";
  return card.stats.range > 1 ? "ranged" : "melee";
}

type CombatEventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

/** Ereignis zu Schritt; Ereignisse ohne sichtbare Wirkung (Zielwechsel, Mana) ergeben `null`. */
function stepFor(event: GameEvent): ReplayStep | null {
  switch (event.type) {
    case "combat_unit_moved":
      return { kind: "move", unit: event.unit, from: { ...event.from }, to: { ...event.to }, jump: false };
    case "combat_unit_jumped":
      return { kind: "move", unit: event.unit, from: { ...event.from }, to: { ...event.to }, jump: true };
    case "combat_attack":
      return { kind: "attack", unit: event.unit, target: event.target };
    case "combat_ability":
      return { kind: "ability", unit: event.unit, target: event.target };
    case "combat_damage":
      return {
        kind: "damage",
        source: event.source,
        target: event.target,
        damageKind: event.kind,
        amount: event.amount,
        absorbed: event.absorbed,
        hpLoss: event.hpLoss,
        hp: event.hp,
      };
    case "combat_healed":
      return { kind: "heal", source: event.source, target: event.target, amount: event.amount, hp: event.hp };
    case "combat_shielded":
      return { kind: "shield", source: event.source, target: event.target, amount: event.amount, shield: event.shield };
    case "combat_buffed":
      return { kind: "buff", source: event.source, target: event.target, stat: event.stat, amount: event.amount };
    case "combat_keyword_granted":
      return { kind: "keyword", source: event.source, target: event.target, keyword: event.keyword };
    case "combat_unit_stunned":
      return { kind: "stun", unit: event.unit, ticks: event.ticks };
    case "combat_unit_summoned":
      return { kind: "summon", unit: event.unit, summoner: event.summoner, cell: { ...event.cell } };
    case "combat_unit_died":
      return { kind: "death", unit: event.unit, killer: event.killer };
    case "combat_unit_wounded":
      return { kind: "wound", unit: event.unit, source: event.source };
    default:
      return null;
  }
}

function tickOf(event: GameEvent): number | null {
  return "tick" in event && typeof event.tick === "number" ? event.tick : null;
}

function startFighter(data: GameData, f: CombatEventOf<"combat_started">["fighters"][number]): ReplayFighter {
  return {
    unitId: f.unitId,
    player: f.player,
    sourceId: f.sourceId,
    shape: replayShape(data, f.sourceId, false),
    summoned: false,
    cell: { ...f.cell },
    hp: f.hp,
    maxHp: f.maxHp,
    shield: f.shield,
    alive: true,
    stunnedUntil: null,
  };
}

/**
 * Alle simulierten Kämpfe der Ereignisliste in Protokollreihenfolge (R-19.2). Fronten ohne Simulation
 * (leere Front, kein Kampf, R-9.1) haben kein `combat_started` und erscheinen nicht. `round` filtert auf
 * eine Runde. Ein Kampf ohne `combat_ended` (abgeschnittenes Protokoll) wird ausgelassen.
 */
export function combatReplays(data: GameData, events: readonly GameEvent[], round?: number): CombatReplay[] {
  const replays: CombatReplay[] = [];
  let open: CombatReplay | null = null;
  for (const event of events) {
    if (round !== undefined && event.round !== round) continue;
    if (event.type === "combat_started") {
      open = {
        arena: event.arena,
        round: event.round,
        players: [...event.players],
        start: event.fighters.map((f) => startFighter(data, f)),
        summons: [],
        ticks: [],
        endTick: 0,
        winner: null,
        survivors: [],
      };
      continue;
    }
    if (!open || !("arena" in event) || event.arena !== open.arena) continue;
    if (event.type === "combat_ended") {
      open.endTick = event.tick;
      open.winner = event.winner === null ? null : (event.winner as PlayerIndex);
      open.survivors = [...event.survivors];
      replays.push(open);
      open = null;
      continue;
    }
    if (event.type === "combat_unit_summoned") {
      open.summons.push({
        unitId: event.unit,
        player: event.team as PlayerIndex,
        sourceId: event.sourceId,
        shape: replayShape(data, event.sourceId, true),
        summoned: true,
        cell: { ...event.cell },
        hp: event.hp,
        maxHp: event.maxHp,
        shield: event.shield,
        alive: true,
        stunnedUntil: null,
      });
    }
    const step = stepFor(event);
    const tick = tickOf(event);
    if (!step || tick === null) continue;
    const last = open.ticks[open.ticks.length - 1];
    if (last && last.tick === tick) last.steps.push(step);
    else open.ticks.push({ tick, steps: [step] });
  }
  return replays;
}

/** Wendet einen Schritt auf das Bild an (verändert `fighters`). */
function applyStep(fighters: Map<UnitId, ReplayFighter>, summons: ReadonlyMap<UnitId, ReplayFighter>, step: ReplayStep, tick: number): void {
  switch (step.kind) {
    case "move": {
      const f = fighters.get(step.unit);
      if (f) f.cell = { ...step.to };
      return;
    }
    case "damage": {
      const f = fighters.get(step.target);
      if (f) {
        f.hp = step.hp;
        f.shield = Math.max(0, f.shield - step.absorbed);
      }
      return;
    }
    case "heal": {
      const f = fighters.get(step.target);
      if (f) f.hp = step.hp;
      return;
    }
    case "shield": {
      const f = fighters.get(step.target);
      if (f) f.shield = step.shield;
      return;
    }
    case "stun": {
      const f = fighters.get(step.unit);
      if (f) f.stunnedUntil = tick + step.ticks - 1;
      return;
    }
    case "summon": {
      const s = summons.get(step.unit);
      if (s) fighters.set(s.unitId, { ...s, cell: { ...step.cell } });
      return;
    }
    case "death": {
      const f = fighters.get(step.unit);
      if (f) {
        f.alive = false;
        f.hp = Math.min(f.hp, 0);
      }
      return;
    }
    default:
      return;
  }
}

function cloneFighter(f: ReplayFighter): ReplayFighter {
  return { ...f, cell: { ...f.cell } };
}

/**
 * Bild der Wiedergabe nach allen Schritten bis einschließlich `tick` (vor Tick 0: `tick` < 0 = Startaufstellung).
 * Enthält auch gestorbene Kämpfer (`alive: false`), damit die Animation sie ausblenden kann.
 */
export function replayFrameAt(replay: CombatReplay, tick: number): ReplayFighter[] {
  const fighters = new Map<UnitId, ReplayFighter>();
  for (const f of replay.start) fighters.set(f.unitId, cloneFighter(f));
  const summons = new Map(replay.summons.map((s) => [s.unitId, s] as const));
  for (const t of replay.ticks) {
    if (t.tick > tick) break;
    for (const step of t.steps) applyStep(fighters, summons, step, t.tick);
  }
  for (const f of fighters.values()) if (f.stunnedUntil !== null && f.stunnedUntil < tick) f.stunnedUntil = null;
  return [...fighters.values()].sort((a, b) => a.unitId - b.unitId);
}

/** Schritte genau eines Ticks (für Einblendungen wie Schadenszahlen). */
export function stepsAt(replay: CombatReplay, tick: number): ReplayStep[] {
  return replay.ticks.find((t) => t.tick === tick)?.steps ?? [];
}

// ---------------------------------------------------------------------------
// Abspielen
// ---------------------------------------------------------------------------

/** Wählbare Geschwindigkeiten (Vielfaches der Grundgeschwindigkeit). */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Ticks je Sekunde bei Geschwindigkeit 1: ein voller Kampf (300 Ticks, R-9.7) dauert 15 Sekunden. */
export const BASE_TICKS_PER_SECOND = 20;
/** Pause nach dem letzten Tick eines Kampfs, bevor der nächste beginnt (Millisekunden bei Geschwindigkeit 1). */
export const END_PAUSE_MS = 1000;

export interface ReplayPosition {
  /** Index des laufenden Kampfs in `replays`; `null` = alle Kämpfe vorbei. */
  index: number | null;
  /** Ganzzahliger Tick im laufenden Kampf (−1 = Startaufstellung vor Tick 0). */
  tick: number;
  /** Bruchteil zum nächsten Tick (0 bis unter 1), für weiche Bewegungen. */
  fraction: number;
}

/**
 * Spielt die Kämpfe nacheinander in Protokollreihenfolge ab. Rein: die Zeit kommt von außen (`advance`).
 * Jeder Kampf beginnt bei Tick −1 (Startaufstellung), läuft bis `endTick` und hält dann `END_PAUSE_MS`.
 */
export class ReplayPlayer {
  private current = 0;
  /** Vergangene Zeit im laufenden Kampf in „Ticks bei Geschwindigkeit 1“-Einheiten (ab −1). */
  private elapsedTicks = -1;
  private speedValue: ReplaySpeed = 1;

  constructor(readonly replays: readonly CombatReplay[]) {}

  get speed(): ReplaySpeed {
    return this.speedValue;
  }

  setSpeed(speed: ReplaySpeed): void {
    if (!REPLAY_SPEEDS.includes(speed)) throw new RangeError(`Unbekannte Geschwindigkeit ${speed}`);
    this.speedValue = speed;
  }

  get finished(): boolean {
    return this.current >= this.replays.length;
  }

  get replay(): CombatReplay | null {
    return this.replays[this.current] ?? null;
  }

  position(): ReplayPosition {
    const replay = this.replay;
    if (!replay) return { index: null, tick: 0, fraction: 0 };
    const clamped = Math.min(this.elapsedTicks, replay.endTick);
    const tick = Math.floor(clamped);
    return { index: this.current, tick, fraction: clamped >= replay.endTick ? 0 : clamped - tick };
  }

  /** Schreitet um `ms` Millisekunden Echtzeit fort; liefert die Ticks, die dabei neu erreicht wurden (je Kampf). */
  advance(ms: number): { index: number; tick: number }[] {
    if (ms < 0) throw new RangeError("Zeit läuft nicht rückwärts");
    const reached: { index: number; tick: number }[] = [];
    let budget = (ms / 1000) * BASE_TICKS_PER_SECOND * this.speedValue;
    const pauseTicks = (END_PAUSE_MS / 1000) * BASE_TICKS_PER_SECOND;
    while (budget > 0 && !this.finished) {
      const replay = this.replays[this.current] as CombatReplay;
      const limit = replay.endTick + pauseTicks;
      const before = this.elapsedTicks;
      const after = Math.min(limit, before + budget);
      // Restzeit unterhalb der Rechengenauigkeit: nicht endlos weiterschleifen (Befund C4c1).
      if (after === before && after < limit) break;
      budget -= after - before;
      for (let t = Math.floor(before) + 1; t <= Math.min(Math.floor(after), replay.endTick); t++) reached.push({ index: this.current, tick: t });
      this.elapsedTicks = after;
      if (after >= limit) this.nextReplay();
    }
    return reached;
  }

  /** Springt ans Ende des laufenden Kampfs (Endbild, danach die Pause). */
  skipCurrent(): void {
    const replay = this.replay;
    if (!replay) return;
    if (this.elapsedTicks >= replay.endTick) this.nextReplay();
    else this.elapsedTicks = replay.endTick;
  }

  /** Überspringt alle restlichen Kämpfe. */
  skipAll(): void {
    this.current = this.replays.length;
    this.elapsedTicks = -1;
  }

  /** Bild des laufenden Kampfs an der aktuellen Stelle. */
  frame(): ReplayFighter[] {
    const replay = this.replay;
    return replay ? replayFrameAt(replay, this.position().tick) : [];
  }

  private nextReplay(): void {
    this.current += 1;
    this.elapsedTicks = -1;
  }
}
