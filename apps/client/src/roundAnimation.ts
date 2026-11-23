/**
 * Wiedergabe einer ganzen Runde auf dem Brett (C4c2b): reine Logik ohne Babylon und ohne Spielzustand.
 *
 * R-19.2: Grundlage sind nur die Abschnitte einer `RoundReplay` (`effectReplay.ts`, also das Ereignisprotokoll) und
 * die Brett-Geometrie. Für jeden Augenblick der Wiedergabe entsteht ein `RoundFrame`:
 * - Vorkampf-Gruppen (Anführer-Fähigkeiten, Vorkampf-Zauber): alle Kämpfer in ihrer Startaufstellung. Was eine
 *   Gruppe bewirkt, ist erst ab ihrem Treffer-Zeitpunkt (`HIT_AT`) zu sehen: Leben, Maximum und Schild zählen bis dahin
 *   ohne ihren Schaden, Lebens-Buff (P15b) bzw. Schild, beschworene Figuren erscheinen erst dann, ein Schattenschritt
 *   gleitet vom alten zum neuen Feld. Einheiten, die nicht kämpfen (z. B. vor dem Kampf besiegt), werden als Brett-Figuren gemeldet
 *   (`boardUnits`) und blenden beim Besiegen aus.
 * - Kämpfe: wie C4c1/C4c2a (`roundFighters`, `combatEffects`).
 * - Nachkampf-Gruppen (Durchbruch, Nachkampf-Zauber): alle Überlebenden im Endbild ihres Kampfs; Durchbruch fliegt
 *   als Geschoss von der Front zur Säule des Verlierers, dort steht der Lebensverlust, und die Säule zeigt ab dem
 *   Treffer das neue Leben (`seatLife`).
 * Wirkungen einer Gruppe: Ring am Wirker (Anführer-Figur bzw. Säule des Zauberers), Strahl zu jedem Ziel, danach
 * aufsteigende Texte (Schaden mit Schild-Anteil, Schild, Buff, Schlüsselwort, verwundet, Beute, blockiert, verpufft).
 * Wirkungen auf Spieler (P14: entfernte Karten, Gold, Fluch, Markierung „nächste Runde“, Stehlen) steigen an der
 * Säule des betroffenen Sitzes auf, bei fremden Sitzen mit Strahl vom Wirker.
 * Wirkungen nach den Kämpfen (P14b): Auslöser einer Einheit (vorgemerkt oder `onFrontWin`) mit Ring an ihrer Figur
 * (sonst Brett-Position, sonst Säule), Vex' Beute am Anführer, dauerhafte Buffs an der Einheit, Anführer-XP an der
 * Säule, Einheiten-XP der Überlebenden je Arena ohne Wirker.
 */
import type { GameData, PlayerIndex, UnitId } from "@game/engine";
import { type BoardLayout, cellOf, locationPosition, seatPillarPosition, type WorldPoint } from "./boardLayout";
import { type CombatReplay } from "./combatReplay";
import type { EffectGroup, EffectStep, ReplaySegment } from "./effectReplay";
import { type AnimatedFighter, arenaName, fixedFighters, roundFighters } from "./replayAnimation";
import { buffText, combatEffects, type CombatEffects, type EffectTone, keywordText } from "./replayEffects";
import { playerName } from "./stateText";
import type { FigureShape } from "./unitFigures";

/** Anteil der Gruppendauer, bis zu dem der Ring am Wirker läuft. */
export const CAST_END = 0.5;
/** Strahl vom Wirker zum Ziel läuft in diesem Abschnitt der Gruppendauer. */
export const LINE_START = 0.05;
export const LINE_END = 0.4;
/** Ab hier gilt die Wirkung: Zahlen steigen auf, Werte ändern sich, Beschworene erscheinen, Besiegte blenden aus. */
export const HIT_AT = 0.35;
/** Ende der Ringe bei Schild und Beschwörung. */
export const FLASH_END = 0.85;
/** Bis hier gleitet ein Schattenschritt zum neuen Feld. */
export const MOVE_END = 0.6;
/** Höhe der Texte an einer Säule (über der Sitz-Beschriftung). */
export const SEAT_TEXT_HEIGHT = 4.8;

export interface RoundCursor {
  /** Index des laufenden Abschnitts; `null` = alles vorbei. */
  index: number | null;
  tick: number;
  fraction: number;
  /** Uhr des laufenden Kampfs (`RoundReplayPlayer.clock()`), sonst `null`. */
  clock: number | null;
}

export interface RoundFrame {
  fighters: AnimatedFighter[];
  effects: CombatEffects;
  /** Einheiten ohne Kampf, die als Brett-Figur gezeigt werden (Deckkraft 0 bis 1). */
  boardUnits: { unit: UnitId; opacity: number }[];
  /** Leben je Sitz nach schon gezeigtem Durchbruch-Schaden. */
  seatLife: Map<PlayerIndex, number>;
  /** Arena, auf die die Kamera schaut; `null` = Gesamtansicht. */
  focusArena: string | null;
}

/** Position einer Einheit ohne Kampf (z. B. Brett-Figur aus der Sicht vor der Runde). */
export type Locate = (unit: UnitId) => WorldPoint | null;

type UnitStep = Extract<EffectStep, { owner: PlayerIndex }>;

function emptyEffects(): CombatEffects {
  return { offsets: new Map(), texts: [], lines: [], flashes: [] };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Anteil `age` (0 bis unter 1) eines Fensters [start, end) der Gruppendauer; `null` außerhalb. */
function windowAge(fraction: number, start: number, end: number): number | null {
  if (fraction < start) return null;
  const age = (fraction - start) / (end - start);
  return age >= 1 ? null : age;
}

/** Weltposition eines Felds einer Arena aus Sicht des Besitzers (`left`/`right`/`center`, Arena-Koordinaten). */
export function arenaHexPosition(layout: BoardLayout, owner: PlayerIndex, hex: { arena: string; cell: { col: number; row: number } }): WorldPoint | null {
  const arena =
    hex.arena === "center"
      ? layout.arenas.find((a) => a.kind === "center")
      : layout.arenas.find((a) => a.pair && (hex.arena === "right" ? a.pair.first : a.pair.second) === owner);
  return arena ? (cellOf(arena, hex.cell)?.position ?? null) : null;
}

function combatsOf(segments: readonly ReplaySegment[]): CombatReplay[] {
  return segments.flatMap((s) => (s.kind === "combat" ? [s.replay] : []));
}

function groupsOf(segments: readonly ReplaySegment[], when: "pre" | "post"): EffectGroup[] {
  return segments.flatMap((s) => (s.kind === "effects" && s.when === when ? [s.group] : []));
}

/** Ist die Wirkung der Gruppe `j` bei laufender Gruppe `k` mit Fortschritt `fraction` schon sichtbar? */
function applied(j: number, k: number, fraction: number): boolean {
  return j < k || (j === k && fraction >= HIT_AT);
}

/**
 * Leben, Maximum und Schild einer Figur nach den bis jetzt sichtbaren (`post`) bzw. ohne die noch kommenden (`pre`)
 * Wirkungen. Ein Buff auf Leben (z. B. Kriegsruf, P15b) zählt wie in der Engine (`stats.hp`) für Leben und Maximum.
 */
function adjustValues(f: AnimatedFighter, groups: readonly EffectGroup[], k: number, fraction: number, when: "pre" | "post"): AnimatedFighter {
  let hp = f.hp;
  let maxHp = f.maxHp;
  let shield = f.shield;
  for (const [j, g] of groups.entries()) {
    const shown = applied(j, k, fraction);
    // Vor dem Kampf sind die Startwerte schon „nach allen Wirkungen“: Nicht gezeigte zurückrechnen.
    // Nach dem Kampf sind die Endwerte „vor allen Wirkungen“: Gezeigte abziehen.
    const sign = when === "pre" ? (shown ? 0 : 1) : shown ? -1 : 0;
    if (sign === 0) continue;
    for (const s of g.steps) {
      if (!("owner" in s) || s.unit !== f.unitId) continue;
      if (s.kind === "damage") {
        hp += sign * s.hpLoss;
        shield += sign * s.absorbed;
      } else if (s.kind === "shield") shield -= sign * s.amount;
      else if (s.kind === "buff" && s.stat === "hp") {
        hp -= sign * s.amount;
        maxHp -= sign * s.amount;
      }
    }
  }
  return { ...f, hp, maxHp, shield: Math.max(0, shield) };
}

/** Deckkraft einer Figur, die in Gruppe `j` besiegt wird. */
function defeatOpacity(j: number | undefined, k: number, fraction: number): number {
  if (j === undefined || j > k) return 1;
  if (j < k) return 0;
  return 1 - clamp01((fraction - HIT_AT) / 0.4);
}

function firstGroupWith(groups: readonly EffectGroup[], unit: UnitId, kind: UnitStep["kind"]): { j: number; step: UnitStep } | null {
  for (const [j, g] of groups.entries()) {
    for (const s of g.steps) if ("owner" in s && s.unit === unit && s.kind === kind) return { j, step: s };
  }
  return null;
}

/** Figuren und Brett-Einheiten während einer Vorkampf- (`pre`) bzw. Nachkampf-Gruppe (`post`). */
function effectFighters(
  layout: BoardLayout,
  segments: readonly ReplaySegment[],
  when: "pre" | "post",
  k: number,
  fraction: number,
): { fighters: AnimatedFighter[]; boardUnits: { unit: UnitId; opacity: number }[] } {
  const groups = groupsOf(segments, when);
  const fighters: AnimatedFighter[] = [];
  for (const replay of combatsOf(segments)) {
    for (const base of fixedFighters(layout, replay, when === "pre" ? "start" : "end")) {
      let f = adjustValues(base, groups, k, fraction, when);
      if (when === "pre") {
        const summon = firstGroupWith(groups, f.unitId, "summon");
        if (summon && summon.j > k) continue;
        if (summon && summon.j === k) {
          const opacity = fraction < HIT_AT ? 0 : clamp01((fraction - HIT_AT) / 0.2);
          if (opacity <= 0) continue;
          f = { ...f, opacity };
        }
        const step = firstGroupWith(groups, f.unitId, "shadowStep");
        if (step && step.j >= k && step.step.kind === "shadowStep") {
          const from = locationPosition(layout, step.step.owner, step.step.from);
          if (from) {
            const t = step.j > k ? 0 : ease(clamp01(fraction / MOVE_END));
            f = { ...f, position: { x: from.x + (f.position.x - from.x) * t, z: from.z + (f.position.z - from.z) * t } };
          }
        }
      } else {
        const opacity = defeatOpacity(firstGroupWith(groups, f.unitId, "defeat")?.j, k, fraction);
        if (opacity <= 0) continue;
        f = { ...f, opacity };
      }
      fighters.push(f);
    }
  }
  const shownUnits = new Set(fighters.map((f) => f.unitId));
  const boardUnits: { unit: UnitId; opacity: number }[] = [];
  const seen = new Set<UnitId>();
  for (const g of groups) {
    for (const s of g.steps) {
      if (!("owner" in s) || s.arena !== null || s.kind === "summon" || seen.has(s.unit) || shownUnits.has(s.unit)) continue;
      seen.add(s.unit);
      const opacity = defeatOpacity(firstGroupWith(groups, s.unit, "defeat")?.j, k, fraction);
      if (opacity > 0) boardUnits.push({ unit: s.unit, opacity });
    }
  }
  return { fighters, boardUnits };
}

/** Texte, die ein Schritt einer Wirkungsgruppe über seinem Ziel erzeugt. */
export function effectStepTexts(step: EffectStep): { text: string; tone: EffectTone }[] {
  switch (step.kind) {
    case "damage": {
      const out: { text: string; tone: EffectTone }[] = [];
      if (step.hpLoss > 0) out.push({ text: `−${step.hpLoss}`, tone: "damage" });
      if (step.absorbed > 0) out.push({ text: `−${step.absorbed} Schild`, tone: "shield" });
      return out;
    }
    case "shield":
      return step.amount > 0 ? [{ text: `+${step.amount} Schild`, tone: "shield" }] : [];
    case "buff":
      return step.amount !== 0 ? [{ text: buffText(step.stat, step.amount), tone: "buff" }] : [];
    case "keyword":
      return [{ text: keywordText(step.keyword), tone: "buff" }];
    case "wound":
      return [{ text: "verwundet", tone: "status" }];
    case "blocked":
      return [{ text: "blockiert", tone: "status" }];
    case "mark":
      return [{ text: "Beute", tone: "buff" }];
    case "breakthrough":
      return [{ text: `−${step.amount} Leben`, tone: "damage" }];
    case "permanentBuff":
      return step.amount !== 0 ? [{ text: `${buffText(step.stat, step.amount)} dauerhaft`, tone: "buff" }] : [];
    case "xp":
      return step.amount > 0 ? [{ text: `+${step.amount} XP`, tone: "buff" }] : [];
    case "leaderXp":
    case "trash":
    case "gold":
    case "curse":
    case "roundMark":
    case "steal":
      return seatStepTexts(step).map(({ text, tone }) => ({ text, tone }));
    default:
      return [];
  }
}

/** Schritte, die auf einen Spieler wirken und an der Säule seines Sitzes erscheinen (P14). */
export type SeatStep = Extract<EffectStep, { kind: "trash" | "gold" | "curse" | "roundMark" | "steal" | "leaderXp" }>;

export function isSeatStep(step: EffectStep): step is SeatStep {
  return (
    step.kind === "trash" || step.kind === "gold" || step.kind === "curse" || step.kind === "roundMark" || step.kind === "steal" || step.kind === "leaderXp"
  );
}

/**
 * Texte eines Spieler-Schritts je Sitz, an dessen Säule sie aufsteigen (R-19.2). Entfernte Karten erscheinen nur als
 * Anzahl, nie mit Namen (R-18.2a: Karten aus einem fremden Deck kennt die Sicht ohnehin nicht).
 */
export function seatStepTexts(step: SeatStep): { seat: PlayerIndex; text: string; tone: EffectTone }[] {
  switch (step.kind) {
    case "trash":
      return [{ seat: step.player, text: `${step.count} ${step.count === 1 ? "Karte" : "Karten"} entfernt`, tone: "status" }];
    case "gold":
      return [{ seat: step.player, text: `+${step.amount} Gold`, tone: "buff" }];
    case "curse":
      return [{ seat: step.to, text: "+1 Fluch", tone: "damage" }];
    case "roundMark":
      return [
        {
          seat: step.player,
          text: step.mark.kind === "gold" ? `nächste Runde +${step.mark.amount} Gold` : `nächste Runde +${step.mark.percent} % Mana`,
          tone: "buff",
        },
      ];
    case "steal":
      return [
        { seat: step.from, text: `−${step.amount} Gold`, tone: "damage" },
        { seat: step.player, text: `+${step.amount} Gold`, tone: "buff" },
      ];
    case "leaderXp":
      return [{ seat: step.player, text: `+${step.amount} Anführer-XP`, tone: "buff" }];
  }
}

/** Spieler, dem eine Gruppe gehört (Wirker bzw. Sieger des Durchbruchs); `null` bei den XP der Überlebenden. */
function groupPlayer(group: EffectGroup): PlayerIndex | null {
  const source = group.source;
  if (source.kind === "breakthrough") return source.winner;
  if (source.kind === "survivorXp") return null;
  return source.player;
}

/** Ringe, Strahlen und Texte einer Wirkungsgruppe beim Fortschritt `fraction`. */
function groupEffects(
  layout: BoardLayout,
  group: EffectGroup,
  key: string,
  fraction: number,
  fighters: readonly AnimatedFighter[],
  locate: Locate,
): CombatEffects {
  const effects = emptyEffects();
  const byUnit = new Map(fighters.map((f) => [f.unitId, f] as const));
  const unitAt = (unit: UnitId): { position: WorldPoint; shape: FigureShape } | null => {
    const f = byUnit.get(unit);
    if (f) return { position: f.position, shape: f.shape };
    const p = locate(unit);
    return p ? { position: p, shape: "token" } : null;
  };
  const player = groupPlayer(group);
  const source = group.source;
  // Wirker: Anführer-Figur auf dem Brett, sonst die Säule des Spielers; beim Durchbruch die Front.
  let caster: { position: WorldPoint; height?: number; shape: FigureShape } | null = null;
  if (source.kind === "breakthrough") {
    const arena = layout.arenas.find((a) => a.id === source.arena);
    if (arena) caster = { position: arena.center, shape: "token" };
  } else if (source.kind !== "survivorXp") {
    const leader =
      source.kind === "leader" || source.kind === "leaderTrigger"
        ? fighters.find((f) => f.sourceId === source.leaderId && f.player === source.player)
        : undefined;
    const unit = source.kind === "unitTrigger" && source.unit !== null ? unitAt(source.unit) : null;
    if (leader) caster = { position: leader.position, shape: leader.shape };
    else if (unit) caster = unit;
    else {
      const pillar = seatPillarPosition(layout, source.player);
      if (pillar) caster = { position: pillar, height: SEAT_TEXT_HEIGHT, shape: "token" };
    }
  }
  const castAge = windowAge(fraction, 0, CAST_END);
  if (caster && player !== null && castAge !== null && source.kind !== "breakthrough") {
    effects.flashes.push({ key: `${key}:cast`, kind: "ability", position: caster.position, player, age: castAge });
  }
  const lineAge = windowAge(fraction, LINE_START, LINE_END);
  const hitAge = windowAge(fraction, HIT_AT, 1);
  const flashAge = windowAge(fraction, HIT_AT, FLASH_END);
  const stacks = new Map<string, number>();
  const lineTargets = new Set<string>();
  const addText = (anchor: string, position: WorldPoint, shape: FigureShape, height: number | undefined, text: string, tone: EffectTone, n: string): void => {
    if (hitAge === null) return;
    const stack = stacks.get(anchor) ?? 0;
    stacks.set(anchor, stack + 1);
    effects.texts.push({ key: `${key}:${n}`, position, text, tone, stack, shape, age: hitAge, ...(height === undefined ? {} : { height }) });
  };
  const addLine = (anchor: string, to: WorldPoint, kind: "shot" | "ability"): void => {
    if (!caster || player === null || lineAge === null || lineTargets.has(anchor)) return;
    lineTargets.add(anchor);
    if (Math.hypot(to.x - caster.position.x, to.z - caster.position.z) < 1e-6) return;
    effects.lines.push({ key: `${key}:line:${anchor}`, kind, from: caster.position, to, player, age: lineAge });
  };
  for (const [i, step] of group.steps.entries()) {
    const n = String(i);
    if (step.kind === "breakthrough") {
      const pillar = seatPillarPosition(layout, step.loser);
      if (!pillar) continue;
      addLine(`seat${step.loser}`, pillar, "shot");
      for (const [j, t] of effectStepTexts(step).entries()) addText(`seat${step.loser}`, pillar, "token", SEAT_TEXT_HEIGHT, t.text, t.tone, `${n}:${j}`);
      continue;
    }
    if (isSeatStep(step)) {
      for (const [j, t] of seatStepTexts(step).entries()) {
        const pillar = seatPillarPosition(layout, t.seat);
        if (!pillar) continue;
        addLine(`seat${t.seat}`, pillar, "shot");
        addText(`seat${t.seat}`, pillar, "token", SEAT_TEXT_HEIGHT, t.text, t.tone, `${n}:${j}`);
      }
      continue;
    }
    if (step.kind === "blocked") {
      const position = player === null ? null : arenaHexPosition(layout, player, step.hex);
      if (!position) continue;
      for (const [j, t] of effectStepTexts(step).entries()) addText(`hex${i}`, position, "token", undefined, t.text, t.tone, `${n}:${j}`);
      continue;
    }
    if (step.kind === "mark") {
      for (const unit of step.units) {
        const at = unitAt(unit);
        if (!at) continue;
        addLine(`u${unit}`, at.position, "ability");
        addText(`u${unit}`, at.position, at.shape, undefined, "Beute", "buff", `${n}:${unit}`);
      }
      continue;
    }
    if (step.kind === "summon") {
      const at = unitAt(step.unit)?.position ?? locationPosition(layout, step.owner, step.location);
      if (!at) continue;
      addLine(`u${step.unit}`, at, "ability");
      if (flashAge !== null) effects.flashes.push({ key: `${key}:${n}:summon`, kind: "summon", position: at, player: step.owner, age: flashAge });
      continue;
    }
    if (step.kind === "shadowStep" || step.kind === "defeat") continue;
    const at = unitAt(step.unit);
    if (!at) continue;
    addLine(`u${step.unit}`, at.position, "ability");
    if (step.kind === "shield" && step.amount > 0 && flashAge !== null) {
      effects.flashes.push({ key: `${key}:${n}:shield`, kind: "shield", position: at.position, player: step.owner, age: flashAge });
    }
    for (const [j, t] of effectStepTexts(step).entries()) addText(`u${step.unit}`, at.position, at.shape, undefined, t.text, t.tone, `${n}:${j}`);
  }
  if (group.outcome === "fizzled" && caster) addText("caster", caster.position, caster.shape, caster.height, "verpufft", "status", "fizzled");
  return effects;
}

/** Leben je Sitz nach dem bis jetzt gezeigten Durchbruch-Schaden. */
function seatLives(segments: readonly ReplaySegment[], index: number, fraction: number): Map<PlayerIndex, number> {
  const lives = new Map<PlayerIndex, number>();
  for (const [i, s] of segments.entries()) {
    if (i > index || s.kind !== "effects") continue;
    if (i === index && fraction < HIT_AT) continue;
    for (const step of s.group.steps) if (step.kind === "breakthrough") lives.set(step.loser, step.life);
  }
  return lives;
}

/** Index einer Gruppe unter den Gruppen gleicher Art (`pre`/`post`). */
function groupIndex(segments: readonly ReplaySegment[], index: number, when: "pre" | "post"): number {
  return segments.slice(0, index).filter((s) => s.kind === "effects" && s.when === when).length;
}

/**
 * Alles, was das Brett an der Abspielposition `cursor` eines `RoundReplayPlayer` zeigt (R-19.2: nur aus den
 * Abschnitten). `locate` liefert die Position einer Einheit, die nicht kämpft (Brett-Figur vor der Runde).
 */
export function roundFrame(layout: BoardLayout, segments: readonly ReplaySegment[], cursor: RoundCursor, locate: Locate): RoundFrame {
  const empty: RoundFrame = { fighters: [], effects: emptyEffects(), boardUnits: [], seatLife: new Map(), focusArena: null };
  if (cursor.index === null) return empty;
  const segment = segments[cursor.index];
  if (!segment) return empty;
  const seatLife = seatLives(segments, cursor.index, cursor.fraction);
  if (segment.kind === "combat") {
    const combats = combatsOf(segments);
    const combatIndex = combats.indexOf(segment.replay);
    const fighters = roundFighters(layout, combats, { index: combatIndex, tick: cursor.tick, fraction: cursor.fraction });
    const clock = cursor.clock;
    const effects = clock === null ? emptyEffects() : combatEffects(layout, segment.replay, Math.floor(clock), clock - Math.floor(clock));
    return { fighters, effects, boardUnits: [], seatLife, focusArena: segment.replay.arena };
  }
  const k = groupIndex(segments, cursor.index, segment.when);
  const { fighters, boardUnits } = effectFighters(layout, segments, segment.when, k, cursor.fraction);
  const effects = groupEffects(layout, segment.group, `${segment.when}${k}`, cursor.fraction, fighters, locate);
  return { fighters, effects, boardUnits, seatLife, focusArena: null };
}

/** Name des Auslösers einer Gruppe, z. B. „Fähigkeit von Ilyra (Bot 2)“ oder „Zauber „Feuerball“ (Du)“. */
export function effectGroupTitle(data: GameData, group: EffectGroup, viewer: PlayerIndex): string {
  const source = group.source;
  if (source.kind === "breakthrough") {
    const amount = group.steps.find((s) => s.kind === "breakthrough");
    const lost = amount && amount.kind === "breakthrough" ? `: ${playerName(source.loser, viewer)} ${source.loser === viewer ? "verlierst" : "verliert"} ${amount.amount} Leben` : "";
    return `Durchbruch an der Front ${arenaName(source.arena, viewer)}${lost}`;
  }
  if (source.kind === "survivorXp") return `Erfahrung nach dem Kampf ${arenaName(source.arena, viewer)}`;
  const who = playerName(source.player, viewer);
  const leaderName = (id: string): string => data.leaders.get(id)?.name ?? id;
  let base: string;
  if (source.kind === "leader") base = `Fähigkeit von ${leaderName(source.leaderId)} (${who})`;
  else if (source.kind === "spell") base = `Zauber „${data.cards.get(source.cardId)?.name ?? source.cardId}“ (${who})`;
  else if (source.kind === "leaderTrigger") base = `Frontsieg mit gewählten Einheiten: ${leaderName(source.leaderId)} (${who})`;
  else {
    const name = data.cards.get(source.sourceId)?.name ?? data.leaders.get(source.sourceId)?.name ?? source.sourceId;
    base = `${source.deferred ? "Nach dem Kampf" : "Frontsieg"}: „${name}“ (${who})`;
  }
  return group.outcome === "fizzled" ? `${base} – verpufft` : base;
}

/**
 * Statuszeile unter dem Brett für eine ganze Runde, z. B. „Vor den Kämpfen 1 von 3: Fähigkeit von Ilyra (Bot 2)“,
 * „Kampf 2 von 3: Mitte · 4,5 s von 15,0 s“ oder „Nach den Kämpfen 1 von 1: Durchbruch an der Front …“.
 */
export function roundStatusText(data: GameData, segments: readonly ReplaySegment[], cursor: RoundCursor, viewer: PlayerIndex, ticksPerSecond: number): string {
  if (cursor.index === null) return segments.length === 0 ? "Nichts abzuspielen in dieser Runde." : "Wiedergabe beendet.";
  const segment = segments[cursor.index];
  if (!segment) return "";
  if (segment.kind === "combat") {
    const combats = combatsOf(segments);
    const n = combats.indexOf(segment.replay);
    const seconds = (t: number): string => (Math.max(0, t) / ticksPerSecond).toFixed(1).replace(".", ",");
    return `Kampf ${n + 1} von ${combats.length}: ${arenaName(segment.replay.arena, viewer)} · ${seconds(cursor.tick + cursor.fraction)} s von ${seconds(segment.replay.endTick)} s`;
  }
  const total = groupsOf(segments, segment.when).length;
  const k = groupIndex(segments, cursor.index, segment.when);
  const label = segment.when === "pre" ? "Vor den Kämpfen" : "Nach den Kämpfen";
  return `${label} ${k + 1} von ${total}: ${effectGroupTitle(data, segment.group, viewer)}`;
}
