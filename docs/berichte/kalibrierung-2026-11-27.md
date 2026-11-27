# Kampf-Kalibrierung: Messung und Bericht (2026-11-27)

Aufgabe **B0b** (M4 Balancing). Grundlage: Werkzeug aus B0a (`npm run calibrate`, `tools/sim/src/calibration.ts`), Spec **B-1** (Goldwert-Parität) und **B-3** (Messung). In dieser Aufgabe wurden **keine Kartenwerte geändert**; die Vorschläge unten sind der Ausgangspunkt für B0c.

## Kurzfassung für Jan

1. **Die Zahl der Einheiten entscheidet fast alles.** Hat eine Armee bei gleichem Gold eine Einheit mehr, gewinnt sie 67 % der Kämpfe, mit zwei mehr 80 %. Die erste Messung (B0a) hat deshalb vor allem gemessen, „wie billig“ eine Karte ist: Billige ★1-Karten sahen zu stark aus, ★2-Einheiten und teure Karten zu schwach.
2. **Faire Messung:** Beide Armeen haben jetzt auf Wunsch gleich viel Gold **und** gleich viele Einheiten (`--same-count`, neu). Damit wird sichtbar, was eine Karte pro Platz auf dem Brett taugt. Das passt zum Spiel, sobald die Kapazität von 5 Einheiten voll ist (Mittel- und Spätspiel). Ich schlage vor, diese Messung für das Ziel 45–55 % zu verwenden (**Frage F62**).
3. **Klar zu stark** (in allen Messarten): Champion der Arena (85 %), Bannerträger (79 %), Schildwall-Veteran (72 %); etwas zu stark: Donnerbüchse, Erzmagier, Klingentänzerin, Seelenhirte, Kopfgeldjäger, Waldläuferin (57–64 %).
4. **Klar zu schwach:** Mondpriesterin (39 %), Funkenreiter (43 %), Taschendieb (43 %); Hehler (29 %) und Fluchweber (45 %) wirken auch außerhalb des Kampfes und sind als Ausnahme zu prüfen.
5. **★2 ist bei billigen Karten zu schwach.** Gegen eine ★1-Karte mit dreifachen Kosten gewinnt eine ★1-Kosten-Karte als ★2 im Schnitt nur 39 % (Ziel 50–65 %). Mit Sternfaktor 2,0 statt 1,8 (ein [TUNING]-Wert, R-15.2) wären es 63 %.
6. **Der Zweikampf ★2 gegen dreifache Kosten lässt sich nur für Karten mit 1 und 2 Gold sinnvoll messen**, weil es keine Karte über 6 Gold gibt (**Frage F63**).
7. Kaum Einfluss haben: die Aufstellung (geordnet gegen zufällig 51 %), die Obergrenze von 5 Einheiten (bei gleicher Einheitenzahl fast dieselben Werte wie mit bis zu 15) und Unentschieden (0 %).

## Messaufbau

- Mini-Set: alle 24 Einheitenkarten außer Tokens, ★1 und ★2 (★2 kostet das Dreifache). Rassen-Resonanz, Anführer und Zauber sind nicht enthalten.
- Budget 6, 10 und 15 Gold im Wechsel, höchstens 5 Einheiten (`boardCapacity`), Frontarena, zufällige Aufstellung, jede Paarung von beiden Seiten.
- **Basis:** `npm run calibrate -- --battles 3000 --budget 6,10,15 --seed S` für die Seeds 1–5 (zusammen 30 000 Kämpfe).
- **Gleiche Zahl:** wie Basis mit `--same-count`, Seeds 1–5.
- Je Budget einzeln: `--budget 6` (bzw. 10, 15) `--same-count`, Seed 1, 3000 Paarungen; „bis 15 Einheiten“: `--same-count --max-units 15`; „nur ★1“: `--same-count --no-star2`, Budgets 6/10/15 einzeln zusammengefasst.
- Dauer: jeweils etwa 2 Sekunden.

## Einfluss der Einheitenzahl (Basis, Seed 1)

| Einheiten mehr als der Gegner | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Siegquote | 1 % | 6 % | 20 % | 34 % | 50 % | 67 % | 80 % | 94 % | 99 % |

Die Tabelle gibt das Werkzeug jetzt bei jedem Lauf aus (Abschnitt „Einheiten-Differenz“). Mit `--same-count` gibt es nur noch die Differenz 0.

## Siegquote je Karte

Siegquote in Prozent (Ziel 45–55 %). Fett: Hauptmaß „gleiche Zahl“, ▲ über 55 %, ▼ unter 45 %. „Spanne“ = kleinster bis größter Wert der fünf Seeds. Leere Felder (–): unter 30 Kämpfe, z. B. weil eine ★2-Einheit mehr kostet als das Budget. ¹ = Karte wirkt auch außerhalb des Kampfes; die Messung sieht nur den Kampfteil.

| Karte | Kosten | ★ | Basis (5 Seeds) | Spanne | Gleiche Zahl (5 Seeds) | Spanne | 6 Gold | 10 Gold | 15 Gold | bis 15 Einh. | nur ★1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Lehrling | 1 | 1 | 58 | 57–60 | **48** | 46–50 | 50 | 50 | 45 | 48 | 50 |
| Lehrling | 1 | 2 | 48 | 44–51 | **39** ▼ | 36–42 | 32 | 39 | 46 | 39 |  |
| Totengräber | 1 | 1 | 56 | 55–57 | **47** | 46–48 | 47 | 49 | 43 | 48 | 48 |
| Totengräber | 1 | 2 | 47 | 47–49 | **37** ▼ | 35–39 | 38 | 39 | 41 | 40 |  |
| Taschendieb | 1 | 1 | 55 | 53–57 | **43** ▼ | 42–43 | 43 | 46 | 42 | 44 | 44 |
| Taschendieb | 1 | 2 | 49 | 48–51 | **41** ▼ | 38–44 | 40 | 39 | 41 | 39 |  |
| Rekrut | 1 | 1 | 61 | 59–63 | **51** | 49–52 | 54 | 50 | 49 | 51 | 52 |
| Rekrut | 1 | 2 | 62 | 59–64 | **57** ▲ | 53–61 | 61 | 57 | 53 | 56 |  |
| Schildknappe | 1 | 1 | 61 | 60–63 | **55** | 53–57 | 59 | 54 | 48 | 55 | 55 |
| Schildknappe | 1 | 2 | 59 | 56–61 | **53** | 49–55 | 48 | 51 | 54 | 53 |  |
| Goblin-Plänkler | 2 | 1 | 61 | 59–63 | **50** | 49–51 | 53 | 52 | 49 | 50 | 50 |
| Goblin-Plänkler | 2 | 2 | 42 | 38–48 | **43** ▼ | 40–46 | 43 | 42 | 41 | 41 |  |
| Söldner | 2 | 1 | 60 | 58–63 | **51** | 50–52 | 53 | 51 | 49 | 52 | 51 |
| Söldner | 2 | 2 | 40 | 38–41 | **46** | 43–47 | 40 | 42 | 50 | 42 |  |
| Funkenreiter | 2 | 1 | 53 | 51–55 | **43** ▼ | 42–44 | 40 | 40 | 41 | 43 | 42 |
| Funkenreiter | 2 | 2 | 30 | 27–34 | **29** ▼ | 27–31 | 9 | 30 | 38 | 32 |  |
| Bannerträger | 3 | 1 | 80 | 78–81 | **79** ▲ | 77–81 | 84 | 80 | 75 | 76 | 75 |
| Bannerträger | 3 | 2 | 52 | 48–56 | **64** ▲ | 59–70 | – | 56 | 68 | 68 |  |
| Hehler ¹ | 3 | 1 | 39 | 38–41 | **29** ▼ | 27–30 | 17 | 25 | 38 | 31 | 28 |
| Hehler ¹ | 3 | 2 | 11 | 8–16 | **11** ▼ | 8–16 | – | 7 | 16 | 14 |  |
| Waldläuferin | 3 | 1 | 62 | 60–62 | **57** ▲ | 56–59 | 62 | 57 | 58 | 57 | 54 |
| Waldläuferin | 3 | 2 | 38 | 34–42 | **54** | 51–57 | – | 59 | 50 | 53 |  |
| Schildwall-Veteran | 3 | 1 | 74 | 73–77 | **72** ▲ | 70–74 | 80 | 70 | 69 | 73 | 69 |
| Schildwall-Veteran | 3 | 2 | 56 | 50–61 | **72** ▲ | 70–77 | – | 83 | 70 | 72 |  |
| Kesselflicker | 3 | 1 | 55 | 54–57 | **49** | 47–51 | 41 | 49 | 53 | 51 | 46 |
| Kesselflicker | 3 | 2 | 17 | 15–20 | **25** ▼ | 22–30 | – | 15 | 29 | 26 |  |
| Ahnenpfahl | 4 | 1 | 52 | 48–53 | **46** | 44–49 | 20 | 48 | 63 | 50 | 50 |
| Ahnenpfahl | 4 | 2 | 8 | 2–12 | **13** ▼ | 11–16 | – | – | 14 | 9 |  |
| Klingentänzerin | 4 | 1 | 65 | 63–68 | **62** ▲ | 58–64 | 69 | 56 | 60 | 58 | 56 |
| Klingentänzerin | 4 | 2 | 39 | 30–48 | **65** ▲ | 56–75 | – | – | 67 | 74 |  |
| Fluchweber ¹ | 4 | 1 | 55 | 53–56 | **45** ▼ | 43–46 | 40 | 46 | 52 | 43 | 40 |
| Fluchweber ¹ | 4 | 2 | 22 | 18–27 | **32** ▼ | 24–42 | – | – | 31 | 23 |  |
| Runenschmied | 4 | 1 | 54 | 53–57 | **49** | 47–51 | 45 | 51 | 54 | 48 | 44 |
| Runenschmied | 4 | 2 | 20 | 17–26 | **29** ▼ | 19–35 | – | – | 30 | 38 |  |
| Donnerbüchse | 4 | 1 | 67 | 65–70 | **64** ▲ | 59–68 | 67 | 61 | 64 | 64 | 57 |
| Donnerbüchse | 4 | 2 | 36 | 29–39 | **61** ▲ | 56–69 | – | – | 56 | 60 |  |
| Kopfgeldjäger | 5 | 1 | 59 | 57–61 | **60** ▲ | 59–62 | 67 | 51 | 57 | 58 | 52 |
| Kopfgeldjäger | 5 | 2 | 19 | 15–24 | **77** ▲ | 74–79 | – | – | 70 | 82 |  |
| Meisterdieb ¹ | 5 | 1 | 51 | 46–55 | **50** | 47–52 | 50 | 45 | 52 | 50 | 41 |
| Meisterdieb ¹ | 5 | 2 | 14 | 9–23 | **51** | 41–63 | – | – | 62 | 39 |  |
| Mondpriesterin | 5 | 1 | 43 | 39–47 | **39** ▼ | 36–41 | 30 | 40 | 47 | 35 | 32 |
| Mondpriesterin | 5 | 2 | 3 | 1–5 | **15** ▼ | 5–20 | – | – | 10 | 14 |  |
| Seelenhirte | 5 | 1 | 59 | 56–61 | **61** ▲ | 58–64 | 66 | 57 | 58 | 61 | 49 |
| Seelenhirte | 5 | 2 | 20 | 11–25 | **64** ▲ | 53–75 | – | – | 59 | 61 |  |
| Erzmagier | 6 | 1 | 56 | 53–58 | **63** ▲ | 60–66 | 72 | 63 | 64 | 62 | 43 |
| Erzmagier | 6 | 2 | – | – | **–** | – | – | – | – | – |  |
| Champion der Arena | 6 | 1 | 83 | 82–86 | **85** ▲ | 83–88 | 92 | 88 | 83 | 87 | 71 |
| Champion der Arena | 6 | 2 | – | – | **–** | – | – | – | – | – |  |

### Beobachtungen

- **Basis gegen gleiche Zahl:** Billige ★1-Karten (Lehrling, Totengräber, Taschendieb, Rekrut, Plänkler, Söldner) fallen um 6–12 Punkte, sobald die Einheitenzahl gleich ist; teure ★2-Einheiten steigen stark (Kopfgeldjäger ★2 von 19 auf 77 %). Die Basis-Messung ist für Kartenwerte also wenig aussagekräftig.
- **Stabil in jeder Messart zu stark:** Champion der Arena, Bannerträger, Schildwall-Veteran (in keinem Lauf unter 69 %).
- **Stabil zu schwach:** Mondpriesterin, Funkenreiter, Taschendieb, Hehler; ★2 von Lehrling, Totengräber, Taschendieb, Plänkler, Funkenreiter, Kesselflicker, Runenschmied, Ahnenpfahl, Mondpriesterin.
- **Budget:** Teure Karten hängen stark vom Budget ab (Ahnenpfahl 20/48/63 %, Mondpriesterin 30/40/47 % bei 6/10/15 Gold): Bei 6 Gold bleibt neben ihnen kaum Platz. Die Mischung 6/10/15 bleibt deshalb sinnvoll.
- **Obergrenze von 5 Einheiten:** Mit bis zu 15 Einheiten ändern sich die Werte bei gleicher Einheitenzahl für ★1-Karten meist um weniger als 5 Punkte, für teure ★2-Einheiten (wenige Kämpfe) um bis zu 12 Punkte in beide Richtungen. ★2-Armeen werden durch die Obergrenze nicht benachteiligt; in der Basis-Messung verlieren sie, weil sie weniger Einheiten haben.
- **Aufstellung:** In einer einmaligen Gegenprobe (12 000 Kämpfe, Fernkämpfer hinten und Nahkämpfer vorn gegen zufällige Aufstellung) gewann die geordnete Aufstellung nur 51 %. Die zufällige Aufstellung verfälscht die Messung kaum.
- **Streuung:** Bei ★1-Karten liegen die fünf Seeds meist innerhalb von ±3 Punkten, bei teuren ★2-Einheiten (wenige Kämpfe) bis ±10. Für B0c reichen 5 Seeds × 3000 Paarungen; bei teuren ★2-Einheiten sind Ergebnisse nahe der Grenze unsicher.
- **Ahnenpfahl ★2** ist strukturell schwach: Sein Angriff ist 0, und sein Buff (Zahl der Rassen) wächst nach R-15.2 nicht mit dem Stern. Ohne Resonanz und gemischte Rassen misst die Kalibrierung zudem nur einen Teil seines Werts.

## Zweikampf ★2 gegen ★1 mit dreifachen Kosten

Ein Zweikampf zweier einzelner Einheiten ist fast vorherbestimmt: Je Paarung kommt fast immer 0 % oder 100 % heraus, die Aufstellung ändert wenig. Aussagekräftig ist nur der **Durchschnitt über alle Gegner einer Kostenstufe**. Für Karten mit 3 Gold oder mehr gibt es keine ★1-Karte mit 9, 12, 15 oder 18 Gold; das Werkzeug füllt dann mit weiteren ★1-Einheiten auf, und die ★2-Einheit kämpft allein gegen bis zu fünf Gegner. Das prüft B-1 nicht sinnvoll (Ergebnis 0–3 %).

| Kosten der ★2-Karte | Gegner | Ø Siegquote ★2 (Faktor 1,8) | Faktor 2,0 | Faktor 2,4 | Faktor 2,7 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 Gold (×3 = 3) | alle ★1-Karten mit 3 Gold | 39 % | 63 % | 81 % | 85 % |
| 2 Gold (×3 = 6) | Erzmagier, Champion der Arena | 2 % | 25 % | 25 % | 50 % |

(Faktor-Spalten: Gegenprobe mit geändertem Sternfaktor nur im Speicher, Seed 1; Ziel 50–65 %.) Die 2-Gold-Karten verlieren vor allem, weil Champion und Erzmagier selbst zu stark sind (85 bzw. 63 %). Werden die beiden schwächer, steigt diese Zeile mit.

Einzelne Paarungen (Faktor 1,8, Durchschnitt der 5 Basis-Seeds):

| ★2-Einheit | Kosten ×3 | Gegner | Siegquote ★2 (Ø 5 Seeds) |
| --- | ---: | --- | ---: |
| Lehrling | 3 | Bannerträger | 0 |
| Lehrling | 3 | Hehler | 100 |
| Lehrling | 3 | Waldläuferin | 0 |
| Lehrling | 3 | Schildwall-Veteran | 0 |
| Lehrling | 3 | Kesselflicker | 72 |
| Totengräber | 3 | Bannerträger | 0 |
| Totengräber | 3 | Hehler | 100 |
| Totengräber | 3 | Waldläuferin | 0 |
| Totengräber | 3 | Schildwall-Veteran | 0 |
| Totengräber | 3 | Kesselflicker | 45 |
| Taschendieb | 3 | Bannerträger | 0 |
| Taschendieb | 3 | Hehler | 100 |
| Taschendieb | 3 | Waldläuferin | 51 |
| Taschendieb | 3 | Schildwall-Veteran | 0 |
| Taschendieb | 3 | Kesselflicker | 0 |
| Rekrut | 3 | Bannerträger | 48 |
| Rekrut | 3 | Hehler | 100 |
| Rekrut | 3 | Waldläuferin | 46 |
| Rekrut | 3 | Schildwall-Veteran | 0 |
| Rekrut | 3 | Kesselflicker | 100 |
| Schildknappe | 3 | Bannerträger | 0 |
| Schildknappe | 3 | Hehler | 100 |
| Schildknappe | 3 | Waldläuferin | 3 |
| Schildknappe | 3 | Schildwall-Veteran | 0 |
| Schildknappe | 3 | Kesselflicker | 100 |
| Goblin-Plänkler | 6 | Erzmagier | 3 |
| Goblin-Plänkler | 6 | Champion der Arena | 0 |
| Söldner | 6 | Erzmagier | 5 |
| Söldner | 6 | Champion der Arena | 0 |
| Funkenreiter | 6 | Erzmagier | 0 |
| Funkenreiter | 6 | Champion der Arena | 0 |

Bei gleicher Einheitenzahl liegt der Durchschnitt aller ★2-Einheiten mit Faktor 1,8 bei 45 % (★1: 54 %), mit 2,0 bei 49 % (★1: 51 %), mit 2,4 bei 50 %.

## Vorschläge für B0c (noch nicht umgesetzt)

Alle Änderungen liegen innerhalb von ±50 % und betreffen nur Angriff, Leben, Durchbruch, Effektzahlen oder [TUNING]-Werte. Reihenfolge: erst der Sternfaktor, dann die Ausreißer, nach jedem Schritt neu messen.

| Nr. | Änderung | Grund (gleiche Zahl) |
| --- | --- | --- |
| V1 | Sternfaktor ★2 1,8 → **2,0** (R-15.2, [TUNING]) | ★2 billiger Karten 37–43 %, Zweikampf 1 Gold 39 % → 63 % |
| V2 | Champion der Arena: Leben 12 → 9, Angriff 6 → 5 | 85 % |
| V3 | Bannerträger: Leben 6 → 4 (der Buff +1 lässt sich nicht kleiner machen) | 79 % |
| V4 | Schildwall-Veteran: Leben 8 → 6 | 72 % |
| V5 | Donnerbüchse: Schaden 3 → 2 oder Leben 5 → 4; Erzmagier: Schaden 6 → 5; Klingentänzerin: Angriff 4 → 3; Seelenhirte und Kopfgeldjäger: Leben −1 | 60–64 %, nach V2–V4 neu prüfen |
| V6 | Funkenreiter: Leben 2 → 3; Taschendieb: Leben 2 → 3 | 43 % |
| V7 | Mondpriesterin: Angriff 2 → 3 und Schild 6 → 9 | 39 %; Schild und Leben allein reichten in der Gegenprobe nicht |
| V8 | Hehler und Fluchweber als begründete Ausnahme führen (Wert liegt außerhalb des Kampfes); Ahnenpfahl ★2 als Ausnahme oder Frage an Jan | siehe oben |

**Gegenprobe** (nur im Speicher, gleiche Zahl, Seeds 1–3): V1 bis V4 zusammen mit Mondpriesterin Leben 8/Schild 9, Funkenreiter Leben 3, Fluchweber Angriff 3 und Meisterdieb Leben 7 senkten Champion auf 67 %, Bannerträger auf 67 % und Veteran auf 58 %, hoben Funkenreiter ★2 von 28 auf 51 %. Zugleich wurde der Meisterdieb zu stark (62 %, ★2 84 %), und der Zweikampf 1 Gold stieg auf 78 %, weil seine Gegner (Bannerträger, Veteran) schwächer wurden. Die Werte beeinflussen sich also gegenseitig; B0c sollte in kleinen Schritten vorgehen und nach jedem Schritt neu messen.

## Offene Fragen (in `docs/FRAGEN_AN_JAN.md`)

- **F62:** Welche Messung gilt für das Ziel 45–55 %? Standard: gleiche Einheitenzahl (`--same-count`).
- **F63:** Wie wird B-1 für ★2-Karten ab 3 Gold geprüft? Standard: Zweikampf nur für 1 und 2 Gold (Durchschnitt über alle Gegner der Kostenstufe); ab 3 Gold gilt das Ziel 45–55 % der ★2-Einheit bei gleicher Einheitenzahl.

## B0c1: Sternfaktor ★2 = 2,0 (umgesetzt am 2026-11-27)

Änderung V1: `starMultiplier["2"]` in `packages/engine/data/config.json` von 1,8 auf 2,0 ([TUNING], +11 %). Sonst keine Datenänderung.

Messung: `npm run calibrate -- --battles 3000 --budget 6,10,15 --seed S --same-count` für S = 1–5, zusammengefasst (Unentschieden halb gezählt). „Vorher“ ist dieselbe Messung mit Faktor 1,8.

| Kennzahl | Vorher (1,8) | Nachher (2,0) | Ziel |
| --- | ---: | ---: | --- |
| alle ★1-Einheiten | 52.1 % | 49.5 % | 45–55 % |
| alle ★2-Einheiten | 43.7 % | 51.6 % | 45–55 % |
| Zweikampf ★2 (1 Gold) gegen ★1 mit 3 Gold | 38.5 % | 62.5 % | 50–65 % |
| Zweikampf ★2 (2 Gold) gegen ★1 mit 6 Gold | 1.2 % | 24.2 % | 50–65 % |

| Karte | Kosten | ★ | Kämpfe (nachher) | Vorher | Nachher | Bewertung nachher |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Lehrling | 1 | 1 | 10806 | 48.0 % | 47.9 % | ok |
| Lehrling | 1 | 2 | 4490 | 39.3 % | 53.5 % | ok |
| Totengräber | 1 | 1 | 10760 | 47.5 % | 46.9 % | ok |
| Totengräber | 1 | 2 | 4576 | 36.9 % | 50.8 % | ok |
| Taschendieb | 1 | 1 | 10868 | 42.5 % | 41.6 % | zu schwach |
| Taschendieb | 1 | 2 | 4470 | 40.6 % | 51.8 % | ok |
| Rekrut | 1 | 1 | 10714 | 50.9 % | 51.1 % | ok |
| Rekrut | 1 | 2 | 4408 | 56.5 % | 64.2 % | zu stark |
| Schildknappe | 1 | 1 | 10746 | 54.8 % | 54.3 % | ok |
| Schildknappe | 1 | 2 | 4282 | 52.7 % | 65.5 % | zu stark |
| Goblin-Plänkler | 2 | 1 | 7476 | 50.4 % | 48.4 % | ok |
| Goblin-Plänkler | 2 | 2 | 3164 | 43.4 % | 48.5 % | ok |
| Söldner | 2 | 1 | 7362 | 51.0 % | 49.2 % | ok |
| Söldner | 2 | 2 | 3188 | 45.8 % | 49.8 % | ok |
| Funkenreiter | 2 | 1 | 7442 | 42.7 % | 40.0 % | zu schwach |
| Funkenreiter | 2 | 2 | 3168 | 28.9 % | 35.3 % | zu schwach |
| Bannerträger | 3 | 1 | 4448 | 78.6 % | 75.4 % | zu stark |
| Bannerträger | 3 | 2 | 1644 | 63.8 % | 69.0 % | zu stark |
| Hehler | 3 | 1 | 4390 | 28.7 % | 27.8 % | zu schwach |
| Hehler | 3 | 2 | 1538 | 11.4 % | 11.1 % | zu schwach |
| Waldläuferin | 3 | 1 | 4354 | 57.1 % | 54.3 % | ok |
| Waldläuferin | 3 | 2 | 1622 | 53.9 % | 58.6 % | zu stark |
| Schildwall-Veteran | 3 | 1 | 4488 | 71.9 % | 69.8 % | zu stark |
| Schildwall-Veteran | 3 | 2 | 1430 | 72.2 % | 79.2 % | zu stark |
| Kesselflicker | 3 | 1 | 4496 | 49.0 % | 46.0 % | ok |
| Kesselflicker | 3 | 2 | 1470 | 24.8 % | 29.5 % | zu schwach |
| Ahnenpfahl | 4 | 1 | 3940 | 46.2 % | 43.4 % | zu schwach |
| Ahnenpfahl | 4 | 2 | 578 | 13.5 % | 8.1 % | zu schwach |
| Klingentänzerin | 4 | 1 | 3812 | 61.9 % | 55.8 % | zu stark |
| Klingentänzerin | 4 | 2 | 576 | 65.3 % | 64.1 % | zu stark |
| Fluchweber | 4 | 1 | 3940 | 44.7 % | 40.5 % | zu schwach |
| Fluchweber | 4 | 2 | 552 | 32.4 % | 34.2 % | zu schwach |
| Runenschmied | 4 | 1 | 4018 | 48.9 % | 44.6 % | zu schwach |
| Runenschmied | 4 | 2 | 668 | 29.0 % | 33.7 % | zu schwach |
| Donnerbüchse | 4 | 1 | 4034 | 63.8 % | 58.7 % | zu stark |
| Donnerbüchse | 4 | 2 | 582 | 61.3 % | 59.8 % | zu stark |
| Kopfgeldjäger | 5 | 1 | 3394 | 60.3 % | 53.7 % | ok |
| Kopfgeldjäger | 5 | 2 | 404 | 77.0 % | 77.0 % | zu stark |
| Meisterdieb | 5 | 1 | 3416 | 49.5 % | 42.8 % | zu schwach |
| Meisterdieb | 5 | 2 | 388 | 50.5 % | 50.5 % | ok |
| Mondpriesterin | 5 | 1 | 3518 | 38.9 % | 33.4 % | zu schwach |
| Mondpriesterin | 5 | 2 | 468 | 15.0 % | 15.0 % | zu schwach |
| Seelenhirte | 5 | 1 | 3562 | 60.9 % | 53.2 % | ok |
| Seelenhirte | 5 | 2 | 388 | 63.7 % | 63.7 % | zu stark |
| Erzmagier | 6 | 1 | 2974 | 62.7 % | 49.7 % | ok |
| Champion der Arena | 6 | 1 | 3048 | 85.4 % | 82.2 % | zu stark |

Beobachtungen:

- Das Ziel von V1 ist erreicht: ★2-Einheiten liegen im Mittel im Zielbereich, der Zweikampf bei 1 Gold ebenfalls (B-1). Lehrling, Totengräber, Taschendieb, Goblin-Plänkler und Söldner sind als ★2 jetzt im Zielbereich.
- **Neu zu stark als ★2:** Rekrut (64 %), Schildknappe (66 %), Waldläuferin (59 %); schon vorher zu stark und jetzt stärker: Schildwall-Veteran ★2 (79 %), Bannerträger ★2 (69 %). Kandidaten für B0c2/B0c3.
- Mehrere ★1-Karten sanken, weil ihre ★2-Gegner stärker wurden: Erzmagier 63 → 50 % (jetzt im Ziel), Kopfgeldjäger und Seelenhirte ★1 jetzt im Ziel, Meisterdieb ★1 50 → 43 %, Runenschmied und Ahnenpfahl ★1 knapp unter 45 %.
- Weiter klar zu stark: Champion der Arena (82 %), Bannerträger (75 %), Schildwall-Veteran (70 %) – nächster Schritt B0c2 (V2–V4).
- Weiter klar zu schwach: Mondpriesterin (33 %), Funkenreiter (40 %), Taschendieb ★1 (42 %), Kesselflicker ★2 (30 %) – B0c4.
- Zweikampf 2 Gold bleibt weit unter dem Ziel, weil die Gegner Champion und Erzmagier stark sind; nach B0c2 neu prüfen.
- Werte von ★2-Karten mit 5 Gold sind bei beiden Faktoren gleich, weil sie nur im Budget 15 als einzelne Einheit gegeneinander antreten (gleiche Paarungen, ähnlicher Ausgang); diese Zeilen sind wenig aussagekräftig.
