/**
 * Eingaben der Spieler: Planungsaktionen (R-7) und Käufe (R-11).
 * Käufe und Entnahme: `economy.ts` (E6). Übrige Planungsaktionen folgen in E7.
 */
import type { OffsetCoord } from "./hex";
import type { CardInstanceId, FrontZoneName, PlayerIndex, UnitId, UnitLocation } from "./state";

/** R-14.2: Feldziel in einer Arena, an der der Spieler teilnimmt. */
export type ArenaRef = FrontZoneName | "center";

export type ActionTarget =
  | { kind: "none" }
  | { kind: "hex"; arena: ArenaRef; cell: OffsetCoord }
  | { kind: "zone"; arenas: ArenaRef[] }
  | { kind: "player"; player: PlayerIndex }
  | { kind: "handCards"; cardInstanceIds: CardInstanceId[] }
  | { kind: "moveUnits"; moves: { unitId: UnitId; to: UnitLocation }[] };

export type PlanningAction =
  /** R-7.1 */
  | { type: "playUnit"; cardInstanceId: CardInstanceId; to: UnitLocation; useAltCost?: boolean }
  /** R-7.2 */
  | { type: "moveUnit"; unitId: UnitId; to: UnitLocation }
  /** R-7.3 */
  | { type: "setSpell"; cardInstanceId: CardInstanceId; slot: "pre" | "post"; target: ActionTarget }
  /** R-7.4 */
  | { type: "setLeaderAbility"; target: ActionTarget }
  /** R-7.5 */
  | { type: "heal"; unitId: UnitId }
  /** R-7.6 */
  | { type: "withdraw"; amount: number }
  /** R-7.7 */
  | { type: "chooseBranch"; branchId: string };

export type PlanningActionType = PlanningAction["type"];

export const PLANNING_ACTION_TYPES: readonly PlanningActionType[] = [
  "playUnit",
  "moveUnit",
  "setSpell",
  "setLeaderAbility",
  "heal",
  "withdraw",
  "chooseBranch",
];

/** R-11.2: ein Kauf ist eine Karten-ID. */
export interface PurchaseList {
  buys: string[];
}

/** Gründe, aus denen eine Eingabe oder Aktion abgelehnt wird. */
export const REJECTION_REASONS = [
  "wrongPhase",
  "playerEliminated",
  "alreadySubmitted",
  "unknownPlayer",
  "malformed",
  "unknownActionType",
  /** R-7.6: Betrag keine positive ganze Zahl. */
  "invalidAmount",
  /** R-7.6: Schatzkammer enthält weniger als den Betrag. */
  "notEnoughTreasury",
  /** R-7 / R-11.2: Rundenvorrat und Schatzkammer reichen nicht. */
  "notEnoughGold",
  /** R-11.2: Karten-ID existiert nicht. */
  "unknownCard",
  /** R-11.2: Karte ist nicht kaufbar (Starter, Token, Fluch, fremder Klassen-Pool). */
  "notBuyable",
  /** R-11.4: Stapel ist leer. */
  "pileEmpty",
  /** Vorübergehend: Ausführung folgt in E7. */
  "notImplemented",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function isPlanningActionType(value: unknown): value is PlanningActionType {
  return typeof value === "string" && (PLANNING_ACTION_TYPES as readonly string[]).includes(value);
}
