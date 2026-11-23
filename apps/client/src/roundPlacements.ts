/**
 * P16: Ort und Aussehen der Einheiten, die in einer Runde neu auf das Brett kommen – reine Logik ohne Babylon und
 * ohne Spielzustand.
 *
 * R-19.2: Die Wiedergabe einer Runde zeigt Einheiten, die nicht kämpfen (z. B. vor dem Kampf besiegt), als
 * Brett-Figuren. Für Einheiten, die es schon vor der Runde gab, liefert die Planungsansicht den Ort. Eine in dieser
 * Runde gespielte (`unit_played`) oder vor dem Kampf beschworene (`unit_summoned`) Einheit fehlt dort – bei einem
 * Gegner ist sie in der Planung verdeckt (R-18). Ihr Ort kommt deshalb aus diesen Ereignissen, danach aus
 * `unit_moved` derselben Runde bis zum Beginn der Kämpfe.
 */
import { fighterFromData, type GameData, type GameEvent, type PlayerIndex, type UnitId } from "@game/engine";
import { figureShape, type FigureShape } from "./unitFigures";

type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;
type UnitLocation = EventOf<"unit_moved">["to"];

export interface UnitPlacement {
  unit: UnitId;
  owner: PlayerIndex;
  sourceId: string;
  kind: "card" | "token";
  shape: FigureShape;
  /** Leben laut Daten (Ein-Stern-Werte, bei Tokens mit `statOverride`), vor allen Wirkungen der Runde. */
  hp: number;
  location: UnitLocation;
}

/** Phasen, in denen Einheiten neu auf das Brett kommen bzw. vor den Kämpfen noch bewegt werden. */
const BEFORE_COMBAT: ReadonlySet<string> = new Set(["roundStart", "planning", "reveal", "leaderAbilities", "preCombatSpells"]);

function baseHp(data: GameData, owner: PlayerIndex, unit: UnitId, kind: "card" | "token", sourceId: string): number {
  if (!data.cards.has(sourceId)) return 0;
  return fighterFromData(data, { id: unit, team: owner, kind, sourceId, stars: 1, pos: { col: 0, row: 0 } }).stats.hp;
}

/** Neue Einheiten der Runde `round` mit ihrem Ort vor den Kämpfen, nach Einheiten-ID. */
export function roundPlacements(data: GameData, events: readonly GameEvent[], round: number): Map<UnitId, UnitPlacement> {
  const placements = new Map<UnitId, UnitPlacement>();
  for (const e of events) {
    if (e.round !== round || !BEFORE_COMBAT.has(e.phase)) continue;
    if (e.type === "unit_played" || e.type === "unit_summoned") {
      const kind = e.type === "unit_played" ? "card" : "token";
      let hp = baseHp(data, e.player, e.unitId, kind, e.sourceId);
      if (e.type === "unit_summoned" && e.statOverride?.hp !== undefined) hp = e.statOverride.hp;
      placements.set(e.unitId, {
        unit: e.unitId,
        owner: e.player,
        sourceId: e.sourceId,
        kind,
        shape: figureShape(data, { kind, sourceId: e.sourceId }),
        hp,
        location: e.location,
      });
    } else if (e.type === "unit_moved") {
      const p = placements.get(e.unitId);
      if (p) placements.set(e.unitId, { ...p, location: e.to });
    }
  }
  return placements;
}
