import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// C7: Die Partie gegen 3 Bots liegt als statische Seite unter docs/play/ (GitHub Pages, Ordner /docs).
// Gebaut wird sie mit `npm run build:play` (apps/client/build-pages.mjs).
const here = dirname(fileURLToPath(import.meta.url));
const playDir = resolve(here, "../../../docs/play");
const indexPath = resolve(playDir, "index.html");

function referencedFiles(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("C7: Veröffentlichung unter docs/play/", () => {
  it("C7: docs/play/index.html existiert und ist die Partie gegen 3 Bots", () => {
    expect(existsSync(indexPath)).toBe(true);
    const html = readFileSync(indexPath, "utf8");
    expect(html).toContain("Partie gegen 3 Bots");
    expect(html).toContain('type="module"');
  });

  it("C7: alle eingebundenen Dateien sind relativ verlinkt und vorhanden (läuft unter /StrategyGameTest/play/)", () => {
    const html = readFileSync(indexPath, "utf8");
    const files = referencedFiles(html).filter((ref) => ref.includes("assets/"));
    expect(files.length).toBeGreaterThan(0);
    for (const ref of files) {
      expect(ref.startsWith("./assets/"), ref).toBe(true);
      expect(existsSync(resolve(playDir, ref)), ref).toBe(true);
    }
    // keine absoluten Pfade auf die Domain-Wurzel, die unter dem Projektpfad von GitHub Pages ins Leere zeigen
    expect(referencedFiles(html).filter((ref) => ref.startsWith("/"))).toEqual([]);
  });

  it("C7: keine verwaisten Dateien in docs/play/assets/ und keine Namen, die Jekyll auslässt", () => {
    const html = readFileSync(indexPath, "utf8");
    const assets = readdirSync(resolve(playDir, "assets"));
    for (const name of assets) {
      expect(/^[_.]/.test(name), name).toBe(false);
    }
    const scripts = assets.filter((name) => name.endsWith(".js"));
    const entry = scripts.filter((name) => html.includes(`./assets/${name}`));
    expect(entry.length).toBeGreaterThan(0);
    // Jede Datei wird von index.html oder vom Einstiegs-Skript geladen.
    const entryCode = entry.map((name) => readFileSync(resolve(playDir, "assets", name), "utf8")).join("\n");
    for (const name of assets) {
      expect(html.includes(name) || entryCode.includes(name), name).toBe(true);
    }
  });

  it("C7: die Kampf-Sandbox bleibt neben dem Spiel erhalten", () => {
    expect(existsSync(resolve(playDir, "sandbox.html"))).toBe(true);
  });
});
