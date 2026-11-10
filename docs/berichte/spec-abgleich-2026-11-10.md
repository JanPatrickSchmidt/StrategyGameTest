# Spec-Abgleich 2026-11-10 (E16b)

Abgleich der Regel-Spezifikation `docs/spec/regeln-prototyp.md` gegen alle Tests, Stand `827a17f` (nach E16a). Ziel laut Backlog: alle Regel-Kennungen ohne Test finden und die Lücken als Teilaufgaben E16c… eintragen. Produktivcode der Engine wurde nicht geändert.

## Vorgehen

Der Abgleich ist jetzt ein wiederholbares Werkzeug: `npm run check:spec` (Quellcode `tools/sim/src/specCoverage.ts`, eigene Tests „E16b: …“).

- **Regeln** sind die Kennungen, die die Spec *definiert*: Überschriften (`### R-9.4 Zielwahl`) und Aufzählungspunkte, die mit einer fetten Kennung beginnen (`- **R-7.5 …**`). Erwähnungen im Fließtext zählen nicht.
- Gezählt werden nur **Blätter**: R-9 hat Unterregeln R-9.0–R-9.7 und zählt deshalb nicht selbst; R-5 und R-7b haben keine Unterregeln und zählen. R-18.2 und R-18.2a sind getrennte Regeln.
- **Getestet** heißt: die Kennung steht vollständig im Namen eines `it`/`test` oder eines umschließenden `describe` (R-9.1 ist nicht R-9.10). Eine Erwähnung nur im Kommentar oder im Code zählt nicht, wird aber als Hinweis ausgegeben.
- Kennungen in Testnamen, die die Spec nicht kennt, würden als „unbekannt“ gemeldet (Tippfehler, veraltete Kennungen): **keine gefunden**.

Prüfläufe vorher: `npm ci`, `npm test` (46 Dateien, 800 Tests grün), `npm run typecheck` grün. Keine `it.skip`, `it.only`, `it.todo` und kein `expect(true)` in den Tests.

## Ergebnis

**115 Regeln, 106 mit mindestens einem Test, 9 ohne Test.**

| Regel | Inhalt | Einschätzung | Aufgabe |
| --- | --- | --- | --- |
| R-3.7 Persistenz | Einheiten bleiben von Runde zu Runde auf ihrem Feld | Nur als Kommentar in einem Test von `board.test.ts` (prüft dort bloß die Anzahl der Einheiten, nicht das Feld über mehrere Runden). Lücke. | E16c1 |
| R-7.10 | Nicht ausgespielte Karten bleiben bis zum Rundenende auf der Hand | Nur als Kommentar in `board.test.ts`; geprüft wird dort nur das Ablegen am Rundenende, nicht, dass die Karte bis dahin auf der Hand bleibt. Lücke. | E16c1 |
| R-1.3 Einheit | Einheit verweist auf ihre Karteninstanz(en) | Begriffsbestimmung, indirekt in vielen Tests benutzt (Verschmelzen, Ablegen). Kleiner Test mit Kennung sinnvoll. | E16c1 |
| R-1.5 Anführer | nicht im Deck, immer vorhanden | wie oben; die Startposition (R-4.4) ist getestet, „nicht im Deck“ nicht ausdrücklich | E16c1 |
| R-1.6 Zonen | `left`, `right`, `center`, `reserve` | Begriffsbestimmung, indirekt abgedeckt | E16c1 |
| R-2.1 Sitzordnung | Ring 0 → 1 → 2 → 3 → 0 | indirekt über R-2.2/R-2.3 abgedeckt; ein Test für die Ringfolge der vier Sitze fehlt | E16c1 |
| R-14.5 Vernichten | Einheit verlässt das Brett, Karten auf den Ablagestapel, Anführer erst in der übernächsten Planung wieder verfügbar | **In der Engine nicht umgesetzt.** Kein Datenbaustein vernichtet Einheiten, deshalb im Spiel derzeit nicht erreichbar (Opfer R-14.6 sind umgesetzt und getestet). Für die Abnahme von M2 als Baustein umsetzen, damit spätere Karten ihn nutzen können. | E16c2 |
| R-3.8 Benennung in der Oberfläche | schachähnliche Feldnamen aus Sicht des Spielers | gehört zum Client, noch nicht fällig | Hinweis bei C3 |
| R-19.2 | Protokoll ist die einzige Quelle für die Animation im Client | Architekturregel für den Client, in der Engine nicht prüfbar | Hinweis bei C4 |

## Dünn abgedeckt (Hinweis, keine Lücke)

Diese Regeln haben einen Test mit Kennung, der Test deckt aber nur einen kleinen Teil der Regel ab:

- **R-19.1** „Jede Zustandsänderung erzeugt ein Ereignis“: nur zwei Tests, beide zum Zurücksetzen der Anführer-Fähigkeit (P4). Die Regel gilt für die ganze Engine; viele Ereignisse sind in den Einzeltests geprüft, aber es gibt keinen übergreifenden Test, der nachweist, dass keine Änderung ohne Ereignis bleibt. → **E16c3** (Stichprobe über ganze Bot-Partien).
- R-1.1, R-1.2, R-3.1, R-3.3, R-7b, R-11.4, R-12.5, R-18.1 haben je einen Test. Bei Durchsicht reicht das für den Regelumfang; kein Handlungsbedarf.

## Teilaufgaben im Backlog

- **E16c1** Tests für R-1.3, R-1.5, R-1.6, R-2.1, R-3.7, R-7.10 (nur Tests).
- **E16c2** R-14.5 Vernichten als Effekt-Baustein `destroy` mit Tests, in `data/README.md` dokumentiert.
- **E16c3** R-19.1 übergreifend: in Bot-Partien nach jeder Phase prüfen, dass Änderungen an Leben, Machtpunkten, Schatzkammer, Hand, Ablagestapel und Einheiten-Orten ein passendes Ereignis haben.
- **E16c4** `npm run check:spec` erneut, danach Eintrag „M2 abgenommen“ in `docs/STATUS.md`.

## Anhang: alle Regeln

Erzeugt mit `npm run check:spec -- --table <datei>`. „Tests“ zählt Testnamen und `describe`-Namen mit der Kennung.

| Regel | Titel | Tests | erster Fundort |
| --- | --- | ---: | --- |
| R-1.1 | Spieler | 1 | `packages/engine/src/setup.test.ts`:43 |
| R-1.2 | Karte | 1 | `packages/engine/src/setup.test.ts`:78 |
| R-1.3 | Einheit | 0 | – |
| R-1.4 | Token | 10 | `packages/engine/src/aftermath.test.ts`:152 |
| R-1.5 | Anführer | 0 | – |
| R-1.6 | Zonen eines Spielers | 0 | – |
| R-1.7 | Prioritätsreihenfolge | 6 | `packages/engine/src/aftermath.test.ts`:273 |
| R-1.9 | Auslegung | 7 | `packages/engine/src/aftermath.test.ts`:313 |
| R-1.8 | Zufall | 21 | `packages/engine/src/bots/greedyBot.test.ts`:214 |
| R-2.1 | Die Spieler sitzen im Ring 0 → 1 → 2 → 3 → 0 (im Uhrzeige … | 0 | – |
| R-2.2 | Für den aktiven Ring (nur nicht ausgeschiedene Spieler, i … | 4 | `packages/engine/src/elimination.test.ts`:259 |
| R-2.3 | Die Zone right von p kämpft gegen die Zone left des recht … | 2 | `packages/engine/src/fronts.test.ts`:66 |
| R-2.4 | Bei 3 Spielern bleibt R-2.2 unverändert (jeder hat zwei v … | 3 | `packages/engine/src/elimination.test.ts`:272 |
| R-2.5 | Bei 2 Spielern ist der andere Spieler sowohl linker als a … | 6 | `packages/engine/src/elimination.test.ts`:259 |
| R-3.1 | Frontzone | 1 | `packages/engine/src/board.test.ts`:104 |
| R-3.2 | Frontarena | 7 | `apps/sandbox/src/sandbox.test.ts`:53 |
| R-3.3 | Mittelzone | 1 | `packages/engine/src/board.test.ts`:104 |
| R-3.4 | Mittelarena | 5 | `packages/engine/src/center.test.ts`:118 |
| R-3.5 | Reserve | 3 | `packages/engine/src/board.test.ts`:104 |
| R-3.6 | Kapazität | 7 | `packages/engine/src/board.test.ts`:197 |
| R-3.8 | Benennung in der Oberfläche | 0 | – |
| R-3.7 | Persistenz | 0 | – |
| R-4.1 | Jeder Spieler wählt einen Anführer (im Prototyp: Spieler … | 4 | `packages/engine/src/setup.test.ts`:28 |
| R-4.2 | Startdeck | 4 | `packages/engine/src/setup.test.ts`:52 |
| R-4.3 | Leben 30, Machtpunkte 0, Schatzkammer 0, Anführer-XP 0, A … | 2 | `packages/engine/src/setup.test.ts`:126 |
| R-4.4 | Anführer-Startposition | 9 | `packages/engine/src/setup.test.ts`:148 |
| R-4.6 | Starthand | 5 | `packages/engine/src/deck.test.ts`:21 |
| R-4.5 | Königreich | 4 | `packages/engine/src/setup.test.ts`:194 |
| R-5 | Rundenablauf | 9 | `packages/engine/src/bots/greedyBot.test.ts`:220 |
| R-6.1 | Zinsen | 6 | `packages/engine/src/aftermath.test.ts`:321 |
| R-6.2 | Rundengold | 3 | `packages/engine/src/economy.test.ts`:110 |
| R-6.3 | Hand | 2 | `packages/engine/src/round.test.ts`:115 |
| R-6.4 | Ressourcen | 5 | `packages/engine/src/economy.test.ts`:138 |
| R-6.5 | Genesung durch Reserve | 7 | `packages/engine/src/board.test.ts`:473 |
| R-6.6 | Anführer-Aufstieg | 7 | `packages/engine/src/leader.test.ts`:84 |
| R-7.1 | Einheit ausspielen | 9 | `packages/engine/src/board.test.ts`:69 |
| R-7.3 | Zauber legen | 8 | `packages/engine/src/spells.test.ts`:42 |
| R-7.5 | Genesen | 4 | `packages/engine/src/board.test.ts`:278 |
| R-7.6 | Entnahme | 3 | `packages/engine/src/economy.test.ts`:174 |
| R-7.7 | Astwahl | 7 | `packages/engine/src/leaderAcceptance.test.ts`:234 |
| R-7.8 | Verschmelzen | 3 | `packages/engine/src/merge.test.ts`:191 |
| R-7.9 | Wer keine Planung einreicht (Timeout), plant leere Abschn … | 2 | `packages/engine/src/round.test.ts`:183 |
| R-7.10 | Nicht ausgespielte Karten bleiben bis zum Rundenende auf … | 0 | – |
| R-7b | Aufstellen | 1 | `packages/engine/src/round.test.ts`:338 |
| R-7.2 | Einheit bewegen | 4 | `packages/engine/src/board.test.ts`:227 |
| R-7.4 | Anführer-Fähigkeit wählen | 9 | `packages/engine/src/bots/greedyBot.test.ts`:149 |
| R-8.1 | Aufdecken | 5 | `packages/engine/src/bots/greedyBot.test.ts`:158 |
| R-8.2 | Anführer-Fähigkeiten | 36 | `packages/engine/src/ilyraBolt.test.ts`:82 |
| R-8.3 | Vorkampf-Zauber | 12 | `packages/engine/src/preCombat.test.ts`:91 |
| R-8.4 | Nachkampf-Zauber | 5 | `packages/engine/src/spellResolution.test.ts`:61 |
| R-8.5 | Ein Zauber, dessen Zielfeld bei der Auflösung leer ist od … | 11 | `packages/engine/src/fireball.test.ts`:238 |
| R-8.6 | Gelegte Zauber gehen nach der Auflösung auf den Ablagesta … | 4 | `packages/engine/src/spellResolution.test.ts`:96 |
| R-9.0 | Kampfbeginn | 10 | `apps/sandbox/src/sandbox.test.ts`:122 |
| R-9.1 | Teilnehmer | 12 | `apps/sandbox/src/sandbox.test.ts`:144 |
| R-9.2 | Einheitenwerte im Kampf | 5 | `apps/sandbox/src/sandbox.test.ts`:80 |
| R-9.3 | Tick-Ablauf | 19 | `packages/engine/src/combat.test.ts`:130 |
| R-9.4 | Zielwahl | 13 | `packages/engine/src/center.test.ts`:118 |
| R-9.5 | Angriff und Schaden | 5 | `packages/engine/src/combat.test.ts`:345 |
| R-9.6 | Tod im Kampf | 12 | `packages/engine/src/center.test.ts`:224 |
| R-9.7 | Kampfende | 10 | `apps/sandbox/src/sandbox.test.ts`:99 |
| R-10.1 | Durchbruch | 9 | `apps/sandbox/src/sandbox.test.ts`:99 |
| R-10.2 | Leere Front | 5 | `apps/sandbox/src/sandbox.test.ts`:144 |
| R-10.3 | Gold sofort in die Schatzkammer | 13 | `packages/engine/src/aftermath.test.ts`:90 |
| R-10.4 | Mitte | 17 | `packages/engine/src/bots/greedyBot.test.ts`:121 |
| R-10.5 | Grundschaden | 5 | `apps/sandbox/src/sandbox.test.ts`:92 |
| R-10.6 | Schwung und Trotz | 19 | `packages/engine/src/centerHold.test.ts`:167 |
| R-10.7 | Einheiten-XP | 7 | `packages/engine/src/unitXp.test.ts`:48 |
| R-10.8 | Anführer-XP | 10 | `packages/engine/src/streaks.test.ts`:283 |
| R-11.1 | Der Abschnitt buy ist eine Liste von Käufen. Er wird nach … | 2 | `packages/engine/src/economy.test.ts`:409 |
| R-11.2 | Kaufen | 7 | `packages/engine/src/bots/greedyBot.test.ts`:136 |
| R-11.3 | Gleichzeitige Käufe | 6 | `packages/engine/src/economy.test.ts`:326 |
| R-11.4 | Leerer Stapel | 1 | `packages/engine/src/economy.test.ts`:380 |
| R-11.5 | Schatzkammer | 3 | `packages/engine/src/economy.test.ts`:87 |
| R-12.1 | Alle Karten auf der Hand und alle in dieser Runde ausgesp … | 2 | `packages/engine/src/economy.test.ts`:163 |
| R-12.2 | Tokens werden entfernt (falls noch vorhanden). | 2 | `packages/engine/src/round.test.ts`:160 |
| R-12.3 | Anführer: +2 XP (der Aufstieg folgt zu Beginn der nächste … | 6 | `packages/engine/src/leader.test.ts`:52 |
| R-12.4 | Schilde und Kampf-Buffs verfallen. | 2 | `packages/engine/src/leaderAbilities.test.ts`:170 |
| R-12.5 | Übriges Gold des Rundenvorrats geht automatisch in die Sc … | 1 | `packages/engine/src/economy.test.ts`:409 |
| R-12.6 | Nachziehen | 13 | `packages/engine/src/centerHold.test.ts`:134 |
| R-13.1 | Spieler mit Leben ≤ 0 scheiden nach der Kampfauswertung a … | 9 | `packages/engine/src/elimination.test.ts`:86 |
| R-13.2 | Platzierung | 8 | `packages/engine/src/elimination.test.ts`:179 |
| R-13.3 | Machtsieg | 9 | `packages/engine/src/victory.test.ts`:79 |
| R-13.4 | Letzter Spieler | 5 | `packages/engine/src/round.test.ts`:104 |
| R-13.5 | Rundenlimit | 5 | `packages/engine/src/victory.test.ts`:213 |
| R-14.1 | Effekte | 4 | `packages/engine/src/aftermath.test.ts`:347 |
| R-14.2 | Feldziel | 22 | `packages/engine/src/bots/greedyBot.test.ts`:89 |
| R-14.3 | Schild | 4 | `packages/engine/src/effects.test.ts`:212 |
| R-14.4 | Verwunden | 18 | `packages/engine/src/fireball.test.ts`:257 |
| R-14.5 | Vernichten | 0 | – |
| R-14.6 | Alternative Kosten | 13 | `packages/engine/src/board.test.ts`:310 |
| R-14.7 | Flüche | 5 | `packages/engine/src/aftermath.test.ts`:203 |
| R-14.8 | Läutern | 10 | `packages/engine/src/deck.test.ts`:167 |
| R-15.1 | Verschmelzen | 12 | `packages/engine/src/aftermath.test.ts`:143 |
| R-15.2 | Sternfaktor | 13 | `apps/sandbox/src/sandbox.test.ts`:80 |
| R-15.3 | Anführer und Tokens verschmelzen nicht. | 3 | `apps/sandbox/src/sandbox.test.ts`:71 |
| R-16.1 | Stufen | 2 | `packages/engine/src/leader.test.ts`:38 |
| R-16.2 | Ast | 20 | `packages/engine/src/ilyraBolt.test.ts`:129 |
| R-16.3 | Kampfeinheit | 3 | `packages/engine/src/fronts.test.ts`:229 |
| R-16.4 | Aktive Fähigkeit | 9 | `packages/engine/src/leaderAbilities.test.ts`:129 |
| R-16.5 | Die Kampfeinheit des Anführers verhält sich im Kampf wie … | 3 | `packages/engine/src/combat.test.ts`:479 |
| R-16.6 | Hinter feindliche Linien (Vex) | 26 | `packages/engine/src/leaderChoices.test.ts`:152 |
| R-17.1 | Gezählt werden die verschiedenen Karten-IDs (nicht Kopien … | 13 | `packages/engine/src/morgraSummon.test.ts`:199 |
| R-17.2 | Die Boni der Stufe 2 bzw. 4 laut Daten gelten in allen Kä … | 15 | `packages/engine/src/resonance.test.ts`:122 |
| R-17.3 | Kostenboni (z. B. Goblins ab 4) gelten beim Ausspielen na … | 8 | `packages/engine/src/resonanceCost.test.ts`:79 |
| R-17.4 | Resonanzen mit Rundenwirkung | 10 | `packages/engine/src/resonanceRound.test.ts`:93 |
| R-17.5 | Bonus-XP (Menschen) | 7 | `packages/engine/src/unitXp.test.ts`:118 |
| R-17a.1 | Effekte „pro Runde“ oder „in der Reserve“ (z. B. Hehler) … | 6 | `packages/engine/src/aftermath.test.ts`:293 |
| R-17a.2 | Effekte „nächste Runde“ (z. B. Funkenschmiede) werden als … | 15 | `packages/engine/src/marks.test.ts`:67 |
| R-18.1 | Öffentlich: Brett, Leben, Machtpunkte, Schatzkammer, Deck … | 1 | `packages/engine/src/view.test.ts`:161 |
| R-18.2 | Privat: Handkarten, Deckreihenfolge, eigene Planung bis z … | 4 | `packages/engine/src/round.test.ts`:252 |
| R-18.2a | Jeder Spieler kennt den Inhalt seines eigenen Decks ohne … | 3 | `packages/engine/src/deck.test.ts`:244 |
| R-18.3 | Die Engine liefert für jeden Spieler eine eigene Sicht, i … | 4 | `packages/engine/src/view.test.ts`:97 |
| R-19.1 | Jede Zustandsänderung erzeugt ein Ereignis mit Typ, Runde … | 2 | `packages/engine/src/leaderChoices.test.ts`:224 |
| R-19.2 | Das Protokoll ist die einzige Quelle für die Animation im … | 0 | – |
| R-19.3 | Ereignisse, die private Informationen enthalten (z. B. ge … | 5 | `packages/engine/src/deck.test.ts`:132 |
