/**
 * E16c3, R-19.1: Abgleich von Zustandsänderungen gegen das Ereignisprotokoll.
 *
 * Ein Schnappschuss hält die prüfbaren Teile des Zustands fest (P9): je Spieler Leben, Machtpunkte, Schatzkammer,
 * Rundenvorrat, Hand, Deck, ausgespielte Karten, Ablagestapel, gelegte Zauber, Klassen-Pool, Serien sowie XP, Stufe
 * und Ast des Anführers; dazu die Vorratsstapel und je Einheit Ort, Verwundung, Sterne und XP. `auditPhase` spielt die Ereignisse einer Phase auf dem
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
  /** R-6.2: Rundenvorrat. */
  roundGold: number;
  hand: CardInstanceId[];
  discard: CardInstanceId[];
  /** Inhalt des Decks (die Reihenfolge wird nicht verglichen, die Größe schon). */
  deck: CardInstanceId[];
  /** R-6.4: in dieser Runde ausgespielte Ressourcen. */
  played: CardInstanceId[];
  /** Gelegte Zauber als `slot:Karteninstanz`. */
  spells: string[];
  /** Klassen-Pool: Karten-ID → verbleibende Anzahl. */
  classPool: Record<string, number>;
  winStreak: number;
  lossStreak: number;
  centerStreak: number;
  leaderXp: number;
  leaderLevel: number;
  leaderBranch: string | null;
}

/** Numerische Werte eines Spielers, die Ereignisse als absoluten Stand melden. */
type PlayerNumber = "life" | "power" | "treasury" | "roundGold" | "winStreak" | "lossStreak" | "centerStreak" | "leaderXp" | "leaderLevel";

export interface UnitSnapshot {
  /** Ort als kanonischer Text (`locationKey`), damit der Vergleich unabhängig von der Feldreihenfolge ist. */
  location: string;
  wounded: boolean;
  stars: number;
  xp: number;
}

export interface AuditSnapshot {
  players: PlayerSnapshot[];
  /** Vorrat: Karten-ID → verbleibende Anzahl. */
  supply: Record<string, number>;
  units: Map<UnitId, UnitSnapshot>;
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
      roundGold: p.roundGold,
      hand: [...p.hand],
      discard: [...p.discard],
      deck: [...p.deck],
      played: [...p.played],
      spells: [...p.spells.pre.map((s) => `pre:${s.cardInstanceId}`), ...p.spells.post.map((s) => `post:${s.cardInstanceId}`)],
      classPool: { ...p.classPool },
      winStreak: p.winStreak,
      lossStreak: p.lossStreak,
      centerStreak: p.centerStreak,
      leaderXp: p.leader.xp,
      leaderLevel: p.leader.level,
      leaderBranch: p.leader.branchId,
    })),
    supply: { ...state.supply },
    units: new Map(
      Object.values(state.units).map((u) => [u.id, { location: locationKey(u.location), wounded: u.wounded, stars: u.stars, xp: u.xp }]),
    ),
  };
}

function cloneSnapshot(s: AuditSnapshot): AuditSnapshot {
  return {
    players: s.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      discard: [...p.discard],
      deck: [...p.deck],
      played: [...p.played],
      spells: [...p.spells],
      classPool: { ...p.classPool },
    })),
    supply: { ...s.supply },
    units: new Map([...s.units].map(([id, u]) => [id, { ...u }])),
  };
}

function sortedIds(ids: readonly number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

function sortedTexts(texts: readonly string[]): string {
  return [...texts].sort().join(",");
}

function pileText(piles: Readonly<Record<string, number>>): string {
  return Object.keys(piles)
    .sort()
    .map((k) => `${k}=${piles[k] ?? 0}`)
    .join(",");
}

/** Neue Einheit: gesund, ein Stern, keine XP. */
function freshUnit(location: UnitLocation): UnitSnapshot {
  return { location: locationKey(location), wounded: false, stars: 1, xp: 0 };
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
  const expectValue = (event: GameEvent, i: PlayerIndex, field: PlayerNumber, reported: number): void => {
    const actual = player(i)[field];
    if (actual !== reported) {
      findings.push(`${phase}: ${event.type} meldet ${field} ${reported} für Spieler ${i}, nachgerechnet ${actual}`);
      player(i)[field] = reported;
    }
  };
  const unit = (event: GameEvent, unitId: UnitId): UnitSnapshot | null => {
    const u = model.units.get(unitId);
    if (!u) findings.push(`${phase}: ${event.type} nennt Einheit ${unitId}, die es nach den Ereignissen nicht gibt`);
    return u ?? null;
  };
  const expectUnitValue = (event: GameEvent, u: UnitSnapshot, unitId: UnitId, field: "stars" | "xp", reported: number): void => {
    if (u[field] !== reported) {
      findings.push(`${phase}: ${event.type} meldet ${field} ${reported} für Einheit ${unitId}, nachgerechnet ${u[field]}`);
      u[field] = reported;
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
    const u = model.units.get(unitId);
    if (u) u.location = locationKey(location);
    else model.units.set(unitId, freshUnit(location));
  };
  const pay = (i: PlayerIndex, fromRoundGold: number, fromTreasury: number): void => {
    player(i).roundGold -= fromRoundGold;
    player(i).treasury -= fromTreasury;
  };

  for (const event of events) {
    switch (event.type) {
      // Schatzkammer und Rundenvorrat
      case "interest_paid":
      case "bonus_interest_paid":
      case "gold_gained":
        player(event.player).treasury += event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        break;
      case "gold_deposited":
        player(event.player).treasury += event.amount;
        player(event.player).roundGold -= event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        break;
      case "gold_withdrawn":
        player(event.player).treasury -= event.amount;
        player(event.player).roundGold += event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        break;
      case "round_gold_gained":
        player(event.player).roundGold += event.amount;
        break;
      case "gold_stolen":
        player(event.player).treasury += event.amount;
        player(event.from).treasury -= event.amount;
        expectValue(event, event.player, "treasury", event.treasury);
        expectValue(event, event.from, "treasury", event.fromTreasury);
        break;
      case "purchase_paid":
        pay(event.player, event.paidFromRoundGold, event.paidFromTreasury);
        break;
      case "unit_healed": {
        pay(event.player, event.paidFromRoundGold, event.paidFromTreasury);
        const u = unit(event, event.unitId);
        if (u) u.wounded = false;
        break;
      }
      case "spell_set":
        pay(event.player, event.paidFromRoundGold, event.paidFromTreasury);
        removeFromHand(event.player, [event.cardInstanceId]);
        player(event.player).spells.push(`${event.slot}:${event.cardInstanceId}`);
        break;
      case "spell_discarded": {
        const spells = player(event.player).spells;
        const at = spells.indexOf(`${event.slot}:${event.cardInstanceId}`);
        if (at >= 0) spells.splice(at, 1);
        else findings.push(`${phase}: spell_discarded nennt Zauber ${event.slot}:${event.cardInstanceId}, der nicht gelegt ist`);
        player(event.player).discard.push(event.cardInstanceId);
        break;
      }
      case "unit_played":
        pay(event.player, event.paidFromRoundGold, event.paidFromTreasury);
        removeFromHand(event.player, [event.cardInstanceId]);
        model.units.set(event.unitId, freshUnit(event.location));
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
      // Hand, Deck, ausgespielte Karten und Ablagestapel
      case "cards_drawn":
        for (const id of event.cardInstanceIds) {
          const deck = player(event.player).deck;
          if (deck.includes(id)) removeFrom(deck, id);
          else findings.push(`${phase}: cards_drawn nennt Karte ${id}, die nicht im Deck von Spieler ${event.player} liegt`);
        }
        player(event.player).hand.push(...event.cardInstanceIds);
        break;
      case "resources_played":
        removeFromHand(event.player, event.cardInstanceIds);
        player(event.player).played.push(...event.cardInstanceIds);
        player(event.player).roundGold += event.gold;
        break;
      case "hand_discarded": {
        const p = player(event.player);
        for (const id of event.cardInstanceIds) {
          if (p.hand.includes(id)) removeFrom(p.hand, id);
          else removeFrom(p.played, id);
        }
        p.discard.push(...event.cardInstanceIds);
        break;
      }
      case "discard_reshuffled": {
        const p = player(event.player);
        p.deck.push(...p.discard);
        p.discard = [];
        if (p.deck.length !== event.size) {
          findings.push(`${phase}: discard_reshuffled meldet Deckgröße ${event.size} für Spieler ${event.player}, nachgerechnet ${p.deck.length}`);
        }
        break;
      }
      case "cards_trashed":
        for (const c of event.cards) removeFrom(c.from === "discard" ? player(event.player).discard : player(event.player).deck, c.cardInstanceId);
        break;
      case "card_bought":
        player(event.player).discard.push(event.cardInstanceId);
        break;
      case "curse_given":
        player(event.to).discard.push(event.cardInstanceId);
        break;
      // Stapel
      case "pile_changed":
        if (event.owner === null) model.supply[event.pile] = event.remaining;
        else player(event.owner).classPool[event.pile] = event.remaining;
        break;
      // Serien
      case "round_outcome": {
        const p = player(event.player);
        if (event.outcome === "won") {
          p.winStreak += 1;
          p.lossStreak = 0;
        } else if (event.outcome === "lost") {
          p.lossStreak += 1;
          p.winStreak = 0;
        }
        expectValue(event, event.player, "winStreak", event.winStreak);
        expectValue(event, event.player, "lossStreak", event.lossStreak);
        break;
      }
      case "center_held":
        player(event.player).centerStreak += 1;
        expectValue(event, event.player, "centerStreak", event.streak);
        break;
      case "center_streak_reset":
        expectValue(event, event.player, "centerStreak", event.previous);
        player(event.player).centerStreak = 0;
        break;
      // Anführer
      case "leader_xp_gained":
        player(event.player).leaderXp += event.amount;
        expectValue(event, event.player, "leaderXp", event.xp);
        break;
      case "leader_leveled_up":
        player(event.player).leaderLevel = event.level;
        expectValue(event, event.player, "leaderXp", event.xp);
        break;
      case "branch_chosen":
        player(event.player).leaderBranch = event.branchId;
        break;
      // Einheiten
      case "unit_placed":
      case "unit_summoned":
        model.units.set(event.unitId, freshUnit(event.location));
        break;
      case "leader_returned":
        setLocation(event.unitId, event.location);
        break;
      case "unit_moved":
      case "unit_returned":
        setLocation(event.unitId, event.to);
        break;
      case "unit_wounded": {
        const u = unit(event, event.unitId);
        if (u) u.wounded = true;
        break;
      }
      case "unit_recovered": {
        const u = unit(event, event.unitId);
        if (u) u.wounded = false;
        break;
      }
      case "unit_xp_gained": {
        const u = unit(event, event.unitId);
        if (!u) break;
        u.xp += event.amount;
        expectUnitValue(event, u, event.unitId, "xp", event.xp);
        break;
      }
      case "units_merged": {
        const merged = event.mergedUnitIds.map((id) => model.units.get(id));
        const xpSum = merged.reduce((sum, u) => sum + (u?.xp ?? 0), 0);
        if (xpSum !== event.xp) findings.push(`${phase}: units_merged meldet xp ${event.xp} für Einheit ${event.unitId}, nachgerechnet ${xpSum}`);
        for (const id of event.mergedUnitIds) if (id !== event.unitId) model.units.delete(id);
        model.units.set(event.unitId, { location: locationKey(event.location), wounded: event.wounded, stars: event.stars, xp: event.xp });
        break;
      }
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
    for (const field of ["life", "power", "treasury", "roundGold", "winStreak", "lossStreak", "centerStreak", "leaderXp", "leaderLevel"] as const) {
      if (m[field] !== a[field]) findings.push(`${phase}: ${field} von Spieler ${i} ist ${a[field]}, aus Ereignissen ${m[field]}`);
    }
    if (m.leaderBranch !== a.leaderBranch) findings.push(`${phase}: leaderBranch von Spieler ${i} ist ${a.leaderBranch ?? "—"}, aus Ereignissen ${m.leaderBranch ?? "—"}`);
    const lists = [
      ["Hand", m.hand, a.hand],
      ["Ablagestapel", m.discard, a.discard],
      ["Deck", m.deck, a.deck],
      ["Ausgespielt", m.played, a.played],
    ] as const;
    for (const [name, modeled, actual] of lists) {
      if (sortedIds(modeled) !== sortedIds(actual)) findings.push(`${phase}: ${name} von Spieler ${i} ist [${sortedIds(actual)}], aus Ereignissen [${sortedIds(modeled)}]`);
    }
    if (sortedTexts(m.spells) !== sortedTexts(a.spells)) findings.push(`${phase}: Zauber von Spieler ${i} sind [${sortedTexts(a.spells)}], aus Ereignissen [${sortedTexts(m.spells)}]`);
    if (pileText(m.classPool) !== pileText(a.classPool)) findings.push(`${phase}: Klassen-Pool von Spieler ${i} ist [${pileText(a.classPool)}], aus Ereignissen [${pileText(m.classPool)}]`);
  });
  if (pileText(model.supply) !== pileText(after.supply)) findings.push(`${phase}: Vorrat ist [${pileText(after.supply)}], aus Ereignissen [${pileText(model.supply)}]`);
  const ids = new Set([...model.units.keys(), ...after.units.keys()]);
  for (const id of [...ids].sort((x, y) => x - y)) {
    const expected = model.units.get(id);
    const actual = after.units.get(id);
    if (expected?.location !== actual?.location) {
      findings.push(`${phase}: Einheit ${id} steht auf ${actual?.location ?? "—"}, aus Ereignissen ${expected?.location ?? "—"}`);
    }
    if (!expected || !actual) continue;
    if (expected.wounded !== actual.wounded) findings.push(`${phase}: Einheit ${id} ist ${actual.wounded ? "" : "nicht "}verwundet, aus Ereignissen ${expected.wounded ? "" : "nicht "}verwundet`);
    if (expected.stars !== actual.stars) findings.push(`${phase}: Einheit ${id} hat ${actual.stars} Sterne, aus Ereignissen ${expected.stars}`);
    if (expected.xp !== actual.xp) findings.push(`${phase}: Einheit ${id} hat ${actual.xp} XP, aus Ereignissen ${expected.xp}`);
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
