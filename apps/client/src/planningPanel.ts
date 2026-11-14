/**
 * Planungsleiste im Browser (C3a): zeigt den Planungsentwurf (`PlanBuilder`) als schlichte HTML-Bedienung.
 * Schritte Ausspielen, Kaufen, Aufstellen (R-5) mit freiem Wechsel, Gold, automatisch ausgespielte Münzen,
 * Hand, Ortsauswahl mit Feldnamen (R-3.8), Liste der geplanten Aktionen und Bestätigen.
 * Die Logik liegt in `planner.ts`; hier wird nur gezeichnet und weitergereicht.
 */
import { type GameData, PLANNING_SECTIONS, type PlanningAction, type PlayerView, type UnitId, type UnitLocation } from "@game/engine";
import { applyTarget, type BoardSelection, isRelocatable, targetLocations, validSelection } from "./boardInput";
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
  /** Auswahl für das 3D-Brett (C3b): Handkarte oder eigene Einheit. */
  private selection: BoardSelection = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly data: GameData,
    private readonly handlers: PlanningPanelHandlers,
  ) {}

  /** Neue Planung beginnen (`null` = keine Planung offen). */
  start(builder: PlanBuilder | null): void {
    this.builder = builder;
    this.before = builder ? builder.preview() : null;
    this.selection = null;
    this.render();
  }

  get active(): PlanBuilder | null {
    return this.builder;
  }

  /** C3b: hervorzuhebende Zielorte für das Brett (leer ohne Auswahl). */
  targets(): UnitLocation[] {
    return this.builder ? targetLocations(this.data, this.builder, this.selection) : [];
  }

  /** C3b: auf dem Brett gewählte eigene Einheit (für die Markierung), sonst `null`. */
  selectedUnit(): UnitId | null {
    return this.selection?.kind === "unit" ? this.selection.unitId : null;
  }

  /** C3b: darf die Einheit auf dem Brett gezogen werden? */
  canDrag(unitId: UnitId): boolean {
    return this.builder !== null && isRelocatable(this.builder, unitId);
  }

  /** C3b: Klick auf eine Einheit des Bretts wählt sie (erneuter Klick hebt die Wahl auf). */
  clickUnit(unitId: UnitId): void {
    if (!this.builder) return;
    if (!isRelocatable(this.builder, unitId)) {
      this.change("Diese Einheit kannst du nicht versetzen.");
      return;
    }
    this.selection = this.selectedUnit() === unitId ? null : { kind: "unit", unitId };
    this.change(this.selection ? "Einheit gewählt: freies Feld anklicken." : "");
  }

  /** C3b: Klick auf einen eigenen Ort des Bretts (`null` = daneben, hebt die Wahl auf). */
  clickLocation(to: UnitLocation | null): void {
    if (!this.builder) return;
    if (!to || !validSelection(this.data, this.builder, this.selection)) {
      if (this.selection) {
        this.selection = null;
        this.change();
      }
      return;
    }
    this.place(to);
  }

  /** C3b: gezogene Einheit losgelassen (`null` = nicht über einem eigenen Ort, nichts passiert). */
  dropUnit(unitId: UnitId, to: UnitLocation | null): void {
    if (!this.builder) return;
    this.selection = { kind: "unit", unitId };
    if (!to) {
      this.selection = null;
      this.change("Kein eigenes Feld getroffen.");
      return;
    }
    this.place(to);
  }

  private place(to: UnitLocation): void {
    if (!this.builder) return;
    const reason = applyTarget(this.data, this.builder, this.selection, to);
    if (!reason) this.selection = null;
    this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : `→ ${locationName(this.data.config, this.builder.player, to)}`);
  }

  private change(note = ""): void {
    this.render();
    if (this.builder) this.handlers.onChange(this.builder.preview(), note);
  }

  private add(action: PlanningAction): void {
    if (!this.builder) return;
    const reason = this.builder.add(action);
    if (!reason) this.selection = null;
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
        this.selection = null;
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
        className: this.selection?.kind === "card" && entry.instanceId === this.selection.cardInstanceId ? "primary" : "",
        disabled: !isUnit,
        title: isUnit ? "Einheit ausspielen" : "Zauber legen kommt mit C3c",
      });
      button.addEventListener("click", () => {
        const already = this.selection?.kind === "card" && this.selection.cardInstanceId === entry.instanceId;
        this.selection = already ? null : { kind: "card", cardInstanceId: entry.instanceId };
        this.change(this.selection ? "Karte gewählt: freies Feld auf dem Brett anklicken oder unten den Ort wählen." : "");
      });
      row.append(button);
    }
    this.root.append(row);

    const selection = this.selection;
    const selected = selection?.kind === "card" ? hand.find((c) => c.instanceId === selection.cardInstanceId) : undefined;
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
      this.root.append(
        el("p", { className: "hint", textContent: "Einheitenkarte wählen, dann ein hervorgehobenes Feld auf dem Brett anklicken (oder den Ort hier wählen). Zauber, Genesen und Entnahme folgen mit C3c." }),
      );
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
    this.root.append(
      el("p", {
        className: "hint",
        textContent: "Auf dem Brett: eigene Einheit anklicken und dann ein hervorgehobenes Feld, oder die Einheit direkt dorthin ziehen. Neu ausgespielte Einheiten lassen sich genauso umstellen. Anführer-Fähigkeit folgt mit C3d.",
      }),
    );
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
