/**
 * Ziele von Zaubern und Fähigkeiten als Text (C3c1, R-3.8, R-14.2), z. B. für die Liste der geplanten Aktionen.
 */
import type { ActionTarget, ArenaRef, GameData, PlayerView } from "@game/engine";
import { arenaHexName } from "./fieldNames";
import { playerName } from "./stateText";

export const ARENA_LABELS: Record<ArenaRef, string> = { left: "Linke Front", right: "Rechte Front", center: "Mitte" };

/**
 * Text eines Ziels für die Liste der geplanten Aktionen, z. B. „Rechte Front c5“, „Linke Front“, „Bot 2“,
 * „Münze, Fluch“ oder „ohne Ziel“. `view` ist die Sicht zu Beginn der Planung (Kartennamen).
 */
export function targetText(data: GameData, view: PlayerView, target: ActionTarget): string {
  const viewer = view.viewer;
  switch (target.kind) {
    case "none":
      return "ohne Ziel";
    case "hex":
      return arenaHexName(data.config, viewer, target);
    case "hexes":
      return target.hexes.map((h) => arenaHexName(data.config, viewer, h)).join(", ");
    case "zone":
      return target.arenas.map((a) => ARENA_LABELS[a]).join(", ");
    case "player":
      return playerName(target.player, viewer);
    case "ownCards":
      if (target.cardInstanceIds.length === 0) return "keine Karte";
      return target.cardInstanceIds
        .map((id) => {
          const instance = view.cards[id];
          return (instance && data.cards.get(instance.cardId)?.name) ?? `Karte ${id}`;
        })
        .join(", ");
    case "moveUnits":
      return target.moves.map((m) => `Einheit ${m.unitId} → ${arenaHexName(data.config, viewer, m.to)}`).join(", ");
  }
}
