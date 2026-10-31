/**
 * Rundenmaschine (E5, R-5).
 *
 * Ablauf: `createGame` → `advance` → Planung einreichen (`submitPlanning`, eine pro Spieler mit den
 * Abschnitten `play`, `buy`, `position`) → `advance` → … `advance` arbeitet alle automatischen Phasen
 * ab und hält an, sobald Planungen fehlen (der einzige Wartepunkt einer Runde) oder die Partie vorbei ist.
 *
 * Wirtschaft (E6) steht in `economy.ts`. Die Inhalte weiterer Phasen folgen in späteren Aufgaben (E7 Planung, E8/E9 Kampf,
 * E10/E11 Effekte und Zauber, E12 Auswertung und Sieg). Hier steht nur das Gerüst mit
 * Phasenreihenfolge, Eingaben und Ablehnungen.
 */
import {
  emptyPlanning,
  isPlanningActionType,
  type Planning,
  type PlanningAction,
  PLANNING_SECTIONS,
  type PlanningSection,
  type RejectionReason,
  SECTION_ACTIONS,
} from "./actions";
import type { GameData } from "./data";
import { healUnit, markReserveRest, moveUnit, playUnit, recoverInReserve } from "./board";
import { drawEndOfRound } from "./deck";
import { autoChooseBranch, chooseBranch, grantRoundXp, levelUpLeaders, resetLeaderAbilities, setLeaderAbility } from "./leader";
import { runCombatPhase } from "./center";
import { runRoundStartEffects } from "./aftermath";
import { applyRoundStartMarks } from "./marks";
import { mergeUnits } from "./merge";
import { discardSetSpells, setSpell } from "./spells";
import {
  buyCard,
  depositRoundGold,
  finishPurchases,
  payInterest,
  playResources,
  type PurchaseSession,
  startPurchases,
  withdraw,
} from "./economy";
import { emit, type GameState, getPlayer, type Phase, PLAYER_INDICES, type PlayerIndex } from "./state";

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
  | { waitingFor: "planning"; players: PlayerIndex[] }
  | { waitingFor: "nothing"; gameOver: true };

export interface AdvanceOptions {
  /** R-7.9: Wer bis jetzt keine Planung eingereicht hat, plant leere Abschnitte. */
  timeout?: boolean;
}

function checkSubmission(state: GameState, player: number): RejectionReason | null {
  if (!PLAYER_INDICES.includes(player as PlayerIndex)) return "unknownPlayer";
  const p = getPlayer(state, player as PlayerIndex);
  if (state.phase !== "planning") return "wrongPhase";
  if (p.eliminated) return "playerEliminated";
  const pending = state.pendingPlanning[player];
  if (pending !== null && pending !== undefined) return "alreadySubmitted";
  return null;
}

function reject(state: GameState, player: number, reason: RejectionReason): SubmitResult {
  // Unbekannte Spieler bekommen kein Ereignis, weil es keinen Spieler gibt, dem es gehört.
  if (PLAYER_INDICES.includes(player as PlayerIndex)) {
    emit(state, { type: "submission_rejected", player: player as PlayerIndex, reason }, [player as PlayerIndex]);
  }
  return { ok: false, reason };
}

/**
 * Prüft die Form einer Planung: ein Objekt mit den Abschnitten `play`, `buy` und `position`, jeweils
 * eine Liste (fehlender Abschnitt = leer). Weitere Felder sind nicht erlaubt. Den Inhalt der Aktionen
 * prüft erst das Ausführen beim Aufdecken.
 */
function normalizePlanning(planning: unknown): Planning | null {
  if (typeof planning !== "object" || planning === null || Array.isArray(planning)) return null;
  const raw = planning as Record<string, unknown>;
  if (Object.keys(raw).some((k) => !(PLANNING_SECTIONS as readonly string[]).includes(k))) return null;
  const result = emptyPlanning();
  for (const section of PLANNING_SECTIONS) {
    const list = raw[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return null;
    result[section] = list.map((a) => structuredCopy(a as PlanningAction));
  }
  return result;
}

/**
 * R-5: reicht die eine Planung eines Spielers für diese Runde ein (genau einmal).
 * Die Abschnitte werden erst beim Aufdecken (R-8.1) ausgeführt; bis dahin bleibt der Inhalt privat (R-18.2).
 */
export function submitPlanning(state: GameState, player: number, planning: Partial<Planning>): SubmitResult {
  const problem = checkSubmission(state, player);
  if (problem) return reject(state, player, problem);
  const normalized = normalizePlanning(planning);
  if (!normalized) return reject(state, player, "malformed");
  state.pendingPlanning[player] = normalized;
  const actionCount = PLANNING_SECTIONS.reduce((n, section) => n + normalized[section].length, 0);
  emit(state, { type: "planning_submitted", player: player as PlayerIndex, actionCount });
  return { ok: true };
}

function missingPlanning(state: GameState): PlayerIndex[] {
  return activePlayersInPriority(state).filter((p) => state.pendingPlanning[p] === null || state.pendingPlanning[p] === undefined);
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
        const missing = missingPlanning(state);
        if (missing.length > 0) {
          if (!timeout) return { waitingFor: "planning", players: missing };
          for (const p of missing) {
            state.pendingPlanning[p] = emptyPlanning();
            emit(state, { type: "submission_timeout", player: p });
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
        // R-6.5: wer jetzt in der Reserve steht, verbringt den Kampf dort.
        markReserveRest(state);
        // R-9: alle Frontkämpfe (E8b) und der Mittelkampf (E9) auf demselben Ausgangszustand.
        runCombatPhase(state, data);
        enterPhase(state, "combatResolution");
        break;
      case "combatResolution":
        // R-10 folgt in E12.
        enterPhase(state, "postCombatSpells");
        break;
      case "postCombatSpells":
        // R-8.4 folgt in E11.
        enterPhase(state, "cleanup");
        break;
      case "cleanup":
        runCleanup(state, data);
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

/**
 * R-6: Rundenbeginn in der Reihenfolge R-17a.1 „pro Runde“-Effekte, R-6.1 Zinsen, R-6.5 Genesung durch Reserve, R-6.6 Anführer-Aufstieg,
 * R-6.4 Ressourcen.
 * R-6.2: Der Rundenvorrat beginnt bei 0; das stellt die Einzahlung am Rundenende sicher (R-12.5).
 * R-6.3: Zu Rundenbeginn wird nicht gezogen; die Hand stammt aus R-4.6 bzw. R-12.6.
 */
function runRoundStart(state: GameState, data: GameData): void {
  // R-6.1/R-17a.1: „pro Runde“-Effekte vor den Zinsen (F31), Gold in den Rundenvorrat bzw. die Schatzkammer.
  runRoundStartEffects(state, data);
  // R-17a.2: Markierungen „nächste Runde“ (Gold) direkt danach, ebenfalls vor den Zinsen (F32).
  applyRoundStartMarks(state);
  payInterest(state, data.config);
  recoverInReserve(state);
  levelUpLeaders(state, data.config);
  playResources(state, data);
}

/**
 * R-8.1: alle Planungen werden gleichzeitig wirksam. Jeder Spieler wird in Prioritätsreihenfolge
 * vollständig abgearbeitet, Abschnitt für Abschnitt: `play` (R-7), `buy` (R-11.1, Gold sofort),
 * `position` (R-7b). Die Käufe werden danach gleichzeitig verteilt (R-11.3).
 */
function runReveal(state: GameState, data: GameData): void {
  const order = activePlayersInPriority(state);
  for (const p of order) {
    emit(state, { type: "planning_revealed", player: p, planning: structuredCopy(state.pendingPlanning[p] ?? emptyPlanning()) });
  }
  const purchases = startPurchases(state);
  for (const p of order) {
    const planning = state.pendingPlanning[p] ?? emptyPlanning();
    for (const section of PLANNING_SECTIONS) {
      planning[section].forEach((action, index) => {
        const reason = executePlanningAction(state, data, purchases, p, section, action);
        if (reason) {
          const type = (action as { type?: unknown } | null)?.type;
          const name = typeof type === "string" ? type : String(type);
          emit(state, { type: "action_rejected", player: p, section, index, action: name, reason });
        }
        // R-7.8: Verschmelzen nach jeder Aktion, also schon beim Ausspielen.
        mergeUnits(state, p);
      });
      // R-7.7: ohne Wahl der erste Ast, direkt nach dem Ausspielen.
      if (section === "play") autoChooseBranch(state, data, p);
    }
  }
  finishPurchases(purchases, state);
  state.pendingPlanning = PLAYER_INDICES.map(() => null);
}

/** Führt eine Planungsaktion aus. Gibt bei Ablehnung den Grund zurück (R-7). */
function executePlanningAction(
  state: GameState,
  data: GameData,
  purchases: PurchaseSession,
  player: PlayerIndex,
  section: PlanningSection,
  action: PlanningAction,
): RejectionReason | null {
  if (typeof action !== "object" || action === null) return "malformed";
  if (!isPlanningActionType((action as { type?: unknown }).type)) return "unknownActionType";
  if (!SECTION_ACTIONS[section].includes(action.type)) return "wrongSection";
  switch (action.type) {
    case "buy":
      return buyCard(purchases, state, data, player, action.cardId);
    case "withdraw":
      return withdraw(state, player, action.amount);
    case "playUnit":
      return playUnit(state, data, player, action.cardInstanceId, action.to, action.useAltCost, action.sacrifice);
    case "moveUnit":
      return moveUnit(state, data, player, action.unitId, action.to);
    case "heal":
      return healUnit(state, data, player, action.unitId);
    case "setSpell":
      return setSpell(state, data, player, action.cardInstanceId, action.slot, action.target);
    case "setLeaderAbility":
      return setLeaderAbility(state, data, player, action.target);
    case "chooseBranch":
      return chooseBranch(state, data, player, action.branchId);
  }
}

/**
 * R-12 Rundenende: R-12.1 (Hand und ausgespielte Ressourcen), R-12.2 (Tokens), R-12.3 (Anführer-XP),
 * R-12.5 (Gold in die Schatzkammer), R-12.6 (Nachziehen). Schilde und Buffs (R-12.4) folgen in E10/E11.
 * Noch liegende Zauber gehen auf den Ablagestapel (R-8.6), die gewählte Anführer-Fähigkeit verfällt (R-16.4).
 */
function runCleanup(state: GameState, data: GameData): void {
  discardSetSpells(state);
  resetLeaderAbilities(state);
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
  grantRoundXp(state, data.config);
  depositRoundGold(state);
  drawEndOfRound(state, data.config);
}

function structuredCopy<T>(value: T): T {
  if (value === undefined) return null as T;
  return JSON.parse(JSON.stringify(value)) as T;
}
