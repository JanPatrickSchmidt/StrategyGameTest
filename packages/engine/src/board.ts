/**
 * Brett eines Spielers in der Planung (E7a): Felder, Kapazität, Einheit ausspielen, bewegen, genesen
 * (R-3.1, R-3.3, R-3.5, R-3.6, R-7.1, R-7.2, R-7.5).
 */
import type { RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
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

/**
 * R-7.1: Einheit ausspielen. Karte auf der Hand, Einheitenkarte, Zielfeld frei, Kapazität eingehalten,
 * Kosten bezahlt. Alle Prüfungen vor dem Bezahlen, damit eine Ablehnung nichts verändert.
 * Alternative Kosten (R-14.6) folgen in E7b, Kostenboni der Resonanz (R-17.3) in E10.
 */
export function playUnit(
  state: GameState,
  data: GameData,
  player: PlayerIndex,
  cardInstanceId: unknown,
  to: unknown,
  useAltCost: unknown,
): RejectionReason | null {
  const p = getPlayer(state, player);
  if (typeof cardInstanceId !== "number" || !p.hand.includes(cardInstanceId)) return "cardNotInHand";
  if (useAltCost !== undefined && typeof useAltCost !== "boolean") return "malformed";
  if (useAltCost === true) return "notImplemented";
  const card = data.cards.get(getCard(state, cardInstanceId).cardId);
  if (!card || card.type !== "unit") return "notAUnitCard";
  if (!isValidLocation(data.config, to)) return "invalidLocation";
  if (unitAt(state, player, to)) return "cellOccupied";
  if (countsAgainstCapacity({ kind: "card" }, to) && boardCount(state, player) >= capacityFor(data.config, p.leader.level)) {
    return "capacityExceeded";
  }
  const payment = payGold(p, card.cost);
  if (!payment) return "notEnoughGold";

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
