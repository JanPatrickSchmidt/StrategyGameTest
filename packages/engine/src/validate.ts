/**
 * Validation of the raw game content (E2).
 *
 * Checks structure and required fields of every data file, that every `op`,
 * `target`, `trigger`, keyword etc. is known to the effect system, and that
 * every referenced ID (race, class, token, card) exists.
 * Returns a list of issues instead of throwing, so tests and tools can show
 * all problems at once.
 */
import {
  ARENA_SCOPES,
  BRANCH_LEVELS,
  CARD_TYPES,
  COMBAT_BEHAVIORS,
  CONDITION_KINDS,
  COST_MODIFIER_SCOPES,
  DURATIONS,
  type EffectOp,
  GOLD_DESTINATIONS,
  KEYWORDS,
  LEADER_CATEGORIES,
  MOVE_DESTINATIONS,
  OWN_CARD_ZONES,
  PLAYER_CHOICES,
  PLAYER_TARGETS,
  RETURN_LIMITS,
  STATS,
  SUMMON_PLACEMENTS,
  TIMINGS,
  TRASH_SOURCES,
  TRIGGERS,
  UNIT_TARGET_NAMES,
} from "./dataTypes";

export interface ValidationIssue {
  /** Location in the data, e.g. `cards.cards[3].effects[0].op`. */
  path: string;
  message: string;
}

export interface RawGameData {
  config: unknown;
  /** Content of cards.json: `{ cards: [...] }`. */
  cards: unknown;
  leaders: unknown;
  races: unknown;
  classes: unknown;
}

type RefKind = "race" | "class" | "card" | "token";

interface PendingRef {
  kind: RefKind;
  id: string;
  path: string;
}

class Context {
  readonly issues: ValidationIssue[] = [];
  readonly refs: PendingRef[] = [];

  report(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

type Check = (value: unknown, path: string, ctx: Context) => void;

interface Field {
  required: boolean;
  check: Check;
}
type Fields = Record<string, Field>;

const req = (check: Check): Field => ({ required: true, check });
const opt = (check: Check): Field => ({ required: false, check });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

// ---------------------------------------------------------------------------
// Basic checks

const str: Check = (v, path, ctx) => {
  if (typeof v !== "string" || v.length === 0) ctx.report(path, `erwartet nichtleeren Text, gefunden ${describe(v)}`);
};

const bool: Check = (v, path, ctx) => {
  if (typeof v !== "boolean") ctx.report(path, `erwartet true/false, gefunden ${describe(v)}`);
};

function num(min: number): Check {
  return (v, path, ctx) => {
    if (typeof v !== "number" || !Number.isFinite(v)) ctx.report(path, `erwartet Zahl, gefunden ${describe(v)}`);
    else if (v < min) ctx.report(path, `Zahl muss mindestens ${min} sein, gefunden ${v}`);
  };
}

function int(min: number): Check {
  return (v, path, ctx) => {
    if (typeof v !== "number" || !Number.isInteger(v)) ctx.report(path, `erwartet ganze Zahl, gefunden ${describe(v)}`);
    else if (v < min) ctx.report(path, `Zahl muss mindestens ${min} sein, gefunden ${v}`);
  };
}

function oneOf(values: readonly string[], label: string): Check {
  return (v, path, ctx) => {
    if (typeof v !== "string" || !values.includes(v)) {
      ctx.report(path, `unbekannter Wert für ${label}: ${describe(v)} (erlaubt: ${values.join(", ")})`);
    }
  };
}

function ref(kind: RefKind): Check {
  return (v, path, ctx) => {
    if (typeof v !== "string" || v.length === 0) {
      ctx.report(path, `erwartet ${kind}-ID, gefunden ${describe(v)}`);
      return;
    }
    ctx.refs.push({ kind, id: v, path });
  };
}

function nullable(check: Check): Check {
  return (v, path, ctx) => {
    if (v !== null) check(v, path, ctx);
  };
}

function arrayOf(check: Check, minLength = 0): Check {
  return (v, path, ctx) => {
    if (!Array.isArray(v)) {
      ctx.report(path, `erwartet Liste, gefunden ${describe(v)}`);
      return;
    }
    if (v.length < minLength) ctx.report(path, `Liste braucht mindestens ${minLength} Einträge`);
    v.forEach((item, i) => check(item, `${path}[${i}]`, ctx));
  };
}

/** Checks required/optional fields and rejects unknown keys (keys starting with `_` are comments). */
function checkFields(v: Record<string, unknown>, fields: Fields, path: string, ctx: Context): void {
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in v)) {
      if (field.required) ctx.report(`${path}.${key}`, "Pflichtfeld fehlt");
      continue;
    }
    field.check(v[key], `${path}.${key}`, ctx);
  }
  for (const key of Object.keys(v)) {
    if (!key.startsWith("_") && !(key in fields)) ctx.report(`${path}.${key}`, "unbekanntes Feld");
  }
}

function obj(fields: Fields): Check {
  return (v, path, ctx) => {
    if (!isRecord(v)) {
      ctx.report(path, `erwartet Objekt, gefunden ${describe(v)}`);
      return;
    }
    checkFields(v, fields, path, ctx);
  };
}

/** Object discriminated by `kind`. */
function byKind(variants: Record<string, Fields>, label: string): Check {
  const kinds = Object.keys(variants);
  return (v, path, ctx) => {
    if (!isRecord(v)) {
      ctx.report(path, `erwartet Objekt mit kind, gefunden ${describe(v)}`);
      return;
    }
    const kind = v.kind;
    const variant = typeof kind === "string" ? variants[kind] : undefined;
    if (variant === undefined) {
      ctx.report(`${path}.kind`, `unbekannte Art für ${label}: ${describe(kind)} (erlaubt: ${kinds.join(", ")})`);
      return;
    }
    checkFields(v, { kind: req(() => undefined), ...variant }, path, ctx);
  };
}

function either(isFirst: (v: unknown) => boolean, first: Check, second: Check): Check {
  return (v, path, ctx) => (isFirst(v) ? first(v, path, ctx) : second(v, path, ctx));
}

function recordOf(keyCheck: (key: string) => string | null, valueCheck: Check, minKeys = 0): Check {
  return (v, path, ctx) => {
    if (!isRecord(v)) {
      ctx.report(path, `erwartet Objekt, gefunden ${describe(v)}`);
      return;
    }
    const keys = Object.keys(v).filter((k) => !k.startsWith("_"));
    if (keys.length < minKeys) ctx.report(path, `braucht mindestens ${minKeys} Einträge`);
    for (const key of keys) {
      const problem = keyCheck(key);
      if (problem !== null) ctx.report(`${path}.${key}`, problem);
      valueCheck(v[key], `${path}.${key}`, ctx);
    }
  };
}

const positiveIntKey = (key: string): string | null =>
  /^[1-9][0-9]*$/.test(key) ? null : `Schlüssel muss eine positive ganze Zahl sein, gefunden "${key}"`;

// ---------------------------------------------------------------------------
// Effect system

const amount: Check = either(
  (v) => typeof v === "number",
  num(Number.NEGATIVE_INFINITY),
  byKind({ distinctOwnRaces: {}, selfAttackTimes: { factor: req(num(0)) } }, "berechneten Wert"),
);

const unitTarget: Check = either(
  (v) => typeof v === "string",
  oneOf(UNIT_TARGET_NAMES, "Ziel (target)"),
  byKind({ nearestEnemies: { count: req(int(1)) }, alliesInRange: { range: req(int(1)) } }, "Ziel (target)"),
);

const statOverride: Check = recordOf(
  (key) => ((STATS as readonly string[]).includes(key) ? null : `unbekannter Wert (stat): "${key}"`),
  int(0),
  1,
);

// `effects` refers back to `effect`, so it is resolved lazily.
const effects: Check = (v, path, ctx) => arrayOf(effect, 1)(v, path, ctx);

/** Parameters per effect building block (data/README.md). Typed so every op is covered. */
const EFFECT_PARAMS: Record<EffectOp, Fields> = {
  damage: { amount: req(amount), target: req(unitTarget), wound: opt(bool) },
  heal: { amount: req(amount), target: req(unitTarget) },
  shield: { amount: req(amount), target: req(unitTarget) },
  buff: {
    stat: req(oneOf(STATS, "stat")),
    amount: req(amount),
    duration: req(oneOf(DURATIONS, "duration")),
    target: req(unitTarget),
  },
  stun: { ticks: req(int(1)), target: req(unitTarget) },
  gainMana: { amount: req(amount), target: req(unitTarget) },
  startManaPercent: {
    amount: req(amount),
    target: req(unitTarget),
    class: opt(ref("class")),
    when: opt(oneOf(TIMINGS, "when")),
  },
  summon: {
    token: req(ref("token")),
    count: req(int(1)),
    where: req(oneOf(SUMMON_PLACEMENTS, "where")),
    statOverride: opt(statOverride),
    countsForResonance: opt(bool),
  },
  move: { target: req(unitTarget) },
  wound: { target: req(unitTarget) },
  gainGold: { amount: req(amount), when: req(oneOf(TIMINGS, "when")), to: opt(oneOf(GOLD_DESTINATIONS, "to")) },
  stealGold: { amount: req(amount), from: req(oneOf(PLAYER_TARGETS, "from")) },
  giveCurse: { to: req(oneOf(PLAYER_TARGETS, "to")) },
  trash: { from: req(oneOf(TRASH_SOURCES, "from")) },
  gainLeaderXp: { amount: req(amount) },
  grantKeyword: {
    keyword: req(oneOf(KEYWORDS, "keyword")),
    duration: opt(oneOf(DURATIONS, "duration")),
    target: req(unitTarget),
  },
  costModifier: { amount: req(amount), appliesTo: req(oneOf(COST_MODIFIER_SCOPES, "appliesTo")) },
  returnOnDeath: { hp: req(int(1)), limit: req(oneOf(RETURN_LIMITS, "limit")), target: req(unitTarget) },
  onFrontWinOfChosen: { effects: req(effects) },
  bonusInterest: { perGold: req(int(1)), amount: req(int(1)) },
  bonusXp: { amount: req(amount), target: req(unitTarget) },
};

export const KNOWN_EFFECT_OPS: readonly string[] = Object.keys(EFFECT_PARAMS);

function effect(v: unknown, path: string, ctx: Context): void {
  if (!isRecord(v)) {
    ctx.report(path, `erwartet Effekt-Objekt, gefunden ${describe(v)}`);
    return;
  }
  const op = v.op;
  const params = typeof op === "string" && op in EFFECT_PARAMS ? EFFECT_PARAMS[op as EffectOp] : undefined;
  if (params === undefined) {
    ctx.report(`${path}.op`, `unbekannter Effekt-Baustein (op): ${describe(op)}`);
    return;
  }
  checkFields(v, { op: req(() => undefined), ...params }, path, ctx);
}

const condition: Check = obj({ kind: req(oneOf(CONDITION_KINDS, "Bedingung (condition.kind)")) });

const ability: Check = obj({
  trigger: req(oneOf(TRIGGERS, "Auslöser (trigger)")),
  name: opt(str),
  condition: opt(condition),
  effects: req(effects),
});

const targetSpec: Check = byKind(
  {
    hex: { arenas: req(oneOf(ARENA_SCOPES, "arenas")), mustBeFree: opt(bool) },
    zone: { arenas: req(oneOf(ARENA_SCOPES, "arenas")) },
    player: { allowed: req(oneOf(PLAYER_CHOICES, "allowed")) },
    ownCards: { max: req(int(1)), from: req(arrayOf(oneOf(OWN_CARD_ZONES, "from"), 1)) },
    moveUnits: { count: req(int(1)), destination: req(oneOf(MOVE_DESTINATIONS, "destination")) },
    none: {},
  },
  "Ziel-Angabe",
);

const unitStats: Check = obj({
  attack: req(int(0)),
  hp: req(int(1)),
  breakthrough: req(int(0)),
  range: req(int(1)),
  armor: opt(int(0)),
  attackInterval: opt(int(1)),
  moveInterval: opt(int(1)),
  manaMax: opt(int(1)),
});

// ---------------------------------------------------------------------------
// Files

const pool: Check = (v, path, ctx) => {
  if (typeof v === "string" && v.startsWith("class:")) {
    ref("class")(v.slice("class:".length), path, ctx);
    return;
  }
  if (typeof v !== "string" || !["starter", "basic", "kingdom", "token"].includes(v)) {
    ctx.report(path, `unbekannter Wert für pool: ${describe(v)} (erlaubt: starter, basic, kingdom, token, class:<classId>)`);
  }
};

const CARD_BASE: Fields = {
  id: req(str),
  name: req(str),
  type: req(() => undefined),
  cost: req(int(0)),
  pool: req(pool),
  pileSize: opt(int(1)),
  buyable: opt(bool),
};

const CARD_FIELDS_BY_TYPE: Record<(typeof CARD_TYPES)[number], Fields> = {
  resource: { gold: req(int(0)) },
  unit: {
    race: req(nullable(ref("race"))),
    class: req(ref("class")),
    stats: req(unitStats),
    keywords: opt(arrayOf(oneOf(KEYWORDS, "keyword"))),
    abilities: opt(arrayOf(ability)),
    altCost: opt(obj({ bloodToll: opt(int(1)), gold: opt(int(0)), sacrifice: opt(int(1)) })),
    starterFor: opt(ref("class")),
  },
  spell: {
    slot: req(oneOf(["pre", "post"], "slot")),
    tempo: req(int(1)),
    target: req(targetSpec),
    effects: req(effects),
    condition: opt(condition),
  },
  curse: {},
};

function card(v: unknown, path: string, ctx: Context): void {
  if (!isRecord(v)) {
    ctx.report(path, `erwartet Karten-Objekt, gefunden ${describe(v)}`);
    return;
  }
  const type = v.type;
  const extra =
    typeof type === "string" && type in CARD_FIELDS_BY_TYPE
      ? CARD_FIELDS_BY_TYPE[type as keyof typeof CARD_FIELDS_BY_TYPE]
      : undefined;
  if (extra === undefined) {
    ctx.report(`${path}.type`, `unbekannter Kartentyp: ${describe(type)} (erlaubt: ${CARD_TYPES.join(", ")})`);
    checkFields(v, CARD_BASE, path, ctx);
    return;
  }
  checkFields(v, { ...CARD_BASE, ...extra }, path, ctx);
}

const race: Check = obj({
  id: req(str),
  name: req(str),
  resonance: req(recordOf(positiveIntKey, effects, 1)),
});

const classData: Check = obj({
  id: req(str),
  name: req(str),
  combatBehavior: req(oneOf(COMBAT_BEHAVIORS, "combatBehavior")),
});

const branchLevel: Check = obj({
  effects: req(effects),
  zones: opt(int(1)),
  hexes: opt(int(1)),
  count: opt(int(1)),
});

const branchLevels: Fields = Object.fromEntries(BRANCH_LEVELS.map((level) => [level, req(branchLevel)]));

const branch: Check = obj({ id: req(str), name: req(str), levels: req(obj(branchLevels)) });

function uniqueIds(key: string): Check {
  return (v, path, ctx) => {
    if (!Array.isArray(v)) return;
    const seen = new Set<string>();
    for (const item of v) {
      const id = isRecord(item) ? item[key] : undefined;
      if (typeof id !== "string") continue;
      if (seen.has(id)) ctx.report(path, `doppelte ID: ${id}`);
      seen.add(id);
    }
  };
}

const leader: Check = obj({
  id: req(str),
  name: req(str),
  class: req(ref("class")),
  race: req(ref("race")),
  stats: req(unitStats),
  abilities: req(arrayOf(ability)),
  active: req(
    obj({
      name: req(str),
      category: req(oneOf(LEADER_CATEGORIES, "Kategorie (R-8.2)")),
      target: req(targetSpec),
      base: req(obj({ effects: req(effects) })),
      branches: req((v, path, ctx) => {
        arrayOf(branch, 1)(v, path, ctx);
        uniqueIds("id")(v, path, ctx);
      }),
    }),
  ),
});

const pileRule = obj({ maxCost: req(int(0)), copies: req(int(1)) });

const config: Check = obj({
  players: req(int(2)),
  startingLife: req(int(1)),
  handSize: req(int(1)),
  startingDeck: req(obj({ coin: req(int(0)), recruit: req(int(0)), classStarter: req(int(0)) })),
  boardCapacity: req(int(1)),
  capacityBonusAtLeaderLevel: req(recordOf(positiveIntKey, int(0))),
  reserveSlots: req(int(0)),
  spellSlots: req(obj({ pre: req(int(0)), post: req(int(0)) })),
  interestPer: req(int(1)),
  interestMax: req(int(0)),
  emptyFrontLoot: req(int(0)),
  baseDamage: req(obj({ base: req(int(0)), rampStartsAfterRound: req(int(0)), perRound: req(int(0)) })),
  center: req(
    obj({
      rewards: req(
        arrayOf(obj({ streak: req(int(1)), gold: req(int(0)), cards: req(int(0)), power: req(int(0)) }), 1),
      ),
    }),
  ),
  streakGold: req(arrayOf(obj({ minStreak: req(int(1)), gold: req(int(0)) }))),
  powerToWin: req(int(1)),
  maxRounds: req(int(1)),
  combat: req(
    obj({
      maxTicks: req(int(1)),
      defaultAttackInterval: req(int(1)),
      defaultMoveInterval: req(int(1)),
      defaultManaMax: req(int(1)),
      manaPerAttack: req(int(0)),
      manaPerHitTaken: req(int(0)),
      warriorTargetingBonus: req(int(0)),
      retargetDistanceGap: req(int(0)),
    }),
  ),
  starMultiplier: req(obj({ "1": req(num(0)), "2": req(num(0)), "3": req(num(0)) })),
  leader: req(
    obj({
      xpPerRound: req(int(0)),
      xpPerSurvivedFight: req(int(0)),
      levelThresholds: req(obj({ "2": req(int(1)), "3": req(int(1)), "4": req(int(1)) })),
      level3StatBonus: req(num(0)),
    }),
  ),
  healCostPerStar: req(int(0)),
  unitXpPerSurvivedFight: req(int(0)),
  arenas: req(
    obj({
      frontZone: req(obj({ cols: req(int(1)), rows: req(int(1)) })),
      centerArena: req(obj({ cols: req(int(1)), rows: req(int(1)) })),
      centerStartSlots: req(int(1)),
    }),
  ),
  pileSizeByCost: req(arrayOf(pileRule, 1)),
  classPoolPileSize: req(int(1)),
});

// ---------------------------------------------------------------------------
// Entry point

function idsOf(list: unknown, filter: (item: Record<string, unknown>) => boolean = () => true): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(list)) return ids;
  for (const item of list) {
    if (isRecord(item) && typeof item.id === "string" && filter(item)) ids.add(item.id);
  }
  return ids;
}

/** Validates all data files. An empty result means the data is valid. */
export function validateGameData(raw: RawGameData): ValidationIssue[] {
  const ctx = new Context();

  config(raw.config, "config", ctx);

  const cardList = isRecord(raw.cards) ? raw.cards.cards : undefined;
  if (!isRecord(raw.cards)) ctx.report("cards", "erwartet Objekt mit Feld cards");
  else {
    arrayOf(card, 1)(cardList, "cards.cards", ctx);
    uniqueIds("id")(cardList, "cards.cards", ctx);
  }

  arrayOf(leader, 1)(raw.leaders, "leaders", ctx);
  uniqueIds("id")(raw.leaders, "leaders", ctx);
  arrayOf(race, 1)(raw.races, "races", ctx);
  uniqueIds("id")(raw.races, "races", ctx);
  arrayOf(classData, 1)(raw.classes, "classes", ctx);
  uniqueIds("id")(raw.classes, "classes", ctx);

  const known: Record<RefKind, Set<string>> = {
    race: idsOf(raw.races),
    class: idsOf(raw.classes),
    card: idsOf(cardList),
    token: idsOf(cardList, (c) => c.pool === "token"),
  };
  const labels: Record<RefKind, string> = {
    race: "unbekannte Rasse",
    class: "unbekannte Klasse",
    card: "unbekannte Karte",
    token: "unbekanntes Token",
  };
  for (const r of ctx.refs) {
    if (!known[r.kind].has(r.id)) ctx.report(r.path, `${labels[r.kind]}: ${r.id}`);
  }

  return ctx.issues;
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => `- ${i.path}: ${i.message}`).join("\n");
}
