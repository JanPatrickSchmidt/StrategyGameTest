import { describe, expect, it } from "vitest";
import { loadGameData, type PlayerView, scaleByStars, type Unit, unitStats } from "@game/engine";
import { buildBoardLayout, frontPairsFor, type LayoutConfig } from "./boardLayout";
import { GameSession, HUMAN } from "./session";
import { seatLabelText } from "./stateText";
import { unitBadgeText, unitDisplayHp, unitFigures } from "./unitFigures";

const data = loadGameData();
const layoutConfig: LayoutConfig = {
  frontZone: data.config.arenas.frontZone,
  centerArena: data.config.arenas.centerArena,
  centerStartSlots: data.config.arenas.centerStartSlots,
  reserveSlots: data.config.reserveSlots,
  hexSize: 1,
};

function layoutFor(view: PlayerView) {
  return buildBoardLayout(layoutConfig, frontPairsFor(view.players.map((p) => p.eliminated)), view.players.length);
}

const unitCard = [...data.cards.values()].find((c) => c.type === "unit" && c.pool !== "token" && c.stats.hp >= 3)!;

function cardUnit(stars: 1 | 2 | 3, extra: Partial<Unit> = {}): Unit {
  return {
    id: 999,
    owner: 1,
    kind: "card",
    sourceId: unitCard.id,
    cardInstanceIds: [],
    stars,
    xp: 0,
    wounded: false,
    location: { zone: "reserve", slot: 0 },
    restedInReserve: false,
    ...extra,
  };
}

describe("C2c Lebens- und Sternanzeige", () => {
  const view = new GameSession(data, { seed: 1 }).view();

  it("R-15.2, C2c: Lebenspunkte einer Karten-Einheit skalieren mit den Sternen wie im Kampf", () => {
    for (const stars of [1, 2, 3] as const) {
      const unit = cardUnit(stars);
      expect(unitDisplayHp(data, view, unit)).toBe(unitStats(data, unit).hp);
      expect(unitDisplayHp(data, view, unit)).toBe(scaleByStars(data.config, unitCard.type === "unit" ? unitCard.stats.hp : 0, stars));
    }
    expect(unitDisplayHp(data, view, cardUnit(3))).toBeGreaterThan(unitDisplayHp(data, view, cardUnit(1)));
  });

  it("C2c: dauerhafte Buffs und Ersatzwerte beschworener Tokens zählen mit", () => {
    const base = unitDisplayHp(data, view, cardUnit(1));
    expect(unitDisplayHp(data, view, cardUnit(1, { permanentBuffs: { hp: 4 } }))).toBe(base + 4);
    expect(unitDisplayHp(data, view, cardUnit(1, { permanentBuffs: { hp: -100 } }))).toBe(1);
    expect(unitDisplayHp(data, view, cardUnit(1, { statOverride: { hp: 9 } }))).toBe(9);
  });

  it("R-16.3, C2c: Anführer zeigen ihre Lebenspunkte aus den Daten, ab Stufe 3 mit Zuschlag", () => {
    const leaderUnit = Object.values(view.units).find((u) => u.kind === "leader" && u.owner === HUMAN)!;
    const leader = data.leaders.get(leaderUnit.sourceId)!;
    expect(unitDisplayHp(data, view, leaderUnit)).toBe(leader.stats.hp);
    const players = view.players.map((p) =>
      p.index === HUMAN ? { ...p, leader: { ...p.leader, level: 3 as const } } : p,
    );
    const leveled: PlayerView = { ...view, players };
    const expected = leader.stats.hp + Math.floor(leader.stats.hp * data.config.leader.level3StatBonus + 1e-9);
    expect(unitDisplayHp(data, leveled, leaderUnit)).toBe(expected);
  });

  it("C2c: Anzeigetext – Sterne und Herz bei Karten-Einheiten, Stufe bei Anführern (R-15.3), Markierung bei Verwundeten", () => {
    expect(unitBadgeText({ kind: "card", stars: 2, hp: 9, wounded: false })).toBe("★★ 9♥");
    expect(unitBadgeText({ kind: "token", stars: 1, hp: 2, wounded: false })).toBe("★ 2♥");
    expect(unitBadgeText({ kind: "leader", stars: 1, hp: 12, wounded: false, leaderLevel: 3 })).toBe("St.3 12♥");
    expect(unitBadgeText({ kind: "card", stars: 3, hp: 16, wounded: true })).toBe("★★★ 16♥ verw.");
  });

  it("C2c: in echten Partien trägt jede Figur Sterne, Art und Lebenspunkte ihrer Einheit, Anführer ihre Stufe", () => {
    const session = new GameSession(data, { seed: 6 });
    let rounds = 0;
    while (session.status === "waitingForHuman" && rounds < 30) {
      const v = session.view();
      for (const f of unitFigures(data, v, layoutFor(v))) {
        const unit = v.units[f.unitId] as Unit;
        expect(f.kind).toBe(unit.kind);
        expect(f.stars).toBe(unit.stars);
        expect(f.hp).toBe(unitDisplayHp(data, v, unit));
        expect(f.hp).toBeGreaterThanOrEqual(1);
        if (unit.kind === "leader") expect(f.leaderLevel).toBe(v.players[unit.owner]!.leader.level);
        else expect(f.leaderLevel).toBeUndefined();
        const text = unitBadgeText(f);
        expect(text).toContain(`${f.hp}♥`);
        expect(text.length).toBeLessThanOrEqual(14);
      }
      session.autopilot();
      rounds++;
    }
    expect(rounds).toBeGreaterThan(3);
  });

  it("C2c: Sitz-Beschriftung zeigt Name und Lebenspunkte, Ausgeschiedene als „raus“", () => {
    expect(seatLabelText({ index: 0, life: 30, eliminated: false }, 0)).toBe("Du · 30♥");
    expect(seatLabelText({ index: 2, life: 7, eliminated: false }, 0)).toBe("Bot 3 · 7♥");
    expect(seatLabelText({ index: 1, life: -3, eliminated: true }, 0)).toBe("Bot 2 · raus");
    for (const entry of view.players) expect(seatLabelText(entry, view.viewer)).toContain(`${entry.life}♥`);
  });
});
