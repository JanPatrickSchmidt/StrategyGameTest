/**
 * Typed shapes of the game content in packages/engine/data.
 * The runtime checks for exactly these shapes live in validate.ts;
 * the allowed enum values are defined once here and used by both.
 */

export const CARD_TYPES = ["resource", "unit", "spell", "curse"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const STATS = [
  "attack",
  "hp",
  "breakthrough",
  "range",
  "armor",
  "attackInterval",
  "moveInterval",
  "manaMax",
] as const;
export type Stat = (typeof STATS)[number];

export const TRIGGERS = [
  "onCombatStart",
  "onManaFull",
  "onDeath",
  "onAllyDeath",
  "onKill",
  "onFrontWin",
  "onRoundStart",
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const CONDITION_KINDS = ["inReserve", "wonFrontThisRound"] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const KEYWORDS = ["firstStrike", "unwoundable", "woundOnKill"] as const;
export type Keyword = (typeof KEYWORDS)[number];

export const DURATIONS = ["combat", "round", "permanent"] as const;
export type Duration = (typeof DURATIONS)[number];

export const UNIT_TARGET_NAMES = [
  "self",
  "currentTarget",
  "currentTargetAndNeighbors",
  "weakestAlly",
  "adjacentAllies",
  "allAllies",
  "alliesInArena",
  "zoneAllies",
  "raceUnits",
  "ownClassUnits",
  "hexEnemies",
  "hexNeighborEnemies",
  "hexAndNeighborEnemies",
  "hexAlly",
  "chosenUnits",
] as const;
export type UnitTargetName = (typeof UNIT_TARGET_NAMES)[number];
export type UnitTarget =
  | UnitTargetName
  | { kind: "nearestEnemies"; count: number }
  | { kind: "alliesInRange"; range: number };

export const PLAYER_TARGETS = ["frontOpponent", "frontOpponentTreasury", "targetPlayer"] as const;
export type PlayerTarget = (typeof PLAYER_TARGETS)[number];

export const TIMINGS = ["now", "nextRound"] as const;
export type Timing = (typeof TIMINGS)[number];

export const GOLD_DESTINATIONS = ["pool", "treasury"] as const;
export type GoldDestination = (typeof GOLD_DESTINATIONS)[number];

export const SUMMON_PLACEMENTS = ["adjacentFree", "zoneFree", "targetHexThenAdjacentFree"] as const;
export type SummonPlacement = (typeof SUMMON_PLACEMENTS)[number];

export const TRASH_SOURCES = ["chosenHandCards"] as const;
export type TrashSource = (typeof TRASH_SOURCES)[number];

export const COST_MODIFIER_SCOPES = ["raceCards"] as const;
export type CostModifierScope = (typeof COST_MODIFIER_SCOPES)[number];

export const RETURN_LIMITS = ["firstRaceUnitPerCombat", "oncePerUnitPerCombat"] as const;
export type ReturnLimit = (typeof RETURN_LIMITS)[number];

export type Amount =
  | number
  | { kind: "distinctOwnRaces" }
  | { kind: "selfAttackTimes"; factor: number };

export type StatOverride = Partial<Record<Stat, number>>;

export type Effect =
  | { op: "damage"; amount: Amount; target: UnitTarget; wound?: boolean }
  | { op: "heal"; amount: Amount; target: UnitTarget }
  | { op: "shield"; amount: Amount; target: UnitTarget }
  | { op: "buff"; stat: Stat; amount: Amount; duration: Duration; target: UnitTarget }
  | { op: "stun"; ticks: number; target: UnitTarget }
  | { op: "gainMana"; amount: Amount; target: UnitTarget }
  | { op: "startManaPercent"; amount: Amount; target: UnitTarget; class?: string; when?: Timing }
  | {
      op: "summon";
      token: string;
      count: number;
      where: SummonPlacement;
      statOverride?: StatOverride;
      countsForResonance?: boolean;
    }
  | { op: "move"; target: UnitTarget }
  | { op: "wound"; target: UnitTarget }
  | { op: "gainGold"; amount: Amount; when: Timing; to?: GoldDestination }
  | { op: "stealGold"; amount: Amount; from: PlayerTarget }
  | { op: "giveCurse"; to: PlayerTarget }
  | { op: "trash"; from: TrashSource }
  | { op: "gainLeaderXp"; amount: Amount }
  | { op: "grantKeyword"; keyword: Keyword; duration?: Duration; target: UnitTarget }
  | { op: "costModifier"; amount: Amount; appliesTo: CostModifierScope }
  | { op: "returnOnDeath"; hp: number; limit: ReturnLimit; target: UnitTarget }
  | { op: "onFrontWinOfChosen"; effects: Effect[] };

export type EffectOp = Effect["op"];

export interface Condition {
  kind: ConditionKind;
}

export interface Ability {
  trigger: Trigger;
  name?: string;
  condition?: Condition;
  effects: Effect[];
}

export const ARENA_SCOPES = ["participating", "own"] as const;
export type ArenaScope = (typeof ARENA_SCOPES)[number];

export const PLAYER_CHOICES = ["neighbors"] as const;
export const MOVE_DESTINATIONS = ["ownFreeHex"] as const;

export type TargetSpec =
  | { kind: "hex"; arenas: ArenaScope; mustBeFree?: boolean }
  | { kind: "zone"; arenas: ArenaScope }
  | { kind: "player"; allowed: (typeof PLAYER_CHOICES)[number] }
  | { kind: "handCards"; max: number }
  | { kind: "moveUnits"; count: number; destination: (typeof MOVE_DESTINATIONS)[number] }
  | { kind: "none" };

export interface UnitStats {
  attack: number;
  hp: number;
  breakthrough: number;
  range: number;
  armor?: number;
  attackInterval?: number;
  moveInterval?: number;
  manaMax?: number;
}

export interface AltCost {
  bloodToll?: number;
  gold?: number;
  sacrifice?: number;
}

interface CardBase {
  id: string;
  name: string;
  cost: number;
  /** starter | basic | kingdom | class:<classId> | token */
  pool: string;
  pileSize?: number;
  buyable?: boolean;
}

export interface ResourceCard extends CardBase {
  type: "resource";
  gold: number;
}

export interface UnitCard extends CardBase {
  type: "unit";
  race: string | null;
  class: string;
  stats: UnitStats;
  keywords?: Keyword[];
  abilities?: Ability[];
  altCost?: AltCost;
  starterFor?: string;
}

export interface SpellCard extends CardBase {
  type: "spell";
  slot: "pre" | "post";
  tempo: number;
  target: TargetSpec;
  effects: Effect[];
  condition?: Condition;
}

export interface CurseCard extends CardBase {
  type: "curse";
}

export type CardData = ResourceCard | UnitCard | SpellCard | CurseCard;

export interface RaceData {
  id: string;
  name: string;
  /** Key = number of distinct race cards needed (R-17), value = bonus effects. */
  resonance: Record<string, Effect[]>;
}

export const COMBAT_BEHAVIORS = ["taunt", "default", "backlineJump"] as const;
export type CombatBehavior = (typeof COMBAT_BEHAVIORS)[number];

export interface ClassData {
  id: string;
  name: string;
  combatBehavior: CombatBehavior;
}

/** R-8.2 order categories. */
export const LEADER_CATEGORIES = ["summon", "move", "buff", "damage"] as const;
export type LeaderCategory = (typeof LEADER_CATEGORIES)[number];

export const BRANCH_LEVELS = ["2", "3", "4"] as const;

export interface BranchLevel {
  effects: Effect[];
  zones?: number;
  hexes?: number;
  count?: number;
}

export interface LeaderBranch {
  id: string;
  name: string;
  levels: Record<(typeof BRANCH_LEVELS)[number], BranchLevel>;
}

export interface LeaderActive {
  name: string;
  category: LeaderCategory;
  target: TargetSpec;
  base: { effects: Effect[] };
  branches: LeaderBranch[];
}

export interface LeaderData {
  id: string;
  name: string;
  class: string;
  race: string;
  stats: UnitStats;
  abilities: Ability[];
  active: LeaderActive;
}
