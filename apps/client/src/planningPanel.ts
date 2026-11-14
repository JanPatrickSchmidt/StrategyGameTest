/**
 * Planungsleiste im Browser (C3a): zeigt den Planungsentwurf (`PlanBuilder`) als schlichte HTML-Bedienung.
 * Schritte Ausspielen, Kaufen, Aufstellen (R-5) mit freiem Wechsel, Gold, automatisch ausgespielte Münzen,
 * Hand, Ortsauswahl mit Feldnamen (R-3.8), Liste der geplanten Aktionen und Bestätigen.
 * Die Logik liegt in `planner.ts`; hier wird nur gezeichnet und weitergereicht.
 */
import { type GameData, PLANNING_SECTIONS, type PlanningAction, type PlayerView, type UnitLocation } from "@game/engine";
import { locationName } from "./fieldNames";
import {
  type CardEntry,
  describeAction,
  goldSummary,
  handCards,
  locationKey,
  type PlanBuilder,
  playedCards,
  reasonText,
  STEP_NAMES,
  unitOptionText,
} from "./planner";

export interface PlanningPanelHandlers {
  /** Nach jeder Änderung des Entwurfs (für das 3D-Brett und die Meldung). */
  onChange: (preview: PlayerView, note: string) => void;
  onConfirm: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function locationSelect(data: GameData, view: PlayerView, locations: readonly UnitLocation[]): HTMLSelectElement {
  const select = el("select");
  for (const loc of locations) select.append(el("option", { value: locationKey(loc), textContent: locationName(data.config, view.viewer, loc) }));
  return select;
}

function selectedLocation(select: HTMLSelectElement, locations: readonly UnitLocation[]): UnitLocation | null {
  return locations.find((loc) => locationKey(loc) === select.value) ?? null;
}

function cardText(entry: CardEntry): string {
  return `${entry.card.name} (${entry.card.cost})`;
}

export class PlanningPanel {
  private builder: PlanBuilder | null = null;
  private before: PlayerView | null = null;
  private selectedCard: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly data: GameData,
    private readonly handlers: PlanningPanelHandlers,
  ) {}

  /** Neue Planung beginnen (`null` = keine Planung offen). */
  start(builder: PlanBuilder | null): void {
    this.builder = builder;
    this.before = builder ? builder.preview() : null;
    this.selectedCard = null;
    this.render();
  }

  get active(): PlanBuilder | null {
    return this.builder;
  }

  private change(note = ""): void {
    this.render();
    if (this.builder) this.handlers.onChange(this.builder.preview(), note);
  }

  private add(action: PlanningAction): void {
    if (!this.builder) return;
    const reason = this.builder.add(action);
    if (!reason) this.selectedCard = null;
    this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : "");
  }

  private render(): void {
    this.root.replaceChildren();
    const builder = this.builder;
    if (!builder || !this.before) {
      this.root.append(el("p", { className: "hint", textContent: "Gerade ist keine Planung offen." }));
      return;
    }
    const view = builder.preview();

    const steps = el("div", { className: "row steps" });
    for (const step of PLANNING_SECTIONS) {
      const button = el("button", { textContent: STEP_NAMES[step], className: step === builder.step ? "primary" : "" });
      button.addEventListener("click", () => {
        builder.setStep(step);
        this.selectedCard = null;
        this.change();
      });
      steps.append(button);
    }
    this.root.append(steps);

    this.root.append(el("p", { className: "gold", textContent: goldSummary(view) }));
    const played = playedCards(this.data, view);
    this.root.append(
      el("p", { className: "hint" }, `Automatisch ausgespielt (R-6.4): ${played.length > 0 ? played.map((c) => c.card.name).join(", ") : "nichts"}`),
    );

    if (builder.step === "play") this.renderPlay(builder, view);
    else if (builder.step === "buy") this.root.append(el("p", { className: "hint", textContent: "Kaufen kommt mit C5 (Königreich und Klassen-Pool). Bis dahin kannst du hier nichts kaufen." }));
    else this.renderPosition(builder, view);

    this.renderList(builder);

    const confirm = el("button", { className: "primary", textContent: "Planung bestätigen" });
    confirm.addEventListener("click", () => this.handlers.onConfirm());
    this.root.append(el("div", { className: "row" }, confirm));
  }

  private renderPlay(builder: PlanBuilder, view: PlayerView): void {
    const hand = handCards(this.data, view);
    const row = el("div", { className: "row hand" }, el("span", { className: "hint", textContent: "Hand:" }));
    if (hand.length === 0) row.append(el("span", { className: "hint", textContent: "leer" }));
    for (const entry of hand) {
      const isUnit = entry.card.type === "unit";
      const button = el("button", {
        textContent: cardText(entry),
        className: entry.instanceId === this.selectedCard ? "primary" : "",
        disabled: !isUnit,
        title: isUnit ? "Einheit ausspielen" : "Zauber legen kommt mit C3c",
      });
      button.addEventListener("click", () => {
        this.selectedCard = this.selectedCard === entry.instanceId ? null : entry.instanceId;
        this.render();
      });
      row.append(button);
    }
    this.root.append(row);

    const selected = hand.find((c) => c.instanceId === this.selectedCard);
    if (selected) {
      const locations = builder.freeLocations();
      const select = locationSelect(this.data, view, locations);
      const go = el("button", { textContent: "Ausspielen" });
      go.addEventListener("click", () => {
        const to = selectedLocation(select, locations);
        if (to) this.add({ type: "playUnit", cardInstanceId: selected.instanceId, to });
      });
      this.root.append(el("div", { className: "row" }, el("span", { textContent: `${selected.card.name} nach` }), select, go));
    } else {
      this.root.append(el("p", { className: "hint", textContent: "Einheitenkarte wählen, dann den Ort. Zauber, Genesen und Entnahme folgen mit C3c." }));
    }
  }

  private renderPosition(builder: PlanBuilder, view: PlayerView): void {
    const units = builder.movableUnits();
    if (units.length === 0) {
      this.root.append(el("p", { className: "hint", textContent: "Keine Einheit zum Bewegen." }));
      return;
    }
    const unitSelect = el("select");
    for (const unit of units) unitSelect.append(el("option", { value: String(unit.id), textContent: unitOptionText(this.data, unit) }));
    const locations = builder.freeLocations();
    const select = locationSelect(this.data, view, locations);
    const go = el("button", { textContent: "Bewegen" });
    go.addEventListener("click", () => {
      const to = selectedLocation(select, locations);
      if (to) this.add({ type: "moveUnit", unitId: Number(unitSelect.value), to });
    });
    this.root.append(el("div", { className: "row" }, unitSelect, el("span", { textContent: "nach" }), select, go));
    this.root.append(el("p", { className: "hint", textContent: "Neu ausgespielte Einheiten stellst du beim Ausspielen auf. Anführer-Fähigkeit folgt mit C3d." }));
  }

  private renderList(builder: PlanBuilder): void {
    const before = this.before;
    if (!before) return;
    const entries = builder.entries();
    const list = el("ol", { className: "plan-list" });
    for (const entry of entries) {
      const remove = el("button", { textContent: "×", title: "Aktion entfernen", className: "small" });
      remove.addEventListener("click", () => {
        builder.remove(entry.section, entry.index);
        this.change();
      });
      const text = `${STEP_NAMES[entry.section]}: ${describeAction(this.data, before, entry.action)}`;
      const item = el("li", {}, text, entry.rejection ? el("span", { className: "rejected", textContent: ` – wird abgelehnt: ${reasonText(entry.rejection)}` }) : "", " ", remove);
      list.append(item);
    }
    this.root.append(el("p", { className: "hint", textContent: entries.length > 0 ? "Geplant:" : "Noch nichts geplant." }));
    if (entries.length > 0) this.root.append(list);
  }
}
