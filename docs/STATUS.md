# Status

**Aktueller Meilenstein:** M2 Regel-Engine
**Nächste Aufgabe:** E4 Spielzustand und Aufbau

## Zum Ausprobieren

Hier tragen Agenten alles ein, was Jan selbst testen kann, mit Pfad und kurzer Anleitung.

- (noch nichts)

## Verlauf (neueste oben)

| Datum | Aufgabe | Ergebnis | Nächster Schritt |
| --- | --- | --- | --- |
| 2026-10-28 | E3 Hex-Geometrie | `hex.ts`: odd-r ↔ Würfelkoordinaten, Hex-Abstand, Nachbarn (im Gitter, sortiert nach `(row, col)`), Breitensuche über freie Felder, nächster Schritt auf kürzestem Weg mit Gleichstand nach kleinster `(row, col)` (R-9.3), Frontzone ↔ Frontarena (R-3.2), Mittelzonen-Startbereiche und Positionen (R-3.4). Abmessungen nur aus `config.json`. 40 neue Tests, insgesamt 92 grün, Typecheck grün. Auslegung der Positionsreihenfolge als F10 notiert. | E4 Spielzustand und Aufbau |
| 2026-10-28 | E2 Datenvalidierung (Probelauf über geplante Aufgabe) | Typen für alle Datendateien (`dataTypes.ts`), Validator (`validate.ts`) für Pflichtfelder, Datentypen, unbekannte Felder, `op`/`target`/Auslöser/Bedingungen/Schlüsselwörter und ID-Verweise; `loadGameData()` validiert und wirft `GameDataError`. Echte Daten fehlerfrei, 43 Tests mit kaputten Daten. 52 Tests grün, Typecheck grün. Zwei Auslegungen als F8/F9 notiert. | E3 Hex-Geometrie |
| 2026-10-28 | E1 Projekt-Setup | Workspace, TypeScript, Vitest, Seed-Zufall, Datenlader-Grundlage; Spec, Kartendaten und Projektnotizen angelegt. Tests grün. | E2 Datenvalidierung |
