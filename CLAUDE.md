# Projektnotizen für Agenten

Dieses Repository enthält den Prototyp eines Strategiespiels: Deckbuilding (wie Dominion) trifft automatischen Kampf auf Hexfeldern (wie TFT), 4 Spieler im Free for All, mit Anführern, Fronten und einer umkämpften Mitte.

**Rollen:** Jan ist Produktverantwortlicher und entscheidet über das Spieldesign. Er programmiert nicht. Agenten (Claude) schreiben den gesamten Code. Jan ist zeitweise nicht erreichbar; die Arbeit darf deshalb nie auf eine Antwort von ihm warten.

## Zu Beginn jeder Sitzung lesen, in dieser Reihenfolge

1. `CLAUDE.md` (diese Datei)
2. `docs/STATUS.md` – aktueller Stand, letzte Einträge, Blockaden
3. `docs/BACKLOG.md` – Meilensteine, Aufgaben, Abnahmekriterien
4. `docs/FRAGEN_AN_JAN.md` – offene Fragen und die bis dahin gewählten Standards
5. Die für die Aufgabe relevanten Abschnitte von `docs/spec/regeln-prototyp.md` und `packages/engine/data/README.md`

## Arbeitsablauf pro Sitzung

1. `git pull` auf `main`.
2. `npm ci` und `npm test` und `npm run typecheck`. **Ist der Stand rot, wird zuerst repariert**, bevor Neues entsteht.
3. Die oberste offene Aufgabe aus `docs/BACKLOG.md` nehmen (Reihenfolge einhalten, Abhängigkeiten beachten). Zu große Aufgaben im Backlog in kleinere aufteilen und nur die erste davon erledigen.
4. Umsetzen, mit Tests. Jede Regel aus der Spec, die umgesetzt wird, bekommt mindestens einen Test, dessen Name die Regel-Kennung enthält (z. B. `R-9.4: Krieger ziehen Angriffe auf sich`).
5. `npm test` und `npm run typecheck` müssen grün sein.
6. `docs/BACKLOG.md` abhaken, einen Eintrag oben in `docs/STATUS.md` ergänzen (Datum, Aufgabe, Ergebnis, nächster Schritt).
7. Committen und auf `main` pushen. Nur grüne Stände werden gepusht.

Lieber eine Aufgabe sauber abschließen als drei anfangen.

## Entscheidungsregeln

**Agenten dürfen selbst entscheiden:**
- Alles Technische: Architektur innerhalb der Leitplanken unten, Datenstrukturen, Bibliotheken (sparsam), Refactorings.
- Mit **[TUNING]** markierte Zahlen in der Spec, um höchstens ±50 % vom Startwert, wenn Simulationsdaten das stützen. Jede Änderung wird in `docs/ENTSCHEIDUNGEN.md` mit Begründung und Daten festgehalten.
- Lücken oder Widersprüche in der Spec: die einfachste Auslegung wählen, die zum Rest der Spec passt, umsetzen und als Frage in `docs/FRAGEN_AN_JAN.md` notieren (inklusive der gewählten Auslegung).

**Agenten dürfen nicht entscheiden:**
- Spielregeln ändern, Mechaniken hinzufügen oder streichen, Kartentexte inhaltlich ändern.
- Stattdessen: Vorschlag in `docs/FRAGEN_AN_JAN.md` aufschreiben und nach der bestehenden Regel weiterarbeiten.

## Not-Aus

- Lässt sich ein roter Stand in einer Sitzung nicht reparieren: auf den letzten grünen Commit zurücksetzen (`git revert`, keine History umschreiben), in `docs/STATUS.md` oben **BLOCKIERT** mit Ursache eintragen, pushen, Sitzung beenden.
- Stehen oben in `docs/STATUS.md` bereits **drei BLOCKIERT-Einträge in Folge**: nichts mehr ändern außer einem kurzen Statuseintrag, damit kein Kontingent verbraucht wird, bis Jan zurück ist.
- Niemals Tests löschen oder abschwächen, um grün zu werden.

## Technische Leitplanken

- **Sprache:** TypeScript, `strict`, kein `any`. Code und Bezeichner auf Englisch, Dokumentation auf Deutsch.
- **Workspaces:** `packages/engine` (reine Spiellogik), später `apps/client` (Babylon.js), `tools/sim` (Simulation).
- **Engine ist rein:** keine Ein-/Ausgabe, kein Netzwerk, kein `Date`, kein `Math.random`. Zufall nur über den Seed-Generator (`packages/engine/src/rng.ts`).
- **Deterministisch:** gleicher Seed + gleiche Eingaben = identisches Ereignisprotokoll. Dafür gibt es einen eigenen Test.
- **Daten statt Code:** Karten, Anführer und Zahlen nur aus `packages/engine/data/`. Neue Effekt-Bausteine im Effekt-System ergänzen und in `data/README.md` dokumentieren.
- **Ereignisse:** Jede Zustandsänderung erzeugt ein Ereignis (Spec R-19). Der Client animiert nur Ereignisse.
- **Tests:** Vitest. Tests liegen neben dem Code (`*.test.ts`).
- **Abhängigkeiten:** Nur hinzufügen, wenn sie klar Zeit sparen; in `docs/ENTSCHEIDUNGEN.md` notieren.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm ci` | Abhängigkeiten installieren |
| `npm test` | Alle Tests |
| `npm run typecheck` | TypeScript-Prüfung |

## Commits

Kurze, beschreibende Commit-Nachrichten auf Deutsch, z. B. `Engine: Zielwahl im Kampf (R-9.4)`. Ein Commit pro abgeschlossenem Teilschritt.

## Externe Dokumente

Das Design-Dokument und das Technik-Dokument liegen bei claude.ai und sind in Agenten-Sitzungen eventuell nicht lesbar. Alles, was für den Code nötig ist, steht in `docs/`.
