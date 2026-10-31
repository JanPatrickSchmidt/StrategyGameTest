/**
 * Frontkämpfe in der Rundenmaschine (E8b, Spec R-2.3, R-2.5, R-3.2, R-9.1, R-9.6, R-1.4, R-16.3).
 *
 * Baut aus dem Spielzustand für jede Front-Paarung die Kämpfer, simuliert den Kampf (`combat.ts`),
 * schreibt die Kampf-Ereignisse ins Ereignisprotokoll und legt je Paarung ein Ergebnis für die
 * Kampfauswertung (E12) in `state.frontResults` ab. Alle Kämpfe nutzen denselben Ausgangszustand
 * (R-9): Der Spielzustand wird erst nach allen Kämpfen verändert (Tokens entfernen).
 */
import { type FighterInit, fighterFromData, simulateCombat } from "./combat";
import type { GameData } from "./data";
import { applyCombatAftermath } from "./aftermath";
import type { Stat } from "./dataTypes";
import { type DeferredEffect, effectHooks } from "./effects";
import { markedStartManaPercent } from "./marks";
import { frontArenaSize, type FrontSide, frontToArena, type OffsetCoord } from "./hex";
import { activeRing, neighborsOf } from "./seating";
import { emit, type FrontResult, type GameState, getPlayer, type PlayerIndex, type Unit, type UnitId } from "./state";

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
 * R-2.3, R-2.5: Für jeden aktiven Spieler `p` (in Ringreihenfolge) kämpft `p.right` gegen
 * `left` des rechten Nachbarn. Bei 2 Spielern ergibt das zwei getrennte Kämpfe, bei 1 Spieler keinen.
 */
export function frontPairings(state: GameState): FrontPairing[] {
  const result: FrontPairing[] = [];
  for (const p of activeRing(state)) {
    const n = neighborsOf(state, p);
    if (n) result.push({ first: p, second: n.right });
  }
  return result;
}

/**
 * R-9.1: Teilnehmer einer Front-Paarung: alle nicht verwundeten Einheiten der beiden Zonen,
 * inklusive Anführer und Tokens, nach ID aufsteigend.
 */
export function frontParticipants(state: GameState, pairing: FrontPairing): { first: Unit[]; second: Unit[] } {
  const units = Object.values(state.units)
    .filter((u) => !u.wounded)
    .sort((a, b) => a.id - b.id);
  const inZone = (owner: PlayerIndex, zone: "left" | "right"): Unit[] =>
    units.filter((u) => u.owner === owner && u.location.zone === zone);
  return { first: inZone(pairing.first, "right"), second: inZone(pairing.second, "left") };
}

/**
 * R-9.2 plus R-16.3: Kampfwerte einer Einheit. Ab Anführer-Stufe 3 steigen `attack` und `hp` der
 * Anführer-Kampfeinheit um `config.leader.level3StatBonus` (Zuschlag abgerundet). Dauerhafte Buffs
 * (`unit.permanentBuffs`, E10b) kommen danach als fester Zuschlag hinzu (F31).
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
  if (unit.kind === "leader" && getPlayer(state, unit.owner).leader.level >= 3) {
    const bonus = data.config.leader.level3StatBonus;
    const raise = (v: number): number => v + Math.floor(v * bonus + 1e-9);
    init.stats = { ...init.stats, attack: raise(init.stats.attack), hp: raise(init.stats.hp) };
  }
  if (unit.permanentBuffs) {
    const c = data.config.combat;
    const base: Record<Stat, number> = {
      attack: init.stats.attack,
      hp: init.stats.hp,
      breakthrough: init.stats.breakthrough,
      range: init.stats.range,
      armor: init.stats.armor ?? 0,
      attackInterval: init.stats.attackInterval ?? c.defaultAttackInterval,
      moveInterval: init.stats.moveInterval ?? c.defaultMoveInterval,
      manaMax: init.stats.manaMax ?? c.defaultManaMax,
    };
    const stats = { ...init.stats };
    for (const [stat, amount] of Object.entries(unit.permanentBuffs) as [Stat, number][]) {
      const min = stat === "hp" || stat === "attackInterval" || stat === "moveInterval" || stat === "manaMax" || stat === "range" ? 1 : 0;
      stats[stat] = Math.max(min, base[stat] + amount);
    }
    init.stats = stats;
  }
  // R-17a.2: Start-Mana aus Markierungen dieser Runde (Prozent von `manaMax`, abgerundet).
  const percent = markedStartManaPercent(state, data, unit);
  if (percent > 0) {
    const manaMax = init.stats.manaMax ?? data.config.combat.defaultManaMax;
    init.startMana = (init.startMana ?? 0) + Math.floor((manaMax * percent) / 100 + 1e-9);
  }
  return init;
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
    result = { ...base, outcome: "noFight", winner: null, ticks: 0, survivors: [], winnerBreakthrough: 0 };
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
    };
  } else {
    // R-3.2: `first` belegt die Arena-Zeilen 0–2 unverändert, `second` gedreht die Zeilen 3–5.
    const place = (u: Unit, side: FrontSide): FighterInit =>
      fighterForUnit(state, data, u, frontToArena(side, frontCell(u), zone));
    const inits = [...first.map((u) => place(u, "first")), ...second.map((u) => place(u, "second"))];
    emit(state, {
      type: "combat_started",
      arena,
      players: [pairing.first, pairing.second],
      fighters: inits.map((f) => ({ unitId: f.id, player: f.team as PlayerIndex, sourceId: f.sourceId, cell: { ...f.pos } })),
    });
    const fx = effectHooks(data);
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
  removeFoughtTokens(state, results.flatMap((r) => r.participants));
  return results;
}
