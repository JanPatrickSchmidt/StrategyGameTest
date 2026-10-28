# Erweiterungen nach dem Prototyp

Stand: 2026-10-28. Systeme, die **nach** dem funktionierenden Prototyp (M2–M4) gebaut werden, jeweils **hinter einem Schalter** in `config.json` (`features.<name>`, Standard `false`). Ist der Schalter aus, verhält sich das Spiel exakt wie ohne das System; alle bisherigen Tests bleiben grün.

Reihenfolge laut Jan: Evolution → Weltereignisse → Fusion. Gelände kommt erst in einer zweiten Iteration.

---

## E Evolution (`features.evolution`)

Evolution ist Jan besonders wichtig. Sie muss sich **gut anfühlen**: spürbar stärkere Werte und ein sichtbarer Moment in der 3D-Ansicht.

- **E-1 Wer:** Alle Einheitenkarten außer Tokens. Anführer entwickeln sich über ihre eigenen Stufen (R-16), nicht über dieses System.
- **E-2 Stufen:** Stufe 1 = Grundform. **Stufe 2** ab 3 XP [TUNING]. **Stufe 3** ab 7 XP [TUNING] **und** mindestens ★2.
- **E-3 Äste:** Jede Einheitenkarte hat zwei Äste A und B mit je einer Stufe 2 und Stufe 3: Name, Wertänderungen, zusätzliche Schlüsselwörter oder Fähigkeiten. Format in den Kartendaten unter `evolution` (in `data/README.md` dokumentieren).
- **E-4 Zeitpunkt:** Erreicht eine Einheit am Rundenende (R-12, nach der Kampfauswertung) eine neue Stufe, ist die Evolution „bereit“. In der nächsten Planung wählt der Spieler den Ast (Aktion `chooseEvolution(unitId, branch)`, nur beim Übergang von Stufe 1 zu 2; Stufe 3 folgt dem gewählten Ast). Ohne Wahl wird beim Aufdecken Ast A genommen. Ereignis `unit_evolved` für die Animation.
- **E-5 Verschmelzen:** XP werden addiert (R-15.1). Das Ergebnis übernimmt Stufe und Ast der beteiligten Einheit mit der höchsten Stufe, bei Gleichstand der mit den meisten XP, dann kleinste ID. Danach wird sofort geprüft, ob eine weitere Stufe erreicht ist.
- **E-6 Werte (Richtwerte, per Kalibrierung zu prüfen):** Stufe 2 ungefähr **+40 %** auf die Werte der aktuellen Sternstufe plus **ein** neues Schlüsselwort oder eine neue Fähigkeit. Stufe 3 ungefähr **+80 %** plus eine deutlich stärkere oder größere Fähigkeit. Evolutionen wirken zusätzlich zum Sternfaktor. Goldwert-Parität laut `balancing.md` beachten.
- **E-7 Inhalte:** Die Äste für alle Einheiten des Mini-Sets entwerfen die Agenten selbst und markieren sie in den Daten mit `"draft": true`. Jan überarbeitet sie nach seiner Rückkehr. Leitlinien: Die beiden Äste einer Einheit führen in **verschiedene** Richtungen (z. B. defensiv/offensiv, Einzelziel/Fläche, eigene Stärke/Unterstützung), passen zu Rasse und Klasse, und teure Einheiten bekommen die komplexeren Effekte (B-2).
- **E-8 Darstellung im Client:** eigene kurze Evolutions-Animation (Aufleuchten, Partikel, Formwechsel), danach sichtbar andere Figur (Größe, Silhouette, Farbakzente, Symbol für Stufe und Ast). Astwahl als eigener Dialog mit Vorschau beider Formen und ihrer Werte.

## W Weltereignisse (`features.worldEvents`)

Die Agenten dürfen die Ereignisse selbst gestalten (Freigabe von Jan).

- **W-1 Ablauf:** Zu jedem Rundenbeginn (vor dem Ziehen) wird das Ereignis der Runde aus einem gemischten Ereignis-Stapel aufgedeckt und gilt für alle bis zum Aufräumen. Ist der Stapel leer, wird neu gemischt.
- **W-2 Gestaltung:** Nur **Gelegenheiten**, keine reinen Nachteile (Design-Grundsatz „nur positiver Zufall“). Ein Ereignis verschiebt Anreize, z. B. „Handelskarawane: Der erste Kauf jedes Spielers kostet 1 weniger“, „Blutmond: +1 Durchbruch für alle“, „Ruhige See: Die Mitte gibt diese Runde doppelt Gold“. Kein Ereignis darf allein eine Partie entscheiden.
- **W-3 Umfang:** 10–12 Ereignisse in `data/events.json`, gebaut aus bestehenden Effekt-Bausteinen; neue Bausteine nur wenn nötig.
- **W-4 Vorschau:** Das kommende Ereignis ist grundsätzlich verborgen. Nur Spieler mit einer **Seher-Einheit** auf dem Brett oder in der Reserve sehen das Ereignis der nächsten Runde (privates Ereignis, R-18).
- **W-5 Seher:** 2 neue Königreich-Karten mit Seher-Fähigkeit (z. B. eine billige Einheit, die nur vorausschaut, und eine teurere, die zusätzlich das nächste Ereignis austauschen darf). Werte nach `balancing.md`.

## F Fusion (`features.fusion`)

- **F-1** Höchste Stufe eines neuen Schamanen-Anführer-Astes „Fusion“ (aktive Fähigkeit, Kategorie vor `damage`): zwei eigene Karten-Einheiten werden zu einer.
- **F-2 Ergebnis:** kleinste Sternzahl der Zutaten; XP aller Zutaten addiert; **alle** Fähigkeiten und Schlüsselwörter; Angriff und Leben addiert; der Spieler wählt eine der beiden Klassen; die Einheit hat beide Rassen und zählt für beide Resonanzen.
- **F-3 Grenzen:** Anführer und Tokens können nicht fusionieren, eine Fusion nicht erneut. Widersprüchliche Schlüsselwörter: der Spieler wählt eines.

## Ideen für eine zweite Iteration (nicht bauen)

- **Sicht / Nebel des Krieges** (Idee von Jan, noch offen): Wie viel man vom gegnerischen Feld sieht, hängt von der Sicht der eigenen Einheiten ab. Würde vor allem die Wahl von Zielen für Anführer-Fähigkeiten und Zauber beeinflussen.

- **Gelände** (Heimatgelände, Gelände-Karten), siehe Design-Dokument.
- **Fliegende Einheiten / zweite Ebene** (Idee von Jan): Flieger bewegen sich über andere Einheiten hinweg und ignorieren Gelände-Hindernisse; Nahkämpfer können sie nicht oder nur eingeschränkt angreifen; Fernkämpfer (Bogenschützen) haben gegen sie einen Vorteil.
