/**
 * Eingaben der Spieler: eine Planung pro Runde mit den Abschnitten `play`, `buy` und `position`
 * (R-5, R-7, R-7b, R-11).
 * Käufe und Entnahme: `economy.ts` (E6). Ausspielen, Bewegen, Genesen: `board.ts` (E7a).
 * Zauber, Anführer-Fähigkeit, Astwahl und alternative Kosten folgen in E7b/E7c.
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
  /** R-14.8: eigene Karteninstanzen aus Deck oder Ablagestapel. */
  | { kind: "ownCards"; cardInstanceIds: CardInstanceId[] }
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
  | { type: "chooseBranch"; branchId: string }
  /** R-11.2 */
  | { type: "buy"; cardId: string };

export type PlanningActionType = PlanningAction["type"];

export const PLANNING_ACTION_TYPES: readonly PlanningActionType[] = [
  "playUnit",
  "moveUnit",
  "setSpell",
  "setLeaderAbility",
  "heal",
  "withdraw",
  "chooseBranch",
  "buy",
];

/** R-5: Abschnitte der Planung, in dieser Reihenfolge ausgeführt. */
export const PLANNING_SECTIONS = ["play", "buy", "position"] as const;
export type PlanningSection = (typeof PLANNING_SECTIONS)[number];

/**
 * Erlaubte Aktionen je Abschnitt: R-7 (Ausspielen, inklusive Astwahl R-7.7), R-11 (Kaufen),
 * R-7b (Aufstellen, inklusive Anführer-Fähigkeit R-7.4). Entnahme ist in jedem Abschnitt erlaubt (R-7.6).
 */
export const SECTION_ACTIONS: Record<PlanningSection, readonly PlanningActionType[]> = {
  play: ["playUnit", "setSpell", "heal", "chooseBranch", "withdraw"],
  buy: ["buy", "withdraw"],
  position: ["moveUnit", "setLeaderAbility", "withdraw"],
};

/** R-5: die eine Planung eines Spielers pro Runde. */
export interface Planning {
  play: PlanningAction[];
  buy: PlanningAction[];
  position: PlanningAction[];
}

/** R-7.9: leere Planung (Timeout). */
export function emptyPlanning(): Planning {
  return { play: [], buy: [], position: [] };
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
  /** R-7.1: Karteninstanz ist nicht auf der Hand. */
  "cardNotInHand",
  /** R-7.1: Karte ist keine Einheitenkarte. */
  "notAUnitCard",
  /** R-7.1/R-7.2: Ort existiert nicht (Zone, Feld, Position oder Reserveplatz). */
  "invalidLocation",
  /** R-7.1/R-7.2: Zielfeld ist besetzt. */
  "cellOccupied",
  /** R-3.6: Kapazität erreicht. */
  "capacityExceeded",
  /** R-7.2/R-7.5: Einheit existiert nicht. */
  "unknownUnit",
  /** R-7.2/R-7.5: Einheit gehört einem anderen Spieler. */
  "notOwnUnit",
  /** R-7.2: Einheit steht bereits dort. */
  "sameLocation",
  /** R-7.5: Einheit ist nicht verwundet. */
  "notWounded",
  /** R-11.2: Karten-ID existiert nicht. */
  "unknownCard",
  /** R-11.2: Karte ist nicht kaufbar (Starter, Token, Fluch, fremder Klassen-Pool). */
  "notBuyable",
  /** R-5: Aktion ist in diesem Abschnitt der Planung nicht erlaubt. */
  "wrongSection",
  /** R-11.4: Stapel ist leer. */
  "pileEmpty",
  /** R-11.3: Spieler kauft schon so viele Kopien, wie der Stapel zu Beginn der Runde enthielt. */
  "pileLimitReached",
  /** R-14.8: gewählte Karte ist doppelt, nicht die eigene oder liegt nicht in einem erlaubten Bereich. */
  "invalidCardChoice",
  /** R-14.8: mehr Karten gewählt als `max`. */
  "tooManyCards",
  /** Vorübergehend: Ausführung folgt in E7b/E7c. */
  "notImplemented",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function isPlanningActionType(value: unknown): value is PlanningActionType {
  return typeof value === "string" && (PLANNING_ACTION_TYPES as readonly string[]).includes(value);
}
