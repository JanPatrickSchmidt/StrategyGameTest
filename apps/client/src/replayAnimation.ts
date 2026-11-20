/**
 * Kampfwiedergabe auf dem Brett (C4c1): reine Logik ohne Babylon und ohne Spielzustand.
 *
 * R-19.2: Grundlage sind nur die `CombatReplay`s aus `combatReplay.ts` (also das Ereignisprotokoll) und die
 * Brett-Geometrie aus `boardLayout.ts`. Daraus entsteht für jeden Augenblick der Wiedergabe die Liste der
 * Figuren aller Kämpfe der Runde mit Weltposition, Lebenspunkten, Schild und Deckkraft:
 * - der laufende Kampf weich zwischen dem Bild des aktuellen und des nächsten Ticks überblendet
 *   (Bewegung gleitet, Gestorbene blenden in `DEATH_FADE_TICKS` aus),
 * - schon gespielte Kämpfe im Endbild (nur Überlebende), noch kommende in ihrer Startaufstellung,
 * - nach dem Ende aller Kämpfe nichts mehr (dann zeigt das Brett wieder den Zustand aus der Sicht).
 * `scene.ts` zeichnet nur, was hier herauskommt.
 */
import type { PlayerIndex, UnitId } from "@game/engine";
import { type BoardLayout, cellOf, type WorldPoint } from "./boardLayout";
import { type CombatReplay, type ReplayFighter, type ReplayPosition, replayFrameAt } from "./combatReplay";
import { playerName } from "./stateText";
import type { FigureShape } from "./unitFigures";

/** So viele Ticks (bei 1×: 20 je Sekunde) dauert das Ausblenden einer gestorbenen Figur. */
export const DEATH_FADE_TICKS = 8;

/** Eine Figur der Wiedergabe im Augenblick der Abspielposition. */
export interface AnimatedFighter {
  /** Arena des Kampfs (`center` oder `front:<a>-<b>`), zusammen mit `unitId` eindeutig. */
  arena: string;
  unitId: UnitId;
  player: PlayerIndex;
  sourceId: string;
  shape: FigureShape;
  position: WorldPoint;
  hp: number;
  maxHp: number;
  shield: number;
  stunned: boolean;
  /** 1 = voll sichtbar, 0 = ausgeblendet (gestorben); Figuren mit 0 erscheinen nicht in der Liste. */
  opacity: number;
  /** Gehört zum gerade laufenden Kampf. */
  active: boolean;
}

/** Tick des Todes je Einheit (aus den `death`-Schritten). */
const deathTicks = new WeakMap<CombatReplay, Map<UnitId, number>>();
function deathTickMap(replay: CombatReplay): Map<UnitId, number> {
  let map = deathTicks.get(replay);
  if (!map) {
    map = new Map();
    for (const t of replay.ticks) for (const s of t.steps) if (s.kind === "death" && !map.has(s.unit)) map.set(s.unit, t.tick);
    deathTicks.set(replay, map);
  }
  return map;
}

/** Start- und Endbild je Kampf werden oft gebraucht und ändern sich nie. */
const fixedFrames = new WeakMap<CombatReplay, { start: ReplayFighter[]; end: ReplayFighter[] }>();
function startAndEnd(replay: CombatReplay): { start: ReplayFighter[]; end: ReplayFighter[] } {
  let frames = fixedFrames.get(replay);
  if (!frames) {
    frames = { start: replayFrameAt(replay, -1), end: replayFrameAt(replay, replay.endTick) };
    fixedFrames.set(replay, frames);
  }
  return frames;
}

/** Weltposition eines Arena-Felds; `null`, wenn die Arena oder das Feld nicht auf dem Brett liegt. */
export function arenaCellPosition(layout: BoardLayout, arenaId: string, cell: { col: number; row: number }): WorldPoint | null {
  const arena = layout.arenas.find((a) => a.id === arenaId);
  return arena ? (cellOf(arena, cell)?.position ?? null) : null;
}

function lerp(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Sanftes Ein- und Auslaufen der Bewegung innerhalb eines Ticks. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function staticFighters(layout: BoardLayout, replay: CombatReplay, frame: readonly ReplayFighter[]): AnimatedFighter[] {
  const result: AnimatedFighter[] = [];
  for (const f of frame) {
    if (!f.alive) continue;
    const position = arenaCellPosition(layout, replay.arena, f.cell);
    if (!position) continue;
    result.push(toAnimated(replay.arena, f, position, 1, false, false));
  }
  return result;
}

function toAnimated(arena: string, f: ReplayFighter, position: WorldPoint, opacity: number, active: boolean, stunned: boolean): AnimatedFighter {
  return {
    arena,
    unitId: f.unitId,
    player: f.player,
    sourceId: f.sourceId,
    shape: f.shape,
    position,
    hp: f.hp,
    maxHp: f.maxHp,
    shield: f.shield,
    stunned,
    opacity,
    active,
  };
}

/**
 * Figuren des laufenden Kampfs bei `tick` + `fraction`: Bild des Ticks, Positionen weich zum Bild des nächsten
 * Ticks überblendet. Werte (Leben, Schild) springen erst mit dem Tick, in dem ihr Ereignis steht.
 */
export function activeFighters(layout: BoardLayout, replay: CombatReplay, tick: number, fraction: number): AnimatedFighter[] {
  const now = replayFrameAt(replay, tick);
  const next = fraction > 0 && tick < replay.endTick ? new Map(replayFrameAt(replay, tick + 1).map((f) => [f.unitId, f] as const)) : null;
  const deaths = deathTickMap(replay);
  const elapsed = tick + fraction;
  const result: AnimatedFighter[] = [];
  for (const f of now) {
    const from = arenaCellPosition(layout, replay.arena, f.cell);
    if (!from) continue;
    const ahead = next?.get(f.unitId);
    const to = ahead ? arenaCellPosition(layout, replay.arena, ahead.cell) : null;
    const position = to ? lerp(from, to, ease(fraction)) : from;
    // Ausblenden beginnt mit dem Tick vor dem Tod (der tödliche Treffer ist unterwegs) und dauert DEATH_FADE_TICKS.
    const death = deaths.get(f.unitId);
    const opacity = death === undefined ? 1 : Math.max(0, Math.min(1, 1 - (elapsed - (death - 1)) / DEATH_FADE_TICKS));
    if (opacity <= 0) continue;
    result.push(toAnimated(replay.arena, f, position, opacity, true, f.stunnedUntil !== null));
  }
  return result;
}

/**
 * Alle Figuren der Runde an der Abspielposition eines `ReplayPlayer` (Index = Kampf in `replays`):
 * gespielte Kämpfe im Endbild, der laufende animiert, kommende in der Startaufstellung. Nach dem letzten
 * Kampf (`index` = `null`) ist die Liste leer.
 */
export function roundFighters(layout: BoardLayout, replays: readonly CombatReplay[], position: ReplayPosition): AnimatedFighter[] {
  if (position.index === null) return [];
  const result: AnimatedFighter[] = [];
  for (const [i, replay] of replays.entries()) {
    if (i < position.index) result.push(...staticFighters(layout, replay, startAndEnd(replay).end));
    else if (i > position.index) result.push(...staticFighters(layout, replay, startAndEnd(replay).start));
    else result.push(...activeFighters(layout, replay, position.tick, position.fraction));
  }
  return result;
}

/** Anzeigeschild einer Figur der Wiedergabe: Lebenspunkte, Schild in Klammern, Betäubung. */
export function fighterBadgeText(f: Pick<AnimatedFighter, "hp" | "shield" | "stunned">): string {
  const shield = f.shield > 0 ? ` (+${f.shield})` : "";
  return `${Math.max(0, f.hp)}♥${shield}${f.stunned ? " zZ" : ""}`;
}

/** Name einer Arena wie auf dem Brett: „Mitte“ bzw. „Du – Bot 2“. */
export function arenaName(arenaId: string, viewer: PlayerIndex): string {
  if (arenaId === "center") return "Mitte";
  const match = /^front:(\d+)-(\d+)$/.exec(arenaId);
  if (!match) return arenaId;
  return `${playerName(Number(match[1]) as PlayerIndex, viewer)} – ${playerName(Number(match[2]) as PlayerIndex, viewer)}`;
}

/** Statuszeile unter dem Brett, z. B. „Kampf 2 von 3: Mitte · 4,5 s von 15,0 s“. */
export function replayStatusText(replays: readonly CombatReplay[], position: ReplayPosition, viewer: PlayerIndex, ticksPerSecond: number): string {
  if (position.index === null) return replays.length === 0 ? "Keine Kämpfe in dieser Runde." : "Wiedergabe beendet.";
  const replay = replays[position.index];
  if (!replay) return "";
  const seconds = (t: number): string => (Math.max(0, t) / ticksPerSecond).toFixed(1).replace(".", ",");
  return `Kampf ${position.index + 1} von ${replays.length}: ${arenaName(replay.arena, viewer)} · ${seconds(position.tick + position.fraction)} s von ${seconds(replay.endTick)} s`;
}

/** Wohin die Kamera während eines Kampfs schaut: Mittelpunkt der Arena und ein passender Abstand. */
export function arenaFocus(layout: BoardLayout, arenaId: string): { target: WorldPoint; radius: number } | null {
  const arena = layout.arenas.find((a) => a.id === arenaId);
  if (!arena) return null;
  let reach = 0;
  for (const c of arena.cells) reach = Math.max(reach, Math.hypot(c.position.x - arena.center.x, c.position.z - arena.center.z));
  return { target: { ...arena.center }, radius: Math.max(18, reach * 3) };
}
