/**
 * Frontkämpfe in der Rundenmaschine (E8b, Spec R-2.3, R-2.5, R-3.2, R-9.1, R-9.6, R-1.4, R-16.3).
 *
 * Baut aus dem Spielzustand für jede Front-Paarung die Kämpfer, simuliert den Kampf (`combat.ts`),
 * schreibt die Kampf-Ereignisse ins Ereignisprotokoll und legt je Paarung ein Ergebnis für die
 * Kampfauswertung (E12) in `state.frontResults` ab. Alle Kämpfe nutzen denselben Ausgangszustand
 * (R-9): Der Spielzustand wird erst nach allen Kämpfen verändert (Tokens entfernen).
 */
import { type FighterInit, fighterFromData, fighterStartValues, simulateCombat } from "./combat";
import type { UnitStats } from "./dataTypes";
import type { GameData } from "./data";
import { applyCombatAftermath } from "./aftermath";
import { type DeferredEffect, effectHooks } from "./effects";
import { markedStartManaPercent } from "./marks";
import { applyRoundEffects } from "./preCombat";
import { applyCombatWounds, fightsThisRound, woundedUnits } from "./wounds";
import { activeResonance, addStartManaPercent, addStatBonuses, applyResonanceStats, resonanceBonus, resonanceSummonAdjuster } from "./resonance";
import { frontArenaSize, type FrontSide, frontToArena, type OffsetCoord } from "./hex";
import { emit, type FrontResult, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";

/** R-2.3: `first.right` kämpft gegen `second.left`. */
export interface FrontPairing {
  first: PlayerIndex;
  second: PlayerIndex;
}

/** Kennung einer Frontarena im Ereignisprotokoll, z. B. `front:0-1` (`first`-`second`). */
export function frontArenaId(pairing: FrontPairing): string {
  return `front:${pairing.first}-${pairing.second}`;
}

/**
 * R-2.2, R-2.3, R-2.5: Front-Paarungen allein aus der Liste „ausgeschieden ja/nein“ je Sitz (Index = Sitz).
 * Für jeden aktiven Spieler `p` (in Ringreihenfolge) kämpft `p.right` gegen `left` des rechten Nachbarn.
 * Bei 2 Spielern ergibt das zwei getrennte Kämpfe, bei 1 Spieler keinen. Der Client nutzt diese Funktion mit
 * den Angaben der Spielersicht (P11d), die Engine über `frontPairings`.
 */
export function frontPairingsFor(eliminated: readonly boolean[]): FrontPairing[] {
  const ring = PLAYER_INDICES.filter((p) => p < eliminated.length && !eliminated[p]);
  if (ring.length < 2) return [];
  return ring.map((first, i) => ({ first, second: ring[(i + 1) % ring.length] as PlayerIndex }));
}

/** R-2.3, R-2.5: Front-Paarungen dieser Runde aus dem Spielzustand (siehe `frontPairingsFor`). */
export function frontPairings(state: GameState): FrontPairing[] {
  return frontPairingsFor(state.players.map((p) => p.eliminated));
}

/**
 * Arena (aus Sicht des Besitzers), in der eine Einheit in dieser Runde kämpft: nach einem Schattenschritt
 * (R-16.6, E11c4) die Arena des Zielfelds, sonst die Zone ihres Orts.
 */
export function roundArena(unit: Unit): UnitLocation["zone"] {
  return unit.shadowStep ? unit.shadowStep.hex.arena : unit.location.zone;
}

/**
 * R-9.1: Teilnehmer einer Front-Paarung: alle nicht verwundeten Einheiten der beiden Zonen,
 * inklusive Anführer und Tokens, nach ID aufsteigend. Einheiten nach einem Schattenschritt (R-16.6) kämpfen in
 * der Arena ihres Zielfelds, auch wenn es in der gegnerischen Hälfte liegt.
 */
export function frontParticipants(state: GameState, pairing: FrontPairing): { first: Unit[]; second: Unit[] } {
  const units = Object.values(state.units)
    .filter(fightsThisRound)
    .sort((a, b) => a.id - b.id);
  const inZone = (owner: PlayerIndex, zone: "left" | "right"): Unit[] =>
    units.filter((u) => u.owner === owner && roundArena(u) === zone);
  return { first: inZone(pairing.first, "right"), second: inZone(pairing.second, "left") };
}

/**
 * P11 (R-16.3, R-15.2): Werte einer Einheit außerhalb des Kampfes, wie sie jede Anzeige zeigen soll: Grundwerte
 * aus den Daten (Sternfaktor bzw. Anführer-Werte), Ersatzwerte beschworener Tokens (`statOverride`, E11c3), ab
 * Anführer-Stufe 3 der Zuschlag auf `attack` und `hp` (`config.leader.level3StatBonus`, abgerundet), danach
 * dauerhafte Buffs (`permanentBuffs`, F31). Vorkampf-Zauber und Resonanz zählen nicht, sie greifen erst in der
 * Kampfphase. `leaderLevel` ist die Stufe des Anführers des Besitzers (aus Zustand oder Sicht).
 * `fighterForUnit` baut darauf auf, damit Anzeige und Kampf nicht auseinanderlaufen.
 */
export function unitBaseStats(data: GameData, unit: Unit, leaderLevel: number): UnitStats {
  const init = fighterFromData(data, {
    id: unit.id,
    team: unit.owner,
    kind: unit.kind,
    sourceId: unit.sourceId,
    stars: unit.stars,
    pos: { col: 0, row: 0 },
  });
  return applyPersistentStats(data, init.stats, unit, leaderLevel);
}

function applyPersistentStats(data: GameData, base: UnitStats, unit: Unit, leaderLevel: number): UnitStats {
  let stats = base;
  // E11c3: Morgras Beschwörung ersetzt Grundwerte des Tokens (vor allen Zuschlägen).
  if (unit.statOverride) stats = { ...stats, ...unit.statOverride };
  if (unit.kind === "leader" && leaderLevel >= 3) {
    const bonus = data.config.leader.level3StatBonus;
    const raise = (v: number): number => v + Math.floor(v * bonus + 1e-9);
    stats = { ...stats, attack: raise(stats.attack), hp: raise(stats.hp) };
  }
  if (unit.permanentBuffs) stats = addStatBonuses(data.config, stats, unit.permanentBuffs);
  return stats;
}

/**
 * R-9.2 plus R-16.3: Kampfwerte einer Einheit. Zuerst die Werte außerhalb des Kampfes (`unitBaseStats`:
 * Grundwerte, Token-Ersatzwerte, Anführer-Stufe-3-Zuschlag, dauerhafte Buffs), dann die Wirkungen der
 * Vorkampf-Zauber (`unit.roundEffects`, E11b1), dann die Rassen-Resonanz
 * (R-17.2, E10c1) und zuletzt Start-Mana aus Markierungen und Resonanz.
 */
export function fighterForUnit(state: GameState, data: GameData, unit: Unit, pos: OffsetCoord): FighterInit {
  const init = fighterFromData(data, {
    id: unit.id,
    team: unit.owner,
    kind: unit.kind,
    sourceId: unit.sourceId,
    stars: unit.stars,
    pos,
  });
  init.stats = applyPersistentStats(data, init.stats, unit, getPlayer(state, unit.owner).leader.level);
  // R-8.3 (E11b1): Schild, Buffs und Schlüsselwörter aus Vorkampf-Zaubern dieser Runde.
  applyRoundEffects(data.config, init, unit);
  // R-17.2: Rassen-Resonanz nach dem Brett zu Beginn der Kampfphase (Werte, Schlüsselwörter, Start-Mana).
  const bonus = resonanceBonus(activeResonance(state, data, unit.owner), init.race);
  applyResonanceStats(data.config, init, bonus);
  // R-17a.2 und R-17.2: Start-Mana aus Markierungen und Resonanz (Prozente addiert, von `manaMax` abgerundet).
  addStartManaPercent(data.config, init, markedStartManaPercent(state, data, unit) + bonus.startManaPercent);
  return init;
}

/** Startfeld in Arena-Koordinaten: nach einem Schattenschritt das Zielfeld (R-16.6), sonst das gedrehte Zonenfeld. */
function frontArenaCell(unit: Unit, side: FrontSide, zone: GameData["config"]["arenas"]["frontZone"]): OffsetCoord {
  if (unit.shadowStep) return { ...unit.shadowStep.hex.cell };
  return frontToArena(side, frontCell(unit), zone);
}

function frontCell(unit: Unit): OffsetCoord {
  if (unit.location.zone !== "left" && unit.location.zone !== "right") {
    throw new RangeError(`Einheit ${unit.id} steht nicht in einer Frontzone`);
  }
  return unit.location.cell;
}

/**
 * Führt einen Frontkampf aus und protokolliert ihn (R-9.1, R-9.7). Verändert keine Einheiten. Im Kampf
 * vorgemerkte Effekte (`DeferredEffect`) landen in `deferredOut`, angewendet werden sie in `aftermath.ts`.
 */
export function runFront(state: GameState, data: GameData, pairing: FrontPairing, deferredOut: DeferredEffect[] = []): FrontResult {
  const arena = frontArenaId(pairing);
  const zone = data.config.arenas.frontZone;
  const { first, second } = frontParticipants(state, pairing);
  const participants = [...first, ...second].map((u) => u.id).sort((a, b) => a - b);
  const base = { round: state.round, arena, first: pairing.first, second: pairing.second, participants };

  let result: FrontResult;
  if (first.length === 0 && second.length === 0) {
    // R-9.1: niemand da, kein Kampf, Unentschieden ohne Schaden.
    result = { ...base, outcome: "noFight", winner: null, ticks: 0, survivors: [], winnerBreakthrough: 0, wounded: [] };
  } else if (first.length === 0 || second.length === 0) {
    // R-9.1, R-10.2: leere Front, die andere Seite gewinnt ohne Simulation mit allen Einheiten.
    const winnerUnits = first.length > 0 ? first : second;
    const winner = first.length > 0 ? pairing.first : pairing.second;
    const breakthrough = winnerUnits.reduce(
      (sum, u) => sum + fighterForUnit(state, data, u, { col: 0, row: 0 }).stats.breakthrough,
      0,
    );
    result = {
      ...base,
      outcome: "emptyFront",
      winner,
      ticks: 0,
      survivors: winnerUnits.map((u) => u.id),
      winnerBreakthrough: breakthrough,
      wounded: [],
    };
  } else {
    // R-3.2: `first` belegt die Arena-Zeilen 0–2 unverändert, `second` gedreht die Zeilen 3–5.
    const place = (u: Unit, side: FrontSide): FighterInit =>
      fighterForUnit(state, data, u, frontArenaCell(u, side, zone));
    const inits = [...first.map((u) => place(u, "first")), ...second.map((u) => place(u, "second"))];
    emit(state, {
      type: "combat_started",
      arena,
      players: [pairing.first, pairing.second],
      fighters: inits.map((f) => ({ unitId: f.id, player: f.team as PlayerIndex, sourceId: f.sourceId, cell: { ...f.pos }, ...fighterStartValues(f) })),
    });
    const fx = effectHooks(data, { adjustSummon: resonanceSummonAdjuster(state, data) });
    const combat = simulateCombat(data.config, frontArenaSize(zone), inits, fx.hooks, state.nextUnitId);
    deferredOut.push(...fx.deferred);
    // Im Kampf erzeugte Tokens belegen IDs, die danach keine andere Einheit mehr bekommt.
    state.nextUnitId = combat.nextSummonId;
    for (const event of combat.events) emit(state, { ...event, arena });
    const winner = combat.winner === null ? null : (combat.winner as PlayerIndex);
    const survivorSet = new Set<UnitId>(combat.survivors);
    const breakthrough =
      winner === null
        ? 0
        : combat.fighters.filter((f) => f.team === winner && survivorSet.has(f.id)).reduce((s, f) => s + f.breakthrough, 0);
    result = {
      ...base,
      outcome: "combat",
      winner,
      ticks: combat.ticks,
      survivors: [...combat.survivors],
      winnerBreakthrough: breakthrough,
      wounded: woundedUnits(state, combat.wounded),
    };
  }
  emit(state, {
    type: "front_resolved",
    arena,
    first: pairing.first,
    second: pairing.second,
    outcome: result.outcome,
    winner: result.winner,
    survivors: [...result.survivors],
    winnerBreakthrough: result.winnerBreakthrough,
  });
  return result;
}

/**
 * R-9: alle Frontkämpfe einer Runde auf demselben Ausgangszustand, ohne den Zustand zu verändern.
 * Liefert je Paarung das Ergebnis und die vorgemerkten Effekte.
 */
export function runFronts(state: GameState, data: GameData): { result: FrontResult; deferred: DeferredEffect[] }[] {
  return frontPairings(state).map((pairing) => {
    const deferred: DeferredEffect[] = [];
    return { result: runFront(state, data, pairing, deferred), deferred };
  });
}

/** R-1.4, R-9.6: Tokens, die an einem Kampf teilgenommen haben, verschwinden (nach allen Kämpfen). */
export function removeFoughtTokens(state: GameState, participants: readonly UnitId[]): void {
  for (const id of [...new Set(participants)].sort((a, b) => a - b)) {
    const unit = state.units[id];
    if (!unit || unit.kind !== "token") continue;
    delete state.units[id];
    emit(state, { type: "token_removed", player: unit.owner, unitId: id });
  }
}

/**
 * R-9 für alle Fronten einer Runde: erst alle Kämpfe auf demselben Ausgangszustand, dann die Wirkungen
 * außerhalb des Kampfes (E10b), dann R-1.4/R-9.6: Tokens, die an einem Frontkampf teilgenommen haben, verschwinden.
 * Die Rundenmaschine nutzt `runCombatPhase` (`center.ts`), das zusätzlich die Mitte kämpfen lässt.
 */
export function runFrontCombats(state: GameState, data: GameData): FrontResult[] {
  const fronts = runFronts(state, data);
  const results = fronts.map((f) => f.result);
  state.frontResults = results;
  applyCombatAftermath(state, data, { fronts, center: null });
  applyCombatWounds(state, results);
  removeFoughtTokens(state, results.flatMap((r) => r.participants));
  return results;
}
