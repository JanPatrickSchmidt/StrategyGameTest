/**
 * Verschmelzen und Sternfaktor (E7d, R-7.8, R-15.1 bis R-15.3).
 */
import type { ConfigData, GameData } from "./data";
import type { UnitStats } from "./dataTypes";
import { emit, type GameState, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

/** Für Gleitkomma-Reste wie 5 × 3,2 = 15,999…: erst runden auf diese Genauigkeit, dann abrunden. */
const EPSILON = 1e-9;

/**
 * R-15.2: Wert einer Einheit mit `stars` Sternen aus dem ★1-Wert. Abgerundet, mindestens der ★1-Wert.
 * Gilt für `attack`, `hp`, `breakthrough` und Schadens-/Schildzahlen der Fähigkeiten.
 */
export function scaleByStars(config: ConfigData, base: number, stars: 1 | 2 | 3): number {
  const scaled = Math.floor(base * config.starMultiplier[stars] + EPSILON);
  return Math.max(base, scaled);
}

/**
 * R-9.2 / R-15.2: Kampfwerte einer Karten-Einheit oder eines Tokens aus den Kartendaten plus Sternfaktor.
 * Nur `attack`, `hp` und `breakthrough` skalieren; die übrigen Werte bleiben wie in den Daten.
 */
export function unitStats(data: GameData, unit: Pick<Unit, "kind" | "sourceId" | "stars">): UnitStats {
  if (unit.kind === "leader") throw new RangeError("Anführer haben keine Sterne (R-15.3); ihre Werte kommen aus leaders.json");
  const card = data.cards.get(unit.sourceId);
  if (!card || card.type !== "unit") throw new RangeError(`Keine Einheitenkarte: ${unit.sourceId}`);
  const base = card.stats;
  return {
    ...base,
    attack: scaleByStars(data.config, base.attack, unit.stars),
    hp: scaleByStars(data.config, base.hp, unit.stars),
    breakthrough: scaleByStars(data.config, base.breakthrough, unit.stars),
  };
}

/** Einheiten, die verschmelzen können: eigene Karten-Einheiten unter ★3 (R-15.1, R-15.3). Brett und Reserve. */
function mergeCandidates(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.kind === "card" && u.stars < 3);
}

/** Mehr XP zuerst, bei Gleichstand kleinste ID (R-15.1). */
function byXpThenId(a: Unit, b: Unit): number {
  return b.xp - a.xp || a.id - b.id;
}

function copyLocation(loc: UnitLocation): UnitLocation {
  return JSON.parse(JSON.stringify(loc)) as UnitLocation;
}

/** Sucht drei gleiche Einheiten (Karten-ID und Stern). Bei mehreren Gruppen zuerst die mit dem kleineren Stern. */
function findTriple(state: GameState, player: PlayerIndex): Unit[] | null {
  const groups = new Map<string, Unit[]>();
  for (const unit of mergeCandidates(state, player)) {
    const key = `${unit.stars}|${unit.sourceId}`;
    const list = groups.get(key) ?? [];
    list.push(unit);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].filter((k) => (groups.get(k) ?? []).length >= 3).sort();
  const first = keys[0];
  if (first === undefined) return null;
  // Sind es mehr als drei (nur über Testaufbauten oder spätere Effekte möglich), verschmelzen die drei
  // mit den meisten XP (Gleichstand: kleinste ID), damit möglichst viel XP erhalten bleibt (R-1.9, F25).
  return (groups.get(first) ?? []).sort(byXpThenId).slice(0, 3);
}

/**
 * R-7.8 / R-15.1: Verschmelzen nach jeder Aktion. Drei eigene Karten-Einheiten mit derselben Karten-ID und
 * demselben Stern (Brett und Reserve zusammen) werden zu einer Einheit mit einem Stern mehr, bis ★3;
 * verkettet sich, bis keine Dreiergruppe mehr übrig ist.
 *
 * Auslegung (F25): Die verschmolzene Einheit behält die ID und das Feld der Einheit mit den meisten XP
 * (Gleichstand: kleinste ID); die beiden anderen verschwinden. So bleiben spätere Aktionen derselben
 * Planung, die sich auf diese Einheit beziehen, gültig.
 *
 * Gibt die IDs der entstandenen Einheiten in Reihenfolge zurück.
 */
export function mergeUnits(state: GameState, player: PlayerIndex): UnitId[] {
  const result: UnitId[] = [];
  for (let triple = findTriple(state, player); triple; triple = findTriple(state, player)) {
    const [keeper, ...others] = triple as [Unit, Unit, Unit];
    const all = [keeper, ...others];
    const fromStars = keeper.stars as 1 | 2;
    keeper.stars = (fromStars + 1) as 2 | 3;
    keeper.xp = all.reduce((sum, u) => sum + u.xp, 0);
    keeper.wounded = all.every((u) => u.wounded);
    keeper.cardInstanceIds = all.flatMap((u) => u.cardInstanceIds);
    // Dauerhafte Buffs aller drei bleiben erhalten (addiert, R-1.9, F31).
    const buffs: NonNullable<Unit["permanentBuffs"]> = {};
    for (const u of all) {
      for (const [stat, amount] of Object.entries(u.permanentBuffs ?? {}) as [keyof typeof buffs, number][]) {
        buffs[stat] = (buffs[stat] ?? 0) + amount;
      }
    }
    if (Object.keys(buffs).length > 0) keeper.permanentBuffs = buffs;
    for (const other of others) delete state.units[other.id];
    emit(state, {
      type: "units_merged",
      player,
      unitId: keeper.id,
      mergedUnitIds: all.map((u) => u.id),
      sourceId: keeper.sourceId,
      stars: keeper.stars,
      xp: keeper.xp,
      wounded: keeper.wounded,
      location: copyLocation(keeper.location),
    });
    result.push(keeper.id);
  }
  return result;
}
