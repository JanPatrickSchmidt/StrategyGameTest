/**
 * Wirkungen der Kampfwiedergabe (C4c2a): reine Logik ohne Babylon und ohne Spielzustand.
 *
 * R-19.2: Grundlage sind nur die Schritte einer `CombatReplay` (also das Ereignisprotokoll) und die
 * Brett-Geometrie. Für einen Augenblick (`tick` + `fraction`) des laufenden Kampfs entstehen daraus
 * - Ausfallschritte: Nahkämpfer springen beim Angriff kurz auf ihr Ziel zu (Versatz je Einheit),
 * - Linien: Geschosse von Fernkämpfern und Fähigkeiten mit Ziel fliegen vom Wirker zum Ziel,
 * - Blitze: Ring um den Wirker einer Fähigkeit, um eine beschworene Figur und um eine Figur, die Schild erhält,
 * - aufsteigende Zahlen: Schaden (Lebensverlust und Schild-Anteil getrennt), Heilung, Schild, Buffs,
 *   Schlüsselwörter, Betäubung, Verwundung.
 * Jede Wirkung stammt aus genau einem Schritt und beginnt im Tick ihres Ereignisses. `scene.ts` zeichnet nur,
 * was hier herauskommt.
 */
import type { Stat, UnitId } from "@game/engine";
import type { BoardLayout, WorldPoint } from "./boardLayout";
import { type CombatReplay, type ReplayStep, replayFrameAt } from "./combatReplay";
import { arenaCellPosition } from "./replayAnimation";
import type { FigureShape } from "./unitFigures";

/** Dauer eines Ausfallschritts in Ticks (bei 1×: 20 Ticks je Sekunde). */
export const LUNGE_TICKS = 4;
/** Größte Auslenkung eines Ausfallschritts als Anteil der Strecke zum Ziel. */
export const LUNGE_SHARE = 0.35;
/** Flugzeit eines Geschosses bzw. eines Fähigkeitsstrahls in Ticks. */
export const LINE_TICKS = 4;
/** Dauer eines Blitzes (Fähigkeit, Beschwörung, Schild) in Ticks. */
export const FLASH_TICKS = 10;
/** So lange steigt eine Zahl auf und blendet aus, in Ticks. */
export const FLOAT_TICKS = 18;
/** Ab diesem Abstand (Weltmaß, Nachbarfelder liegen √3 auseinander) ist ein Angriff ein Fernangriff mit Geschoss. */
export const RANGED_DISTANCE = 2.2;

export type EffectTone = "damage" | "shield" | "heal" | "buff" | "status";

/** Aufsteigende Zahl bzw. kurzer Text über einer Figur. `age` läuft von 0 (neu) bis unter 1 (ausgeblendet). */
export interface FloatingText {
  key: string;
  position: WorldPoint;
  text: string;
  tone: EffectTone;
  age: number;
  /** Laufende Nummer der Texte derselben Figur im selben Tick (0, 1, …), damit sie nicht übereinanderliegen. */
  stack: number;
  /** Form der getroffenen Figur (für die Höhe über ihrem Schild). */
  shape: FigureShape;
}

/** Geschoss bzw. Strahl vom Wirker zum Ziel. */
export interface EffectLine {
  key: string;
  kind: "shot" | "ability";
  from: WorldPoint;
  to: WorldPoint;
  player: number;
  age: number;
}

/** Ring um eine Figur. */
export interface EffectFlash {
  key: string;
  kind: "ability" | "summon" | "shield";
  position: WorldPoint;
  player: number;
  age: number;
}

export interface CombatEffects {
  /** Versatz der Figur durch einen Ausfallschritt (nur Einheiten, die gerade zuschlagen). */
  offsets: Map<UnitId, WorldPoint>;
  texts: FloatingText[];
  lines: EffectLine[];
  flashes: EffectFlash[];
}

const STAT_NAMES: Record<Stat, string> = {
  attack: "Angriff",
  hp: "Leben",
  breakthrough: "Durchbruch",
  range: "Reichweite",
  armor: "Rüstung",
  attackInterval: "Angriffstakt",
  moveInterval: "Lauftakt",
  manaMax: "Mana",
};

const KEYWORD_NAMES: Record<string, string> = {
  firstStrike: "Erstschlag",
  unwoundable: "Unverwundbar",
  woundOnKill: "Verwundet beim Töten",
};

/** Text eines Buffs, z. B. „+2 Angriff“. */
export function buffText(stat: Stat, amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${Math.abs(amount)} ${STAT_NAMES[stat] ?? stat}`;
}

export function keywordText(keyword: string): string {
  return KEYWORD_NAMES[keyword] ?? keyword;
}

/** Vorberechnete Wirkung mit fester Weltposition aus dem Bild ihres Ticks. */
type Timed =
  | { tick: number; key: string; type: "lunge"; unit: UnitId; offset: WorldPoint }
  | { tick: number; key: string; type: "line"; line: Omit<EffectLine, "age" | "key"> }
  | { tick: number; key: string; type: "flash"; flash: Omit<EffectFlash, "age" | "key"> }
  | { tick: number; key: string; type: "text"; text: Omit<FloatingText, "age" | "key"> };

function duration(t: Timed): number {
  switch (t.type) {
    case "lunge":
      return LUNGE_TICKS;
    case "line":
      return LINE_TICKS;
    case "flash":
      return FLASH_TICKS;
    case "text":
      return FLOAT_TICKS;
  }
}

/** Texte, die ein Schritt über seinem Ziel erzeugt (ohne Position). */
export function stepTexts(step: ReplayStep): { target: UnitId; text: string; tone: EffectTone }[] {
  switch (step.kind) {
    case "damage": {
      const out: { target: UnitId; text: string; tone: EffectTone }[] = [];
      if (step.hpLoss > 0) out.push({ target: step.target, text: `−${step.hpLoss}`, tone: "damage" });
      if (step.absorbed > 0) out.push({ target: step.target, text: `−${step.absorbed} Schild`, tone: "shield" });
      return out;
    }
    case "heal":
      return step.amount > 0 ? [{ target: step.target, text: `+${step.amount}`, tone: "heal" }] : [];
    case "shield":
      return step.amount > 0 ? [{ target: step.target, text: `+${step.amount} Schild`, tone: "shield" }] : [];
    case "buff":
      return step.amount !== 0 ? [{ target: step.target, text: buffText(step.stat, step.amount), tone: "buff" }] : [];
    case "keyword":
      return [{ target: step.target, text: keywordText(step.keyword), tone: "buff" }];
    case "stun":
      return [{ target: step.unit, text: "betäubt", tone: "status" }];
    case "wound":
      return [{ target: step.unit, text: "verwundet", tone: "status" }];
    default:
      return [];
  }
}

const timedCache = new WeakMap<CombatReplay, WeakMap<BoardLayout, Timed[]>>();

function timedEffects(layout: BoardLayout, replay: CombatReplay): Timed[] {
  let perLayout = timedCache.get(replay);
  if (!perLayout) {
    perLayout = new WeakMap();
    timedCache.set(replay, perLayout);
  }
  const cached = perLayout.get(layout);
  if (cached) return cached;
  const result: Timed[] = [];
  for (const t of replay.ticks) {
    const frame = new Map(replayFrameAt(replay, t.tick).map((f) => [f.unitId, f] as const));
    const where = (unit: UnitId | null): WorldPoint | null => {
      const f = unit === null ? undefined : frame.get(unit);
      return f ? arenaCellPosition(layout, replay.arena, f.cell) : null;
    };
    const playerOf = (unit: UnitId): number => frame.get(unit)?.player ?? 0;
    const stacks = new Map<UnitId, number>();
    for (const [i, step] of t.steps.entries()) {
      const key = `${t.tick}:${i}`;
      if (step.kind === "attack") {
        const from = where(step.unit);
        const to = where(step.target);
        if (!from || !to) continue;
        const distance = Math.hypot(to.x - from.x, to.z - from.z);
        if (distance > RANGED_DISTANCE) {
          result.push({ tick: t.tick, key, type: "line", line: { kind: "shot", from, to, player: playerOf(step.unit) } });
        } else if (distance > 0) {
          result.push({
            tick: t.tick,
            key,
            type: "lunge",
            unit: step.unit,
            offset: { x: (to.x - from.x) * LUNGE_SHARE, z: (to.z - from.z) * LUNGE_SHARE },
          });
        }
        continue;
      }
      if (step.kind === "ability") {
        const from = where(step.unit);
        if (!from) continue;
        result.push({ tick: t.tick, key, type: "flash", flash: { kind: "ability", position: from, player: playerOf(step.unit) } });
        const to = step.target === null || step.target === step.unit ? null : where(step.target);
        if (to) result.push({ tick: t.tick, key: `${key}:line`, type: "line", line: { kind: "ability", from, to, player: playerOf(step.unit) } });
        continue;
      }
      if (step.kind === "summon") {
        const position = arenaCellPosition(layout, replay.arena, step.cell);
        if (position) result.push({ tick: t.tick, key, type: "flash", flash: { kind: "summon", position, player: playerOf(step.unit) } });
        continue;
      }
      if (step.kind === "shield" && step.amount > 0) {
        const position = where(step.target);
        if (position) result.push({ tick: t.tick, key: `${key}:flash`, type: "flash", flash: { kind: "shield", position, player: playerOf(step.target) } });
      }
      for (const [j, text] of stepTexts(step).entries()) {
        const position = where(text.target);
        if (!position) continue;
        const stack = stacks.get(text.target) ?? 0;
        stacks.set(text.target, stack + 1);
        const shape = frame.get(text.target)?.shape ?? "token";
        result.push({ tick: t.tick, key: `${key}:${j}`, type: "text", text: { position, text: text.text, tone: text.tone, stack, shape } });
      }
    }
  }
  perLayout.set(layout, result);
  return result;
}

/**
 * Wirkungen des laufenden Kampfs bei `tick` + `fraction` (wie `ReplayPlayer.position()`). Eine Wirkung aus
 * Tick `e` ist sichtbar, solange 0 ≤ (tick + fraction − e) < ihre Dauer; `age` ist dieser Anteil (0 bis unter 1).
 */
export function combatEffects(layout: BoardLayout, replay: CombatReplay, tick: number, fraction: number): CombatEffects {
  const elapsed = tick + fraction;
  const effects: CombatEffects = { offsets: new Map(), texts: [], lines: [], flashes: [] };
  for (const t of timedEffects(layout, replay)) {
    if (t.tick > elapsed) break;
    const age = (elapsed - t.tick) / duration(t);
    if (age >= 1) continue;
    switch (t.type) {
      case "lunge": {
        const swing = Math.sin(Math.PI * age);
        effects.offsets.set(t.unit, { x: t.offset.x * swing, z: t.offset.z * swing });
        break;
      }
      case "line":
        effects.lines.push({ ...t.line, key: t.key, age });
        break;
      case "flash":
        effects.flashes.push({ ...t.flash, key: t.key, age });
        break;
      case "text":
        effects.texts.push({ ...t.text, key: t.key, age });
        break;
    }
  }
  return effects;
}
