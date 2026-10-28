/**
 * Loads and validates the game content from packages/engine/data (E2).
 */
import configJson from "../data/config.json";
import cardsJson from "../data/cards.json";
import leadersJson from "../data/leaders.json";
import racesJson from "../data/races.json";
import classesJson from "../data/classes.json";
import type { CardData, ClassData, LeaderData, RaceData } from "./dataTypes";
import { formatIssues, type RawGameData, type ValidationIssue, validateGameData } from "./validate";

export * from "./dataTypes";

export type ConfigData = typeof configJson;

export interface GameData {
  config: ConfigData;
  cards: ReadonlyMap<string, CardData>;
  leaders: ReadonlyMap<string, LeaderData>;
  races: ReadonlyMap<string, RaceData>;
  classes: ReadonlyMap<string, ClassData>;
}

export class GameDataError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Ungültige Spieldaten (${issues.length} Fehler):\n${formatIssues(issues)}`);
    this.name = "GameDataError";
  }
}

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Validates raw data and returns it typed. Throws GameDataError with all issues if invalid. */
export function parseGameData(raw: RawGameData): GameData {
  const issues = validateGameData(raw);
  if (issues.length > 0) throw new GameDataError(issues);
  // The validator has checked exactly the shapes described in dataTypes.ts.
  const valid = raw as {
    config: ConfigData;
    cards: { cards: CardData[] };
    leaders: LeaderData[];
    races: RaceData[];
    classes: ClassData[];
  };
  return {
    config: valid.config,
    cards: indexById(valid.cards.cards),
    leaders: indexById(valid.leaders),
    races: indexById(valid.races),
    classes: indexById(valid.classes),
  };
}

/** The real data files of the repository. */
export function rawGameData(): RawGameData {
  return { config: configJson, cards: cardsJson, leaders: leadersJson, races: racesJson, classes: classesJson };
}

export function loadGameData(): GameData {
  return parseGameData(rawGameData());
}
