# Status

**Aktueller Meilenstein:** M2 Regel-Engine
**Nächste Aufgabe:** E6 Wirtschaft

## Zum Ausprobieren

Hier tragen Agenten alles ein, was Jan selbst testen kann, mit Pfad und kurzer Anleitung.

- (noch nichts)

## Verlauf (neueste oben)

| Datum | Aufgabe | Ergebnis | Nächster Schritt |
| --- | --- | --- | --- |
| 2026-10-28 | E5 Rundenmaschine (zusätzlicher Lauf auf Jans Wunsch; der Hinweis „aktuell E4“ war überholt, E4 war schon erledigt) | `round.ts`: Phasenfolge laut R-5, `advance` arbeitet automatische Phasen ab und hält bei Planung und Kaufphase, bis alle aktiven Spieler eingereicht haben; `submitPlanning`/`submitPurchases` mit Ablehnung (`submission_rejected`: falsche Phase, ausgeschieden, doppelt, kaputt); Timeout ergibt leere Listen (R-7.9); Aufdecken veröffentlicht Planungen in Prioritätsreihenfolge (R-1.7, R-8.1); ungültige Aktionen → `action_rejected`; Aufräumen legt Handkarten ab und entfernt Tokens (R-12.1, R-12.2). `actions.ts`: Aktionstypen R-7.1–R-7.7. Noch Platzhalter: Aktionen und Käufe werden bis E6/E7 mit Grund `notImplemented` abgelehnt; Kampf, Zauber, Auswertung und Siegprüfung sind leere Phasen (Partieende vorläufig nur bei ≤ 1 aktivem Spieler). 22 neue Tests, insgesamt 139 grün, Typecheck grün. Neue Frage F12 (Einzahlung). | E6 Wirtschaft |
| 2026-10-28 | E4 Spielzustand und Aufbau | `state.ts`: JSON-serialisierbares Zustandsmodell (Spieler, Karteninstanzen, Einheiten mit Ort, Königreich, Klassen-Pools, Seed-Zufall, Ereignisprotokoll mit privaten Ereignissen über `visibleTo`). `setup.ts`: `createGame(data, leaders, seed)` mit Anführer-Zuteilung (R-4.1), Startdeck aus `config.startingDeck` und Mischen (R-4.2), Startwerten (R-4.3), Anführer auf Startfeld (R-4.4), Königreich und eigenen Klassen-Pools mit Stapelgrößen (R-4.5). `deck.ts`: Ziehen mit Nachmischen, Abbruch bei leerem Deck und Ablagestapel, Bonuskarte der Mitte (R-6.3). 25 neue Tests, insgesamt 117 grün, Typecheck grün. Auslegung des Startfelds als F11 notiert. | E5 Rundenmaschine |
| 2026-10-28 | E3 Hex-Geometrie | `hex.ts`: odd-r ↔ Würfelkoordinaten, Hex-Abstand, Nachbarn (im Gitter, sortiert nach `(row, col)`), Breitensuche über freie Felder, nächster Schritt auf kürzestem Weg mit Gleichstand nach kleinster `(row, col)` (R-9.3), Frontzone ↔ Frontarena (R-3.2), Mittelzonen-Startbereiche und Positionen (R-3.4). Abmessungen nur aus `config.json`. 40 neue Tests, insgesamt 92 grün, Typecheck grün. Auslegung der Positionsreihenfolge als F10 notiert. | E4 Spielzustand und Aufbau |
| 2026-10-28 | E2 Datenvalidierung (Probelauf über geplante Aufgabe) | Typen für alle Datendateien (`dataTypes.ts`), Validator (`validate.ts`) für Pflichtfelder, Datentypen, unbekannte Felder, `op`/`target`/Auslöser/Bedingungen/Schlüsselwörter und ID-Verweise; `loadGameData()` validiert und wirft `GameDataError`. Echte Daten fehlerfrei, 43 Tests mit kaputten Daten. 52 Tests grün, Typecheck grün. Zwei Auslegungen als F8/F9 notiert. | E3 Hex-Geometrie |
| 2026-10-28 | E1 Projekt-Setup | Workspace, TypeScript, Vitest, Seed-Zufall, Datenlader-Grundlage; Spec, Kartendaten und Projektnotizen angelegt. Tests grün. | E2 Datenvalidierung |
