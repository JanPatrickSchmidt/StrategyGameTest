import { describe, expect, it } from "vitest";
import {
  type ActionTarget,
  advance,
  type CardInstanceId,
  createGame,
  defaultLeaders,
  eventsFor,
  type GameEvent,
  type GameState,
  getPlayer,
  loadGameData,
  neighborsOf,
  playBotGame,
  type PlayerIndex,
  PLAYER_INDICES,
  RandomBot,
  resolvePostCombatSpells,
  runCombatPhase,
  type Unit,
  type UnitId,
  type UnitLocation,
} from "@game/engine";
import { buildBoardLayout, frontPairsFor, seatPillarPosition } from "./boardLayout";
import { type EffectGroup, roundReplay, roundSegments } from "./effectReplay";
import { effectGroupTitle, effectStepTexts, isSeatStep, roundFrame, SEAT_TEXT_HEIGHT, seatStepTexts } from "./roundAnimation";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);

/** Partie in der Planung von Runde 1, Phase auf die Nachkampf-Zauber gestellt (wie nach der Kampfauswertung). */
function postCombatState(seed = 31): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  state.phase = "postCombatSpells";
  return state;
}

/** Legt einen Nachkampf-Zauber direkt in den Slot (wie nach `setSpell`, ohne Planung). */
function setPost(state: GameState, player: PlayerIndex, cardId: string, target: ActionTarget): CardInstanceId {
  const id = state.nextCardInstanceId++;
  state.cards[id] = { id, cardId, owner: player };
  getPlayer(state, player).spells.post.push({ cardInstanceId: id, cardId, target });
  return id;
}

/** Rechter Nachbar (Ziel für Bürde, R-14.7). */
function neighbor(state: GameState, player: PlayerIndex): PlayerIndex {
  const n = neighborsOf(state, player);
  if (!n) throw new Error(`Spieler ${player} hat keine Nachbarn`);
  return n.right;
}

/** Ein gültiges Ziel für den Zauber nach seiner Zielart in den Daten. */
function targetFor(state: GameState, player: PlayerIndex, cardId: string): ActionTarget {
  const card = data.cards.get(cardId);
  if (!card || card.type !== "spell") throw new Error(`Kein Zauber: ${cardId}`);
  switch (card.target.kind) {
    case "none":
      return { kind: "none" };
    case "player":
      return { kind: "player", player: neighbor(state, player) };
    case "ownCards":
      return { kind: "ownCards", cardInstanceIds: getPlayer(state, player).deck.slice(0, card.target.max) };
    default:
      throw new Error(`Zielart ${card.target.kind} hat in diesem Test noch kein Ziel`);
  }
}

/** Sieg an einer leeren Front für `wonFrontThisRound` (Kriegsbeute). */
function winFront(state: GameState, winner: PlayerIndex, loser: PlayerIndex): void {
  state.frontResults.push({
    round: state.round,
    arena: `front:${winner}-${loser}`,
    first: winner,
    second: loser,
    outcome: "emptyFront",
    winner,
    ticks: 0,
    participants: [],
    survivors: [],
    winnerBreakthrough: 0,
    wounded: [],
  });
}

const postSpellIds = [...data.cards.values()].filter((c) => c.type === "spell" && c.slot === "post").map((c) => c.id);

/** Nachkampf-Gruppe des Zaubers `cardId` aus der Sicht von `viewer`. */
function postGroup(state: GameState, viewer: PlayerIndex, cardId: string): EffectGroup {
  const replay = roundReplay(data, eventsFor(state.log, viewer), state.round);
  const group = replay.postCombat.find((g) => g.source.kind === "spell" && g.source.cardId === cardId);
  if (!group) throw new Error(`Keine Gruppe für ${cardId}`);
  return group;
}

describe("P14: Nachkampf-Wirkungen in der Rundenwiedergabe", () => {
  it("die Daten haben Nachkampf-Zauber", () => {
    expect(postSpellIds.length).toBeGreaterThanOrEqual(4);
  });

  it.each(postSpellIds)("R-19.2: jeder Nachkampf-Zauber der Daten erzeugt mindestens einen sichtbaren Schritt (%s)", (cardId) => {
    const state = postCombatState();
    winFront(state, 0, 1);
    setPost(state, 0, cardId, targetFor(state, 0, cardId));
    resolvePostCombatSpells(state, data);
    for (const viewer of [0, 1, 2, 3] as PlayerIndex[]) {
      const group = postGroup(state, viewer, cardId);
      expect(group.outcome).toBe("resolved");
      expect(group.steps.length).toBeGreaterThan(0);
      expect(group.steps.some((s) => effectStepTexts(s).length > 0)).toBe(true);
      // Jeder Spieler-Schritt steigt an einer vorhandenen Säule auf.
      for (const step of group.steps.filter(isSeatStep)) {
        for (const t of seatStepTexts(step)) expect(seatPillarPosition(layout, t.seat)).not.toBeNull();
      }
    }
  });

  it("R-19.2: die Wirkungen eines Zaubers gehören zu ihm, nicht zum nächsten (Kriegsbeute, dann Bürde, dann Funkenschmiede)", () => {
    const state = postCombatState();
    winFront(state, 0, 1);
    setPost(state, 0, "war_spoils", { kind: "none" });
    const cursed = neighbor(state, 1);
    setPost(state, 1, "burden", { kind: "player", player: cursed });
    setPost(state, 2, "spark_forge", { kind: "none" });
    resolvePostCombatSpells(state, data);
    const kinds = (id: string): string[] => postGroup(state, 3, id).steps.map((s) => s.kind);
    expect(kinds("war_spoils")).toEqual(["gold"]);
    expect(kinds("burden")).toEqual(["curse"]);
    expect(kinds("spark_forge")).toEqual(["roundMark"]);
    const curse = postGroup(state, 3, "burden").steps[0];
    expect(curse).toMatchObject({ kind: "curse", player: 1, to: cursed });
  });

  it("R-18.2a: Läutern vom Deck erscheint in fremder Sicht nur als Anzahl, beim Besitzer mit Karten", () => {
    const state = postCombatState();
    const fromDeck = getPlayer(state, 0).deck.slice(0, 2);
    setPost(state, 0, "purify", { kind: "ownCards", cardInstanceIds: fromDeck });
    resolvePostCombatSpells(state, data);
    const own = postGroup(state, 0, "purify").steps[0];
    const other = postGroup(state, 2, "purify").steps[0];
    expect(own).toMatchObject({ kind: "trash", player: 0, count: 2 });
    expect(own?.kind === "trash" ? own.cards.length : -1).toBe(2);
    expect(other).toEqual({ kind: "trash", player: 0, count: 2, cards: [] });
    // Der Text nennt nur die Anzahl und ist für alle Sichten gleich.
    expect(effectStepTexts(other as NonNullable<typeof other>)).toEqual([{ text: "2 Karten entfernt", tone: "status" }]);
    expect(effectStepTexts(own as NonNullable<typeof own>)).toEqual(effectStepTexts(other as NonNullable<typeof other>));
  });

  it("R-10.3: Gold der Kampfauswertung (Beute, Serien) gehört zu keiner Gruppe", () => {
    const ev = (phase: string, payload: Record<string, unknown>): GameEvent => ({ round: 2, phase, ...payload }) as GameEvent;
    const log = [
      ev("combatResolution", { type: "breakthrough_damage", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 0, baseDamage: 1, amount: 1, life: 19 }),
      ev("combatResolution", { type: "front_loot", arena: "front:0-1", player: 0, amount: 1 }),
      ev("combatResolution", { type: "gold_gained", player: 0, amount: 1, treasury: 1 }),
      ev("postCombatSpells", { type: "gold_gained", player: 2, amount: 5, treasury: 5 }),
      ev("postCombatSpells", { type: "spell_resolved", player: 0, cardInstanceId: 40, cardId: "war_spoils", slot: "post", tempo: 1 }),
      ev("postCombatSpells", { type: "gold_gained", player: 0, amount: 3, treasury: 4 }),
      ev("postCombatSpells", { type: "spell_discarded", player: 0, cardInstanceId: 40, slot: "post" }),
      ev("postCombatSpells", { type: "gold_gained", player: 3, amount: 2, treasury: 2 }),
    ];
    const replay = roundReplay(data, log, 2);
    expect(replay.postCombat.map((g) => g.steps.map((s) => s.kind))).toEqual([["breakthrough"], ["gold"]]);
    expect(replay.postCombat[1]?.steps[0]).toEqual({ kind: "gold", player: 0, amount: 3, treasury: 4 });
  });

  it("R-19.2: Fluch steigt an der Säule des Ziels auf, mit Strahl von der Säule des Zaubernden", () => {
    const state = postCombatState();
    const target = neighbor(state, 0);
    setPost(state, 0, "burden", { kind: "player", player: target });
    resolvePostCombatSpells(state, data);
    const segments = roundSegments(roundReplay(data, eventsFor(state.log, 0), state.round));
    const index = segments.findIndex((s) => s.kind === "effects" && s.group.source.kind === "spell" && s.group.source.cardId === "burden");
    expect(index).toBeGreaterThanOrEqual(0);
    const locate = (): null => null;
    const pillar = seatPillarPosition(layout, target);
    const caster = seatPillarPosition(layout, 0);
    const early = roundFrame(layout, segments, { index, tick: 0, fraction: 0.2, clock: null }, locate);
    expect(early.effects.lines).toEqual([expect.objectContaining({ kind: "shot", from: caster, to: pillar, player: 0 })]);
    expect(early.effects.texts).toEqual([]);
    const hit = roundFrame(layout, segments, { index, tick: 0, fraction: 0.6, clock: null }, locate);
    expect(hit.effects.texts).toEqual([expect.objectContaining({ text: "+1 Fluch", tone: "damage", position: pillar, height: SEAT_TEXT_HEIGHT })]);
  });

  it("R-19.2: über 20 RandomBot-Partien hat jede Vor- und Nachkampf-Gruppe einen Schritt, außer verpufften Zaubern", () => {
    let groups = 0;
    let seatSteps = 0;
    let combatGroups = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = playBotGame(data, { seed, bots: [0, 1, 2, 3].map((i) => new RandomBot(seed * 10 + i)) });
      for (const viewer of [0, 2] as PlayerIndex[]) {
        const log = eventsFor(state.log, viewer);
        for (let round = 1; round <= state.round; round++) {
          const replay = roundReplay(data, log, round);
          for (const group of [...replay.preCombat, ...replay.postCombat]) {
            groups++;
            if (group.phase === "combat") combatGroups++;
            seatSteps += group.steps.filter(isSeatStep).length;
            if (group.outcome === "fizzled") continue;
            expect(group.steps.length, `Runde ${round}, Seed ${seed}: ${JSON.stringify(group.source)}`).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(groups).toBeGreaterThan(100);
    expect(seatSteps).toBeGreaterThan(0);
    // P14b: auch Gruppen nach den Kämpfen (Phase `combat`: Auslöser, XP) kommen vor und haben Schritte.
    expect(combatGroups).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// P14b: Wirkungen nach den Kämpfen (Phase `combat`)
// ---------------------------------------------------------------------------

const front = (zone: "left" | "right", col: number, row: number): UnitLocation => ({ zone, cell: { col, row } });

/** Partie in Runde 1, alle Anführer in der Reserve (leere Fronten), Phase auf den Kampf gestellt. */
function combatState(seed = 5): GameState {
  const state = createGame(data, defaultLeaders(data), seed);
  advance(state, data);
  for (const p of PLAYER_INDICES) (state.units[getPlayer(state, p).leader.unitId] as Unit).location = { zone: "reserve", slot: 0 };
  state.phase = "combat";
  return state;
}

function placeUnit(state: GameState, player: PlayerIndex, location: UnitLocation, sourceId: string): UnitId {
  const id = state.nextUnitId++;
  const instance = state.nextCardInstanceId++;
  state.cards[instance] = { id: instance, cardId: sourceId, owner: player };
  state.units[id] = { id, owner: player, kind: "card", sourceId, cardInstanceIds: [instance], stars: 1, xp: 0, wounded: false, restedInReserve: false, location };
  return id;
}

/** Gruppen nach den Kämpfen (Phase `combat`) aus der Sicht von `viewer`. */
function combatGroups(state: GameState, viewer: PlayerIndex): EffectGroup[] {
  return roundReplay(data, eventsFor(state.log, viewer), state.round).postCombat.filter((g) => g.phase === "combat");
}

describe("P14b: Wirkungen nach den Kämpfen in der Rundenwiedergabe", () => {
  it("R-19.2: vorgemerkter Kampf-Effekt (Goblin-Plänkler stirbt) ist eine Gruppe mit Gold an der Säule", () => {
    const state = combatState();
    const goblin = placeUnit(state, 0, front("right", 2, 2), "goblin_skirmisher");
    placeUnit(state, 1, front("left", 2, 2), "arena_champion");
    runCombatPhase(state, data);
    for (const viewer of [0, 1, 3] as PlayerIndex[]) {
      const group = combatGroups(state, viewer).find((g) => g.source.kind === "unitTrigger" && g.source.sourceId === "goblin_skirmisher");
      expect(group?.source).toMatchObject({ kind: "unitTrigger", player: 0, unit: goblin, trigger: "onDeath", deferred: true, arena: "front:0-1" });
      expect(group?.steps).toEqual([expect.objectContaining({ kind: "gold", player: 0, amount: 1 })]);
      expect(effectGroupTitle(data, group as EffectGroup, viewer)).toContain("Nach dem Kampf: „");
    }
    // Das Gold steigt an der Säule des Spielers auf.
    const segments = roundSegments(roundReplay(data, eventsFor(state.log, 0), state.round));
    const index = segments.findIndex((s) => s.kind === "effects" && s.group.source.kind === "unitTrigger" && s.group.source.sourceId === "goblin_skirmisher");
    const frame = roundFrame(layout, segments, { index, tick: 0, fraction: 0.6, clock: null }, () => null);
    expect(frame.effects.texts).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "+1 Gold", position: seatPillarPosition(layout, 0), height: SEAT_TEXT_HEIGHT })]),
    );
  });

  it("R-19.2: dauerhafter Buff aus einem vorgemerkten Effekt (Champion der Arena) erscheint an der Einheit", () => {
    const state = combatState();
    const champion = placeUnit(state, 0, front("right", 2, 2), "arena_champion");
    placeUnit(state, 1, front("left", 2, 2), "recruit");
    runCombatPhase(state, data);
    const groups = combatGroups(state, 2).filter((g) => g.source.kind === "unitTrigger" && g.source.sourceId === "arena_champion");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.steps).toEqual([expect.objectContaining({ kind: "permanentBuff", unit: champion, owner: 0, stat: "attack", amount: 1 })]);
      expect(effectStepTexts(g.steps[0] as NonNullable<(typeof g.steps)[0]>)).toEqual([{ text: "+1 Angriff dauerhaft", tone: "buff" }]);
    }
  });

  it("R-19.2: `onFrontWin` (Fluchweber an leerer Front) ist eine Gruppe mit Fluch an der Säule des Verlierers", () => {
    const state = combatState();
    const weaver = placeUnit(state, 0, front("right", 2, 2), "curse_weaver");
    runCombatPhase(state, data);
    const group = combatGroups(state, 1).find((g) => g.source.kind === "unitTrigger" && g.source.sourceId === "curse_weaver");
    expect(group?.source).toMatchObject({ kind: "unitTrigger", player: 0, unit: weaver, trigger: "onFrontWin", deferred: false });
    expect(group?.steps).toEqual([expect.objectContaining({ kind: "curse", player: 0, to: 1 })]);
    expect(effectGroupTitle(data, group as EffectGroup, 1)).toContain("Frontsieg: „");
  });

  it("R-19.2: Vex' Beute (`leader_trigger_fired`) ist eine Gruppe mit Gold für den Sieger", () => {
    const state = combatState();
    const unit = placeUnit(state, 0, front("right", 2, 2), "recruit");
    const leaderId = getPlayer(state, 0).leader.leaderId;
    getPlayer(state, 0).chosenFrontWinTrigger = { leaderId, unitIds: [unit], effects: [{ op: "gainGold", amount: 2, when: "now", to: "treasury" }] };
    runCombatPhase(state, data);
    const group = combatGroups(state, 2).find((g) => g.source.kind === "leaderTrigger");
    expect(group?.source).toEqual({ kind: "leaderTrigger", player: 0, leaderId, arena: "front:0-1", units: [unit] });
    expect(group?.steps).toEqual([expect.objectContaining({ kind: "gold", player: 0, amount: 2 })]);
    expect(effectGroupTitle(data, group as EffectGroup, 0)).toContain("Frontsieg mit gewählten Einheiten");
  });

  it("R-10.7: Einheiten-XP der Überlebenden bilden je Arena eine Gruppe mit „+1 XP“ an der Figur", () => {
    const state = combatState();
    const champion = placeUnit(state, 0, front("right", 2, 2), "arena_champion");
    placeUnit(state, 1, front("left", 2, 2), "recruit");
    runCombatPhase(state, data);
    const xpEvents = state.log.filter((e) => e.type === "unit_xp_gained");
    expect(xpEvents.length).toBeGreaterThan(0);
    const segments = roundSegments(roundReplay(data, eventsFor(state.log, 0), state.round));
    const index = segments.findIndex((s) => s.kind === "effects" && s.group.source.kind === "survivorXp");
    const segment = segments[index];
    expect(segment?.kind === "effects" ? segment.group.steps : []).toEqual([expect.objectContaining({ kind: "xp", unit: champion, owner: 0, arena: "front:0-1" })]);
    expect(segment?.kind === "effects" ? effectGroupTitle(data, segment.group, 0) : "").toMatch(/^Erfahrung nach dem Kampf/);
    const frame = roundFrame(layout, segments, { index, tick: 0, fraction: 0.6, clock: null }, () => null);
    const figure = frame.fighters.find((f) => f.unitId === champion);
    expect(figure).toBeDefined();
    expect(frame.effects.texts).toEqual([expect.objectContaining({ text: "+1 XP", position: figure?.position })]);
    // Ohne Wirker: kein Ring und kein Strahl.
    expect(frame.effects.flashes).toEqual([]);
    expect(frame.effects.lines).toEqual([]);
  });

  it("R-19.2: Gruppen nach den Kämpfen kommen vor dem Durchbruch und nehmen kein Gold der Kampfauswertung auf", () => {
    const ev = (phase: string, payload: Record<string, unknown>): GameEvent => ({ round: 2, phase, ...payload }) as GameEvent;
    const log = [
      ev("combat", { type: "deferred_effects_applied", player: 0, unitId: 7, sourceId: "goblin_skirmisher", trigger: "onDeath", arena: "front:0-1" }),
      ev("combat", { type: "gold_gained", player: 0, amount: 1, treasury: 1 }),
      // Auslöser ohne sichtbare Wirkung ergibt keine Gruppe.
      ev("combat", { type: "ability_triggered", player: 1, unitId: 8, sourceId: "master_thief", trigger: "onFrontWin", arena: "front:1-2" }),
      ev("combat", { type: "unit_wounded", player: 2, unitId: 9, arena: "front:1-2", cardId: null }),
      ev("combat", { type: "gold_gained", player: 3, amount: 4, treasury: 4 }),
      ev("combatResolution", { type: "breakthrough_damage", arena: "front:0-1", winner: 0, loser: 1, breakthrough: 0, baseDamage: 1, amount: 1, life: 19 }),
      ev("combatResolution", { type: "gold_gained", player: 0, amount: 1, treasury: 2 }),
    ];
    const replay = roundReplay(data, log, 2);
    expect(replay.postCombat.map((g) => [g.source.kind, g.steps.map((s) => s.kind)])).toEqual([
      ["unitTrigger", ["gold"]],
      ["breakthrough", ["breakthrough"]],
    ]);
  });
});
