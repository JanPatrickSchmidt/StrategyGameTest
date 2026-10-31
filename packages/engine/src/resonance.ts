/**
 * Rassen-Resonanz im Kampf (E10c1, Spec R-17.1, R-17.2).
 *
 * - Zählung (R-17.1): verschiedene Karten-IDs (bzw. Anführer-IDs) einer Rasse unter den nicht verwundeten
 *   Einheiten eines Spielers in `left`, `right` und `center`, inklusive Anführer, ohne Tokens.
 * - Stufe: die höchste Schwelle aus `races.json`, die erreicht ist. Es gelten nur die Effekte dieser Stufe
 *   (die Daten der Stufe 4 enthalten die Effekte der Stufe 2 schon in verstärkter Form, F33).
 * - Kampfboni (R-17.2): `buff` (Werte), `startManaPercent` und `grantKeyword` mit Ziel `raceUnits` wirken in
 *   allen Kämpfen der Runde auf alle Einheiten dieser Rasse des Spielers, auch auf Tokens und im Kampf
 *   erzeugte Tokens (R-1.9). Maßgeblich ist das Brett zu Beginn der Kampfphase, also nach dem Aufdecken.
 * Kostenbonus (R-17.3), Rundenwirkungen (R-17.4) und Bonus-XP (R-17.5) folgen mit E10c2–E10c4.
 */
import type { FighterInit } from "./combat";
import type { GameData } from "./data";

type GameConfig = GameData["config"];
import type { Effect, Keyword, Stat } from "./dataTypes";
import { emit, type GameState, getPlayer, type PlayerIndex, type Unit } from "./state";
import { priorityForRound } from "./marks";

/** Erreichte Resonanzstufe einer Rasse für einen Spieler. */
export interface ResonanceTier {
  race: string;
  /** Anzahl verschiedener Karten-IDs nach R-17.1. */
  count: number;
  /** Erreichte Schwelle (z. B. 2 oder 4). */
  tier: number;
  effects: readonly Effect[];
}

/** Kampfboni einer Rasse für eine Einheit (R-17.2). */
export interface ResonanceBonus {
  buffs: Partial<Record<Stat, number>>;
  keywords: Keyword[];
  startManaPercent: number;
}

/** Rasse einer Einheit des Spielzustands (Karte, Token bzw. Anführer). */
export function unitRace(data: GameData, unit: Unit): string | null {
  if (unit.kind === "leader") return data.leaders.get(unit.sourceId)?.race ?? null;
  const card = data.cards.get(unit.sourceId);
  return card && card.type === "unit" ? card.race : null;
}

/** R-17.1: verschiedene Karten-IDs je Rasse (nur Rassen mit mindestens einer Einheit). */
export function resonanceCounts(state: GameState, data: GameData, player: PlayerIndex): Map<string, number> {
  const ids = new Map<string, Set<string>>();
  if (getPlayer(state, player).eliminated) return new Map();
  for (const unit of Object.values(state.units)) {
    if (unit.owner !== player || unit.kind === "token" || unit.wounded) continue;
    if (unit.location.zone === "reserve") continue;
    const race = unitRace(data, unit);
    if (race === null) continue;
    let set = ids.get(race);
    if (!set) ids.set(race, (set = new Set()));
    set.add(unit.sourceId);
  }
  return new Map([...ids].map(([race, set]) => [race, set.size]));
}

/** Höchste erreichte Schwelle einer Rasse (0 = keine). */
export function resonanceTier(data: GameData, race: string, count: number): number {
  const raceData = data.races.get(race);
  if (!raceData) return 0;
  let tier = 0;
  for (const key of Object.keys(raceData.resonance)) {
    const threshold = Number(key);
    if (count >= threshold && threshold > tier) tier = threshold;
  }
  return tier;
}

/** Alle erreichten Resonanzstufen eines Spielers, nach Rassen-ID sortiert. */
export function activeResonance(state: GameState, data: GameData, player: PlayerIndex): ResonanceTier[] {
  const result: ResonanceTier[] = [];
  for (const [race, count] of resonanceCounts(state, data, player)) {
    const tier = resonanceTier(data, race, count);
    if (tier === 0) continue;
    const effects = data.races.get(race)?.resonance[String(tier)] ?? [];
    result.push({ race, count, tier, effects });
  }
  return result.sort((a, b) => (a.race < b.race ? -1 : a.race > b.race ? 1 : 0));
}

/** R-17.2: Kampfboni der aktiven Resonanzen für eine Einheit der Rasse `race`. */
export function resonanceBonus(tiers: readonly ResonanceTier[], race: string | null | undefined): ResonanceBonus {
  const bonus: ResonanceBonus = { buffs: {}, keywords: [], startManaPercent: 0 };
  if (!race) return bonus;
  for (const tier of tiers) {
    if (tier.race !== race) continue;
    for (const effect of tier.effects) {
      if (effect.op === "buff" && effect.target === "raceUnits" && typeof effect.amount === "number") {
        bonus.buffs[effect.stat] = (bonus.buffs[effect.stat] ?? 0) + effect.amount;
      } else if (effect.op === "startManaPercent" && effect.target === "raceUnits" && typeof effect.amount === "number") {
        if (effect.when === undefined || effect.when === "now") bonus.startManaPercent += effect.amount;
      } else if (effect.op === "grantKeyword" && effect.target === "raceUnits") {
        if (!bonus.keywords.includes(effect.keyword)) bonus.keywords.push(effect.keyword);
      }
    }
  }
  return bonus;
}

const MIN_ONE: ReadonlySet<Stat> = new Set<Stat>(["hp", "attackInterval", "moveInterval", "manaMax", "range"]);

/**
 * Addiert feste Zuschläge auf Kampfwerte (dauerhafte Buffs, Resonanz). Fehlende Werte gelten mit ihrem
 * Standard aus `config.combat`; Lebenspunkte, Intervalle, Mana und Reichweite bleiben mindestens 1.
 */
export function addStatBonuses(
  config: GameConfig,
  stats: FighterInit["stats"],
  bonuses: Partial<Record<Stat, number>>,
): FighterInit["stats"] {
  const c = config.combat;
  const base: Record<Stat, number> = {
    attack: stats.attack,
    hp: stats.hp,
    breakthrough: stats.breakthrough,
    range: stats.range,
    armor: stats.armor ?? 0,
    attackInterval: stats.attackInterval ?? c.defaultAttackInterval,
    moveInterval: stats.moveInterval ?? c.defaultMoveInterval,
    manaMax: stats.manaMax ?? c.defaultManaMax,
  };
  const result = { ...stats };
  for (const [stat, amount] of Object.entries(bonuses) as [Stat, number][]) {
    result[stat] = Math.max(MIN_ONE.has(stat) ? 1 : 0, base[stat] + amount);
  }
  return result;
}

/**
 * Wendet Resonanz-Werte und -Schlüsselwörter auf einen Kämpfer an. Start-Mana wird hier nicht gesetzt,
 * sondern von der aufrufenden Stelle mit anderen Prozenten (Markierungen, R-17a.2) zusammengerechnet.
 */
export function applyResonanceStats(config: GameConfig, init: Omit<FighterInit, "id" | "pos">, bonus: ResonanceBonus): void {
  if (Object.keys(bonus.buffs).length > 0) init.stats = addStatBonuses(config, init.stats, bonus.buffs);
  if (bonus.keywords.length > 0) {
    const keywords = [...(init.keywords ?? [])];
    for (const k of bonus.keywords) if (!keywords.includes(k)) keywords.push(k);
    init.keywords = keywords;
  }
}

/** Start-Mana aus Prozenten von `manaMax` (abgerundet) addieren. */
export function addStartManaPercent(config: GameConfig, init: Omit<FighterInit, "id" | "pos">, percent: number): void {
  if (percent <= 0) return;
  const manaMax = init.stats.manaMax ?? config.combat.defaultManaMax;
  init.startMana = (init.startMana ?? 0) + Math.floor((manaMax * percent) / 100 + 1e-9);
}

/**
 * Für im Kampf erzeugte Tokens (z. B. Kesselflicker): Resonanz-Boni des Besitzers anwenden. `team` ist
 * der Spielerindex. Die Stufen werden einmal je Kampfphase aus dem Spielzustand berechnet.
 */
export function resonanceSummonAdjuster(
  state: GameState,
  data: GameData,
): (init: Omit<FighterInit, "id" | "pos">) => void {
  const cache = new Map<number, ResonanceTier[]>();
  return (init) => {
    let tiers = cache.get(init.team);
    if (!tiers) {
      tiers = activeResonance(state, data, init.team as PlayerIndex);
      cache.set(init.team, tiers);
    }
    const bonus = resonanceBonus(tiers, init.race);
    applyResonanceStats(data.config, init, bonus);
    addStartManaPercent(data.config, init, bonus.startManaPercent);
  };
}

/**
 * Kampfbeginn (R-17.2): meldet je Spieler (Prioritätsreihenfolge) und Rasse die erreichte Stufe und die
 * betroffenen Einheiten unter den Teilnehmern. Die Wirkung selbst steckt in `fighterForUnit`.
 */
export function announceResonance(state: GameState, data: GameData, participants: readonly Unit[]): void {
  for (const player of priorityForRound(state.round)) {
    for (const tier of activeResonance(state, data, player)) {
      const unitIds = participants
        .filter((u) => u.owner === player && unitRace(data, u) === tier.race)
        .map((u) => u.id)
        .sort((a, b) => a - b);
      emit(state, { type: "resonance_active", player, race: tier.race, count: tier.count, tier: tier.tier, unitIds });
    }
  }
}
