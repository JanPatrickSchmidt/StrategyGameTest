# Regel-Spezifikation: Prototyp

Stand: 2026-10-28 · Version 0.1

Diese Spezifikation ist die **verbindliche Quelle** für die Regel-Engine des Prototyps. Sie präzisiert das Design-Dokument („Strategiespiel – Design-Dokument“, Tab „Mini-Set Prototyp“) so weit, dass sie ohne Rückfragen programmiert werden kann. Wo sie vom Design-Dokument abweicht, gilt diese Spezifikation für den Prototyp.

Regeln haben Kennungen (`R-3.2`). Tests sollen die Kennung der Regel nennen, die sie prüfen.

Alle Zahlen sind Startwerte und stehen zusätzlich in `packages/engine/data/config.json`. Die Engine liest Zahlen **nur** aus den Datendateien, nie als feste Werte im Code.

Werte, die mit **[TUNING]** markiert sind, dürfen Agenten innerhalb von ±50 % verändern, wenn Simulationen das nahelegen. Alles andere ist eine Regel und wird nur durch Jan geändert (siehe `CLAUDE.md`, Entscheidungsregeln).

---

## R-1 Grundbegriffe

- **R-1.1 Spieler:** genau 4, Index 0–3.
- **R-1.2 Karte:** ein Eintrag in den Kartendaten (Typ: `resource`, `unit`, `spell`, `curse`). Eine **Karteninstanz** ist ein einzelnes Exemplar mit eigener ID.
- **R-1.3 Einheit:** eine Einheiteninstanz auf dem Brett oder in der Reserve. Sie entsteht, wenn eine Einheitenkarte ausgespielt wird, und verweist auf ihre Karteninstanz(en).
- **R-1.4 Token:** eine Einheit ohne Karte (z. B. Geist, 1/1-Goblin). Tokens verschwinden am Ende des Kampfes, in dem sie entstanden sind, sofern nicht anders angegeben.
- **R-1.5 Anführer:** besondere Einheit jedes Spielers, nicht im Deck, immer vorhanden.
- **R-1.6 Zonen eines Spielers:** `left` (Front links), `right` (Front rechts), `center` (Mitte), `reserve` (Reserve).
- **R-1.7 Prioritätsreihenfolge:** In Runde `r` (beginnend bei 1) ist die Reihenfolge der Spieler `(r-1) mod 4, …` aufsteigend zyklisch. Alle Gleichstände zwischen Spielern, die nicht anders geregelt sind, werden nach dieser Reihenfolge aufgelöst.
- **R-1.9 Auslegung:** Wo eine Regel offen lässt, wann oder wohin ein Effekt wirkt, wird er so früh wie möglich und zugunsten des betroffenen Spielers abgehandelt.
- **R-1.8 Zufall:** Jeder Zufall stammt aus einem einzigen, mit einem Seed initialisierten Zufallsgenerator der Partie. Gleiche Seeds und gleiche Eingaben ergeben exakt dieselbe Partie.

## R-2 Sitzordnung und Nachbarn

- **R-2.1** Die Spieler sitzen im Ring 0 → 1 → 2 → 3 → 0 (im Uhrzeigersinn: 0 oben links, 1 oben rechts, 2 unten rechts, 3 unten links).
- **R-2.2** Für den aktiven Ring (nur nicht ausgeschiedene Spieler, in Ringreihenfolge) gilt: Der **rechte Nachbar** von Spieler `p` ist der nächste Spieler im Ring, der **linke Nachbar** der vorherige.
- **R-2.3** Die Zone `right` von `p` kämpft gegen die Zone `left` des rechten Nachbarn. Jede Front-Paarung ist also genau ein Kampf.
- **R-2.4** Bei 3 Spielern bleibt R-2.2 unverändert (jeder hat zwei verschiedene Nachbarn).
- **R-2.5** Bei 2 Spielern ist der andere Spieler sowohl linker als auch rechter Nachbar. Es gibt zwei getrennte Frontkämpfe: `p.right` gegen `q.left` und `q.right` gegen `p.left`.

## R-3 Arenen und Felder

Alle Arenen sind Hexfelder in **versetzten Koordinaten** (Spalte `col`, Zeile `row`, „odd-r“: ungerade Zeilen sind um eine halbe Zelle nach rechts versetzt). Abstand = Hex-Abstand über Würfelkoordinaten.

- **R-3.1 Frontzone:** 5 Spalten × 3 Zeilen pro Spieler (`row` 0 = am weitesten von der Front entfernt, `row` 2 = direkt an der Front).
- **R-3.2 Frontarena:** Für einen Frontkampf werden zwei Frontzonen zu einer Arena von 5 × 6 Feldern zusammengesetzt. Die Zone des ersten Spielers (laut R-2.3 die `right`-Zone) belegt die Arena-Zeilen 0–2 unverändert, die Zone des Gegners wird um 180° gedreht und belegt die Zeilen 3–5 (`arenaRow = 5 - row`, `arenaCol = 4 - col`).
- **R-3.3 Mittelzone:** Jeder Spieler hat einen Startbereich von 5 Feldern in der Mittelarena.
- **R-3.4 Mittelarena:** 7 × 7 Felder. Startbereiche: Spieler-Sitz 0 = Zeile 0, Spalten 1–5; Sitz 1 = Spalte 6, Zeilen 1–5; Sitz 2 = Zeile 6, Spalten 1–5; Sitz 3 = Spalte 0, Zeilen 1–5. Der Spieler wählt in seiner Mittelzone eine Position 0–4, die auf diese Felder abgebildet wird. Die Sitze bleiben fest, auch wenn Spieler ausscheiden.
- **R-3.5 Reserve:** 3 Plätze ohne Koordinaten [TUNING, bewusst klein halten, damit die Oberfläche nicht überladen wird]. Einheiten in der Reserve kämpfen nicht. Einheiten dürfen direkt in die Reserve ausgespielt werden (R-7.1).
- **R-3.6 Kapazität:** In `left`, `right` und `center` zusammen dürfen höchstens **5** Einheiten stehen [TUNING], der Anführer zählt nicht mit. +1 Platz bei Anführer-Stufe 2 und nochmals +1 bei Stufe 4. Tokens zählen nicht gegen die Kapazität.
- **R-3.8 Benennung in der Oberfläche:** Felder werden für Spieler schachähnlich benannt: Spalte als Buchstabe (a, b, c …), Zeile als Zahl (1, 2, 3 …), jeweils aus Sicht des Spielers. Intern bleiben die Koordinaten aus R-3.1 bis R-3.4.
- **R-3.7 Persistenz:** Einheiten bleiben von Runde zu Runde auf ihrem Feld, bis der Spieler sie bewegt oder sie das Brett verlassen.

## R-4 Partie-Aufbau

- **R-4.1** Jeder Spieler wählt einen Anführer (im Prototyp: Spieler `p` bekommt per Konfiguration einen der vier Anführer; Standard: jeder Anführer genau einmal).
- **R-4.2 Startdeck:** 6× Münze, 2× Rekrut, 2× der Klassen-Starter der Anführer-Klasse. Gemischt mit dem Partie-Zufall.
- **R-4.3** Leben 30, Machtpunkte 0, Schatzkammer 0, Anführer-XP 0, Anführer-Stufe 1.
- **R-4.4 Anführer-Startposition:** Zone `left`, Feld (2, 1).
- **R-4.6 Starthand:** Nach dem Mischen zieht jeder Spieler 5 Karten.
- **R-4.5 Königreich:** alle Basisstapel und alle 16 Königreich-Karten mit Stapelgrößen laut Daten. Jeder Spieler hat zusätzlich Zugriff auf die 3 Karten seines Klassen-Pools (eigene Stapel je Spieler).

## R-5 Rundenablauf

Struktur nach Jans Vorgabe (2026-10-28). Die Schritte 1–4 bilden den **Planungsblock**: Alle Spieler planen gleichzeitig und verdeckt, es gibt pro Runde **nur einen Wartepunkt**. In der Oberfläche sind es getrennte Schritte; bis zum Bestätigen darf der Spieler zwischen ihnen hin- und herwechseln, die Engine verarbeitet nur die endgültige Eingabe.

1. **Rundenbeginn und Anführer-Aufstieg (R-6)**
2. **Ausspielen (R-7)** – Karten von der Hand: Einheiten aufs Feld, Zauber in die Slots
3. **Kaufen (R-11)** – gekaufte Karten kommen auf den Ablagestapel
4. **Aufstellen (R-7b)** – Einheiten positionieren, Anführer-Fähigkeit wählen
5. **Aufdecken (R-8.1)**, dabei gleichzeitige Auswertung der Käufe (R-11.3)
6. **Anführer-Fähigkeiten (R-8.2)**
7. **Vorkampf-Zauber (R-8.3)**
8. **Kampf (R-9)** – alle Frontkämpfe und der Mittelkampf, unabhängig voneinander
9. **Kampfauswertung (R-10)** – Schaden, Mitte, XP, Beute
10. **Nachkampf-Zauber (R-8.4)**
11. **Rundenende (R-12)** – Ablegen, Gold in die Schatzkammer, Mischen und Nachziehen auf 5
12. **Siegprüfung (R-13)**

Ein Spieler reicht pro Runde genau **eine** Planung ein, mit drei Abschnitten (`play`, `buy`, `position`) sowie Astwahl und Anführer-Fähigkeit.

## R-6 Rundenbeginn und Anführer-Aufstieg

- **R-6.1 Zinsen:** Spieler erhalten `min(2, floor(Schatzkammer / 5))` Gold [TUNING] in die Schatzkammer. Die Schatzkammer selbst hat keine Obergrenze (R-11.5). Vorher werden Resonanz-Gold (R-17.4) und Effekte „pro Runde“ (R-17a.1) abgehandelt.
- **R-6.2 Rundengold:** Jeder Spieler hat einen Gold-Vorrat für die Runde, der bei 0 beginnt. Gold verfällt nie: Was am Ende einer Runde übrig ist, geht in die Schatzkammer (R-12.5).
- **R-6.3 Hand:** Die Hand wurde am Ende der Vorrunde gezogen (R-12.6); in Runde 1 beim Partie-Aufbau (R-4.6).
- **R-6.4 Ressourcen:** Alle Ressourcenkarten auf der Hand werden zu Beginn des Ausspielens automatisch ausgespielt; ihr Gold geht in den Rundenvorrat. Sie gehen beim Rundenende auf den Ablagestapel.
- **R-6.5 Genesung durch Reserve:** Verwundete Einheiten, die die gesamte Vorrunde in der Reserve verbracht haben, sind nicht mehr verwundet.
- **R-6.6 Anführer-Aufstieg:** Hat der Anführer in der Vorrunde genug XP für eine neue Stufe gesammelt (R-16.1), steigt er jetzt auf. Erreicht er Stufe 2, wählt der Spieler in dieser Planung seinen Ast (R-7.7).

## R-7 Ausspielen

Der Abschnitt `play` ist eine **geordnete Liste von Aktionen**. Die Engine führt sie der Reihe nach aus; eine ungültige Aktion wird übersprungen und als Ereignis `action_rejected` mit Grund gemeldet. Gold, das im Laufe der Liste fehlt, macht die betreffende Aktion ungültig.

Verfügbare Gold-Quellen: der Rundenvorrat und die Schatzkammer (Entnahme jederzeit, R-7.6).

- **R-7.1 Einheit ausspielen** `playUnit(cardInstanceId, zone, position)`: Karte muss auf der Hand sein, Kosten werden bezahlt (alternative Kosten R-14.6 möglich), Zielfeld frei, Kapazität (R-3.6) eingehalten. Die Karte verlässt die Hand und wird zur Einheit. Die Reserve ist ein gültiges Ziel.
- **R-7.3 Zauber legen** `setSpell(cardInstanceId, slot, target)`: `slot` ist `pre` oder `post`, je höchstens ein Zauber [TUNING: Slot-Anzahl]. Kosten werden sofort bezahlt. Das Ziel wird jetzt festgelegt (R-14.2).
- **R-7.5 Genesen** `heal(unitId)`: Kosten 1 Gold pro Stern, Einheit ist nicht mehr verwundet.
- **R-7.6 Entnahme** `withdraw(amount)`: verschiebt Gold aus der Schatzkammer in den Rundenvorrat. In jedem Abschnitt erlaubt.
- **R-7.7 Astwahl** `chooseBranch(branchId)`: nur wenn der Anführer Stufe 2 erreicht hat und noch keinen Ast gewählt hat. Ohne Wahl wird beim Aufdecken der erste Ast genommen.
- **R-7.8 Verschmelzen** findet nach jeder Aktion automatisch statt (R-15.1), also schon beim Ausspielen.
- **R-7.9** Wer keine Planung einreicht (Timeout), plant leere Abschnitte.
- **R-7.10** Nicht ausgespielte Karten bleiben bis zum Rundenende auf der Hand.

## R-7b Aufstellen

Der Abschnitt `position` wird **nach** den Abschnitten `play` und `buy` ausgeführt.

- **R-7.2 Einheit bewegen** `moveUnit(unitId, zone, position)`: kostenlos, Zielfeld frei, Kapazität eingehalten. Auch zwischen Zonen und von/in die Reserve. Gilt auch für den Anführer. (Später auch Geländeänderungen.)
- **R-7.4 Anführer-Fähigkeit wählen** `setLeaderAbility(target | none)`: höchstens einmal, kostenlos.

## R-8 Aufdecken, Anführer, Zauber

- **R-8.1 Aufdecken:** Alle Planungen werden gleichzeitig wirksam. Ab jetzt sind Brett, gelegte Zauber und gewählte Anführer-Fähigkeiten öffentlich.
- **R-8.2 Anführer-Fähigkeiten** lösen in Kategorien aus, in dieser Reihenfolge: `summon` und `move` → `buff` → `damage`. Innerhalb einer Kategorie gleichzeitig: Wollen zwei Effekte dasselbe freie Feld belegen, scheitern beide. Schaden innerhalb einer Kategorie wird erst berechnet, dann gleichzeitig angewendet.
- **R-8.3 Vorkampf-Zauber** lösen nach Tempo auf (1 vor 2 vor 3). Bei gleichem Tempo gilt die Prioritätsreihenfolge (R-1.7), jeder Zauber wird vollständig abgehandelt, bevor der nächste beginnt.
- **R-8.4 Nachkampf-Zauber** wie R-8.3, nach der Kampfauswertung.
- **R-8.5** Ein Zauber, dessen Zielfeld bei der Auflösung leer ist oder keine gültige Einheit enthält, verpufft (Ereignis `spell_fizzled`). Die Kosten sind trotzdem bezahlt.
- **R-8.6** Gelegte Zauber gehen nach der Auflösung auf den Ablagestapel.

## R-9 Kampf

Jeder Kampf ist eine eigene, deterministische Simulation in **Ticks**. Alle Kämpfe einer Runde nutzen denselben Ausgangszustand nach R-8 und beeinflussen sich nicht gegenseitig.

### R-9.0 Kampfbeginn
Vor Tick 1 werden alle Effekte „zu Kampfbeginn“ in aufsteigender Einheiten-ID abgehandelt (z. B. Kesselflicker, Ahnenpfahl, Sprung der Schurken R-9.4, Start-Mana).

### R-9.1 Teilnehmer
- Frontkampf: alle nicht verwundeten Einheiten der beiden beteiligten Zonen, inklusive Anführer, falls er dort steht.
- Mittelkampf: alle nicht verwundeten Einheiten aller Mittelzonen.
- Hat in einem Frontkampf nur eine Seite Einheiten, gewinnt sie ohne Simulation (leere Front, R-10.2). Haben beide keine, findet kein Kampf statt (Unentschieden ohne Schaden).
- Hat in der Mitte höchstens ein Spieler Einheiten, gewinnt dieser ohne Simulation; hat keiner Einheiten, gibt es keinen Halter.

### R-9.2 Einheitenwerte im Kampf
Aus Kartendaten plus Sternfaktor (R-15.2): `attack`, `hp`, `range` (1 = Nahkampf), `breakthrough`, `armor`, `attackInterval` (Standard 10 Ticks), `moveInterval` (Standard 6 Ticks), `manaMax` (Standard 100, nur bei Einheiten mit Mana-Fähigkeit), `startMana` (0, plus Boni).

### R-9.3 Tick-Ablauf
Ein Kampf läuft höchstens **300 Ticks** [TUNING]. In jedem Tick werden die lebenden Einheiten in fester Reihenfolge abgearbeitet: zuerst Einheiten mit `firstStrike`, dann alle anderen; innerhalb dieser Gruppen nach aufsteigender Einheiten-ID. Für jede Einheit:

1. Ist sie betäubt, wird der Betäubungszähler verringert, sonst nichts.
2. **Ziel bestimmen** (R-9.4), falls sie kein lebendes Ziel hat.
3. Ist das Mana voll und die Einheit hat eine Mana-Fähigkeit: Fähigkeit wirken, Mana auf 0, der Angriffs-Cooldown wird zurückgesetzt.
4. Sonst, falls das Ziel in Reichweite ist und der Angriffs-Cooldown 0 ist: **angreifen** (R-9.5), Cooldown = `attackInterval`.
5. Sonst, falls das Ziel nicht in Reichweite ist und der Bewegungs-Cooldown 0 ist: einen Schritt auf einem kürzesten Weg zum Ziel gehen (Breitensuche über freie Felder, bei mehreren Wegen das Feld mit der kleinsten `(row, col)`), Cooldown = `moveInterval`. Gibt es keinen Weg, bleibt sie stehen.
6. Cooldowns verringern sich am Ende des Ticks um 1 (nicht unter 0).

### R-9.4 Zielwahl
- Kandidaten: alle lebenden gegnerischen Einheiten in derselben Arena (in der Mitte: alle Einheiten anderer Spieler).
- Effektiver Abstand = Hex-Abstand; für Kandidaten der Klasse **Krieger** wird 1 abgezogen (sie ziehen Angriffe auf sich).
- Gewählt wird der Kandidat mit dem kleinsten effektiven Abstand, dann den wenigsten aktuellen Lebenspunkten, dann der kleinsten ID.
- Ein Ziel wird gewechselt, wenn es stirbt oder ein anderer Kandidat einen um mindestens 2 kleineren effektiven Abstand hat.
- **Schurken** springen in Tick 0 auf das freie Feld neben dem gegnerischen Ziel mit dem *größten* Abstand zu ihnen (Gleichstand: kleinste ID des Ziels, dann kleinstes Feld). Danach normal.

### R-9.5 Angriff und Schaden
- Schaden eines Angriffs = `attack`. Ziel: zuerst wird ein Schild verbraucht, dann `max(1, Schaden − armor)` von den Lebenspunkten abgezogen.
- Mana: Angreifer +10, getroffene Einheit +5 (nur Einheiten mit Mana-Fähigkeit).
- Fähigkeitsschaden wird ebenfalls durch Schild und Panzer reduziert, außer der Effekt sagt anderes.
- Eine Einheit mit Lebenspunkten ≤ 0 stirbt sofort (R-9.6).

### R-9.6 Tod im Kampf
- Ausgelöste Effekte „wenn diese Einheit stirbt“ werden sofort abgehandelt.
- Die Einheit verlässt die Kampfsimulation. Nach dem Kampf steht sie wieder auf ihrem Feld (Grundregel), außer sie wurde vernichtet oder verwundet (R-14.4, R-14.5).
- Tokens verschwinden endgültig.

### R-9.7 Kampfende
- Ein Kampf endet, sobald höchstens eine Seite (in der Mitte: höchstens ein Spieler) lebende Einheiten hat, oder nach 300 Ticks.
- Ergebnis Frontkampf: Sieger ist die Seite mit lebenden Einheiten. Leben nach Tick 300 noch beide oder keine: **Unentschieden**.
- Ergebnis Mitte: Halter ist der einzige Spieler mit lebenden Einheiten. Sonst kein Halter.

## R-10 Kampfauswertung

- **R-10.1 Durchbruch:** Der Verlierer eines Frontkampfs verliert Leben = Summe `breakthrough` aller überlebenden Einheiten des Siegers (Tokens zählen) + **Grundschaden**.
- **R-10.2 Leere Front:** Gewinnt eine Seite, weil die Gegenseite keine Einheiten hatte, gilt R-10.1 mit allen Einheiten des Siegers, und der Sieger erhält zusätzlich **2 Gold Beute** [TUNING].
- **R-10.3 Gold sofort in die Schatzkammer:** Beute, Mitte-Gold, Schwung/Trotz-Gold und alle Gold-Gewinne aus Effekten nach der Planung gehen **sofort in die Schatzkammer** (zählen also schon für die Zinsen der nächsten Runde). Gold-Gewinne während der Planung (z. B. Hehler, R-17a.1) gehen in den Rundenvorrat dieser Runde.
- **R-10.4 Mitte:** Der Halter erhöht seine Halteserie um 1, alle anderen setzen ihre auf 0. Belohnung nach Länge der Serie: 1 → +2 Gold (R-10.3); 2 → +2 Gold und +1 Karte beim Nachziehen am Rundenende (R-12.6); ≥ 3 → +2 Gold, +1 Karte und sofort +1 Machtpunkt [TUNING].
- **R-10.5 Grundschaden** = `1 + max(0, Runde − 10)` [TUNING].
- **R-10.6 Schwung und Trotz:** Eine Runde gilt für einen Spieler als **gewonnen**, wenn er mehr Frontkämpfe gewonnen als verloren hat, als **verloren** bei umgekehrt, sonst neutral (die Serie bleibt unverändert). Serien zählen gewonnene bzw. verlorene Runden in Folge. Bonusgold (R-10.3): Serie 2 → +1, 3–4 → +2, ≥ 5 → +3 [TUNING], für Sieges- und Niederlagenserien gleich.
- **R-10.7 Einheiten-XP:** Jede Karten-Einheit, die einen Kampf überlebt hat, erhält +1 XP.
- **R-10.8 Anführer-XP:** +1, wenn der Anführer an einem Kampf teilgenommen und überlebt hat.

## R-11 Kaufen

- **R-11.1** Der Abschnitt `buy` ist eine Liste von Käufen. Er wird nach `play` ausgeführt; das Gold wird sofort abgezogen (zuerst Rundenvorrat, dann Schatzkammer), die Karten werden aber erst beim Aufdecken verteilt (R-11.3).
- **R-11.2 Kaufen** `buy(cardId)`: aus dem Königreich, den Basisstapeln oder dem eigenen Klassen-Pool. Die gekaufte Karte kommt auf den Ablagestapel. Keine Obergrenze für die Zahl der Käufe pro Runde; pro Stapel gilt das Limit aus R-11.3.
- **R-11.3 Gleichzeitige Käufe:** Alle Käufe werden beim Aufdecken gleichzeitig ausgewertet. Ein einzelner Spieler kann von einem Stapel höchstens so viele Kopien kaufen, wie der Stapel zu Beginn der Runde enthält. Wollen **mehrere** Spieler zusammen mehr Kopien, als der Stapel enthält, bekommen alle ihre (so begrenzten) Kopien; fehlende Kopien werden erzeugt und der Stapel geht auf 0.
- **R-11.4 Leerer Stapel:** Aus einem Stapel mit 0 Kopien kann nicht gekauft werden.
- **R-11.5 Schatzkammer:** Die Schatzkammer hat keine Obergrenze; begrenzt sind nur die Zinsen (R-6.1). **Gold verfällt nie** (R-12.5).

## R-12 Rundenende

- **R-12.1** Alle Karten auf der Hand und alle in dieser Runde ausgespielten Ressourcen gehen auf den Ablagestapel.
- **R-12.2** Tokens werden entfernt (falls noch vorhanden).
- **R-12.3** Anführer: +2 XP (der Aufstieg folgt zu Beginn der nächsten Runde, R-6.6).
- **R-12.4** Schilde und Kampf-Buffs verfallen.
- **R-12.5** Übriges Gold des Rundenvorrats geht automatisch in die Schatzkammer.
- **R-12.6 Nachziehen:** Jeder Spieler zieht 5 Karten [TUNING] (+1, falls die Mitte-Belohnung „Karte“ fällig ist). Enthält das Deck **weniger Karten, als zu ziehen sind**, werden vorher Deck und Ablagestapel zusammen gemischt und bilden das neue Deck. Reicht auch das nicht, werden alle vorhandenen Karten gezogen.

## R-13 Ausscheiden und Sieg

- **R-13.1** Spieler mit Leben ≤ 0 scheiden nach der Kampfauswertung aus. Ihre Einheiten verlassen das Spiel. Ihre Sitze bleiben leer (R-2.2 berechnet die Nachbarn neu).
- **R-13.2 Platzierung:** Wer später ausscheidet, ist besser platziert. Scheiden mehrere in derselben Runde aus, entscheidet zuerst das höhere Leben vor dem Schaden dieser Runde, dann mehr Machtpunkte, sonst teilen sie sich die Platzierung.
- **R-13.3 Machtsieg:** Erreicht ein Spieler **5 Machtpunkte** [TUNING], gewinnt er sofort am Ende der Kampfauswertung. Die anderen werden nach Leben platziert (Gleichstand: Machtpunkte, dann geteilt).
- **R-13.4 Letzter Spieler:** Ist nur noch ein Spieler übrig, gewinnt er.
- **R-13.5 Rundenlimit:** Nach Runde **30** [TUNING] endet die Partie; Platzierung nach Leben, dann Machtpunkten.

## R-14 Effekt-Grundlagen

- **R-14.1 Effekte** sind in den Kartendaten als Liste von Bausteinen beschrieben (`packages/engine/data/README.md`). Neue Karten nutzen bestehende Bausteine; neue Bausteine dürfen ergänzt werden, wenn eine Karte es erfordert.
- **R-14.2 Feldziel:** Zauber und Anführer-Fähigkeiten mit Ziel wählen `(arena, zone-owner, position)`: eine Arena, an der der Spieler teilnimmt (eigene linke Front, eigene rechte Front, Mitte), und ein Feld darin. Schadenseffekte mit Feldziel treffen **nur gegnerische Einheiten**.
- **R-14.3 Schild:** Absorbiert Schaden, bevor Lebenspunkte sinken. Mehrere Schilde addieren sich. Verfällt beim Aufräumen.
- **R-14.4 Verwunden:** Die Einheit nimmt an keinem Kampf teil, bis sie genesen ist (R-7.5 oder R-6.5). Verwundete Einheiten zählen gegen die Kapazität. Wird eine Einheit im Kampf von einem Effekt mit `wound` besiegt, ist sie nach dem Kampf verwundet.
- **R-14.5 Vernichten:** Die Einheit verlässt das Brett; ihre Karteninstanzen gehen auf den Ablagestapel. Ein vernichteter Anführer ist erst in der übernächsten Planung wieder verfügbar (Startfeld R-4.4 oder ein beliebiges freies Feld).
- **R-14.6 Alternative Kosten:** Karten mit `altCost` können stattdessen so bezahlt werden. `bloodToll(n)`: n Leben. `sacrifice(n)`: n eigene Karten-Einheiten (nicht Anführer, nicht Tokens) vom Brett auf den Ablagestapel.
- **R-14.7 Flüche:** Effekte mit `giveCurse` legen eine Fluch-Karte aus dem Fluch-Stapel auf den Ablagestapel des Ziels. Ist der Stapel leer, passiert nichts.
- **R-14.8 Läutern:** entfernt Karten dauerhaft aus dem Spiel. Gewählt werden bis zu `max` eigene Karteninstanzen aus **Deck oder Ablagestapel** (nicht von der Hand, nicht aus den in dieser Runde ausgespielten Karten). Die Wahl erfolgt in der Planung beim Legen des Zaubers; das Entfernen ändert die Reihenfolge der übrigen Deckkarten nicht. Gemischt wird nur beim Nachziehen (R-12.6).

## R-15 Verschmelzen und Sterne

- **R-15.1 Verschmelzen:** Besitzt ein Spieler drei Einheiten mit derselben Karten-ID und demselben Stern auf Brett und Reserve zusammen, werden sie sofort zu einer Einheit mit einem Stern mehr. Die neue Einheit steht auf dem Feld der Einheit mit der meisten XP (Gleichstand: kleinste ID). XP werden addiert. Verwundet ist sie nur, wenn alle drei verwundet waren. Die Karteninstanzen bleiben an der Einheit; wird sie vernichtet, gehen alle drei auf den Ablagestapel. Verschmelzen kann sich verketten (drei ★2 → ★3). Höchste Stufe ★3.
- **R-15.2 Sternfaktor:** ★1 = 1, ★2 = 1,8, ★3 = 3,2 [TUNING] für `attack`, `hp`, `breakthrough` und Schadens-/Schildzahlen der Fähigkeiten; jeweils abgerundet, mindestens der ★1-Wert.
- **R-15.3** Anführer und Tokens verschmelzen nicht.

## R-16 Anführer

- **R-16.1 Stufen:** Stufe 2 ab 4 XP, Stufe 3 ab 10 XP, Stufe 4 ab 18 XP [TUNING].
- **R-16.2 Ast:** Bei Stufe 2 wird ein Ast gewählt (R-7.7). Stufe 3 und 4 verstärken den gewählten Ast laut Daten.
- **R-16.3 Kampfeinheit:** Bei Stufe 3 steigen `attack` und `hp` der Kampfeinheit um 30 % (abgerundet) [TUNING].
- **R-16.4 Aktive Fähigkeit:** einmal pro Runde, unabhängig davon, wo die Kampfeinheit steht oder ob sie verwundet ist.
- **R-16.5** Die Kampfeinheit des Anführers verhält sich im Kampf wie jede Einheit ihrer Klasse.
- **R-16.6 Hinter feindliche Linien (Vex):** Fähigkeiten mit Ziel `participatingFreeHex` dürfen eigene Einheiten auf jedes freie Feld einer Arena setzen, an der der Spieler teilnimmt, **auch in die gegnerische Hälfte einer Frontarena** und überall in der Mittelarena. Die Einheit kämpft in dieser Runde in dieser Arena von diesem Feld aus. Nach dem Aufräumen kehrt sie auf ihr Ausgangsfeld zurück (ist es belegt: nächstes freies Feld derselben Zone, sonst Reserve).

## R-17 Rassen-Resonanz

- **R-17.1** Gezählt werden die verschiedenen Karten-IDs (nicht Kopien) einer Rasse unter den nicht verwundeten Einheiten in `left`, `right` und `center` zusammen, inklusive Anführer. Tokens zählen nicht.
- **R-17.2** Die Boni der Stufe 2 bzw. 4 laut Daten gelten in allen Kämpfen dieser Runde für alle Einheiten dieser Rasse des Spielers. Maßgeblich ist das Brett nach dem Aufdecken (R-8.1).
- **R-17.3** Kostenboni (z. B. Goblins ab 4) gelten beim Ausspielen nach dem Brett zum Zeitpunkt der Aktion; Kosten fallen nie unter 0.

- **R-17.4 Resonanzen mit Rundenwirkung:** Resonanz-Effekte mit `when: roundStart` (Zwerge: Gold) sowie `gainLeaderXp` (Menschen) werden einmal pro Runde beim Rundenbeginn ausgewertet, und zwar nach dem Brett am Ende der Vorrunde. Reihenfolge: Resonanz-Gold in die Schatzkammer → Zinsen (R-6.1). `bonusInterest` (Zwerge 4): zusätzlich `amount` Zinsen pro volle `perGold` Gold in der Schatzkammer.
- **R-17.5 Bonus-XP (Menschen):** Menschen-Einheiten erhalten zusätzlich zu R-10.7 die angegebene XP, wenn sie einen Kampf überleben.

## R-17a Zeitpunkte „pro Runde“

- **R-17a.1** Effekte „pro Runde“ oder „in der Reserve“ (z. B. Hehler) lösen beim Rundenbeginn nach R-6.1 aus.
- **R-17a.2** Effekte „nächste Runde“ (z. B. Funkenschmiede) werden als Markierung gespeichert und beim Rundenbeginn bzw. Kampfbeginn der nächsten Runde angewendet, danach gelöscht.

## R-18 Sichtbarkeit

- **R-18.1** Öffentlich: Brett, Leben, Machtpunkte, Schatzkammer, Deck- und Ablagestapel-Größe, Handgröße, Ablagestapel-Inhalt, Käufe, Stapelgrößen, Anführer, Stufe, Ast.
- **R-18.2** Privat: Handkarten, Deckreihenfolge, eigene Planung bis zum Aufdecken.
- **R-18.2a** Jeder Spieler kennt den Inhalt seines eigenen Decks ohne Reihenfolge (für Läutern, R-14.8).
- **R-18.3** Die Engine liefert für jeden Spieler eine eigene Sicht, in der fremde private Informationen fehlen.

## R-19 Ereignisprotokoll

- **R-19.1** Jede Zustandsänderung erzeugt ein Ereignis mit Typ, Runde, Phase, ggf. Tick, Arena und beteiligten IDs.
- **R-19.2** Das Protokoll ist die einzige Quelle für die Animation im Client.
- **R-19.3** Ereignisse, die private Informationen enthalten (z. B. gezogene Karten), werden pro Spieler gefiltert.
