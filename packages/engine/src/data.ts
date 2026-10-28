/**
 * Loads the game content from packages/engine/data.
 * Types are intentionally loose for now; E2 (Datenvalidierung) tightens them
 * and adds reference checks.
 */
import configJson from "../data/config.json";
import cardsJson from "../data/cards.json";
import leadersJson from "../data/leaders.json";
import racesJson from "../data/races.json";
import classesJson from "../data/classes.json";

export type CardType = "resource" | "unit" | "spell" | "curse";

export interface CardData {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  pool: string;
  [key: string]: unknown;
}

export interface LeaderData {
  id: string;
  name: string;
  class: string;
  race: string;
  [key: string]: unknown;
}

export interface RaceData {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ClassData {
  id: string;
  name: string;
  combatBehavior: string;
}

export interface GameData {
  config: typeof configJson;
  cards: ReadonlyMap<string, CardData>;
  leaders: ReadonlyMap<string, LeaderData>;
  races: ReadonlyMap<string, RaceData>;
  classes: ReadonlyMap<string, ClassData>;
}

function indexById<T extends { id: string }>(items: readonly T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Doppelte ${label}-ID: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

export function loadGameData(): GameData {
  return {
    config: configJson,
    cards: indexById(cardsJson.cards as CardData[], "Karten"),
    leaders: indexById(leadersJson as LeaderData[], "Anführer"),
    races: indexById(racesJson as RaceData[], "Rassen"),
    classes: indexById(classesJson as ClassData[], "Klassen"),
  };
}
