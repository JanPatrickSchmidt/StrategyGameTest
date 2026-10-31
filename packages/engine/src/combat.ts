/**
 * Kampfsimulation (Spec R-9).
 *
 * Reine, deterministische Tick-Simulation für eine Arena. Sie kennt nur Kämpfer, Felder und die
 * Kampfwerte aus `config.json`; Anbindung an den Spielzustand (Paarungen, Teilnehmer, Ereignisprotokoll)
 * folgt mit E8b, Fähigkeiten-Effekte über die Haken (`CombatHooks`, gefüllt von `effects.ts`).
 *
 * Seiten heißen hier „Teams“ (Zahl, z. B. der Spieler-Index), damit dieselbe Simulation später auch die
 * Mittelarena mit bis zu vier Teams abdeckt.
 */

import type { ConfigData, GameData } from "./data";
import type { Ability, CombatBehavior, Keyword, Stat, UnitStats } from "./dataTypes";
import {
  compareRowCol,
  coordEquals,
  type GridSize,
  hexDistance,
  inBounds,
  neighbors,
  nextStepToward,
  type OffsetCoord,
} from "./hex";
import { unitStats } from "./merge";
import type { UnitId, UnitKind } from "./state";

/** Eingabe für einen Kämpfer: fertige Kampfwerte und Startfeld. */
export interface FighterInit {
  id: UnitId;
  team: number;
  /** Karten-ID bzw. Anführer-ID, nur zur Anzeige und für Effekte. */
  sourceId: string;
  behavior: CombatBehavior;
  pos: OffsetCoord;
  stats: UnitStats;
  keywords?: readonly Keyword[];
  /** Rasse (Karte bzw. Anführer), für Effekte wie `distinctOwnRaces`. */
  race?: string | null;
  /** Fähigkeiten aus den Daten; ausgewertet von den Haken (`effects.ts`). */
  abilities?: readonly Ability[];
  /** Hat die Einheit eine Fähigkeit mit Auslöser `onManaFull`? Nur dann sammelt sie Mana (R-9.2, R-9.5). */
  hasManaAbility: boolean;
  startMana?: number;
  shield?: number;
}

/** Zustand eines Kämpfers während der Simulation. */
export interface Fighter {
  readonly id: UnitId;
  readonly team: number;
  readonly sourceId: string;
  readonly behavior: CombatBehavior;
  pos: OffsetCoord;
  alive: boolean;
  attack: number;
  maxHp: number;
  hp: number;
  range: number;
  breakthrough: number;
  armor: number;
  attackInterval: number;
  moveInterval: number;
  hasManaAbility: boolean;
  manaMax: number;
  mana: number;
  shield: number;
  firstStrike: boolean;
  /** Schlüsselwörter inkl. im Kampf verliehener (`grantKeyword`). */
  keywords: Keyword[];
  readonly race: string | null;
  readonly abilities: readonly Ability[];
  /** Im Kampf erzeugtes Token (`summon`), keine Einheit des Spielzustands. */
  readonly summoned: boolean;
  /** Verbleibende Betäubungs-Ticks (R-9.3 Schritt 1). */
  stun: number;
  attackCooldown: number;
  moveCooldown: number;
  targetId: UnitId | null;
}

export type DamageKind = "attack" | "ability";

export type CombatEvent =
  | { type: "combat_unit_jumped"; tick: number; unit: UnitId; from: OffsetCoord; to: OffsetCoord; target: UnitId }
  | { type: "combat_target_changed"; tick: number; unit: UnitId; target: UnitId }
  | { type: "combat_unit_moved"; tick: number; unit: UnitId; from: OffsetCoord; to: OffsetCoord }
  | { type: "combat_attack"; tick: number; unit: UnitId; target: UnitId }
  | { type: "combat_ability"; tick: number; unit: UnitId; target: UnitId | null }
  | {
      type: "combat_damage";
      tick: number;
      source: UnitId | null;
      target: UnitId;
      kind: DamageKind;
      amount: number;
      absorbed: number;
      hpLoss: number;
      hp: number;
    }
  | { type: "combat_unit_stunned"; tick: number; unit: UnitId; ticks: number }
  | { type: "combat_healed"; tick: number; source: UnitId | null; target: UnitId; amount: number; hp: number }
  | { type: "combat_shielded"; tick: number; source: UnitId | null; target: UnitId; amount: number; shield: number }
  | { type: "combat_buffed"; tick: number; source: UnitId | null; target: UnitId; stat: Stat; amount: number; value: number }
  | { type: "combat_mana_gained"; tick: number; source: UnitId | null; target: UnitId; amount: number; mana: number }
  | { type: "combat_keyword_granted"; tick: number; source: UnitId | null; target: UnitId; keyword: Keyword }
  | {
      type: "combat_unit_summoned";
      tick: number;
      unit: UnitId;
      team: number;
      sourceId: string;
      cell: OffsetCoord;
      summoner: UnitId | null;
    }
  | { type: "combat_unit_died"; tick: number; unit: UnitId; killer: UnitId | null }
  | { type: "combat_ended"; tick: number; winner: number | null; survivors: UnitId[] };

/**
 * Haken für Fähigkeiten (E10). Sie dürfen über `dealDamage`, `stunFighter` usw. auf die Simulation wirken.
 * Ohne Haken passiert bei vollem Mana nur das Zurücksetzen (R-9.3 Schritt 3).
 */
export interface CombatHooks {
  /** R-9.0: vor Tick 1, in aufsteigender Einheiten-ID. */
  onCombatStart?: (sim: CombatSim, fighter: Fighter) => void;
  /** R-9.3 Schritt 3. */
  onManaFull?: (sim: CombatSim, fighter: Fighter) => void;
  /** R-9.6: sofort beim Tod. */
  onDeath?: (sim: CombatSim, fighter: Fighter, killer: Fighter | null) => void;
}

export interface CombatSim {
  readonly config: ConfigData;
  readonly size: GridSize;
  /** Nach ID aufsteigend sortiert. */
  readonly fighters: Fighter[];
  readonly hooks: CombatHooks;
  tick: number;
  /** ID für das nächste im Kampf erzeugte Token (`spawnFighter`). */
  nextSummonId: UnitId;
  /** Ist der Kampfbeginn (Tick 0) schon abgehandelt? */
  started: boolean;
  ended: boolean;
  winner: number | null;
  readonly events: CombatEvent[];
}

export interface CombatResult {
  /** Team mit lebenden Einheiten oder `null` bei Unentschieden (R-9.7). */
  winner: number | null;
  /** Letzter abgearbeiteter Tick (0, wenn der Kampf schon vor Tick 1 entschieden war). */
  ticks: number;
  /** Überlebende, nach ID aufsteigend. */
  survivors: UnitId[];
  fighters: Fighter[];
  events: CombatEvent[];
  /** Erste noch nicht vergebene ID nach im Kampf erzeugten Tokens. */
  nextSummonId: UnitId;
}

// ---------------------------------------------------------------------------
// Kämpfer aus den Spieldaten (R-9.2)
// ---------------------------------------------------------------------------

export interface FighterSource {
  id: UnitId;
  team: number;
  kind: UnitKind;
  sourceId: string;
  stars: 1 | 2 | 3;
  pos: OffsetCoord;
  startMana?: number;
  shield?: number;
}

/**
 * R-9.2: Kampfwerte aus Kartendaten (bzw. `leaders.json`) plus Sternfaktor (R-15.2), Klassenverhalten
 * aus `classes.json`. Boni (Resonanz, Anführer-Stufe 3, Zauber) kommen später hinzu (E8b, E10, E11).
 */
export function fighterFromData(data: GameData, src: FighterSource): FighterInit {
  let stats: UnitStats;
  let classId: string;
  let keywords: readonly Keyword[] = [];
  let abilities: readonly Ability[] = [];
  let race: string | null = null;
  if (src.kind === "leader") {
    const leader = data.leaders.get(src.sourceId);
    if (!leader) throw new RangeError(`Unbekannter Anführer: ${src.sourceId}`);
    stats = { ...leader.stats };
    classId = leader.class;
    abilities = leader.abilities;
    race = leader.race;
  } else {
    const card = data.cards.get(src.sourceId);
    if (!card || card.type !== "unit") throw new RangeError(`Keine Einheitenkarte: ${src.sourceId}`);
    stats = unitStats(data, src);
    classId = card.class;
    keywords = card.keywords ?? [];
    abilities = card.abilities ?? [];
    race = card.race;
  }
  const cls = data.classes.get(classId);
  if (!cls) throw new RangeError(`Unbekannte Klasse: ${classId}`);
  const init: FighterInit = {
    id: src.id,
    team: src.team,
    sourceId: src.sourceId,
    behavior: cls.combatBehavior,
    pos: { col: src.pos.col, row: src.pos.row },
    stats,
    keywords,
    race,
    abilities,
    hasManaAbility: abilities.some((a) => a.trigger === "onManaFull"),
  };
  if (src.startMana !== undefined) init.startMana = src.startMana;
  if (src.shield !== undefined) init.shield = src.shield;
  return init;
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

export function createCombat(
  config: ConfigData,
  size: GridSize,
  inits: readonly FighterInit[],
  hooks: CombatHooks = {},
  firstSummonId?: UnitId,
): CombatSim {
  const ids = new Set<UnitId>();
  const cells = new Set<string>();
  const fighters: Fighter[] = [];
  for (const init of inits) {
    if (ids.has(init.id)) throw new RangeError(`Kämpfer-ID ${init.id} doppelt`);
    if (!inBounds(init.pos, size)) throw new RangeError(`Kämpfer ${init.id} steht außerhalb der Arena`);
    const key = `${init.pos.col},${init.pos.row}`;
    if (cells.has(key)) throw new RangeError(`Feld ${key} doppelt belegt`);
    ids.add(init.id);
    cells.add(key);
    fighters.push(buildFighter(config, init, false));
  }
  fighters.sort((a, b) => a.id - b.id);
  const maxId = fighters.reduce((m, f) => Math.max(m, f.id), 0);
  return {
    config,
    size,
    fighters,
    hooks,
    tick: 0,
    nextSummonId: Math.max(firstSummonId ?? 0, maxId + 1),
    started: false,
    ended: false,
    winner: null,
    events: [],
  };
}

function buildFighter(config: ConfigData, init: FighterInit, summoned: boolean): Fighter {
  const c = config.combat;
  const s = init.stats;
  const manaMax = s.manaMax ?? c.defaultManaMax;
  const keywords = [...(init.keywords ?? [])];
  return {
    id: init.id,
    team: init.team,
    sourceId: init.sourceId,
    behavior: init.behavior,
    pos: { col: init.pos.col, row: init.pos.row },
    alive: true,
    attack: s.attack,
    maxHp: s.hp,
    hp: s.hp,
    range: s.range,
    breakthrough: s.breakthrough,
    armor: s.armor ?? 0,
    attackInterval: s.attackInterval ?? c.defaultAttackInterval,
    moveInterval: s.moveInterval ?? c.defaultMoveInterval,
    hasManaAbility: init.hasManaAbility,
    manaMax,
    mana: init.hasManaAbility ? Math.min(manaMax, init.startMana ?? 0) : 0,
    shield: init.shield ?? 0,
    firstStrike: keywords.includes("firstStrike"),
    keywords,
    race: init.race ?? null,
    abilities: init.abilities ?? [],
    summoned,
    stun: 0,
    attackCooldown: 0,
    moveCooldown: 0,
    targetId: null,
  };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function copy(c: OffsetCoord): OffsetCoord {
  return { col: c.col, row: c.row };
}

export function livingFighters(sim: CombatSim): Fighter[] {
  return sim.fighters.filter((f) => f.alive);
}

export function fighterById(sim: CombatSim, id: UnitId): Fighter | undefined {
  return sim.fighters.find((f) => f.id === id);
}

export function isCellFree(sim: CombatSim, c: OffsetCoord): boolean {
  return inBounds(c, sim.size) && !sim.fighters.some((f) => f.alive && coordEquals(f.pos, c));
}

function livingTeams(sim: CombatSim): number[] {
  return [...new Set(livingFighters(sim).map((f) => f.team))].sort((a, b) => a - b);
}

/** R-9.4: Hex-Abstand, für Kandidaten mit Verhalten `taunt` (Krieger) um den Bonus verringert. */
export function effectiveDistance(sim: CombatSim, from: Fighter, candidate: Fighter): number {
  const bonus = candidate.behavior === "taunt" ? sim.config.combat.warriorTargetingBonus : 0;
  return hexDistance(from.pos, candidate.pos) - bonus;
}

/** R-9.4: kleinster effektiver Abstand, dann wenigste aktuelle Lebenspunkte, dann kleinste ID. */
export function bestTarget(sim: CombatSim, fighter: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bestDist = Infinity;
  for (const c of sim.fighters) {
    if (!c.alive || c.team === fighter.team) continue;
    const d = effectiveDistance(sim, fighter, c);
    if (best === null || d < bestDist || (d === bestDist && (c.hp < best.hp || (c.hp === best.hp && c.id < best.id)))) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * R-9.4 / R-9.3 Schritt 2: Ziel bestimmen, falls keins lebt; wechseln, wenn ein anderer Kandidat einen um
 * mindestens `retargetDistanceGap` kleineren effektiven Abstand hat.
 */
function updateTarget(sim: CombatSim, fighter: Fighter): Fighter | null {
  const current = fighter.targetId === null ? undefined : fighterById(sim, fighter.targetId);
  const best = bestTarget(sim, fighter);
  let chosen: Fighter | null;
  if (!current || !current.alive) {
    chosen = best;
  } else if (
    best &&
    best.id !== current.id &&
    effectiveDistance(sim, fighter, best) <= effectiveDistance(sim, fighter, current) - sim.config.combat.retargetDistanceGap
  ) {
    chosen = best;
  } else {
    chosen = current;
  }
  const newId = chosen ? chosen.id : null;
  if (newId !== fighter.targetId) {
    fighter.targetId = newId;
    if (chosen) sim.events.push({ type: "combat_target_changed", tick: sim.tick, unit: fighter.id, target: chosen.id });
  }
  return chosen;
}

function checkEnd(sim: CombatSim): boolean {
  if (sim.ended) return true;
  const teams = livingTeams(sim);
  if (teams.length <= 1) {
    finish(sim, teams.length === 1 ? (teams[0] as number) : null);
    return true;
  }
  return false;
}

function finish(sim: CombatSim, winner: number | null): void {
  sim.ended = true;
  sim.winner = winner;
  sim.events.push({
    type: "combat_ended",
    tick: sim.tick,
    winner,
    survivors: livingFighters(sim).map((f) => f.id),
  });
}

function gainMana(fighter: Fighter, amount: number): number {
  if (!fighter.hasManaAbility || !fighter.alive) return 0;
  const before = fighter.mana;
  fighter.mana = Math.min(fighter.manaMax, fighter.mana + amount);
  return fighter.mana - before;
}

// ---------------------------------------------------------------------------
// Wirkungen (auch für Fähigkeiten-Haken)
// ---------------------------------------------------------------------------

/**
 * R-9.5: Schaden zuerst auf den Schild, der Rest abzüglich Panzer (mindestens 1) auf die Lebenspunkte.
 * Ein Angriff gibt der getroffenen Einheit Mana. Lebenspunkte ≤ 0 → sofortiger Tod (R-9.6).
 */
export function dealDamage(
  sim: CombatSim,
  source: Fighter | null,
  target: Fighter,
  amount: number,
  kind: DamageKind,
): void {
  if (!target.alive || amount <= 0) return;
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  const rest = amount - absorbed;
  const hpLoss = rest > 0 ? Math.max(1, rest - target.armor) : 0;
  target.hp -= hpLoss;
  sim.events.push({
    type: "combat_damage",
    tick: sim.tick,
    source: source ? source.id : null,
    target: target.id,
    kind,
    amount,
    absorbed,
    hpLoss,
    hp: target.hp,
  });
  if (kind === "attack") gainMana(target, sim.config.combat.manaPerHitTaken);
  if (target.hp <= 0) killFighter(sim, target, source);
}

/** R-9.6: Die Einheit verlässt die Simulation, „wenn diese Einheit stirbt“ wird sofort abgehandelt. */
export function killFighter(sim: CombatSim, fighter: Fighter, killer: Fighter | null): void {
  if (!fighter.alive) return;
  fighter.alive = false;
  fighter.targetId = null;
  sim.events.push({ type: "combat_unit_died", tick: sim.tick, unit: fighter.id, killer: killer ? killer.id : null });
  sim.hooks.onDeath?.(sim, fighter, killer);
}

/** Betäubung: die längere von alter und neuer Dauer gilt (keine Addition). */
export function stunFighter(sim: CombatSim, target: Fighter, ticks: number): void {
  if (!target.alive || ticks <= 0) return;
  target.stun = Math.max(target.stun, ticks);
  sim.events.push({ type: "combat_unit_stunned", tick: sim.tick, unit: target.id, ticks });
}

/** Lebenspunkte zurück, höchstens bis zum Maximum. */
export function healFighter(sim: CombatSim, source: Fighter | null, target: Fighter, amount: number): void {
  if (!target.alive || amount <= 0) return;
  const healed = Math.min(amount, target.maxHp - target.hp);
  if (healed <= 0) return;
  target.hp += healed;
  sim.events.push({ type: "combat_healed", tick: sim.tick, source: source ? source.id : null, target: target.id, amount: healed, hp: target.hp });
}

/** R-14.3: Schilde addieren sich. */
export function shieldFighter(sim: CombatSim, source: Fighter | null, target: Fighter, amount: number): void {
  if (!target.alive || amount <= 0) return;
  target.shield += amount;
  sim.events.push({ type: "combat_shielded", tick: sim.tick, source: source ? source.id : null, target: target.id, amount, shield: target.shield });
}

/** Mana durch Effekte; nur Einheiten mit Mana-Fähigkeit sammeln Mana (R-9.2). */
export function addMana(sim: CombatSim, source: Fighter | null, target: Fighter, amount: number): void {
  if (amount <= 0) return;
  const gained = gainMana(target, amount);
  if (gained <= 0) return;
  sim.events.push({ type: "combat_mana_gained", tick: sim.tick, source: source ? source.id : null, target: target.id, amount: gained, mana: target.mana });
}

/**
 * Kampfwert erhöhen. `hp` erhöht Maximum und aktuelle Lebenspunkte; Intervalle sinken nie unter 1,
 * Werte nie unter 0.
 */
export function buffFighter(sim: CombatSim, source: Fighter | null, target: Fighter, stat: Stat, amount: number): void {
  if (!target.alive || amount === 0) return;
  let value: number;
  switch (stat) {
    case "hp":
      target.maxHp = Math.max(1, target.maxHp + amount);
      target.hp = Math.min(target.maxHp, Math.max(1, target.hp + amount));
      value = target.maxHp;
      break;
    case "attackInterval":
    case "moveInterval":
      target[stat] = Math.max(1, target[stat] + amount);
      value = target[stat];
      break;
    case "manaMax":
      target.manaMax = Math.max(1, target.manaMax + amount);
      target.mana = Math.min(target.mana, target.manaMax);
      value = target.manaMax;
      break;
    default:
      target[stat] = Math.max(0, target[stat] + amount);
      value = target[stat];
  }
  sim.events.push({ type: "combat_buffed", tick: sim.tick, source: source ? source.id : null, target: target.id, stat, amount, value });
}

/** Schlüsselwort für den Rest des Kampfes verleihen. */
export function grantFighterKeyword(sim: CombatSim, source: Fighter | null, target: Fighter, keyword: Keyword): void {
  if (!target.alive || target.keywords.includes(keyword)) return;
  target.keywords.push(keyword);
  if (keyword === "firstStrike") target.firstStrike = true;
  sim.events.push({ type: "combat_keyword_granted", tick: sim.tick, source: source ? source.id : null, target: target.id, keyword });
}

/**
 * Erzeugt im Kampf ein Token (`summon`) auf einem freien Feld. Es bekommt die nächste freie ID und
 * handelt danach normal; R-9.0 gilt für Tokens, die vor dem Kampfbeginn schon auf dem Brett standen.
 */
export function spawnFighter(
  sim: CombatSim,
  summoner: Fighter | null,
  init: Omit<FighterInit, "id" | "pos">,
  pos: OffsetCoord,
): Fighter | null {
  if (!isCellFree(sim, pos)) return null;
  const fighter = buildFighter(sim.config, { ...init, id: sim.nextSummonId, pos }, true);
  sim.nextSummonId += 1;
  sim.fighters.push(fighter);
  sim.fighters.sort((a, b) => a.id - b.id);
  sim.events.push({
    type: "combat_unit_summoned",
    tick: sim.tick,
    unit: fighter.id,
    team: fighter.team,
    sourceId: fighter.sourceId,
    cell: copy(pos),
    summoner: summoner ? summoner.id : null,
  });
  return fighter;
}

// ---------------------------------------------------------------------------
// Kampfbeginn (R-9.0) und Schurken-Sprung (R-9.4)
// ---------------------------------------------------------------------------

/**
 * R-9.4: Der Schurke springt auf ein freies Feld neben dem Gegner mit dem größten Abstand zu ihm
 * (Gleichstand: kleinste ID). Hat dieser Gegner kein freies Nachbarfeld, wird der nächste genommen.
 * Unter mehreren freien Nachbarfeldern gilt das kleinste `(row, col)`. Der Gegner wird sein Ziel.
 */
function backlineJump(sim: CombatSim, rogue: Fighter): void {
  const enemies = sim.fighters
    .filter((f) => f.alive && f.team !== rogue.team)
    .sort((a, b) => hexDistance(rogue.pos, b.pos) - hexDistance(rogue.pos, a.pos) || a.id - b.id);
  for (const enemy of enemies) {
    const free = neighbors(enemy.pos, sim.size)
      .filter((c) => isCellFree(sim, c))
      .sort(compareRowCol);
    const to = free[0];
    if (!to) continue;
    const from = copy(rogue.pos);
    rogue.pos = copy(to);
    rogue.targetId = enemy.id;
    sim.events.push({ type: "combat_unit_jumped", tick: sim.tick, unit: rogue.id, from, to: copy(to), target: enemy.id });
    return;
  }
}

function combatStart(sim: CombatSim): void {
  sim.tick = 0;
  if (checkEnd(sim)) return;
  // Im Kampfbeginn erzeugte Tokens haben keinen eigenen Kampfbeginn (Liste vorher festhalten).
  for (const f of [...sim.fighters]) {
    if (!f.alive) continue;
    sim.hooks.onCombatStart?.(sim, f);
    if (f.alive && f.behavior === "backlineJump") backlineJump(sim, f);
    if (checkEnd(sim)) return;
  }
}

// ---------------------------------------------------------------------------
// Tick-Ablauf (R-9.3)
// ---------------------------------------------------------------------------

/** R-9.3: zuerst `firstStrike`, dann alle anderen; jeweils nach aufsteigender ID. */
export function actingOrder(sim: CombatSim): Fighter[] {
  return livingFighters(sim).sort((a, b) => Number(b.firstStrike) - Number(a.firstStrike) || a.id - b.id);
}

function act(sim: CombatSim, f: Fighter): void {
  // 1. Betäubt: nur Zähler verringern.
  if (f.stun > 0) {
    f.stun -= 1;
    return;
  }
  // 2. Ziel bestimmen.
  const target = updateTarget(sim, f);
  // 3. Volles Mana: Fähigkeit wirken.
  if (f.hasManaAbility && f.mana >= f.manaMax) {
    sim.events.push({ type: "combat_ability", tick: sim.tick, unit: f.id, target: target ? target.id : null });
    f.mana = 0;
    f.attackCooldown = f.attackInterval;
    sim.hooks.onManaFull?.(sim, f);
    return;
  }
  if (!target) return;
  const inRange = hexDistance(f.pos, target.pos) <= f.range;
  if (inRange) {
    // 4. Angreifen.
    if (f.attackCooldown === 0) {
      sim.events.push({ type: "combat_attack", tick: sim.tick, unit: f.id, target: target.id });
      f.attackCooldown = f.attackInterval;
      gainMana(f, sim.config.combat.manaPerAttack);
      dealDamage(sim, f, target, f.attack, "attack");
    }
    return;
  }
  // 5. Einen Schritt gehen.
  if (f.moveCooldown === 0) {
    const step = nextStepToward(f.pos, target.pos, sim.size, (c) => isCellFree(sim, c));
    if (step) {
      const from = copy(f.pos);
      f.pos = copy(step);
      f.moveCooldown = f.moveInterval;
      sim.events.push({ type: "combat_unit_moved", tick: sim.tick, unit: f.id, from, to: copy(step) });
    }
  }
}

/**
 * Arbeitet den nächsten Tick ab (beim ersten Aufruf zusätzlich den Kampfbeginn, Tick 0).
 * Liefert `false`, sobald der Kampf beendet ist.
 */
export function stepCombat(sim: CombatSim): boolean {
  if (sim.ended) return false;
  if (!sim.started) {
    sim.started = true;
    combatStart(sim);
    if (sim.ended) return false;
  }
  if (sim.tick >= sim.config.combat.maxTicks) {
    finish(sim, null);
    return false;
  }
  sim.tick += 1;
  for (const f of actingOrder(sim)) {
    if (!f.alive) continue;
    act(sim, f);
    if (checkEnd(sim)) return false;
  }
  // 6. Cooldowns am Ende des Ticks.
  for (const f of sim.fighters) {
    if (!f.alive) continue;
    if (f.attackCooldown > 0) f.attackCooldown -= 1;
    if (f.moveCooldown > 0) f.moveCooldown -= 1;
  }
  // R-9.7: nach dem letzten Tick ist Schluss, auch wenn noch mehrere Teams leben.
  if (sim.tick >= sim.config.combat.maxTicks) {
    finish(sim, null);
    return false;
  }
  return true;
}

export function combatResult(sim: CombatSim): CombatResult {
  return {
    winner: sim.winner,
    ticks: sim.tick,
    survivors: livingFighters(sim).map((f) => f.id),
    fighters: sim.fighters,
    events: sim.events,
    nextSummonId: sim.nextSummonId,
  };
}

/** Kompletter Kampf von Tick 0 bis zum Ende (R-9.0 bis R-9.7). */
export function simulateCombat(
  config: ConfigData,
  size: GridSize,
  inits: readonly FighterInit[],
  hooks: CombatHooks = {},
  firstSummonId?: UnitId,
): CombatResult {
  const sim = createCombat(config, size, inits, hooks, firstSummonId);
  while (stepCombat(sim)) {
    // weiter bis zum Kampfende
  }
  return combatResult(sim);
}
