/**
 * Planungsleiste im Browser (C3a): zeigt den Planungsentwurf (`PlanBuilder`) als schlichte HTML-Bedienung.
 * Schritte Ausspielen, Kaufen, Aufstellen (R-5) mit freiem Wechsel, Gold, automatisch ausgespielte Münzen,
 * Hand, Ortsauswahl mit Feldnamen (R-3.8), Liste der geplanten Aktionen und Bestätigen; seit C3c2 auch Genesen
 * (R-7.5), Entnahme aus der Schatzkammer (R-7.6) und alternative Kosten beim Ausspielen (R-14.6); seit C3d1
 * Astwahl (R-7.7) und Anführer-Fähigkeit mit Ziel (R-7.4, R-16.6); seit C5a der Schritt Kaufen (R-11) mit
 * Königreich, Basisstapeln und Klassen-Pool sowie dem Hinweis zum automatischen Einzahlen (R-12.5).
 * Die Logik liegt in `planner.ts`; hier wird nur gezeichnet und weitergereicht.
 */
import { type ActionTarget, type GameData, PLANNING_SECTIONS, type PlanningAction, type PlayerView, type RejectionReason, type UnitId, type UnitLocation } from "@game/engine";
import { addBuy, buyOptions, buyOptionText, buySpending, cardSummary, depositText, pileGroupName } from "./buyOffer";
import { applyTarget, type BoardSelection, isRelocatable, targetLocations, validSelection } from "./boardInput";
import { locationName } from "./fieldNames";
import { type AbilityChoice, abilityState, addAbility, branchChoice, branchName, combinePicks, movesTarget, setBranch } from "./leaderPlan";
import { addHeal, addWithdraw, healOptions, NORMAL_PAYMENT, type Payment, paymentChoice, playAction, playLocations, withdrawMax } from "./planExtras";
import { addSpell, SLOT_LABELS, spellTargetChoice, type TargetChoice, type TargetOption } from "./spellTargets";
import {
  actionNote,
  cardText,
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

export class PlanningPanel {
  private builder: PlanBuilder | null = null;
  private before: PlayerView | null = null;
  /** Auswahl für das 3D-Brett (C3b): Handkarte oder eigene Einheit. */
  private selection: BoardSelection = null;
  /** C3c1: gewählte Zauberkarte der Hand, deren Ziel gerade gewählt wird. */
  private spellCard: number | null = null;

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
    this.spellCard = null;
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
    this.change(this.before ? actionNote(this.data, this.before, action, reason) : "");
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
        this.spellCard = null;
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

    this.renderWithdraw(builder, view);

    if (builder.step === "play") this.renderPlay(builder, view);
    else if (builder.step === "buy") this.renderBuy(builder);
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
      const isSpell = entry.card.type === "spell";
      const chosen = isUnit
        ? this.selection?.kind === "card" && entry.instanceId === this.selection.cardInstanceId
        : this.spellCard === entry.instanceId;
      const button = el("button", {
        textContent: cardText(builder, entry),
        className: chosen ? "primary" : "",
        disabled: !isUnit && !isSpell,
        title: isUnit ? "Einheit ausspielen" : isSpell ? "Zauber legen" : "",
      });
      button.addEventListener("click", () => {
        if (isSpell) {
          this.selection = null;
          this.spellCard = chosen ? null : entry.instanceId;
          this.change(this.spellCard !== null ? "Zauber gewählt: unten das Ziel wählen und legen." : "");
          return;
        }
        this.spellCard = null;
        this.selection = chosen ? null : { kind: "card", cardInstanceId: entry.instanceId };
        this.change(this.selection ? "Karte gewählt: freies Feld auf dem Brett anklicken oder unten den Ort wählen." : "");
      });
      row.append(button);
    }
    this.root.append(row);

    const selection = this.selection;
    const selected = selection?.kind === "card" ? hand.find((c) => c.instanceId === selection.cardInstanceId) : undefined;
    const spell = this.spellCard !== null ? hand.find((c) => c.instanceId === this.spellCard && c.card.type === "spell") : undefined;
    if (spell && spell.card.type === "spell") {
      const choice = spellTargetChoice(this.data, builder, spell.instanceId);
      if (choice) this.renderSpellTarget(builder, spell.instanceId, `${spell.card.name} (${SLOT_LABELS[spell.card.slot]})`, choice);
    } else if (selected && selection?.kind === "card") {
      const payment = selection.payment ?? NORMAL_PAYMENT;
      this.renderPayment(builder, selected.instanceId, payment);
      const locations = playLocations(builder, payment);
      const select = locationSelect(this.data, view, locations);
      const go = el("button", { textContent: "Ausspielen" });
      go.addEventListener("click", () => {
        const to = selectedLocation(select, locations);
        if (to) this.add(playAction(selected.instanceId, to, payment));
      });
      this.root.append(el("div", { className: "row" }, el("span", { textContent: `${selected.card.name} nach` }), select, go));
    } else {
      this.root.append(
        el("p", {
          className: "hint",
          textContent:
            "Einheitenkarte wählen, dann ein hervorgehobenes Feld auf dem Brett anklicken (oder den Ort hier wählen). Zauberkarte wählen, dann ihr Ziel.",
        }),
      );
    }
    this.renderHeal(builder);
    this.renderBranch(builder);
  }

  /**
   * C5a, R-11: Kaufangebot nach Gruppen (Basis, Königreich, eigener Klassen-Pool) mit Kosten und Stapelstand;
   * ein Klick plant einen Kauf. Nicht mögliche Käufe sind gesperrt und nennen den Grund. Darunter, was am
   * Rundenende automatisch in die Schatzkammer geht (R-12.5).
   */
  private renderBuy(builder: PlanBuilder): void {
    this.root.append(el("p", { className: "hint", textContent: "Karte anklicken, um sie zu kaufen. Gekaufte Karten kommen beim Aufdecken auf deinen Ablagestapel." }));
    const options = buyOptions(this.data, builder);
    for (const group of ["basic", "kingdom", "class"] as const) {
      const inGroup = options.filter((o) => o.group === group);
      if (inGroup.length === 0) continue;
      const row = el("div", { className: "row shop" }, el("span", { className: "hint", textContent: `${pileGroupName(this.data, group, options)}:` }));
      for (const option of inGroup) {
        const button = el("button", {
          textContent: buyOptionText(option),
          disabled: option.blocked !== null,
          title: `${cardSummary(this.data, option.card)}${option.blocked ? ` – nicht möglich: ${reasonText(option.blocked)}` : ""}`,
        });
        button.dataset["cardId"] = option.cardId;
        button.addEventListener("click", () => {
          const reason = addBuy(builder, option.cardId);
          this.change(this.before ? actionNote(this.data, this.before, { type: "buy", cardId: option.cardId }, reason) : "");
        });
        row.append(button);
      }
      this.root.append(row);
    }
    const spent = buySpending(this.data, builder);
    if (spent > 0) this.root.append(el("p", { className: "hint", textContent: `Für Käufe bezahlt: ${spent} Gold.` }));
    this.root.append(el("p", { className: "hint deposit", textContent: depositText(builder.preview()) }));
  }

  /** C3d1, R-7.7: Astwahl, sobald der Anführer Stufe 2 erreicht hat und noch keinen Ast hat. */
  private renderBranch(builder: PlanBuilder): void {
    const choice = branchChoice(builder);
    if (!choice) return;
    const select = el("select");
    for (const option of choice.options) select.append(el("option", { value: option.id, textContent: option.name, selected: option.id === choice.chosen }));
    const go = el("button", { textContent: choice.chosen ? "Ast ändern" : "Ast wählen" });
    go.addEventListener("click", () => {
      const reason = setBranch(builder, select.value);
      this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : `Ast gewählt: ${branchName(builder, select.value)}.`);
    });
    const first = choice.options[0];
    const hint = choice.chosen ? "" : ` (ohne Wahl gilt ${first ? first.name : "der erste Ast"})`;
    this.root.append(el("div", { className: "row" }, el("span", { textContent: `Anführer Stufe 2 – Ast${hint}:` }), select, go));
  }

  /** Auswahlliste mit Gruppen (z. B. Felder nach Arena); Wert = Index in `options`, optional mit leerem Eintrag. */
  private optionSelect(options: readonly TargetOption[], emptyLabel?: string): HTMLSelectElement {
    const select = el("select");
    if (emptyLabel !== undefined) select.append(el("option", { value: "", textContent: emptyLabel }));
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const [i, option] of options.entries()) {
      const node = el("option", { value: String(i), textContent: option.label });
      if (option.group) {
        let group = groups.get(option.group);
        if (!group) {
          group = el("optgroup", { label: option.group });
          groups.set(option.group, group);
          select.append(group);
        }
        group.append(node);
      } else select.append(node);
    }
    return select;
  }

  /** C3d1, R-7.4: Anführer-Fähigkeit mit Ziel (höchstens einmal, kostenlos) oder bewusst keine. */
  private renderAbility(builder: PlanBuilder): void {
    const state = abilityState(this.data, builder);
    const title = `Anführer-Fähigkeit ${state.name} (${state.levelText})`;
    if (state.unavailable) {
      this.root.append(el("p", { className: "hint", textContent: `${title}: Anführer ist vernichtet, in dieser Runde keine Fähigkeit (R-14.5).` }));
      return;
    }
    if (state.planned) {
      this.root.append(el("p", { className: "hint", textContent: `${title}: gewählt (zum Ändern unten in „Geplant“ entfernen).` }));
      return;
    }
    const done = (reason: RejectionReason | null): void => this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : "Anführer-Fähigkeit gewählt.");
    const go = el("button", { textContent: "Fähigkeit wählen" });
    const skip = el("button", { textContent: "Keine Fähigkeit" });
    skip.addEventListener("click", () => done(addAbility(builder, { kind: "none" })));
    const read = this.renderAbilityChoice(state.choice, title);
    go.addEventListener("click", () => {
      const target = read();
      if (target === undefined) {
        this.change("Erst ein Ziel wählen.");
        return;
      }
      done(addAbility(builder, target));
    });
    this.root.append(el("div", { className: "row" }, go, skip));
  }

  /** Zeichnet die Zielwahl der Fähigkeit und liefert eine Funktion, die die aktuelle Wahl ausliest. */
  private renderAbilityChoice(choice: AbilityChoice, title: string): () => ActionTarget | undefined {
    switch (choice.kind) {
      case "none":
        this.root.append(el("p", {}, `${title}: ohne Ziel`));
        return () => ({ kind: "none" });
      case "pick": {
        if (choice.options.length === 0) {
          this.root.append(el("p", { className: "hint", textContent: `${title}: kein gültiges Ziel` }));
          return () => undefined;
        }
        if (choice.max <= 1) {
          const select = this.optionSelect(choice.options);
          this.root.append(el("div", { className: "row" }, el("span", { textContent: `${title}: Ziel` }), select));
          return () => choice.options[Number(select.value)]?.target;
        }
        // Mehrere Ziele (z. B. Zonen bei „Weite“, Felder bei „Kette“): Ankreuzen, höchstens `max`.
        const boxes: { box: HTMLInputElement; option: TargetOption }[] = [];
        const list = el("div", { className: "row card-choice" });
        for (const option of choice.options) {
          const box = el("input", { type: "checkbox" });
          boxes.push({ box, option });
          list.append(el("label", {}, box, ` ${option.label}`));
        }
        this.root.append(el("p", {}, `${title}: bis zu ${choice.max} Ziele ankreuzen`), list);
        return () => combinePicks(boxes.filter((b) => b.box.checked).map((b) => b.option.target)) ?? undefined;
      }
      case "moves": {
        if (choice.units.length === 0 || choice.destinations.length === 0) {
          this.root.append(el("p", { className: "hint", textContent: `${title}: keine Einheit oder kein freies Feld` }));
          return () => undefined;
        }
        // R-16.6: je Zeile eine eigene Einheit und ein freies Feld einer Arena, an der du teilnimmst.
        this.root.append(el("p", {}, `${title}: bis zu ${choice.max} Einheiten versetzen (auch in die gegnerische Hälfte)`));
        const rows: { unit: HTMLSelectElement; to: HTMLSelectElement }[] = [];
        for (let i = 0; i < choice.max; i += 1) {
          const unit = el("select");
          unit.append(el("option", { value: "", textContent: "– keine –" }));
          for (const option of choice.units) unit.append(el("option", { value: String(option.unitId), textContent: option.label }));
          const to = this.optionSelect(choice.destinations, "– Feld –");
          rows.push({ unit, to });
          this.root.append(el("div", { className: "row" }, unit, el("span", { textContent: "nach" }), to));
        }
        return () => {
          const moves = rows.flatMap((r) => {
            const target = r.to.value === "" ? undefined : choice.destinations[Number(r.to.value)]?.target;
            return r.unit.value === "" || !target ? [] : [{ unitId: Number(r.unit.value), to: target }];
          });
          return movesTarget(moves) ?? undefined;
        };
      }
    }
  }

  /** C3c2, R-14.6: Bezahlwahl für die gewählte Einheitenkarte (nur bei Karten mit alternativen Kosten). */
  private renderPayment(builder: PlanBuilder, cardInstanceId: number, payment: Payment): void {
    const choice = paymentChoice(this.data, builder, cardInstanceId);
    if (!choice?.alt) return;
    const alt = choice.alt;
    const setPayment = (next: Payment): void => {
      this.selection = { kind: "card", cardInstanceId, payment: next };
      this.change(next.kind === "alt" && alt.sacrifice > 0 ? `Opfer wählen: genau ${alt.sacrifice}.` : "");
    };
    const mode = el("select");
    mode.append(
      el("option", { value: "normal", textContent: `normal: ${choice.normalText}`, selected: payment.kind === "normal" }),
      el("option", { value: "alt", textContent: `alternativ: ${alt.text}`, selected: payment.kind === "alt" }),
    );
    mode.addEventListener("change", () => setPayment(mode.value === "alt" ? { kind: "alt", sacrifice: [] } : NORMAL_PAYMENT));
    this.root.append(el("div", { className: "row" }, el("span", { textContent: "Bezahlen" }), mode));
    if (payment.kind !== "alt" || alt.sacrifice === 0) return;
    if (alt.candidates.length === 0) {
      this.root.append(el("p", { className: "hint", textContent: "Keine eigene Karten-Einheit zum Opfern (Anführer und Tokens zählen nicht)." }));
      return;
    }
    const list = el("div", { className: "row card-choice" }, el("span", { className: "hint", textContent: `Opfer (genau ${alt.sacrifice}):` }));
    for (const option of alt.candidates) {
      const box = el("input", { type: "checkbox", checked: payment.sacrifice.includes(option.unitId) });
      box.addEventListener("change", () => {
        const others = payment.sacrifice.filter((id) => id !== option.unitId);
        setPayment({ kind: "alt", sacrifice: box.checked ? [...others, option.unitId] : others });
      });
      list.append(el("label", {}, box, ` ${option.label}`));
    }
    this.root.append(list);
  }

  /** C3c2, R-7.5: verwundete eigene Einheit genesen (1 Gold je Stern). */
  private renderHeal(builder: PlanBuilder): void {
    const options = healOptions(this.data, builder);
    if (options.length === 0) return;
    const select = el("select");
    for (const option of options) select.append(el("option", { value: String(option.unitId), textContent: `${option.label} – ${option.cost} Gold` }));
    const go = el("button", { textContent: "Genesen" });
    go.addEventListener("click", () => {
      const reason = addHeal(builder, Number(select.value));
      this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : "Genesung geplant.");
    });
    this.root.append(el("div", { className: "row" }, el("span", { textContent: "Verwundet:" }), select, go));
  }

  /** C3c2, R-7.6: Gold aus der Schatzkammer in den Rundenvorrat (in jedem Schritt). */
  private renderWithdraw(builder: PlanBuilder, view: PlayerView): void {
    const max = withdrawMax(view);
    if (max <= 0) return;
    const amount = el("input", { type: "number", min: "1", max: String(max), value: String(max), className: "amount" });
    const go = el("button", { textContent: "Entnehmen" });
    go.addEventListener("click", () => {
      const reason = addWithdraw(builder, Number(amount.value));
      this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : "Entnahme geplant.");
    });
    this.root.append(
      el(
        "div",
        { className: "row", title: "Fehlt beim Bezahlen Gold im Rundenvorrat, wird ohnehin aus der Schatzkammer genommen." },
        el("span", { textContent: "Aus der Schatzkammer" }),
        amount,
        el("span", { textContent: "Gold" }),
        go,
      ),
    );
  }

  /** C3c1: Zielwahl eines Zaubers: ohne Ziel, eine Wahl aus der Liste oder eigene Karten ankreuzen (R-14.8). */
  private renderSpellTarget(builder: PlanBuilder, cardInstanceId: number, title: string, choice: TargetChoice): void {
    const go = el("button", { textContent: "Zauber legen" });
    const done = (reason: RejectionReason | null): void => {
      if (!reason) this.spellCard = null;
      this.change(reason ? `Nicht möglich: ${reasonText(reason)}` : "Zauber gelegt.");
    };
    const row = el("div", { className: "row" }, el("span", { textContent: title }));
    switch (choice.kind) {
      case "none":
        row.append(el("span", { className: "hint", textContent: "ohne Ziel" }), go);
        go.addEventListener("click", () => done(addSpell(this.data, builder, cardInstanceId, { kind: "none" })));
        this.root.append(row);
        return;
      case "single": {
        if (choice.options.length === 0) {
          row.append(el("span", { className: "hint", textContent: "kein gültiges Ziel" }));
          this.root.append(row);
          return;
        }
        const select = el("select");
        const groups = new Map<string, HTMLOptGroupElement>();
        for (const [i, option] of choice.options.entries()) {
          const node = el("option", { value: String(i), textContent: option.label });
          if (option.group) {
            let group = groups.get(option.group);
            if (!group) {
              group = el("optgroup", { label: option.group });
              groups.set(option.group, group);
              select.append(group);
            }
            group.append(node);
          } else select.append(node);
        }
        go.addEventListener("click", () => {
          const option = choice.options[Number(select.value)];
          if (option) done(addSpell(this.data, builder, cardInstanceId, option.target));
        });
        row.append(el("span", { textContent: "Ziel" }), select, go);
        this.root.append(row);
        return;
      }
      case "ownCards": {
        const boxes: { box: HTMLInputElement; id: number }[] = [];
        const list = el("div", { className: "row card-choice" });
        for (const card of choice.cards) {
          const box = el("input", { type: "checkbox" });
          boxes.push({ box, id: card.instanceId });
          list.append(el("label", {}, box, ` ${card.name} (${card.from === "deck" ? "Deck" : "Ablage"})`));
        }
        go.addEventListener("click", () => {
          const ids = boxes.filter((b) => b.box.checked).map((b) => b.id);
          done(addSpell(this.data, builder, cardInstanceId, { kind: "ownCards", cardInstanceIds: ids }));
        });
        row.append(el("span", { className: "hint", textContent: `bis zu ${choice.max} Karten entfernen (auch keine)` }), go);
        this.root.append(row);
        this.root.append(choice.cards.length > 0 ? list : el("p", { className: "hint", textContent: "Deck und Ablagestapel sind leer." }));
        return;
      }
    }
  }

  private renderPosition(builder: PlanBuilder, view: PlayerView): void {
    this.renderAbility(builder);
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
        textContent: "Auf dem Brett: eigene Einheit anklicken und dann ein hervorgehobenes Feld, oder die Einheit direkt dorthin ziehen. Neu ausgespielte Einheiten lassen sich genauso umstellen.",
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
