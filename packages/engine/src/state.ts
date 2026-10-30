/**
 * Zustandsmodell einer Partie (E4).
 * Der Zustand ist ein reines, JSON-serialisierbares Objekt. Alle Zustandsänderungen
 * laufen über Engine-Funktionen, die zusätzlich Ereignisse (R-19) ins Protokoll schreiben.
 */
import type { ActionTarget, Planning, PlanningSection, RejectionReason } from "./actions";
import type { OffsetCoord } from "./hex";
import type { RngState } from "./rng";

/** R-1.1: genau 4 Spieler, Index 0–3. */
export type PlayerIndex = 0 | 1 | 2 | 3;
export const PLAYER_INDICES: readonly PlayerIndex[] = [0, 1, 2, 3];

export type CardInstanceId = number;
export type UnitId = number;

/** R-5: Phasen einer Runde, plus Aufbau und Spielende. */
export const PHASES = [
  "setup",
  "roundStart",
  "planning",
  "reveal",
  "leaderAbilities",
  "preCombatSpells",
  "combat",
  "combatResolution",
  "postCombatSpells",
  "cleanup",
  "victoryCheck",
  "gameOver",
] as const;
export type Phase = (typeof PHASES)[number];

/** R-1.2: ein einzelnes Kartenexemplar mit eigener ID. */
export interface CardInstance {
  id: CardInstanceId;
  cardId: string;
  owner: PlayerIndex;
}

/** R-1.6 Zonen. Frontzonen haben Felder, Mitte und Reserve haben Positionen. */
export type FrontZoneName = "left" | "right";
export type UnitLocation =
  | { zone: FrontZoneName; cell: OffsetCoord }
  | { zone: "center"; position: number }
  | { zone: "reserve"; slot: number };

export type UnitKind = "leader" | "card" | "token";

/** R-1.3 / R-1.4 / R-1.5: Einheit auf dem Brett oder in der Reserve. */
export interface Unit {
  id: UnitId;
  owner: PlayerIndex;
  kind: UnitKind;
  /** Karten-ID (Karten-Einheit, Token) bzw. Anführer-ID (Anführer). */
  sourceId: string;
  /** Karteninstanzen dieser Einheit (leer bei Anführer und Tokens, bis zu 3 nach Verschmelzen). */
  cardInstanceIds: CardInstanceId[];
  stars: 1 | 2 | 3;
  xp: number;
  wounded: boolean;
  location: UnitLocation;
  /**
   * R-6.5: stand die Einheit während des Kampfes der laufenden Runde in der Reserve? Wird zu Beginn der
   * Kampfphase gesetzt, bei jedem späteren Ortswechsel gelöscht und zu Rundenbeginn ausgewertet und zurückgesetzt.
   */
  restedInReserve: boolean;
}

export interface LeaderState {
  leaderId: string;
  unitId: UnitId;
  xp: number;
  level: 1 | 2 | 3 | 4;
  branchId: string | null;
}

/** Boni, die in der nächsten Runde fällig werden (R-6.2, R-6.3, R-10.3/4/6). */
export interface NextRoundBonus {
  /** R-10.4: Bonuskarten beim Nachziehen am Rundenende (R-12.6). */
  cards: number;
}

/** R-7.3: gelegter Zauber; die Karte hat die Hand verlassen und liegt bis zur Auflösung im Slot (R-8.6). */
export interface SetSpell {
  cardInstanceId: CardInstanceId;
  cardId: string;
  /** Geprüftes Ziel; mehrere Felder stehen immer als `hexes`. */
  target: ActionTarget;
}

export type SpellSlot = "pre" | "post";

export interface PlayerState {
  index: PlayerIndex;
  life: number;
  power: number;
  treasury: number;
  /** R-6.2: Gold-Vorrat der laufenden Runde. */
  roundGold: number;
  /** Deck, oberste Karte zuerst. */
  deck: CardInstanceId[];
  hand: CardInstanceId[];
  /** R-6.4: in dieser Runde ausgespielte Ressourcen; gehen beim Aufräumen auf den Ablagestapel (R-12.1). */
  played: CardInstanceId[];
  discard: CardInstanceId[];
  /** R-7.3: gelegte Zauber der laufenden Runde je Slot. */
  spells: Record<SpellSlot, SetSpell[]>;
  /**
   * R-7.4: gewählte Anführer-Fähigkeit der laufenden Runde (geprüftes Ziel, `{ kind: "none" }` = bewusst
   * keine). `null` = noch nicht gewählt. Wird beim Rundenende zurückgesetzt.
   */
  leaderAbility: ActionTarget | null;
  leader: LeaderState;
  /** Eigene Stapel des Klassen-Pools (R-4.5): Karten-ID → verbleibende Kopien. */
  classPool: Record<string, number>;
  winStreak: number;
  lossStreak: number;
  centerStreak: number;
  nextRound: NextRoundBonus;
  eliminated: boolean;
  /** Platzierung, sobald feststehend (1 = beste). */
  placement: number | null;
}

/** R-19.1: jede Zustandsänderung erzeugt ein Ereignis. */
interface EventBase {
  round: number;
  phase: Phase;
  /** Fehlt = öffentlich. Sonst nur für diese Spieler sichtbar (R-19.3). */
  visibleTo?: PlayerIndex[];
}

export type GameEventPayload =
  | { type: "game_created"; seed: number; leaders: string[] }
  | { type: "phase_started"; phase: Phase }
  | { type: "round_started" }
  /** Öffentlich nur, dass eingereicht wurde; der Inhalt bleibt bis zum Aufdecken privat (R-18.2). */
  | { type: "planning_submitted"; player: PlayerIndex; actionCount: number }
  /** R-7.9: keine Planung eingereicht → leere Abschnitte. */
  | { type: "submission_timeout"; player: PlayerIndex }
  | { type: "submission_rejected"; player: PlayerIndex; reason: RejectionReason }
  /** R-8.1: Planungen werden öffentlich. */
  | { type: "planning_revealed"; player: PlayerIndex; planning: Planning }
  /** R-7: ungültige Aktion wird übersprungen. `index` = Position im Abschnitt `section`. */
  | {
      type: "action_rejected";
      player: PlayerIndex;
      section: PlanningSection;
      index: number;
      action: string;
      reason: RejectionReason;
    }
  /** R-12.1: Handkarten auf den Ablagestapel (Ablagestapel ist öffentlich, R-18.1). */
  | { type: "hand_discarded"; player: PlayerIndex; cardInstanceIds: CardInstanceId[] }
  /** R-12.2 */
  | { type: "token_removed"; player: PlayerIndex; unitId: UnitId }
  | { type: "supply_created"; piles: Record<string, number> }
  | { type: "class_pool_created"; player: PlayerIndex; piles: Record<string, number> }
  | { type: "cards_created"; player: PlayerIndex; cardInstanceIds: CardInstanceId[] }
  | { type: "unit_placed"; player: PlayerIndex; unitId: UnitId; sourceId: string; kind: UnitKind; location: UnitLocation }
  | { type: "deck_shuffled"; player: PlayerIndex; size: number }
  /** R-12.6: Deck und Ablagestapel zusammen gemischt; `size` = Größe des neuen Decks. */
  | { type: "discard_reshuffled"; player: PlayerIndex; size: number }
  /** R-12.3: Anführer-XP am Rundenende. */
  | { type: "leader_xp_gained"; player: PlayerIndex; amount: number; xp: number }
  /** R-6.6: Anführer steigt eine Stufe auf (bei mehreren Stufen ein Ereignis je Stufe). */
  | { type: "leader_leveled_up"; player: PlayerIndex; level: 2 | 3 | 4; xp: number }
  /** R-14.8: Karten dauerhaft aus dem Spiel entfernt (öffentlich, die Wahl wird beim Aufdecken ohnehin bekannt). */
  | { type: "cards_trashed"; player: PlayerIndex; cards: { cardInstanceId: CardInstanceId; cardId: string; from: "deck" | "discard" }[] }
  /** Privat: welche Karten gezogen wurden. */
  | { type: "cards_drawn"; player: PlayerIndex; cardInstanceIds: CardInstanceId[] }
  /** Öffentlich: wie viele Karten gezogen wurden (R-18.1 Handgröße). */
  | { type: "cards_drawn_count"; player: PlayerIndex; count: number }
  | { type: "draw_stopped"; player: PlayerIndex; missing: number }
  /** R-6.1: Zinsen in die Schatzkammer. */
  | { type: "interest_paid"; player: PlayerIndex; amount: number; treasury: number }
  /** R-6.4 privat: welche Ressourcen ausgespielt wurden und wie viel Gold sie bringen. */
  | { type: "resources_played"; player: PlayerIndex; cardInstanceIds: CardInstanceId[]; gold: number }
  /** R-6.4 öffentlich: wie viele Karten die Hand dadurch verlassen (R-18.1 Handgröße). */
  | { type: "resources_played_count"; player: PlayerIndex; count: number }
  /** R-7.6: Entnahme aus der Schatzkammer in den Rundenvorrat. */
  | { type: "gold_withdrawn"; player: PlayerIndex; amount: number; treasury: number }
  /** R-10.3: Gold-Gewinn nach der Planung, vollständig in die Schatzkammer. */
  | { type: "gold_gained"; player: PlayerIndex; amount: number; treasury: number }
  /** Gold-Gewinn während der Planung in den Rundenvorrat (R-10.3, letzter Satz). */
  | { type: "round_gold_gained"; player: PlayerIndex; amount: number }
  /** R-11.1: Kauf im Abschnitt `buy`; das Gold wird sofort abgezogen, die Karte folgt beim Verteilen. */
  | {
      type: "purchase_paid";
      player: PlayerIndex;
      cardId: string;
      source: "supply" | "classPool";
      paidFromRoundGold: number;
      paidFromTreasury: number;
    }
  /** R-11.3: Verteilen beim Aufdecken; die neue Karteninstanz liegt auf dem Ablagestapel. */
  | { type: "card_bought"; player: PlayerIndex; cardId: string; cardInstanceId: CardInstanceId; source: "supply" | "classPool" }
  /** R-11.3: Stapelstand nach den gleichzeitigen Käufen; `created` = zusätzlich erzeugte Kopien. */
  | { type: "pile_changed"; pile: string; owner: PlayerIndex | null; remaining: number; created: number }
  /** R-12.5: übriges Gold des Rundenvorrats in die Schatzkammer. */
  | { type: "gold_deposited"; player: PlayerIndex; amount: number; treasury: number }
  /** R-7.1: Karte verlässt die Hand und wird zur Einheit. */
  | {
      type: "unit_played";
      player: PlayerIndex;
      unitId: UnitId;
      cardInstanceId: CardInstanceId;
      sourceId: string;
      location: UnitLocation;
      paidFromRoundGold: number;
      paidFromTreasury: number;
      /** R-14.6: mit alternativen Kosten bezahlt (Leben und Opfer stehen in eigenen Ereignissen davor). */
      altCost: boolean;
    }
  /** R-14.6 `bloodToll`: Leben als Kosten bezahlt. */
  | { type: "life_paid"; player: PlayerIndex; amount: number; life: number; cardInstanceId: CardInstanceId }
  /** R-14.6 `sacrifice`: eigene Karten-Einheit geopfert, ihre Karteninstanzen gehen auf den Ablagestapel. */
  | { type: "unit_sacrificed"; player: PlayerIndex; unitId: UnitId; cardInstanceIds: CardInstanceId[]; from: UnitLocation }
  /** R-6.5: verwundete Einheit ist nach einer ganzen Runde in der Reserve genesen. */
  | { type: "unit_recovered"; player: PlayerIndex; unitId: UnitId }
  /** R-7.2 */
  | { type: "unit_moved"; player: PlayerIndex; unitId: UnitId; from: UnitLocation; to: UnitLocation }
  /** R-7.3: Zauber gelegt, Kosten bezahlt, Ziel festgelegt (öffentlich ab dem Aufdecken, R-8.1). */
  | {
      type: "spell_set";
      player: PlayerIndex;
      cardInstanceId: CardInstanceId;
      cardId: string;
      slot: SpellSlot;
      target: ActionTarget;
      paidFromRoundGold: number;
      paidFromTreasury: number;
    }
  /** R-8.6: Zauber verlässt den Slot und geht auf den Ablagestapel. */
  | { type: "spell_discarded"; player: PlayerIndex; cardInstanceId: CardInstanceId; slot: SpellSlot }
  /** R-7.4: Anführer-Fähigkeit gewählt (`{ kind: "none" }` = keine). */
  | { type: "leader_ability_set"; player: PlayerIndex; target: ActionTarget }
  /** R-7.7: Ast gewählt; `auto` = ohne Wahl der erste Ast. */
  | { type: "branch_chosen"; player: PlayerIndex; branchId: string; auto: boolean }
  /**
   * R-15.1: drei gleiche Einheiten verschmolzen. `unitId` ist die verbleibende Einheit (die mit den meisten XP,
   * F25), `mergedUnitIds` alle drei beteiligten Einheiten einschließlich `unitId`.
   */
  | {
      type: "units_merged";
      player: PlayerIndex;
      unitId: UnitId;
      mergedUnitIds: UnitId[];
      sourceId: string;
      stars: 2 | 3;
      xp: number;
      wounded: boolean;
      location: UnitLocation;
    }
  /** R-7.5 */
  | { type: "unit_healed"; player: PlayerIndex; unitId: UnitId; paidFromRoundGold: number; paidFromTreasury: number };

export type GameEvent = EventBase & GameEventPayload;


export interface GameState {
  seed: number;
  rng: RngState;
  /** R-1.7: Runde beginnt bei 1. */
  round: number;
  phase: Phase;
  players: PlayerState[];
  cards: Record<CardInstanceId, CardInstance>;
  units: Record<UnitId, Unit>;
  /** Gemeinsame Stapel: Basisstapel und Königreich (R-4.5). */
  supply: Record<string, number>;
  /** Eingereichte, noch nicht aufgedeckte Planungen der laufenden Runde (null = fehlt). */
  pendingPlanning: (Planning | null)[];
  nextCardInstanceId: CardInstanceId;
  nextUnitId: UnitId;
  /** Ereignisprotokoll (R-19), in Entstehungsreihenfolge. */
  log: GameEvent[];
}

export function emit(state: GameState, payload: GameEventPayload, visibleTo?: PlayerIndex[]): void {
  const event: GameEvent = { round: state.round, phase: state.phase, ...payload };
  if (visibleTo) event.visibleTo = visibleTo;
  state.log.push(event);
}

export function getPlayer(state: GameState, player: PlayerIndex): PlayerState {
  const p = state.players[player];
  if (!p) throw new RangeError(`Spieler ${player} existiert nicht`);
  return p;
}

export function getCard(state: GameState, id: CardInstanceId): CardInstance {
  const c = state.cards[id];
  if (!c) throw new RangeError(`Karteninstanz ${id} existiert nicht`);
  return c;
}

export function getUnit(state: GameState, id: UnitId): Unit {
  const u = state.units[id];
  if (!u) throw new RangeError(`Einheit ${id} existiert nicht`);
  return u;
}

/** Tiefe Kopie eines Zustands (der Zustand ist JSON-serialisierbar). */
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
