/**
 * Ziele von Zaubern und Anführer-Fähigkeiten in der Planung prüfen (R-7.3, R-7.4, R-14.2, R-14.8, R-16.6).
 *
 * Felder werden in Arena-Koordinaten angegeben (siehe `ArenaHex` in `actions.ts`). Geprüft wird beim
 * Ausführen der Planung (R-8.1): Form, erlaubte Arenen, Anzahl, eigene Hälfte und – wo verlangt – dass
 * kein **eigenes** Feld besetzt ist. Was gegnerische Einheiten bei der Auflösung tun (Feld leer → Verpuffen
 * R-8.5, Konflikte R-8.2), entscheidet erst die Auflösung (E11).
 */
import type { ActionTarget, ArenaHex, ArenaRef, RejectionReason } from "./actions";
import type { ConfigData, GameData } from "./data";
import type { ArenaScope, TargetSpec } from "./dataTypes";
import { checkOwnCardsChoice } from "./deck";
import {
  centerPositionToArena,
  centerStartCells,
  coordEquals,
  frontArenaSize,
  frontToArena,
  type GridSize,
  inBounds,
  type Seat,
} from "./hex";
import { neighborsOf } from "./seating";
import type { GameState, PlayerIndex, Unit, UnitId } from "./state";

export const ARENA_REFS: readonly ArenaRef[] = ["left", "right", "center"];

/** Abmessungen einer Arena (R-3.2, R-3.4). */
export function arenaSize(config: ConfigData, arena: ArenaRef): GridSize {
  return arena === "center" ? config.arenas.centerArena : frontArenaSize(config.arenas.frontZone);
}

function isIndex(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** Form und Grenzen eines Arena-Felds. */
export function isValidArenaHex(config: ConfigData, raw: unknown): raw is ArenaHex {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (!(ARENA_REFS as readonly unknown[]).includes(r.arena)) return false;
  const cell = r.cell as Record<string, unknown> | null | undefined;
  if (typeof cell !== "object" || cell === null || !isIndex(cell.col) || !isIndex(cell.row)) return false;
  return inBounds({ col: cell.col, row: cell.row }, arenaSize(config, r.arena as ArenaRef));
}

/**
 * Liegt das Feld in einer eigenen Zone? Frontarena `right`: Zeilen 0–2 (der Spieler ist der erste, R-3.2),
 * Frontarena `left`: Zeilen 3–5 (gedreht), Mittelarena: der eigene Startbereich (R-3.4).
 */
export function isOwnHex(config: ConfigData, player: PlayerIndex, hex: ArenaHex): boolean {
  const zoneRows = config.arenas.frontZone.rows;
  switch (hex.arena) {
    case "right":
      return hex.cell.row < zoneRows;
    case "left":
      return hex.cell.row >= zoneRows;
    case "center":
      return centerStartCells(player as Seat, config.arenas.centerArena, config.arenas.centerStartSlots).some((c) =>
        coordEquals(c, hex.cell),
      );
  }
}

/** Arena-Feld, auf dem eine eigene Einheit steht (Reserve: keins). */
export function unitArenaHex(config: ConfigData, unit: Unit): ArenaHex | null {
  const loc = unit.location;
  switch (loc.zone) {
    case "right":
      return { arena: "right", cell: frontToArena("first", loc.cell, config.arenas.frontZone) };
    case "left":
      return { arena: "left", cell: frontToArena("second", loc.cell, config.arenas.frontZone) };
    case "center":
      return {
        arena: "center",
        cell: centerPositionToArena(unit.owner as Seat, loc.position, config.arenas.centerArena, config.arenas.centerStartSlots),
      };
    case "reserve":
      return null;
  }
}

export function sameArenaHex(a: ArenaHex, b: ArenaHex): boolean {
  return a.arena === b.arena && coordEquals(a.cell, b.cell);
}

/** Steht eine eigene Einheit auf diesem Arena-Feld? */
export function ownUnitAtHex(state: GameState, config: ConfigData, player: PlayerIndex, hex: ArenaHex): Unit | undefined {
  return Object.values(state.units).find((u) => {
    if (u.owner !== player) return false;
    const at = unitArenaHex(config, u);
    return at !== null && sameArenaHex(at, hex);
  });
}

function inScope(config: ConfigData, player: PlayerIndex, scope: ArenaScope, hex: ArenaHex): boolean {
  return scope === "participating" || isOwnHex(config, player, hex);
}

function copyHex(hex: ArenaHex): ArenaHex {
  return { arena: hex.arena, cell: { col: hex.cell.col, row: hex.cell.row } };
}

/** Höchstzahlen aus der Anführer-Stufe (`hexes`, `zones`, `count`, siehe `data/README.md`). */
export interface TargetLimits {
  hexes?: number;
  zones?: number;
  count?: number;
}

export interface TargetOptions {
  /** R-7.4: `{ kind: "none" }` ist immer erlaubt (bewusst keine Fähigkeit). */
  allowNone?: boolean;
}

/**
 * Prüft ein Ziel gegen die Ziel-Angabe einer Karte oder Fähigkeit (R-14.2) und gibt es geprüft und
 * kopiert zurück (mehrere Felder immer als `hexes`), sonst den Ablehnungsgrund.
 * Anzahlen sind Höchstwerte: mindestens 1, höchstens das Limit (R-1.9, F23).
 */
export function checkTarget(
  state: GameState,
  data: GameData,
  player: PlayerIndex,
  spec: TargetSpec,
  limits: TargetLimits,
  raw: unknown,
  options: TargetOptions = {},
): ActionTarget | RejectionReason {
  if (raw === undefined && spec.kind === "none") return { kind: "none" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "malformed";
  const r = raw as Record<string, unknown>;
  if (r.kind === "none") return spec.kind === "none" || options.allowNone === true ? { kind: "none" } : "invalidTarget";
  const { config } = data;
  switch (spec.kind) {
    case "none":
      return "invalidTarget";
    case "hex": {
      let list: unknown[];
      if (r.kind === "hex") list = [{ arena: r.arena, cell: r.cell }];
      else if (r.kind === "hexes" && Array.isArray(r.hexes)) list = r.hexes;
      else return "invalidTarget";
      if (list.length === 0) return "invalidTarget";
      if (list.length > (limits.hexes ?? 1)) return "tooManyTargets";
      const hexes: ArenaHex[] = [];
      for (const h of list) {
        if (!isValidArenaHex(config, h) || !inScope(config, player, spec.arenas, h)) return "invalidTarget";
        if (hexes.some((x) => sameArenaHex(x, h))) return "invalidTarget";
        if (spec.mustBeFree === true && ownUnitAtHex(state, config, player, h)) return "cellOccupied";
        hexes.push(copyHex(h));
      }
      return { kind: "hexes", hexes };
    }
    case "zone": {
      if (r.kind !== "zone" || !Array.isArray(r.arenas) || r.arenas.length === 0) return "invalidTarget";
      if (r.arenas.length > (limits.zones ?? 1)) return "tooManyTargets";
      const arenas: ArenaRef[] = [];
      for (const a of r.arenas) {
        if (!(ARENA_REFS as readonly unknown[]).includes(a) || arenas.includes(a as ArenaRef)) return "invalidTarget";
        arenas.push(a as ArenaRef);
      }
      return { kind: "zone", arenas };
    }
    case "player": {
      if (r.kind !== "player" || !isIndex(r.player)) return "invalidTarget";
      const n = neighborsOf(state, player);
      if (!n || (r.player !== n.left && r.player !== n.right)) return "invalidTarget";
      return { kind: "player", player: r.player as PlayerIndex };
    }
    case "ownCards": {
      if (r.kind !== "ownCards") return "invalidTarget";
      const problem = checkOwnCardsChoice(state, player, spec, r.cardInstanceIds);
      if (problem) return problem;
      return { kind: "ownCards", cardInstanceIds: [...(r.cardInstanceIds as number[])] };
    }
    case "moveUnits": {
      if (r.kind !== "moveUnits" || !Array.isArray(r.moves) || r.moves.length === 0) return "invalidTarget";
      if (r.moves.length > (limits.count ?? spec.count)) return "tooManyTargets";
      const scope: ArenaScope = spec.destination === "participatingFreeHex" ? "participating" : "own";
      const moves: { unitId: UnitId; to: ArenaHex }[] = [];
      for (const m of r.moves as unknown[]) {
        if (typeof m !== "object" || m === null) return "invalidTarget";
        const { unitId, to } = m as Record<string, unknown>;
        const unit = isIndex(unitId) ? state.units[unitId] : undefined;
        if (!unit) return "unknownUnit";
        if (unit.owner !== player) return "notOwnUnit";
        if (moves.some((x) => x.unitId === unit.id)) return "invalidTarget";
        if (!isValidArenaHex(config, to) || !inScope(config, player, scope, to)) return "invalidTarget";
        if (moves.some((x) => sameArenaHex(x.to, to)) || ownUnitAtHex(state, config, player, to)) return "cellOccupied";
        moves.push({ unitId: unit.id, to: copyHex(to) });
      }
      return { kind: "moveUnits", moves };
    }
  }
}
