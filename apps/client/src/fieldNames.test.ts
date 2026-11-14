import { describe, expect, it } from "vitest";
import { allArenaHexes, allLocations, type ArenaRef, loadGameData, locationArenaHex, type PlayerIndex } from "@game/engine";
import { arenaHexName, arenaHexToViewer, frontCellName, locationName } from "./fieldNames";

const data = loadGameData();
const config = data.config;
const SEATS: PlayerIndex[] = [0, 1, 2, 3];

describe("R-3.8: Feldnamen in der Oberfläche", () => {
  it("R-3.8: Spalte als Buchstabe, Zeile als Zahl – hinterste Reihe a1, Reihe an der Front e3", () => {
    expect(frontCellName({ col: 0, row: 0 })).toBe("a1");
    expect(frontCellName({ col: 2, row: 1 })).toBe("c2");
    expect(frontCellName({ col: 4, row: 2 })).toBe("e3");
  });

  it("R-3.8: eigene Orte heißen nach Zone und Feld, Mitte und Reserve eingeschlossen", () => {
    expect(locationName(config, 0, { zone: "left", cell: { col: 1, row: 2 } })).toBe("Linke Front b3");
    expect(locationName(config, 0, { zone: "right", cell: { col: 4, row: 0 } })).toBe("Rechte Front e1");
    expect(locationName(config, 2, { zone: "center", position: 0 })).toBe("Mitte b1");
    expect(locationName(config, 1, { zone: "reserve", slot: 2 })).toBe("Reserve 3");
  });

  it("R-3.8: der Name eines eigenen Orts stimmt mit dem Namen seines Arena-Felds überein, für jeden Sitz (aus Sicht des Spielers)", () => {
    for (const seat of SEATS) {
      for (const loc of allLocations(config)) {
        const hex = locationArenaHex(config, seat, loc);
        if (!hex) continue;
        expect(arenaHexName(config, seat, hex)).toBe(locationName(config, seat, loc));
      }
    }
  });

  it("R-3.8: in einer Frontarena trägt die eigene Zone die Zeilen 1–3, die gegnerische die Zeilen 4–6 – in beiden Fronten", () => {
    for (const arena of ["left", "right"] as const) {
      const numbers = new Set(
        allArenaHexes(config)
          .filter((h) => h.arena === arena)
          .map((h) => arenaHexToViewer(config, 0, h).row + 1),
      );
      expect([...numbers].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    }
    // Das Feld direkt gegenüber der eigenen Frontreihe ist Zeile 4.
    expect(arenaHexName(config, 0, { arena: "right", cell: { col: 2, row: 3 } })).toBe("Rechte Front c4");
    expect(arenaHexName(config, 0, { arena: "left", cell: { col: 2, row: 2 } })).toBe("Linke Front c4");
  });

  it("R-3.8: in der Mitte liegt der eigene Startbereich für jeden Sitz auf b1–f1, die gegenüberliegende Seite auf Zeile 7", () => {
    for (const seat of SEATS) {
      const names = [0, 1, 2, 3, 4].map((position) => locationName(config, seat, { zone: "center", position }));
      expect(names).toEqual(["Mitte b1", "Mitte c1", "Mitte d1", "Mitte e1", "Mitte f1"]);
      const opposite = locationArenaHex(config, ((seat + 2) % 4) as PlayerIndex, { zone: "center", position: 2 });
      if (!opposite) throw new Error("Mittelfeld fehlt");
      expect(arenaHexName(config, seat, opposite)).toMatch(/^Mitte [a-g]7$/);
    }
  });

  it("R-3.8: jeder Name ist innerhalb einer Arena eindeutig, für jeden Sitz", () => {
    for (const seat of SEATS) {
      for (const arena of ["left", "right", "center"] as ArenaRef[]) {
        const hexes = allArenaHexes(config).filter((h) => h.arena === arena);
        const names = new Set(hexes.map((h) => arenaHexName(config, seat, h)));
        expect(names.size).toBe(hexes.length);
      }
    }
  });
});
