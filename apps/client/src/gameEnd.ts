/**
 * Spielende (C6b): Ergebnis-Anzeige mit Sieger, Siegart und Platzierung aller Spieler. Rein, ohne DOM, nur aus
 * der `PlayerView` (`result`, Platzierungen) und dem gefilterten Ereignisprotokoll (`player_eliminated`,
 * R-19.3). Die Platzierung selbst rechnet die Engine (R-13.2–R-13.5); hier wird sie nur sortiert und benannt.
 */
import type { GameData, GameEvent, PlayerIndex, PlayerView, VictoryReason } from "@game/engine";
import { playerName } from "./stateText";

export interface PlacementRow {
  player: PlayerIndex;
  name: string;
  isViewer: boolean;
  leader: string;
  placement: number;
  /** R-13.2, R-13.3, R-13.5: Platz mit mindestens einem anderen Spieler geteilt. */
  shared: boolean;
  life: number;
  power: number;
  /** Runde des Ausscheidens aus `player_eliminated` (`null` = bis zum Ende im Spiel). */
  eliminatedRound: number | null;
}

export interface GameEndSummary {
  reason: VictoryReason;
  round: number;
  winners: PlayerIndex[];
  /** „Du gewinnst!“, „Bot 3 gewinnt.“ oder „Du und Bot 3 teilen sich Platz 1.“ */
  headline: string;
  /** Siegart mit Regel-Kennung, z. B. „Machtsieg: 5 Machtpunkte erreicht (R-13.3).“ */
  reasonText: string;
  /** Alle Spieler nach Platz, bei gleichem Platz in Sitzreihenfolge. */
  rows: PlacementRow[];
}

/** Runde des Ausscheidens je Spieler aus dem Protokoll (R-13.1). */
export function eliminationRounds(log: readonly GameEvent[]): Map<PlayerIndex, number> {
  const rounds = new Map<PlayerIndex, number>();
  for (const event of log) {
    if (event.type === "player_eliminated" && !rounds.has(event.player)) rounds.set(event.player, event.round);
  }
  return rounds;
}

/** „Du“, „Du und Bot 3“, „Bot 2, Bot 3 und Bot 4“. */
function nameList(players: readonly PlayerIndex[], viewer: PlayerIndex): string {
  const names = [...players].sort((a, b) => (a === viewer ? -1 : b === viewer ? 1 : a - b)).map((p) => playerName(p, viewer));
  if (names.length <= 1) return names[0] ?? "niemand";
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

export function headlineText(winners: readonly PlayerIndex[], viewer: PlayerIndex): string {
  if (winners.length === 0) return "Kein Sieger.";
  if (winners.length > 1) return `${nameList(winners, viewer)} teilen sich Platz 1.`;
  return winners[0] === viewer ? "Du gewinnst!" : `${nameList(winners, viewer)} gewinnt.`;
}

export function reasonText(data: GameData, reason: VictoryReason, round: number): string {
  switch (reason) {
    case "power":
      return `Machtsieg in Runde ${round}: ${data.config.powerToWin} Machtpunkte am Ende der Kampfauswertung erreicht; die anderen sind nach Leben, dann Machtpunkten platziert (R-13.3).`;
    case "lastPlayer":
      return `Letzter Spieler im Spiel nach Runde ${round} (R-13.4).`;
    case "roundLimit":
      return `Rundenlimit: Partie nach Runde ${round} beendet, Platzierung nach Leben, dann Machtpunkten (R-13.5).`;
    case "allEliminated":
      return `Alle übrigen Spieler sind in Runde ${round} gleichzeitig ausgeschieden; Platzierung nach dem Leben vor dem Schaden dieser Runde, dann Machtpunkten (R-13.2).`;
  }
}

/** Ergebnis der Partie aus Sicht von `view.viewer`; `null`, solange die Partie läuft. */
export function gameEndSummary(data: GameData, view: PlayerView): GameEndSummary | null {
  const result = view.result;
  if (!result) return null;
  const out = eliminationRounds(view.log);
  const count = new Map<number, number>();
  for (const p of view.players) {
    const placement = p.placement ?? view.players.length;
    count.set(placement, (count.get(placement) ?? 0) + 1);
  }
  const rows = view.players
    .map((p): PlacementRow => {
      const placement = p.placement ?? view.players.length;
      return {
        player: p.index,
        name: playerName(p.index, view.viewer),
        isViewer: p.index === view.viewer,
        leader: data.leaders.get(p.leader.leaderId)?.name ?? p.leader.leaderId,
        placement,
        shared: (count.get(placement) ?? 0) > 1,
        life: p.life,
        power: p.power,
        eliminatedRound: out.get(p.index) ?? null,
      };
    })
    .sort((a, b) => a.placement - b.placement || a.player - b.player);
  return {
    reason: result.reason,
    round: result.round,
    winners: [...result.winners],
    headline: headlineText(result.winners, view.viewer),
    reasonText: reasonText(data, result.reason, result.round),
    rows,
  };
}

/** „Platz 2 (geteilt)“. */
export function placementText(row: PlacementRow): string {
  return `Platz ${row.placement}${row.shared ? " (geteilt)" : ""}`;
}

/** „ausgeschieden in Runde 7“ bzw. „bis zum Ende im Spiel“. */
export function outcomeText(row: PlacementRow): string {
  return row.eliminatedRound === null ? "bis zum Ende im Spiel" : `ausgeschieden in Runde ${row.eliminatedRound}`;
}

/**
 * Meldung für den Betrachter am Spielende. Ist er ausgeschieden, haben die Bots die Partie allein zu Ende
 * gespielt (Sitzung, C1); das wird gesagt, damit der Sprung zum Ende nicht überrascht.
 */
export function gameEndMessage(summary: GameEndSummary): string {
  const own = summary.rows.find((r) => r.isViewer);
  if (!own) return `Die Partie ist beendet. ${summary.headline}`;
  if (own.eliminatedRound !== null && own.eliminatedRound < summary.round) {
    return `Du bist in Runde ${own.eliminatedRound} ausgeschieden (${placementText(own)}). Die Bots haben die Partie bis Runde ${summary.round} zu Ende gespielt: ${summary.headline}`;
  }
  return `Die Partie ist beendet: ${summary.headline} Du belegst ${placementText(own)}.`;
}
