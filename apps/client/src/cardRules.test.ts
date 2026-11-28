import { describe, expect, it } from "vitest";
import { type CardData, type Effect, loadGameData } from "@game/engine";
import { abilityText, altCostRulesText, cardRulesLines, cardRulesText, effectText, statsText, targetSpecText } from "./cardRules";

const data = loadGameData();

function card(id: string): CardData {
  const c = data.cards.get(id);
  if (!c) throw new Error(`Karte ${id} fehlt`);
  return c;
}

function idOf(name: string): string {
  for (const c of data.cards.values()) if (c.name === name) return c.id;
  throw new Error(`Karte ${name} fehlt`);
}

function lines(name: string): string[] {
  return cardRulesLines(data, card(idOf(name)));
}

describe("C5b2 Kartentexte aus den Effekt-Bausteinen", () => {
  it("R-6.4: Ressourcen nennen ihr Gold", () => {
    expect(lines("Silber")).toEqual(["Ressource", "Beim Ausspielen +2 Gold."]);
  });

  it("R-14.7: Fluch hat keine Wirkung", () => {
    expect(lines("Fluch")[0]).toBe("Fluch");
    expect(lines("Fluch")[1]).toMatch(/Keine Wirkung/);
  });

  it("R-9.2: Einheiten zeigen Rasse, Klasse und alle Werte der Karte (★1)", () => {
    const veteran = card(idOf("Schildwall-Veteran"));
    expect(cardRulesLines(data, veteran).slice(0, 2)).toEqual([
      "Einheit · Zwerge · Krieger",
      "Angriff 2 · Leben 6 · Durchbruch 0 · Reichweite 1 · Panzer 1", // Leben 6 seit B0c2
    ]);
    if (veteran.type !== "unit") throw new Error("Einheit erwartet");
    expect(statsText({ ...veteran, stats: { ...veteran.stats, attackInterval: 8, moveInterval: 5, manaMax: 80 } })).toBe(
      "Angriff 2 · Leben 6 · Durchbruch 0 · Reichweite 1 · Panzer 1 · Angriffstakt 8 · Lauftakt 5 · Mana 80",
    );
    expect(lines("Rekrut")[0]).toBe("Einheit · Krieger");
  });

  it("R-9.4: Kampfverhalten der Klasse steht im Text (Krieger, Schurke)", () => {
    expect(lines("Söldner")).toContain("Krieger: zieht Angriffe auf sich.");
    expect(lines("Taschendieb")).toContain("Schurke: springt zu Kampfbeginn neben das entfernteste gegnerische Ziel.");
    expect(lines("Lehrling").some((l) => l.startsWith("Zauberer:"))).toBe(false);
  });

  it("R-9.3: Schlüsselwort Erstschlag mit Erklärung", () => {
    expect(lines("Klingentänzerin")).toContain("Erstschlag: handelt in jedem Tick vor den anderen.");
  });

  it("R-9.3/R-9.0: Fähigkeiten nennen Auslöser und Wirkung", () => {
    expect(lines("Lehrling")).toContain("Bei vollem Mana: 2 Schaden am aktuellen Ziel.");
    expect(lines("Kesselflicker")).toContain("Zu Kampfbeginn: beschwört Goblin (1/1) auf ein freies Nachbarfeld.");
    expect(lines("Waldläuferin")).toContain("Bei vollem Mana: 2 Schaden an den 3 nächsten Gegnern.");
    expect(lines("Mondpriesterin")).toContain("Bei vollem Mana: Schild 6 beim schwächsten Verbündeten (wenigste Leben).");
    expect(lines("Champion der Arena")).toContain("Wenn sie eine gegnerische Einheit besiegt: +1 Angriff dauerhaft für sich selbst.");
    expect(lines("Totengräber")).toContain("Wenn eine verbündete Einheit in derselben Arena stirbt: +10 Mana bei allen Verbündeten.");
  });

  it("R-10.3/R-14.7: Fähigkeiten außerhalb des Kampfes (Gold, Fluch, Stehlen)", () => {
    expect(lines("Goblin-Plänkler")).toContain("Wenn sie stirbt: +1 Gold in die Schatzkammer.");
    expect(lines("Fluchweber")).toContain("Wenn ihre Seite den Frontkampf gewinnt: legt dem Gegner dieser Front einen Fluch auf den Ablagestapel.");
    expect(lines("Meisterdieb").at(-1)).toBe(
      "Wenn ihre Seite den Frontkampf gewinnt: stiehlt 2 Gold aus der Schatzkammer des Gegners dieser Front in deine Schatzkammer.",
    );
  });

  it("R-10.3: Gold ohne Ziel heißt nach der Engine-Regel des Auslösers (Planung: Rundenvorrat, sonst Schatzkammer)", () => {
    const gold: Effect = { op: "gainGold", amount: 1, when: "now" };
    expect(abilityText(data, { trigger: "onRoundStart", effects: [gold] })).toBe("Zu Rundenbeginn: +1 Gold in den Rundenvorrat.");
    expect(abilityText(data, { trigger: "onDeath", effects: [gold] })).toBe("Wenn sie stirbt: +1 Gold in die Schatzkammer.");
    expect(abilityText(data, { trigger: "onFrontWin", effects: [{ ...gold, to: "pool" }] })).toBe(
      "Wenn ihre Seite den Frontkampf gewinnt: +1 Gold in die Schatzkammer.",
    );
    // Zauber wirken nach der Planung (Standard von effectText).
    expect(effectText(data, gold)).toBe("+1 Gold in die Schatzkammer");
    // R-17a.2: Gold „zu Beginn der nächsten Runde“ kommt während deren Planung an.
    expect(abilityText(data, { trigger: "onKill", effects: [{ op: "gainGold", amount: 2, when: "nextRound" }] })).toBe(
      "Wenn sie eine gegnerische Einheit besiegt: +2 Gold zu Beginn der nächsten Runde in den Rundenvorrat.",
    );
  });

  it("R-9.4: Kampfverhalten der Klassen steht im Text, Klassen ohne Besonderheit ohne Zeile", () => {
    for (const c of data.cards.values()) {
      if (c.type !== "unit") continue;
      const behavior = data.classes.get(c.class)?.combatBehavior;
      const text = cardRulesText(data, c);
      if (behavior === "taunt") expect(text).toContain("zieht Angriffe auf sich");
      if (behavior === "backlineJump") expect(text).toContain("springt zu Kampfbeginn");
      if (behavior === "default") expect(text).not.toMatch(/: \.$/m);
    }
  });

  it("R-17a.1: Bedingung der Fähigkeit steht beim Auslöser", () => {
    expect(lines("Hehler")).toContain("Zu Rundenbeginn, wenn sie in der Reserve steht: +1 Gold in den Rundenvorrat.");
  });

  it("R-9.0: berechnete Werte werden erklärt", () => {
    expect(lines("Ahnenpfahl")).toContain(
      "Zu Kampfbeginn: +X Angriff (X = Zahl verschiedener eigener Rassen in der Arena) für den Kampf bei Verbündeten im Umkreis von 2 Feldern.",
    );
    expect(effectText(data, { op: "damage", amount: { kind: "selfAttackTimes", factor: 2 }, target: "currentTarget" })).toBe(
      "X Schaden (X = eigener Angriff × 2) am aktuellen Ziel",
    );
  });

  it("R-14.6: alternative Kosten", () => {
    expect(lines("Funkenreiter")).toContain("Alternative Kosten: 2 Leben (mindestens 1 bleibt).");
    expect(lines("Kopfgeldjäger")).toContain("Alternative Kosten: 2 Gold und 1 eigene Einheit opfern.");
    expect(altCostRulesText({})).toBe("kostenlos");
  });

  it("R-8.3: Vorkampf-Zauber mit Tempo, Ziel und Wirkung", () => {
    expect(lines("Feuerball")).toEqual([
      "Vorkampf-Zauber (wirkt vor den Kämpfen) · Tempo 2",
      "Ziel: ein Feld deiner Fronten oder der Mitte.",
      "Wirkung: 5 Schaden an den Gegnern auf dem gewählten Feld, 2 Schaden an den Gegnern auf den Nachbarfeldern.",
    ]);
    expect(lines("Schutzrune")).toContain("Wirkung: Schild 5 bei der eigenen Einheit auf dem gewählten Feld.");
    expect(lines("Kriegsruf")).toContain("Wirkung: +2 Leben für den Kampf bei allen eigenen Einheiten der gewählten Zone.");
    expect(lines("Geistertrommel")).toContain("Wirkung: Beschwört bis zu 2× Kleiner Geist (1/1) auf freie Felder der gewählten Zone.");
  });

  it("R-14.4: Frostlanze und Giftklinge erklären das Verwunden", () => {
    expect(lines("Frostlanze")).toContain("Wirkung: Verwundet alle Gegner auf dem gewählten Feld; sie kämpfen in dieser Runde nicht.");
    expect(lines("Giftklinge")).toContain(
      "Wirkung: Verleiht der eigenen Einheit auf dem gewählten Feld „Verwundet beim Töten“ für den Kampf (von ihr besiegte Einheiten sind verwundet).",
    );
  });

  it("R-8.4: Nachkampf-Zauber; ohne Ziel keine Zielzeile, Bedingung mit Verpuffen", () => {
    expect(lines("Kriegsbeute")).toEqual([
      "Nachkampf-Zauber (wirkt nach den Kämpfen) · Tempo 1",
      "Bedingung: nur wenn du in dieser Runde eine Front gewonnen hast, sonst verpufft er.",
      "Wirkung: +3 Gold in die Schatzkammer.",
    ]);
    expect(lines("Bürde")).toContain("Ziel: ein Nachbar (linker oder rechter Gegner).");
    expect(lines("Funkenschmiede")).toContain("Wirkung: 50 % Start-Mana in der nächsten Runde bei allen eigenen Zauberern.");
  });

  it("R-14.8: Läutern nennt Anzahl und Herkunft der Karten", () => {
    expect(lines("Läutern")).toEqual([
      "Nachkampf-Zauber (wirkt nach den Kämpfen) · Tempo 1",
      "Ziel: bis zu 2 eigene Karten aus Deck oder Ablagestapel.",
      "Wirkung: Entfernt die gewählten Karten dauerhaft aus dem Spiel.",
    ]);
    expect(targetSpecText({ kind: "ownCards", max: 1, from: ["discard"] })).toBe("bis zu 1 eigene Karte aus Ablagestapel");
  });

  it("R-14.5/R-16.6: übrige Bausteine haben einen Text (Vernichten, Versetzen, Beschwören mit Werten)", () => {
    const effects: Effect[] = [
      { op: "destroy", target: "hexEnemies" },
      { op: "move", target: "chosenUnits" },
      { op: "summon", token: "spirit", count: 2, where: "targetHexThenAdjacentFree", statOverride: { attack: 3, hp: 3 }, countsForResonance: true },
      { op: "stun", ticks: 5, target: { kind: "nearestEnemies", count: 1 } },
      { op: "heal", amount: 3, target: "weakestAlly" },
      { op: "gainGold", amount: 2, when: "nextRound", to: "pool" },
      { op: "gainLeaderXp", amount: 1 },
      { op: "costModifier", amount: -1, appliesTo: "raceCards" },
      { op: "returnOnDeath", hp: 1, limit: "firstRaceUnitPerCombat", target: "raceUnits" },
      { op: "bonusInterest", perGold: 4, amount: 1 },
      { op: "bonusXp", amount: 2, target: "raceUnits" },
      { op: "onFrontWinOfChosen", effects: [{ op: "gainGold", amount: 1, when: "now", to: "treasury" }] },
      { op: "damage", amount: 4, target: "hexAndNeighborEnemies", wound: true },
    ];
    expect(effects.map((e) => effectText(data, e))).toEqual([
      "vernichtet alle Gegner auf dem gewählten Feld; ihre Karten gehen auf den Ablagestapel",
      "versetzt die gewählten Einheiten auf das gewählte freie Feld",
      "beschwört bis zu 2× Geist (3/3) auf das gewählte Feld, dann auf freie Nachbarfelder; zählt für die Resonanz",
      "betäubt den nächsten Gegner 5 Ticks lang",
      "heilt 3 Leben beim schwächsten Verbündeten (wenigste Leben)",
      "+2 Gold zu Beginn der nächsten Runde in den Rundenvorrat",
      "+1 XP für deinen Anführer",
      "Einheiten dieser Rasse kosten 1 Gold weniger (nie unter 0)",
      "Wiederkehr mit 1 Leben nach dem Tod (nur die erste Einheit dieser Rasse je Kampf) bei allen Einheiten dieser Rasse",
      "+1 Gold Zinsen je volle 4 Gold in der Schatzkammer",
      "+2 XP beim Überleben eines Kampfes bei allen Einheiten dieser Rasse",
      "gewinnst du eine Front, an der eine gewählte Einheit kämpft: +1 Gold in die Schatzkammer",
      "4 Schaden an den Gegnern auf dem gewählten Feld und den Nachbarfeldern; davon besiegte Einheiten sind verwundet",
    ]);
  });

  it("R-9.0: benannte Fähigkeiten tragen ihren Namen", () => {
    expect(abilityText(data, { trigger: "onDeath", name: "Letzter Wille", effects: [{ op: "gainLeaderXp", amount: 1 }] })).toBe(
      "Letzter Wille – Wenn sie stirbt: +1 XP für deinen Anführer.",
    );
  });

  it("C5b2: jede Karte der Daten hat einen Text ohne Rohwerte (keine internen IDs, kein undefined)", () => {
    for (const c of data.cards.values()) {
      const text = cardRulesText(data, c);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/undefined|NaN|\[object/);
      expect(text).not.toMatch(/\b(on[A-Z]\w+|hex[A-Z]\w+|self|currentTarget|goblin_token|small_spirit)\b/);
    }
  });
});
