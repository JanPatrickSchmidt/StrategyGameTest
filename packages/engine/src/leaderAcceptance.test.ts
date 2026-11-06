/**
 * E11d: Abnahme E11 – jeder Ast jedes Anführers auf jeder Stufe im Rundenablauf (R-16.2), dazu R-16.3 und R-16.4
 * im Rundenablauf. Die Matrix wird aus `data/leaders.json` erzeugt: Kommt ein Anführer, Ast oder Effekt-Baustein
 * hinzu, läuft er automatisch mit (unbekannte Bausteine lassen den Test scheitern).
 */
import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, ArenaRef, Planning } from "./actions";
import { loadGameData } from "./data";
import type { Amount, Effect, LeaderData } from "./dataTypes";
import { leaderAbilityParams } from "./leader";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { locationArenaHex, unitArenaHex } from "./targets";

const data = loadGameData();
const config = data.config;
const LEADERS = defaultLeaders(data);
// Standard-Anführer: 0 Brann, 1 Ilyra, 2 Vex, 3 Morgra (Reihenfolge aus `defaultLeaders`).
type Level = 1 | 2 | 3 | 4;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

function eventsOf<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Ereignisse der Phase `phase` der zuletzt gespielten Runde. */
function phaseEvents(state: GameState, phase: GameState["phase"], from: number): GameEvent[] {
  const log = state.log.slice(from);
  const start = log.findIndex((e) => e.type === "phase_started" && e.phase === phase);
  if (start < 0) throw new Error(`Phase ${phase} nicht gefunden`);
  const end = log.findIndex((e, i) => i > start && e.type === "phase_started");
  return log.slice(start + 1, end < 0 ? undefined : end);
}

function num(amount: Amount): number {
  if (typeof amount !== "number") throw new Error("Anführer-Fähigkeiten nutzen feste Zahlen");
  return amount;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "recruit"): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = { id, owner: player, kind: "card", sourceId, cardInstanceIds: [instance], stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function unit(state: GameState, id: UnitId): Unit {
  return state.units[id] as Unit;
}

/**
 * Partie mit Anführer-XP genau an der Schwelle der Stufe (R-16.1); der Aufstieg geschieht im Rundenablauf zu
 * Rundenbeginn (R-6.6). Danach stehen alle Anführer-Kampfeinheiten verwundet in der Reserve (R-16.4).
 */
function gameAtLevel(player: PlayerIndex, level: Level, seed = 61): GameState {
  const state = createGame(data, LEADERS, seed);
  getPlayer(state, player).leader.xp = level === 1 ? 0 : config.leader.levelThresholds[String(level) as "2" | "3" | "4"];
  advance(state, data);
  expect(state.phase).toBe("planning");
  expect(getPlayer(state, player).leader.level).toBe(level);
  for (const p of PLAYER_INDICES) {
    const leaderUnit = unit(state, getPlayer(state, p).leader.unitId);
    leaderUnit.location = { zone: "reserve", slot: 0 };
    leaderUnit.wounded = true;
  }
  return state;
}

/** Erwartete Wirkung einer Fähigkeit, aus den Daten abgeleitet. */
interface Scenario {
  target: ActionTarget;
  check: (events: GameEvent[], effects: Effect[]) => void;
}

/** Kategorie `buff` (Brann): je eine eigene Einheit in jeder Zone; gewählt werden so viele Zonen wie erlaubt. */
function buffScenario(state: GameState, player: PlayerIndex, zones: number): Scenario {
  const all: ArenaRef[] = ["left", "right", "center"];
  const ids: Record<ArenaRef, UnitId> = {
    // Verschiedene Karten, damit beim Aufdecken nichts verschmilzt (R-15).
    left: placeUnit(state, player, front("left", 0, 0), "recruit"),
    right: placeUnit(state, player, front("right", 0, 0), "squire"),
    center: placeUnit(state, player, { zone: "center", position: 0 }, "apprentice"),
  };
  const chosen = all.slice(0, zones);
  return {
    target: { kind: "zone", arenas: chosen },
    check: (events, effects) => {
      const expected = chosen.flatMap((zone) =>
        effects.map((e) => {
          if (e.op !== "buff") throw new Error(`Unerwarteter Baustein ${e.op} für Kategorie buff`);
          return [ids[zone], e.stat, num(e.amount), e.duration];
        }),
      );
      const actual = eventsOf(events, "unit_buffed").map((e) => [e.unitId, e.stat, e.amount, e.duration]);
      expect(sortRows(actual)).toEqual(sortRows(expected));
    },
  };
}

/** Kategorie `damage` (Ilyra): je eine Einheit mit höchstens 3 LP auf so vielen gegnerischen Feldern wie erlaubt, nicht benachbart. */
function damageScenario(state: GameState, player: PlayerIndex, hexes: number): Scenario {
  // Ilyras rechte Frontarena = linke Zone von Spieler 2, ihre linke Frontarena = rechte Zone von Spieler 0.
  expect(player).toBe(1);
  const spots: [PlayerIndex, UnitLocation, ArenaRef, string][] = [
    [2, front("left", 0, 0), "right", "recruit"],
    [2, front("left", 2, 0), "right", "pickpocket"],
    [2, front("left", 4, 0), "right", "gravedigger"],
    [0, front("right", 0, 0), "left", "recruit"],
  ];
  const foes = spots.slice(0, hexes).map(([owner, loc, arena, sourceId]) => {
    const id = placeUnit(state, owner, loc, sourceId);
    const at = unitArenaHex(config, unit(state, id)) as ArenaHex;
    return { id, hex: { arena, cell: at.cell } };
  });
  return {
    target: { kind: "hexes", hexes: foes.map((f) => f.hex) },
    check: (events, effects) => {
      const expected = foes.flatMap((f) =>
        effects.map((e) => {
          if (e.op !== "damage") throw new Error(`Unerwarteter Baustein ${e.op} für Kategorie damage`);
          return [f.id, num(e.amount)];
        }),
      );
      expect(sortRows(eventsOf(events, "unit_damaged").map((e) => [e.unitId, e.amount]))).toEqual(sortRows(expected));
      // R-14.4: Alle Ziele werden besiegt; mit `wound` („Wucht“) sind sie danach verwundet.
      const wounds = effects.some((e) => e.op === "damage" && e.wound === true);
      expect(eventsOf(events, "unit_wounded").map((e) => e.unitId).sort((a, b) => a - b)).toEqual(wounds ? foes.map((f) => f.id) : []);
    },
  };
}

/** Kategorie `move` (Vex): so viele eigene Rekruten wie erlaubt in die gegnerische Hälfte der linken Frontarena (R-16.6). */
function moveScenario(state: GameState, player: PlayerIndex, count: number): Scenario {
  expect(player).toBe(2);
  const sources = ["recruit", "squire", "apprentice"];
  const moved = [0, 2, 4].slice(0, count).map((col, i) => ({
    unitId: placeUnit(state, player, front("right", col, 0), sources[i]),
    // Linke Frontarena `front:1-2`: Ilyras Hälfte in den Zeilen 0–2.
    to: { arena: "left", cell: { col, row: 1 } } as ArenaHex,
  }));
  const ids = moved.map((m) => m.unitId);
  return {
    target: { kind: "moveUnits", moves: moved },
    check: (events, effects) => {
      const steps: UnitId[] = [];
      const buffs: unknown[][] = [];
      const keywords: unknown[][] = [];
      let armed: UnitId[] | null = null;
      for (const e of effects) {
        switch (e.op) {
          case "move":
            steps.push(...ids);
            break;
          case "buff":
            for (const id of ids) buffs.push([id, e.stat, num(e.amount), e.duration]);
            break;
          case "grantKeyword":
            for (const id of ids) keywords.push([id, e.keyword]);
            break;
          case "onFrontWinOfChosen":
            armed = ids;
            break;
          default:
            throw new Error(`Unerwarteter Baustein ${e.op} für Kategorie move`);
        }
      }
      expect(eventsOf(events, "unit_shadow_stepped").map((e) => [e.unitId, e.to])).toEqual(steps.map((id, i) => [id, moved[i]?.to]));
      expect(sortRows(eventsOf(events, "unit_buffed").map((e) => [e.unitId, e.stat, e.amount, e.duration]))).toEqual(sortRows(buffs));
      expect(sortRows(eventsOf(events, "unit_keyword_granted").map((e) => [e.unitId, e.keyword]))).toEqual(sortRows(keywords));
      expect(eventsOf(events, "leader_trigger_armed").map((e) => e.unitIds)).toEqual(armed ? [armed] : []);
    },
  };
}

/** Kategorie `summon` (Morgra): ein freies eigenes Feld mit freien Nachbarn. */
function summonScenario(state: GameState, player: PlayerIndex): Scenario {
  const hex = locationArenaHex(config, player, front("left", 2, 1)) as ArenaHex;
  return {
    target: { kind: "hexes", hexes: [hex] },
    check: (events, effects) => {
      const expected = effects.flatMap((e) => {
        if (e.op !== "summon") throw new Error(`Unerwarteter Baustein ${e.op} für Kategorie summon`);
        return Array.from({ length: e.count }, () => ({ sourceId: e.token, statOverride: e.statOverride, countsForResonance: e.countsForResonance }));
      });
      const actual = eventsOf(events, "unit_summoned").map((e) => ({ sourceId: e.sourceId, statOverride: e.statOverride, countsForResonance: e.countsForResonance }));
      expect(actual).toEqual(expected);
      expect(eventsOf(events, "unit_summoned")[0]?.location).toEqual(front("left", 2, 1));
    },
  };
}

function sortRows(rows: unknown[][]): string[] {
  return rows.map((r) => JSON.stringify(r)).sort();
}

function scenarioFor(state: GameState, player: PlayerIndex, leader: LeaderData, level: Level, branchId: string | null): Scenario {
  const { limits } = leaderAbilityParams(leader, level, branchId);
  switch (leader.active.category) {
    case "buff":
      return buffScenario(state, player, limits.zones ?? 1);
    case "damage":
      return damageScenario(state, player, limits.hexes ?? 1);
    case "move":
      return moveScenario(state, player, limits.count ?? 1);
    case "summon":
      return summonScenario(state, player);
  }
}

/** Fälle der Matrix: Stufe 1 mit der Grundfähigkeit, dann jeder Ast auf Stufe 2, 3 und 4. */
const CASES = LEADERS.flatMap((leaderId, index) => {
  const leader = data.leaders.get(leaderId) as LeaderData;
  const player = index as PlayerIndex;
  const rows: { leader: LeaderData; player: PlayerIndex; level: Level; branchId: string | null }[] = [{ leader, player, level: 1, branchId: null }];
  for (const branch of leader.active.branches) {
    for (const level of [2, 3, 4] as const) rows.push({ leader, player, level, branchId: branch.id });
  }
  return rows;
});

describe("E11d: Abnahme – jeder Ast jedes Anführers auf jeder Stufe im Rundenablauf (R-16.2, R-16.4, R-8.2)", () => {
  it("R-16.2: die Matrix deckt alle Anführer der Daten mit je allen Ästen auf den Stufen 2–4 ab", () => {
    expect(LEADERS.length).toBe(data.leaders.size);
    const expected = [...data.leaders.values()].reduce((sum, l) => sum + 1 + 3 * l.active.branches.length, 0);
    expect(CASES.length).toBe(expected);
    expect(CASES.length).toBe(4 * (1 + 3 * 3));
  });

  for (const { leader, player, level, branchId } of CASES) {
    const label = branchId === null ? "Grundfähigkeit" : `Ast „${leader.active.branches.find((b) => b.id === branchId)?.name}“`;
    it(`R-16.2: ${leader.name} Stufe ${level}, ${label} – wirkt laut Daten (Aufstieg R-6.6, Astwahl R-7.7, Kampfeinheit verwundet in der Reserve R-16.4)`, () => {
      const state = gameAtLevel(player, level);
      const scenario = scenarioFor(state, player, leader, level, branchId);
      const planning: Partial<Planning> = {
        play: branchId === null ? [] : [{ type: "chooseBranch", branchId }],
        position: [{ type: "setLeaderAbility", target: scenario.target }],
      };
      const from = state.log.length;
      expect(submitPlanning(state, player, planning)).toEqual({ ok: true });
      for (const p of PLAYER_INDICES) if (p !== player) submitPlanning(state, p, {});
      advance(state, data);
      expect(eventsOf(state.log.slice(from), "action_rejected")).toEqual([]);
      expect(getPlayer(state, player).leader.branchId).toBe(branchId);

      const events = phaseEvents(state, "leaderAbilities", from);
      expect(eventsOf(events, "leader_ability_fizzled")).toEqual([]);
      expect(eventsOf(events, "leader_ability_resolved")).toMatchObject([
        { player, leaderId: leader.id, category: leader.active.category, level, branchId },
      ]);
      scenario.check(events, leaderAbilityParams(leader, level, branchId).effects);
      // Die Kampfeinheit blieb verwundet in der Reserve.
      const leaderUnit = unit(state, getPlayer(state, player).leader.unitId);
      expect(leaderUnit.location.zone).toBe("reserve");
    });
  }
});

describe("E11d: R-16.4 im Rundenablauf", () => {
  const ILYRA: PlayerIndex = 1;

  /** Ein Rekrut von Spieler 2 in Ilyras rechter Frontarena; gibt das Zielfeld für Ilyra zurück. */
  function foeHex(state: GameState, col: number, sourceId: string): { id: UnitId; target: ActionTarget } {
    const id = placeUnit(state, 2, front("left", col, 0), sourceId);
    const at = unitArenaHex(config, unit(state, id)) as ArenaHex;
    return { id, target: { kind: "hexes", hexes: [{ arena: "right", cell: at.cell }] } };
  }

  function playRound(state: GameState, planning: Partial<Planning>): number {
    const from = state.log.length;
    submitPlanning(state, ILYRA, planning);
    for (const p of PLAYER_INDICES) if (p !== ILYRA) submitPlanning(state, p, {});
    advance(state, data);
    return from;
  }

  it("R-16.4: einmal pro Runde – eine zweite Wahl in derselben Planung wird abgelehnt, nur die erste wirkt", () => {
    const state = gameAtLevel(ILYRA, 1);
    const first = foeHex(state, 0, "recruit");
    const second = foeHex(state, 4, "pickpocket");
    const from = playRound(state, {
      position: [
        { type: "setLeaderAbility", target: first.target },
        { type: "setLeaderAbility", target: second.target },
      ],
    });
    expect(eventsOf(state.log.slice(from), "action_rejected")).toMatchObject([
      { player: ILYRA, section: "position", action: "setLeaderAbility", reason: "abilityAlreadySet" },
    ]);
    const events = phaseEvents(state, "leaderAbilities", from);
    expect(eventsOf(events, "leader_ability_resolved")).toHaveLength(1);
    expect(eventsOf(events, "unit_damaged").map((e) => e.unitId)).toEqual([first.id]);
  });

  it("R-16.4: in jeder Runde erneut – zwei Runden hintereinander je eine Auflösung, auch mit verwundeter Kampfeinheit in der Reserve", () => {
    const state = gameAtLevel(ILYRA, 1);
    const leaderUnit = unit(state, getPlayer(state, ILYRA).leader.unitId);
    for (let round = 0; round < 2; round++) {
      // Genesung in der Reserve (R-6.5) wieder aufheben: Die Fähigkeit hängt nicht vom Zustand der Kampfeinheit ab.
      leaderUnit.wounded = true;
      leaderUnit.location = { zone: "reserve", slot: 0 };
      const foe = foeHex(state, 1 + 2 * round, round === 0 ? "recruit" : "pickpocket");
      const from = playRound(state, { position: [{ type: "setLeaderAbility", target: foe.target }] });
      const events = phaseEvents(state, "leaderAbilities", from);
      expect(eventsOf(events, "leader_ability_resolved")).toMatchObject([{ player: ILYRA, leaderId: "ilyra" }]);
      expect(eventsOf(events, "unit_damaged").map((e) => e.unitId)).toEqual([foe.id]);
      expect(getPlayer(state, ILYRA).leaderAbility).toBeNull();
    }
  });

  it("R-16.4: die Kampfeinheit kann zugleich kämpfen – Fähigkeit und Kampf derselben Runde", () => {
    const state = gameAtLevel(ILYRA, 1);
    const leaderUnit = unit(state, getPlayer(state, ILYRA).leader.unitId);
    leaderUnit.wounded = false;
    leaderUnit.location = front("right", 2, 2);
    const foe = foeHex(state, 0, "recruit");
    placeUnit(state, 2, front("left", 4, 0), "squire");
    const from = playRound(state, { position: [{ type: "setLeaderAbility", target: foe.target }] });
    expect(eventsOf(phaseEvents(state, "leaderAbilities", from), "leader_ability_resolved")).toHaveLength(1);
    const started = eventsOf(phaseEvents(state, "combat", from), "combat_started");
    expect(started.some((e) => e.fighters.some((f) => f.unitId === leaderUnit.id))).toBe(true);
  });
});

describe("E11d: R-16.3 im Rundenablauf", () => {
  /**
   * Jeder Anführer kämpft in seiner linken Frontzone gegen einen Schildwall-Veteranen des linken Nachbarn
   * (dessen rechte Zone). Gemessen werden Leben (erster erlittener Treffer: `hp + hpLoss`) und Angriff
   * (Rohschaden des ersten normalen Angriffs) der Anführer-Kampfeinheit.
   */
  function leaderCombatStats(level: Level): Map<PlayerIndex, { hp: number; attack: number }> {
    const state = createGame(data, LEADERS, 71);
    for (const p of PLAYER_INDICES) getPlayer(state, p).leader.xp = level === 1 ? 0 : config.leader.levelThresholds[String(level) as "2" | "3" | "4"];
    advance(state, data);
    for (const p of PLAYER_INDICES) {
      expect(getPlayer(state, p).leader.level).toBe(level);
      // Gegner in der rechten Zone des linken Nachbarn (R-2.3: rechte Zone von p-1 gegen linke Zone von p).
      placeUnit(state, ((p + 3) % 4) as PlayerIndex, front("right", 2, 0), "shieldwall_veteran");
    }
    const from = state.log.length;
    for (const p of PLAYER_INDICES) submitPlanning(state, p, {});
    advance(state, data);
    const events = phaseEvents(state, "combat", from);
    const result = new Map<PlayerIndex, { hp: number; attack: number }>();
    for (const p of PLAYER_INDICES) {
      const id = getPlayer(state, p).leader.unitId;
      const taken = eventsOf(events, "combat_damage").find((e) => e.target === id);
      const dealt = eventsOf(events, "combat_damage").find((e) => e.source === id && e.kind === "attack");
      if (!taken || !dealt) throw new Error(`Anführer von Spieler ${p} hat nicht gekämpft`);
      result.set(p, { hp: taken.hp + taken.hpLoss, attack: dealt.amount });
    }
    return result;
  }

  it("R-16.3: ab Stufe 3 kämpfen alle Anführer mit +30 % Angriff und Leben (abgerundet), auf Stufe 4 ohne weiteren Zuschlag", () => {
    const bonus = config.leader.level3StatBonus;
    const byLevel = new Map(([1, 2, 3, 4] as const).map((l) => [l, leaderCombatStats(l)]));
    for (const [index, leaderId] of LEADERS.entries()) {
      const p = index as PlayerIndex;
      const base = (data.leaders.get(leaderId) as LeaderData).stats;
      const raised = { hp: base.hp + Math.floor(base.hp * bonus + 1e-9), attack: base.attack + Math.floor(base.attack * bonus + 1e-9) };
      expect(byLevel.get(1)?.get(p)).toEqual({ hp: base.hp, attack: base.attack });
      expect(byLevel.get(2)?.get(p)).toEqual({ hp: base.hp, attack: base.attack });
      expect(byLevel.get(3)?.get(p)).toEqual(raised);
      expect(byLevel.get(4)?.get(p)).toEqual(raised);
    }
  });
});
