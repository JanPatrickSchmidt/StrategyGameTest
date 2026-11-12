/**
 * E16c3, R-19.1: Abgleich von Zustandsänderungen gegen das Ereignisprotokoll.
 *
 * Ein Schnappschuss hält die prüfbaren Teile des Zustands fest (Leben, Machtpunkte, Schatzkammer, Hand,
 * Ablagestapel je Spieler und den Ort jeder Einheit). `auditPhase` spielt die Ereignisse einer Phase auf dem
 * Schnappschuss vom Anfang der Phase nach und vergleicht das Ergebnis mit dem Schnappschuss vom Ende. Jede
 * Abweichung ist eine Zustandsänderung ohne (passendes) Ereignis. Werte, die ein Ereignis absolut meldet
 * (z. B. `treasury`, `life`), werden beim Nachspielen zusätzlich gegen den nachgerechneten Stand geprüft.
 *
 * Das Modul ist rein und für Tests und Werkzeuge gedacht; die Engine selbst benutzt es nicht.
 */
import type { CardInstanceId, GameEvent, GameState, Phase, PlayerIndex, UnitId, UnitLocation } from "./state";

export interface PlayerSnapshot {
  life: number;
  power: number;
  treasury: number;
  hand: CardInstanceId[];
  discard: CardInstanceId[];
}

export interface AuditSnapshot {
  players: PlayerSnapshot[];
  /** Einheiten-ID → Ort (als JSON-Text, damit der Vergleich unabhängig von der Feldreihenfolge ist). */
  units: Map<UnitId, string>;
}

/** Kanonische Textform eines Orts (feste Feldreihenfolge). */
export function locationKey(location: UnitLocation): string {
  switch (location.zone) {
    case "left":
    case "right":
      return `${location.zone}:${location.cell.col},${location.cell.row}`;
    case "center":
      return `center:${location.position}`;
    case "reserve":
      return `reserve:${location.slot}`;
  }
}

export function takeSnapshot(state: Readonly<GameState>): AuditSnapshot {
  return {
    players: state.players.map((p) => ({
      life: p.life,
      power: p.power,
      treasury: p.treasury,
      hand: [...p.hand],
      discard: [...p.discard],
    })),
    units: new Map(Object.values(state.units).map((u) => [u.id, locationKey(u.location)])),
  };
}

function cloneSnapshot(s: AuditSnapshot): AuditSnapshot {
  return {
    players: s.players.map((p) => ({ ...p, hand: [...p.hand], discard: [...p.discard] })),
    units: new Map(s.units),
  };
}

function sortedIds(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

/**
 * Spielt die Ereignisse einer Phase auf `before` nach und meldet jede Abweichung von `after` als Text.
 * Leere Liste = alle beobachteten Änderungen sind durch Ereignisse erklärt.
 */
export function auditPhase(before: AuditSnapshot, after: AuditSnapshot, events: readonly GameEvent[], phase: Phase): string[] {
  const findings: string[] = [];
  const model = cloneSnapshot(before);
  const player = (i: PlayerIndex): PlayerSnapshot => {
    const p = model.players[i];
    if (!p) throw new RangeError(`Spieler ${i} fehlt im Schnappschuss`);
    return p;
  };
  const expectValue = (event: GameEvent, i: PlayerIndex, field: "life" | "power" | "treasury", reported: number): void => {
    const actual = player(i)[field];
    if (actual !== reported) {
      findings.push(`${phase}: ${event.type} meldet ${field} ${reported} für Spieler ${i}, nachgerechnet ${actual}`);
      player(i)[field] = reported;
    }
  };
  const removeFrom = (list: CardInstanceId[], id: CardInstanceId): void => {
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
  };
  const removeFromHand = (i: PlayerIndex, ids: readonly CardInstanceId[]): void => {
    for (const id of ids) removeFrom(player(i).hand, id);
  };
  const setLocation = (unitId: UnitId, location: UnitLocation): void => {
    model.units.set(unitId, locationKey(location));
  };

  for (const event of events) {
    switch (event.type) {
      // Schatzkammer
      case "interest_paid":
      case "bonus_interest_paid":
      case "gold_gained":
      case "gold_deposited":
        player(event.player).treasury += event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        break;
      case "gold_withdrawn":
        player(event.player).treasury -= event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        break;
      case "gold_stolen":
        player(event.player).treasury += event.amount;
        player(event.from).treasury -= event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        expectValue(event, event.from, "treasury", event.fromTreasury);
        break;
      case "purchase_paid":
      case "unit_healed":
        player(event.player).treasury -= event.paidFromTreasury;
        break;
      case "spell_set":
        player(event.player).treasury -= event.paidFromTreasury;
        removeFromHand(event.player, [event.cardInstanceId]);
        break;
      case "unit_played":
        player(event.player).treasury -= event.paidFromTreasury;
        removeFromHand(event.player, [event.cardInstanceId]);
        setLocation(event.unitId, event.location);
        break;
      // Leben und Machtpunkte
      case "life_paid":
        player(event.player).life -= event.amount;
        expectValue(event, event.player, "life", event.life);
        break;
      case "breakthrough_damage":
        player(event.loser).life -= event.amount;
        expectValue(event, event.loser, "life", event.life);
        break;
      case "power_gained":
        player(event.player).power += event.amount;
        expectValue(event, event.player, "power", event.power);
        break;
      case "player_eliminated":
        expectValue(event, event.player, "life", event.life);
        expectValue(event, event.player, "power", event.power);
        break;
      // Hand und Ablagestapel
      case "cards_drawn":
        player(event.player).hand.push(...event.cardInstanceIds);
        break;
      case "resources_played":
        removeFromHand(event.player, event.cardInstanceIds);
        break;
      case "hand_discarded":
        removeFromHand(event.player, event.cardInstanceIds);
        player(event.player).discard.push(...event.cardInstanceIds);
        break;
      case "spell_discarded":
        player(event.player).discard.push(event.cardInstanceId);
        break;
      case "discard_reshuffled":
        player(event.player).discard = [];
        break;
      case "cards_trashed":
        for (const c of event.cards) if (c.from === "discard") removeFrom(player(event.player).discard, c.cardInstanceId);
        break;
      case "card_bought":
        player(event.player).discard.push(event.cardInstanceId);
        break;
      case "curse_given":
        player(event.to).discard.push(event.cardInstanceId);
        break;
      // Einheiten
      case "unit_placed":
      case "unit_summoned":
      case "leader_returned":
        setLocation(event.unitId, event.location);
        break;
      case "unit_moved":
      case "unit_returned":
        setLocation(event.unitId, event.to);
        break;
      case "units_merged":
        for (const id of event.mergedUnitIds) if (id !== event.unitId) model.units.delete(id);
        setLocation(event.unitId, event.location);
        break;
      case "unit_sacrificed":
        model.units.delete(event.unitId);
        player(event.player).discard.push(...event.cardInstanceIds);
        break;
      case "unit_destroyed":
        model.units.delete(event.unitId);
        player(event.player).discard.push(...event.cardInstanceIds);
        break;
      case "token_removed":
      case "unit_removed":
        model.units.delete(event.unitId);
        break;
      default:
        break;
    }
  }

  model.players.forEach((m, i) => {
    const a = after.players[i];
    if (!a) return;
    for (const field of ["life", "power", "treasury"] as const) {
      if (m[field] !== a[field]) findings.push(`${phase}: ${field} von Spieler ${i} ist ${a[field]}, aus Ereignissen ${m[field]}`);
    }
    if (sortedIds(m.hand) !== sortedIds(a.hand)) findings.push(`${phase}: Hand von Spieler ${i} ist [${sortedIds(a.hand)}], aus Ereignissen [${sortedIds(m.hand)}]`);
    if (sortedIds(m.discard) !== sortedIds(a.discard)) {
      findings.push(`${phase}: Ablagestapel von Spieler ${i} ist [${sortedIds(a.discard)}], aus Ereignissen [${sortedIds(m.discard)}]`);
    }
  });
  const ids = new Set([...model.units.keys(), ...after.units.keys()]);
  for (const id of [...ids].sort((x, y) => x - y)) {
    const expected = model.units.get(id);
    const actual = after.units.get(id);
    if (expected !== actual) findings.push(`${phase}: Einheit ${id} steht auf ${actual ?? "—"}, aus Ereignissen ${expected ?? "—"}`);
  }
  return findings;
}

/**
 * Beobachter für `advance`/`playBotGame` (`onPhaseEnd`): prüft jede Phase und sammelt die Befunde.
 * `start` muss mit dem Zustand vor dem ersten `advance` aufgerufen werden (bei `playBotGame` über `onGameCreated`).
 */
export class EventAuditor {
  readonly findings: string[] = [];
  phases = 0;
  private snapshot: AuditSnapshot | null = null;
  private logIndex = 0;

  readonly start = (state: Readonly<GameState>): void => {
    this.snapshot = takeSnapshot(state);
    this.logIndex = state.log.length;
  };

  readonly onPhaseEnd = (state: Readonly<GameState>, phase: Phase): void => {
    if (!this.snapshot) throw new Error("EventAuditor.start wurde nicht aufgerufen");
    const after = takeSnapshot(state);
    const events = state.log.slice(this.logIndex);
    for (const f of auditPhase(this.snapshot, after, events, phase)) this.findings.push(`Runde ${state.round}, ${f}`);
    this.snapshot = after;
    this.logIndex = state.log.length;
    this.phases += 1;
  };
}
