/**
 * Vorkampf- und Nachkampf-Wirkungen als Wiedergabe-Schritte (C4b): reine Logik ohne Babylon und ohne Spielzustand.
 *
 * R-19.2: Wie `combatReplay.ts` liest dieses Modul nur Ereignisse. Aus einer Runde entsteht eine `RoundReplay`:
 * - `preCombat`: je ausgelöster bzw. verpuffter Anführer-Fähigkeit (Phase `leaderAbilities`, R-8.2) und je
 *   Vorkampf-Zauber (Phase `preCombatSpells`, R-8.3) eine `EffectGroup` mit ihren sichtbaren Schritten
 *   (Schaden, besiegt, Schild, Buff, Schlüsselwort, verwundet, Beschwörung, Schattenschritt, gescheiterte Felder,
 *   vorgemerkte Einheiten),
 * - `combats`: die simulierten Kämpfe (`combatReplays`),
 * - `postCombat`: Wirkungen nach den Kämpfen (Phase `combat`, P14b): je vorgemerkter Auslösung im Kampf
 *   (`deferred_effects_applied`), je `onFrontWin` (`ability_triggered`), je Vex' Beute (`leader_trigger_fired`) und je
 *   Arena die Einheiten-XP der Überlebenden (`unit_xp_gained`); dann je Durchbruch-Schaden an einem Sitz (R-10.1,
 *   Phase `combatResolution`) und je Nachkampf-Zauber (Phase `postCombatSpells`) eine `EffectGroup`; Zauber und
 *   Auslöser mit ihren Wirkungen auf Spieler (P14: entfernte Karten, Gold, Fluch, Markierung „nächste Runde“,
 *   Stehlen, Anführer-XP) und dauerhaften Buffs.
 * `RoundReplayPlayer` spielt das in dieser Reihenfolge ab: Vorkampf-Gruppen, Kämpfe, Nachkampf-Gruppen.
 */
import type { GameData, GameEvent, PlayerIndex, Stat, UnitId } from "@game/engine";
import {
  BASE_TICKS_PER_SECOND,
  type CombatReplay,
  combatReplays,
  END_PAUSE_MS,
  REPLAY_SPEEDS,
  type ReplayFighter,
  type ReplaySpeed,
  replayFrameAt,
} from "./combatReplay";
import type { UnitPlacement } from "./roundPlacements";

type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;
type UnitLocation = EventOf<"unit_moved">["to"];
type ArenaHex = EventOf<"unit_shadow_stepped">["to"];
type LeaderCategory = EventOf<"leader_ability_resolved">["category"];
type SpellSlot = EventOf<"spell_resolved">["slot"];
type RoundMark = EventOf<"round_mark_set">["mark"];
type Trigger = EventOf<"ability_triggered">["trigger"];

/** Wer oder was die Wirkungen einer Gruppe auslöst. */
export type EffectSource =
  | { kind: "leader"; player: PlayerIndex; leaderId: string; category: LeaderCategory; level: 1 | 2 | 3 | 4 | null; branchId: string | null }
  | { kind: "spell"; player: PlayerIndex; cardId: string; slot: SpellSlot }
  | { kind: "breakthrough"; arena: string; winner: PlayerIndex; loser: PlayerIndex }
  /**
   * P14b: Fähigkeit einer Einheit nach den Kämpfen – vorgemerkte Kampf-Effekte (`deferred: true`, z. B. Beute des
   * Goblin-Plänklers beim Tod) oder `onFrontWin`. `unit` = `null` bei einem Kampf-Token, das es nicht mehr gibt.
   */
  | { kind: "unitTrigger"; player: PlayerIndex; unit: UnitId | null; sourceId: string; trigger: Trigger; arena: string | null; deferred: boolean }
  /** P14b: vorgemerkter Anführer-Auslöser (Vex' „Beute“) beim Frontsieg mit den gewählten Einheiten `units`. */
  | { kind: "leaderTrigger"; player: PlayerIndex; leaderId: string; arena: string; units: UnitId[] }
  /** P14b, R-10.7: Einheiten-XP der Überlebenden eines Kampfes. */
  | { kind: "survivorXp"; arena: string };

/**
 * Felder aller Schritte, die eine Einheit betreffen: `owner` = Besitzer der Einheit, `arena` = Arena, in der sie in
 * dieser Runde kämpft (aus `combat_started`; `null`, wenn sie nicht kämpft, z. B. vor dem Kampf besiegt).
 */
interface UnitRef {
  unit: UnitId;
  owner: PlayerIndex;
  arena: string | null;
}

/** Ein sichtbarer Schritt einer Vorkampf- oder Nachkampf-Wirkung. Jeder Schritt stammt aus genau einem Ereignis. */
export type EffectStep =
  /** `unit_damaged`: `amount` vor Schild, `absorbed` vom Schild, `hpLoss` an Leben, `hp` danach. */
  | (UnitRef & { kind: "damage"; amount: number; absorbed: number; hpLoss: number; hp: number })
  | (UnitRef & { kind: "defeat" })
  | (UnitRef & { kind: "shield"; amount: number; shield: number })
  | (UnitRef & { kind: "buff"; stat: Stat; amount: number; duration: "combat" | "round" })
  | (UnitRef & { kind: "keyword"; keyword: string })
  | (UnitRef & { kind: "wound" })
  | (UnitRef & { kind: "summon"; sourceId: string; location: UnitLocation })
  | (UnitRef & { kind: "shadowStep"; from: UnitLocation; to: ArenaHex })
  /** `unit_buffed_permanently`: dauerhafter Zuschlag, `total` = gesamter dauerhafter Zuschlag dieses Werts. */
  | (UnitRef & { kind: "permanentBuff"; stat: Stat; amount: number; total: number })
  /** R-10.7 (`unit_xp_gained`): XP einer überlebenden Einheit, `xp` danach. */
  | (UnitRef & { kind: "xp"; amount: number; xp: number })
  /** Feld einer Fähigkeit gescheitert: Feldkonflikt (`unit` = `null`) oder blockierte Bewegung. */
  | { kind: "blocked"; unit: UnitId | null; hex: ArenaHex; reason: "hexConflict" | "hexOccupied" | "unitUnavailable" }
  /** Vorgemerkter Auslöser (Vex' „Beute“) für diese Einheiten. */
  | { kind: "mark"; units: UnitId[] }
  /**
   * R-14.8 (`cards_trashed`): `player` entfernt `count` Karten dauerhaft. `cards` = in dieser Sicht genannte Karten;
   * Karten aus einem fremden Deck fehlen darin und zählen nur in `count` (R-18.2a).
   */
  | { kind: "trash"; player: PlayerIndex; count: number; cards: { cardId: string; from: "deck" | "discard" }[] }
  /** R-10.3 (`gold_gained`): `amount` Gold in die Schatzkammer, `treasury` danach. */
  | { kind: "gold"; player: PlayerIndex; amount: number; treasury: number }
  /** R-14.7 (`curse_given`): `player` gibt `to` einen Fluch (`cardId`) auf den Ablagestapel. */
  | { kind: "curse"; player: PlayerIndex; to: PlayerIndex; cardId: string }
  /** R-17a.2 (`round_mark_set`): Markierung „nächste Runde“ für `player`. */
  | { kind: "roundMark"; player: PlayerIndex; mark: RoundMark }
  /** `gold_stolen`: `player` nimmt `from` `amount` Gold aus der Schatzkammer (R-10.3). */
  | { kind: "steal"; player: PlayerIndex; from: PlayerIndex; amount: number; treasury: number; fromTreasury: number }
  /** `leader_xp_gained` aus einem Effekt (`gainLeaderXp`, z. B. Seelenhirte): Anführer von `player` erhält XP. */
  | { kind: "leaderXp"; player: PlayerIndex; amount: number; xp: number }
  /** R-10.1, R-10.2, R-10.5: Verlierer der Front verliert `amount` Leben, `life` danach. */
  | { kind: "breakthrough"; arena: string; winner: PlayerIndex; loser: PlayerIndex; breakthrough: number; baseDamage: number; amount: number; life: number };

export interface EffectGroup {
  round: number;
  phase: GameEvent["phase"];
  source: EffectSource;
  /** `fizzled` = verpufft (R-8.5, F42): Kosten bezahlt, keine Wirkung (höchstens gescheiterte Felder). */
  outcome: "resolved" | "fizzled";
  fizzleReason: string | null;
  steps: EffectStep[];
}

export interface RoundReplay {
  round: number;
  preCombat: EffectGroup[];
  combats: CombatReplay[];
  postCombat: EffectGroup[];
}

const PRE_PHASES: ReadonlySet<string> = new Set(["leaderAbilities", "preCombatSpells"]);
const POST_PHASES: ReadonlySet<string> = new Set(["combat", "combatResolution", "postCombatSpells"]);

/** Einheit → Arena, in der sie in dieser Runde kämpft (aus `combat_started`). */
function fightingArenas(events: readonly GameEvent[], round: number): Map<UnitId, string> {
  const arenas = new Map<UnitId, string>();
  for (const e of events) {
    if (e.round !== round || e.type !== "combat_started") continue;
    for (const f of e.fighters) arenas.set(f.unitId, e.arena);
  }
  return arenas;
}

/** Schritt zu einem Einheiten-Ereignis mit `cardId`; andere Ereignisse ergeben `null`. */
function unitStep(event: GameEvent, arenas: ReadonlyMap<UnitId, string>): { cardId: string; step: EffectStep } | null {
  const ref = (unit: UnitId, owner: PlayerIndex): UnitRef => ({ unit, owner, arena: arenas.get(unit) ?? null });
  switch (event.type) {
    case "unit_damaged":
      return {
        cardId: event.cardId,
        step: { ...ref(event.unitId, event.player), kind: "damage", amount: event.amount, absorbed: event.absorbed, hpLoss: event.hpLoss, hp: event.hp },
      };
    case "unit_defeated":
      return { cardId: event.cardId, step: { ...ref(event.unitId, event.player), kind: "defeat" } };
    case "unit_shielded":
      return { cardId: event.cardId, step: { ...ref(event.unitId, event.player), kind: "shield", amount: event.amount, shield: event.shield } };
    case "unit_buffed":
      return {
        cardId: event.cardId,
        step: { ...ref(event.unitId, event.player), kind: "buff", stat: event.stat, amount: event.amount, duration: event.duration },
      };
    case "unit_keyword_granted":
      return { cardId: event.cardId, step: { ...ref(event.unitId, event.player), kind: "keyword", keyword: event.keyword } };
    case "unit_wounded":
      // Verwundung nach dem Kampf (mit Arena, ohne Karte) gehört zum Kampf, nicht zu einer Vorkampf-Wirkung.
      return event.cardId === null ? null : { cardId: event.cardId, step: { ...ref(event.unitId, event.player), kind: "wound" } };
    case "unit_summoned":
      return {
        cardId: event.cardId,
        step: { ...ref(event.unitId, event.player), kind: "summon", sourceId: event.sourceId, location: JSON.parse(JSON.stringify(event.location)) as UnitLocation },
      };
    case "unit_shadow_stepped":
      return {
        cardId: event.cardId,
        step: {
          ...ref(event.unitId, event.player),
          kind: "shadowStep",
          from: JSON.parse(JSON.stringify(event.from)) as UnitLocation,
          to: { arena: event.to.arena, cell: { ...event.to.cell } },
        },
      };
    default:
      return null;
  }
}

/**
 * Schritt zu einem Ereignis, das auf einen Spieler statt auf eine Einheit wirkt (P14); andere Ereignisse ergeben
 * `null`. Es gehört zur Gruppe, deren Wirkung gerade abgehandelt wird (siehe `effectGroups`).
 */
function playerStep(event: GameEvent): EffectStep | null {
  switch (event.type) {
    case "cards_trashed":
      return {
        kind: "trash",
        player: event.player,
        count: event.cards.length + (event.hiddenFromDeck ?? 0),
        cards: event.cards.map((c) => ({ cardId: c.cardId, from: c.from })),
      };
    case "gold_gained":
      return { kind: "gold", player: event.player, amount: event.amount, treasury: event.treasury };
    case "curse_given":
      return { kind: "curse", player: event.player, to: event.to, cardId: event.cardId };
    case "round_mark_set":
      return { kind: "roundMark", player: event.player, mark: JSON.parse(JSON.stringify(event.mark)) as RoundMark };
    case "gold_stolen":
      return { kind: "steal", player: event.player, from: event.from, amount: event.amount, treasury: event.treasury, fromTreasury: event.fromTreasury };
    case "leader_xp_gained":
      return { kind: "leaderXp", player: event.player, amount: event.amount, xp: event.xp };
    default:
      return null;
  }
}

/** Dauerhafter Buff (P14b): gehört wie die Spieler-Wirkungen zur Gruppe, deren Wirkung gerade abgehandelt wird. */
function permanentBuffStep(event: GameEvent, arenas: ReadonlyMap<UnitId, string>): EffectStep | null {
  if (event.type !== "unit_buffed_permanently") return null;
  return { unit: event.unitId, owner: event.player, arena: arenas.get(event.unitId) ?? null, kind: "permanentBuff", stat: event.stat, amount: event.amount, total: event.total };
}

/** Auslöser nach den Kämpfen (P14b): ihre Gruppe nimmt nur die unmittelbar folgenden Wirkungen auf. */
function isTriggerSource(source: EffectSource): boolean {
  return source.kind === "unitTrigger" || source.kind === "leaderTrigger";
}

/** Kennung der Quelle, über die Einheiten-Ereignisse (`cardId`) ihrer Gruppe zugeordnet werden. */
function sourceKey(source: EffectSource): string | null {
  if (source.kind === "leader") return source.leaderId;
  if (source.kind === "spell") return source.cardId;
  return null;
}

/**
 * Vorkampf- und Nachkampf-Wirkungen einer Runde in Protokollreihenfolge. Einheiten-Ereignisse gehören zur jüngsten
 * Gruppe derselben Quelle (`cardId` = Anführer- bzw. Karten-ID) – so auch eine Verwundung, die erst nach dem
 * gleichzeitigen Schaden aller Fähigkeiten folgt. Gescheiterte Felder (`leader_ability_hex_conflict`,
 * `leader_ability_move_blocked`) stehen im Protokoll vor ihrer Fähigkeit und werden ihr nachträglich zugeordnet.
 * Spieler-Wirkungen (`playerStep`: entfernte Karten, Gold, Fluch, Markierung, Stehlen) tragen keine Quelle; sie
 * gehören zum Zauber, dessen `spell_resolved` zuletzt kam, bis er abgelegt wird (`spell_discarded`) oder eine andere
 * Gruppe beginnt (R-8.4: jeder Zauber wird vollständig aufgelöst, bevor der nächste beginnt). Gold der
 * Kampfauswertung (Beute, Serien, Mitte) folgt keinem Zauber und bleibt darum ohne Gruppe.
 * P14b: Nach den Kämpfen (Phase `combat`) eröffnen `deferred_effects_applied`, `ability_triggered` (`onFrontWin`)
 * und `leader_trigger_fired` je eine Gruppe; sie nimmt die direkt folgenden Spieler-Wirkungen und dauerhaften Buffs
 * auf und endet beim ersten anderen Ereignis. Auslöser ohne sichtbare Wirkung (z. B. Stehlen bei leerer
 * Schatzkammer) ergeben keine Gruppe. `unit_xp_gained` bildet je Arena eine Gruppe „Erfahrung“.
 */
function effectGroups(events: readonly GameEvent[], round: number, phases: ReadonlySet<string>, arenas: ReadonlyMap<UnitId, string>): EffectGroup[] {
  const groups: EffectGroup[] = [];
  /** Gescheiterte Felder je Anführer, bis seine Fähigkeit im Protokoll erscheint. */
  const pending = new Map<string, EffectStep[]>();
  /** Gruppe, deren Wirkung gerade abgehandelt wird und die Spieler-Wirkungen aufnimmt. */
  let current: EffectGroup | null = null;
  let currentPhase: string | null = null;
  const open = (event: GameEvent, source: EffectSource, outcome: EffectGroup["outcome"], fizzleReason: string | null): void => {
    const key = sourceKey(source);
    const early = key !== null && source.kind === "leader" ? (pending.get(key) ?? []) : [];
    if (key !== null) pending.delete(key);
    const group: EffectGroup = { round, phase: event.phase, source, outcome, fizzleReason, steps: [...early] };
    groups.push(group);
    current = (source.kind === "spell" || isTriggerSource(source)) && outcome === "resolved" ? group : null;
  };
  for (const event of events) {
    if (event.round !== round || !phases.has(event.phase)) continue;
    if (event.phase !== currentPhase) {
      current = null;
      currentPhase = event.phase;
    }
    switch (event.type) {
      case "leader_ability_resolved":
        open(
          event,
          { kind: "leader", player: event.player, leaderId: event.leaderId, category: event.category, level: event.level, branchId: event.branchId },
          "resolved",
          null,
        );
        continue;
      case "leader_ability_fizzled":
        open(event, { kind: "leader", player: event.player, leaderId: event.leaderId, category: event.category, level: null, branchId: null }, "fizzled", event.reason);
        continue;
      case "spell_resolved":
        open(event, { kind: "spell", player: event.player, cardId: event.cardId, slot: event.slot }, "resolved", null);
        continue;
      case "spell_fizzled":
        open(event, { kind: "spell", player: event.player, cardId: event.cardId, slot: event.slot }, "fizzled", event.reason);
        continue;
      case "spell_discarded":
        current = null;
        continue;
      case "deferred_effects_applied":
        open(
          event,
          { kind: "unitTrigger", player: event.player, unit: event.unitId, sourceId: event.sourceId, trigger: event.trigger, arena: event.arena, deferred: true },
          "resolved",
          null,
        );
        continue;
      case "ability_triggered":
        if (event.phase !== "combat") continue;
        open(
          event,
          { kind: "unitTrigger", player: event.player, unit: event.unitId, sourceId: event.sourceId, trigger: event.trigger, arena: event.arena, deferred: false },
          "resolved",
          null,
        );
        continue;
      case "leader_trigger_fired":
        open(event, { kind: "leaderTrigger", player: event.player, leaderId: event.leaderId, arena: event.arena, units: [...event.unitIds] }, "resolved", null);
        continue;
      case "unit_xp_gained": {
        current = null;
        const last = groups[groups.length - 1];
        const step: EffectStep = { unit: event.unitId, owner: event.player, arena: event.arena, kind: "xp", amount: event.amount, xp: event.xp };
        if (last && last.source.kind === "survivorXp" && last.source.arena === event.arena) last.steps.push(step);
        else groups.push({ round, phase: event.phase, source: { kind: "survivorXp", arena: event.arena }, outcome: "resolved", fizzleReason: null, steps: [step] });
        continue;
      }
      case "breakthrough_damage":
        current = null;
        groups.push({
          round,
          phase: event.phase,
          source: { kind: "breakthrough", arena: event.arena, winner: event.winner, loser: event.loser },
          outcome: "resolved",
          fizzleReason: null,
          steps: [
            {
              kind: "breakthrough",
              arena: event.arena,
              winner: event.winner,
              loser: event.loser,
              breakthrough: event.breakthrough,
              baseDamage: event.baseDamage,
              amount: event.amount,
              life: event.life,
            },
          ],
        });
        continue;
      case "leader_ability_hex_conflict":
      case "leader_ability_move_blocked": {
        const step: EffectStep =
          event.type === "leader_ability_hex_conflict"
            ? { kind: "blocked", unit: null, hex: { arena: event.hex.arena, cell: { ...event.hex.cell } }, reason: "hexConflict" }
            : { kind: "blocked", unit: event.unitId, hex: { arena: event.hex.arena, cell: { ...event.hex.cell } }, reason: event.reason };
        pending.set(event.leaderId, [...(pending.get(event.leaderId) ?? []), step]);
        continue;
      }
      case "leader_trigger_armed": {
        const group = findGroup(groups, event.leaderId);
        if (group) group.steps.push({ kind: "mark", units: [...event.unitIds] });
        continue;
      }
      default: {
        const player = playerStep(event) ?? permanentBuffStep(event, arenas);
        if (player) {
          (current as EffectGroup | null)?.steps.push(player);
          continue;
        }
        const active = current as EffectGroup | null;
        if (active && isTriggerSource(active.source)) current = null;
        const found = unitStep(event, arenas);
        if (!found) continue;
        findGroup(groups, found.cardId)?.steps.push(found.step);
      }
    }
  }
  return groups.filter((g) => !isTriggerSource(g.source) || g.steps.length > 0);
}

function findGroup(groups: readonly EffectGroup[], key: string): EffectGroup | undefined {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] as EffectGroup;
    if (sourceKey(g.source) === key) return g;
  }
  return undefined;
}

/** Alles, was die Wiedergabe einer Runde zeigt: Vorkampf-Wirkungen, Kämpfe, Nachkampf-Wirkungen (R-19.2). */
export function roundReplay(data: GameData, events: readonly GameEvent[], round: number): RoundReplay {
  const arenas = fightingArenas(events, round);
  return {
    round,
    preCombat: effectGroups(events, round, PRE_PHASES, arenas),
    combats: combatReplays(data, events, round),
    postCombat: effectGroups(events, round, POST_PHASES, arenas),
  };
}

// ---------------------------------------------------------------------------
// Abspielen einer ganzen Runde
// ---------------------------------------------------------------------------

/** Anzeigedauer einer Wirkungsgruppe bei Geschwindigkeit 1 (Millisekunden). */
export const EFFECT_GROUP_MS = 1000;

export type ReplaySegment = { kind: "effects"; when: "pre" | "post"; group: EffectGroup } | { kind: "combat"; replay: CombatReplay };

/** Abschnitte in Abspielreihenfolge: Vorkampf-Gruppen, Kämpfe, Nachkampf-Gruppen. */
export function roundSegments(replay: RoundReplay): ReplaySegment[] {
  return [
    ...replay.preCombat.map((group): ReplaySegment => ({ kind: "effects", when: "pre", group })),
    ...replay.combats.map((r): ReplaySegment => ({ kind: "combat", replay: r })),
    ...replay.postCombat.map((group): ReplaySegment => ({ kind: "effects", when: "post", group })),
  ];
}

export interface RoundReplayPosition {
  /** Index des laufenden Abschnitts; `null` = alles vorbei. */
  index: number | null;
  /** Nur bei Kämpfen: ganzzahliger Tick (−1 = Startaufstellung), sonst 0. */
  tick: number;
  /** Bei Kämpfen Bruchteil zum nächsten Tick, bei Wirkungsgruppen Fortschritt der Anzeige (0 bis 1). */
  fraction: number;
}

const MS_PER_TICK = 1000 / BASE_TICKS_PER_SECOND;

/**
 * Spielt eine ganze Runde ab (rein, die Zeit kommt von außen). Ein Kampf läuft wie bei `ReplayPlayer` von Tick −1
 * bis `endTick` und hält dann `END_PAUSE_MS`; eine Wirkungsgruppe steht `EFFECT_GROUP_MS`. Die Geschwindigkeit gilt
 * für beides.
 */
export class RoundReplayPlayer {
  readonly segments: readonly ReplaySegment[];
  private current = 0;
  /** Vergangene Zeit im laufenden Abschnitt in Millisekunden bei Geschwindigkeit 1. */
  private elapsedMs = 0;
  private speedValue: ReplaySpeed = 1;

  /** P16: in dieser Runde neue Einheiten mit ihrem Ort aus den Ereignissen (`roundPlacements`). */
  readonly placements: ReadonlyMap<UnitId, UnitPlacement>;

  constructor(replay: RoundReplay, placements: ReadonlyMap<UnitId, UnitPlacement> = new Map()) {
    this.segments = roundSegments(replay);
    this.placements = placements;
  }

  get speed(): ReplaySpeed {
    return this.speedValue;
  }

  setSpeed(speed: ReplaySpeed): void {
    if (!REPLAY_SPEEDS.includes(speed)) throw new RangeError(`Unbekannte Geschwindigkeit ${speed}`);
    this.speedValue = speed;
  }

  get finished(): boolean {
    return this.current >= this.segments.length;
  }

  get segment(): ReplaySegment | null {
    return this.segments[this.current] ?? null;
  }

  /** Dauer eines Abschnitts in Millisekunden bei Geschwindigkeit 1 (inklusive Pause nach einem Kampf). */
  private duration(segment: ReplaySegment): number {
    return segment.kind === "effects" ? EFFECT_GROUP_MS : (segment.replay.endTick + 1) * MS_PER_TICK + END_PAUSE_MS;
  }

  /** Ende der sichtbaren Ticks eines Kampfs (ohne Pause) in Millisekunden. */
  private static combatEndMs(replay: CombatReplay): number {
    return (replay.endTick + 1) * MS_PER_TICK;
  }

  position(): RoundReplayPosition {
    const segment = this.segment;
    if (!segment) return { index: null, tick: 0, fraction: 0 };
    if (segment.kind === "effects") return { index: this.current, tick: 0, fraction: Math.min(1, this.elapsedMs / EFFECT_GROUP_MS) };
    const ticks = Math.min(this.elapsedMs / MS_PER_TICK - 1, segment.replay.endTick);
    const tick = Math.floor(ticks);
    return { index: this.current, tick, fraction: ticks >= segment.replay.endTick ? 0 : ticks - tick };
  }

  /**
   * Uhr des laufenden Kampfs in Ticks (ab −1), wie `ReplayPlayer.clock()` auch in der Pause nach `endTick`
   * weiterlaufend; bei Wirkungsgruppen und am Ende `null` (C4c2b).
   */
  clock(): number | null {
    const segment = this.segment;
    return segment && segment.kind === "combat" ? this.elapsedMs / MS_PER_TICK - 1 : null;
  }

  /** Schreitet um `ms` Echtzeit fort; liefert die dabei neu erreichten Kampf-Ticks (Index = Abschnitt). */
  advance(ms: number): { index: number; tick: number }[] {
    if (ms < 0) throw new RangeError("Zeit läuft nicht rückwärts");
    const reached: { index: number; tick: number }[] = [];
    let budget = ms * this.speedValue;
    while (budget > 0 && !this.finished) {
      const segment = this.segment as ReplaySegment;
      const limit = this.duration(segment);
      const before = this.elapsedMs;
      const after = Math.min(limit, before + budget);
      // Restzeit unterhalb der Rechengenauigkeit: nicht endlos weiterschleifen (Befund C4c1).
      if (after === before && after < limit) break;
      budget -= after - before;
      if (segment.kind === "combat") {
        const lastTick = segment.replay.endTick;
        const from = Math.floor(before / MS_PER_TICK - 1) + 1;
        const to = Math.min(Math.floor(after / MS_PER_TICK - 1), lastTick);
        for (let t = from; t <= to; t++) reached.push({ index: this.current, tick: t });
      }
      this.elapsedMs = after;
      if (after >= limit) this.next();
    }
    return reached;
  }

  /** Kampf: ans Endbild springen, beim zweiten Mal weiter; Wirkungsgruppe: sofort weiter. */
  skipCurrent(): void {
    const segment = this.segment;
    if (!segment) return;
    if (segment.kind === "effects") {
      this.next();
      return;
    }
    const end = RoundReplayPlayer.combatEndMs(segment.replay);
    if (this.elapsedMs >= end) this.next();
    else this.elapsedMs = end;
  }

  skipAll(): void {
    this.current = this.segments.length;
    this.elapsedMs = 0;
  }

  /** Bild des laufenden Kampfs; bei Wirkungsgruppen und am Ende leer. */
  frame(): ReplayFighter[] {
    const segment = this.segment;
    return segment && segment.kind === "combat" ? replayFrameAt(segment.replay, this.position().tick) : [];
  }

  private next(): void {
    this.current += 1;
    this.elapsedMs = 0;
  }
}
