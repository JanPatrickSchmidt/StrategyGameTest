/**
 * Zauber mit Ziel legen (C3c1, R-7.3, R-14.2, R-14.8): reine Logik ohne DOM.
 *
 * Für eine Zauberkarte der Hand werden die möglichen Ziele als Auswahl mit Namen erzeugt: Felder (R-3.8,
 * gruppiert nach Arena), eigene Zonen, Nachbarn als Spieler, und für „eigene Karten“ (Läutern) die Karten aus
 * Deck und Ablagestapel zum Ankreuzen. Angeboten wird nur, was die Engine (`checkTarget` auf dem Entwurf) als
 * Ziel annimmt; Kosten, freie Slots und den richtigen Schritt prüft die Engine beim Hinzufügen.
 */
import type { ActionTarget, ArenaHex, CardInstanceId, GameData, PlanningAction, PlayerIndex, PlayerView, RejectionReason, SpellCard, TargetSpec } from "@game/engine";
import { allArenaHexes, ARENA_REFS, PLAYER_INDICES } from "@game/engine";
import { arenaHexName, arenaHexToViewer } from "./fieldNames";
import { ARENA_LABELS } from "./targetText";
import { type CardEntry, handCards, ownEntry, type PlanBuilder } from "./planner";
import { playerName } from "./stateText";

export const SLOT_LABELS: Record<SpellCard["slot"], string> = { pre: "vor dem Kampf", post: "nach dem Kampf" };

/** Eine Zielwahl mit Text für die Oberfläche; `group` fasst Felder nach Arena zusammen. */
export interface TargetOption {
  target: ActionTarget;
  label: string;
  group?: string;
}

/** Eine eigene Karte, die als Ziel angekreuzt werden kann (R-14.8). */
export interface OwnCardOption {
  instanceId: CardInstanceId;
  name: string;
  from: "deck" | "discard";
}

/**
 * Wie das Ziel gewählt wird:
 * - `none`: kein Ziel, einfach legen;
 * - `single`: genau eine Wahl aus `options`;
 * - `ownCards`: bis zu `max` Karten aus `cards` ankreuzen (auch keine, R-1.9).
 */
export type TargetChoice =
  | { kind: "none" }
  | { kind: "single"; options: TargetOption[] }
  | { kind: "ownCards"; max: number; cards: OwnCardOption[] };

/** Zauberkarten auf der Hand (in der Vorschau des Entwurfs). */
export function spellHandCards(data: GameData, view: PlayerView): (CardEntry & { card: SpellCard })[] {
  return handCards(data, view).filter((c): c is CardEntry & { card: SpellCard } => c.card.type === "spell");
}

function spellOf(data: GameData, view: PlayerView, cardInstanceId: CardInstanceId): SpellCard | null {
  return spellHandCards(data, view).find((c) => c.instanceId === cardInstanceId)?.card ?? null;
}

/** Felder in Lesereihenfolge aus Sicht des Spielers: Zeile 1 zuerst, darin a, b, c … */
function sortHexes(data: GameData, viewer: PlayerIndex, hexes: ArenaHex[]): ArenaHex[] {
  const key = (h: ArenaHex): number => {
    const c = arenaHexToViewer(data.config, viewer, h);
    return ARENA_REFS.indexOf(h.arena) * 10000 + c.row * 100 + c.col;
  };
  return hexes.slice().sort((a, b) => key(a) - key(b));
}

/**
 * Mögliche Ziele zu einer Ziel-Angabe (R-14.2), nur solche, die die Engine annimmt. Zonen: die drei eigenen
 * Zonen einzeln (Zauber haben keine Mehrfachziele). Spieler: alle anderen, gefiltert auf die erlaubten (R-14.2:
 * Nachbarn bei Bürde).
 */
export function targetChoice(data: GameData, builder: PlanBuilder, spec: TargetSpec): TargetChoice {
  const viewer = builder.player;
  const accepted = (target: ActionTarget): boolean => typeof builder.checkTarget(spec, target) !== "string";
  switch (spec.kind) {
    case "none":
      return { kind: "none" };
    case "hex": {
      const hexes = sortHexes(
        data,
        viewer,
        allArenaHexes(data.config).filter((h) => accepted({ kind: "hex", arena: h.arena, cell: h.cell })),
      );
      return {
        kind: "single",
        options: hexes.map((h) => ({
          target: { kind: "hex", arena: h.arena, cell: { ...h.cell } },
          label: arenaHexName(data.config, viewer, h),
          group: ARENA_LABELS[h.arena],
        })),
      };
    }
    case "zone":
      return {
        kind: "single",
        options: ARENA_REFS.map((a): TargetOption => ({ target: { kind: "zone", arenas: [a] }, label: ARENA_LABELS[a] })).filter((o) => accepted(o.target)),
      };
    case "player": {
      const view = builder.preview();
      return {
        kind: "single",
        options: PLAYER_INDICES.filter((p) => p !== viewer && !view.players[p]?.eliminated)
          .map((p): TargetOption => ({ target: { kind: "player", player: p }, label: playerName(p, viewer) }))
          .filter((o) => accepted(o.target)),
      };
    }
    case "ownCards": {
      const view = builder.preview();
      const own = ownEntry(view);
      const cards: OwnCardOption[] = [];
      for (const from of spec.from) {
        const ids = from === "deck" ? own.deckContents : own.discard;
        for (const instanceId of ids) {
          const instance = view.cards[instanceId];
          const name = (instance && data.cards.get(instance.cardId)?.name) ?? `Karte ${instanceId}`;
          cards.push({ instanceId, name, from });
        }
      }
      return { kind: "ownCards", max: spec.max, cards };
    }
    case "moveUnits":
      // Nur Anführer-Fähigkeiten (Vex) haben dieses Ziel; das kommt mit C3d.
      return { kind: "single", options: [] };
  }
}

/** Zielwahl für eine Zauberkarte der Hand (`null`, wenn die Karte kein Zauber auf der Hand ist). */
export function spellTargetChoice(data: GameData, builder: PlanBuilder, cardInstanceId: CardInstanceId): TargetChoice | null {
  const spell = spellOf(data, builder.preview(), cardInstanceId);
  return spell ? targetChoice(data, builder, spell.target) : null;
}

/** Die Planungsaktion für einen Zauber mit Ziel; der Slot kommt aus den Kartendaten (F22). */
export function spellAction(data: GameData, view: PlayerView, cardInstanceId: CardInstanceId, target: ActionTarget): PlanningAction | null {
  const spell = spellOf(data, view, cardInstanceId);
  return spell ? { type: "setSpell", cardInstanceId, slot: spell.slot, target } : null;
}

/**
 * R-7.3: Zauber legen (Schritt Ausspielen). Wechselt in den Schritt Ausspielen; den Rest prüft die Engine.
 * Liefert den Ablehnungsgrund oder `null`.
 */
export function addSpell(data: GameData, builder: PlanBuilder, cardInstanceId: CardInstanceId, target: ActionTarget): RejectionReason | null {
  const action = spellAction(data, builder.preview(), cardInstanceId, target);
  if (!action) return "notASpellCard";
  if (builder.step !== "play") builder.setStep("play");
  return builder.add(action);
}
