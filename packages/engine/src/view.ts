/**
 * Sicht pro Spieler und gefiltertes Ereignisprotokoll (E13, R-18, R-19.3).
 *
 * Die Engine hält den vollständigen Zustand. Ein Spieler (bzw. sein Client oder Bot) bekommt nur eine Sicht, in
 * der fremde private Informationen fehlen (R-18.3): fremde Handkarten, fremde Deckreihenfolge und -inhalte, fremde
 * ausgespielte Ressourcen und fremder Rundenvorrat (beides verrät die Hand), fremde Planungen vor dem Aufdecken
 * (R-18.2) sowie Seed und Zufallsgenerator (mit ihnen ließe sich jede Mischung vorausberechnen).
 */
import type { Planning } from "./actions";
import {
  type CardInstance,
  type CardInstanceId,
  type CenterResult,
  type FrontResult,
  type GameEvent,
  type GameResult,
  type GameState,
  type Phase,
  type PlayerIndex,
  type PlayerState,
  type Unit,
  type UnitId,
  getPlayer,
} from "./state";

/** R-18.1: öffentliche Angaben eines Spielers (für alle sichtbar). */
export interface PublicPlayerView {
  index: PlayerIndex;
  life: number;
  power: number;
  treasury: number;
  deckSize: number;
  handSize: number;
  /** R-6.4: Anzahl der in dieser Runde ausgespielten Ressourcen (der Inhalt verrät die Hand). */
  playedCount: number;
  /** R-18.1: Ablagestapel mit Inhalt. */
  discard: CardInstanceId[];
  /** Gelegte Zauber (öffentlich ab dem Aufdecken, R-8.1; vorher leer). */
  spells: PlayerState["spells"];
  leaderAbility: PlayerState["leaderAbility"];
  chosenFrontWinTrigger?: PlayerState["chosenFrontWinTrigger"];
  leader: PlayerState["leader"];
  /** R-18.1: Stapelgrößen des eigenen Klassen-Pools. */
  classPool: Record<string, number>;
  winStreak: number;
  lossStreak: number;
  centerStreak: number;
  nextRound: PlayerState["nextRound"];
  roundMarks: PlayerState["roundMarks"];
  eliminated: boolean;
  placement: number | null;
}

/** Sicht auf den eigenen Spieler: öffentliche Angaben plus die eigenen privaten (R-18.2, R-18.2a). */
export interface OwnPlayerView extends PublicPlayerView {
  own: true;
  hand: CardInstanceId[];
  /**
   * R-18.2a: Inhalt des eigenen Decks **ohne** Reihenfolge (aufsteigend nach Karteninstanz, z. B. für Läutern,
   * R-14.8). Die Reihenfolge bleibt auch für den Besitzer verborgen.
   */
  deckContents: CardInstanceId[];
  played: CardInstanceId[];
  roundGold: number;
  /** Eigene eingereichte, noch nicht aufgedeckte Planung (`null` = noch keine). */
  pendingPlanning: Planning | null;
}

export interface OtherPlayerView extends PublicPlayerView {
  own: false;
}

export type PlayerViewEntry = OwnPlayerView | OtherPlayerView;

/** R-18.3: Sicht eines Spielers auf die Partie. JSON-serialisierbar, unabhängig vom Originalzustand. */
export interface PlayerView {
  viewer: PlayerIndex;
  round: number;
  phase: Phase;
  players: PlayerViewEntry[];
  /** Nur Karteninstanzen, deren Karte der Betrachter kennen darf (eigene, Ablagestapel, Brett, gelegte Zauber). */
  cards: Record<CardInstanceId, CardInstance>;
  units: Record<UnitId, Unit>;
  supply: Record<string, number>;
  frontResults: FrontResult[];
  centerResult: CenterResult | null;
  result: GameResult | null;
  /** R-19.3: für den Betrachter gefiltertes Ereignisprotokoll. */
  log: GameEvent[];
}

/** R-19.3: darf `viewer` das Ereignis sehen? Ereignisse ohne `visibleTo` sind öffentlich. */
export function isEventVisibleTo(event: GameEvent, viewer: PlayerIndex): boolean {
  return event.visibleTo === undefined || event.visibleTo.includes(viewer);
}

/** R-19.3: Ereignisprotokoll für einen Spieler – nur öffentliche und an ihn gerichtete Ereignisse, als Kopie. */
export function eventsFor(log: readonly GameEvent[], viewer: PlayerIndex): GameEvent[] {
  return copy(log.filter((e) => isEventVisibleTo(e, viewer)));
}

/** R-18.3: Sicht des Spielers `viewer` auf den Zustand, ohne fremde private Informationen. */
export function playerView(state: GameState, viewer: PlayerIndex): PlayerView {
  getPlayer(state, viewer);
  const visibleCards = new Set<CardInstanceId>();
  const players: PlayerViewEntry[] = state.players.map((p) => {
    for (const id of p.discard) visibleCards.add(id);
    for (const slot of ["pre", "post"] as const) for (const s of p.spells[slot]) visibleCards.add(s.cardInstanceId);
    const pub: PublicPlayerView = {
      index: p.index,
      life: p.life,
      power: p.power,
      treasury: p.treasury,
      deckSize: p.deck.length,
      handSize: p.hand.length,
      playedCount: p.played.length,
      discard: [...p.discard],
      spells: p.spells,
      leaderAbility: p.leaderAbility,
      leader: p.leader,
      classPool: p.classPool,
      winStreak: p.winStreak,
      lossStreak: p.lossStreak,
      centerStreak: p.centerStreak,
      nextRound: p.nextRound,
      roundMarks: p.roundMarks,
      eliminated: p.eliminated,
      placement: p.placement,
    };
    if (p.chosenFrontWinTrigger) pub.chosenFrontWinTrigger = p.chosenFrontWinTrigger;
    if (p.index !== viewer) return { ...pub, own: false };
    return {
      ...pub,
      own: true,
      hand: [...p.hand],
      deckContents: [...p.deck].sort((a, b) => a - b),
      played: [...p.played],
      roundGold: p.roundGold,
      pendingPlanning: state.pendingPlanning[p.index] ?? null,
    };
  });
  for (const unit of Object.values(state.units)) for (const id of unit.cardInstanceIds) visibleCards.add(id);
  const cards: Record<CardInstanceId, CardInstance> = {};
  for (const card of Object.values(state.cards)) {
    if (card.owner === viewer || visibleCards.has(card.id)) cards[card.id] = card;
  }
  return copy({
    viewer,
    round: state.round,
    phase: state.phase,
    players,
    cards,
    units: state.units,
    supply: state.supply,
    frontResults: state.frontResults,
    centerResult: state.centerResult,
    result: state.result,
    log: state.log.filter((e) => isEventVisibleTo(e, viewer)),
  });
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
