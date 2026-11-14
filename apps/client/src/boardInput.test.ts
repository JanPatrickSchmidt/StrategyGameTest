import { describe, expect, it } from "vitest";
import { allLocations, loadGameData, type UnitLocation } from "@game/engine";
import { applyTarget, isRelocatable, nearestLocation, targetLocations, validSelection } from "./boardInput";
import { buildBoardLayout, frontPairsFor, locationPosition } from "./boardLayout";
import { handCards, locationKey, ownEntry, type PlanBuilder } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const layout = buildBoardLayout({ ...data.config.arenas, reserveSlots: data.config.reserveSlots, hexSize: 1 }, frontPairsFor([false, false, false, false]), 4);

function setup(): { builder: PlanBuilder; unitCard: number; leaderId: number } {
  for (let seed = 1; seed < 50; seed++) {
    const builder = new GameSession(data, { seed }).planner();
    const view = builder.preview();
    const card = handCards(data, view).find((c) => c.card.type === "unit" && c.card.cost <= ownEntry(view).roundGold);
    const leader = builder.movableUnits().find((u) => u.kind === "leader");
    if (card && leader) return { builder, unitCard: card.instanceId, leaderId: leader.id };
  }
  throw new Error("Keine passende Partie gefunden");
}

const FRONT: UnitLocation = { zone: "right", cell: { col: 1, row: 2 } };
const CENTER: UnitLocation = { zone: "center", position: 2 };
const RESERVE: UnitLocation = { zone: "reserve", slot: 1 };

describe("C3b: Platzieren und Bewegen auf dem 3D-Brett", () => {
  it("C3b: jeder eigene Ort wird an seiner Brett-Position wiedererkannt (Klick auf Feld bzw. Reserveplatz)", () => {
    for (const owner of [0, 1, 2, 3] as const) {
      for (const loc of allLocations(data.config)) {
        const pos = locationPosition(layout, owner, loc);
        expect(pos).not.toBeNull();
        if (!pos) continue;
        expect(nearestLocation(data, layout, owner, pos, 1)).toEqual(loc);
        // Leicht daneben (innerhalb des Felds) zählt noch.
        expect(nearestLocation(data, layout, owner, { x: pos.x + 0.35, z: pos.z - 0.3 }, 1)).toEqual(loc);
      }
    }
  });

  it("C3b: ein Punkt außerhalb aller eigenen Orte (Mitte des Bretts, gegnerische Zone) trifft nichts", () => {
    expect(nearestLocation(data, layout, HUMAN, { x: 0, z: 0 }, 1)).toBeNull();
    const enemy = locationPosition(layout, 1, { zone: "left", cell: { col: 0, row: 0 } });
    if (!enemy) throw new Error("Gegnerfeld fehlt");
    // Das Feld liegt in derselben Frontarena wie die rechte Zone von Sitz 0, gehört aber Sitz 1.
    const hit = nearestLocation(data, layout, HUMAN, enemy, 0.5);
    expect(hit).toBeNull();
  });

  it("C3b: ohne Auswahl wird nichts hervorgehoben; mit gewählter Einheitenkarte alle freien eigenen Orte", () => {
    const { builder, unitCard, leaderId } = setup();
    expect(targetLocations(data, builder, null)).toEqual([]);
    const targets = targetLocations(data, builder, { kind: "card", cardInstanceId: unitCard });
    const leader = builder.preview().units[leaderId];
    if (!leader) throw new Error("Anführer fehlt");
    expect(targets.length).toBe(allLocations(data.config).length - 1);
    expect(targets.map(locationKey)).not.toContain(locationKey(leader.location));
  });

  it("R-7.1: Karte wählen und freies Feld anklicken spielt die Einheit dorthin aus", () => {
    const { builder, unitCard } = setup();
    expect(applyTarget(data, builder, { kind: "card", cardInstanceId: unitCard }, FRONT)).toBeNull();
    expect(builder.planning().play).toEqual([{ type: "playUnit", cardInstanceId: unitCard, to: FRONT }]);
    // Die Karte ist nicht mehr auf der Hand, die Auswahl damit ungültig.
    expect(validSelection(data, builder, { kind: "card", cardInstanceId: unitCard })).toBeNull();
    expect(targetLocations(data, builder, { kind: "card", cardInstanceId: unitCard })).toEqual([]);
  });

  it("R-7.2: eigene Einheit auf ein freies Feld ziehen plant eine Bewegung und wechselt in den Schritt Aufstellen", () => {
    const { builder, leaderId } = setup();
    expect(builder.step).toBe("play");
    expect(isRelocatable(builder, leaderId)).toBe(true);
    expect(applyTarget(data, builder, { kind: "unit", unitId: leaderId }, CENTER)).toBeNull();
    expect(builder.step).toBe("position");
    expect(builder.planning().position).toEqual([{ type: "moveUnit", unitId: leaderId, to: CENTER }]);
    expect(builder.preview().units[leaderId]?.location).toEqual(CENTER);
  });

  it("R-7.2: eine zweite Bewegung derselben Einheit ersetzt die erste; zurück auf den Ausgangsort hebt sie auf", () => {
    const { builder, leaderId } = setup();
    const start = builder.preview().units[leaderId]?.location;
    if (!start) throw new Error("Anführer fehlt");
    builder.relocate(leaderId, CENTER);
    expect(builder.relocate(leaderId, RESERVE)).toBeNull();
    expect(builder.planning().position).toEqual([{ type: "moveUnit", unitId: leaderId, to: RESERVE }]);
    expect(builder.relocate(leaderId, start)).toBeNull();
    expect(builder.planning().position).toEqual([]);
    expect(builder.entries()).toEqual([]);
  });

  it("R-7.1: eine neu ausgespielte Einheit lässt sich auf dem Brett umstellen (ändert das Ziel ihrer Ausspiel-Aktion)", () => {
    const { builder, unitCard } = setup();
    applyTarget(data, builder, { kind: "card", cardInstanceId: unitCard }, FRONT);
    const fresh = Object.values(builder.preview().units).find((u) => u.owner === HUMAN && u.cardInstanceIds.includes(unitCard));
    if (!fresh) throw new Error("Neue Einheit fehlt");
    expect(builder.movableUnits().map((u) => u.id)).not.toContain(fresh.id);
    expect(isRelocatable(builder, fresh.id)).toBe(true);
    builder.setStep("position");
    expect(applyTarget(data, builder, { kind: "unit", unitId: fresh.id }, RESERVE)).toBeNull();
    expect(builder.step).toBe("play");
    expect(builder.planning().play).toEqual([{ type: "playUnit", cardInstanceId: unitCard, to: RESERVE }]);
    expect(builder.planning().position).toEqual([]);
  });

  it("R-7.2: eine abgelehnte Bewegung (Feld besetzt) ändert nichts und liefert den Grund", () => {
    const { builder, unitCard, leaderId } = setup();
    applyTarget(data, builder, { kind: "card", cardInstanceId: unitCard }, FRONT);
    builder.relocate(leaderId, CENTER);
    const before = JSON.stringify(builder.planning());
    expect(applyTarget(data, builder, { kind: "unit", unitId: leaderId }, FRONT)).toBe("cellOccupied");
    expect(JSON.stringify(builder.planning())).toBe(before);
    expect(builder.preview().units[leaderId]?.location).toEqual(CENTER);
  });

  it("C3b: gegnerische Einheiten sind nicht wählbar", () => {
    const { builder } = setup();
    const enemy = Object.values(builder.preview().units).find((u) => u.owner !== HUMAN);
    if (!enemy) throw new Error("Keine gegnerische Einheit");
    expect(isRelocatable(builder, enemy.id)).toBe(false);
    expect(applyTarget(data, builder, { kind: "unit", unitId: enemy.id }, CENTER)).toBe("unknownUnit");
    expect(builder.entries()).toEqual([]);
  });
});
