/**
 * Anführer in der Planung (C3d1): Astwahl (R-7.7, R-16.2) und Anführer-Fähigkeit mit Ziel (R-7.4, R-16.4,
 * R-16.6). Reine Logik ohne DOM.
 *
 * Angeboten wird nur, was die Engine annimmt: Ziele werden einzeln über `PlanBuilder.checkLeaderTarget` (Engine
 * `checkTarget` mit den Höchstzahlen der Stufe) geprüft, die endgültige Auswahl prüft die Engine beim Hinzufügen.
 * Mehrfachziele (Brann „Weite“: mehrere Zonen, Ilyra „Kette“: mehrere Felder, Vex „Doppelt“: mehrere Einheiten)
 * werden als Höchstzahl angeboten; weniger ist erlaubt (R-1.9, F23).
 */
import type { ActionTarget, ArenaHex, GameData, LeaderBranch, PlanningAction, PlayerIndex, RejectionReason, TargetSpec, UnitId } from "@game/engine";
import { allArenaHexes, ARENA_REFS, branchChoiceOpen, PLAYER_INDICES } from "@game/engine";
import { arenaHexName, arenaHexToViewer } from "./fieldNames";
import { type PlanBuilder, unitOptionText } from "./planner";
import type { TargetOption } from "./spellTargets";
import { playerName } from "./stateText";
import { ARENA_LABELS } from "./targetText";

/** Ein Ast zur Wahl (R-7.7). */
export interface BranchOption {
  id: string;
  name: string;
}

/**
 * R-7.7: Astwahl in dieser Planung. `null`, wenn keine Wahl ansteht (Anführer unter Stufe 2 oder Ast schon
 * gewählt). `chosen` ist der in dieser Planung gewählte Ast, sonst `null` (dann nimmt das Aufdecken den ersten).
 */
export interface BranchChoice {
  options: BranchOption[];
  chosen: string | null;
}

export function branchChoice(builder: PlanBuilder): BranchChoice | null {
  const leader = builder.startLeader();
  if (!branchChoiceOpen(leader)) return null;
  const options = builder.leaderData().active.branches.map((b: LeaderBranch): BranchOption => ({ id: b.id, name: b.name }));
  const planned = builder.entries().find((e) => e.action.type === "chooseBranch" && e.rejection === null);
  return { options, chosen: planned?.action.type === "chooseBranch" ? planned.action.branchId : null };
}

/**
 * R-7.7: Ast wählen (Schritt Ausspielen). Eine schon geplante Astwahl wird ersetzt. Lehnt die Engine ab, bleibt
 * die Planung unverändert.
 */
export function setBranch(builder: PlanBuilder, branchId: string): RejectionReason | null {
  const previous = builder.entries().find((e) => e.action.type === "chooseBranch");
  if (previous) builder.remove(previous.section, previous.index);
  if (builder.step !== "play") builder.setStep("play");
  const reason = builder.add({ type: "chooseBranch", branchId });
  if (reason && previous) {
    builder.setStep(previous.section);
    builder.add(previous.action);
    builder.setStep("play");
  }
  return reason;
}

/** Name eines Asts aus den Anführerdaten (für Texte), sonst die Kennung. */
export function branchName(builder: PlanBuilder, branchId: string): string {
  return builder.leaderData().active.branches.find((b) => b.id === branchId)?.name ?? branchId;
}

/** Eine eigene Einheit, die Vex versetzen darf (R-16.6). */
export interface AbilityUnitOption {
  unitId: UnitId;
  label: string;
}

/**
 * Wie das Ziel der Fähigkeit gewählt wird:
 * - `none`: Fähigkeit ohne Ziel;
 * - `pick`: bis zu `max` verschiedene Ziele aus `options` (Zonen, Felder oder ein Spieler);
 * - `moves`: bis zu `max` Paare aus eigener Einheit (`units`) und freiem Feld (`destinations`), R-16.6.
 */
export type AbilityChoice =
  | { kind: "none" }
  | { kind: "pick"; max: number; options: TargetOption[] }
  | { kind: "moves"; max: number; units: AbilityUnitOption[]; destinations: TargetOption[] };

/** Stand der Anführer-Fähigkeit in dieser Planung. */
export interface AbilityState {
  /** Name der Fähigkeit, z. B. „Sammelruf“. */
  name: string;
  /** Stufe und Ast, z. B. „Stufe 2, Ast Weite“ oder „Stufe 1“. */
  levelText: string;
  /** R-14.5: vernichteter Anführer, in dieser Planung keine Fähigkeit. */
  unavailable: boolean;
  /** Schon gewählt (R-7.4: höchstens einmal); entfernen über die Liste „Geplant“. */
  planned: boolean;
  choice: AbilityChoice;
}

/** Felder in Lesereihenfolge aus Sicht des Spielers (wie bei Zaubern). */
function sortHexes(data: GameData, viewer: PlayerIndex, hexes: ArenaHex[]): ArenaHex[] {
  const key = (h: ArenaHex): number => {
    const c = arenaHexToViewer(data.config, viewer, h);
    return ARENA_REFS.indexOf(h.arena) * 10000 + c.row * 100 + c.col;
  };
  return hexes.slice().sort((a, b) => key(a) - key(b));
}

function hexOption(data: GameData, viewer: PlayerIndex, h: ArenaHex): TargetOption {
  return { target: { kind: "hex", arena: h.arena, cell: { ...h.cell } }, label: arenaHexName(data.config, viewer, h), group: ARENA_LABELS[h.arena] };
}

function choiceFor(data: GameData, builder: PlanBuilder, spec: TargetSpec): AbilityChoice {
  const viewer = builder.player;
  const params = builder.leaderAbility();
  const accepted = (target: ActionTarget): boolean => typeof builder.checkLeaderTarget(target) !== "string";
  switch (spec.kind) {
    case "none":
      return { kind: "none" };
    case "hex": {
      const hexes = allArenaHexes(data.config).filter((h) => accepted({ kind: "hex", arena: h.arena, cell: h.cell }));
      return { kind: "pick", max: params.limits.hexes ?? 1, options: sortHexes(data, viewer, hexes).map((h) => hexOption(data, viewer, h)) };
    }
    case "zone":
      return {
        kind: "pick",
        max: params.limits.zones ?? 1,
        options: ARENA_REFS.map((a): TargetOption => ({ target: { kind: "zone", arenas: [a] }, label: ARENA_LABELS[a] })).filter((o) => accepted(o.target)),
      };
    case "player": {
      const view = builder.preview();
      return {
        kind: "pick",
        max: 1,
        options: PLAYER_INDICES.filter((p) => p !== viewer && !view.players[p]?.eliminated)
          .map((p): TargetOption => ({ target: { kind: "player", player: p }, label: playerName(p, viewer) }))
          .filter((o) => accepted(o.target)),
      };
    }
    case "ownCards":
      // Kein Anführer hat dieses Ziel (Läutern ist ein Zauber); bewusst nicht angeboten.
      return { kind: "pick", max: 0, options: [] };
    case "moveUnits": {
      // Nur Einheiten vom Beginn der Planung: IDs neu ausgespielter vergibt erst das Aufdecken (R-1.7).
      const units = builder.movableUnits().map((u): AbilityUnitOption => ({ unitId: u.id, label: unitOptionText(data, u) }));
      const probe = units[0];
      const destinations = probe
        ? sortHexes(
            data,
            viewer,
            allArenaHexes(data.config).filter((h) => accepted({ kind: "moveUnits", moves: [{ unitId: probe.unitId, to: { arena: h.arena, cell: h.cell } }] })),
          ).map((h) => hexOption(data, viewer, h))
        : [];
      return { kind: "moves", max: params.limits.count ?? spec.count, units, destinations };
    }
  }
}

/** C3d1: Stand und Zielwahl der Anführer-Fähigkeit (R-7.4, R-16.2, R-16.4, R-16.6). */
export function abilityState(data: GameData, builder: PlanBuilder): AbilityState {
  const leaderData = builder.leaderData();
  const start = builder.startLeader();
  const branch = builder.draftBranch();
  const levelText = start.level >= 2 && branch !== null ? `Stufe ${start.level}, Ast ${branchName(builder, branch)}` : `Stufe ${start.level}`;
  return {
    name: leaderData.active.name,
    levelText,
    unavailable: start.returnsInRound !== undefined,
    planned: builder.plannedAbility() !== null,
    choice: choiceFor(data, builder, builder.leaderAbility().target),
  };
}

/**
 * Fasst die gewählten Einzelziele zu einem Ziel der Fähigkeit zusammen: Zonen zu einer Zone mit mehreren Arenen,
 * Felder zu `hexes`, ein Spieler bleibt ein Spieler. `null`, wenn nichts gewählt ist.
 */
export function combinePicks(picked: readonly ActionTarget[]): ActionTarget | null {
  const [first] = picked;
  if (!first) return null;
  if (first.kind === "zone") return { kind: "zone", arenas: picked.flatMap((t) => (t.kind === "zone" ? t.arenas : [])) };
  if (first.kind === "hex" || first.kind === "hexes") {
    return {
      kind: "hexes",
      hexes: picked.flatMap((t) => (t.kind === "hex" ? [{ arena: t.arena, cell: { ...t.cell } }] : t.kind === "hexes" ? t.hexes : [])),
    };
  }
  return first;
}

/** R-16.6: Ziel für Vex aus gewählten Paaren (Einheit, Feld). `null`, wenn kein Paar gewählt ist. */
export function movesTarget(moves: readonly { unitId: UnitId; to: ActionTarget }[]): ActionTarget | null {
  const list = moves.flatMap((m) => (m.to.kind === "hex" ? [{ unitId: m.unitId, to: { arena: m.to.arena, cell: { ...m.to.cell } } }] : []));
  return list.length > 0 ? { kind: "moveUnits", moves: list } : null;
}

/**
 * R-7.4: Anführer-Fähigkeit wählen (Schritt Aufstellen); `{ kind: "none" }` = bewusst keine. Wechselt in den
 * Schritt Aufstellen; den Rest (höchstens einmal, Ziel, Höchstzahlen) prüft die Engine.
 */
export function addAbility(builder: PlanBuilder, target: ActionTarget): RejectionReason | null {
  const action: PlanningAction = { type: "setLeaderAbility", target };
  if (builder.step !== "position") builder.setStep("position");
  return builder.add(action);
}
