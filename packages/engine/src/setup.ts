/**
 * Partie-Aufbau (R-4).
 */
import type { ConfigData, GameData } from "./data";
import type { CardData } from "./dataTypes";
import { drawStartingHands, shuffleDeck } from "./deck";
import { createRngState } from "./rng";
import {
  type CardInstanceId,
  emit,
  type GameState,
  PLAYER_INDICES,
  type PlayerIndex,
  type PlayerState,
  type Unit,
  type UnitLocation,
} from "./state";

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** R-4.4: Startposition des Anführers, Zone `left`, Feld (Spalte 2, Zeile 1). */
export const LEADER_START_LOCATION: UnitLocation = { zone: "left", cell: { col: 2, row: 1 } };

/** Stapelgröße einer Karte (data/README.md: `pileSize`, sonst aus der Konfiguration). */
export function pileSizeOf(card: CardData, config: ConfigData): number {
  if (card.pileSize !== undefined) return card.pileSize;
  if (card.pool.startsWith("class:")) return config.classPoolPileSize;
  for (const rule of config.pileSizeByCost) {
    if (card.cost <= rule.maxCost) return rule.copies;
  }
  throw new SetupError(`Keine Stapelgröße für Karte ${card.id} (Kosten ${card.cost})`);
}

/** R-4.5: gemeinsame Stapel = alle Basisstapel und alle Königreich-Karten. */
export function createSupply(data: GameData): Record<string, number> {
  const supply: Record<string, number> = {};
  for (const card of data.cards.values()) {
    if (card.pool === "basic" || card.pool === "kingdom") supply[card.id] = pileSizeOf(card, data.config);
  }
  return supply;
}

/** R-4.5: eigener Klassen-Pool eines Spielers (alle Karten mit `pool: class:<Klasse>`). */
export function createClassPool(data: GameData, classId: string): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const card of data.cards.values()) {
    if (card.pool === `class:${classId}`) pool[card.id] = pileSizeOf(card, data.config);
  }
  return pool;
}

/** R-4.2: Karten-IDs des Startdecks in fester Reihenfolge (vor dem Mischen). */
export function startingDeckCardIds(data: GameData, classId: string): string[] {
  const starter = [...data.cards.values()].find(
    (c) => c.type === "unit" && c.pool === "starter" && c.starterFor === classId,
  );
  if (!starter) throw new SetupError(`Kein Klassen-Starter für Klasse ${classId}`);
  const counts = data.config.startingDeck;
  return [
    ...Array<string>(counts.coin).fill("coin"),
    ...Array<string>(counts.recruit).fill("recruit"),
    ...Array<string>(counts.classStarter).fill(starter.id),
  ];
}

/** R-4.1 Standard: Spieler p bekommt den p-ten Anführer der Daten. */
export function defaultLeaders(data: GameData): string[] {
  return [...data.leaders.keys()].slice(0, data.config.players);
}

/**
 * R-4: erzeugt eine neue Partie. `leaders[p]` ist der Anführer von Spieler p.
 * Der Zustand steht danach in Runde 1, Phase `roundStart` (noch nichts gezogen).
 */
export function createGame(data: GameData, leaders: readonly string[] = defaultLeaders(data), seed = 0): GameState {
  const { config } = data;
  if (config.players !== PLAYER_INDICES.length) {
    throw new SetupError(`Der Prototyp unterstützt genau ${PLAYER_INDICES.length} Spieler (R-1.1)`);
  }
  if (leaders.length !== PLAYER_INDICES.length) {
    throw new SetupError(`Es werden genau ${PLAYER_INDICES.length} Anführer benötigt, erhalten: ${leaders.length}`);
  }
  for (const id of leaders) {
    if (!data.leaders.has(id)) throw new SetupError(`Unbekannter Anführer: ${id}`);
  }
  if (!Number.isInteger(seed)) throw new SetupError(`Seed muss eine ganze Zahl sein, war ${seed}`);

  const state: GameState = {
    seed,
    rng: createRngState(seed),
    round: 1,
    phase: "setup",
    players: [],
    cards: {},
    units: {},
    supply: createSupply(data),
    pendingPlanning: PLAYER_INDICES.map(() => null),
    nextCardInstanceId: 1,
    nextUnitId: 1,
    log: [],
  };
  emit(state, { type: "game_created", seed, leaders: [...leaders] });
  emit(state, { type: "supply_created", piles: { ...state.supply } });

  for (const index of PLAYER_INDICES) {
    const leaderId = leaders[index] as string;
    const leaderData = data.leaders.get(leaderId);
    if (!leaderData) throw new SetupError(`Unbekannter Anführer: ${leaderId}`);

    const leaderUnit: Unit = {
      id: state.nextUnitId++,
      owner: index,
      kind: "leader",
      sourceId: leaderId,
      cardInstanceIds: [],
      stars: 1,
      xp: 0,
      wounded: false,
      location: copyLocation(LEADER_START_LOCATION),
    };
    state.units[leaderUnit.id] = leaderUnit;

    const player: PlayerState = {
      index,
      life: config.startingLife,
      power: 0,
      treasury: 0,
      roundGold: 0,
      deck: [],
      hand: [],
      played: [],
      discard: [],
      leader: { leaderId, unitId: leaderUnit.id, xp: 0, level: 1, branchId: null },
      classPool: createClassPool(data, leaderData.class),
      winStreak: 0,
      lossStreak: 0,
      centerStreak: 0,
      nextRound: { cards: 0 },
      eliminated: false,
      placement: null,
    };
    state.players.push(player);
    emit(state, { type: "class_pool_created", player: index, piles: { ...player.classPool } });
    emit(state, {
      type: "unit_placed",
      player: index,
      unitId: leaderUnit.id,
      sourceId: leaderId,
      kind: "leader",
      location: copyLocation(leaderUnit.location),
    });

    const created: CardInstanceId[] = [];
    for (const cardId of startingDeckCardIds(data, leaderData.class)) {
      const id = state.nextCardInstanceId++;
      state.cards[id] = { id, cardId, owner: index };
      player.deck.push(id);
      created.push(id);
    }
    emit(state, { type: "cards_created", player: index, cardInstanceIds: created });
  }

  // Erst alle Decks anlegen, dann in Spielerreihenfolge mischen.
  for (const index of PLAYER_INDICES) shuffleDeck(state, index as PlayerIndex);
  // R-4.6: Starthand nach dem Mischen.
  drawStartingHands(state, config);

  state.phase = "roundStart";
  emit(state, { type: "phase_started", phase: "roundStart" });
  return state;
}

function copyLocation(loc: UnitLocation): UnitLocation {
  switch (loc.zone) {
    case "left":
    case "right":
      return { zone: loc.zone, cell: { ...loc.cell } };
    case "center":
      return { zone: "center", position: loc.position };
    case "reserve":
      return { zone: "reserve", slot: loc.slot };
  }
}
