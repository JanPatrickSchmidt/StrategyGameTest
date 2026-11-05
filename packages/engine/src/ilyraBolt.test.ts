import { describe, expect, it } from "vitest";
import type { ActionTarget, ArenaHex, ArenaRef, Planning } from "./actions";
import { loadGameData } from "./data";
import { fighterForUnit } from "./fronts";
import { setLeaderAbility } from "./leader";
import { resolveLeaderAbilities } from "./leaderAbilities";
import { advance, submitPlanning } from "./round";
import { createGame, defaultLeaders } from "./setup";
import { type GameEvent, type GameState, getPlayer, PLAYER_INDICES, type PlayerIndex, type Unit, type UnitId, type UnitLocation } from "./state";
import { unitArenaHex } from "./targets";

const data = loadGameData();
const config = data.config;
const EMPTY: Planning = { play: [], buy: [], position: [] };
// Standard-Anführer: 0 Brann, 1 Ilyra, 2 Vex, 3 Morgra. Ilyras rechte Frontarena = linke Zone von Spieler 2,
// ihre linke Frontarena = rechte Zone von Spieler 0.
const ILYRA: PlayerIndex = 1;
const RIGHT_FOE: PlayerIndex = 2;

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in der Planung der ersten Runde, alle Anführer in der Reserve. */
function emptyBoard(leaders: readonly string[] = defaultLeaders(data), seed = 37): GameState {
  const state = createGame(data, leaders, seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) {
    (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  }
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId = "shieldwall_veteran", kind: "card" | "token" = "card"): UnitId {
  const id = state.nextUnitId++;
  const cardInstanceIds: number[] = [];
  if (kind === "card") {
    const instance = state.nextCardInstanceId++;
    state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
    cardInstanceIds.push(instance);
  }
  state.units[id] = { id, owner: player, kind, sourceId, cardInstanceIds, stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

function unit(state: GameState, id: UnitId): Unit {
  return state.units[id] as Unit;
}

/** Feld einer Einheit in Arena-Koordinaten, für einen Spieler, der diese Arena als `arena` sieht. */
function hexOf(state: GameState, id: UnitId, arena: ArenaRef): ArenaHex {
  const at = unitArenaHex(config, unit(state, id));
  if (!at) throw new Error("Einheit steht in der Reserve");
  return { arena, cell: at.cell };
}

const hexes = (...list: ArenaHex[]): ActionTarget => ({ kind: "hexes", hexes: list });

function eventsOf<T extends GameEvent["type"]>(state: GameState, type: T, from = 0): Extract<GameEvent, { type: T }>[] {
  return state.log.slice(from).filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function setLeader(state: GameState, player: PlayerIndex, level: 1 | 2 | 3 | 4, branchId: string | null, target: ActionTarget): void {
  const p = getPlayer(state, player);
  p.leader.level = level;
  p.leader.branchId = branchId;
  p.leaderAbility = target;
}

/** Schaden (`amount`) je getroffener Einheit nach einer Auflösung. */
function damageBy(state: GameState, from: number): [UnitId, number][] {
  return eventsOf(state, "unit_damaged", from).map((e) => [e.unitId, e.amount]);
}

/** Drei gegnerische Einheiten in Ilyras rechter Frontarena: zwei nebeneinander, eine weiter weg. */
function threeFoes(state: GameState): { a: UnitId; b: UnitId; far: UnitId } {
  return {
    a: placeUnit(state, RIGHT_FOE, front("left", 1, 1)),
    b: placeUnit(state, RIGHT_FOE, front("left", 0, 1)),
    far: placeUnit(state, RIGHT_FOE, front("left", 3, 0)),
  };
}

describe("E11c2: Ilyras Blitzschlag – Kategorie damage (R-8.2, R-14.2)", () => {
  it("R-8.2: Ilyra Stufe 1 – Blitzschlag macht 4 Schaden an der gegnerischen Einheit auf dem Feld (durch Panzer)", () => {
    const state = emptyBoard();
    const { a, b } = threeFoes(state);
    setLeader(state, ILYRA, 1, null, hexes(hexOf(state, a, "right")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_resolved", from)).toMatchObject([
      { type: "leader_ability_resolved", player: ILYRA, leaderId: "ilyra", category: "damage", level: 1, branchId: null },
    ]);
    // Schildwall-Veteran: 8 LP, Panzer 1 → 3 LP Verlust.
    expect(eventsOf(state, "unit_damaged", from)).toMatchObject([
      { type: "unit_damaged", player: RIGHT_FOE, unitId: a, amount: 4, absorbed: 0, hpLoss: 3, hp: 5, cardId: "ilyra" },
    ]);
    expect(unit(state, b).roundEffects).toBeUndefined();
  });

  it("R-14.2: Blitzschlag trifft nur gegnerische Einheiten, auch in der linken Frontarena und in der Mitte", () => {
    const state = emptyBoard();
    const own = placeUnit(state, ILYRA, front("right", 1, 2));
    const leftFoe = placeUnit(state, 0, front("right", 2, 0));
    const centerFoe = placeUnit(state, 3, { zone: "center", position: 0 });
    // Kette Stufe 2: drei Felder – eigenes Feld, linke Frontarena, Mitte.
    setLeader(state, ILYRA, 2, "chain", hexes(hexOf(state, own, "right"), hexOf(state, leftFoe, "left"), hexOf(state, centerFoe, "center")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(damageBy(state, from)).toEqual([
      [leftFoe, 4],
      [centerFoe, 4],
    ]);
    expect(unit(state, own).roundEffects).toBeUndefined();
  });

  it("R-8.2: Blitzschlag verpufft ohne gültige gegnerische Einheit (Feld leer oder nur verwundet)", () => {
    const state = emptyBoard();
    const wounded = placeUnit(state, RIGHT_FOE, front("left", 1, 1));
    unit(state, wounded).wounded = true;
    setLeader(state, ILYRA, 1, null, hexes(hexOf(state, wounded, "right")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_fizzled", from)).toMatchObject([
      { type: "leader_ability_fizzled", player: ILYRA, leaderId: "ilyra", category: "damage", reason: "noValidTarget" },
    ]);
    expect(eventsOf(state, "leader_ability_resolved", from)).toEqual([]);
    expect(eventsOf(state, "unit_damaged", from)).toEqual([]);
  });

  it("R-16.2: Ilyra „Kette“ – Stufe 2: 3 Felder je 4, Stufe 3: 3 Felder je 5, Stufe 4: 4 Felder je 6", () => {
    for (const [level, count, amount] of [
      [2, 3, 4],
      [3, 3, 5],
      [4, 4, 6],
    ] as const) {
      const state = emptyBoard();
      const foes = [0, 1, 2, 3].map((col) => placeUnit(state, RIGHT_FOE, front("left", col, 0)));
      const chosen = foes.slice(0, count);
      setLeader(state, ILYRA, level, "chain", hexes(...chosen.map((id) => hexOf(state, id, "right"))));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(damageBy(state, from)).toEqual(chosen.map((id) => [id, amount]));
    }
  });

  it("R-16.2: Ilyra „Kette“ – mehr Felder als die Stufe erlaubt werden in der Planung abgelehnt", () => {
    const state = emptyBoard();
    const foes = [0, 1, 2, 3].map((col) => placeUnit(state, RIGHT_FOE, front("left", col, 0)));
    const p = getPlayer(state, ILYRA);
    p.leader.level = 2;
    p.leader.branchId = "chain";
    expect(setLeaderAbility(state, data, ILYRA, hexes(...foes.map((id) => hexOf(state, id, "right"))))).toBe("tooManyTargets");
    expect(setLeaderAbility(state, data, ILYRA, hexes(...foes.slice(0, 3).map((id) => hexOf(state, id, "right"))))).toBeNull();
  });

  it("R-16.2: Ilyra „Sturm“ – Stufe 2/3/4: 3/4/5 Schaden auf dem Feld und den Nachbarfeldern", () => {
    for (const [level, amount] of [
      [2, 3],
      [3, 4],
      [4, 5],
    ] as const) {
      const state = emptyBoard();
      const { a, b, far } = threeFoes(state);
      setLeader(state, ILYRA, level, "storm", hexes(hexOf(state, a, "right")));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(damageBy(state, from)).toEqual([
        [a, amount],
        [b, amount],
      ]);
      expect(unit(state, far).roundEffects).toBeUndefined();
    }
  });

  it("R-16.2: Ilyra „Sturm“ wirkt auch, wenn nur ein Nachbarfeld einen Gegner hat", () => {
    const state = emptyBoard();
    const b = placeUnit(state, RIGHT_FOE, front("left", 0, 1));
    // Feld (1, 1) bestimmen und wieder leeren.
    const gone = placeUnit(state, RIGHT_FOE, front("left", 1, 1));
    const empty = hexOf(state, gone, "right");
    delete state.units[gone];
    setLeader(state, ILYRA, 2, "storm", hexes(empty));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(damageBy(state, from)).toEqual([[b, 3]]);
  });

  it("R-14.4: Ilyra „Wucht“ – Stufe 2/3/4: 8/10/14 Schaden; besiegte Einheiten sind verwundet", () => {
    for (const [level, amount] of [
      [2, 8],
      [3, 10],
      [4, 14],
    ] as const) {
      const state = emptyBoard();
      // Rekrut: 3 LP → besiegt und verwundet.
      const recruit = placeUnit(state, RIGHT_FOE, front("left", 1, 1), "recruit");
      setLeader(state, ILYRA, level, "might", hexes(hexOf(state, recruit, "right")));
      const from = state.log.length;
      resolveLeaderAbilities(state, data);
      expect(damageBy(state, from)).toEqual([[recruit, amount]]);
      expect(eventsOf(state, "unit_defeated", from).map((e) => e.unitId)).toEqual([recruit]);
      expect(eventsOf(state, "unit_wounded", from)).toMatchObject([
        { type: "unit_wounded", player: RIGHT_FOE, unitId: recruit, cardId: "ilyra", arena: null },
      ]);
      expect(unit(state, recruit).wounded).toBe(true);
    }
  });

  it("R-14.4: „Wucht“ verwundet nur besiegte Einheiten und keine Tokens", () => {
    const state = emptyBoard();
    // Schildwall-Veteran mit 3 Sternen überlebt 8 Schaden (mehr Leben), ein Token wird besiegt, aber nicht verwundet.
    const tough = placeUnit(state, RIGHT_FOE, front("left", 1, 1));
    unit(state, tough).stars = 3;
    const token = placeUnit(state, RIGHT_FOE, front("left", 3, 0), "spirit", "token");
    setLeader(state, ILYRA, 2, "might", hexes(hexOf(state, tough, "right")));
    const hp = fighterForUnit(state, data, unit(state, tough), { col: 0, row: 0 }).stats.hp;
    expect(hp).toBeGreaterThan(8);
    let from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "unit_defeated", from)).toEqual([]);
    expect(unit(state, tough).wounded).toBe(false);

    const second = emptyBoard();
    const t2 = placeUnit(second, RIGHT_FOE, front("left", 3, 0), "spirit", "token");
    setLeader(second, ILYRA, 2, "might", hexes(hexOf(second, t2, "right")));
    from = second.log.length;
    resolveLeaderAbilities(second, data);
    expect(eventsOf(second, "unit_defeated", from).map((e) => e.unitId)).toEqual([t2]);
    expect(eventsOf(second, "unit_wounded", from)).toEqual([]);
    expect(unit(state, token).wounded).toBe(false);
  });

  it("R-8.2: Schaden innerhalb der Kategorie wird erst berechnet, dann gleichzeitig angewendet", () => {
    // Zwei Ilyras (Spieler 1 und 2) zielen auf denselben Rekruten von Spieler 0 in der Mitte. Spieler 1 hat in
    // Runde 1 Vorrang und besiegt ihn mit 4 Schaden; der Wucht-Treffer von Spieler 2 trifft ihn trotzdem, und
    // weil ihn im selben Schritt ein Schaden mit `wound` traf, ist er verwundet.
    const state = emptyBoard(["brann", "ilyra", "ilyra", "morgra"]);
    const recruit = placeUnit(state, 0, { zone: "center", position: 0 }, "recruit");
    setLeader(state, 1, 1, null, hexes(hexOf(state, recruit, "center")));
    setLeader(state, 2, 2, "might", hexes(hexOf(state, recruit, "center")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_resolved", from).map((e) => e.player)).toEqual([1, 2]);
    expect(eventsOf(state, "unit_damaged", from).map((e) => [e.unitId, e.amount, e.hp])).toEqual([
      [recruit, 4, -1],
      [recruit, 8, -9],
    ]);
    expect(eventsOf(state, "unit_defeated", from)).toHaveLength(1);
    expect(unit(state, recruit).wounded).toBe(true);
  });

  it("R-8.2: Gleichzeitig – beide Ilyras finden ihr Ziel, auch wenn die erste es schon besiegt", () => {
    const state = emptyBoard(["brann", "ilyra", "ilyra", "morgra"]);
    const recruit = placeUnit(state, 0, { zone: "center", position: 0 }, "recruit");
    setLeader(state, 1, 2, "might", hexes(hexOf(state, recruit, "center")));
    setLeader(state, 2, 1, null, hexes(hexOf(state, recruit, "center")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_fizzled", from)).toEqual([]);
    expect(eventsOf(state, "unit_damaged", from).map((e) => [e.unitId, e.amount])).toEqual([
      [recruit, 8],
      [recruit, 4],
    ]);
    expect(unit(state, recruit).wounded).toBe(true);
  });

  it("R-8.2: Kategorie damage nach buff – Branns Standhaft-Leben schützt vor Ilyras Blitzschlag", () => {
    const state = emptyBoard();
    // Ilyras linke Frontarena = rechte Zone von Brann (Spieler 0). Rekrut 3 LP, +4 Leben durch Standhaft.
    const recruit = placeUnit(state, 0, front("right", 1, 1), "recruit");
    setLeader(state, 0, 2, "steadfast", { kind: "zone", arenas: ["right"] });
    setLeader(state, ILYRA, 1, null, hexes(hexOf(state, recruit, "left")));
    const from = state.log.length;
    resolveLeaderAbilities(state, data);
    expect(eventsOf(state, "leader_ability_resolved", from).map((e) => e.category)).toEqual(["buff", "damage"]);
    expect(eventsOf(state, "unit_damaged", from)).toEqual([expect.objectContaining({ unitId: recruit, amount: 4, hpLoss: 4, hp: 3 })]);
    expect(eventsOf(state, "unit_defeated", from)).toEqual([]);
  });

  it("R-8.2: Im Rundenablauf wirkt Blitzschlag nach dem Aufdecken; die besiegte Einheit kämpft nicht", () => {
    const state = emptyBoard();
    const recruit = placeUnit(state, RIGHT_FOE, front("left", 1, 1), "recruit");
    getPlayer(state, ILYRA).leaderAbility = hexes(hexOf(state, recruit, "right"));
    for (const p of PLAYER_INDICES) submitPlanning(state, p, EMPTY);
    const from = state.log.length;
    advance(state, data);
    expect(eventsOf(state, "unit_defeated", from).map((e) => [e.unitId, e.cardId])).toEqual([[recruit, "ilyra"]]);
    expect(unit(state, recruit).wounded).toBe(false);
    // Der Verlust verfällt beim Aufräumen; nächste Runde ist der Rekrut wieder bereit.
    expect(unit(state, recruit).roundEffects).toBeUndefined();
  });
});
