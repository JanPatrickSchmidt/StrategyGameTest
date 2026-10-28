# Backlog

Aufgaben in Reihenfolge abarbeiten. Jede Aufgabe hat ein Abnahmekriterium. Abhaken mit `[x]` und Datum.

## Meilenstein M2: Regel-Engine

Ziel: Die komplette Spiellogik des Mini-Sets läuft ohne Grafik, getestet, mit Bots.

- [x] **E1 Projekt-Setup** (2026-10-28) – Workspace, TypeScript, Vitest, Seed-Zufall, Datenlader-Grundlage.
  - Abnahme: `npm test` und `npm run typecheck` grün.
- [ ] **E2 Datenvalidierung**
  - Alle Datendateien laden, typisieren und prüfen: jede referenzierte ID (Rasse, Klasse, Token, Karte) existiert, jeder `op` und jedes `target` ist im Effekt-System bekannt, Pflichtfelder vorhanden.
  - Abnahme: Test, der die echten Daten fehlerfrei validiert, und Tests mit absichtlich kaputten Daten, die erkannt werden.
- [ ] **E3 Hex-Geometrie**
  - Versetzte Koordinaten („odd-r“) ↔ Würfelkoordinaten, Abstand, Nachbarn, Breitensuche über freie Felder, Abbildung Frontzone → Frontarena (R-3.2), Mittelzonen-Startbereiche (R-3.4).
  - Abnahme: Tests für alle Funktionen inklusive Randfälle.
- [ ] **E4 Spielzustand und Aufbau**
  - Zustandsmodell, `createGame(config, leaders, seed)`, Startdeck, Mischen, Ziehen mit Nachmischen (R-4, R-6.3).
  - Abnahme: Tests zu R-4.x und R-6.3.
- [ ] **E5 Rundenmaschine**
  - Phasen laut R-5, API: `submitPlanning`, `submitPurchases`, `advance` bzw. `resolveRound`. Ungültige Aktionen → `action_rejected`.
  - Abnahme: Eine Runde ohne Aktionen läuft vollständig durch; Phasenreihenfolge getestet.
- [ ] **E6 Wirtschaft**
  - Ressourcen automatisch (R-6.4), Rundenvorrat, Schatzkammer und Zinsen (R-6.1, R-11.5), Entnahme (R-7.6), Kaufphase inkl. gleichzeitiger Käufe (R-11).
  - Abnahme: Tests zu allen genannten Regeln.
- [ ] **E7 Planung**
  - Aktionen R-7.1 bis R-7.10, Kapazität (R-3.6), alternative Kosten (R-14.6), Verschmelzen und Sternfaktor (R-15).
  - Abnahme: Tests zu allen genannten Regeln.
- [ ] **E8 Kampf: Frontarena**
  - Tick-Simulation (R-9.0 bis R-9.7) für Frontkämpfe, Zielwahl inkl. Krieger und Schurken, Bewegung, Angriff, Panzer, Schild, Tod, Ende.
  - Abnahme: Tests zu allen genannten Regeln; ein Determinismus-Test.
- [ ] **E9 Kampf: Mittelarena**
  - Free-for-all-Zielwahl, Halter-Bestimmung.
  - Abnahme: Tests zu R-9.1, R-9.7 für die Mitte.
- [ ] **E10 Effekt-System**
  - Auslöser und Bausteine laut `data/README.md`, alle Karten und Rassen des Mini-Sets wirken wie beschrieben.
  - Abnahme: Mindestens ein Test pro Karte mit Fähigkeit und pro Resonanzstufe.
- [ ] **E11 Zauber und Anführer**
  - Aufdecken, Anführer-Fähigkeiten nach Kategorien (R-8.2), Zauber nach Tempo und Prioritätsreihenfolge (R-8.3, R-8.4), Verpuffen (R-8.5), Anführer-Stufen und Äste (R-16).
  - Abnahme: Tests zu allen genannten Regeln, jeder Ast jedes Anführers auf jeder Stufe.
- [ ] **E12 Auswertung, Ausscheiden, Sieg**
  - Durchbruch, leere Front, Grundschaden, Mitte, Schwung und Trotz, XP (R-10), Ausscheiden, Platzierung, Machtsieg, Rundenlimit (R-13), Nachbarn neu berechnen (R-2).
  - Abnahme: Tests zu allen genannten Regeln.
- [ ] **E13 Sichtfilter und Ereignisprotokoll**
  - Sicht pro Spieler (R-18), gefilterte Ereignisse (R-19).
  - Abnahme: Test, dass keine fremde Hand und keine fremde Deckreihenfolge in einer Sicht oder einem gefilterten Ereignis auftaucht.
- [ ] **E14 Bots**
  - `RandomBot` (nur gültige Aktionen, zufällig über den Seed) und `GreedyBot` (einfache Heuristik: Board füllen, stärkste bezahlbare Karte kaufen, Zauber auf Feld mit den meisten Gegnern, Mitte besetzen wenn Board stark genug).
  - Abnahme: Beide Bots spielen vollständige Partien.
- [ ] **E15 Simulations-Werkzeug**
  - `tools/sim`: N Partien mit Seeds, Bot-Mix und Anführer-Verteilung; Ausgabe als CSV (eine Zeile pro Partie und Spieler: Seed, Anführer, Bot, Platz, Siegart, Runden, Leben am Ende, Machtpunkte, Käufe nach Karte).
  - Abnahme: `npm run sim -- --games 100` erzeugt eine gültige CSV.
- [ ] **E16 Abnahme M2**
  - 1.000 Partien (GreedyBot) laufen ohne Ausnahme und enden innerhalb des Rundenlimits.
  - Ein unabhängiger Prüf-Agent vergleicht Spec und Tests und listet Regeln ohne Test; Lücken werden geschlossen.
  - Eintrag in `docs/STATUS.md`: „M2 abgenommen“.

## Meilenstein M3: Spielbarer Prototyp im Browser

Ziel: Jan spielt im Browser gegen 3 Bots, mit schlichter 3D-Darstellung.

- [ ] **C1 Client-Grundgerüst** – `apps/client` mit Vite und Babylon.js; Engine läuft lokal im Browser, Bots als Gegner. Abnahme: Seite startet eine Partie und zeigt den Zustand als Text.
- [ ] **C2 3D-Brett** – Arenen, Hexfelder, Einheiten als einfache Formen mit Farbe pro Spieler, Kamera schräg von oben, Lebens- und Sternanzeige. Abnahme: Alle Arenen der Partie sichtbar und lesbar.
- [ ] **C3 Planungsoberfläche** – Hand, Gold, Schatzkammer, Einheiten platzieren und bewegen (Klicken oder Ziehen), Zauber mit Ziel legen, Anführer-Fähigkeit mit Ziel wählen, Astwahl. Abnahme: Alle Planungsaktionen sind bedienbar.
- [ ] **C4 Kampfwiedergabe** – Ereignisprotokoll als Animation abspielen: Bewegung, Angriff, Treffer, Tod, Fähigkeiten, Zauber, Schadenszahlen; Geschwindigkeit wählbar, überspringbar. Abnahme: Ein Kampf ist ohne Text nachvollziehbar.
- [ ] **C5 Kaufphase** – Königreich, Klassen-Pool, Stapelgrößen, Kaufen, Einzahlen. Abnahme: Käufe landen im Deck.
- [ ] **C6 Übersicht** – Leben, Machtpunkte, Serien, Gegner-Infos, Rundenzahl, Spielende mit Platzierung. Abnahme: Partie lässt sich bis zum Ende spielen.
- [ ] **C7 Veröffentlichung** – Build als einzelne statische Seite, Bereitstellung über GitHub Pages (Workflow im Repository; Jan muss Pages einmal aktivieren). Abnahme: Link in `docs/STATUS.md`, Seite spielbar.

## Meilenstein M4: Balancing

- [ ] **B1 Simulationsreihen** – je 2.000 Partien GreedyBot mit allen Anführer-Kombinationen; Kennzahlen: Siegquote je Anführer, Siegart (Leben, Macht, Rundenlimit), Rundenzahl, meistgekaufte Karten, Kaufquote je Karte.
- [ ] **B2 Tuning** – [TUNING]-Werte anpassen, bis kein Anführer über 35 % Siegquote liegt (fair wären 25 %) und Partien im Mittel 15–20 Runden dauern. Jede Änderung in `docs/ENTSCHEIDUNGEN.md`.
- [ ] **B3 Bericht für Jan** – `docs/berichte/balancing-<datum>.md` mit Ergebnissen, Diagrammen als Bilddateien und CSVs zum Selbstauswerten.

## Später (nicht ohne Jan)

Online-Multiplayer (M5), Grafik-Ausbau, weitere Systeme aus dem Design-Dokument (Pakte, Weltereignisse, Angebotsfenster, Evolution, Fusion, Gelände).
