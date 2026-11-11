/**
 * `GreedyBot` (E14b): einfache Heuristik auf Basis des Planungsentwurfs (`PlanningDraft`). Jede Aktion wird
 * über `draft.attempt` geprüft, abgelehnte Versuche verändern nichts; der Bot baut also keine Regeln nach.
 *
 * - `play`: verwundete Einheiten genesen, Einheiten der Hand (stärkste zuerst) auf das Brett – in die Front mit
 *   dem größten Rückstand, in die Mitte, wenn das Brett stark genug ist –, danach Zauber: Schaden und
 *   Verwunden auf das Feld mit den meisten Gegnern, Schutz auf die stärkste eigene Einheit.
 * - `buy`: die teuerste bezahlbare Karte (bei gleichen Kosten Einheit vor Ressource vor Zauber, solange das Deck
 *   genug Zauber hat, sonst Zauber zuerst), danach nur noch Karten ab `minExtraBuyCost`.
 * - `position`: gesunde Einheiten aus der Reserve aufs Brett, Verwundete (ohne Gold zum Genesen) in die
 *   Reserve, die Mitte besetzen, wenn eine Front Überschuss hat, Anführer-Fähigkeit nach Kategorie.
 *
 * Der Bot nutzt nur öffentliche Informationen und die eigenen Karten (R-18). Zufall nur über den eigenen Seed.
 */
import { PLANNING_SECTIONS, type ActionTarget, type ArenaHex, type ArenaRef, type Planning, type PlanningAction } from "../actions";
import type { CardData, GameData } from "../data";
import type { Effect, SpellCard, UnitCard } from "../dataTypes";
import { neighbors } from "../hex";
import { leaderAbilityParams } from "../leader";
import { createRngState, type RngState } from "../rng";
import { PlanningDraft } from "../round";
import { neighborsOf } from "../seating";
import {
  getCard,
  getPlayer,
  type CardInstanceId,
  type FrontZoneName,
  type GameState,
  type PlayerIndex,
  type Unit,
  type UnitLocation,
} from "../state";
import { ARENA_REFS, arenaSize, globalHexKey, locationArenaHex, unitArenaHex } from "../targets";
import type { Bot } from "./bot";
import { allArenaHexes, targetCandidates } from "./candidates";

export interface GreedyBotOptions {
  /** Nach dem ersten Kauf einer Runde werden nur noch Karten mit mindestens diesen Kosten gekauft. */
  minExtraBuyCost?: number;
  /** Lebenspunkte, ab denen der Bot Blutzoll (R-14.6) zahlt. */
  minLifeForBloodToll?: number;
  /** Ziel-Anteil Zauber im Deck: höchstens ein Zauber je so viele Karten; darunter gewinnt ein Zauber bei gleichen Kosten. */
  cardsPerSpell?: number;
}

/** Bevorzugte Spalten einer Zeile: Mitte zuerst. */
const COLUMN_ORDER = [2, 1, 3, 0, 4];
/** Bevorzugte Mittelpositionen (R-3.4): Mitte zuerst. */
const CENTER_ORDER = [2, 1, 3, 0, 4];
const FRONT_ZONES: readonly FrontZoneName[] = ["left", "right"];

const TYPE_RANK: Record<CardData["type"], number> = { unit: 0, resource: 1, spell: 2, curse: 3 };

export class GreedyBot implements Bot {
  readonly name = "greedy";
  private readonly rng: RngState;
  private readonly minExtraBuyCost: number;
  private readonly minLifeForBloodToll: number;
  private readonly cardsPerSpell: number;

  constructor(seed: number, options: GreedyBotOptions = {}) {
    this.rng = createRngState(seed);
    this.minExtraBuyCost = options.minExtraBuyCost ?? 3;
    this.minLifeForBloodToll = options.minLifeForBloodToll ?? 15;
    this.cardsPerSpell = options.cardsPerSpell ?? 8;
  }

  plan(state: GameState, data: GameData, player: PlayerIndex): Planning {
    const draft = new PlanningDraft(state, data, player);
    for (const section of PLANNING_SECTIONS) {
      draft.enter(section);
      if (section === "play") this.planPlay(draft, data);
      else if (section === "buy") this.planBuy(draft, data);
      else this.planPosition(draft, data);
    }
    return draft.planning;
  }

  // ---------------------------------------------------------------- play

  private planPlay(draft: PlanningDraft, data: GameData): void {
    for (const u of initialOwnUnits(draft)) {
      if (u.wounded && u.location.zone !== "reserve") draft.attempt({ type: "heal", unitId: u.id });
    }
    const hand = getPlayer(draft.state, draft.player).hand;
    const units = unitCards(draft.state, data, hand).sort((a, b) => cardStrength(b.card) - cardStrength(a.card));
    for (const { id, card } of units) this.playUnitCard(draft, data, id, card);
    const spells = spellCards(draft.state, data, getPlayer(draft.state, draft.player).hand).sort(
      (a, b) => b.card.cost - a.card.cost || a.id - b.id,
    );
    for (const { id, card } of spells) this.setSpell(draft, data, id, card);
  }

  private playUnitCard(draft: PlanningDraft, data: GameData, cardInstanceId: CardInstanceId, card: UnitCard): void {
    const locations = this.placementOrder(draft, data, card);
    const variants: Omit<Extract<PlanningAction, { type: "playUnit" }>, "to">[] = [{ type: "playUnit", cardInstanceId }];
    const alt = card.altCost;
    if (alt) {
      const life = getPlayer(draft.state, draft.player).life;
      const sacrificeCount = alt.sacrifice ?? 0;
      const bloodOk = (alt.bloodToll ?? 0) === 0 || life >= this.minLifeForBloodToll;
      if (bloodOk && sacrificeCount === 0) variants.push({ type: "playUnit", cardInstanceId, useAltCost: true });
      if (bloodOk && sacrificeCount > 0) {
        const cheap = initialOwnUnits(draft)
          .filter((u) => u.kind === "card" && unitStrength(draft.state, data, u) * 2 < cardStrength(card))
          .sort((a, b) => unitStrength(draft.state, data, a) - unitStrength(draft.state, data, b) || a.id - b.id);
        if (cheap.length >= sacrificeCount) {
          const sacrifice = cheap.slice(0, sacrificeCount).map((u) => u.id);
          variants.push({ type: "playUnit", cardInstanceId, useAltCost: true, sacrifice });
        }
      }
    }
    for (const variant of variants) {
      for (const to of locations) {
        if (draft.attempt({ ...variant, to }) === null) return;
      }
    }
  }

  /**
   * Orte für eine neue Einheit, beste zuerst: Mitte, wenn das Brett stark genug ist, sonst die Front mit dem
   * größten Rückstand; Nahkämpfer vorne (Zeile 2 grenzt an den Gegner, R-3.2), Fernkämpfer hinten. Die Reserve
   * nur, wenn dort oder auf dem Brett schon eine gleiche Karte liegt (Verschmelzen, R-7.8).
   */
  private placementOrder(draft: PlanningDraft, data: GameData, card: UnitCard): UnitLocation[] {
    const fronts = frontBalance(draft, data);
    const zonesByNeed = [...fronts].sort((a, b) => b.enemy - b.own - (a.enemy - a.own) || a.own - b.own).map((f) => f.zone);
    const result: UnitLocation[] = [];
    const center = centerLocations(data);
    if (boardStrongEnough(draft, data)) result.push(...center);
    const ranged = card.stats.range > 1;
    for (const zone of zonesByNeed) result.push(...frontCells(data, zone, ranged));
    if (!boardStrongEnough(draft, data)) result.push(...center);
    const sameCard = initialOwnUnits(draft).some((u) => u.kind === "card" && u.sourceId === card.id);
    if (sameCard) for (let slot = 0; slot < data.config.reserveSlots; slot++) result.push({ zone: "reserve", slot });
    return result;
  }

  private setSpell(draft: PlanningDraft, data: GameData, cardInstanceId: CardInstanceId, card: SpellCard): void {
    for (const target of this.spellTargets(draft, data, card)) {
      if (draft.attempt({ type: "setSpell", cardInstanceId, slot: card.slot, target }) === null) return;
    }
  }

  private spellTargets(draft: PlanningDraft, data: GameData, card: SpellCard): ActionTarget[] {
    const spec = card.target;
    const effects = card.effects;
    switch (spec.kind) {
      case "none":
        return [{ kind: "none" }];
      case "hex":
        return hexTargets(draft, data, effects);
      case "zone":
        return zoneTargets(draft, data, effects, 1);
      case "player":
        return opponentsByThreat(draft).map((p): ActionTarget => ({ kind: "player", player: p }));
      case "ownCards": {
        // Läutern o. Ä.: nur Flüche entfernen (R-14.8); ohne Flüche lohnt der Zauber nicht.
        const p = getPlayer(draft.state, draft.player);
        const curses = spec.from
          .flatMap((zone) => p[zone])
          .filter((id) => data.cards.get(getCard(draft.state, id).cardId)?.type === "curse")
          .slice(0, spec.max);
        return curses.length > 0 ? [{ kind: "ownCards", cardInstanceIds: curses }] : [];
      }
      case "moveUnits":
        return [];
    }
  }

  // ---------------------------------------------------------------- buy

  private planBuy(draft: PlanningDraft, data: GameData): void {
    const p = getPlayer(draft.state, draft.player);
    const owned = [...p.deck, ...p.hand, ...p.played, ...p.discard].map((id) => data.cards.get(getCard(draft.state, id).cardId));
    const hasCurses = owned.some((c) => c?.type === "curse");
    // Grobe Quote: gelegte Zauber und Karten in Einheiten zählen nicht mit.
    const spellCount = owned.filter((c) => c?.type === "spell").length;
    const wantSpell = spellCount < Math.floor(owned.length / this.cardsPerSpell);
    const rank = (c: CardData): number => (c.type === "spell" && wantSpell ? -1 : TYPE_RANK[c.type]);
    const ids = [...Object.keys(draft.state.supply), ...Object.keys(p.classPool)]
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => data.cards.get(id))
      .filter((c): c is CardData => c !== undefined && c.type !== "curse" && c.buyable !== false)
      .filter((c) => c.type !== "spell" || c.target.kind !== "ownCards" || hasCurses)
      .sort((a, b) => b.cost - a.cost || rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
    let bought = 0;
    for (;;) {
      const minCost = bought === 0 ? 1 : this.minExtraBuyCost;
      const card = ids.find((c) => c.cost >= minCost && draft.attempt({ type: "buy", cardId: c.id }) === null);
      if (!card) return;
      bought += 1;
    }
  }

  // ---------------------------------------------------------------- position

  private planPosition(draft: PlanningDraft, data: GameData): void {
    for (const u of initialOwnUnits(draft)) {
      if (u.kind === "token") continue;
      if (u.location.zone === "reserve" && !u.wounded) {
        const card = u.kind === "card" ? data.cards.get(u.sourceId) : undefined;
        const ranged = card?.type === "unit" && card.stats.range > 1;
        const zones = [...frontBalance(draft, data)].sort((a, b) => b.enemy - b.own - (a.enemy - a.own)).map((f) => f.zone);
        const targets = zones.flatMap((z) => frontCells(data, z, ranged));
        targets.some((to) => draft.attempt({ type: "moveUnit", unitId: u.id, to }) === null);
      } else if (u.location.zone !== "reserve" && u.wounded && u.kind === "card") {
        for (let slot = 0; slot < data.config.reserveSlots; slot++) {
          if (draft.attempt({ type: "moveUnit", unitId: u.id, to: { zone: "reserve", slot } }) === null) break;
        }
      }
    }
    this.occupyCenter(draft, data);
    this.setLeaderAbility(draft, data);
  }

  /** Mitte besetzen (R-10.4), wenn das Brett stark genug ist: eine Einheit aus der Front mit dem größten Überschuss. */
  private occupyCenter(draft: PlanningDraft, data: GameData): void {
    const own = currentOwnUnits(draft);
    if (own.some((u) => u.location.zone === "center" && !u.wounded)) return;
    if (!boardStrongEnough(draft, data)) return;
    const fronts = frontBalance(draft, data).sort((a, b) => b.own - b.enemy - (a.own - a.enemy));
    const best = fronts[0];
    if (!best || best.own <= best.enemy) return;
    const movable = own
      .filter((u) => u.location.zone === best.zone && u.kind === "card" && !u.wounded && draft.initialUnitIds.has(u.id))
      .filter((u) => best.own - unitStrength(draft.state, data, u) >= best.enemy)
      .sort((a, b) => unitStrength(draft.state, data, b) - unitStrength(draft.state, data, a) || a.id - b.id);
    for (const u of movable) {
      if (centerLocations(data).some((to) => draft.attempt({ type: "moveUnit", unitId: u.id, to }) === null)) return;
    }
  }

  private setLeaderAbility(draft: PlanningDraft, data: GameData): void {
    const p = getPlayer(draft.state, draft.player);
    if (p.leaderAbility !== null) return;
    const leader = data.leaders.get(p.leader.leaderId);
    if (!leader) return;
    const params = leaderAbilityParams(leader, p.leader.level, p.leader.branchId);
    const effects = params.effects;
    let targets: ActionTarget[];
    switch (leader.active.category) {
      case "damage":
        targets = hexTargets(draft, data, effects);
        break;
      case "buff":
        targets = zoneTargets(draft, data, effects, params.limits.zones ?? 1);
        break;
      case "summon":
        targets = summonHexTargets(draft, data);
        break;
      case "move":
        targets = shadowStepTargets(draft, data);
        break;
      default:
        targets = targetCandidates(draft, data, params.target, this.rng);
    }
    targets.some((target) => draft.attempt({ type: "setLeaderAbility", target }) === null);
  }
}

// ------------------------------------------------------------------ Bewertung

/** Grobe Kampfstärke aus Angriff und Leben (ohne Fähigkeiten). */
function statStrength(attack: number, hp: number, armor: number): number {
  return attack * 2 + hp + armor * 2;
}

function cardStrength(card: UnitCard): number {
  const s = card.stats;
  return statStrength(s.attack, s.hp, s.armor ?? 0) + card.cost;
}

function unitStrength(state: GameState, data: GameData, unit: Unit): number {
  const mult = data.config.starMultiplier[String(unit.stars) as "1" | "2" | "3"] ?? 1;
  if (unit.kind === "leader") {
    const leader = data.leaders.get(unit.sourceId);
    const s = leader?.stats;
    const level = getPlayer(state, unit.owner).leader.level;
    const bonus = level >= 3 ? 1 + data.config.leader.level3StatBonus : 1;
    return s ? statStrength(s.attack, s.hp, s.armor ?? 0) * bonus : 0;
  }
  const card = data.cards.get(unit.sourceId);
  if (card?.type !== "unit") return 0;
  const s = card.stats;
  const attack = unit.statOverride?.attack ?? s.attack;
  const hp = unit.statOverride?.hp ?? s.hp;
  return statStrength(attack, hp, s.armor ?? 0) * mult;
}

function fights(state: GameState, unit: Unit): boolean {
  return !unit.wounded && unit.location.zone !== "reserve" && !getPlayer(state, unit.owner).eliminated;
}

function initialOwnUnits(draft: PlanningDraft): Unit[] {
  return currentOwnUnits(draft).filter((u) => draft.initialUnitIds.has(u.id));
}

function currentOwnUnits(draft: PlanningDraft): Unit[] {
  return Object.values(draft.state.units)
    .filter((u) => u.owner === draft.player)
    .sort((a, b) => a.id - b.id);
}

function zoneStrength(state: GameState, data: GameData, player: PlayerIndex, zone: UnitLocation["zone"]): number {
  return Object.values(state.units)
    .filter((u) => u.owner === player && u.location.zone === zone && fights(state, u))
    .reduce((sum, u) => sum + unitStrength(state, data, u), 0);
}

interface FrontBalance {
  zone: FrontZoneName;
  own: number;
  enemy: number;
}

/** Eigene Stärke je Front gegen die Stärke der gegenüberliegenden Zone des Nachbarn (R-2.3). */
function frontBalance(draft: PlanningDraft, data: GameData): FrontBalance[] {
  const n = neighborsOf(draft.state, draft.player);
  return FRONT_ZONES.map((zone) => {
    const own = zoneStrength(draft.state, data, draft.player, zone);
    if (!n) return { zone, own, enemy: 0 };
    const enemy = zone === "right" ? zoneStrength(draft.state, data, n.right, "left") : zoneStrength(draft.state, data, n.left, "right");
    return { zone, own, enemy };
  });
}

/** Stark genug für die Mitte: beide Fronten mindestens gleichauf und die eigene Gesamtstärke über dem Schnitt der Gegner. */
function boardStrongEnough(draft: PlanningDraft, data: GameData): boolean {
  const { state, player } = draft;
  if (frontBalance(draft, data).some((f) => f.own < f.enemy || f.own === 0)) return false;
  const total = (p: PlayerIndex): number =>
    Object.values(state.units)
      .filter((u) => u.owner === p && fights(state, u))
      .reduce((sum, u) => sum + unitStrength(state, data, u), 0);
  const others = state.players.filter((p) => p.index !== player && !p.eliminated);
  if (others.length === 0) return true;
  const avg = others.reduce((sum, p) => sum + total(p.index), 0) / others.length;
  return total(player) > avg;
}

function opponentsByThreat(draft: PlanningDraft): PlayerIndex[] {
  return draft.state.players
    .filter((p) => p.index !== draft.player && !p.eliminated)
    .sort((a, b) => b.power - a.power || b.life - a.life || a.index - b.index)
    .map((p) => p.index);
}

function unitCards(state: GameState, data: GameData, ids: readonly CardInstanceId[]): { id: CardInstanceId; card: UnitCard }[] {
  const result: { id: CardInstanceId; card: UnitCard }[] = [];
  for (const id of ids) {
    const card = data.cards.get(getCard(state, id).cardId);
    if (card?.type === "unit") result.push({ id, card });
  }
  return result;
}

function spellCards(state: GameState, data: GameData, ids: readonly CardInstanceId[]): { id: CardInstanceId; card: SpellCard }[] {
  const result: { id: CardInstanceId; card: SpellCard }[] = [];
  for (const id of ids) {
    const card = data.cards.get(getCard(state, id).cardId);
    if (card?.type === "spell") result.push({ id, card });
  }
  return result;
}

// ------------------------------------------------------------------ Orte und Ziele

/** Felder einer eigenen Frontzone: Nahkämpfer ab Zeile 2 (vorne), Fernkämpfer ab Zeile 0 (hinten). */
function frontCells(data: GameData, zone: FrontZoneName, ranged: boolean): UnitLocation[] {
  const { rows, cols } = data.config.arenas.frontZone;
  const rowOrder = Array.from({ length: rows }, (_, i) => (ranged ? i : rows - 1 - i));
  const colOrder = [...COLUMN_ORDER.filter((c) => c < cols), ...Array.from({ length: cols }, (_, i) => i).filter((c) => !COLUMN_ORDER.includes(c))];
  return rowOrder.flatMap((row) => colOrder.map((col): UnitLocation => ({ zone, cell: { col, row } })));
}

function centerLocations(data: GameData): UnitLocation[] {
  const slots = data.config.arenas.centerStartSlots;
  const order = [...CENTER_ORDER.filter((p) => p < slots), ...Array.from({ length: slots }, (_, i) => i).filter((p) => !CENTER_ORDER.includes(p))];
  return order.map((position): UnitLocation => ({ zone: "center", position }));
}

/** Kämpfende Einheiten je Feld (spielerunabhängiger Schlüssel, R-8.2), getrennt nach eigen und gegnerisch. */
function hexOccupancy(draft: PlanningDraft, data: GameData): { enemy: Map<string, number>; own: Map<string, Unit> } {
  const enemy = new Map<string, number>();
  const own = new Map<string, Unit>();
  for (const u of Object.values(draft.state.units)) {
    if (!fights(draft.state, u)) continue;
    const hex = unitArenaHex(data.config, u);
    if (!hex) continue;
    const key = globalHexKey(draft.state, u.owner, hex);
    if (u.owner === draft.player) own.set(key, u);
    else enemy.set(key, (enemy.get(key) ?? 0) + 1);
  }
  return { enemy, own };
}

function hasOp(effects: readonly Effect[], ...ops: string[]): boolean {
  return effects.some((e) => ops.includes(e.op));
}

/**
 * Feldziele: Schaden, Verwunden und Vernichten auf das Feld mit den meisten Gegnern (Nachbarfelder zählen schwächer), nur
 * wenn dort ein Gegner steht; Schutz und Schlüsselwörter auf das Feld der stärksten eigenen Einheit.
 */
function hexTargets(draft: PlanningDraft, data: GameData, effects: readonly Effect[]): ActionTarget[] {
  const { enemy, own } = hexOccupancy(draft, data);
  const hexes = allArenaHexes(data.config);
  if (hasOp(effects, "damage", "wound", "destroy")) {
    const scored = hexes
      .map((hex) => {
        const size = arenaSize(data.config, hex.arena);
        const onHex = enemy.get(globalHexKey(draft.state, draft.player, hex)) ?? 0;
        const around = neighbors(hex.cell, size).reduce(
          (sum, cell) => sum + (enemy.get(globalHexKey(draft.state, draft.player, { arena: hex.arena, cell })) ?? 0),
          0,
        );
        return { hex, score: onHex * 10 + around };
      })
      .filter((s) => s.score >= 10)
      .sort((a, b) => b.score - a.score);
    return scored.map(({ hex }): ActionTarget => ({ kind: "hex", arena: hex.arena, cell: hex.cell }));
  }
  const allies = hexes
    .map((hex) => ({ hex, unit: own.get(globalHexKey(draft.state, draft.player, hex)) }))
    .filter((h): h is { hex: ArenaHex; unit: Unit } => h.unit !== undefined)
    .sort((a, b) => unitStrength(draft.state, data, b.unit) - unitStrength(draft.state, data, a.unit) || a.unit.id - b.unit.id);
  return allies.map(({ hex }): ActionTarget => ({ kind: "hex", arena: hex.arena, cell: hex.cell }));
}

/** Zonenziele: Beschwören in die Front mit dem größten Rückstand, Stärkungen in die Zonen mit den meisten eigenen Einheiten. */
function zoneTargets(draft: PlanningDraft, data: GameData, effects: readonly Effect[], maxZones: number): ActionTarget[] {
  if (hasOp(effects, "summon")) {
    const zones = frontBalance(draft, data)
      .sort((a, b) => b.enemy - b.own - (a.enemy - a.own))
      .map((f): ArenaRef => f.zone);
    return [...zones, "center" as ArenaRef].map((a): ActionTarget => ({ kind: "zone", arenas: [a] }));
  }
  const count = (a: ArenaRef): number =>
    currentOwnUnits(draft).filter((u) => u.location.zone === a && fights(draft.state, u)).length;
  const ranked = [...ARENA_REFS].filter((a) => count(a) > 0).sort((a, b) => count(b) - count(a));
  const result: ActionTarget[] = [];
  for (let n = Math.min(maxZones, ranked.length); n >= 1; n--) result.push({ kind: "zone", arenas: ranked.slice(0, n) });
  return result;
}

/** Morgra (R-16.6, `mustBeFree`): freies eigenes Feld vorne in der schwächeren Front. */
function summonHexTargets(draft: PlanningDraft, data: GameData): ActionTarget[] {
  const zones = frontBalance(draft, data)
    .sort((a, b) => b.enemy - b.own - (a.enemy - a.own))
    .map((f) => f.zone);
  const result: ActionTarget[] = [];
  for (const zone of zones) {
    for (const loc of frontCells(data, zone, false)) {
      const hex = locationArenaHex(data.config, draft.player, loc);
      if (hex) result.push({ kind: "hex", arena: hex.arena, cell: hex.cell });
    }
  }
  return result;
}

/** Vex (R-16.6): die stärkste eigene Nahkampf-Einheit einer Front hinter die gegnerischen Reihen setzen. */
function shadowStepTargets(draft: PlanningDraft, data: GameData): ActionTarget[] {
  const { rows, cols } = data.config.arenas.frontZone;
  const candidates = initialOwnUnits(draft)
    .filter((u) => u.kind !== "token" && fights(draft.state, u) && (u.location.zone === "left" || u.location.zone === "right"))
    .sort((a, b) => unitStrength(draft.state, data, b) - unitStrength(draft.state, data, a) || a.id - b.id);
  const result: ActionTarget[] = [];
  for (const u of candidates.slice(0, 2)) {
    const arena = u.location.zone as FrontZoneName;
    // Gegnerische Hälfte: in der rechten Arena die Zeilen ab `rows`, in der linken die Zeilen davor (R-3.2).
    const backRow = arena === "right" ? 2 * rows - 1 : 0;
    for (const col of COLUMN_ORDER.filter((c) => c < cols)) {
      result.push({ kind: "moveUnits", moves: [{ unitId: u.id, to: { arena, cell: { col, row: backRow } } }] });
    }
  }
  return result;
}
