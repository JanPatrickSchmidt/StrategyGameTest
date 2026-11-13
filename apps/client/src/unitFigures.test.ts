import { describe, expect, it } from "vitest";
import { loadGameData, type PlayerView, type Unit } from "@game/engine";
import { buildBoardLayout, frontPairsFor, type LayoutConfig, locationPosition } from "./boardLayout";
import { GameSession } from "./session";
import { figureShape, figureSourceKey, unitFigures } from "./unitFigures";

const data = loadGameData();
const config: LayoutConfig = {
  frontZone: data.config.arenas.frontZone,
  centerArena: data.config.arenas.centerArena,
  centerStartSlots: data.config.arenas.centerStartSlots,
  reserveSlots: data.config.reserveSlots,
  hexSize: 1,
};

function layoutFor(view: PlayerView) {
  return buildBoardLayout(config, frontPairsFor(view.players.map((p) => p.eliminated)), view.players.length);
}

function key(p: { x: number; z: number }): string {
  return `${p.x.toFixed(6)},${p.z.toFixed(6)}`;
}

/** Sichten aller Runden einer Partie mit Autopilot (Mensch = GreedyBot). */
function viewsOfGame(seed: number): PlayerView[] {
  const session = new GameSession(data, { seed });
  const views = [session.view()];
  while (session.status === "waitingForHuman" && views.length < 40) {
    session.autopilot();
    views.push(session.view());
  }
  return views;
}

describe("C2b Einheiten-Figuren", () => {
  it("C2b: Form nach Einheitenart – Anführer, Token, Nahkampf (Reichweite 1), Fernkampf (Reichweite > 1)", () => {
    expect(figureShape(data, { kind: "leader", sourceId: "x" })).toBe("leader");
    let melee = 0;
    let ranged = 0;
    for (const card of data.cards.values()) {
      if (card.type !== "unit") continue;
      if (card.pool === "token") {
        expect(figureShape(data, { kind: "token", sourceId: card.id })).toBe("token");
        continue;
      }
      const shape = figureShape(data, { kind: "card", sourceId: card.id });
      expect(shape).toBe(card.stats.range > 1 ? "ranged" : "melee");
      if (shape === "melee") melee++;
      else ranged++;
    }
    // Beide Formen kommen in den Daten vor, sonst wäre die Unterscheidung wertlos.
    expect(melee).toBeGreaterThan(0);
    expect(ranged).toBeGreaterThan(0);
  });

  it("C2b: Vorlagen-Schlüssel trennen Form, Besitzer und Verwundung", () => {
    const keys = new Set<string>();
    for (const shape of ["leader", "melee", "ranged", "token"] as const)
      for (const owner of [0, 1, 2, 3] as const)
        for (const wounded of [false, true]) keys.add(figureSourceKey({ shape, owner, wounded }));
    expect(keys.size).toBe(32);
  });

  it("R-1.5, R-4.4: zu Spielbeginn steht je Spieler genau ein Anführer auf seinem Startfeld in seiner Farbe", () => {
    const view = new GameSession(data, { seed: 1 }).view();
    const layout = layoutFor(view);
    const figures = unitFigures(data, view, layout);
    const leaders = figures.filter((f) => f.shape === "leader");
    expect(leaders.map((f) => f.owner).sort()).toEqual([0, 1, 2, 3]);
    for (const f of leaders) {
      const unit = view.units[f.unitId] as Unit;
      expect(unit.kind).toBe("leader");
      expect(f.position).toEqual(locationPosition(layout, unit.owner, unit.location));
    }
  });

  it("C2b: in echten Partien steht jede sichtbare Einheit genau an ihrem Ort, keine zwei Figuren auf demselben Platz, Reserve an der Sitz-Ecke", () => {
    let reserveSeen = 0;
    let rangedSeen = 0;
    let meleeSeen = 0;
    for (const seed of [2, 5, 9]) {
      for (const view of viewsOfGame(seed)) {
        const layout = layoutFor(view);
        const figures = unitFigures(data, view, layout);
        const ids = figures.map((f) => f.unitId);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        const places = new Set(figures.map((f) => key(f.position)));
        expect(places.size).toBe(figures.length);
        if (!view.result) expect(figures.length).toBe(Object.keys(view.units).length);
        for (const f of figures) {
          const unit = view.units[f.unitId] as Unit;
          expect(f.owner).toBe(unit.owner);
          expect(f.zone).toBe(unit.location.zone);
          expect(f.stars).toBe(unit.stars);
          expect(f.wounded).toBe(unit.wounded);
          if (f.zone === "reserve") {
            reserveSeen++;
            const corner = layout.seatCorners[f.owner]!;
            expect(Math.hypot(f.position.x - corner.x, f.position.z - corner.z)).toBeLessThan(4);
          }
          if (f.shape === "ranged") rangedSeen++;
          if (f.shape === "melee") meleeSeen++;
        }
      }
    }
    expect(meleeSeen).toBeGreaterThan(0);
    expect(rangedSeen).toBeGreaterThan(0);
    expect(reserveSeen).toBeGreaterThan(0);
  });

  it("C2b: Aktualisierung nach jeder Runde – neue Einheiten erscheinen, bewegte Einheiten wechseln den Platz", () => {
    const views = viewsOfGame(3);
    expect(views.length).toBeGreaterThan(3);
    let grew = false;
    let moved = false;
    for (let i = 1; i < views.length; i++) {
      const before = new Map(unitFigures(data, views[i - 1]!, layoutFor(views[i - 1]!)).map((f) => [f.unitId, f]));
      const after = unitFigures(data, views[i]!, layoutFor(views[i]!));
      if (after.some((f) => !before.has(f.unitId))) grew = true;
      for (const f of after) {
        const old = before.get(f.unitId);
        if (old && key(old.position) !== key(f.position)) moved = true;
      }
    }
    expect(grew).toBe(true);
    expect(moved).toBe(true);
  });

  it("C2b: Tokens (R-1.4) werden als Token-Figuren an ihrem Ort gezeigt", () => {
    // Tokens leben nur innerhalb einer Runde (R-12.2) und fehlen deshalb in der Sicht zwischen den Runden;
    // die Figur muss sie trotzdem darstellen können (für die Kampfwiedergabe in C4).
    const view = new GameSession(data, { seed: 1 }).view();
    const tokenCard = [...data.cards.values()].find((c) => c.pool === "token")!;
    const id = Math.max(...Object.keys(view.units).map(Number)) + 1;
    const token: Unit = {
      id,
      owner: 3,
      kind: "token",
      sourceId: tokenCard.id,
      cardInstanceIds: [],
      stars: 1,
      xp: 0,
      wounded: false,
      location: { zone: "center", position: 0 },
      restedInReserve: false,
    };
    const withToken: PlayerView = { ...view, units: { ...view.units, [id]: token } };
    const layout = layoutFor(withToken);
    const f = unitFigures(data, withToken, layout).find((x) => x.unitId === id)!;
    expect(f.shape).toBe("token");
    expect(f.position).toEqual(locationPosition(layout, 3, token.location));
  });

  it("C2b: verwundete Einheiten behalten ihren Platz und sind als verwundet markiert", () => {
    const view = viewsOfGame(4)[3]!;
    const unit = Object.values(view.units).find((u) => u.kind === "card") ?? Object.values(view.units)[0]!;
    const wounded: PlayerView = { ...view, units: { ...view.units, [unit.id]: { ...unit, wounded: true } } };
    const layout = layoutFor(wounded);
    const f = unitFigures(data, wounded, layout).find((x) => x.unitId === unit.id)!;
    expect(f.wounded).toBe(true);
    expect(f.position).toEqual(locationPosition(layout, unit.owner, unit.location));
    expect(figureSourceKey(f)).toMatch(/-w$/);
  });
});
