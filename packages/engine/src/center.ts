/**
 * Mittelkampf in der Rundenmaschine (E9, Spec R-3.4, R-9.1, R-9.4, R-9.7, R-1.4).
 *
 * Alle nicht verwundeten Einheiten aller Mittelzonen kämpfen in der 7 × 7-Mittelarena jeder gegen
 * jeden (Free for All): Jeder Spieler ist ein eigenes Team, Kandidaten der Zielwahl sind alle
 * Einheiten anderer Spieler (R-9.4, `combat.ts`). Ergebnis ist der Halter der Mitte (R-9.7) als
 * Grundlage für die Mitte-Belohnung (R-10.4, E12). Der Spielzustand wird nicht verändert; Tokens
 * entfernt `runCombatPhase` erst nach allen Kämpfen (R-9: gemeinsamer Ausgangszustand).
 */
import { type FighterInit, simulateCombat } from "./combat";
import type { GameData } from "./data";
import { applyCombatAftermath } from "./aftermath";
import { type DeferredEffect, effectHooks } from "./effects";
import { fighterForUnit, removeFoughtTokens, runFronts } from "./fronts";
import { announceCombatMarks, clearCombatMarks } from "./marks";
import { announceResonance, resonanceSummonAdjuster } from "./resonance";
import { centerPositionToArena, type Seat } from "./hex";
import { type CenterResult, emit, type FrontResult, type GameState, getPlayer, type PlayerIndex, type Unit } from "./state";

/** Kennung der Mittelarena im Ereignisprotokoll. */
export const CENTER_ARENA_ID = "center";

/**
 * R-9.1: Teilnehmer des Mittelkampfs: alle nicht verwundeten Einheiten in Mittelzonen nicht
 * ausgeschiedener Spieler, inklusive Anführer und Tokens, nach ID aufsteigend.
 */
export function centerParticipants(state: GameState): Unit[] {
  return Object.values(state.units)
    .filter((u) => !u.wounded && u.location.zone === "center" && !getPlayer(state, u.owner).eliminated)
    .sort((a, b) => a.id - b.id);
}

/** R-3.4: Startfeld einer Einheit der Mittelzone in der Mittelarena (Sitz = Spielerindex, fest). */
function centerCell(data: GameData, unit: Unit) {
  if (unit.location.zone !== "center") throw new RangeError(`Einheit ${unit.id} steht nicht in der Mittelzone`);
  const { centerArena, centerStartSlots } = data.config.arenas;
  return centerPositionToArena(unit.owner as Seat, unit.location.position, centerArena, centerStartSlots);
}

/**
 * Führt den Mittelkampf aus und protokolliert ihn (R-9.1, R-9.7). Verändert keine Einheiten; vorgemerkte
 * Effekte landen in `deferredOut`.
 */
export function runCenter(state: GameState, data: GameData, deferredOut: DeferredEffect[] = []): CenterResult {
  const units = centerParticipants(state);
  const players = [...new Set(units.map((u) => u.owner))].sort((a, b) => a - b);
  const base = { round: state.round, arena: CENTER_ARENA_ID, players, participants: units.map((u) => u.id) };

  let result: CenterResult;
  if (players.length === 0) {
    // R-9.1: niemand in der Mitte, kein Halter.
    result = { ...base, outcome: "noFight", holder: null, ticks: 0, survivors: [] };
  } else if (players.length === 1) {
    // R-9.1: nur ein Spieler hat Einheiten in der Mitte, er hält sie ohne Simulation.
    result = { ...base, outcome: "uncontested", holder: players[0] as PlayerIndex, ticks: 0, survivors: [...base.participants] };
  } else {
    const inits: FighterInit[] = units.map((u) => fighterForUnit(state, data, u, centerCell(data, u)));
    emit(state, {
      type: "combat_started",
      arena: CENTER_ARENA_ID,
      players: [...players],
      fighters: inits.map((f) => ({ unitId: f.id, player: f.team as PlayerIndex, sourceId: f.sourceId, cell: { ...f.pos } })),
    });
    const fx = effectHooks(data, { adjustSummon: resonanceSummonAdjuster(state, data) });
    const combat = simulateCombat(data.config, data.config.arenas.centerArena, inits, fx.hooks, state.nextUnitId);
    deferredOut.push(...fx.deferred);
    state.nextUnitId = combat.nextSummonId;
    for (const event of combat.events) emit(state, { ...event, arena: CENTER_ARENA_ID });
    // R-9.7: Halter ist der einzige Spieler mit lebenden Einheiten; nach Tick 300 mit mehreren oder ohne: keiner.
    result = {
      ...base,
      outcome: "combat",
      holder: combat.winner === null ? null : (combat.winner as PlayerIndex),
      ticks: combat.ticks,
      survivors: [...combat.survivors],
    };
  }
  emit(state, {
    type: "center_resolved",
    arena: CENTER_ARENA_ID,
    players: [...result.players],
    outcome: result.outcome,
    holder: result.holder,
    survivors: [...result.survivors],
  });
  return result;
}

/**
 * R-9: Kampfphase einer Runde. Alle Frontkämpfe und der Mittelkampf laufen auf demselben
 * Ausgangszustand; danach wirken die vorgemerkten Kampf-Effekte und `onFrontWin` (E10b, `aftermath.ts`),
 * und zuletzt verschwinden alle Tokens, die an einem dieser Kämpfe teilgenommen haben (R-1.4, R-9.6).
 */
export function runCombatPhase(state: GameState, data: GameData): { fronts: FrontResult[]; center: CenterResult } {
  // R-17a.2: Start-Mana-Markierungen dieser Runde wirken in allen Kämpfen (melden, dann kämpfen, dann löschen).
  const fighting = Object.values(state.units)
    .filter((u) => !u.wounded && u.location.zone !== "reserve" && !getPlayer(state, u.owner).eliminated)
    .sort((a, b) => a.id - b.id);
  // R-17.2: Resonanz nach dem Brett zu Beginn der Kampfphase (nach dem Aufdecken) gilt in allen Kämpfen.
  announceResonance(state, data, fighting);
  announceCombatMarks(state, data, fighting);
  const frontRuns = runFronts(state, data);
  const centerDeferred: DeferredEffect[] = [];
  const center = runCenter(state, data, centerDeferred);
  const fronts = frontRuns.map((f) => f.result);
  state.frontResults = fronts;
  state.centerResult = center;
  applyCombatAftermath(state, data, { fronts: frontRuns, center: { result: center, deferred: centerDeferred } });
  removeFoughtTokens(state, [...fronts.flatMap((r) => r.participants), ...center.participants]);
  clearCombatMarks(state);
  return { fronts, center };
}
