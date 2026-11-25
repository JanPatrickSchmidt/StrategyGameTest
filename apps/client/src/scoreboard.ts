/**
 * Übersicht (C6a): Tafel mit allen Spielern für die Anzeige über dem Brett. Rein, ohne DOM, nur aus der
 * `PlayerView` (R-18.1: Leben, Machtpunkte, Schatzkammer, Stapelgrößen, Anführer, Stufe, Ast und Serien sind
 * öffentlich) und dem gefilterten Ereignisprotokoll (R-19.3). Regeln (Serien-Gold, Mitte-Belohnung,
 * Front-Paarungen) kommen aus der Engine, nicht aus einer eigenen Nachrechnung.
 */
import {
  centerReward,
  frontPairingsFor,
  streakGold,
  type GameData,
  type GameEvent,
  type PlayerIndex,
  type PlayerView,
  type PlayerViewEntry,
} from "@game/engine";
import { playerName, PHASE_NAMES } from "./stateText";

/** Veränderungen eines Spielers in einer aufgelösten Runde, allein aus Ereignissen. */
export interface RoundChange {
  round: number;
  /** Verlorene Leben (Durchbruch-Schaden R-10.1 und Blutzoll R-14.6). */
  lifeLost: number;
  /** Gewonnene Machtpunkte (z. B. Mitte R-10.4). */
  powerGained: number;
}

export interface ScoreRow {
  player: PlayerIndex;
  name: string;
  isViewer: boolean;
  leader: string;
  level: number;
  branch: string | null;
  life: number;
  power: number;
  treasury: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  winStreak: number;
  lossStreak: number;
  centerStreak: number;
  eliminated: boolean;
  placement: number | null;
  /** R-2.3: Gegner an der linken bzw. rechten Front in dieser Runde (`null` = keiner). */
  leftOpponent: PlayerIndex | null;
  rightOpponent: PlayerIndex | null;
  /** Veränderungen in der zuletzt aufgelösten Runde (`null` = noch keine Runde aufgelöst). */
  lastRound: RoundChange | null;
}

export interface Scoreboard {
  /** „Runde 5 von 30 · Phase: Planung“ bzw. „Partie beendet in Runde 12“. */
  header: string;
  powerToWin: number;
  rows: ScoreRow[];
}

/** Zuletzt aufgelöste Runde: nach Spielende die letzte Runde, sonst die vorige (`null` vor Runde 2). */
export function lastResolvedRound(view: PlayerView): number | null {
  if (view.result) return view.result.round;
  return view.round > 1 ? view.round - 1 : null;
}

/** Lebensverlust und Machtgewinn von `player` in Runde `round` aus dem Protokoll. */
export function roundChange(log: readonly GameEvent[], player: PlayerIndex, round: number): RoundChange {
  let lifeLost = 0;
  let powerGained = 0;
  for (const event of log) {
    if (event.round !== round) continue;
    if (event.type === "breakthrough_damage" && event.loser === player) lifeLost += event.amount;
    else if (event.type === "life_paid" && event.player === player) lifeLost += event.amount;
    else if (event.type === "power_gained" && event.player === player) powerGained += event.amount;
  }
  return { round, lifeLost, powerGained };
}

/**
 * R-2.3: Gegner eines Spielers an seinen beiden Fronten nach den Front-Paarungen der Engine (`first.right`
 * kämpft gegen `second.left`).
 */
export function frontOpponents(view: PlayerView, player: PlayerIndex): { left: PlayerIndex | null; right: PlayerIndex | null } {
  const pairings = frontPairingsFor(view.players.map((p) => p.eliminated));
  return {
    right: pairings.find((p) => p.first === player)?.second ?? null,
    left: pairings.find((p) => p.second === player)?.first ?? null,
  };
}

function branchName(data: GameData, entry: PlayerViewEntry): string | null {
  if (!entry.leader.branchId) return null;
  const leader = data.leaders.get(entry.leader.leaderId);
  return leader?.active.branches.find((b) => b.id === entry.leader.branchId)?.name ?? entry.leader.branchId;
}

/** Übersicht aus Sicht von `view.viewer`, Spieler in Sitzreihenfolge. */
export function scoreboard(data: GameData, view: PlayerView): Scoreboard {
  const last = lastResolvedRound(view);
  const header = view.result
    ? `Partie beendet in Runde ${view.result.round} von höchstens ${data.config.maxRounds}`
    : `Runde ${view.round} von höchstens ${data.config.maxRounds} · Phase: ${PHASE_NAMES[view.phase]}`;
  const rows = view.players.map((entry): ScoreRow => {
    const opponents = entry.eliminated ? { left: null, right: null } : frontOpponents(view, entry.index);
    return {
      player: entry.index,
      name: playerName(entry.index, view.viewer),
      isViewer: entry.index === view.viewer,
      leader: data.leaders.get(entry.leader.leaderId)?.name ?? entry.leader.leaderId,
      level: entry.leader.level,
      branch: branchName(data, entry),
      life: entry.life,
      power: entry.power,
      treasury: entry.treasury,
      deckSize: entry.deckSize,
      handSize: entry.handSize,
      discardSize: entry.discard.length,
      winStreak: entry.winStreak,
      lossStreak: entry.lossStreak,
      centerStreak: entry.centerStreak,
      eliminated: entry.eliminated,
      placement: entry.placement,
      leftOpponent: view.result ? null : opponents.left,
      rightOpponent: view.result ? null : opponents.right,
      lastRound: last === null ? null : roundChange(view.log, entry.index, last),
    };
  });
  return { header, powerToWin: data.config.powerToWin, rows };
}

/** „27♥ (−3)“; Verlust der letzten Runde in Klammern, nur wenn es einen gab. */
export function lifeText(row: ScoreRow): string {
  const lost = row.lastRound?.lifeLost ?? 0;
  return `${row.life}♥${lost > 0 ? ` (−${lost})` : ""}`;
}

/** „2/5 (+1)“ gegen das Siegziel (R-13.3). */
export function powerText(row: ScoreRow, powerToWin: number): string {
  const gained = row.lastRound?.powerGained ?? 0;
  return `${row.power}/${powerToWin}${gained > 0 ? ` (+${gained})` : ""}`;
}

/**
 * R-10.6: „Siege 3 (+2 Gold)“, „Niederlagen 2 (+1 Gold)“ oder „keine“. Das Gold ist der Bonus, den die
 * laufende Serie nach der Engine je Runde bringt.
 */
export function streakText(data: GameData, row: ScoreRow): string {
  const kind = row.winStreak > 0 ? "Siege" : row.lossStreak > 0 ? "Niederlagen" : null;
  if (kind === null) return "keine";
  const streak = row.winStreak > 0 ? row.winStreak : row.lossStreak;
  const gold = streakGold(data.config, streak);
  return `${kind} ${streak}${gold > 0 ? ` (+${gold} Gold)` : ""}`;
}

/**
 * R-10.4: „2 · nächstes Halten: +2 Gold, +1 Karte, +1 Macht“. Die Belohnung beim nächsten Halten kommt aus
 * der Engine (`centerReward` für Serie + 1).
 */
export function centerText(data: GameData, row: ScoreRow): string {
  const next = centerReward(data.config, row.centerStreak + 1);
  const parts = next
    ? [next.gold > 0 ? `+${next.gold} Gold` : null, next.cards > 0 ? `+${next.cards} Karte` : null, next.power > 0 ? `+${next.power} Macht` : null]
    : [];
  const reward = parts.filter((p): p is string => p !== null).join(", ");
  return `${row.centerStreak}${reward && !row.eliminated ? ` · nächstes Halten: ${reward}` : ""}`;
}

/** „links Bot 4 · rechts Bot 2“; ausgeschiedene Spieler und Spielende: „–“. */
export function opponentsText(row: ScoreRow, viewer: PlayerIndex): string {
  const parts = [
    row.leftOpponent !== null ? `links ${playerName(row.leftOpponent, viewer)}` : null,
    row.rightOpponent !== null ? `rechts ${playerName(row.rightOpponent, viewer)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : "–";
}

/** „im Spiel“, „raus, Platz 3“ bzw. nach Spielende „Platz 1“. */
export function statusText(row: ScoreRow, gameOver: boolean): string {
  if (gameOver && row.placement !== null) return row.eliminated ? `raus, Platz ${row.placement}` : `Platz ${row.placement}`;
  if (row.eliminated) return row.placement !== null ? `raus, Platz ${row.placement}` : "raus";
  return "im Spiel";
}

/** „Brann, Stufe 2, Ast Schildwall“. */
export function leaderText(row: ScoreRow): string {
  return `${row.leader}, Stufe ${row.level}${row.branch ? `, Ast ${row.branch}` : ""}`;
}
