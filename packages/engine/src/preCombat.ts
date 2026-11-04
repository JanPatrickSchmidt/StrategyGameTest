/**
 * Vorkampf-Zauber (R-8.3, R-8.5, E11b1): Wirkungen auf eigene Einheiten, die in alle Kämpfe der Runde
 * übernommen werden – Schild (Schutzrune), Buff `combat`/`round` (Kriegsruf), Schlüsselwort (Giftklinge) –
 * sowie Schaden an gegnerischen Einheiten (Feuerball, E11b3, R-14.2).
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
import { coordEquals, neighbors } from "./hex";
import { neighborsOf } from "./seating";
import { arenaSize, sameArenaHex, unitArenaHex } from "./targets";
import { fightsThisRound } from "./wounds";

/** Effekt-Bausteine, die Vorkampf-Zauber schon wirken lassen (E11b1–E11b3). */
export const PRE_COMBAT_OPS: ReadonlySet<Effect["op"]> = new Set(["shield", "buff", "grantKeyword", "wound", "damage"]);

/**
 * R-8.5: gültige Einheiten eines Vorkampf-Zaubers zum Zeitpunkt der Auflösung. `hexAlly` = die eigene, nicht
 * verwundete Einheit auf dem gewählten Feld; `zoneAllies` = alle eigenen, nicht verwundeten Einheiten der
 * gewählten Zone(n) (inkl. Anführer und Tokens), nach ID. Verwundete und vor dem Kampf besiegte Einheiten
 * kämpfen nicht (R-14.4, R-14.2) und sind deshalb kein gültiges Ziel.
 */
export function preCombatAllies(state: GameState, config: ConfigData, player: PlayerIndex, spell: SetSpell, target: string): Unit[] {
  const own = Object.values(state.units)
    .filter((u) => u.owner === player && fightsThisRound(u))
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
 * R-8.5, R-14.2: gegnerische Einheiten, die an den Kämpfen der Runde teilnehmen würden (nicht verwundet, nicht
 * vor dem Kampf besiegt), zum Zeitpunkt der Auflösung, nach ID. `hexEnemies` = auf dem gewählten Feld bzw. den
 * gewählten Feldern; `hexNeighborEnemies` = auf den Nachbarfeldern (innerhalb der Arena) ohne die gewählten
 * Felder selbst (Feuerball, E11b3). Felder sind aus Sicht des Zaubernden angegeben; alle Spieler einer Arena
 * nutzen dieselben Arena-Koordinaten. Einheiten ausgeschiedener Spieler zählen nicht.
 */
export function preCombatEnemies(state: GameState, config: ConfigData, player: PlayerIndex, spell: SetSpell, target: string): Unit[] {
  if (target !== "hexEnemies" && target !== "hexNeighborEnemies") return [];
  const t = spell.target;
  const chosen: ArenaHex[] = t.kind === "hexes" ? t.hexes : t.kind === "hex" ? [{ arena: t.arena, cell: t.cell }] : [];
  let hexes: ArenaHex[] = chosen;
  if (target === "hexNeighborEnemies") {
    hexes = [];
    for (const hex of chosen) {
      for (const cell of neighbors(hex.cell, arenaSize(config, hex.arena))) {
        const n: ArenaHex = { arena: hex.arena, cell };
        if (!chosen.some((c) => sameArenaHex(c, n)) && !hexes.some((h) => sameArenaHex(h, n))) hexes.push(n);
      }
    }
  }
  const result = new Map<number, Unit>();
  for (const hex of hexes) {
    for (const { owner, zone } of opponentsInArena(state, player, hex.arena)) {
      if (getPlayer(state, owner).eliminated) continue;
      for (const u of Object.values(state.units)) {
        if (u.owner !== owner || !fightsThisRound(u) || u.location.zone !== zone) continue;
        const at = unitArenaHex(config, u);
        // Dasselbe Feld der gemeinsamen Arena: gleiche Koordinaten, Arena aus Sicht des Gegners (`zone`).
        if (at !== null && at.arena === zone && coordEquals(at.cell, hex.cell)) result.set(u.id, u);
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

/**
 * R-14.2, R-9.5 (E11b3): Schaden vor dem Kampf (Feuerball). Wie Fähigkeitsschaden: zuerst wird der Schild aus
 * Vorkampf-Zaubern dieser Runde verbraucht, der Rest abzüglich Panzer (mindestens 1) geht von den Lebenspunkten
 * ab. `hp` und `armor` sind die Kampfwerte der Einheit zum Zeitpunkt der Auflösung (ohne den Schaden). Der Verlust
 * bleibt für alle Kämpfe der Runde; sinken die Lebenspunkte auf 0 oder darunter, ist die Einheit besiegt und
 * nimmt an keinem Kampf dieser Runde teil. Gibt zurück, ob sie dadurch besiegt wurde.
 */
export function dealPreCombatDamage(
  state: GameState,
  unit: Unit,
  amount: number,
  stats: { hp: number; armor: number },
  cardId: string,
): boolean {
  if (amount <= 0 || !fightsThisRound(unit)) return false;
  const fx = roundEffectsOf(unit);
  const absorbed = Math.min(fx.shield, amount);
  fx.shield -= absorbed;
  const rest = amount - absorbed;
  const hpLoss = rest > 0 ? Math.max(1, rest - stats.armor) : 0;
  fx.damage = (fx.damage ?? 0) + hpLoss;
  const hp = stats.hp - fx.damage;
  emit(state, { type: "unit_damaged", player: unit.owner, unitId: unit.id, amount, absorbed, hpLoss, hp, cardId });
  if (hp > 0) return false;
  fx.defeated = true;
  emit(state, { type: "unit_defeated", player: unit.owner, unitId: unit.id, cardId });
  return true;
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
  if ((fx.damage ?? 0) > 0) init.damageTaken = (init.damageTaken ?? 0) + (fx.damage ?? 0);
}

/** R-12.4, R-14.3: Schilde, Kampf-Buffs und Schlüsselwörter aus Vorkampf-Zaubern verfallen beim Aufräumen. */
export function clearRoundEffects(state: GameState): void {
  for (const unit of Object.values(state.units).sort((a, b) => a.id - b.id)) {
    if (!unit.roundEffects) continue;
    delete unit.roundEffects;
    emit(state, { type: "unit_round_effects_cleared", player: unit.owner, unitId: unit.id });
  }
}
