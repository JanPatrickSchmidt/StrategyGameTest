/**
 * Rundenmaschine (E5, R-5).
 *
 * Ablauf: `createGame` → `advance` → Planung einreichen (`submitPlanning`) → `advance`
 * → Käufe einreichen (`submitPurchases`) → `advance` → … `advance` arbeitet alle automatischen
 * Phasen ab und hält an, sobald Eingaben fehlen (Planung, Kaufphase) oder die Partie vorbei ist.
 *
 * Wirtschaft (E6) steht in `economy.ts`. Die Inhalte weiterer Phasen folgen in späteren Aufgaben (E7 Planung, E8/E9 Kampf,
 * E10/E11 Effekte und Zauber, E12 Auswertung und Sieg). Hier steht nur das Gerüst mit
 * Phasenreihenfolge, Eingaben und Ablehnungen.
 */
import { isPlanningActionType, type PlanningAction, type PurchaseList, type RejectionReason } from "./actions";
import type { GameData } from "./data";
import { drawForRound } from "./deck";
import { depositRoundGold, payInterest, playResources, resolvePurchases, startRoundGold, withdraw } from "./economy";
import {
  emit,
  type GameState,
  getPlayer,
  type Phase,
  PLAYER_INDICES,
  type PlayerIndex,
  type SubmissionKind,
} from "./state";

/** R-5: Reihenfolge der Phasen einer Runde. */
export const ROUND_PHASES: readonly Phase[] = [
  "roundStart",
  "planning",
  "reveal",
  "leaderAbilities",
  "preCombatSpells",
  "combat",
  "combatResolution",
  "postCombatSpells",
  "buy",
  "cleanup",
  "victoryCheck",
];

/** R-1.7: Prioritätsreihenfolge in Runde r: (r-1) mod 4, … aufsteigend zyklisch. */
export function priorityOrder(round: number): PlayerIndex[] {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`Runde muss ≥ 1 sein, war ${round}`);
  const n = PLAYER_INDICES.length;
  const start = (round - 1) % n;
  return PLAYER_INDICES.map((_, i) => ((start + i) % n) as PlayerIndex);
}

/** Aktive (nicht ausgeschiedene) Spieler in Prioritätsreihenfolge der laufenden Runde. */
export function activePlayersInPriority(state: GameState): PlayerIndex[] {
  return priorityOrder(state.round).filter((p) => !getPlayer(state, p).eliminated);
}

export type SubmitResult = { ok: true } | { ok: false; reason: RejectionReason };

export type AdvanceResult =
  | { waitingFor: "planning" | "purchases"; players: PlayerIndex[] }
  | { waitingFor: "nothing"; gameOver: true };

export interface AdvanceOptions {
  /**
   * R-7.9: Wer in der aktuell wartenden Phase nichts eingereicht hat, bekommt eine leere Liste.
   * Gilt nur für die Phase, in der `advance` aufgerufen wird.
   */
  timeout?: boolean;
}

function checkSubmission(state: GameState, player: number, kind: SubmissionKind): RejectionReason | null {
  if (!PLAYER_INDICES.includes(player as PlayerIndex)) return "unknownPlayer";
  const p = getPlayer(state, player as PlayerIndex);
  if (state.phase !== (kind === "planning" ? "planning" : "buy")) return "wrongPhase";
  if (p.eliminated) return "playerEliminated";
  const pending = kind === "planning" ? state.pendingPlanning : state.pendingPurchases;
  if (pending[player] !== null && pending[player] !== undefined) return "alreadySubmitted";
  return null;
}

function reject(state: GameState, player: number, kind: SubmissionKind, reason: RejectionReason): SubmitResult {
  // Unbekannte Spieler bekommen kein Ereignis, weil es keinen Spieler gibt, dem es gehört.
  if (PLAYER_INDICES.includes(player as PlayerIndex)) {
    emit(state, { type: "submission_rejected", player: player as PlayerIndex, kind, reason }, [player as PlayerIndex]);
  }
  return { ok: false, reason };
}

/**
 * R-7: reicht die Planung eines Spielers ein (genau einmal pro Runde).
 * Die Aktionen werden erst beim Aufdecken (R-8.1) ausgeführt; bis dahin bleibt der Inhalt privat.
 */
export function submitPlanning(state: GameState, player: number, actions: readonly PlanningAction[]): SubmitResult {
  const problem = checkSubmission(state, player, "planning");
  if (problem) return reject(state, player, "planning", problem);
  if (!Array.isArray(actions)) return reject(state, player, "planning", "malformed");
  state.pendingPlanning[player] = actions.map((a) => structuredCopy(a));
  emit(state, { type: "planning_submitted", player: player as PlayerIndex, actionCount: actions.length });
  return { ok: true };
}

/** R-11.1: reicht die Käufe eines Spielers ein (genau einmal pro Kaufphase). */
export function submitPurchases(state: GameState, player: number, purchases: PurchaseList): SubmitResult {
  const problem = checkSubmission(state, player, "purchases");
  if (problem) return reject(state, player, "purchases", problem);
  if (
    typeof purchases !== "object" ||
    purchases === null ||
    !Array.isArray(purchases.buys) ||
    !purchases.buys.every((b) => typeof b === "string")
  ) {
    return reject(state, player, "purchases", "malformed");
  }
  state.pendingPurchases[player] = { buys: [...purchases.buys] };
  emit(state, { type: "purchases_submitted", player: player as PlayerIndex, buyCount: purchases.buys.length });
  return { ok: true };
}

function missingSubmissions(state: GameState, kind: SubmissionKind): PlayerIndex[] {
  const pending = kind === "planning" ? state.pendingPlanning : state.pendingPurchases;
  return activePlayersInPriority(state).filter((p) => pending[p] === null || pending[p] === undefined);
}

function enterPhase(state: GameState, phase: Phase): void {
  state.phase = phase;
  emit(state, { type: "phase_started", phase });
}

/**
 * Arbeitet Phasen ab, bis Eingaben fehlen oder die Partie vorbei ist (R-5).
 */
export function advance(state: GameState, data: GameData, options: AdvanceOptions = {}): AdvanceResult {
  let timeout = options.timeout === true;
  for (;;) {
    switch (state.phase) {
      case "setup":
        enterPhase(state, "roundStart");
        break;
      case "roundStart":
        runRoundStart(state, data);
        state.pendingPlanning = PLAYER_INDICES.map(() => null);
        enterPhase(state, "planning");
        break;
      case "planning": {
        const missing = missingSubmissions(state, "planning");
        if (missing.length > 0) {
          if (!timeout) return { waitingFor: "planning", players: missing };
          for (const p of missing) {
            state.pendingPlanning[p] = [];
            emit(state, { type: "submission_timeout", player: p, kind: "planning" });
          }
        }
        timeout = false;
        enterPhase(state, "reveal");
        break;
      }
      case "reveal":
        runReveal(state, data);
        enterPhase(state, "leaderAbilities");
        break;
      case "leaderAbilities":
        // R-8.2 folgt in E11.
        enterPhase(state, "preCombatSpells");
        break;
      case "preCombatSpells":
        // R-8.3 folgt in E11.
        enterPhase(state, "combat");
        break;
      case "combat":
        // R-9 folgt in E8/E9.
        enterPhase(state, "combatResolution");
        break;
      case "combatResolution":
        // R-10 folgt in E12.
        enterPhase(state, "postCombatSpells");
        break;
      case "postCombatSpells":
        // R-8.4 folgt in E11.
        state.pendingPurchases = PLAYER_INDICES.map(() => null);
        enterPhase(state, "buy");
        break;
      case "buy": {
        const missing = missingSubmissions(state, "purchases");
        if (missing.length > 0) {
          if (!timeout) return { waitingFor: "purchases", players: missing };
          for (const p of missing) {
            state.pendingPurchases[p] = { buys: [] };
            emit(state, { type: "submission_timeout", player: p, kind: "purchases" });
          }
        }
        timeout = false;
        runBuy(state, data);
        enterPhase(state, "cleanup");
        break;
      }
      case "cleanup":
        runCleanup(state);
        enterPhase(state, "victoryCheck");
        break;
      case "victoryCheck":
        // R-13 folgt in E12.
        if (isGameOver(state)) {
          enterPhase(state, "gameOver");
          break;
        }
        state.round += 1;
        state.phase = "roundStart";
        emit(state, { type: "round_started" });
        emit(state, { type: "phase_started", phase: "roundStart" });
        break;
      case "gameOver":
        return { waitingFor: "nothing", gameOver: true };
    }
  }
}

/** Vorläufig: Die Partie endet, wenn höchstens ein aktiver Spieler übrig ist (R-13.4). */
function isGameOver(state: GameState): boolean {
  return state.players.filter((p) => !p.eliminated).length <= 1;
}

/** R-6: Rundenbeginn in der Reihenfolge R-6.1 Zinsen, R-6.2 Rundenvorrat, R-6.3 Ziehen, R-6.4 Ressourcen. */
function runRoundStart(state: GameState, data: GameData): void {
  payInterest(state, data.config);
  // R-17a.1 („pro Runde“-Effekte) folgt in E10.
  startRoundGold(state);
  drawForRound(state, data.config);
  playResources(state, data);
}

/** R-8.1: alle Planungen werden gleichzeitig wirksam, Abarbeitung in Prioritätsreihenfolge. */
function runReveal(state: GameState, data: GameData): void {
  const order = activePlayersInPriority(state);
  for (const p of order) {
    emit(state, { type: "planning_revealed", player: p, actions: (state.pendingPlanning[p] ?? []).map(structuredCopy) });
  }
  for (const p of order) {
    const actions = state.pendingPlanning[p] ?? [];
    actions.forEach((action, index) => {
      const reason = executePlanningAction(state, data, p, action);
      if (reason) {
        const name = isPlanningActionType((action as { type?: unknown }).type) ? action.type : String((action as { type?: unknown }).type);
        emit(state, { type: "action_rejected", player: p, kind: "planning", index, action: name, reason });
      }
    });
  }
  state.pendingPlanning = PLAYER_INDICES.map(() => null);
}

/** Führt eine Planungsaktion aus. Gibt bei Ablehnung den Grund zurück (R-7). */
function executePlanningAction(
  state: GameState,
  _data: GameData,
  player: PlayerIndex,
  action: PlanningAction,
): RejectionReason | null {
  if (typeof action !== "object" || action === null) return "malformed";
  if (!isPlanningActionType((action as { type?: unknown }).type)) return "unknownActionType";
  switch (action.type) {
    case "withdraw":
      return withdraw(state, player, action.amount);
    default:
      // Übrige Aktionen folgen in E7.
      return "notImplemented";
  }
}

/** R-11: gleichzeitige Käufe (R-11.2–R-11.4), danach Einzahlung (R-11.5). */
function runBuy(state: GameState, data: GameData): void {
  const rejections = resolvePurchases(state, data, activePlayersInPriority(state), state.pendingPurchases);
  for (const r of rejections) {
    emit(state, { type: "action_rejected", player: r.player, kind: "purchases", index: r.index, action: r.cardId, reason: r.reason });
  }
  depositRoundGold(state, data.config);
  state.pendingPurchases = PLAYER_INDICES.map(() => null);
}

/** R-12.1 (Hand und ausgespielte Ressourcen), R-12.2. Anführer-XP, Schilde und Buffs (R-12.3, R-12.4) folgen in E10/E11. */
function runCleanup(state: GameState): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    if (p.hand.length > 0 || p.played.length > 0) {
      const cards = [...p.hand, ...p.played];
      p.hand = [];
      p.played = [];
      p.discard.push(...cards);
      emit(state, { type: "hand_discarded", player: p.index, cardInstanceIds: [...cards] });
    }
  }
  for (const unit of Object.values(state.units)) {
    if (unit.kind !== "token") continue;
    delete state.units[unit.id];
    emit(state, { type: "token_removed", player: unit.owner, unitId: unit.id });
  }
}

function structuredCopy<T>(value: T): T {
  if (value === undefined) return null as T;
  return JSON.parse(JSON.stringify(value)) as T;
}
