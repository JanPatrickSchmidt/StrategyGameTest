# Backlog

Aufgaben in Reihenfolge abarbeiten. Jede Aufgabe hat ein Abnahmekriterium. Abhaken mit `[x]` und Datum.

## Meilenstein M2: Regel-Engine

Ziel: Die komplette Spiellogik des Mini-Sets läuft ohne Grafik, getestet, mit Bots.

- [x] **E1 Projekt-Setup** (2026-10-28) – Workspace, TypeScript, Vitest, Seed-Zufall, Datenlader-Grundlage.
  - Abnahme: `npm test` und `npm run typecheck` grün.
- [x] **E2 Datenvalidierung** (2026-10-28)
  - Alle Datendateien laden, typisieren und prüfen: jede referenzierte ID (Rasse, Klasse, Token, Karte) existiert, jeder `op` und jedes `target` ist im Effekt-System bekannt, Pflichtfelder vorhanden.
  - Abnahme: Test, der die echten Daten fehlerfrei validiert, und Tests mit absichtlich kaputten Daten, die erkannt werden.
- [x] **E3 Hex-Geometrie** (2026-10-28)
  - Versetzte Koordinaten („odd-r“) ↔ Würfelkoordinaten, Abstand, Nachbarn, Breitensuche über freie Felder, Abbildung Frontzone → Frontarena (R-3.2), Mittelzonen-Startbereiche (R-3.4).
  - Abnahme: Tests für alle Funktionen inklusive Randfälle.
- [x] **E4 Spielzustand und Aufbau** (2026-10-28)
  - Zustandsmodell, `createGame(config, leaders, seed)`, Startdeck, Mischen, Ziehen mit Nachmischen (R-4, R-6.3).
  - Abnahme: Tests zu R-4.x und R-6.3.
- [x] **E5 Rundenmaschine** (2026-10-28)
  - Phasen laut R-5, API: `submitPlanning`, `submitPurchases`, `advance` bzw. `resolveRound`. Ungültige Aktionen → `action_rejected`.
  - Abnahme: Eine Runde ohne Aktionen läuft vollständig durch; Phasenreihenfolge getestet.
- [x] **E6 Wirtschaft** (2026-10-28)
  - Ressourcen automatisch (R-6.4), Rundenvorrat, Schatzkammer und Zinsen (R-6.1, R-11.5), Entnahme (R-7.6), Kaufphase inkl. gleichzeitiger Käufe (R-11).
  - Abnahme: Tests zu allen genannten Regeln.
- **E7 Planung** – Aktionen R-7.1 bis R-7.10, Kapazität (R-3.6), alternative Kosten (R-14.6), Verschmelzen und Sternfaktor (R-15). Aufgeteilt (2026-10-28); R-7.6 Entnahme ist mit E6 erledigt, R-7.9 Timeout mit E5.
  - [x] **E7a Brett: Ausspielen, Bewegen, Genesen** (2026-10-28) – R-7.1 (ohne alternative Kosten), R-7.2, R-7.5, R-7.10, Kapazität R-3.6, Felder und Reserve R-3.1/R-3.3/R-3.5. Abnahme: Tests zu allen genannten Regeln.
  - [x] **E7b Alternative Kosten und Genesung durch Reserve** (2026-10-29) – R-14.6 (`bloodToll`, `sacrifice`, Kombination mit Gold), R-6.5. Abnahme: Tests zu beiden Regeln.
  - [x] **E7c Zauber legen, Anführer-Fähigkeit, Astwahl** (2026-10-29) – R-7.3 (Slots, Kosten sofort, Ziel nach R-14.2 prüfen), R-7.4, R-7.7. Abnahme: Tests zu allen genannten Regeln.
  - [x] **E7d Verschmelzen und Sternfaktor** (2026-10-30) – R-7.8, R-15.1 bis R-15.3. Abnahme: Tests zu allen genannten Regeln, inklusive Verkettung.
- [x] **P0 Anpassung an Jans Antworten F12–F15** (2026-10-28)
  - Schatzkammer ohne Obergrenze, Gold verfällt nie, Rundenvorrat beginnt bei 0, kein Überlauf mehr (R-6.1, R-6.2, R-10.3, R-11.5); `treasuryMax` aus `config.json` und Code entfernen, Zinsdeckel bleibt `interestMax`.
  - Kauflimit pro Spieler auf den Stapelstand zu Beginn der Kaufphase, zusätzliche Kopien nur bei mehreren Käufern (R-11.3).
  - Läutern wählt Karten aus Deck oder Ablagestapel (R-14.8): neue Zielart in Validator und `data/README.md`, `purify` in `cards.json` anpassen (z. B. `{ "kind": "ownCards", "max": 2, "from": ["deck", "discard"] }`), Sicht des eigenen Deckinhalts ohne Reihenfolge (R-18.2a).
  - Ausspielen direkt in die Reserve bleibt erlaubt (R-3.5, R-7.1), Test dafür sicherstellen.
  - Abnahme: Tests zu allen genannten Regeln, bestehende Tests angepasst (nicht abgeschwächt).
- **P1 Neuer Rundenablauf nach Jans Vorgabe** (direkt nach P0). Aufgeteilt (2026-10-28):
  - Spec R-5 bis R-7b, R-11, R-12 wurden umgestellt: ein Planungsblock mit den Abschnitten `play` → `buy` → `position` (ein Wartepunkt pro Runde), Käufe werden beim Aufdecken gleichzeitig verteilt, Anführer-Aufstieg zu Rundenbeginn, Nachziehen am Rundenende mit Mischen, wenn das Deck weniger Karten hat als zu ziehen sind, Starthand beim Aufbau (R-4.6), übriges Gold am Rundenende in die Schatzkammer.
  - Rundenmaschine, Eingabeformat (`submitPlanning` mit drei Abschnitten; `submitPurchases` entfällt), Wirtschaft und Ziehen anpassen.
  - Abnahme: Tests zu allen geänderten Regeln; bestehende Tests auf den neuen Ablauf umgestellt (nicht abgeschwächt).
  - [x] **P1a Planungsblock und Käufe** (2026-10-28) – eine Planung pro Runde mit `play` → `buy` → `position`, erlaubte Aktionen je Abschnitt, Käufe im Abschnitt `buy` (Gold sofort, Karten beim Aufdecken gleichzeitig verteilt), `submitPurchases` und Kaufphase entfernt, Einzahlung am Rundenende (R-5, R-7, R-7b, R-11, R-12.5). Abnahme: Tests zu allen genannten Regeln.
  - [x] **P1b Ziehen und Anführer-Aufstieg im neuen Ablauf** (2026-10-29) – Starthand beim Aufbau (R-4.6), kein Ziehen zu Rundenbeginn mehr (R-6.3), Nachziehen am Rundenende mit Mischen, wenn das Deck weniger Karten hat als zu ziehen sind (R-12.6), Anführer +2 XP am Rundenende (R-12.3) und Aufstieg zu Rundenbeginn (R-6.6). Abnahme: Tests zu allen genannten Regeln; bestehende Tests umgestellt (nicht abgeschwächt).
- **E8 Kampf: Frontarena**
  - Tick-Simulation (R-9.0 bis R-9.7) für Frontkämpfe, Zielwahl inkl. Krieger und Schurken, Bewegung, Angriff, Panzer, Schild, Tod, Ende.
  - Abnahme: Tests zu allen genannten Regeln; ein Determinismus-Test.
  - Aufgeteilt (2026-10-30):
  - [x] **E8a Kampfsimulation (reine Funktion)** (2026-10-30) – Modul `combat.ts`: Kämpfer aus Kartendaten (R-9.2), Tick-Ablauf mit `firstStrike`, Betäubung und Mana (R-9.3), Zielwahl mit Kriegern, Zielwechsel und Schurken-Sprung (R-9.4), Schaden mit Schild und Panzer (R-9.5), Tod (R-9.6), Kampfende (R-9.7), Kampf-Ereignisse; Haken für Mana-Fähigkeiten und Tod, die E10 mit Effekten füllt. Abnahme: Tests zu allen genannten Regeln; Determinismus-Test.
  - [x] **E8b Frontkämpfe in der Rundenmaschine** (2026-10-30) – Kampfphase: Paarungen nach R-2.3/R-2.5, Teilnehmer nach R-9.1 (nicht verwundet, Anführer mit R-16.3), Abbildung auf die Frontarena (R-3.2), leere Front und Kampf ohne Teilnehmer ohne Simulation, Kampf-Ereignisse im Ereignisprotokoll, Ergebnis je Paarung für E12, Tokens verschwinden nach dem Kampf (R-1.4, R-9.6). Abnahme: Tests zu allen genannten Regeln; Determinismus-Test über eine Runde mit Kampf.
- [x] **E9 Kampf: Mittelarena** (2026-10-30)
  - Free-for-all-Zielwahl, Halter-Bestimmung.
  - Abnahme: Tests zu R-9.1, R-9.7 für die Mitte.
- [x] **D1 Kampf-Sandbox zum Ausprobieren** (2026-10-31)
  - Eine einzelne, eigenständige HTML-Datei, veröffentlicht unter `docs/play/sandbox.html` (Engine gebündelt, keine Server-Abhängigkeit; Quellcode in `apps/sandbox`). GitHub Pages ist aktiv (Branch `main`, Ordner `/docs`), die Datei ist damit unter https://janpatrickschmidt.github.io/StrategyGameTest/play/sandbox.html erreichbar und muss auch am Handy bedienbar sein: Frontarena anzeigen (2D von oben reicht), Einheiten aus dem Mini-Set für beide Seiten auf Felder setzen, Kampf starten, Ablauf schrittweise oder animiert abspielen, Ergebnis und Durchbruch-Schaden anzeigen.
  - Zweck: Jan kann das Kampfsystem früh selbst ausprobieren und Feedback geben, bevor der 3D-Client existiert.
  - Abnahme: Datei öffnet sich im Browser ohne Fehler, auch auf schmalen Bildschirmen; in `docs/STATUS.md` unter „Zum Ausprobieren“ mit Link und kurzer Anleitung eingetragen.
- **Aus der Prüfung vom 2026-11-01** (`docs/berichte/pruefung-2026-11-01.md`) – vor E10c3 erledigen, in dieser Reihenfolge:
  - [x] **P2 Sternfaktor für Fähigkeitszahlen (R-15.2)** – `damage`- und `shield`-Werte von Fähigkeiten im Kampf (`effects.ts`) mit dem Sternfaktor der auslösenden Einheit skalieren (abgerundet, mindestens ★1-Wert, `scaleByStars`); dazu den Stern an `FighterInit`/`Fighter` durchreichen (Tokens und Anführer ★1). `selfAttackTimes` nicht doppelt skalieren (bezieht sich schon auf den skalierten Angriff). Sandbox neu bauen. Abnahme: Tests „R-15.2: …“ mit ★1, ★2 und ★3 für mindestens eine Schadensfähigkeit (z. B. Lehrling 2 → 3 → 6) und eine Schildfähigkeit (Mondpriesterin 6 → 10 → 19); Test, dass `selfAttackTimes` bei ★2 nicht doppelt skaliert; bestehende Tests unverändert grün.
  - [x] **P3 Anführer-Startfeld aus den Daten (R-4.4)** (2026-11-01) – Konstante `LEADER_START_LOCATION` in `setup.ts` durch einen Wert in `config.json` ersetzen (z. B. `leaderStart: { zone: "left", cell: { col: 2, row: 1 } }`), im Validator prüfen und in `data/README.md` beschreiben. Abnahme: Test, dass ein geänderter Konfigurationswert das Startfeld ändert; Validator-Test mit ungültigem Startfeld.
  - [x] **P4 Ereignis beim Zurücksetzen der Anführer-Fähigkeit (R-19.1)** (2026-11-02) – `resetLeaderAbilities` (`leader.ts`) erzeugt beim Aufräumen für jeden Spieler mit gesetzter Fähigkeit ein Ereignis (z. B. `leader_ability_cleared`). Abnahme: Test „R-19.1: …“, dass nach einer Runde mit gewählter Anführer-Fähigkeit das Ereignis im Protokoll steht und ohne gewählte Fähigkeit keines.
- [x] **E10 Effekt-System** (aufgeteilt in E10a–E10c, abgeschlossen 2026-11-02)
  - Auslöser und Bausteine laut `data/README.md`, alle Karten und Rassen des Mini-Sets wirken wie beschrieben.
  - Abnahme: Mindestens ein Test pro Karte mit Fähigkeit und pro Resonanzstufe.
  - [x] **E10a Fähigkeiten im Kampf** (2026-10-31) – Modul `effects.ts`: Auslöser `onCombatStart`, `onManaFull`, `onDeath`, `onKill`, `onAllyDeath` für Karten, Tokens und Anführer; Bausteine `damage`, `heal`, `shield`, `buff`, `stun`, `gainMana`, `summon` (`adjacentFree`), `grantKeyword`; Kampf-Ziele und berechnete Werte; Tokens aus dem Kampf mit eigenen IDs; in Fronten, Mitte und Sandbox angeschlossen. Wirkungen über den Kampf hinaus werden vorgemerkt. Abnahme: ein Test je Karte und Anführer mit Kampf-Fähigkeit; Determinismus-Test.
  - [x] **E10b Wirkungen außerhalb des Kampfes** (aufgeteilt in E10b1/E10b2)
    - [x] **E10b1 Kampf-Folgen, `onFrontWin`, `onRoundStart`** (2026-10-31) – Modul `aftermath.ts`: vorgemerkte Kampf-Effekte nach allen Kämpfen anwenden (`gainGold` R-10.3, `gainLeaderXp`, dauerhafte Buffs als `unit.permanentBuffs`, auch beim Verschmelzen), `onFrontWin` (Fluchweber `giveCurse` R-14.7, Meisterdieb `stealGold`), `onRoundStart` mit `inReserve` (Hehler, R-17a.1). Abnahme: ein Test je betroffener Karte; Determinismus-Test.
    - [x] **E10b2 Markierungen „nächste Runde“ (R-17a.2)** (2026-10-31) – `gainGold` mit `when: "nextRound"` bzw. `"roundStart"` und `startManaPercent` mit `when: "nextRound"` (Funkenschmiede) als Markierung am Spieler speichern und beim Rundenbeginn bzw. Kampfbeginn der nächsten Runde anwenden, danach löschen. Da beides bisher nur Zauber nutzen, mit direkt gesetzten Markierungen testen; die Funkenschmiede selbst wird mit E11 angeschlossen. Abnahme: Tests zu R-17a.2 (Anwenden, Löschen, nur eine Runde).
  - [x] **E10c Rassen-Resonanz** – Zählung nach R-17.1, Boni je Stufe in allen Kämpfen der Runde (R-17.2), Kostenbonus (R-17.3), Rundenwirkungen und Bonuszinsen (R-17.4), Bonus-XP (R-17.5), `unwoundable`. Abnahme: ein Test pro Resonanzstufe jeder Rasse. Aufgeteilt (2026-10-31):
    - [x] **E10c1 Zählung und Kampfboni** (2026-10-31) – Modul `resonance.ts`: Zählung nach R-17.1, erreichte Stufe laut Daten, Kampfboni `buff`, `startManaPercent`, `grantKeyword` (`unwoundable` als Schlüsselwort am Kämpfer) mit Ziel `raceUnits` in allen Kämpfen der Runde (R-17.2), auch für Tokens und im Kampf erzeugte Tokens; Ereignis `resonance_active` zu Beginn der Kampfphase. Abnahme: Tests je Kampf-Resonanzstufe (Goblins 2/4, Zwerge 2/4, Elfen 2/4), Zählung, Determinismus.
    - [x] **E10c2 Kostenbonus (R-17.3)** (2026-11-01) – `costModifier` (Goblins 4) beim Ausspielen nach dem Brett zum Zeitpunkt der Aktion, Kosten nie unter 0; auch für alternative Gold-Kosten prüfen. Abnahme: Tests zu R-17.3.
    - [x] **E10c3 Rundenwirkungen und Bonuszinsen (R-17.4)** (2026-11-02) – Zwerge `gainGold` mit `when: roundStart` und `bonusInterest`, Menschen `gainLeaderXp`, ausgewertet zu Rundenbeginn nach dem Brett am Ende der Vorrunde, Reihenfolge Resonanz-Gold → Zinsen. Abnahme: Tests für Zwerge 2/4 und Menschen 2/4 (Rundenwirkung).
    - [x] **E10c4 Bonus-XP (R-17.5)** (2026-11-02) – Menschen-Einheiten erhalten beim Überleben eines Kampfes zusätzliche XP; setzt die Einheiten-XP (R-10.7) voraus, die bisher erst mit E12 vorgesehen sind – daher R-10.7 hier mit umsetzen. Abnahme: Tests zu R-10.7 und R-17.5 (Menschen 2/4).
- [x] **E11 Zauber und Anführer** (abgeschlossen 2026-11-06)
  - Aufdecken, Anführer-Fähigkeiten nach Kategorien (R-8.2), Zauber nach Tempo und Prioritätsreihenfolge (R-8.3, R-8.4), Verpuffen (R-8.5), Anführer-Stufen und Äste (R-16).
  - Abnahme: Tests zu allen genannten Regeln, jeder Ast jedes Anführers auf jeder Stufe.
  - Aufgeteilt (2026-11-03):
    - [x] **E11a Nachkampf-Zauber ohne Kampfbezug (R-8.4, R-8.6)** (2026-11-03) – Auflösung in der Phase `postCombatSpells` nach Tempo, Prioritätsreihenfolge und Reihenfolge des Legens; jeder Zauber vollständig, danach sofort auf den Ablagestapel. Läutern (`trash`), Kriegsbeute (Bedingung `wonFrontThisRound`, `gainGold`), Bürde (`giveCurse` an `targetPlayer`), Funkenschmiede (Markierung). Verpuffen bei ungültigem Ziel-Spieler oder nicht erfüllter Bedingung. Abnahme: Tests zu R-8.4, R-8.6 und je ein Test pro Nachkampf-Zauber.
    - [x] **E11b Vorkampf-Zauber (R-8.3, R-8.5)** (2026-11-04) – im Lauf vom 2026-11-03 in E11b1–E11b4 aufgeteilt. Abnahme: Tests zu R-8.3, R-8.5 und je ein Test pro Vorkampf-Zauber.
        - [x] **E11b1 Auflösung und Wirkungen auf eigene Einheiten (R-8.3, R-8.5, R-12.4)** (2026-11-03) – Phase `preCombatSpells` nach Tempo, Prioritätsreihenfolge und Reihenfolge des Legens; Schild (Schutzrune), Buff `combat`/`round` (Kriegsruf), Schlüsselwort (Giftklinge) als `unit.roundEffects`, in alle Kämpfe der Runde übernommen, beim Aufräumen gelöscht. Verpuffen bei leerem Feld, nur verwundeten Einheiten oder leerer Zone.
        - [x] **E11b2 Verwunden (R-14.4)** (2026-11-03) – Frostlanze (`wound` vor dem Kampf auf gegnerische Einheiten des Felds), dazu Verwunden im Kampf: `woundOnKill` (Giftklinge), `damage` mit `wound: true`, `unwoundable` (Zwerge 4) schützt. Abnahme: Tests zu R-14.4 und Frostlanze/Giftklinge.
        - [x] **E11b3 Schaden vor dem Kampf (R-14.2)** (2026-11-04) – Feuerball: 5 Schaden auf gegnerische Einheiten des Felds, 2 auf gegnerische Nachbarn; Schaden wirkt durch Schild und Panzer wie Fähigkeitsschaden (R-9.5), bleibt für die Kämpfe der Runde; tödlicher Schaden = Einheit nimmt in dieser Runde an keinem Kampf teil. Abnahme: Tests zu R-14.2 und Feuerball.
        - [x] **E11b4 Beschwören vor dem Kampf und Resonanz-Zeitpunkt** (2026-11-04) – Geistertrommel (`summon` mit `zoneFree`, 2 Kleine Geister in die gewählte Zone, verpufft ohne freies Feld); danach Resonanz-Zeitpunkt (F33c) prüfen. Abnahme: Test Geistertrommel, Abschluss E11b.
    - [x] **E11c Anführer-Fähigkeiten (R-8.2)** (2026-11-06) – Kategorien `summon`/`move` → `buff` → `damage`, innerhalb einer Kategorie gleichzeitig (gleiches freies Feld: beide scheitern; Schaden erst berechnen, dann anwenden). Brann, Ilyra, Morgra mit allen Ästen; Vex mit R-16.6 (Rückkehr nach dem Aufräumen), `onFrontWinOfChosen`. Abnahme: Tests zu R-8.2 und R-16.6. Aufgeteilt (2026-11-04):
        - [x] **E11c1 Rahmen und Kategorie `buff` (Brann)** (2026-11-04) – Modul `leaderAbilities.ts`, Phase `leaderAbilities` nach Kategorien, Ereignisse `leader_ability_resolved`/`leader_ability_fizzled`; Sammelruf mit allen Ästen (Weite, Wucht, Standhaft) als `roundEffects`. Abnahme: Tests zu R-8.2 (Reihenfolge, Verpuffen, ausgeschiedene Spieler) und je Ast und Stufe.
        - [x] **E11c2 Kategorie `damage` (Ilyra)** (2026-11-05) – Blitzschlag mit allen Ästen (Kette mit mehreren Feldern, Sturm `hexAndNeighborEnemies`, Wucht mit `wound`); Schaden erst für alle Ilyra-Fähigkeiten berechnen, dann gleichzeitig anwenden (R-8.2). Abnahme: Tests zu R-8.2 (gleichzeitiger Schaden) und je Ast und Stufe.
        - [x] **E11c3 Kategorie `summon` (Morgra)** (2026-11-05) – Beschwörung `targetHexThenAdjacentFree`, `statOverride`, `countsForResonance` (Seelenband); Konflikt „dasselbe freie Feld: beide scheitern“ innerhalb der Kategorie. Abnahme: Tests je Ast und Stufe und zum Feldkonflikt.
        - [x] **E11c4 Kategorie `move` (Vex)** (2026-11-06) – Schattenschritt nach `participatingFreeHex` (R-16.6, auch gegnerische Hälfte und Mitte), Rückkehr nach dem Aufräumen, Feldkonflikt mit Beschwörungen, Hinterhalt-Buffs, `onFrontWinOfChosen` (Beute). Abnahme: Tests zu R-16.6 und je Ast und Stufe. Aufgeteilt (2026-11-05):
            - [x] **E11c4a Schattenschritt** (2026-11-05) – `move` nach `participatingFreeHex` (R-16.6, gegnerische Hälfte und Mitte), Rückkehr nach dem Aufräumen, Feldkonflikt mit Beschwörungen, Äste „Doppelt“ und „Hinterhalt“ (Buffs, Erstschlag), „Beute“ ohne Gold. Abnahme: Tests zu R-16.6 und je Ast und Stufe.
            - [x] **E11c4b Beute (`onFrontWinOfChosen`)** (2026-11-06) – verzögerter Auslöser: gewinnt die Front, in der eine gewählte Einheit kämpft, bekommt Vex 2/3/4 Gold sofort in die Schatzkammer (R-10.3). Abnahme: Tests je Stufe, auch Mitte/verlorene Front/leere Front.
    - [x] **E11d Abnahme E11** (2026-11-06) – Test jedes Asts jedes Anführers auf jeder Stufe (R-16.2), R-16.3 und R-16.4 im Rundenablauf. Abnahme: wie E11.
- [x] **E12 Auswertung, Ausscheiden, Sieg** (2026-11-08)
  - Durchbruch, leere Front, Grundschaden, Mitte, Schwung und Trotz, XP (R-10), Ausscheiden, Platzierung, Machtsieg, Rundenlimit (R-13), Nachbarn neu berechnen (R-2).
  - Abnahme: Tests zu allen genannten Regeln.
  - Aufgeteilt (2026-11-06):
    - [x] **E12a Durchbruch, Grundschaden, Beute der leeren Front (R-10.1, R-10.2, R-10.5)** (2026-11-06) – Modul `resolution.ts`, Phase `combatResolution`: je Front-Paarung verliert der Verlierer Durchbruch der Überlebenden des Siegers + Grundschaden; leere Front zusätzlich `emptyFrontLoot` Gold sofort in die Schatzkammer (R-10.3). Ereignisse `breakthrough_damage`, `front_loot`. Abnahme: Tests zu R-10.1, R-10.2, R-10.5, auch bei 2 Spielern; Determinismus.
    - [x] **E12b Mitte (R-10.4, R-12.6)** (2026-11-07) – Halteserie, Gold (R-10.3), +1 Karte beim Nachziehen am Rundenende, sofort +1 Machtpunkt ab Serie 3; Belohnungen aus `config.center.rewards`. Abnahme: Tests je Serienlänge, Serie zurücksetzen bei anderen Spielern und ohne Halter.
    - [x] **E12c Schwung und Trotz, Anführer-XP (R-10.6, R-10.8)** (2026-11-07) – Runde gewonnen/verloren/neutral nach Frontkämpfen, Serien, Bonusgold aus `config.streakGold`; Anführer +1 XP bei Teilnahme und Überleben. Abnahme: Tests zu R-10.6 (alle Stufen, neutrale Runde) und R-10.8.
    - [x] **E12d Ausscheiden und Platzierung (R-13.1, R-13.2, R-2.2–R-2.5)** (2026-11-07) – nach der Kampfauswertung ausscheiden (Einheiten verlassen das Spiel), Platzierung mit Gleichständen (Leben vor dem Schaden der Runde, Machtpunkte, geteilt), Nachbarn im nächsten Kampf neu. Abnahme: Tests zu R-13.1, R-13.2 und Paarungen nach dem Ausscheiden.
    - [x] **E12e Sieg und Rundenlimit (R-13.3–R-13.5), Abnahme E12** (2026-11-08) – Machtsieg am Ende der Kampfauswertung, letzter Spieler, Rundenlimit aus `config.maxRounds`, Platzierung der übrigen; Partie über mehrere Runden bis zum Ende. Abnahme: wie E12.
- **Aus der Prüfung vom 2026-11-08** (`docs/berichte/pruefung-2026-11-08.md`) – vor E13 erledigen, in dieser Reihenfolge:
  - [x] **P5 Keine Planungsinhalte in öffentlichen Ereignissen (R-18.2, R-19.3, R-8.1)** – `planning_submitted` (`round.ts`, `submitPlanning`) verrät vor dem Aufdecken öffentlich `actionCount`; `planning_revealed` (`runReveal`) veröffentlicht die ganze Planung inklusive abgelehnter Aktionen und damit Handkarten, die auf der Hand bleiben. Umsetzen: `planning_submitted` öffentlich nur noch „Spieler hat eingereicht“ (Anzahl höchstens für den Besitzer); `planning_revealed` nur für den Besitzer sichtbar oder öffentlich ohne Kartenbezug, öffentlich werden Brett, gelegte Zauber und Anführer-Fähigkeit über die bestehenden Einzelereignisse. Abnahme: Test „R-18.2: …“, dass ein Spieler vor dem Aufdecken in keinem für ihn sichtbaren Ereignis die Aktionszahl eines anderen sieht; Test „R-18.2: …“, dass nach einer abgelehnten `playUnit`-Aktion die Karteninstanz der Handkarte in keinem für andere Spieler sichtbaren Ereignis vorkommt; bestehende Tests in `round.test.ts` angepasst, nicht abgeschwächt.
  - [x] **P6 Test: Anführer verhalten sich wie ihre Klasse (R-16.5)** – nur Tests, kein Produktivcode nötig, falls sie grün sind. Abnahme: Test „R-16.5: …“, dass Vex (Schurke) in Tick 0 auf ein freies Feld neben dem entferntesten Gegner springt (R-9.4); Test „R-16.5: …“, dass Brann (Krieger) bei gleichem Hex-Abstand als Ziel gewählt wird (Abstand −1, R-9.4). Weicht das Verhalten ab, Fehler beheben.
- [x] **E13 Sichtfilter und Ereignisprotokoll** (2026-11-09)
  - Sicht pro Spieler (R-18), gefilterte Ereignisse (R-19).
  - Abnahme: Test, dass keine fremde Hand und keine fremde Deckreihenfolge in einer Sicht oder einem gefilterten Ereignis auftaucht.
- [ ] **E14 Bots**
  - `RandomBot` (nur gültige Aktionen, zufällig über den Seed) und `GreedyBot` (einfache Heuristik: Board füllen, stärkste bezahlbare Karte kaufen, Zauber auf Feld mit den meisten Gegnern, Mitte besetzen wenn Board stark genug).
  - Abnahme: Beide Bots spielen vollständige Partien.
  - [x] **E14a** Planungsentwurf (`PlanningDraft`), Kandidaten-Erzeugung, `RandomBot`, `playBotGame`; RandomBots spielen vollständige Partien ohne abgelehnte Aktionen.
  - [ ] **E14b** `GreedyBot` (Heuristik wie oben) auf Basis von `PlanningDraft`; Abnahme: vier GreedyBots und gemischte Tische spielen vollständige Partien, GreedyBot gewinnt gegen RandomBots klar häufiger als ein Viertel der Partien.
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
- [ ] **C2 3D-Brett** – Visuelle Richtung laut `docs/stil/visuelle-richtung.md`. Arenen, Hexfelder, Einheiten als einfache Formen mit Farbe pro Spieler, Kamera schräg von oben, Lebens- und Sternanzeige. Abnahme: Alle Arenen der Partie sichtbar und lesbar.
- [ ] **C3 Planungsoberfläche** – Gliederung in die Schritte Ausspielen, Kaufen, Aufstellen (R-5), Wechsel zwischen den Schritten bis zum Bestätigen. Automatisch ausgespielte Münzen sichtbar anzeigen (z. B. als gespielte Karten neben der Hand), damit klar ist, warum weniger Karten auf der Hand sind. Hand, Gold, Schatzkammer, Einheiten platzieren und bewegen (Klicken oder Ziehen), Zauber mit Ziel legen, Anführer-Fähigkeit mit Ziel wählen, Astwahl. Abnahme: Alle Planungsaktionen sind bedienbar.
- [ ] **C4 Kampfwiedergabe** – Ereignisprotokoll als Animation abspielen: Bewegung, Angriff, Treffer, Tod, Fähigkeiten, Zauber, Schadenszahlen; Geschwindigkeit wählbar, überspringbar. Abnahme: Ein Kampf ist ohne Text nachvollziehbar.
- [ ] **C5 Kaufphase** – Königreich, Klassen-Pool, Stapelgrößen, Kaufen, Einzahlen. Abnahme: Käufe landen im Deck.
- [ ] **C6 Übersicht** – Leben, Machtpunkte, Serien, Gegner-Infos, Rundenzahl, Spielende mit Platzierung. Abnahme: Partie lässt sich bis zum Ende spielen.
- [ ] **C7 Veröffentlichung** – Build als statische Seite nach `docs/play/` (GitHub Pages ist aktiv, Branch `main`, Ordner `/docs`; Adresse https://janpatrickschmidt.github.io/StrategyGameTest/play/). Abnahme: Link in `docs/STATUS.md`, Seite spielbar.

## Meilenstein M4: Balancing

Grundsätze: `docs/spec/balancing.md`.

- [ ] **B0 Kampf-Kalibrierung** – Werkzeug in `tools/sim`, das Armeen gleichen Goldwerts aus dem Mini-Set zufällig zusammenstellt und in der Frontarena gegeneinander kämpfen lässt (viele Aufstellungen, Seeds). Ausgabe: Siegquote je Karte und je Sternstufe, Vergleich ★2 gegen ★1 mit dreifachen Kosten. Danach Kartenwerte nach B-1/B-3 anpassen. Abnahme: Bericht unter `docs/berichte/`, alle Karten im Zielbereich oder begründete Ausnahme.
- [ ] **B1 Simulationsreihen** – je 2.000 Partien GreedyBot mit allen Anführer-Kombinationen; Kennzahlen: Siegquote je Anführer, Siegart (Leben, Macht, Rundenlimit), Rundenzahl, meistgekaufte Karten, Kaufquote je Karte.
- [ ] **B2 Tuning** – [TUNING]-Werte anpassen, bis kein Anführer über 35 % Siegquote liegt (fair wären 25 %) und Partien im Mittel 15–20 Runden dauern. Jede Änderung in `docs/ENTSCHEIDUNGEN.md`.
- [ ] **B3 Bericht für Jan** – `docs/berichte/balancing-<datum>.md` mit Ergebnissen, Diagrammen als Bilddateien und CSVs zum Selbstauswerten.

## Meilenstein M5: Erweiterungen hinter Schaltern

Erst beginnen, wenn M4 abgenommen ist. Regeln: `docs/spec/erweiterungen.md`. Jedes System hinter einem Schalter in `config.json`, Standard aus; bei ausgeschaltetem Schalter bleiben alle bisherigen Tests unverändert grün.

- [ ] **V1 Evolution: Engine** – E-1 bis E-6, Datenformat, Astwahl, Verschmelzen. Abnahme: Tests zu allen E-Regeln, Schalter aus = keine Änderung.
- [ ] **V2 Evolution: Inhalte** – Äste für alle Einheiten des Mini-Sets nach E-7, als Entwurf markiert, Werte per Kalibrierung (B0-Werkzeug) geprüft. Abnahme: jede Einheit hat zwei Äste, Kalibrierung im Zielbereich, kurze Übersicht der Äste unter `docs/berichte/evolutionen.md` für Jan.
- [ ] **V3 Evolution: Darstellung** – E-8 im 3D-Client. Abnahme: Evolution in einer Partie sichtbar, Astwahl bedienbar.
- [ ] **W1 Weltereignisse: Engine und Inhalte** – W-1 bis W-4, 10–12 Ereignisse. Abnahme: Tests, Ereignisse in Simulationen ohne Dominanz einzelner Ereignisse.
- [ ] **W2 Seher-Karten** – W-5. Abnahme: Tests, Sichtbarkeit nur für den Besitzer.
- [ ] **W3 Weltereignisse: Darstellung** – Ereignisanzeige im Client, Vorschau für Seher.
- [ ] **F1 Fusion** – F-1 bis F-3, Engine und Darstellung.

## Meilenstein M6: Online-Vorbereitung (nur falls vorher alles fertig ist)

Erst beginnen, wenn M5 abgenommen ist. Alles läuft **nur lokal und in Tests**: nichts wird gehostet, keine Konten bei Anbietern angelegt, keine Zugangsdaten oder Geheimnisse ins Repository. Architektur laut Technik-Dokument: autoritativer Spielserver, Client spielt nur das Ereignisprotokoll ab.

- [ ] **O1 Spielserver lokal** – `apps/server` mit Node.js und Colyseus: ein Raum pro Partie für 4 Spieler, Engine läuft nur auf dem Server, jeder Spieler erhält seine gefilterte Sicht (R-18), Planungs-Timer, Wiederverbinden während einer laufenden Partie. Abnahme: Test, in dem 4 Bot-Clients eine komplette Partie über einen lokal gestarteten Server spielen; kein Client sieht fremde verdeckte Informationen.
- [ ] **O2 Client-Anbindung** – Der Client kann wahlweise lokal gegen Bots oder gegen einen Server spielen (Einstellung im Startbildschirm). Abnahme: Partie mit einem Menschen und 3 Bots über den lokalen Server spielbar.
- [ ] **O3 Meta-Dienst Grundgerüst** – `apps/meta`: einfache Accounts ohne echte Anmeldung (nur lokal), Anführer-Vorlagen speichern, Rating mit OpenSkill nach jeder Partie; Datenbank lokal (SQLite), mit austauschbarer Schicht für PostgreSQL. Abnahme: Tests für Vorlagen und Rating-Aktualisierung.
- [ ] **O4 Anleitung für den Betrieb** – `docs/betrieb/hosting.md`: was Jan tun muss, um Server und Meta-Dienst zu hosten (Anbieterauswahl, geschätzte monatliche Kosten, Schritte), dazu Container-Dateien (Dockerfile) zum Starten. Abnahme: Anleitung vollständig, Container lassen sich lokal bauen und starten.

## Später (nicht ohne Jan)

Online-Betrieb (Hosting, echte Anmeldung, Matchmaking im Netz), Grafik-Ausbau, Pakte, Angebotsfenster, Gelände, fliegende Einheiten (siehe Ideen in `docs/spec/erweiterungen.md`).
