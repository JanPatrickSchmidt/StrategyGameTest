import { describe, expect, it } from "vitest";
import type { Planning, PlanningAction } from "./actions";
import { loadGameData } from "./data";
import { advance, submitPlanning } from "./round";
import { createGame } from "./setup";
import {
  type CardInstanceId,
  cloneState,
  type GameEvent,
  type GameState,
  getPlayer,
  PLAYER_INDICES,
  type PlayerIndex,
  type UnitLocation,
} from "./state";
import { eventsFor, isEventVisibleTo, playerView } from "./view";

const data = loadGameData();

/** Ereignistypen, deren Inhalt nur der Besitzer sehen darf (R-18.2, R-19.3). */
const PRIVATE_TYPES = new Set<GameEvent["type"]>([
  "cards_drawn",
  "resources_played",
  "planning_received",
  "planning_revealed",
  "action_rejected",
  "submission_rejected",
]);

/** Alle Karteninstanzen, die irgendwo in einem Ereignis genannt werden (`cardInstanceId`, `cardInstanceIds`). */
function mentionedCards(value: unknown, out = new Set<CardInstanceId>()): Set<CardInstanceId> {
  if (Array.isArray(value)) {
    for (const v of value) mentionedCards(v, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      if (key === "cardInstanceId" && typeof v === "number") out.add(v);
      else if (key === "cardInstanceIds" && Array.isArray(v)) for (const id of v) if (typeof id === "number") out.add(id);
      else mentionedCards(v, out);
    }
  }
  return out;
}

/**
 * Einfache Planung, die möglichst viele Ereignisse mit Karteninstanzen erzeugt: erste Einheitenkarte der Hand
 * auf ein freies Feld der rechten Zone, eine zweite auf das Feld des Anführers (wird abgelehnt), ein Kauf.
 */
function simplePlanning(state: GameState, player: PlayerIndex): Partial<Planning> {
  const p = getPlayer(state, player);
  const units = p.hand.filter((id) => data.cards.get(state.cards[id]?.cardId ?? "")?.type === "unit");
  const occupied = new Set(
    Object.values(state.units)
      .filter((u) => u.owner === player && u.location.zone === "right")
      .map((u) => (u.location.zone === "right" ? `${u.location.cell.col},${u.location.cell.row}` : "")),
  );
  const play: PlanningAction[] = [];
  const free = [0, 1, 2, 3, 4].flatMap((col) => [0, 1, 2].map((row) => ({ col, row }))).find((c) => !occupied.has(`${c.col},${c.row}`));
  const first = units[0];
  if (first !== undefined && free) play.push({ type: "playUnit", cardInstanceId: first, to: { zone: "right", cell: free } });
  const second = units[1];
  const leaderCell = data.config.leaderStart as UnitLocation;
  if (second !== undefined) play.push({ type: "playUnit", cardInstanceId: second, to: leaderCell });
  const buyable = Object.keys(state.supply)
    .sort()
    .find((id) => (state.supply[id] ?? 0) > 0 && (data.cards.get(id)?.cost ?? 0) > 0 && (data.cards.get(id)?.cost ?? 99) <= 2);
  return { play, buy: buyable ? [{ type: "buy", cardId: buyable }] : [], position: [] };
}

function lastIndexOf(log: readonly GameEvent[], match: (e: GameEvent) => boolean): number {
  for (let i = log.length - 1; i >= 0; i--) if (match(log[i] as GameEvent)) return i;
  return -1;
}

function startGame(seed: number): GameState {
  const state = createGame(data, undefined, seed);
  advance(state, data);
  return state;
}

/** Spielt eine Runde mit `simplePlanning` bis zur Planung der nächsten Runde. */
function playRound(state: GameState): void {
  for (const p of PLAYER_INDICES) if (!getPlayer(state, p).eliminated) submitPlanning(state, p, simplePlanning(state, p));
  advance(state, data);
}

/** Tauscht in einer Kopie Hand und Deck von `player` (Deck zuerst, Größen bleiben) und dreht das Deck um. */
function withOtherHiddenCards(state: GameState, player: PlayerIndex): GameState {
  const copy = cloneState(state);
  const p = getPlayer(copy, player);
  const pool = [...[...p.deck].reverse(), ...p.hand];
  p.hand = pool.slice(0, p.hand.length);
  p.deck = pool.slice(p.hand.length);
  return copy;
}

describe("E13: Sicht pro Spieler (R-18)", () => {
  it("R-18.3: die Sicht hängt nicht von fremder Hand und fremder Deckreihenfolge ab", () => {
    const state = startGame(7);
    for (let round = 0; round < 4; round++) {
      for (const owner of PLAYER_INDICES) {
        const changed = withOtherHiddenCards(state, owner);
        if (getPlayer(state, owner).deck.length > 0 && getPlayer(state, owner).hand.length > 0) expect(getPlayer(changed, owner).hand).not.toEqual(getPlayer(state, owner).hand);
        for (const viewer of PLAYER_INDICES) {
          if (viewer === owner) continue;
          expect(playerView(changed, viewer)).toEqual(playerView(state, viewer));
        }
        // Gegenprobe: der Besitzer selbst sieht seine Hand.
        if (getPlayer(state, owner).deck.length > 0 && getPlayer(state, owner).hand.length > 0) expect(playerView(changed, owner)).not.toEqual(playerView(state, owner));
      }
      playRound(state);
    }
  });

  it("R-18.3: in der Sicht fehlen fremde Hand, fremdes Deck, fremde Planung, Seed und Zufallsgenerator", () => {
    const state = startGame(11);
    for (let round = 0; round < 3; round++) {
      submitPlanning(state, 2, simplePlanning(state, 2));
      for (const viewer of PLAYER_INDICES) {
        const view = playerView(state, viewer);
        const json = JSON.stringify(view);
        expect(json).not.toContain('"seed"');
        expect(json).not.toContain('"rng"');
        expect(json).not.toContain('"pendingPlanning":[');
        for (const other of PLAYER_INDICES) {
          const entry = view.players[other];
          if (other === viewer) continue;
          expect(entry?.own).toBe(false);
          for (const key of ["hand", "deck", "deckContents", "played", "roundGold", "pendingPlanning"]) expect(entry).not.toHaveProperty(key);
          const p = getPlayer(state, other);
          expect(entry?.handSize).toBe(p.hand.length);
          expect(entry?.deckSize).toBe(p.deck.length);
          // Keine fremde Hand- oder Deckkarte in der Kartenliste der Sicht.
          for (const id of [...p.hand, ...p.deck, ...p.played]) expect(view.cards[id]).toBeUndefined();
        }
      }
      for (const p of PLAYER_INDICES) if (p !== 2) submitPlanning(state, p, simplePlanning(state, p));
      advance(state, data);
    }
  });

  it("R-18.2, R-18.2a: die eigene Sicht zeigt Hand, Planung und Deckinhalt ohne Reihenfolge", () => {
    const state = startGame(3);
    const planning = simplePlanning(state, 1);
    submitPlanning(state, 1, planning);
    const view = playerView(state, 1);
    const own = view.players[1];
    if (!own?.own) throw new Error("eigene Sicht erwartet");
    const p = getPlayer(state, 1);
    expect(own.hand).toEqual(p.hand);
    expect(own.played).toEqual(p.played);
    expect(own.roundGold).toBe(p.roundGold);
    expect(own.pendingPlanning?.play).toEqual(planning.play);
    expect(own.deckContents).toEqual([...p.deck].sort((a, b) => a - b));
    for (const id of [...p.hand, ...p.deck]) expect(view.cards[id]?.owner).toBe(1);
    // R-18.2a: die eigene Deckreihenfolge ist auch für den Besitzer nicht ablesbar.
    const reordered = cloneState(state);
    getPlayer(reordered, 1).deck.reverse();
    expect(playerView(reordered, 1)).toEqual(view);
  });

  it("R-18.1: öffentliche Angaben stehen in jeder Sicht gleich", () => {
    const state = startGame(5);
    playRound(state);
    const views = PLAYER_INDICES.map((v) => playerView(state, v));
    for (const p of PLAYER_INDICES) {
      const s = getPlayer(state, p);
      for (const view of views) {
        const entry = view.players[p];
        expect(entry?.life).toBe(s.life);
        expect(entry?.power).toBe(s.power);
        expect(entry?.treasury).toBe(s.treasury);
        expect(entry?.discard).toEqual(s.discard);
        expect(entry?.classPool).toEqual(s.classPool);
        expect(entry?.leader).toEqual(s.leader);
        for (const id of s.discard) expect(view.cards[id]).toEqual(state.cards[id]);
      }
    }
    for (const view of views) {
      expect(view.units).toEqual(state.units);
      expect(view.supply).toEqual(state.supply);
    }
  });

  it("R-18.3: die Sicht ist eine Kopie – Änderungen an ihr ändern den Zustand nicht", () => {
    const state = startGame(9);
    const before = cloneState(state);
    const view = playerView(state, 0);
    const own = view.players[0];
    if (!own?.own) throw new Error("eigene Sicht erwartet");
    own.hand.length = 0;
    (view.players[1] as { life: number }).life = -99;
    view.log.length = 0;
    expect(state).toEqual(before);
  });
});

describe("E13: gefiltertes Ereignisprotokoll (R-19.3)", () => {
  it("R-19.3: kein für einen Spieler sichtbares Ereignis nennt fremde Hand- oder Deckkarten", () => {
    const state = startGame(21);
    for (let round = 0; round < 6 && state.phase === "planning"; round++) {
      for (const other of PLAYER_INDICES) {
        // Ab dem Ziehen der aktuellen Hand (davor lagen die Karten evtl. öffentlich im Ablagestapel).
        const drawnAt = lastIndexOf(state.log, (e) => e.type === "cards_drawn" && e.player === other);
        expect(drawnAt).toBeGreaterThanOrEqual(0);
        const p = getPlayer(state, other);
        for (const viewer of PLAYER_INDICES) {
          if (other === viewer) continue;
          const mentioned = mentionedCards(eventsFor(state.log.slice(drawnAt), viewer));
          for (const id of [...p.hand, ...p.deck]) expect(mentioned.has(id), `Runde ${state.round}, Karte ${id}`).toBe(false);
        }
      }
      playRound(state);
    }
  });

  it("R-19.3: private Ereignisse anderer Spieler und deren Deckreihenfolge sind nie sichtbar", () => {
    const state = startGame(33);
    for (let round = 0; round < 5 && state.phase === "planning"; round++) playRound(state);
    // Die Testplanung erzeugt öffentliche Ereignisse mit Karteninstanzen und private Ablehnungen.
    for (const type of ["unit_played", "card_bought", "hand_discarded", "action_rejected"]) expect(state.log.some((e) => e.type === type), type).toBe(true);
    for (const viewer of PLAYER_INDICES) {
      const seen = eventsFor(state.log, viewer);
      for (const e of seen) {
        expect(isEventVisibleTo(e, viewer)).toBe(true);
        if (PRIVATE_TYPES.has(e.type)) expect((e as { player: PlayerIndex }).player).toBe(viewer);
      }
      // Gezogene Karten (Deckreihenfolge) nur für den Besitzer.
      const draws = seen.filter((e) => e.type === "cards_drawn");
      expect(draws.length).toBeGreaterThan(0);
      expect(JSON.stringify(seen)).not.toContain('"seed"');
      // Jedes öffentliche Ereignis sieht jeder.
      const publicCount = state.log.filter((e) => e.visibleTo === undefined).length;
      expect(seen.filter((e) => e.visibleTo === undefined)).toHaveLength(publicCount);
    }
  });

  it("R-19.3: die gefilterte Sicht ist deterministisch und eine Kopie des Protokolls", () => {
    const a = startGame(44);
    const b = startGame(44);
    playRound(a);
    playRound(b);
    expect(eventsFor(a.log, 3)).toEqual(eventsFor(b.log, 3));
    const seen = eventsFor(a.log, 3);
    const first = seen[0] as { round: number };
    first.round = 999;
    expect(a.log[0]?.round).not.toBe(999);
    expect(playerView(a, 3).log).toEqual(eventsFor(a.log, 3));
  });

  it("R-18.3: das Protokoll enthält den Seed nicht (er würde jede Mischung verraten)", () => {
    const state = createGame(data, undefined, 123456);
    const created = state.log.find((e) => e.type === "game_created");
    expect(created).toBeDefined();
    expect(created).not.toHaveProperty("seed");
    expect(state.seed).toBe(123456);
  });
});
