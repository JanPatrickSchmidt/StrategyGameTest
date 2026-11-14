/**
 * Planungsentwurf im Client (C3a, R-5): reine Logik ohne DOM.
 *
 * Die Oberfläche gliedert die Planung in die Schritte Ausspielen, Kaufen und Aufstellen. Bis zum Bestätigen darf
 * der Spieler frei zwischen ihnen wechseln und Aktionen hinzufügen oder entfernen; die Engine verarbeitet nur
 * die endgültige Eingabe. Nach jeder Änderung wird die ganze Planung über den `PlanningDraft` der Engine neu
 * durchgespielt (Abschnitt für Abschnitt wie beim Aufdecken, R-8.1). So bleiben die Regeln allein in der Engine,
 * und eine Aktion, die durch eine spätere Änderung ungültig wird (z. B. Gold reicht nicht mehr), wird mit Grund
 * markiert statt still zu verschwinden.
 */
import {
  allLocations,
  type CardData,
  emptyPlanning,
  type GameData,
  type GameState,
  type OwnPlayerView,
  PLANNING_SECTIONS,
  type Planning,
  type PlanningAction,
  PlanningDraft,
  type PlanningSection,
  type PlayerIndex,
  type PlayerView,
  playerView,
  type RejectionReason,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "@game/engine";
import { locationName } from "./fieldNames";

export const STEP_NAMES: Record<PlanningSection, string> = {
  play: "Ausspielen",
  buy: "Kaufen",
  position: "Aufstellen",
};

/** Ablehnungsgründe in der Sprache der Oberfläche (nur die häufigen; sonst der Code). */
const REASON_TEXTS: Partial<Record<RejectionReason, string>> = {
  notEnoughGold: "Gold reicht nicht",
  notEnoughTreasury: "Schatzkammer reicht nicht",
  cardNotInHand: "Karte nicht mehr auf der Hand",
  notAUnitCard: "keine Einheitenkarte",
  cellOccupied: "Feld besetzt",
  capacityExceeded: "Kapazität erreicht (R-3.6)",
  sameLocation: "Einheit steht schon dort",
  unknownUnit: "Einheit gibt es nicht",
  wrongSection: "in diesem Schritt nicht erlaubt",
  invalidLocation: "Ort gibt es nicht",
};

export function reasonText(reason: RejectionReason): string {
  return REASON_TEXTS[reason] ?? reason;
}

/** Eine geplante Aktion mit dem Ergebnis des letzten Durchspielens (`null` = angenommen). */
export interface PlannedEntry {
  section: PlanningSection;
  index: number;
  action: PlanningAction;
  rejection: RejectionReason | null;
}

export class PlanBuilder {
  private currentStep: PlanningSection = "play";
  private readonly actions: Planning = emptyPlanning();
  private draft: PlanningDraft;
  private results: Record<PlanningSection, (RejectionReason | null)[]> = { play: [], buy: [], position: [] };

  constructor(
    private readonly source: GameState,
    private readonly data: GameData,
    readonly player: PlayerIndex,
  ) {
    this.draft = new PlanningDraft(source, data, player);
  }

  get step(): PlanningSection {
    return this.currentStep;
  }

  /** R-5: Wechsel zwischen den Schritten, jederzeit bis zum Bestätigen. */
  setStep(step: PlanningSection): void {
    this.currentStep = step;
  }

  /**
   * Fügt eine Aktion im aktuellen Schritt hinzu. Lehnt die Engine sie ab, bleibt die Planung unverändert und
   * der Grund wird zurückgegeben.
   */
  add(action: PlanningAction): RejectionReason | null {
    const list = this.actions[this.currentStep];
    list.push(action);
    this.replay();
    const reason = this.results[this.currentStep][list.length - 1] ?? null;
    if (reason) {
      list.pop();
      this.replay();
    }
    return reason;
  }

  /** Entfernt eine geplante Aktion; die übrigen werden neu durchgespielt. */
  remove(section: PlanningSection, index: number): void {
    const list = this.actions[section];
    if (index < 0 || index >= list.length) throw new RangeError(`Keine Aktion ${index} im Schritt ${section}`);
    list.splice(index, 1);
    this.replay();
  }

  /** Alle geplanten Aktionen in Ausführungsreihenfolge (R-5), mit Ergebnis. */
  entries(): PlannedEntry[] {
    return PLANNING_SECTIONS.flatMap((section) =>
      this.actions[section].map((action, index) => ({ section, index, action, rejection: this.results[section][index] ?? null })),
    );
  }

  /** Die einzureichende Planung: nur die Aktionen, die die Engine im Entwurf angenommen hat. */
  planning(): Planning {
    return JSON.parse(JSON.stringify(this.draft.planning)) as Planning;
  }

  /** Sicht des Spielers nach der Planung (für Hand, Gold und das 3D-Brett), ohne verborgene Angaben (R-18.3). */
  preview(): PlayerView {
    return playerView(this.draft.state, this.player);
  }

  /**
   * Einheiten, die bewegt werden dürfen: nur solche, die es zu Beginn der Planung gab. IDs neu ausgespielter
   * Einheiten vergibt erst das Aufdecken (siehe `PlanningDraft.initialUnitIds`); ihren Ort wählt der Spieler
   * beim Ausspielen.
   */
  movableUnits(): Unit[] {
    return Object.values(this.draft.state.units)
      .filter((u) => u.owner === this.player && this.draft.initialUnitIds.has(u.id))
      .sort((a, b) => a.id - b.id);
  }

  /**
   * C3b: Einheiten, die direkt auf dem Brett versetzt werden dürfen: die bewegbaren (`movableUnits`) und neu
   * ausgespielte, deren Ausspiel-Aktion in dieser Planung steht (ihr Zielort wird dann geändert).
   */
  relocatableUnits(): Unit[] {
    return Object.values(this.draft.state.units)
      .filter((u) => u.owner === this.player && (this.draft.initialUnitIds.has(u.id) || this.playIndexOf(u) >= 0))
      .sort((a, b) => a.id - b.id);
  }

  /**
   * C3b: Einheit auf dem Brett an einen neuen Ort setzen (Feld anklicken bzw. Einheit ziehen).
   * - Einheit vom Beginn der Planung (R-7.2): frühere Bewegungen dieser Einheit werden ersetzt, damit die Liste
   *   übersichtlich bleibt; zurück auf ihren Ausgangsort heißt einfach „nicht bewegen“. Wechselt in den Schritt
   *   Aufstellen.
   * - Neu ausgespielte Einheit (R-7.1): der Zielort ihrer Ausspiel-Aktion wird geändert; wechselt zu Ausspielen.
   * Lehnt die Engine ab, bleibt alles wie vorher und der Grund wird zurückgegeben.
   */
  relocate(unitId: UnitId, to: UnitLocation): RejectionReason | null {
    const unit = this.draft.state.units[unitId];
    if (!unit || unit.owner !== this.player) return "unknownUnit";
    if (this.draft.initialUnitIds.has(unitId)) {
      const list = this.actions.position;
      const saved = list.slice();
      const kept = saved.filter((a) => !(a.type === "moveUnit" && a.unitId === unitId));
      list.splice(0, list.length, ...kept);
      const start = this.source.units[unitId]?.location;
      let reason: RejectionReason | null = null;
      if (!start || locationKey(start) !== locationKey(to)) {
        list.push({ type: "moveUnit", unitId, to: { ...to } as UnitLocation });
        this.replay();
        reason = this.results.position[list.length - 1] ?? null;
      } else {
        this.replay();
      }
      if (reason) {
        list.splice(0, list.length, ...saved);
        this.replay();
        return reason;
      }
      this.currentStep = "position";
      return null;
    }
    const index = this.playIndexOf(unit);
    if (index < 0) return "unknownUnit";
    const list = this.actions.play;
    const old = list[index];
    if (!old || old.type !== "playUnit") return "unknownUnit";
    list[index] = { ...old, to: { ...to } as UnitLocation };
    this.replay();
    const reason = this.results.play[index] ?? null;
    if (reason) {
      list[index] = old;
      this.replay();
      return reason;
    }
    this.currentStep = "play";
    return null;
  }

  /** Index der Ausspiel-Aktion, aus der eine neue Einheit entstanden ist (`-1`, wenn keine). */
  private playIndexOf(unit: Unit): number {
    if (this.draft.initialUnitIds.has(unit.id)) return -1;
    return this.actions.play.findIndex((a) => a.type === "playUnit" && unit.cardInstanceIds.includes(a.cardInstanceId));
  }

  /** Orte ohne eigene Einheit im Entwurf (Ziele für Ausspielen und Bewegen; den Rest prüft die Engine). */
  freeLocations(): UnitLocation[] {
    const taken = new Set(
      Object.values(this.draft.state.units)
        .filter((u) => u.owner === this.player)
        .map((u) => locationKey(u.location)),
    );
    return allLocations(this.data.config).filter((loc) => !taken.has(locationKey(loc)));
  }

  private replay(): void {
    this.draft = new PlanningDraft(this.source, this.data, this.player);
    const results: Record<PlanningSection, (RejectionReason | null)[]> = { play: [], buy: [], position: [] };
    for (const section of PLANNING_SECTIONS) {
      this.draft.enter(section);
      for (const action of this.actions[section]) results[section].push(this.draft.attempt(action));
    }
    this.results = results;
  }
}

export function locationKey(loc: UnitLocation): string {
  switch (loc.zone) {
    case "left":
    case "right":
      return `${loc.zone}:${loc.cell.col},${loc.cell.row}`;
    case "center":
      return `center:${loc.position}`;
    case "reserve":
      return `reserve:${loc.slot}`;
  }
}

/** Eigener Spieler aus der Sicht (R-18.2). */
export function ownEntry(view: PlayerView): OwnPlayerView {
  const entry = view.players[view.viewer];
  if (!entry || !entry.own) throw new Error("Sicht ohne eigenen Spieler");
  return entry;
}

export interface CardEntry {
  instanceId: number;
  card: CardData;
}

function cardsOf(data: GameData, view: PlayerView, ids: readonly number[]): CardEntry[] {
  return ids.map((id) => {
    const instance = view.cards[id];
    const card = instance ? data.cards.get(instance.cardId) : undefined;
    if (!card) throw new Error(`Karte ${id} nicht sichtbar`);
    return { instanceId: id, card };
  });
}

/** Handkarten (R-7.10). */
export function handCards(data: GameData, view: PlayerView): CardEntry[] {
  return cardsOf(data, view, ownEntry(view).hand);
}

/** R-6.4: automatisch ausgespielte Ressourcen dieser Runde (erklären, warum weniger Karten auf der Hand sind). */
export function playedCards(data: GameData, view: PlayerView): CardEntry[] {
  return cardsOf(data, view, ownEntry(view).played);
}

/** Gold der Planung: Rundenvorrat und Schatzkammer (R-7). */
export function goldSummary(view: PlayerView): string {
  const own = ownEntry(view);
  return `Rundenvorrat ${own.roundGold} Gold · Schatzkammer ${own.treasury} Gold`;
}

function unitLabel(data: GameData, unit: Unit): string {
  const name = unit.kind === "leader" ? (data.leaders.get(unit.sourceId)?.name ?? unit.sourceId) : (data.cards.get(unit.sourceId)?.name ?? unit.sourceId);
  // Anführer haben Stufen statt Sterne (R-16).
  return unit.kind === "leader" ? name : `${name} ${"★".repeat(unit.stars)}`.trim();
}

/** Einheit für Auswahllisten: Name, Sterne und Ort mit Feldnamen (R-3.8). */
export function unitOptionText(data: GameData, unit: Unit): string {
  return `${unitLabel(data, unit)} (${locationName(data.config, unit.owner, unit.location)})`;
}

/**
 * Text einer geplanten Aktion. `before` ist die Sicht zu Beginn der Planung (Namen bewegter Einheiten und der
 * ausgespielten Karten).
 */
export function describeAction(data: GameData, before: PlayerView, action: PlanningAction): string {
  const player = before.viewer;
  const cardName = (id: number): string => {
    const instance = before.cards[id];
    return (instance && data.cards.get(instance.cardId)?.name) ?? `Karte ${id}`;
  };
  const unitName = (id: UnitId): string => {
    const unit = before.units[id];
    return unit ? unitLabel(data, unit) : `Einheit ${id}`;
  };
  switch (action.type) {
    case "playUnit":
      return `${cardName(action.cardInstanceId)} ausspielen → ${locationName(data.config, player, action.to)}`;
    case "moveUnit":
      return `${unitName(action.unitId)} bewegen → ${locationName(data.config, player, action.to)}`;
    case "setSpell":
      return `Zauber ${cardName(action.cardInstanceId)} legen (${action.slot === "pre" ? "vor" : "nach"} dem Kampf)`;
    case "setLeaderAbility":
      return "Anführer-Fähigkeit wählen";
    case "heal":
      return `${unitName(action.unitId)} genesen`;
    case "withdraw":
      return `${action.amount} Gold aus der Schatzkammer entnehmen`;
    case "chooseBranch":
      return `Ast wählen: ${action.branchId}`;
    case "buy":
      return `${data.cards.get(action.cardId)?.name ?? action.cardId} kaufen`;
  }
}
