/**
 * Kandidaten für Planungsaktionen (E14): erzeugt alle Aktionen eines Abschnitts, die nach Form und
 * Grenzen in Frage kommen. Einheiten werden nur genannt, wenn es sie schon zu Beginn der Planung gab. Ob eine Aktion gültig ist, entscheidet allein die Engine über
 * `PlanningDraft.attempt` – die Kandidaten sind bewusst großzügig, damit kein Bot eigene Regeln nachbauen muss.
 */
import type { ActionTarget, ArenaHex, ArenaRef, PlanningAction } from "../actions";
import type { ConfigData, GameData } from "../data";
import type { TargetSpec } from "../dataTypes";
import { inBounds } from "../hex";
import { leaderAbilityParams } from "../leader";
import { nextInt, type RngState, shuffleInPlace } from "../rng";
import type { PlanningDraft } from "../round";
import { getCard, getPlayer, PLAYER_INDICES, type CardInstanceId, type GameState, type PlayerIndex, type Unit, type UnitLocation } from "../state";
import { ARENA_REFS, arenaSize } from "../targets";

/** Alle Orte einer Planung: Felder beider Frontzonen (R-3.1), Mittelpositionen (R-3.3), Reserve (R-3.5). */
export function allLocations(config: ConfigData): UnitLocation[] {
  const result: UnitLocation[] = [];
  const { cols, rows } = config.arenas.frontZone;
  for (const zone of ["left", "right"] as const) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (inBounds({ col, row }, { cols, rows })) result.push({ zone, cell: { col, row } });
      }
    }
  }
  for (let position = 0; position < config.arenas.centerStartSlots; position++) result.push({ zone: "center", position });
  for (let slot = 0; slot < config.reserveSlots; slot++) result.push({ zone: "reserve", slot });
  return result;
}

/** Alle Felder aller Arenen in Arena-Koordinaten (R-14.2). */
export function allArenaHexes(config: ConfigData): ArenaHex[] {
  const result: ArenaHex[] = [];
  for (const arena of ARENA_REFS) {
    const size = arenaSize(config, arena);
    for (let row = 0; row < size.rows; row++) {
      for (let col = 0; col < size.cols; col++) {
        if (inBounds({ col, row }, size)) result.push({ arena, cell: { col, row } });
      }
    }
  }
  return result;
}

/** Eigene Einheiten, die schon zu Beginn der Planung existierten (siehe `PlanningDraft.initialUnitIds`). */
function ownUnitList(draft: PlanningDraft): Unit[] {
  return Object.values(draft.state.units)
    .filter((u) => u.owner === draft.player && draft.initialUnitIds.has(u.id))
    .sort((a, b) => a.id - b.id);
}

function pickSubset<T>(rng: RngState, items: readonly T[], size: number): T[] {
  return shuffleInPlace(rng, [...items]).slice(0, size);
}

/**
 * Ziele zu einer Ziel-Angabe (R-14.2). Felder einzeln, Zonen einzeln und alle zusammen, Spieler einzeln,
 * eigene Karten als zufällige Auswahl, Vex-Bewegungen als einzelne Züge. Mehrfachziele werden über die
 * Grenzen (`hexes`, `zones`, `count`) von der Engine geprüft.
 */
export function targetCandidates(draft: PlanningDraft, data: GameData, spec: TargetSpec, rng: RngState): ActionTarget[] {
  const { state, player } = draft;
  switch (spec.kind) {
    case "none":
      return [{ kind: "none" }];
    case "hex":
      return allArenaHexes(data.config).map((h) => ({ kind: "hex", arena: h.arena, cell: h.cell }));
    case "zone": {
      const singles: ActionTarget[] = ARENA_REFS.map((a) => ({ kind: "zone", arenas: [a] }));
      return [...singles, { kind: "zone", arenas: [...ARENA_REFS] as ArenaRef[] }];
    }
    case "player":
      return PLAYER_INDICES.filter((p) => p !== player).map((p) => ({ kind: "player", player: p }));
    case "ownCards": {
      const p = getPlayer(state, player);
      const pool: CardInstanceId[] = spec.from.flatMap((zone) => p[zone]);
      if (pool.length === 0) return [];
      const result: ActionTarget[] = [];
      for (let i = 0; i < 3; i++) {
        const size = 1 + nextInt(rng, Math.min(spec.max, pool.length));
        result.push({ kind: "ownCards", cardInstanceIds: pickSubset(rng, pool, size) });
      }
      return result;
    }
    case "moveUnits": {
      const hexes = allArenaHexes(data.config);
      return ownUnitList(draft).flatMap((u) =>
        hexes.map((to): ActionTarget => ({ kind: "moveUnits", moves: [{ unitId: u.id, to }] })),
      );
    }
  }
}

function playCandidates(draft: PlanningDraft, data: GameData, rng: RngState): PlanningAction[] {
  const { state, player } = draft;
  const p = getPlayer(state, player);
  const locations = allLocations(data.config);
  const result: PlanningAction[] = [];
  const cardUnits = ownUnitList(draft).filter((u) => u.kind === "card");
  for (const cardInstanceId of p.hand) {
    const card = data.cards.get(getCard(state, cardInstanceId).cardId);
    if (!card) continue;
    if (card.type === "unit") {
      for (const to of locations) {
        result.push({ type: "playUnit", cardInstanceId, to });
        if (card.altCost) {
          const n = card.altCost.sacrifice ?? 0;
          if (n === 0) result.push({ type: "playUnit", cardInstanceId, to, useAltCost: true });
          else if (cardUnits.length >= n) {
            const sacrifice = pickSubset(rng, cardUnits, n).map((u) => u.id);
            result.push({ type: "playUnit", cardInstanceId, to, useAltCost: true, sacrifice });
          }
        }
      }
    } else if (card.type === "spell") {
      for (const target of targetCandidates(draft, data, card.target, rng)) {
        result.push({ type: "setSpell", cardInstanceId, slot: card.slot, target });
      }
    }
  }
  for (const u of ownUnitList(draft)) {
    if (u.wounded) result.push({ type: "heal", unitId: u.id });
  }
  const leader = data.leaders.get(p.leader.leaderId);
  if (leader && p.leader.level >= 2 && p.leader.branchId === null) {
    for (const b of leader.active.branches) result.push({ type: "chooseBranch", branchId: b.id });
  }
  return result;
}

function buyCandidates(state: GameState, data: GameData, player: PlayerIndex): PlanningAction[] {
  const p = getPlayer(state, player);
  const ids = [...Object.keys(state.supply), ...Object.keys(p.classPool)].filter((id) => data.cards.has(id));
  return ids.sort().map((cardId) => ({ type: "buy", cardId }));
}

function positionCandidates(draft: PlanningDraft, data: GameData, rng: RngState): PlanningAction[] {
  const { state, player } = draft;
  const p = getPlayer(state, player);
  const locations = allLocations(data.config);
  const result: PlanningAction[] = [];
  for (const u of ownUnitList(draft)) {
    if (u.kind === "token") continue;
    for (const to of locations) result.push({ type: "moveUnit", unitId: u.id, to });
  }
  const leader = data.leaders.get(p.leader.leaderId);
  if (leader && p.leaderAbility === null) {
    const params = leaderAbilityParams(leader, p.leader.level, p.leader.branchId);
    for (const target of targetCandidates(draft, data, params.target, rng)) result.push({ type: "setLeaderAbility", target });
  }
  return result;
}

/**
 * Kandidaten des aktuellen Abschnitts eines Entwurfs (R-5): `play` (Einheiten, Zauber, Genesen, Astwahl), `buy` (Königreich,
 * Basis, Klassen-Pool), `position` (Bewegen, Anführer-Fähigkeit). Entnahme (R-7.6) ist nie nötig, weil
 * Zahlungen die Schatzkammer automatisch nutzen; ein Bot kann sie trotzdem selbst ergänzen.
 */
export function candidateActions(draft: PlanningDraft, data: GameData, rng: RngState): PlanningAction[] {
  switch (draft.section) {
    case "play":
      return playCandidates(draft, data, rng);
    case "buy":
      return buyCandidates(draft.state, data, draft.player);
    case "position":
      return positionCandidates(draft, data, rng);
  }
}
