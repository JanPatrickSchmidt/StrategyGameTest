/**
 * Vorkampf-Zauber (R-8.3, R-8.5, E11b1): Wirkungen auf eigene Einheiten, die in alle Kämpfe der Runde
 * übernommen werden – Schild (Schutzrune), Buff `combat`/`round` (Kriegsruf), Schlüsselwort (Giftklinge).
 *
 * Die Wirkungen liegen bis zum Aufräumen als `unit.roundEffects` an der Einheit (R-12.4, R-14.3) und werden
 * in `fighterForUnit` (`fronts.ts`) auf die Kampfwerte übertragen. Alle Kämpfe einer Runde nutzen denselben
 * Ausgangszustand (R-9), deshalb wirken `combat` und `round` innerhalb der Runde gleich (F38).
 */
import type { ArenaHex, ArenaRef } from "./actions";
import type { FighterInit } from "./combat";
import type { ConfigData } from "./data";
import type { Effect, Keyword, Stat } from "./dataTypes";
import { addStatBonuses } from "./resonance";
import { emit, type GameState, getPlayer, type PlayerIndex, type SetSpell, type Unit, type UnitRoundEffects } from "./state";
import { neighborsOf } from "./seating";
import { sameArenaHex, unitArenaHex } from "./targets";

/** Effekt-Bausteine, die Vorkampf-Zauber in E11b1 schon wirken lassen. */
export const PRE_COMBAT_OPS: ReadonlySet<Effect["op"]> = new Set(["shield", "buff", "grantKeyword", "wound"]);

/**
 * R-8.5: gültige Einheiten eines Vorkampf-Zaubers zum Zeitpunkt der Auflösung. `hexAlly` = die eigene, nicht
 * verwundete Einheit auf dem gewählten Feld; `zoneAllies` = alle eigenen, nicht verwundeten Einheiten der
 * gewählten Zone(n) (inkl. Anführer und Tokens), nach ID. Verwundete Einheiten kämpfen nicht (R-14.4) und
 * sind deshalb kein gültiges Ziel.
 */
export function preCombatAllies(state: GameState, config: ConfigData, player: PlayerIndex, spell: SetSpell, target: string): Unit[] {
  const own = Object.values(state.units)
    .filter((u) => u.owner === player && !u.wounded)
    .sort((a, b) => a.id - b.id);
  const t = spell.target;
  switch (target) {
    case "hexAlly": {
      const hexes: ArenaHex[] = t.kind === "hexes" ? t.hexes : t.kind === "hex" ? [{ arena: t.arena, cell: t.cell }] : [];
      return own.filter((u) => {
        const at = unitArenaHex(config, u);
        return at !== null && hexes.some((h) => sameArenaHex(h, at));
      });
    }
    case "zoneAllies": {
      const arenas: readonly ArenaRef[] = t.kind === "zone" ? t.arenas : [];
      return own.filter((u) => u.location.zone !== "reserve" && arenas.includes(u.location.zone));
    }
    default:
      return [];
  }
}

/**
 * Gegner, deren Einheiten in einer Arena des Spielers stehen: Frontarena `right` = rechter Nachbar (dessen
 * Zone `left`), Frontarena `left` = linker Nachbar (dessen Zone `right`), Mittelarena = alle anderen aktiven
 * Spieler (R-2.3, R-3.2, R-3.4). Gibt die Zone des Gegners zurück, in der seine Einheiten dort stehen.
 */
function opponentsInArena(state: GameState, player: PlayerIndex, arena: ArenaRef): { owner: PlayerIndex; zone: ArenaRef }[] {
  if (arena === "center") {
    return Object.values(state.players)
      .filter((p) => p.index !== player && !p.eliminated)
      .map((p) => ({ owner: p.index, zone: "center" as const }));
  }
  const n = neighborsOf(state, player);
  if (!n) return [];
  return arena === "right" ? [{ owner: n.right, zone: "left" }] : [{ owner: n.left, zone: "right" }];
}

/**
 * R-8.5, R-14.2: gegnerische, nicht verwundete Einheiten auf dem gewählten Feld bzw. den gewählten Feldern
 * (`hexEnemies`), zum Zeitpunkt der Auflösung, nach ID. Felder sind aus Sicht des Zaubernden angegeben;
 * Einheiten ausgeschiedener Spieler zählen nicht.
 */
export function preCombatEnemies(state: GameState, config: ConfigData, player: PlayerIndex, spell: SetSpell, target: string): Unit[] {
  if (target !== "hexEnemies") return [];
  const t = spell.target;
  const hexes: ArenaHex[] = t.kind === "hexes" ? t.hexes : t.kind === "hex" ? [{ arena: t.arena, cell: t.cell }] : [];
  const result = new Map<number, Unit>();
  for (const hex of hexes) {
    for (const { owner, zone } of opponentsInArena(state, player, hex.arena)) {
      if (getPlayer(state, owner).eliminated) continue;
      for (const u of Object.values(state.units)) {
        if (u.owner !== owner || u.wounded || u.location.zone !== zone) continue;
        const at = unitArenaHex(config, u);
        // Dasselbe Feld der gemeinsamen Arena: gleiche Koordinaten, Arena aus Sicht des Gegners (`zone`).
        if (at !== null && at.arena === zone && at.cell.col === hex.cell.col && at.cell.row === hex.cell.row) result.set(u.id, u);
      }
    }
  }
  return [...result.values()].sort((a, b) => a.id - b.id);
}

function roundEffectsOf(unit: Unit): UnitRoundEffects {
  unit.roundEffects ??= { shield: 0, buffs: {}, keywords: [] };
  return unit.roundEffects;
}

/** R-14.3: Schild bis zum Aufräumen; mehrere Schilde addieren sich. */
export function addRoundShield(state: GameState, unit: Unit, amount: number, cardId: string): void {
  const fx = roundEffectsOf(unit);
  fx.shield += amount;
  emit(state, { type: "unit_shielded", player: unit.owner, unitId: unit.id, amount, shield: fx.shield, cardId });
}

/** Buff für die Kämpfe dieser Runde (fester Zuschlag nach dauerhaften Buffs), verfällt beim Aufräumen (R-12.4). */
export function addRoundBuff(state: GameState, unit: Unit, stat: Stat, amount: number, duration: "combat" | "round", cardId: string): void {
  const fx = roundEffectsOf(unit);
  fx.buffs[stat] = (fx.buffs[stat] ?? 0) + amount;
  emit(state, { type: "unit_buffed", player: unit.owner, unitId: unit.id, stat, amount, duration, cardId });
}

/** Schlüsselwort für die Kämpfe dieser Runde; ein schon vorhandenes wird nicht doppelt vergeben. */
export function addRoundKeyword(state: GameState, unit: Unit, keyword: Keyword, cardId: string): void {
  const fx = roundEffectsOf(unit);
  if (fx.keywords.includes(keyword)) return;
  fx.keywords.push(keyword);
  emit(state, { type: "unit_keyword_granted", player: unit.owner, unitId: unit.id, keyword, cardId });
}

/** Überträgt `unit.roundEffects` auf einen Kämpfer: Werte, Schlüsselwörter, Start-Schild. */
export function applyRoundEffects(config: ConfigData, init: FighterInit, unit: Unit): void {
  const fx = unit.roundEffects;
  if (!fx) return;
  if (Object.keys(fx.buffs).length > 0) init.stats = addStatBonuses(config, init.stats, fx.buffs);
  if (fx.keywords.length > 0) {
    const keywords = [...(init.keywords ?? [])];
    for (const k of fx.keywords) if (!keywords.includes(k)) keywords.push(k);
    init.keywords = keywords;
  }
  if (fx.shield > 0) init.shield = (init.shield ?? 0) + fx.shield;
}

/** R-12.4, R-14.3: Schilde, Kampf-Buffs und Schlüsselwörter aus Vorkampf-Zaubern verfallen beim Aufräumen. */
export function clearRoundEffects(state: GameState): void {
  for (const unit of Object.values(state.units).sort((a, b) => a.id - b.id)) {
    if (!unit.roundEffects) continue;
    delete unit.roundEffects;
    emit(state, { type: "unit_round_effects_cleared", player: unit.owner, unitId: unit.id });
  }
}
