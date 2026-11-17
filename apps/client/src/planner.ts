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
  type ActionTarget,
  allLocations,
  type AltCost,
  cardGoldCost,
  checkTarget,
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
  type TargetSpec,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "@game/engine";
import { locationName } from "./fieldNames";
import { targetText } from "./targetText";

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
  notASpellCard: "keine Zauberkarte",
  wrongSlot: "falscher Zauber-Slot",
  slotFull: "Zauber-Slot schon belegt",
  invalidTarget: "Ziel nicht erlaubt",
  tooManyTargets: "zu viele Ziele",
  tooManyCards: "zu viele Karten gewählt",
  invalidCardChoice: "Karte nicht wählbar",
  unknownUnit: "Einheit gibt es nicht",
  wrongSection: "in diesem Schritt nicht erlaubt",
  invalidLocation: "Ort gibt es nicht",
  notOwnUnit: "nicht deine Einheit",
  notWounded: "Einheit ist nicht verwundet",
  invalidAmount: "ungültiger Betrag",
  noAltCost: "Karte hat keine alternativen Kosten",
  notEnoughLife: "zu wenig Leben (mindestens 1 muss bleiben)",
  wrongSacrificeCount: "falsche Zahl an Opfern",
  invalidSacrifice: "Opfer nicht erlaubt",
};

/**
 * Gründe, aus denen der Client eine Änderung der Planung ablehnt: die der Engine und `breaksPlannedAction`
 * (die Änderung würde eine andere, bisher angenommene Aktion ungültig machen, P7).
 */
export type PlanReason = RejectionReason | "breaksPlannedAction";

export function reasonText(reason: PlanReason): string {
  if (reason === "breaksPlannedAction") return "würde eine andere geplante Aktion ungültig machen";
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

  /**
   * R-17.3 (P11b): Goldkosten einer Karte, wenn sie jetzt als nächste Aktion ausgespielt würde – nach dem Brett
   * des Entwurfs, also mit dem Kostenbonus der Resonanz (Engine `cardGoldCost`). `useAltCost`: Goldanteil der
   * alternativen Kosten.
   */
  goldCost(card: CardData, useAltCost = false): number {
    return cardGoldCost(this.draft.state, this.data, this.player, card, useAltCost);
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
   * - Einheit vom Beginn der Planung (R-7.2): eine frühere Bewegung dieser Einheit wird ersetzt und behält ihren
   *   Platz in der Liste (P7), damit Bewegungen anderer Einheiten auf das frei gewordene Feld gültig bleiben;
   *   gelingt das so nicht, wird die Bewegung ans Ende gestellt. Zurück auf ihren Ausgangsort heißt einfach
   *   „nicht bewegen“. Wechselt in den Schritt Aufstellen.
   * - Neu ausgespielte Einheit (R-7.1): der Zielort ihrer Ausspiel-Aktion wird geändert; wechselt zu Ausspielen.
   * Lehnt die Engine ab oder würde eine andere bisher angenommene Aktion dadurch abgelehnt
   * (`breaksPlannedAction`), bleibt alles wie vorher und der Grund wird zurückgegeben.
   */
  relocate(unitId: UnitId, to: UnitLocation): PlanReason | null {
    const unit = this.draft.state.units[unitId];
    if (!unit || unit.owner !== this.player) return "unknownUnit";
    if (this.draft.initialUnitIds.has(unitId)) {
      const list = this.actions.position;
      const saved = list.slice();
      const accepted = this.acceptedActions();
      const own = (a: PlanningAction): boolean => a.type === "moveUnit" && a.unitId === unitId;
      const start = this.source.units[unitId]?.location;
      const kept = saved.filter((a) => !own(a));
      const candidates: PlanningAction[][] = [];
      if (start && locationKey(start) === locationKey(to)) {
        candidates.push(kept);
      } else {
        const move: PlanningAction = { type: "moveUnit", unitId, to: { ...to } as UnitLocation };
        const at = saved.findIndex(own);
        if (at >= 0) candidates.push([...kept.slice(0, at), move, ...kept.slice(at)]);
        candidates.push([...kept, move]);
      }
      let reason: PlanReason | null = null;
      for (const candidate of candidates) {
        list.splice(0, list.length, ...candidate);
        this.replay();
        reason = this.firstProblem(accepted, list.find(own));
        if (!reason) {
          this.currentStep = "position";
          return null;
        }
      }
      list.splice(0, list.length, ...saved);
      this.replay();
      return reason;
    }
    const index = this.playIndexOf(unit);
    if (index < 0) return "unknownUnit";
    const list = this.actions.play;
    const old = list[index];
    if (!old || old.type !== "playUnit") return "unknownUnit";
    const accepted = this.acceptedActions();
    const changed: PlanningAction = { ...old, to: { ...to } as UnitLocation };
    list[index] = changed;
    this.replay();
    const reason = this.firstProblem(accepted, changed);
    if (reason) {
      list[index] = old;
      this.replay();
      return reason;
    }
    this.currentStep = "play";
    return null;
  }

  /** Aktionen, die die Engine beim letzten Durchspielen angenommen hat (nach Objekt). */
  private acceptedActions(): Set<PlanningAction> {
    const accepted = new Set<PlanningAction>();
    for (const section of PLANNING_SECTIONS) {
      this.actions[section].forEach((action, i) => {
        if (!this.results[section][i]) accepted.add(action);
      });
    }
    return accepted;
  }

  /**
   * Nach einer Änderung: Grund der Ablehnung der geänderten Aktion (falls vorhanden), sonst
   * `breaksPlannedAction`, wenn eine vorher angenommene Aktion jetzt abgelehnt wird, sonst `null`.
   */
  private firstProblem(accepted: Set<PlanningAction>, changed: PlanningAction | undefined): PlanReason | null {
    let broken = false;
    for (const section of PLANNING_SECTIONS) {
      const list = this.actions[section];
      for (let i = 0; i < list.length; i++) {
        const result = this.results[section][i] ?? null;
        if (!result) continue;
        const action = list[i];
        if (action === changed) return result;
        if (action && accepted.has(action)) broken = true;
      }
    }
    return broken ? "breaksPlannedAction" : null;
  }

  /** Index der Ausspiel-Aktion, aus der eine neue Einheit entstanden ist (`-1`, wenn keine). */
  private playIndexOf(unit: Unit): number {
    if (this.draft.initialUnitIds.has(unit.id)) return -1;
    return this.actions.play.findIndex((a) => a.type === "playUnit" && unit.cardInstanceIds.includes(a.cardInstanceId));
  }

  /**
   * C3c1: Prüft ein Ziel gegen eine Ziel-Angabe (R-14.2) auf dem Stand des Entwurfs, allein über die Engine
   * (`checkTarget`). Liefert das geprüfte Ziel oder den Ablehnungsgrund; ändert nichts.
   */
  checkTarget(spec: TargetSpec, target: ActionTarget): ActionTarget | RejectionReason {
    return checkTarget(this.draft.state, this.data, this.player, spec, {}, target);
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
    case "playUnit": {
      const text = `${cardName(action.cardInstanceId)} ausspielen → ${locationName(data.config, player, action.to)}`;
      return action.useAltCost ? `${text} (${altPaymentText(data, before, action)})` : text;
    }
    case "moveUnit":
      return `${unitName(action.unitId)} bewegen → ${locationName(data.config, player, action.to)}`;
    case "setSpell":
      return `Zauber ${cardName(action.cardInstanceId)} legen (${action.slot === "pre" ? "vor" : "nach"} dem Kampf) → ${targetText(data, before, action.target)}`;
    case "setLeaderAbility":
      return "Anführer-Fähigkeit wählen";
    case "heal": {
      const unit = before.units[action.unitId];
      return `${unitName(action.unitId)} genesen${unit ? ` (${data.config.healCostPerStar * unit.stars} Gold)` : ""}`;
    }
    case "withdraw":
      return `${action.amount} Gold aus der Schatzkammer entnehmen`;
    case "chooseBranch":
      return `Ast wählen: ${action.branchId}`;
    case "buy":
      return `${data.cards.get(action.cardId)?.name ?? action.cardId} kaufen`;
  }
}

/** R-14.6: Bezahlung einer Ausspiel-Aktion mit alternativen Kosten, z. B. „alternativ: 2 Gold + 1 Opfer: Söldner“. */
function altPaymentText(data: GameData, before: PlayerView, action: Extract<PlanningAction, { type: "playUnit" }>): string {
  const instance = before.cards[action.cardInstanceId];
  const card = instance ? data.cards.get(instance.cardId) : undefined;
  const alt = card?.type === "unit" ? card.altCost : undefined;
  const victims = (action.sacrifice ?? []).map((id) => {
    const unit = before.units[id];
    return unit ? (data.cards.get(unit.sourceId)?.name ?? unit.sourceId) : `Einheit ${id}`;
  });
  const cost = `alternativ: ${alt ? altCostText(alt) : "kostenlos"}`;
  return victims.length > 0 ? `${cost}: ${victims.join(", ")}` : cost;
}

/** Handkarte mit ihren aktuellen Goldkosten (R-17.3: mit Kostenbonus der Resonanz, aus der Engine, P11b). */
export function cardText(builder: PlanBuilder, entry: CardEntry): string {
  return `${entry.card.name} (${builder.goldCost(entry.card)})`;
}

/**
 * R-14.6: Text alternativer Kosten, z. B. „2 Leben“ oder „2 Gold + 1 Opfer“. `gold` ersetzt den Goldanteil
 * (z. B. nach dem Kostenbonus der Resonanz, R-17.3); ein Anteil von 0 Gold wird nicht genannt.
 */
export function altCostText(alt: AltCost, gold: number = alt.gold ?? 0): string {
  const parts: string[] = [];
  if (gold) parts.push(`${gold} Gold`);
  if (alt.bloodToll) parts.push(`${alt.bloodToll} Leben`);
  if (alt.sacrifice) parts.push(`${alt.sacrifice} Opfer`);
  return parts.length > 0 ? parts.join(" + ") : "kostenlos";
}
