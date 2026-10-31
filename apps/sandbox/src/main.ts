/**
 * Oberfläche der Kampf-Sandbox (D1). Nur Darstellung und Bedienung; die Logik steckt in `sandbox.ts`
 * und in der Engine.
 */
import { type CombatEvent, type Fighter, type GameData, loadGameData, type OffsetCoord } from "@game/engine";
import {
  type CatalogEntry,
  decodeSetup,
  encodeSetup,
  finishSandbox,
  isFinished,
  placeUnit,
  removeUnit,
  sandboxArenaSize,
  sandboxCatalog,
  sandboxOutcome,
  type SandboxRun,
  type SandboxUnit,
  sideOfCell,
  type Stars,
  startSandbox,
  stepSandbox,
  unitAt,
} from "./sandbox";

const SVG_NS = "http://www.w3.org/2000/svg";
const HEX_R = 30;
const SQRT3 = Math.sqrt(3);
const SIDE_NAMES = ["Seite A", "Seite B"] as const;
const SIDE_CLASS = ["side-a", "side-b"] as const;
/** Ticks pro Sekunde bei 1× (ein Tick ≈ 0,1 s, vgl. Standard-Angriffsintervall 10). */
const BASE_TICKS_PER_SECOND = 10;

const EXAMPLE = "l.brann.1.2.1~c.shieldwall_veteran.1.1.2~c.recruit.2.3.2~c.ranger.1.0.0~c.apprentice.1.4.0~l.vex.1.2.4~c.blade_dancer.1.1.3~c.mercenary.1.3.3~c.thunder_gun.1.0.5~c.pickpocket.1.4.4";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

/** Mittelpunkt eines Felds (Spitze oben, versetzte Zeilen „odd-r“). */
function cellCenter(c: OffsetCoord): { x: number; y: number } {
  return {
    x: HEX_R * SQRT3 * (c.col + 0.5 * (c.row & 1)) + (HEX_R * SQRT3) / 2,
    y: HEX_R * 1.5 * c.row + HEX_R,
  };
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function abbreviation(name: string): string {
  const words = name.replace(/^(Hauptmann|Champion der)\s+/, "").split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]!.slice(0, 1) + words[1]!.slice(0, 2)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

function starText(stars: number): string {
  return "★".repeat(stars);
}

class SandboxApp {
  private readonly data: GameData;
  private readonly catalog: CatalogEntry[];
  private readonly catalogById = new Map<string, CatalogEntry>();
  private units: SandboxUnit[] = [];
  private selected: CatalogEntry;
  private stars: Stars = 1;
  private mode: "place" | "remove" = "place";
  private run: SandboxRun | null = null;
  private timer: number | null = null;
  private speed = 0.5;
  private shownEvents = 0;
  private readonly cellEls = new Map<string, SVGPolygonElement>();
  private readonly unitLayer: SVGGElement;
  private readonly fxLayer: SVGGElement;

  constructor() {
    this.data = loadGameData();
    this.catalog = sandboxCatalog(this.data);
    for (const e of this.catalog) this.catalogById.set(`${e.kind}:${e.sourceId}`, e);
    this.selected = this.catalog.find((e) => e.sourceId === "recruit") ?? this.catalog[0]!;
    const arena = byId<HTMLElement>("arena");
    const size = sandboxArenaSize(this.data);
    const width = HEX_R * SQRT3 * (size.cols + 0.5);
    const height = HEX_R * (1.5 * (size.rows - 1) + 2);
    const root = svg("svg", { viewBox: `0 0 ${width.toFixed(1)} ${height.toFixed(1)}`, role: "img", "aria-label": "Frontarena" });
    const cells = svg("g");
    for (let row = 0; row < size.rows; row++) {
      for (let col = 0; col < size.cols; col++) {
        const c = { col, row };
        const { x, y } = cellCenter(c);
        const poly = svg("polygon", { points: hexPoints(x, y, HEX_R - 1.5), class: `cell ${SIDE_CLASS[sideOfCell(this.data, c)]}` });
        poly.addEventListener("click", () => this.onCell(c));
        cells.append(poly);
        this.cellEls.set(`${col},${row}`, poly);
      }
    }
    this.unitLayer = svg("g", { class: "units" });
    this.fxLayer = svg("g", { class: "fx" });
    root.append(cells, this.unitLayer, this.fxLayer);
    arena.append(root);

    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    this.units = decodeSetup(this.data, hash || EXAMPLE);
    this.buildPalette();
    this.bindControls();
    this.render();
  }

  // ------------------------------------------------------------------ Aufstellung

  private buildPalette(): void {
    const select = byId<HTMLSelectElement>("unit-select");
    const groups: Record<CatalogEntry["kind"], HTMLOptGroupElement> = {
      leader: el("optgroup", { label: "Anführer" }),
      card: el("optgroup", { label: "Einheiten" }),
      token: el("optgroup", { label: "Tokens" }),
    };
    for (const e of this.catalog) {
      const label = e.kind === "card" ? `${e.name} (${e.cost} Gold)` : e.name;
      const opt = el("option", { value: `${e.kind}:${e.sourceId}` }, label);
      groups[e.kind].append(opt);
    }
    select.append(groups.leader, groups.card, groups.token);
    select.value = `${this.selected.kind}:${this.selected.sourceId}`;
    select.addEventListener("change", () => {
      const e = this.catalogById.get(select.value);
      if (e) this.selected = e;
      this.setMode("place");
      this.renderInfo();
    });
    for (const s of [1, 2, 3] as const) {
      byId<HTMLButtonElement>(`star-${s}`).addEventListener("click", () => {
        this.stars = s;
        this.setMode("place");
        this.renderInfo();
      });
    }
  }

  private bindControls(): void {
    byId("mode-place").addEventListener("click", () => this.setMode("place"));
    byId("mode-remove").addEventListener("click", () => this.setMode("remove"));
    byId("btn-clear").addEventListener("click", () => {
      this.units = [];
      this.changed();
    });
    byId("btn-example").addEventListener("click", () => {
      this.units = decodeSetup(this.data, EXAMPLE);
      this.changed();
    });
    byId("btn-mirror").addEventListener("click", () => this.mirror());
    byId("btn-share").addEventListener("click", () => void this.share());
    byId("btn-start").addEventListener("click", () => this.start());
    byId("btn-back").addEventListener("click", () => this.backToSetup());
    byId("btn-restart").addEventListener("click", () => this.start());
    byId("btn-step").addEventListener("click", () => {
      this.pause();
      this.step(1);
    });
    byId("btn-step10").addEventListener("click", () => {
      this.pause();
      this.step(10);
    });
    byId("btn-play").addEventListener("click", () => (this.timer === null ? this.play() : this.pause()));
    byId("btn-end").addEventListener("click", () => {
      this.pause();
      if (this.run) finishSandbox(this.run);
      this.render();
    });
    const speed = byId<HTMLSelectElement>("speed");
    speed.addEventListener("change", () => {
      this.speed = Number(speed.value) || 1;
      if (this.timer !== null) {
        this.pause();
        this.play();
      }
    });
    byId<HTMLInputElement>("round").addEventListener("input", () => this.renderResult());
  }

  private setMode(mode: "place" | "remove"): void {
    this.mode = mode;
    this.renderInfo();
  }

  private onCell(c: OffsetCoord): void {
    if (this.run) return;
    if (this.mode === "remove") {
      this.units = removeUnit(this.units, c);
      this.changed();
      return;
    }
    const existing = unitAt(this.units, c);
    if (existing && existing.kind === this.selected.kind && existing.sourceId === this.selected.sourceId && existing.stars === this.stars) {
      // Gleiche Einheit noch einmal antippen entfernt sie.
      this.units = removeUnit(this.units, c);
      this.changed();
      return;
    }
    const next = placeUnit(this.data, this.units, { kind: this.selected.kind, sourceId: this.selected.sourceId, stars: this.stars, pos: c });
    if (!next) {
      this.flash(`Nur ein Anführer pro Seite.`);
      return;
    }
    this.units = next;
    this.changed();
  }

  /** Spiegelt die Aufstellung von Seite A auf Seite B (R-3.2: 180° gedreht). */
  private mirror(): void {
    const size = sandboxArenaSize(this.data);
    const sideA = this.units.filter((u) => sideOfCell(this.data, u.pos) === 0);
    let list: SandboxUnit[] = [...sideA];
    for (const u of sideA) {
      const pos = { col: size.cols - 1 - u.pos.col, row: size.rows - 1 - u.pos.row };
      list = placeUnit(this.data, list, { ...u, pos }) ?? list;
    }
    this.units = list;
    this.changed();
  }

  private async share(): Promise<void> {
    const url = `${location.href.split("#")[0]}#${encodeSetup(this.units)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.flash("Link kopiert.");
    } catch {
      window.prompt("Link zum Teilen:", url);
    }
  }

  private changed(): void {
    try {
      history.replaceState(null, "", `#${encodeSetup(this.units)}`);
    } catch {
      // ohne Verlauf (z. B. lokale Datei in manchen Browsern) einfach weiter
    }
    this.render();
  }

  private flash(text: string): void {
    const box = byId("flash");
    box.textContent = text;
    box.classList.add("show");
    window.setTimeout(() => box.classList.remove("show"), 1800);
  }

  // ------------------------------------------------------------------ Kampf

  private start(): void {
    this.pause();
    this.run = startSandbox(this.data, this.units);
    this.shownEvents = 0;
    byId("log").replaceChildren();
    this.render();
  }

  private backToSetup(): void {
    this.pause();
    this.run = null;
    this.render();
  }

  private step(n: number): void {
    if (!this.run) return;
    for (let i = 0; i < n; i++) {
      if (!stepSandbox(this.run)) break;
    }
    this.render();
  }

  private play(): void {
    if (!this.run || isFinished(this.run)) return;
    const ticksPerSecond = BASE_TICKS_PER_SECOND * this.speed;
    const interval = Math.max(16, 1000 / ticksPerSecond);
    const perFrame = Math.max(1, Math.round(ticksPerSecond / (1000 / interval)));
    this.timer = window.setInterval(() => {
      this.step(perFrame);
      if (!this.run || isFinished(this.run)) this.pause();
    }, interval);
    this.renderControls();
  }

  private pause(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.renderControls();
  }

  // ------------------------------------------------------------------ Darstellung

  private entryFor(kind: string, sourceId: string): CatalogEntry | undefined {
    return this.catalogById.get(`${kind}:${sourceId}`) ?? this.catalog.find((e) => e.sourceId === sourceId);
  }

  private render(): void {
    document.body.classList.toggle("fighting", this.run !== null);
    this.renderUnits();
    this.renderInfo();
    this.renderControls();
    this.renderFighters();
    this.renderLog();
    this.renderResult();
  }

  private renderInfo(): void {
    const e = this.selected;
    const isLeader = e.kind === "leader";
    for (const s of [1, 2, 3] as const) {
      const b = byId<HTMLButtonElement>(`star-${s}`);
      b.classList.toggle("active", s === this.stars && !isLeader);
      b.disabled = isLeader;
    }
    byId("mode-place").classList.toggle("active", this.mode === "place");
    byId("mode-remove").classList.toggle("active", this.mode === "remove");
    const stars = isLeader ? 1 : this.stars;
    const f = startSandbox(this.data, [{ kind: e.kind, sourceId: e.sourceId, stars, pos: { col: 0, row: 0 } }]).fighters[0];
    const st = f?.stats ?? e.stats;
    const parts = [
      `${e.className}${e.raceName ? ` · ${e.raceName}` : ""}`,
      `Angriff ${st.attack}`,
      `Leben ${st.hp}`,
      `Reichweite ${st.range}`,
      `Durchbruch ${st.breakthrough}`,
    ];
    if (st.armor) parts.push(`Panzer ${st.armor}`);
    if (e.hasAbility) parts.push("Fähigkeit wirkt noch nicht");
    byId("unit-info").textContent = parts.join(" · ");
    const a = this.units.filter((u) => sideOfCell(this.data, u.pos) === 0).length;
    const b = this.units.length - a;
    byId("counts").textContent = `Seite A: ${a} Einheiten · Seite B: ${b} Einheiten`;
  }

  /** Aufstellung (vor dem Kampf) oder aktueller Kampfstand. */
  private renderUnits(): void {
    for (const [key, poly] of this.cellEls) {
      const [col, row] = key.split(",").map(Number);
      const occupied = !this.run && unitAt(this.units, { col: col!, row: row! }) !== undefined;
      poly.classList.toggle("occupied", occupied);
    }
    const shown: { key: string; team: number; pos: OffsetCoord; label: string; stars: number; hp: number; maxHp: number; mana: number | null; alive: boolean; stunned: boolean; leader: boolean }[] = [];
    if (!this.run) {
      this.units.forEach((u) => {
        const e = this.entryFor(u.kind, u.sourceId);
        const f = startSandbox(this.data, [u]).fighters[0];
        const hp = f?.stats.hp ?? 0;
        shown.push({ key: `s${u.pos.col},${u.pos.row}`, team: sideOfCell(this.data, u.pos), pos: u.pos, label: abbreviation(e?.name ?? u.sourceId), stars: u.stars, hp, maxHp: hp, mana: null, alive: true, stunned: false, leader: u.kind === "leader" });
      });
    } else {
      const starsById = new Map(this.units.map((u, i) => [i + 1, u.kind === "leader" ? 1 : u.stars]));
      for (const f of this.run.sim.fighters) {
        const e = this.entryFor(f.id <= this.units.length ? this.units[f.id - 1]!.kind : "card", f.sourceId);
        shown.push({ key: `f${f.id}`, team: f.team, pos: f.pos, label: abbreviation(e?.name ?? f.sourceId), stars: starsById.get(f.id) ?? 1, hp: f.hp, maxHp: f.maxHp, mana: f.hasManaAbility ? f.mana / f.manaMax : null, alive: f.alive, stunned: f.stun > 0, leader: e?.kind === "leader" });
      }
    }
    const existing = new Map<string, SVGGElement>();
    for (const child of Array.from(this.unitLayer.children)) {
      const key = child.getAttribute("data-key");
      if (key) existing.set(key, child as SVGGElement);
    }
    const keep = new Set<string>();
    for (const s of shown) {
      keep.add(s.key);
      let g = existing.get(s.key);
      if (!g) {
        g = svg("g", { "data-key": s.key });
        g.append(
          svg("circle", { r: HEX_R * 0.62, class: "body" }),
          svg("text", { y: -2, class: "label" }),
          svg("text", { y: 11, class: "stars" }),
          svg("rect", { x: -HEX_R * 0.6, y: HEX_R * 0.7, width: HEX_R * 1.2, height: 4, class: "hp-bg" }),
          svg("rect", { x: -HEX_R * 0.6, y: HEX_R * 0.7, width: HEX_R * 1.2, height: 4, class: "hp" }),
          svg("rect", { x: -HEX_R * 0.6, y: HEX_R * 0.7 + 5, width: 0, height: 3, class: "mana" }),
        );
        this.unitLayer.append(g);
      }
      const { x, y } = cellCenter(s.pos);
      g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      g.setAttribute("class", `unit ${SIDE_CLASS[s.team] ?? ""}${s.alive ? "" : " dead"}${s.stunned ? " stunned" : ""}${s.leader ? " leader" : ""}`);
      const [, label, stars, , hp, mana] = Array.from(g.children);
      label!.textContent = s.label;
      stars!.textContent = s.leader ? "♛" : starText(s.stars);
      hp!.setAttribute("width", ((HEX_R * 1.2 * Math.max(0, s.hp)) / Math.max(1, s.maxHp)).toFixed(1));
      mana!.setAttribute("width", s.mana === null ? "0" : (HEX_R * 1.2 * s.mana).toFixed(1));
      // Klick auf eine Einheit soll beim Aufstellen das richtige Feld treffen.
      g.onclick = () => this.onCell(s.pos);
    }
    for (const [key, g] of existing) if (!keep.has(key)) g.remove();
    this.renderEffects();
  }

  /** Angriffslinien und Schadenszahlen des letzten Ticks. */
  private renderEffects(): void {
    this.fxLayer.replaceChildren();
    if (!this.run) return;
    const sim = this.run.sim;
    const recent = sim.events.filter((e) => e.tick === sim.tick && sim.tick > 0);
    const pos = (id: number): OffsetCoord | undefined => sim.fighters.find((f) => f.id === id)?.pos;
    for (const e of recent) {
      if (e.type === "combat_attack") {
        const a = pos(e.unit);
        const b = pos(e.target);
        if (!a || !b) continue;
        const p = cellCenter(a);
        const q = cellCenter(b);
        const team = sim.fighters.find((f) => f.id === e.unit)?.team ?? 0;
        this.fxLayer.append(svg("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: `attack ${SIDE_CLASS[team] ?? ""}` }));
      }
    }
    for (const e of recent) {
      if (e.type === "combat_damage") {
        const t = pos(e.target);
        if (!t) continue;
        const q = cellCenter(t);
        const text = svg("text", { x: q.x + HEX_R * 0.45, y: q.y - HEX_R * 0.55, class: "dmg" });
        text.textContent = e.hpLoss > 0 ? `−${e.hpLoss}` : "0";
        this.fxLayer.append(text);
      }
    }
  }

  private renderControls(): void {
    const run = this.run;
    const finished = run ? isFinished(run) : false;
    byId("tick").textContent = run ? `Tick ${run.sim.tick} / ${this.data.config.combat.maxTicks}` : "";
    byId<HTMLButtonElement>("btn-play").textContent = this.timer === null ? "▶ Abspielen" : "⏸ Pause";
    for (const id of ["btn-play", "btn-step", "btn-step10", "btn-end"]) byId<HTMLButtonElement>(id).disabled = finished;
    byId<HTMLButtonElement>("btn-start").disabled = false;
  }

  private nameOf(id: number | null): string {
    if (id === null || !this.run) return "–";
    const f = this.run.sim.fighters.find((x) => x.id === id);
    if (!f) return `#${id}`;
    const u = this.units[id - 1];
    const e = this.entryFor(u?.kind ?? "card", f.sourceId);
    const stars = u && u.kind !== "leader" && u.stars > 1 ? ` ${starText(u.stars)}` : "";
    return `${e?.name ?? f.sourceId}${stars} (${f.team === 0 ? "A" : "B"}${id})`;
  }

  private describe(e: CombatEvent): string | null {
    const n = (id: number | null): string => this.nameOf(id);
    switch (e.type) {
      case "combat_unit_jumped":
        return `${n(e.unit)} springt hinter ${n(e.target)}`;
      case "combat_target_changed":
        return `${n(e.unit)} nimmt ${n(e.target)} ins Ziel`;
      case "combat_unit_moved":
        return null;
      case "combat_attack":
        return `${n(e.unit)} greift ${n(e.target)} an`;
      case "combat_ability":
        return `${n(e.unit)} wirkt seine Fähigkeit (noch ohne Wirkung)`;
      case "combat_damage": {
        const extra = e.absorbed > 0 ? `, ${e.absorbed} abgefangen` : "";
        return `  → ${n(e.target)} verliert ${e.hpLoss} Leben${extra} (noch ${Math.max(0, e.hp)})`;
      }
      case "combat_unit_stunned":
        return `${n(e.unit)} ist ${e.ticks} Ticks betäubt`;
      case "combat_unit_died":
        return `✖ ${n(e.unit)} stirbt`;
      case "combat_ended":
        return `Kampfende: ${e.winner === null ? "Unentschieden" : `${SIDE_NAMES[e.winner as 0 | 1]} gewinnt`}`;
    }
  }

  private renderLog(): void {
    const log = byId("log");
    if (!this.run) return;
    const events = this.run.sim.events;
    const frag = document.createDocumentFragment();
    let lastTick = -1;
    for (let i = this.shownEvents; i < events.length; i++) {
      const e = events[i]!;
      const text = this.describe(e);
      if (text === null) continue;
      if (e.tick !== lastTick) {
        lastTick = e.tick;
        frag.append(el("div", { class: "log-tick" }, `Tick ${e.tick}`));
      }
      frag.append(el("div", { class: e.type === "combat_unit_died" ? "log-death" : "" }, text));
    }
    this.shownEvents = events.length;
    log.append(frag);
    // Nur die letzten Einträge behalten, damit es am Handy flüssig bleibt.
    while (log.childElementCount > 400) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
  }

  private renderFighters(): void {
    const table = byId("fighters");
    table.replaceChildren();
    if (!this.run) return;
    const head = el("tr");
    for (const h of ["", "Einheit", "Leben", "Mana", "Ziel"]) head.append(el("th", {}, h));
    table.append(head);
    const fighters: Fighter[] = [...this.run.sim.fighters].sort((a, b) => a.team - b.team || a.id - b.id);
    for (const f of fighters) {
      const tr = el("tr", { class: `${SIDE_CLASS[f.team] ?? ""}${f.alive ? "" : " dead"}` });
      tr.append(
        el("td", {}, f.team === 0 ? "A" : "B"),
        el("td", {}, this.nameOf(f.id).replace(/ \([AB]\d+\)$/, "")),
        el("td", {}, f.alive ? `${f.hp}/${f.maxHp}${f.shield > 0 ? ` +${f.shield}` : ""}` : "tot"),
        el("td", {}, f.hasManaAbility ? `${f.mana}/${f.manaMax}` : "–"),
        el("td", {}, f.alive && f.targetId !== null ? this.nameOf(f.targetId).replace(/ \([AB]\d+\)$/, "") : "–"),
      );
      table.append(tr);
    }
  }

  private renderResult(): void {
    const box = byId("result");
    if (!this.run || !isFinished(this.run)) {
      box.replaceChildren();
      box.hidden = true;
      return;
    }
    const round = Math.max(1, Math.min(this.data.config.maxRounds, Number(byId<HTMLInputElement>("round").value) || 1));
    const o = sandboxOutcome(this.data, this.run, round);
    box.hidden = false;
    const lines: string[] = [];
    if (o.kind === "noFight") {
      lines.push("Keine Einheiten aufgestellt: kein Kampf, kein Schaden.");
    } else if (o.winner === null) {
      lines.push(`Unentschieden nach ${o.ticks} Ticks: kein Schaden.`);
    } else {
      const loser = SIDE_NAMES[o.winner === 0 ? 1 : 0];
      const how = o.kind === "emptyFront" ? "kampflos (leere Front)" : `nach ${o.ticks} Ticks`;
      lines.push(`${SIDE_NAMES[o.winner]} gewinnt ${how}.`);
      lines.push(`Überlebende: ${o.survivors.length}.`);
      lines.push(`Durchbruch ${o.breakthrough} + Grundschaden ${o.baseDamage} = ${loser} verliert ${o.damage} Leben.`);
      if (o.loot > 0) lines.push(`Beute für ${SIDE_NAMES[o.winner]}: ${o.loot} Gold.`);
    }
    box.replaceChildren(...lines.map((l, i) => el(i === 0 ? "strong" : "div", {}, l)));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    new SandboxApp();
  } catch (err) {
    const box = document.getElementById("error");
    if (box) {
      box.hidden = false;
      box.textContent = `Fehler beim Start: ${err instanceof Error ? err.message : String(err)}`;
    }
    throw err;
  }
});
