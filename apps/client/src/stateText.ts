/**
 * Zustand als Text (C1): formatiert die Sicht eines Spielers (R-18.3) für die Anzeige im Browser.
 * Nutzt ausschließlich die `PlayerView`, nie den vollständigen Zustand, damit nichts Verborgenes angezeigt wird.
 */
import type {
  CenterResult,
  FrontResult,
  GameData,
  Phase,
  PlayerIndex,
  PlayerView,
  PlayerViewEntry,
  Unit,
  UnitLocation,
  VictoryReason,
} from "@game/engine";

export const PHASE_NAMES: Record<Phase, string> = {
  setup: "Aufbau",
  roundStart: "Rundenbeginn",
  planning: "Planung",
  reveal: "Aufdecken",
  leaderAbilities: "Anführer-Fähigkeiten",
  preCombatSpells: "Vorkampf-Zauber",
  combat: "Kampf",
  combatResolution: "Kampfauswertung",
  postCombatSpells: "Nachkampf-Zauber",
  cleanup: "Aufräumen",
  victoryCheck: "Siegprüfung",
  gameOver: "Spielende",
};

const VICTORY_NAMES: Record<VictoryReason, string> = {
  power: "Machtpunkte",
  lastPlayer: "letzter Spieler im Spiel",
  allEliminated: "alle übrigen gleichzeitig ausgeschieden",
  roundLimit: "Rundenlimit",
};

const ZONE_NAMES: Record<UnitLocation["zone"], string> = {
  left: "Linke Front",
  right: "Rechte Front",
  center: "Mitte",
  reserve: "Reserve",
};

const ZONE_ORDER: readonly UnitLocation["zone"][] = ["left", "center", "right", "reserve"];

/** „Du“ für den Betrachter, sonst „Bot n“ (n = Sitz, ab 1 gezählt). */
export function playerName(player: PlayerIndex, viewer: PlayerIndex): string {
  return player === viewer ? "Du" : `Bot ${player + 1}`;
}

/** C2c: Beschriftung an der Sitz-Ecke: Name und Lebenspunkte, ausgeschiedene Spieler mit „raus“. */
export function seatLabelText(entry: Pick<PlayerView["players"][number], "index" | "life" | "eliminated">, viewer: PlayerIndex): string {
  const name = playerName(entry.index, viewer);
  return entry.eliminated ? `${name} · raus` : `${name} · ${entry.life}♥`;
}

function cardName(data: GameData, cardId: string): string {
  return data.cards.get(cardId)?.name ?? cardId;
}

function unitName(data: GameData, unit: Unit): string {
  const base = unit.kind === "leader" ? (data.leaders.get(unit.sourceId)?.name ?? unit.sourceId) : cardName(data, unit.sourceId);
  const stars = "★".repeat(unit.stars);
  const marks = [unit.kind === "leader" ? "Anführer" : null, unit.kind === "token" ? "Token" : null, unit.wounded ? "verwundet" : null]
    .filter((m): m is string => m !== null)
    .join(", ");
  return `${base} ${stars}${marks ? ` (${marks})` : ""}`;
}

function locationLabel(location: UnitLocation): string {
  if (location.zone === "center") return `Platz ${location.position + 1}`;
  if (location.zone === "reserve") return `Platz ${location.slot + 1}`;
  return `Spalte ${location.cell.col + 1}, Reihe ${location.cell.row + 1}`;
}

function locationSortKey(location: UnitLocation): number {
  if (location.zone === "center") return location.position;
  if (location.zone === "reserve") return location.slot;
  return location.cell.row * 100 + location.cell.col;
}

/** Fasst gleiche Kartennamen zusammen: „Kupfer ×5, Söldner“. */
function cardList(data: GameData, view: PlayerView, instanceIds: readonly number[]): string {
  if (instanceIds.length === 0) return "–";
  const counts = new Map<string, number>();
  for (const id of instanceIds) {
    const instance = view.cards[id];
    const name = instance ? cardName(data, instance.cardId) : "?";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "de"))
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(", ");
}

function playerLines(data: GameData, view: PlayerView, entry: PlayerViewEntry): string[] {
  const name = playerName(entry.index, view.viewer);
  const leader = data.leaders.get(entry.leader.leaderId);
  const branch = entry.leader.branchId ? leader?.active.branches.find((b) => b.id === entry.leader.branchId)?.name : null;
  const status = entry.eliminated ? ` – ausgeschieden${entry.placement !== null ? `, Platz ${entry.placement}` : ""}` : "";
  const lines = [
    `${name} (Sitz ${entry.index + 1})${status}`,
    `  Leben ${entry.life} · Macht ${entry.power} · Schatzkammer ${entry.treasury} Gold`,
    `  Anführer ${leader?.name ?? entry.leader.leaderId}, Stufe ${entry.leader.level}, ${entry.leader.xp} XP${branch ? `, Ast ${branch}` : ""}`,
    `  Deck ${entry.deckSize} · Hand ${entry.handSize} · Ablage ${entry.discard.length}`,
    `  Serien: Siege ${entry.winStreak}, Niederlagen ${entry.lossStreak}, Mitte ${entry.centerStreak}`,
  ];
  if (entry.own) {
    lines.push(`  Hand: ${cardList(data, view, entry.hand)}`);
    if (entry.played.length > 0) lines.push(`  Ausgespielte Münzen: ${cardList(data, view, entry.played)} (Rundenvorrat ${entry.roundGold} Gold)`);
  }
  return lines;
}

function boardLines(data: GameData, view: PlayerView, player: PlayerIndex): string[] {
  const units = Object.values(view.units).filter((u) => u.owner === player);
  const lines: string[] = [`${playerName(player, view.viewer)}:`];
  if (units.length === 0) return [...lines, "  keine Einheiten"];
  for (const zone of ZONE_ORDER) {
    const inZone = units
      .filter((u) => u.location.zone === zone)
      .sort((a, b) => locationSortKey(a.location) - locationSortKey(b.location) || a.id - b.id);
    if (inZone.length === 0) continue;
    lines.push(`  ${ZONE_NAMES[zone]}: ${inZone.map((u) => `${unitName(data, u)} [${locationLabel(u.location)}]`).join("; ")}`);
  }
  return lines;
}

function frontLine(view: PlayerView, result: FrontResult): string {
  const pair = `${playerName(result.first, view.viewer)} gegen ${playerName(result.second, view.viewer)}`;
  if (result.outcome === "noFight") return `  Front ${pair}: kein Kampf`;
  const outcome =
    result.winner === null ? "Unentschieden" : `Sieg ${playerName(result.winner, view.viewer)}${result.winnerBreakthrough > 0 ? `, Durchbruch ${result.winnerBreakthrough}` : ""}`;
  const how = result.outcome === "emptyFront" ? "leere Front" : `${result.ticks} Ticks`;
  return `  Front ${pair}: ${outcome} (${how})`;
}

function centerLine(view: PlayerView, result: CenterResult): string {
  if (result.outcome === "noFight") return "  Mitte: niemand";
  const holder = result.holder === null ? "kein Halter" : `gehalten von ${playerName(result.holder, view.viewer)}`;
  const how = result.outcome === "uncontested" ? "ohne Gegner" : `${result.ticks} Ticks`;
  return `  Mitte: ${holder} (${how})`;
}

/** Ganzer Zustand als mehrzeiliger Text aus Sicht von `view.viewer`. */
export function formatState(data: GameData, view: PlayerView): string {
  const lines: string[] = [`Runde ${view.round} von höchstens ${data.config.maxRounds} · Phase: ${PHASE_NAMES[view.phase]}`];
  if (view.result) {
    const winners = view.result.winners.map((p) => playerName(p, view.viewer)).join(", ");
    lines.push(`Partie beendet in Runde ${view.result.round}: Sieg ${winners} (${VICTORY_NAMES[view.result.reason]})`);
  }
  lines.push("", "Spieler");
  for (const entry of view.players) lines.push(...playerLines(data, view, entry));
  lines.push("", "Brett");
  for (const entry of view.players) lines.push(...boardLines(data, view, entry.index));
  if (view.frontResults.length > 0 || view.centerResult) {
    const round = view.frontResults[0]?.round ?? view.centerResult?.round;
    lines.push("", `Kämpfe (Runde ${round})`);
    for (const result of view.frontResults) lines.push(frontLine(view, result));
    if (view.centerResult) lines.push(centerLine(view, view.centerResult));
  }
  return lines.join("\n");
}
