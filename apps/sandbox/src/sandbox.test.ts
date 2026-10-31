import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { effectHooks, loadGameData, simulateCombat } from "@game/engine";
import {
  baseDamage,
  buildFighters,
  decodeSetup,
  encodeSetup,
  finishSandbox,
  isFinished,
  placeUnit,
  removeUnit,
  sandboxArenaSize,
  sandboxCatalog,
  sandboxOutcome,
  type SandboxUnit,
  sideOfCell,
  startSandbox,
  stepSandbox,
} from "./sandbox";

const data = loadGameData();

function unit(sourceId: string, col: number, row: number, stars: 1 | 2 | 3 = 1): SandboxUnit {
  const kind = data.leaders.has(sourceId) ? "leader" : data.cards.get(sourceId)?.pool === "token" ? "token" : "card";
  return { kind, sourceId, stars, pos: { col, row } };
}

function setup(...units: SandboxUnit[]): SandboxUnit[] {
  let list: SandboxUnit[] = [];
  for (const u of units) {
    const next = placeUnit(data, list, u);
    if (!next) throw new Error(`Aufstellung abgelehnt: ${u.sourceId}`);
    list = next;
  }
  return list;
}

describe("D1 Kampf-Sandbox: Katalog und Aufstellung", () => {
  it("enthält alle Einheitenkarten, Tokens und Anführer des Mini-Sets", () => {
    const catalog = sandboxCatalog(data);
    const unitCards = [...data.cards.values()].filter((c) => c.type === "unit");
    expect(catalog).toHaveLength(unitCards.length + data.leaders.size);
    expect(catalog.filter((e) => e.kind === "leader").map((e) => e.sourceId).sort()).toEqual(
      [...data.leaders.keys()].sort(),
    );
    expect(catalog.find((e) => e.sourceId === "goblin_token")?.kind).toBe("token");
    expect(catalog.find((e) => e.sourceId === "recruit")?.className).toBe("Krieger");
    expect(catalog.some((e) => e.kind === "card" && data.cards.get(e.sourceId)?.type !== "unit")).toBe(false);
  });

  it("R-3.2: Frontarena 5 × 6, Zeilen 0–2 gehören Seite A, 3–5 Seite B", () => {
    expect(sandboxArenaSize(data)).toEqual({ cols: 5, rows: 6 });
    expect(sideOfCell(data, { col: 0, row: 0 })).toBe(0);
    expect(sideOfCell(data, { col: 4, row: 2 })).toBe(0);
    expect(sideOfCell(data, { col: 0, row: 3 })).toBe(1);
    expect(sideOfCell(data, { col: 4, row: 5 })).toBe(1);
  });

  it("ersetzt eine Einheit auf demselben Feld und lehnt Felder außerhalb ab", () => {
    let list = setup(unit("recruit", 1, 1));
    list = placeUnit(data, list, unit("squire", 1, 1)) ?? [];
    expect(list.map((u) => u.sourceId)).toEqual(["squire"]);
    expect(placeUnit(data, list, unit("recruit", 5, 0))).toBeNull();
    expect(placeUnit(data, list, unit("recruit", 0, 6))).toBeNull();
    expect(placeUnit(data, list, { kind: "card", sourceId: "coin", stars: 1, pos: { col: 0, row: 0 } })).toBeNull();
    expect(removeUnit(list, { col: 1, row: 1 })).toEqual([]);
  });

  it("R-15.3: Anführer haben immer 1 Stern; höchstens ein Anführer pro Seite", () => {
    const list = setup({ kind: "leader", sourceId: "brann", stars: 3, pos: { col: 2, row: 1 } });
    expect(list[0]?.stars).toBe(1);
    expect(placeUnit(data, list, unit("vex", 0, 0))).toBeNull();
    expect(placeUnit(data, list, unit("vex", 0, 4))).not.toBeNull();
    // Den eigenen Anführer auf seinem Feld ersetzen ist erlaubt.
    expect(placeUnit(data, list, unit("ilyra", 2, 1))).not.toBeNull();
  });

  it("R-9.2, R-15.2: Kämpfer mit Sternfaktor, Team nach Seite, IDs in Aufstellungsreihenfolge", () => {
    const fighters = buildFighters(data, setup(unit("mercenary", 2, 2, 2), unit("recruit", 2, 3)));
    expect(fighters.map((f) => [f.id, f.team, f.sourceId])).toEqual([
      [1, 0, "mercenary"],
      [2, 1, "recruit"],
    ]);
    // Söldner ★2: attack 2 → 3, hp 4 → 7, breakthrough 1 → 1.
    expect(fighters[0]?.stats).toMatchObject({ attack: 3, hp: 7, breakthrough: 1 });
  });
});

describe("D1 Kampf-Sandbox: Kampf und Ergebnis", () => {
  it("R-10.5: Grundschaden 1 bis Runde 10, danach +1 je Runde", () => {
    expect(baseDamage(data.config, 1)).toBe(1);
    expect(baseDamage(data.config, 10)).toBe(1);
    expect(baseDamage(data.config, 11)).toBe(2);
    expect(baseDamage(data.config, 15)).toBe(6);
  });

  it("R-9.7, R-10.1: Sieger, Überlebende und Durchbruch-Schaden wie in der Engine", () => {
    const units = setup(
      unit("bounty_hunter", 2, 2),
      unit("ranger", 1, 0),
      unit("recruit", 2, 3),
      unit("squire", 3, 3),
    );
    const run = startSandbox(data, units);
    expect(run.kind).toBe("combat");
    finishSandbox(run);
    expect(isFinished(run)).toBe(true);
    const outcome = sandboxOutcome(data, run, 1);
    const direct = simulateCombat(data.config, sandboxArenaSize(data), buildFighters(data, units), effectHooks(data).hooks);
    expect(outcome.winner).toBe(direct.winner);
    expect(outcome.ticks).toBe(direct.ticks);
    expect(outcome.survivors).toEqual(direct.survivors);
    const survivorBreakthrough = direct.fighters
      .filter((f) => f.alive && f.team === direct.winner)
      .reduce((s, f) => s + f.breakthrough, 0);
    expect(outcome.breakthrough).toBe(survivorBreakthrough);
    expect(outcome.damage).toBe(survivorBreakthrough + 1);
  });

  it("R-9.0: Fähigkeiten wirken in der Sandbox (Kesselflicker ruft ein Token, Bannerträger stärkt)", () => {
    const units = setup(unit("tinker", 2, 2), unit("banner_bearer", 1, 0), unit("archmage", 2, 4));
    const run = startSandbox(data, units);
    finishSandbox(run);
    expect(run.sim.events.some((e) => e.type === "combat_unit_summoned")).toBe(true);
    expect(run.sim.events.some((e) => e.type === "combat_buffed")).toBe(true);
    expect(sandboxCatalog(data).find((e) => e.sourceId === "tinker")?.combatAbility).toBe(true);
    expect(sandboxCatalog(data).find((e) => e.sourceId === "fence")?.combatAbility).toBe(false);
  });

  it("schrittweise abgespielt ergibt denselben Kampf wie am Stück (Determinismus)", () => {
    const units = setup(unit("blade_dancer", 0, 2), unit("thunder_gun", 4, 0), unit("shieldwall_veteran", 2, 3), unit("vex", 1, 5));
    const a = startSandbox(data, units);
    const b = startSandbox(data, units);
    let steps = 0;
    while (stepSandbox(a)) steps += 1;
    finishSandbox(b);
    expect(steps).toBeGreaterThan(0);
    expect(a.sim.events).toEqual(b.sim.events);
    expect(sandboxOutcome(data, a, 3)).toEqual(sandboxOutcome(data, b, 3));
  });

  it("R-9.1, R-10.2: leere Front gewinnt ohne Simulation mit allen Einheiten plus Beute", () => {
    const run = startSandbox(data, setup(unit("pickpocket", 0, 4), unit("spark_rider", 1, 4, 2)));
    expect(run.kind).toBe("emptyFront");
    expect(stepSandbox(run)).toBe(false);
    const outcome = sandboxOutcome(data, run, 12);
    expect(outcome.winner).toBe(1);
    expect(outcome.ticks).toBe(0);
    expect(outcome.survivors).toEqual([1, 2]);
    // Taschendieb 2 + Funkenreiter ★2 (3 × 1,8 = 5) = 7, Grundschaden Runde 12 = 3.
    expect(outcome.breakthrough).toBe(7);
    expect(outcome.damage).toBe(10);
    expect(outcome.loot).toBe(data.config.emptyFrontLoot);
  });

  it("R-9.1: ohne Einheiten kein Kampf und kein Schaden", () => {
    const run = startSandbox(data, []);
    expect(run.kind).toBe("noFight");
    expect(sandboxOutcome(data, run, 20)).toMatchObject({ winner: null, damage: 0, loot: 0 });
  });

  it("R-9.7: Unentschieden nach dem Zeitlimit ohne Schaden", () => {
    // Zwei Ahnenpfähle (Angriff 0) können sich nicht besiegen.
    const run = startSandbox(data, setup(unit("ancestor_pole", 2, 2), unit("ancestor_pole", 2, 3)));
    finishSandbox(run);
    const outcome = sandboxOutcome(data, run, 1);
    expect(outcome.winner).toBeNull();
    expect(outcome.ticks).toBe(data.config.combat.maxTicks);
    expect(outcome.damage).toBe(0);
  });
});

describe("D1 Kampf-Sandbox: Aufstellung als Link", () => {
  it("kodiert und dekodiert eine Aufstellung verlustfrei", () => {
    const units = setup(unit("brann", 2, 1), unit("recruit", 0, 2, 3), unit("goblin_token", 4, 5), unit("vex", 3, 4));
    const text = encodeSetup(units);
    expect(decodeSetup(data, text)).toEqual(units);
  });

  it("überspringt ungültige Teile", () => {
    const decoded = decodeSetup(data, "c.recruit.1.0.0~x.foo.1.0.1~c.nope.1.1.1~c.recruit.4.2.2~c.recruit.1.9.9~c.squire.1.0.0");
    expect(decoded).toEqual([{ kind: "card", sourceId: "recruit", stars: 1, pos: { col: 0, row: 0 } }]);
  });
});

describe("D1 Kampf-Sandbox: veröffentlichte Datei", () => {
  const file = fileURLToPath(new URL("../../../docs/play/sandbox.html", import.meta.url));

  it("liegt unter docs/play/sandbox.html, eigenständig und ohne externe Skripte oder Stile", () => {
    expect(existsSync(file)).toBe(true);
    const html = readFileSync(file, "utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });
});
