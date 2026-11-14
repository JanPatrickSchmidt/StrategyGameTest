import { describe, expect, it } from "vitest";
import { allArenaHexes, type CardInstanceId, type GameState, getPlayer, isOwnHex, loadGameData, neighborsOf, PlanningDraft } from "@game/engine";
import { describeAction, ownEntry, PlanBuilder } from "./planner";
import { GameSession, HUMAN } from "./session";
import { addSpell, spellAction, spellHandCards, spellTargetChoice, type TargetOption } from "./spellTargets";
import { targetText } from "./targetText";

const data = loadGameData();
const config = data.config;

/** Planung des Menschen in Runde 1 mit zusätzlichen Karten auf der Hand und genug Gold. */
function setup(cardIds: string[], seed = 3): { state: GameState; builder: PlanBuilder; ids: CardInstanceId[] } {
  const session = new GameSession(data, { seed });
  const state = structuredClone(session.state);
  const p = getPlayer(state, HUMAN);
  const ids = cardIds.map((cardId) => {
    const id = state.nextCardInstanceId++;
    state.cards[id] = { id, cardId, owner: HUMAN };
    p.hand.push(id);
    return id;
  });
  p.roundGold = 10;
  p.treasury = 10;
  return { state, builder: new PlanBuilder(state, data, HUMAN), ids };
}

function single(builder: PlanBuilder, id: CardInstanceId): TargetOption[] {
  const choice = spellTargetChoice(data, builder, id);
  if (choice?.kind !== "single") throw new Error(`Keine Einzelwahl: ${choice?.kind}`);
  return choice.options;
}

function only<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error("leer");
  return first;
}

describe("C3c1: Zauber mit Ziel legen", () => {
  it("R-7.3: Zauberkarten der Hand werden als Zauber erkannt, Einheiten nicht", () => {
    const { builder, ids } = setup(["fireball", "war_spoils"]);
    const spells = spellHandCards(data, builder.preview());
    expect(spells.map((c) => c.instanceId)).toEqual(ids);
    expect(spellTargetChoice(data, builder, ownEntry(builder.preview()).hand.find((id) => !ids.includes(id)) ?? -1)).toBeNull();
  });

  it("R-14.2: Feuerball (teilnehmende Arenen) bietet jedes Feld aller drei Arenen an, benannt nach R-3.8", () => {
    const { builder, ids } = setup(["fireball"]);
    const options = single(builder, only(ids));
    expect(options).toHaveLength(allArenaHexes(config).length);
    expect(new Set(options.map((o) => o.group))).toEqual(new Set(["Linke Front", "Rechte Front", "Mitte"]));
    // R-3.8: Felder aus Sicht des Spielers; in der Frontarena zählen die Zeilen über die Front weiter (4–6 = Gegner).
    const labels = options.map((o) => o.label);
    expect(labels).toContain("Rechte Front c5");
    expect(labels).toContain("Linke Front a1");
    expect(labels).toContain("Mitte d4");
    expect(new Set(labels).size).toBe(labels.length);
    // Lesereihenfolge: Zeile 1 zuerst, darin a, b, c …
    expect(labels.slice(0, 3)).toEqual(["Linke Front a1", "Linke Front b1", "Linke Front c1"]);
  });

  it("R-14.2: Schutzrune (eigene Felder) bietet nur Felder der eigenen Zonen und den eigenen Startbereich der Mitte an (F24)", () => {
    const { builder, ids } = setup(["rune_shield"]);
    const options = single(builder, only(ids));
    const { cols, rows } = config.arenas.frontZone;
    expect(options).toHaveLength(2 * cols * rows + config.arenas.centerStartSlots);
    for (const o of options) {
      if (o.target.kind !== "hex") throw new Error("kein Feld");
      expect(isOwnHex(config, HUMAN, o.target)).toBe(true);
    }
    expect(options.filter((o) => o.group === "Mitte").map((o) => o.label)).toEqual(["Mitte b1", "Mitte c1", "Mitte d1", "Mitte e1", "Mitte f1"]);
  });

  it("R-14.2: Kriegsruf (eigene Zone) bietet die drei eigenen Zonen einzeln an", () => {
    const { builder, ids } = setup(["war_cry"]);
    expect(single(builder, only(ids)).map((o) => [o.label, o.target])).toEqual([
      ["Linke Front", { kind: "zone", arenas: ["left"] }],
      ["Rechte Front", { kind: "zone", arenas: ["right"] }],
      ["Mitte", { kind: "zone", arenas: ["center"] }],
    ]);
  });

  it("R-14.2: Bürde (Spieler) bietet nur die beiden Nachbarn an", () => {
    const { state, builder, ids } = setup(["burden"]);
    const n = neighborsOf(state, HUMAN);
    if (!n) throw new Error("keine Nachbarn");
    const options = single(builder, only(ids));
    expect(options.map((o) => o.target)).toEqual(
      [n.left, n.right].sort((a, b) => a - b).map((player) => ({ kind: "player", player })),
    );
    expect(options.map((o) => o.label).every((l) => /^Bot \d$/.test(l))).toBe(true);
  });

  it("R-14.2: Kriegsbeute hat kein Ziel und wird ohne Wahl gelegt", () => {
    const { builder, ids } = setup(["war_spoils"]);
    expect(spellTargetChoice(data, builder, only(ids))).toEqual({ kind: "none" });
    expect(addSpell(data, builder, only(ids), { kind: "none" })).toBeNull();
    expect(builder.planning().play).toEqual([{ type: "setSpell", cardInstanceId: only(ids), slot: "post", target: { kind: "none" } }]);
  });

  it("R-7.3: der gelegte Zauber verlässt in der Vorschau die Hand, kostet sofort und steht mit Ziel in der Liste", () => {
    const { builder, ids } = setup(["fireball"]);
    const before = builder.preview();
    const goldBefore = ownEntry(before).roundGold;
    const target = only(single(builder, only(ids)).filter((o) => o.label === "Rechte Front c5")).target;
    expect(addSpell(data, builder, only(ids), target)).toBeNull();
    const after = builder.preview();
    expect(ownEntry(after).hand).not.toContain(only(ids));
    expect(ownEntry(after).roundGold).toBe(goldBefore - 4);
    expect(after.players[HUMAN]?.spells.pre.map((s) => s.cardInstanceId)).toEqual(ids);
    const entry = only(builder.entries());
    expect(entry.rejection).toBeNull();
    expect(describeAction(data, before, entry.action)).toBe("Zauber Feuerball legen (vor dem Kampf) → Rechte Front c5");
  });

  it("R-7.3: ein zweiter Vorkampf-Zauber wird abgelehnt, weil der Slot belegt ist (config.spellSlots)", () => {
    const { builder, ids } = setup(["fireball", "war_cry"]);
    const [fireball, warCry] = ids as [CardInstanceId, CardInstanceId];
    expect(addSpell(data, builder, fireball, only(single(builder, fireball)).target)).toBeNull();
    expect(addSpell(data, builder, warCry, only(single(builder, warCry)).target)).toBe("slotFull");
    expect(builder.entries()).toHaveLength(1);
  });

  it("R-5: ein Zauber aus einem anderen Schritt heraus wechselt zum Schritt Ausspielen", () => {
    const { builder, ids } = setup(["war_cry"]);
    builder.setStep("position");
    expect(addSpell(data, builder, only(ids), { kind: "zone", arenas: ["center"] })).toBeNull();
    expect(builder.step).toBe("play");
  });

  it("R-14.8: Läutern lässt bis zu 2 eigene Karten aus Deck und Ablagestapel ankreuzen", () => {
    const { state, builder, ids } = setup(["purify"]);
    const p = getPlayer(state, HUMAN);
    // Eine Karte in den Ablagestapel legen, damit beide Bereiche vorkommen.
    const moved = p.deck.shift();
    if (moved === undefined) throw new Error("Deck leer");
    p.discard.push(moved);
    const fresh = new PlanBuilder(state, data, HUMAN);
    const choice = spellTargetChoice(data, fresh, only(ids));
    if (choice?.kind !== "ownCards") throw new Error("keine Kartenwahl");
    expect(choice.max).toBe(2);
    expect(choice.cards.filter((c) => c.from === "discard").map((c) => c.instanceId)).toEqual([moved]);
    expect(choice.cards.filter((c) => c.from === "deck")).toHaveLength(p.deck.length);
    expect(choice.cards.every((c) => c.name.length > 0 && !c.name.startsWith("Karte "))).toBe(true);
    const picks = choice.cards.slice(0, 3).map((c) => c.instanceId);
    expect(addSpell(data, fresh, only(ids), { kind: "ownCards", cardInstanceIds: picks })).toBe("tooManyCards");
    expect(addSpell(data, fresh, only(ids), { kind: "ownCards", cardInstanceIds: picks.slice(0, 2) })).toBeNull();
    const before = new PlanBuilder(state, data, HUMAN).preview();
    const text = targetText(data, before, { kind: "ownCards", cardInstanceIds: picks.slice(0, 2) });
    expect(text.split(", ")).toHaveLength(2);
  });

  it("C3c1: die Aktion nimmt den Slot aus den Kartendaten (F22), Nicht-Zauber ergeben keine Aktion", () => {
    const { builder, ids } = setup(["purify", "recruit"]);
    const [purify, recruit] = ids as [CardInstanceId, CardInstanceId];
    expect(spellAction(data, builder.preview(), purify, { kind: "ownCards", cardInstanceIds: [] })).toMatchObject({ slot: "post" });
    expect(spellAction(data, builder.preview(), recruit, { kind: "none" })).toBeNull();
    expect(addSpell(data, builder, recruit, { kind: "none" })).toBe("notASpellCard");
  });

  it("R-3.8: Ziele als Text – Feld, Felder, Zone, Spieler, keine Wahl", () => {
    const { builder } = setup([]);
    const view = builder.preview();
    expect(targetText(data, view, { kind: "none" })).toBe("ohne Ziel");
    expect(targetText(data, view, { kind: "hex", arena: "right", cell: { col: 2, row: 4 } })).toBe("Rechte Front c5");
    expect(targetText(data, view, { kind: "hexes", hexes: [{ arena: "center", cell: { col: 3, row: 3 } }] })).toBe("Mitte d4");
    expect(targetText(data, view, { kind: "zone", arenas: ["left", "center"] })).toBe("Linke Front, Mitte");
    expect(targetText(data, view, { kind: "player", player: 2 })).toBe("Bot 3");
    expect(targetText(data, view, { kind: "ownCards", cardInstanceIds: [] })).toBe("keine Karte");
  });

  it("C3c1: die angebotenen Ziele stimmen mit der Engine überein (jedes wird im Entwurf angenommen)", () => {
    const { state, builder, ids } = setup(["frost_lance"]);
    for (const option of single(builder, only(ids)).slice(0, 12)) {
      const draft = new PlanningDraft(state, data, HUMAN);
      draft.enter("play");
      expect(draft.attempt({ type: "setSpell", cardInstanceId: only(ids), slot: "pre", target: option.target })).toBeNull();
    }
  });
});
