/**
 * Vernichten (R-14.5, E16c2a/E16c2b): Die Einheit verlässt das Brett (oder die Reserve); ihre Karteninstanzen – nach
 * dem Verschmelzen alle drei (R-15.1) – gehen auf den Ablagestapel ihres Besitzers. Tokens haben keine Karte und
 * verschwinden (R-1.4). Feld und Kapazitätsplatz sind sofort frei.
 *
 * Ein vernichteter Anführer (R-1.5) verlässt das Brett ebenfalls, ist in der nächsten Planung nicht verfügbar
 * (keine Anführer-Fähigkeit, keine Anführer-XP) und kehrt zu Beginn der übernächsten Runde mit derselben
 * Einheiten-ID zurück (F55).
 */
import { isValidLocation, sameLocation } from "./board";
import type { GameData } from "./data";
import { leaderStartLocation } from "./setup";
import { emit, getPlayer, type GameState, type PlayerState, type Unit, type UnitLocation } from "./state";

/** Abstand in Runden zwischen Vernichtung und Rückkehr des Anführers (übernächste Planung, R-14.5). */
const LEADER_RETURN_DELAY = 2;

/** R-14.5: vernichtet eine Einheit sofort (Ereignis `unit_destroyed`). */
export function destroyUnit(state: GameState, unit: Unit, cardId: string): void {
  if (state.units[unit.id] !== unit) throw new RangeError(`Einheit ${unit.id} steht nicht auf dem Brett`);
  delete state.units[unit.id];
  const p = getPlayer(state, unit.owner);
  p.discard.push(...unit.cardInstanceIds);
  const returnsInRound = unit.kind === "leader" ? state.round + LEADER_RETURN_DELAY : undefined;
  if (returnsInRound !== undefined) p.leader.returnsInRound = returnsInRound;
  emit(state, {
    type: "unit_destroyed",
    player: unit.owner,
    unitId: unit.id,
    kind: unit.kind,
    sourceId: unit.sourceId,
    cardInstanceIds: [...unit.cardInstanceIds],
    from: copyLocation(unit.location),
    cardId,
    ...(returnsInRound !== undefined ? { returnsInRound } : {}),
  });
}

/**
 * R-14.5 (E16c2b, F55): Zu Rundenbeginn kehren vernichtete Anführer zurück, deren Rückkehr-Runde erreicht ist
 * (Spieler in Spielerreihenfolge). Ort: Startfeld (R-4.4); ist es von einer eigenen Einheit belegt, das erste freie
 * Feld derselben Zone nach kleinstem `(row, col)`, dann der anderen Frontzone, dann der erste freie Reserveplatz.
 * Der Spieler kann ihn in derselben Planung kostenlos versetzen (R-7.2). Der Anführer kommt unverwundet zurück,
 * ohne Wirkungen der Vorrunde. Ist kein Ort frei, wartet er bis zum nächsten Rundenbeginn.
 */
export function returnDestroyedLeaders(state: GameState, data: GameData): void {
  for (const p of state.players) {
    const due = p.leader.returnsInRound;
    if (due === undefined || p.eliminated || state.round < due) continue;
    const location = returnLocation(state, data, p);
    if (!location) continue;
    delete p.leader.returnsInRound;
    const unit: Unit = {
      id: p.leader.unitId,
      owner: p.index,
      kind: "leader",
      sourceId: p.leader.leaderId,
      cardInstanceIds: [],
      stars: 1,
      xp: 0,
      wounded: false,
      restedInReserve: false,
      location,
    };
    state.units[unit.id] = unit;
    emit(state, { type: "leader_returned", player: p.index, unitId: unit.id, leaderId: p.leader.leaderId, location: copyLocation(location) });
  }
}

function returnLocation(state: GameState, data: GameData, p: PlayerState): UnitLocation | undefined {
  const { config } = data;
  const start = leaderStartLocation(config);
  const zones: ("left" | "right")[] = start.zone === "left" ? ["left", "right"] : ["right", "left"];
  const candidates: UnitLocation[] = [start];
  const { cols, rows } = config.arenas.frontZone;
  for (const zone of zones) {
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) candidates.push({ zone, cell: { col, row } });
  }
  for (let slot = 0; slot < config.reserveSlots; slot++) candidates.push({ zone: "reserve", slot });
  const own = Object.values(state.units).filter((u) => u.owner === p.index);
  return candidates.find((loc) => isValidLocation(config, loc) && own.every((u) => !sameLocation(u.location, loc)));
}

function copyLocation(loc: UnitLocation): UnitLocation {
  if (loc.zone === "center") return { zone: "center", position: loc.position };
  if (loc.zone === "reserve") return { zone: "reserve", slot: loc.slot };
  return { zone: loc.zone, cell: { col: loc.cell.col, row: loc.cell.row } };
}
