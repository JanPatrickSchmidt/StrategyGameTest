/**
 * Brett eines Spielers in der Planung (E7a): Felder, Kapazität, Einheit ausspielen, bewegen, genesen
 * (R-3.1, R-3.3, R-3.5, R-3.6, R-7.1, R-7.2, R-7.5), alternative Kosten (R-14.6, E7b) und
 * Genesung durch Reserve (R-6.5, E7b).
 */
import type { RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
import type { CardData } from "./dataTypes";
import { payGold } from "./economy";
import { inBounds } from "./hex";
import { emit, type GameState, getCard, getPlayer, type PlayerIndex, type Unit, type UnitLocation } from "./state";

/** Zonen, die gegen die Kapazität zählen (R-3.6). */
const BOARD_ZONES = new Set(["left", "right", "center"]);

/** R-3.6: Kapazität = Grundwert + Boni der erreichten Anführer-Stufen. */
export function capacityFor(config: ConfigData, leaderLevel: number): number {
  let capacity = config.boardCapacity;
  for (const [level, bonus] of Object.entries(config.capacityBonusAtLeaderLevel)) {
    if (leaderLevel >= Number(level)) capacity += bonus;
  }
  return capacity;
}

/** R-3.6: zählt eine Einheit gegen die Kapazität, wenn sie dort stünde? Anführer und Tokens nicht. */
export function countsAgainstCapacity(unit: Pick<Unit, "kind">, location: UnitLocation): boolean {
  return unit.kind === "card" && BOARD_ZONES.has(location.zone);
}

/** Anzahl der Einheiten eines Spielers, die gegen die Kapazität zählen (verwundete eingeschlossen, R-14.4). */
export function boardCount(state: GameState, player: PlayerIndex): number {
  return ownUnits(state, player).filter((u) => countsAgainstCapacity(u, u.location)).length;
}

export function ownUnits(state: GameState, player: PlayerIndex): Unit[] {
  return Object.values(state.units).filter((u) => u.owner === player);
}

/** Prüft Form und Grenzen eines Ortes (R-3.1 Frontzone, R-3.3 Mittelzone, R-3.5 Reserve). */
export function isValidLocation(config: ConfigData, loc: unknown): loc is UnitLocation {
  if (typeof loc !== "object" || loc === null) return false;
  const l = loc as Record<string, unknown>;
  const isIndex = (v: unknown, max: number): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max;
  switch (l.zone) {
    case "left":
    case "right": {
      const cell = l.cell as Record<string, unknown> | null | undefined;
      if (typeof cell !== "object" || cell === null) return false;
      const { cols, rows } = config.arenas.frontZone;
      return isIndex(cell.col, cols) && isIndex(cell.row, rows) && inBounds({ col: cell.col as number, row: cell.row as number }, { cols, rows });
    }
    case "center":
      return isIndex(l.position, config.arenas.centerStartSlots);
    case "reserve":
      return isIndex(l.slot, config.reserveSlots);
    default:
      return false;
  }
}

export function sameLocation(a: UnitLocation, b: UnitLocation): boolean {
  if (a.zone !== b.zone) return false;
  switch (a.zone) {
    case "left":
    case "right":
      return b.zone === a.zone && a.cell.col === b.cell.col && a.cell.row === b.cell.row;
    case "center":
      return b.zone === "center" && a.position === b.position;
    case "reserve":
      return b.zone === "reserve" && a.slot === b.slot;
  }
}

/** Einheit eines Spielers auf einem Ort, falls vorhanden. */
export function unitAt(state: GameState, player: PlayerIndex, loc: UnitLocation): Unit | undefined {
  return ownUnits(state, player).find((u) => sameLocation(u.location, loc));
}

function copyLocation(loc: UnitLocation): UnitLocation {
  switch (loc.zone) {
    case "left":
    case "right":
      return { zone: loc.zone, cell: { col: loc.cell.col, row: loc.cell.row } };
    case "center":
      return { zone: "center", position: loc.position };
    case "reserve":
      return { zone: "reserve", slot: loc.slot };
  }
}

/** R-14.6: geprüfte Kosten einer Ausspielaktion, noch nicht bezahlt. */
interface UnitCost {
  gold: number;
  life: number;
  sacrifice: Unit[];
  altCost: boolean;
}

/**
 * R-14.6: prüft die gewählten Kosten. Ohne `useAltCost` zählen die normalen Goldkosten. Mit
 * `useAltCost` gelten die alternativen Kosten der Karte: `gold` (Standard 0), `bloodToll(n)` und
 * `sacrifice(n)` mit genau n gewählten eigenen Karten-Einheiten (nicht Anführer, nicht Tokens).
 * Auslegung (F19, F20): Nach dem Blutzoll muss mindestens 1 Leben bleiben; Opfer dürfen auf dem Brett
 * oder in der Reserve stehen, auch verwundet.
 */
function checkUnitCost(
  state: GameState,
  player: PlayerIndex,
  card: CardData,
  useAltCost: unknown,
  sacrifice: unknown,
): UnitCost | RejectionReason {
  if (useAltCost !== undefined && typeof useAltCost !== "boolean") return "malformed";
  if (sacrifice !== undefined && !Array.isArray(sacrifice)) return "malformed";
  if (useAltCost !== true) {
    if (sacrifice !== undefined && sacrifice.length > 0) return "malformed";
    return { gold: card.cost, life: 0, sacrifice: [], altCost: false };
  }
  const alt = card.type === "unit" ? card.altCost : undefined;
  if (!alt) return "noAltCost";
  const life = alt.bloodToll ?? 0;
  if (life > 0 && getPlayer(state, player).life <= life) return "notEnoughLife";
  const wanted = alt.sacrifice ?? 0;
  const chosen = sacrifice ?? [];
  if (chosen.length !== wanted) return "wrongSacrificeCount";
  const victims: Unit[] = [];
  for (const id of chosen) {
    const unit = typeof id === "number" ? state.units[id] : undefined;
    if (!unit || unit.owner !== player || unit.kind !== "card" || victims.includes(unit)) return "invalidSacrifice";
    victims.push(unit);
  }
  return { gold: alt.gold ?? 0, life, sacrifice: victims, altCost: true };
}

/**
 * R-7.1: Einheit ausspielen. Karte auf der Hand, Einheitenkarte, Zielfeld frei, Kapazität eingehalten,
 * Kosten bezahlt (normal oder alternativ, R-14.6). Alle Prüfungen vor dem Bezahlen, damit eine
 * Ablehnung nichts verändert. Geopferte Einheiten machen ihr Feld und ihren Kapazitätsplatz schon für
 * diese Aktion frei (R-1.9). Kostenboni der Resonanz (R-17.3) folgen in E10.
 */
export function playUnit(
  state: GameState,
  data: GameData,
  player: PlayerIndex,
  cardInstanceId: unknown,
  to: unknown,
  useAltCost: unknown,
  sacrifice?: unknown,
): RejectionReason | null {
  const p = getPlayer(state, player);
  if (typeof cardInstanceId !== "number" || !p.hand.includes(cardInstanceId)) return "cardNotInHand";
  const card = data.cards.get(getCard(state, cardInstanceId).cardId);
  if (!card || card.type !== "unit") return "notAUnitCard";
  const cost = checkUnitCost(state, player, card, useAltCost, sacrifice);
  if (typeof cost === "string") return cost;
  if (!isValidLocation(data.config, to)) return "invalidLocation";
  const occupant = unitAt(state, player, to);
  if (occupant && !cost.sacrifice.includes(occupant)) return "cellOccupied";
  const freed = cost.sacrifice.filter((u) => countsAgainstCapacity(u, u.location)).length;
  if (
    countsAgainstCapacity({ kind: "card" }, to) &&
    boardCount(state, player) - freed >= capacityFor(data.config, p.leader.level)
  ) {
    return "capacityExceeded";
  }
  const payment = payGold(p, cost.gold);
  if (!payment) return "notEnoughGold";

  if (cost.life > 0) {
    p.life -= cost.life;
    emit(state, { type: "life_paid", player, amount: cost.life, life: p.life, cardInstanceId });
  }
  for (const victim of cost.sacrifice) {
    delete state.units[victim.id];
    p.discard.push(...victim.cardInstanceIds);
    emit(state, {
      type: "unit_sacrificed",
      player,
      unitId: victim.id,
      cardInstanceIds: [...victim.cardInstanceIds],
      from: copyLocation(victim.location),
    });
  }
  p.hand = p.hand.filter((id) => id !== cardInstanceId);
  const unit: Unit = {
    id: state.nextUnitId++,
    owner: player,
    kind: "card",
    sourceId: card.id,
    cardInstanceIds: [cardInstanceId],
    stars: 1,
    xp: 0,
    wounded: false,
    restedInReserve: false,
    location: copyLocation(to),
  };
  state.units[unit.id] = unit;
  emit(state, {
    type: "unit_played",
    player,
    unitId: unit.id,
    cardInstanceId,
    sourceId: card.id,
    location: copyLocation(to),
    paidFromRoundGold: payment.fromRoundGold,
    paidFromTreasury: payment.fromTreasury,
    altCost: cost.altCost,
  });
  return null;
}

/** R-7.2: Einheit bewegen, kostenlos, auch zwischen Zonen und von/in die Reserve; gilt auch für den Anführer. */
export function moveUnit(state: GameState, data: GameData, player: PlayerIndex, unitId: unknown, to: unknown): RejectionReason | null {
  const unit = typeof unitId === "number" ? state.units[unitId] : undefined;
  if (!unit) return "unknownUnit";
  if (unit.owner !== player) return "notOwnUnit";
  if (!isValidLocation(data.config, to)) return "invalidLocation";
  if (sameLocation(unit.location, to)) return "sameLocation";
  if (unitAt(state, player, to)) return "cellOccupied";
  const p = getPlayer(state, player);
  const addsToBoard = countsAgainstCapacity(unit, to) && !countsAgainstCapacity(unit, unit.location);
  if (addsToBoard && boardCount(state, player) >= capacityFor(data.config, p.leader.level)) return "capacityExceeded";

  const from = copyLocation(unit.location);
  unit.location = copyLocation(to);
  unit.restedInReserve = false;
  emit(state, { type: "unit_moved", player, unitId: unit.id, from, to: copyLocation(to) });
  return null;
}

/** R-7.5: Genesen für 1 Gold pro Stern. */
export function healUnit(state: GameState, data: GameData, player: PlayerIndex, unitId: unknown): RejectionReason | null {
  const unit = typeof unitId === "number" ? state.units[unitId] : undefined;
  if (!unit) return "unknownUnit";
  if (unit.owner !== player) return "notOwnUnit";
  if (!unit.wounded) return "notWounded";
  const payment = payGold(getPlayer(state, player), data.config.healCostPerStar * unit.stars);
  if (!payment) return "notEnoughGold";
  unit.wounded = false;
  emit(state, {
    type: "unit_healed",
    player,
    unitId: unit.id,
    paidFromRoundGold: payment.fromRoundGold,
    paidFromTreasury: payment.fromTreasury,
  });
  return null;
}

/** R-6.5: beim Aufdecken merken, welche Einheiten in der Reserve stehen (nach allen Planungen). */
export function markReserveRest(state: GameState): void {
  for (const unit of Object.values(state.units)) unit.restedInReserve = unit.location.zone === "reserve";
}

/**
 * R-6.5: Rundenbeginn. Verwundete Einheiten, die seit dem Aufdecken der Vorrunde ununterbrochen in
 * der Reserve stehen, sind nicht mehr verwundet. Danach wird die Markierung für die neue Runde gelöscht.
 */
export function recoverInReserve(state: GameState): void {
  for (const unit of Object.values(state.units)) {
    if (unit.wounded && unit.restedInReserve && unit.location.zone === "reserve") {
      unit.wounded = false;
      emit(state, { type: "unit_recovered", player: unit.owner, unitId: unit.id });
    }
    unit.restedInReserve = false;
  }
}
