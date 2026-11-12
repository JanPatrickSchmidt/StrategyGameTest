import { describe, expect, it } from "vitest";
import { loadGameData, PHASES } from "@game/engine";
import { GameSession, HUMAN } from "./session";
import { formatState, PHASE_NAMES, playerName } from "./stateText";

const data = loadGameData();

describe("C1: Zustand als Text", () => {
  it("C1: zeigt Runde, Phase und alle vier Spieler mit Leben, Macht und Schatzkammer", () => {
    const session = new GameSession(data, { seed: 1 });
    const text = formatState(data, session.view());
    expect(text).toContain("Runde 1 von höchstens 30 · Phase: Planung");
    for (const name of ["Du (Sitz 1)", "Bot 2 (Sitz 2)", "Bot 3 (Sitz 3)", "Bot 4 (Sitz 4)"]) expect(text).toContain(name);
    expect(text.match(/Leben 30 · Macht 0 · Schatzkammer 0 Gold/g)?.length).toBe(4);
  });

  it("C1: zeigt Anführer mit Namen und die eigenen Handkarten mit Kartennamen", () => {
    const session = new GameSession(data, { seed: 1 });
    const view = session.view();
    const text = formatState(data, view);
    for (const entry of view.players) expect(text).toContain(data.leaders.get(entry.leader.leaderId)?.name ?? "fehlt");
    const own = view.players[HUMAN];
    if (!own?.own) throw new Error("eigene Sicht fehlt");
    const handLine = text.split("\n").find((l) => l.startsWith("  Hand: "));
    expect(handLine).toBeDefined();
    for (const id of own.hand) {
      const cardId = view.cards[id]?.cardId ?? "";
      expect(handLine).toContain(data.cards.get(cardId)?.name ?? "fehlt");
    }
  });

  it("R-18.2: Handkarten werden nur für den eigenen Spieler angezeigt", () => {
    const session = new GameSession(data, { seed: 2 });
    const text = formatState(data, session.view());
    expect(text.match(/^ {2}Hand: /gm)?.length).toBe(1);
  });

  it("C1: zeigt Einheiten auf dem Brett nach Zonen und die Kämpfe der letzten Runde", () => {
    const session = new GameSession(data, { seed: 3 });
    session.autopilot();
    session.autopilot();
    const text = formatState(data, session.view());
    expect(text).toContain("Linke Front: Hauptmann Brann ★ (Anführer)");
    expect(text).toContain("Kämpfe (Runde 2)");
    expect(text).toMatch(/Front Du gegen Bot \d|Front Bot \d gegen Du/);
  });

  it("R-13: nach dem Spielende stehen Sieger, Siegart und Platzierungen im Text", () => {
    const session = new GameSession(data, { seed: 4 });
    session.autopilotToEnd();
    const view = session.view();
    const text = formatState(data, view);
    expect(text).toContain("Phase: Spielende");
    expect(text).toMatch(/Partie beendet in Runde \d+: Sieg /);
    const eliminated = view.players.filter((p) => p.eliminated);
    expect(text.match(/– ausgeschieden, Platz \d/g)?.length ?? 0).toBe(eliminated.filter((p) => p.placement !== null).length);
  });

  it("C1: jede Phase hat einen deutschen Namen", () => {
    for (const phase of PHASES) expect(PHASE_NAMES[phase]).toBeTruthy();
  });

  it("C1: der Betrachter heißt „Du“, die anderen „Bot n“", () => {
    expect(playerName(0, 0)).toBe("Du");
    expect(playerName(2, 0)).toBe("Bot 3");
    expect(playerName(0, 1)).toBe("Bot 1");
  });
});
