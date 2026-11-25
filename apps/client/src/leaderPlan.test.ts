import { describe, expect, it } from "vitest";
import { type ActionTarget, branchChoiceOpen, chooseBranch, getPlayer, type LeaderState, loadGameData, type UnitId } from "@game/engine";
import { arenaHexToViewer } from "./fieldNames";
import { abilityState, addAbility, branchChoice, combinePicks, movesTarget, setBranch } from "./leaderPlan";
import { describeAction, PlanBuilder } from "./planner";
import { GameSession, HUMAN } from "./session";

const data = loadGameData();
const OTHERS = ["brann", "ilyra", "vex", "morgra"];

/** Planung des Menschen in Runde 1 mit dem Anführer `leaderId` und angepasstem Anführer-Zustand. */
function setup(leaderId: string, leader: Partial<LeaderState> = {}): PlanBuilder {
  const leaders = [leaderId, ...OTHERS.filter((l) => l !== leaderId)];
  const session = new GameSession(data, { seed: 3, leaders });
  const state = structuredClone(session.state);
  Object.assign(getPlayer(state, HUMAN).leader, leader);
  return new PlanBuilder(state, data, HUMAN);
}

function leaderUnitId(builder: PlanBuilder): UnitId {
  const unit = builder.movableUnits().find((u) => u.kind === "leader");
  if (!unit) throw new Error("kein Anführer");
  return unit.id;
}

function pickOptions(builder: PlanBuilder): ActionTarget[] {
  const choice = abilityState(data, builder).choice;
  if (choice.kind !== "pick") throw new Error(`erwartet pick, nicht ${choice.kind}`);
  return choice.options.map((o) => o.target);
}

describe("C3d1: Anführer-Fähigkeit und Astwahl in der Planung", () => {
  it("R-7.4: Fähigkeit mit Ziel wählen (Brann, Stufe 1: eine Zone), höchstens einmal, im Schritt Aufstellen", () => {
    const builder = setup("brann");
    const before = builder.preview();
    const state = abilityState(data, builder);
    expect(state).toMatchObject({ name: "Sammelruf", levelText: "Stufe 1", unavailable: false, planned: false });
    expect(state.choice).toMatchObject({ kind: "pick", max: 1 });
    expect(state.choice.kind === "pick" ? state.choice.options.map((o) => o.label) : []).toEqual(["Linke Front", "Rechte Front", "Mitte"]);
    expect(builder.step).toBe("play");
    expect(addAbility(builder, { kind: "zone", arenas: ["left"] })).toBeNull();
    expect(builder.step).toBe("position");
    expect(abilityState(data, builder).planned).toBe(true);
    expect(builder.planning().position).toEqual([{ type: "setLeaderAbility", target: { kind: "zone", arenas: ["left"] } }]);
    expect(describeAction(data, before, builder.entries()[0]?.action ?? { type: "withdraw", amount: 0 })).toBe("Anführer-Fähigkeit Sammelruf → Linke Front");
    expect(addAbility(builder, { kind: "zone", arenas: ["right"] })).toBe("abilityAlreadySet");
    expect(builder.entries()).toHaveLength(1);
  });

  it("R-7.4: bewusst keine Fähigkeit ist eine gültige Wahl", () => {
    const builder = setup("ilyra");
    const before = builder.preview();
    expect(addAbility(builder, { kind: "none" })).toBeNull();
    expect(abilityState(data, builder).planned).toBe(true);
    expect(describeAction(data, before, builder.entries()[0]?.action ?? { type: "withdraw", amount: 0 })).toBe("Anführer-Fähigkeit: keine (Blitzschlag verzichtet)");
  });

  it("R-7.7: ab Stufe 2 ohne Ast werden die Äste angeboten; ohne Wahl gilt der erste (Brann „Weite“: 2 Zonen)", () => {
    expect(branchChoice(setup("brann"))).toBeNull();
    expect(branchChoice(setup("brann", { level: 2, xp: 4, branchId: "might" }))).toBeNull();
    const builder = setup("brann", { level: 2, xp: 4 });
    expect(branchChoice(builder)).toEqual({
      options: [
        { id: "reach", name: "Weite" },
        { id: "might", name: "Wucht" },
        { id: "steadfast", name: "Standhaft" },
      ],
      chosen: null,
    });
    const state = abilityState(data, builder);
    expect(state.levelText).toBe("Stufe 2, Ast Weite");
    expect(state.choice).toMatchObject({ kind: "pick", max: 2 });
    const picked = combinePicks([
      { kind: "zone", arenas: ["left"] },
      { kind: "zone", arenas: ["center"] },
    ]);
    expect(picked).toEqual({ kind: "zone", arenas: ["left", "center"] });
    expect(addAbility(builder, picked ?? { kind: "none" })).toBeNull();
  });

  it("R-7.7, R-16.2: gewählter Ast gilt schon für die Fähigkeit dieser Planung; erneute Wahl ersetzt die alte", () => {
    const builder = setup("brann", { level: 2, xp: 4 });
    const before = builder.preview();
    expect(setBranch(builder, "might")).toBeNull();
    expect(builder.step).toBe("play");
    expect(branchChoice(builder)?.chosen).toBe("might");
    expect(abilityState(data, builder)).toMatchObject({ levelText: "Stufe 2, Ast Wucht", choice: { kind: "pick", max: 1 } });
    expect(addAbility(builder, { kind: "zone", arenas: ["left", "right"] })).toBe("tooManyTargets");
    builder.setStep("position");
    expect(setBranch(builder, "steadfast")).toBeNull();
    expect(builder.entries().filter((e) => e.action.type === "chooseBranch")).toHaveLength(1);
    expect(branchChoice(builder)?.chosen).toBe("steadfast");
    expect(describeAction(data, before, builder.entries()[0]?.action ?? { type: "withdraw", amount: 0 })).toBe("Ast wählen: Standhaft");
    expect(setBranch(builder, "nonsense")).toBe("unknownBranch");
    expect(branchChoice(builder)?.chosen).toBe("steadfast");
  });

  it("R-7.7: lehnt die Engine eine neue Astwahl ab, bleibt die alte Wahl bestehen", () => {
    const builder = setup("brann", { level: 2, xp: 4 });
    expect(setBranch(builder, "might")).toBeNull();
    // Wucht: eine Zone; die Fähigkeit dieser Planung baut auf dem gewählten Ast auf.
    expect(addAbility(builder, { kind: "zone", arenas: ["center"] })).toBeNull();
    const before = JSON.stringify(builder.planning());
    builder.setStep("buy");
    expect(setBranch(builder, "nonsense")).toBe("unknownBranch");
    expect(setBranch(builder, 42 as unknown as string)).toBe("malformed");
    // Alte Wahl samt abhängiger Fähigkeit unverändert, nichts wurde abgelehnt oder verdoppelt.
    expect(branchChoice(builder)?.chosen).toBe("might");
    expect(builder.draftBranch()).toBe("might");
    expect(builder.entries().filter((e) => e.action.type === "chooseBranch")).toEqual([
      expect.objectContaining({ action: { type: "chooseBranch", branchId: "might" }, rejection: null }),
    ]);
    expect(builder.entries().every((e) => e.rejection === null)).toBe(true);
    expect(JSON.stringify(builder.planning())).toBe(before);
    expect(abilityState(data, builder)).toMatchObject({ levelText: "Stufe 2, Ast Wucht", choice: { kind: "pick", max: 1 } });
    expect(builder.plannedAbility()).toEqual({ kind: "zone", arenas: ["center"] });
  });

  it("R-16.2, R-14.2: Ilyra „Kette“ wählt bis zu 3 Felder an teilnehmenden Arenen, mehr lehnt die Engine ab", () => {
    const builder = setup("ilyra", { level: 2, xp: 4, branchId: "chain" });
    const choice = abilityState(data, builder).choice;
    expect(choice).toMatchObject({ kind: "pick", max: 3 });
    const options = pickOptions(builder);
    expect(options.length).toBeGreaterThan(4);
    for (const target of options) expect(typeof builder.checkLeaderTarget(target)).not.toBe("string");
    expect(addAbility(builder, combinePicks(options.slice(0, 4)) ?? { kind: "none" })).toBe("tooManyTargets");
    const three = combinePicks(options.slice(0, 3));
    expect(three?.kind).toBe("hexes");
    expect(addAbility(builder, three ?? { kind: "none" })).toBeNull();
  });

  it("R-14.2: Morgra beschwört nur auf freie eigene Felder – das Feld des Anführers wird nicht angeboten", () => {
    const builder = setup("morgra");
    const options = pickOptions(builder);
    expect(options.length).toBeGreaterThan(0);
    const all = [...options];
    // Felder mit eigener Einheit lehnt die Engine mit cellOccupied ab; keines davon steht in der Auswahl.
    const leader = builder.movableUnits().find((u) => u.kind === "leader");
    expect(leader?.location.zone).toBe("left");
    const occupied = (["left", "right", "center"] as const).flatMap((arena) =>
      Array.from({ length: 10 }, (_, col) => Array.from({ length: 10 }, (_, row): ActionTarget => ({ kind: "hex", arena, cell: { col, row } }))).flat(),
    ).filter((t) => builder.checkLeaderTarget(t) === "cellOccupied");
    expect(occupied.length).toBeGreaterThan(0);
    for (const t of occupied) expect(all).not.toContainEqual(t);
  });

  it("R-16.6: Vex setzt eigene Einheiten auch in die gegnerische Hälfte einer Frontarena", () => {
    const builder = setup("vex");
    const before = builder.preview();
    const choice = abilityState(data, builder).choice;
    if (choice.kind !== "moves") throw new Error("erwartet moves");
    expect(choice.max).toBe(1);
    const leaderId = leaderUnitId(builder);
    expect(choice.units.map((u) => u.unitId)).toContain(leaderId);
    const rows = data.config.arenas.frontZone.rows;
    const enemyHalf = choice.destinations.find((d) => d.target.kind === "hex" && d.target.arena !== "center" && arenaHexToViewer(data.config, HUMAN, d.target).row >= rows);
    expect(enemyHalf).toBeDefined();
    expect(choice.destinations.some((d) => d.target.kind === "hex" && d.target.arena === "center")).toBe(true);
    const target = movesTarget([{ unitId: leaderId, to: enemyHalf?.target ?? { kind: "none" } }]);
    expect(target?.kind).toBe("moveUnits");
    expect(addAbility(builder, target ?? { kind: "none" })).toBeNull();
    const text = describeAction(data, before, builder.entries()[0]?.action ?? { type: "withdraw", amount: 0 });
    expect(text).toBe(`Anführer-Fähigkeit Schattenschritt → Vex → ${enemyHalf?.label ?? ""}`);
  });

  it("R-16.6: Vex „Doppelt“ darf zwei Einheiten versetzen, nicht mehr", () => {
    const builder = setup("vex", { level: 2, xp: 4, branchId: "double" });
    const choice = abilityState(data, builder).choice;
    if (choice.kind !== "moves") throw new Error("erwartet moves");
    expect(choice.max).toBe(2);
  });

  it("R-14.5, R-16.4: vernichteter Anführer – keine Fähigkeit in dieser Planung", () => {
    const builder = setup("brann", { returnsInRound: 2 });
    expect(abilityState(data, builder).unavailable).toBe(true);
    expect(addAbility(builder, { kind: "none" })).toBe("leaderUnavailable");
    expect(builder.entries()).toEqual([]);
  });

  it("C3d1: combinePicks und movesTarget ohne Auswahl ergeben kein Ziel", () => {
    expect(combinePicks([])).toBeNull();
    expect(movesTarget([])).toBeNull();
    expect(combinePicks([{ kind: "player", player: 1 }])).toEqual({ kind: "player", player: 1 });
  });

  it("R-7.7: Client und Engine liefern für dieselben Anführer-Zustände dieselbe Antwort zur Astwahl", () => {
    const cases: Partial<LeaderState>[] = [];
    for (const level of [1, 2, 3, 4] as const) for (const branchId of [null, "might"]) cases.push({ level, branchId });
    for (const leader of cases) {
      const builder = setup("brann", leader);
      const leaders = ["brann", ...OTHERS.filter((l) => l !== "brann")];
      const state = structuredClone(new GameSession(data, { seed: 3, leaders }).state);
      Object.assign(getPlayer(state, HUMAN).leader, leader);
      const open = branchChoiceOpen(getPlayer(state, HUMAN).leader);
      const engineAccepts = chooseBranch(state, data, HUMAN, "steadfast") === null;
      const label = `Stufe ${leader.level}, Ast ${leader.branchId ?? "keiner"}`;
      expect(open, label).toBe((leader.level ?? 1) >= 2 && leader.branchId === null);
      expect(engineAccepts, label).toBe(open);
      expect(branchChoice(builder) !== null, label).toBe(open);
      expect(setBranch(builder, "steadfast") === null, label).toBe(open);
    }
  });
});
