import { describe, expect, it } from "vitest";
import { GameDataError, loadGameData, parseGameData, rawGameData } from "./data";
import { type RawGameData, type ValidationIssue, validateGameData } from "./validate";

type Key = string | number;

/** Navigates into cloned JSON and returns the object at the given path (array elements by index or by `id`). */
function at(root: unknown, ...path: Key[]): Record<string, unknown> {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current)) {
      current =
        typeof key === "number"
          ? current[key]
          : current.find((item: unknown) => typeof item === "object" && item !== null && "id" in item && item.id === key);
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[String(key)];
    } else {
      current = undefined;
    }
  }
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new Error(`Testpfad nicht gefunden: ${path.join(".")}`);
  }
  return current as Record<string, unknown>;
}

function broken(mutate: (raw: RawGameData) => void): ValidationIssue[] {
  const raw = structuredClone(rawGameData());
  mutate(raw);
  return validateGameData(raw);
}

/** Expects exactly one issue whose path ends with `pathSuffix` and whose message contains `text`. */
function expectSingleIssue(issues: ValidationIssue[], pathSuffix: string, text: string): void {
  expect(issues, JSON.stringify(issues, null, 2)).toHaveLength(1);
  const [issue] = issues;
  expect(issue?.path.endsWith(pathSuffix), issue?.path).toBe(true);
  expect(issue?.message).toContain(text);
}

const card = (raw: RawGameData, id: string) => at(raw.cards, "cards", id);
const leader = (raw: RawGameData, id: string) => at(raw.leaders, id);

describe("E2 Datenvalidierung: echte Daten", () => {
  it("R-14.1: die Datendateien des Repositorys sind fehlerfrei", () => {
    expect(validateGameData(rawGameData())).toEqual([]);
  });

  it("loadGameData liefert typisierte Daten ohne Fehler", () => {
    const data = loadGameData();
    const fireball = data.cards.get("fireball");
    expect(fireball?.type).toBe("spell");
    if (fireball?.type === "spell") expect(fireball.effects[0]?.op).toBe("damage");
  });
});

describe("E2 Datenvalidierung: kaputte Daten werden erkannt", () => {
  describe("Pflichtfelder und Typen", () => {
    it("fehlendes Pflichtfeld einer Karte (cost)", () => {
      const issues = broken((raw) => delete card(raw, "coin").cost);
      expectSingleIssue(issues, ".cost", "Pflichtfeld fehlt");
    });

    it("fehlendes typabhängiges Pflichtfeld: Einheit ohne stats", () => {
      const issues = broken((raw) => delete card(raw, "recruit").stats);
      expectSingleIssue(issues, ".stats", "Pflichtfeld fehlt");
    });

    it("fehlendes typabhängiges Pflichtfeld: Ressource ohne gold", () => {
      const issues = broken((raw) => delete card(raw, "silver").gold);
      expectSingleIssue(issues, ".gold", "Pflichtfeld fehlt");
    });

    it("fehlendes typabhängiges Pflichtfeld: Zauber ohne effects", () => {
      const issues = broken((raw) => delete card(raw, "fireball").effects);
      expectSingleIssue(issues, ".effects", "Pflichtfeld fehlt");
    });

    it("fehlender Pflicht-Kampfwert (hp)", () => {
      const issues = broken((raw) => delete at(card(raw, "ranger"), "stats").hp);
      expectSingleIssue(issues, ".stats.hp", "Pflichtfeld fehlt");
    });

    it("falscher Datentyp (Kosten als Text)", () => {
      const issues = broken((raw) => (card(raw, "tinker").cost = "3"));
      expectSingleIssue(issues, ".cost", "ganze Zahl");
    });

    it("negative Kosten", () => {
      const issues = broken((raw) => (card(raw, "tinker").cost = -1));
      expectSingleIssue(issues, ".cost", "mindestens 0");
    });

    it("unbekannter Kartentyp", () => {
      const issues = broken((raw) => (card(raw, "curse").type = "trap"));
      expectSingleIssue(issues, ".type", "unbekannter Kartentyp");
    });

    it("unbekanntes Feld (Tippfehler) wird gemeldet", () => {
      const issues = broken((raw) => {
        const stats = at(card(raw, "bone_soldier"), "stats");
        stats.atack = stats.attack;
        delete stats.attack;
      });
      expect(issues.map((i) => i.message).sort()).toEqual(["Pflichtfeld fehlt", "unbekanntes Feld"]);
    });

    it("Felder mit _ sind Kommentare und erlaubt", () => {
      const issues = broken((raw) => (card(raw, "coin")._note = "Kommentar"));
      expect(issues).toEqual([]);
    });

    it("doppelte Karten-ID", () => {
      const issues = broken((raw) => (card(raw, "silver").id = "coin"));
      expectSingleIssue(issues, "cards.cards", "doppelte ID: coin");
    });

    it("fehlendes Feld in config.json", () => {
      const issues = broken((raw) => delete at(raw.config, "combat").maxTicks);
      expectSingleIssue(issues, "config.combat.maxTicks", "Pflichtfeld fehlt");
    });
  });

  describe("R-14.1: Effekt-System", () => {
    it("unbekannter Effekt-Baustein (op)", () => {
      const issues = broken((raw) => (at(card(raw, "fireball"), "effects", 0).op = "explode"));
      expectSingleIssue(issues, ".effects[0].op", "unbekannter Effekt-Baustein");
    });

    it("unbekannter Effekt-Baustein in verschachteltem onFrontWinOfChosen", () => {
      const issues = broken(
        (raw) =>
          (at(leader(raw, "vex"), "active", "branches", "loot", "levels", "2", "effects", 1, "effects", 0).op = "steal"),
      );
      expectSingleIssue(issues, ".effects[1].effects[0].op", "unbekannter Effekt-Baustein");
    });

    it("fehlender Parameter eines Bausteins (damage ohne amount)", () => {
      const issues = broken((raw) => delete at(card(raw, "fireball"), "effects", 0).amount);
      expectSingleIssue(issues, ".effects[0].amount", "Pflichtfeld fehlt");
    });

    it("unbekanntes Ziel (target) als Text", () => {
      const issues = broken((raw) => (at(card(raw, "fireball"), "effects", 0).target = "everyone"));
      expectSingleIssue(issues, ".effects[0].target", "unbekannter Wert für Ziel");
    });

    it("unbekanntes Ziel (target) als Objekt", () => {
      const issues = broken(
        (raw) => (at(card(raw, "ranger"), "abilities", 0, "effects", 0).target = { kind: "randomEnemies", count: 2 }),
      );
      expectSingleIssue(issues, ".target.kind", "unbekannte Art für Ziel");
    });

    it("unbekannte Ziel-Angabe eines Zaubers", () => {
      const issues = broken((raw) => (at(card(raw, "fireball"), "target").kind = "line"));
      expectSingleIssue(issues, ".target.kind", "unbekannte Art für Ziel-Angabe");
    });

    it("unbekannter Auslöser (trigger)", () => {
      const issues = broken((raw) => (at(card(raw, "tinker"), "abilities", 0).trigger = "onSunrise"));
      expectSingleIssue(issues, ".abilities[0].trigger", "unbekannter Wert für Auslöser");
    });

    it("unbekannte Bedingung", () => {
      const issues = broken((raw) => (at(card(raw, "war_spoils"), "condition").kind = "isNight"));
      expectSingleIssue(issues, ".condition.kind", "unbekannter Wert für Bedingung");
    });

    it("unbekanntes Schlüsselwort", () => {
      const issues = broken((raw) => (card(raw, "blade_dancer").keywords = ["flying"]));
      expectSingleIssue(issues, ".keywords[0]", "unbekannter Wert für keyword");
    });

    it("unbekannter Wert (stat) bei buff", () => {
      const issues = broken((raw) => (at(card(raw, "runesmith"), "abilities", 0, "effects", 0).stat = "luck"));
      expectSingleIssue(issues, ".effects[0].stat", "unbekannter Wert für stat");
    });

    it("unbekannter berechneter Wert (amount)", () => {
      const issues = broken(
        (raw) => (at(card(raw, "ancestor_pole"), "abilities", 0, "effects", 0).amount = { kind: "moonPhase" }),
      );
      expectSingleIssue(issues, ".amount.kind", "unbekannte Art für berechneten Wert");
    });

    it("leere Effekt-Liste", () => {
      const issues = broken((raw) => (card(raw, "purify").effects = []));
      expectSingleIssue(issues, ".effects", "mindestens 1");
    });
  });

  describe("Verweise auf IDs", () => {
    it("unbekannte Rasse an einer Karte", () => {
      const issues = broken((raw) => (card(raw, "tinker").race = "orc"));
      expectSingleIssue(issues, ".race", "unbekannte Rasse: orc");
    });

    it("race: null ist für rassenlose Einheiten erlaubt", () => {
      const issues = broken((raw) => (card(raw, "tinker").race = null));
      expect(issues).toEqual([]);
    });

    it("unbekannte Klasse an einer Karte", () => {
      const issues = broken((raw) => (card(raw, "tinker").class = "paladin"));
      expectSingleIssue(issues, ".class", "unbekannte Klasse: paladin");
    });

    it("unbekannte Klasse im Klassen-Pool", () => {
      const issues = broken((raw) => (card(raw, "fence").pool = "class:paladin"));
      expectSingleIssue(issues, ".pool", "unbekannte Klasse: paladin");
    });

    it("unbekannter Pool", () => {
      const issues = broken((raw) => (card(raw, "fence").pool = "shop"));
      expectSingleIssue(issues, ".pool", "unbekannter Wert für pool");
    });

    it("unbekannte Klasse bei starterFor und startManaPercent", () => {
      const issues = broken((raw) => {
        card(raw, "squire").starterFor = "knight";
        at(card(raw, "spark_forge"), "effects", 0).class = "wizard";
      });
      expect(issues.map((i) => i.message).sort()).toEqual(["unbekannte Klasse: knight", "unbekannte Klasse: wizard"]);
    });

    it("unbekannte Klasse und Rasse eines Anführers", () => {
      const issues = broken((raw) => {
        leader(raw, "brann").class = "paladin";
        leader(raw, "brann").race = "orc";
      });
      expect(issues.map((i) => i.message).sort()).toEqual(["unbekannte Klasse: paladin", "unbekannte Rasse: orc"]);
    });

    it("unbekanntes Token bei summon", () => {
      const issues = broken((raw) => (at(card(raw, "tinker"), "abilities", 0, "effects", 0).token = "dragon"));
      expectSingleIssue(issues, ".effects[0].token", "unbekanntes Token: dragon");
    });

    it("summon auf eine Karte, die kein Token ist", () => {
      const issues = broken((raw) => (at(card(raw, "spirit_drum"), "effects", 0).token = "recruit"));
      expectSingleIssue(issues, ".effects[0].token", "unbekanntes Token: recruit");
    });
  });

  describe("Rassen, Klassen, Anführer", () => {
    it("R-17: Resonanz-Stufe muss eine positive Zahl sein", () => {
      const issues = broken((raw) => {
        const resonance = at(raw.races, "elf", "resonance");
        resonance.two = resonance["2"];
        delete resonance["2"];
      });
      expectSingleIssue(issues, ".resonance.two", "positive ganze Zahl");
    });

    it("R-17: unbekannter Effekt-Baustein in einem Resonanz-Bonus", () => {
      const issues = broken((raw) => (at(raw.races, "goblin", "resonance", "2", 0).op = "haste"));
      expectSingleIssue(issues, ".resonance.2[0].op", "unbekannter Effekt-Baustein");
    });

    it("R-9.4: unbekanntes Kampfverhalten einer Klasse", () => {
      const issues = broken((raw) => (at(raw.classes, "rogue").combatBehavior = "teleport"));
      expectSingleIssue(issues, ".combatBehavior", "unbekannter Wert für combatBehavior");
    });

    it("R-8.2: unbekannte Kategorie einer Anführer-Fähigkeit", () => {
      const issues = broken((raw) => (at(leader(raw, "ilyra"), "active").category = "heal"));
      expectSingleIssue(issues, ".active.category", "Kategorie (R-8.2)");
    });

    it("R-16.2: Ast ohne Stufe 4", () => {
      const issues = broken((raw) => delete at(leader(raw, "morgra"), "active", "branches", "horde", "levels")["4"]);
      expectSingleIssue(issues, ".levels.4", "Pflichtfeld fehlt");
    });

    it("R-16.2: doppelte Ast-ID eines Anführers", () => {
      const issues = broken((raw) => (at(leader(raw, "brann"), "active", "branches", "might").id = "reach"));
      expectSingleIssue(issues, ".active.branches", "doppelte ID: reach");
    });

    it("R-14.6: unbekannte alternative Kostenart", () => {
      const issues = broken((raw) => (at(card(raw, "spark_rider"), "altCost").mana = 2));
      expectSingleIssue(issues, ".altCost.mana", "unbekanntes Feld");
    });
  });

  describe("Laden", () => {
    it("parseGameData wirft GameDataError mit allen Fehlern", () => {
      const raw = structuredClone(rawGameData());
      at(card(raw, "fireball"), "effects", 0).op = "explode";
      card(raw, "tinker").race = "orc";
      expect(() => parseGameData(raw)).toThrow(GameDataError);
      try {
        parseGameData(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(GameDataError);
        expect((error as GameDataError).issues).toHaveLength(2);
        expect((error as GameDataError).message).toContain("unbekannte Rasse: orc");
      }
    });
  });
});
