# Spec-Abgleich 2026-11-12 (E16c4, Abnahme M2)

Zweiter Lauf von `npm run check:spec` nach dem Schließen der Lücken aus dem Bericht vom 2026-11-10 (E16c1–E16c3), Stand `c5d0142`.

## Ergebnis

**115 Regeln, 113 mit mindestens einem Test, 2 ohne Test.** Keine unbekannten Kennungen in Testnamen.

| Regel | Inhalt | Einschätzung | Aufgabe |
| --- | --- | --- | --- |
| R-3.8 Benennung in der Oberfläche | schachähnliche Feldnamen aus Sicht des Spielers | gehört zum Client | C3 |
| R-19.2 | Protokoll ist die einzige Quelle für die Animation im Client | Architekturregel für den Client | C4 |

Gegenüber dem 2026-11-10 geschlossen: R-1.3, R-1.5, R-1.6, R-2.1, R-3.7, R-7.10 (E16c1), R-14.5 (E16c2a/b). R-19.1 war schon getestet, ist jetzt zusätzlich übergreifend in Bot-Partien geprüft (E16c3).

## Absicherung

Neuer Test `tools/sim/src/specAcceptance.test.ts` („E16c4: …“) führt den Abgleich bei jedem `npm test` aus und schlägt fehl, sobald eine Regel außer R-3.8 und R-19.2 ohne Test ist oder ein Testname eine unbekannte Kennung trägt. Neue Regeln in der Spec brauchen damit sofort einen Test. Wenn C3 und C4 die beiden Client-Regeln belegen, kann die Ausnahme im Test entfernt werden.

## Weitere Prüfläufe

- `npm test` und `npm run typecheck` grün.
- `npm run accept:m2` (1.000 GreedyBot-Partien, Seeds 1–1000): **BESTANDEN**, 0 Fehler, 0 Befunde, Runden Schnitt 9,4 (7–14 von 30).
- Hinweis für M4 (kein Befund für M2): Siegquote je Anführer bei GreedyBot sehr ungleich (Brann 72,7 %, Morgra 18,6 %, Ilyra 6,9 %, Vex 1,9 %). Das betrifft Balancing (P1/M4) und eventuell die Bot-Heuristik, nicht die Regeltreue.

## Alle Regeln

| Regel | Titel | Tests | erster Fundort |
| --- | --- | ---: | --- |
| R-1.1 | Spieler | 1 | `packages/engine/src/setup.test.ts`:43 |
| R-1.2 | Karte | 1 | `packages/engine/src/setup.test.ts`:78 |
| R-1.3 | Einheit | 3 | `packages/engine/src/basics.test.ts`:63 |
| R-1.4 | Token | 11 | `packages/engine/src/aftermath.test.ts`:152 |
| R-1.5 | Anführer | 3 | `packages/engine/src/basics.test.ts`:97 |
| R-1.6 | Zonen eines Spielers | 3 | `packages/engine/src/basics.test.ts`:140 |
| R-1.7 | Prioritätsreihenfolge | 6 | `packages/engine/src/aftermath.test.ts`:273 |
| R-1.9 | Auslegung | 7 | `packages/engine/src/aftermath.test.ts`:313 |
| R-1.8 | Zufall | 21 | `packages/engine/src/bots/greedyBot.test.ts`:214 |
| R-2.1 | Die Spieler sitzen im Ring 0 → 1 → 2 → 3 → 0 (im Uhrzeige … | 2 | `packages/engine/src/basics.test.ts`:169 |
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
| R-3.7 | Persistenz | 2 | `packages/engine/src/basics.test.ts`:185 |
| R-4.1 | Jeder Spieler wählt einen Anführer (im Prototyp: Spieler … | 4 | `packages/engine/src/setup.test.ts`:28 |
| R-4.2 | Startdeck | 4 | `packages/engine/src/setup.test.ts`:52 |
| R-4.3 | Leben 30, Machtpunkte 0, Schatzkammer 0, Anführer-XP 0, A … | 2 | `packages/engine/src/setup.test.ts`:126 |
| R-4.4 | Anführer-Startposition | 10 | `packages/engine/src/destroy.test.ts`:293 |
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
| R-7.8 | Verschmelzen | 4 | `packages/engine/src/basics.test.ts`:78 |
| R-7.9 | Wer keine Planung einreicht (Timeout), plant leere Abschn … | 2 | `packages/engine/src/round.test.ts`:183 |
| R-7.10 | Nicht ausgespielte Karten bleiben bis zum Rundenende auf … | 2 | `packages/engine/src/basics.test.ts`:213 |
| R-7b | Aufstellen | 1 | `packages/engine/src/round.test.ts`:338 |
| R-7.2 | Einheit bewegen | 5 | `packages/engine/src/basics.test.ts`:151 |
| R-7.4 | Anführer-Fähigkeit wählen | 9 | `packages/engine/src/bots/greedyBot.test.ts`:149 |
| R-8.1 | Aufdecken | 5 | `packages/engine/src/bots/greedyBot.test.ts`:158 |
| R-8.2 | Anführer-Fähigkeiten | 36 | `packages/engine/src/ilyraBolt.test.ts`:82 |
| R-8.3 | Vorkampf-Zauber | 12 | `packages/engine/src/preCombat.test.ts`:91 |
| R-8.4 | Nachkampf-Zauber | 5 | `packages/engine/src/spellResolution.test.ts`:61 |
| R-8.5 | Ein Zauber, dessen Zielfeld bei der Auflösung leer ist od … | 12 | `packages/engine/src/destroy.test.ts`:192 |
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
| R-14.5 | Vernichten | 17 | `packages/engine/src/destroy.test.ts`:114 |
| R-14.6 | Alternative Kosten | 13 | `packages/engine/src/board.test.ts`:310 |
| R-14.7 | Flüche | 5 | `packages/engine/src/aftermath.test.ts`:203 |
| R-14.8 | Läutern | 10 | `packages/engine/src/deck.test.ts`:167 |
| R-15.1 | Verschmelzen | 13 | `packages/engine/src/aftermath.test.ts`:143 |
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
| R-19.1 | Jede Zustandsänderung erzeugt ein Ereignis mit Typ, Runde … | 10 | `packages/engine/src/eventAudit.test.ts`:26 |
| R-19.2 | Das Protokoll ist die einzige Quelle für die Animation im … | 0 | – |
| R-19.3 | Ereignisse, die private Informationen enthalten (z. B. ge … | 5 | `packages/engine/src/deck.test.ts`:132 |
