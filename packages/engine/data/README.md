# Datenformat

Die Engine liest alle Spielinhalte und Zahlen aus diesen Dateien. Code enthält keine Karten und keine Balancing-Zahlen.

| Datei | Inhalt |
| --- | --- |
| `config.json` | Startwerte (Spec R-3 bis R-16) |
| `races.json` | Rassen und ihre Resonanz-Boni (R-17) |
| `classes.json` | Klassen und ihr Kampfverhalten (R-9.4) |
| `cards.json` | Alle Karten inkl. Tokens |
| `leaders.json` | Anführer mit Kampfwerten, Mana-Fähigkeit, aktiver Fähigkeit und Ästen (R-16) |

## Konfiguration (Auszug)

- `leaderStart` (R-4.4): Startfeld des Anführers beim Aufbau, z. B. `{ "zone": "left", "cell": { "col": 2, "row": 1 } }`. `zone` ist `left` oder `right` (nur Frontzonen haben Felder); `cell` sind Offset-Koordinaten der Frontzone und müssen innerhalb von `arenas.frontZone` liegen (Spalte 0 bis `cols − 1`, Zeile 0 bis `rows − 1`). Gilt für alle Spieler.

## Karten

Pflichtfelder: `id`, `name`, `type` (`resource` | `unit` | `spell` | `curse`), `cost`, `pool`.

- `pool`: `starter` (nur Startdeck), `basic` (immer im Königreich), `kingdom`, `class:<classId>` (privater Klassen-Pool), `token` (nie im Deck).
- `pileSize`: optional; sonst aus `config.pileSizeByCost` bzw. `config.classPoolPileSize`.
- `buyable`: Standard `true`.
- Ressourcen: `gold`.
- Einheiten: `race` (oder `null`), `class`, `stats` (`attack`, `hp`, `breakthrough`, `range`, optional `armor`, `attackInterval`, `moveInterval`, `manaMax`), optional `keywords`, `abilities`, `altCost`, `starterFor`.
- `altCost` (R-14.6): Ersatz für `cost`, gewählt mit `useAltCost` beim Ausspielen. Felder (alle optional, Teile werden zusammen bezahlt): `gold` (Gold statt `cost`, Standard 0), `bloodToll` (Leben; danach muss mindestens 1 Leben bleiben), `sacrifice` (Zahl eigener Karten-Einheiten, die der Spieler in der Aktion unter `sacrifice` angibt; Brett oder Reserve, nicht Anführer, nicht Tokens; ihre Karten gehen auf den Ablagestapel).
- Zauber: `slot` (`pre` | `post`), `tempo`, `target`, `effects`, optional `condition`.

## Fähigkeiten

```json
{ "trigger": "onManaFull", "condition": { "kind": "inReserve" }, "effects": [ … ] }
```

### Auslöser (`trigger`)
| Auslöser | Wann |
| --- | --- |
| `onCombatStart` | R-9.0, vor Tick 1 |
| `onManaFull` | R-9.3 Schritt 3 |
| `onDeath` | diese Einheit stirbt |
| `onAllyDeath` | eine verbündete Einheit in derselben Arena stirbt |
| `onKill` | diese Einheit besiegt eine gegnerische Einheit |
| `onFrontWin` | die Seite dieser Einheit gewinnt ihren Frontkampf (Einheit hat teilgenommen) |
| `onRoundStart` | R-17a.1 |

**Auswertung im Kampf** (`src/effects.ts`, `effectHooks`): `onCombatStart` (vor Tick 1, aufsteigende ID; im Kampfbeginn erzeugte Tokens haben keinen eigenen Kampfbeginn), `onManaFull`, `onDeath`, `onKill` (nur gegnerisches Opfer), `onAllyDeath` (lebende Verbündete derselben Arena). Beim Tod gilt die Reihenfolge: sterbende Einheit, Bezwinger, Verbündete nach ID (F30). Im Kampf wirken `damage` (Fähigkeitsschaden, durch Schild und Panzer), `heal`, `shield`, `buff` (alle Dauern sofort; `permanent` wird zusätzlich vorgemerkt), `stun`, `gainMana` (nur Einheiten mit Mana-Fähigkeit), `summon` mit `adjacentFree` und `grantKeyword`. Alle anderen Bausteine werden als `DeferredEffect` vorgemerkt (berechnete Werte schon beim Auslösen) und nach allen Kämpfen der Runde angewendet. Fähigkeiten mit `condition` lösen im Kampf nicht aus.

**Auswertung außerhalb des Kampfes** (`src/aftermath.ts`, E10b1, F31): Nach allen Kämpfen der Runde wirken die vorgemerkten Effekte (Fronten in Paarungsreihenfolge, dann die Mitte): `gainGold` immer in die Schatzkammer (R-10.3), `gainLeaderXp` auf den eigenen Anführer (Aufstieg zu Rundenbeginn, R-6.6), `buff` mit `duration: permanent` als `unit.permanentBuffs` (fester Zuschlag nach dem Sternfaktor, beim Verschmelzen addiert, nicht für Tokens), `giveCurse`, `stealGold`. Danach `onFrontWin`: alle Einheiten der Siegerseite, die teilgenommen haben (auch gestorbene, auch bei leerer Front); Sieger in Prioritätsreihenfolge (R-1.7), Einheiten nach ID; `frontOpponent` = Verlierer dieser Front. `onRoundStart` (R-17a.1) zu Rundenbeginn vor den Zinsen, Spieler in Prioritätsreihenfolge, Einheiten nach ID; `gainGold` mit `to: pool` geht dann in den Rundenvorrat, mit `to: treasury` in die Schatzkammer. Bedingungen: `inReserve` = Einheit steht in der Reserve (auch verwundet), `wonFrontThisRound` gilt bei `onFrontWin`. Berechnete Werte (`distinctOwnRaces`, `selfAttackTimes`) gibt es außerhalb des Kampfes nicht (Wert 0). Neue Ereignisse: `ability_triggered`, `unit_buffed_permanently`, `curse_given`, `gold_stolen`. `targetPlayer` ist der beim Legen eines Zaubers gewählte Spieler (E11a).

**Auflösung von Zaubern** (`src/spells.ts`, E11a): Nachkampf-Zauber (`slot: post`, R-8.4) lösen nach der Kampfauswertung auf: `tempo` aufsteigend, bei gleichem Tempo in Prioritätsreihenfolge (R-1.7), bei einem Spieler in der Reihenfolge des Legens. Vor der Wirkung wird geprüft: Ziel-Spieler ausgeschieden → `spell_fizzled` mit `noValidTarget`; `condition` nicht erfüllt → `spell_fizzled` mit `conditionNotMet` (F37). `wonFrontThisRound` gilt bei Zaubern, wenn der Spieler in dieser Runde mindestens eine Front gewonnen hat (auch eine leere Front). Sonst `spell_resolved`, dann die Effekte: `trash` (R-14.8, schon gezogene Karten werden übersprungen), `giveCurse`, `gainGold` (immer in die Schatzkammer), `startManaPercent` mit `when: nextRound` (Markierung). Danach geht der Zauber sofort auf den Ablagestapel (`spell_discarded`, R-8.6), auch wenn er verpufft ist. **Vorkampf-Zauber** (`slot: pre`, R-8.3, E11b1, `src/preCombat.ts`) lösen in der Phase `preCombatSpells` in derselben Reihenfolge auf und gehen danach ebenfalls sofort auf den Ablagestapel. Ziele zum Zeitpunkt der Auflösung: `hexAlly` = die eigene, nicht verwundete Einheit auf dem gewählten Feld (Reserve hat kein Feld); `zoneAllies` = alle eigenen, nicht verwundeten Einheiten der gewählten Zone(n), inkl. Anführer und Tokens. Hat kein Effekt eine gültige Einheit, verpufft der Zauber (`noValidTarget`, R-8.5, F38). Wirkungen: `shield` (Ereignis `unit_shielded`, Schilde addieren sich), `buff` mit `duration: combat` oder `round` (`unit_buffed`, fester Zuschlag nach dauerhaften Buffs, vor der Resonanz), `grantKeyword` (`unit_keyword_granted`). Sie liegen als `unit.roundEffects` an der Einheit, wirken über `fighterForUnit` in allen Kämpfen der Runde (auch bei leerer Front, z. B. Durchbruch-Buffs) und verfallen beim Aufräumen (R-12.4, R-14.3, Ereignis `unit_round_effects_cleared`). Vorkampf-Zauber mit noch fehlenden Bausteinen (`damage`, `wound`, `summon`: Feuerball, Frostlanze, Geistertrommel; E11b2–E11b4) bleiben vorerst liegen und gehen beim Rundenende ungenutzt ab.

**Markierungen „nächste Runde“** (`src/marks.ts`, E10b2, R-17a.2, F32): `gainGold` mit `when: nextRound` (bzw. `when: roundStart`, wenn außerhalb des Rundenbeginns ausgelöst) und `startManaPercent` mit `when: nextRound` werden als Markierung `player.roundMarks` gespeichert (Ereignis `round_mark_set`). Gold wirkt beim Rundenbeginn der nächsten Runde direkt nach den Effekten „pro Runde“ und vor den Zinsen (`to: pool` in den Rundenvorrat, `to: treasury` in die Schatzkammer). Start-Mana wirkt in allen Kämpfen der nächsten Runde (Prozent von `manaMax`, abgerundet, mehrere Markierungen addieren sich, Ziele `ownClassUnits` mit `class` sowie `allAllies`) und wird nach der Kampfphase gelöscht. Ereignisse `round_mark_applied` (mit betroffenen Einheiten) und `round_mark_cleared`; abgelaufene Markierungen werden zu Rundenbeginn gelöscht.

**Rassen-Resonanz im Kampf** (`src/resonance.ts`, E10c1, R-17.1, R-17.2, F33): Gezählt werden die verschiedenen Karten- bzw. Anführer-IDs einer Rasse unter den nicht verwundeten Einheiten eines Spielers in `left`, `right` und `center` (ohne Tokens, ohne Reserve). Es gilt nur die höchste erreichte Schwelle aus `races.json` (Schlüssel `"2"`, `"4"`, …). Zu Beginn der Kampfphase meldet das Ereignis `resonance_active` je Spieler und Rasse Anzahl, Stufe und betroffene Teilnehmer. In allen Kämpfen der Runde wirken auf alle Einheiten dieser Rasse des Spielers (auch Tokens und im Kampf erzeugte Tokens): `buff` mit `target: raceUnits` (fester Zuschlag nach dauerhaften Buffs), `startManaPercent` (ohne `when` bzw. `when: now`; zusammen mit Start-Mana-Markierungen addiert und einmal abgerundet) und `grantKeyword` (z. B. `unwoundable`). **Kostenbonus** (E10c2, R-17.3, F34): `costModifier` mit `appliesTo: raceCards` ändert beim Ausspielen einer Einheitenkarte dieser Rasse den Goldanteil der Kosten (normal oder alternativ), nie unter 0; Leben und Opfer bleiben unverändert. Gezählt wird nach dem Brett zum Zeitpunkt der Aktion, also nach früheren Aktionen derselben Planung, vor dem Entfernen der Opfer und ohne die neue Einheit. `unit_played` meldet die tatsächliche Änderung in `costModifier` (z. B. −1, sonst 0). **Rundenwirkungen** (`src/resonanceRound.ts`, E10c3, R-17.4, F35): Zu Rundenbeginn, bevor sich etwas ändert, wird nach dem Brett am Ende der Vorrunde gezählt (vor Genesung durch Reserve und Anführer-Aufstieg). Je Spieler (Prioritätsreihenfolge) und Rasse mit Rundenwirkung zuerst das Ereignis `resonance_round`, dann `gainGold` mit `when: roundStart` (nach `to`, Zwerge: Schatzkammer) und `gainLeaderXp` (eigener Anführer, der Aufstieg desselben Rundenbeginns zählt die XP schon). Danach Effekte „pro Runde“, Markierungen, Zinsen. `bonusInterest` (Zwerge 4): `amount` Gold je volle `perGold` Gold in der Schatzkammer, berechnet auf derselben Grundlage wie die Zinsen, ausgezahlt direkt danach, nicht durch `interestMax` gedeckelt (Ereignis `bonus_interest_paid`). **Einheiten-XP und Bonus-XP** (`src/unitXp.ts`, E10c4, R-10.7, R-17.5, F36): Direkt nach allen Kämpfen der Runde (nach den Kampf-Folgen) erhält jede überlebende Karten-Einheit `config.unitXpPerSurvivedFight` XP; „überlebt“ heißt: steht in `survivors` des Kampfergebnisses (auch bei Unentschieden, leerer Front und unbestrittener Mitte). Anführer und Tokens erhalten keine Einheiten-XP. `bonusXp` mit `target: raceUnits` (Menschen 2/4) gibt Einheiten dieser Rasse zusätzlich `amount` XP, nach der Resonanz zu Beginn der Kampfphase. Ereignis `unit_xp_gained` (mit `bonus` = Resonanzanteil und `arena`).

### Bedingungen (`condition.kind`)
`inReserve`, `wonFrontThisRound`.

### Effekt-Bausteine (`op`)
| op | Parameter | Bedeutung |
| --- | --- | --- |
| `damage` | `amount`, `target`, optional `wound` | Schaden (R-9.5); `wound: true` → besiegte Ziele sind verwundet |
| `heal` | `amount`, `target` | Lebenspunkte zurück, höchstens bis Maximum |
| `shield` | `amount`, `target` | Schild (R-14.3) |
| `buff` | `stat`, `amount`, `duration` (`combat` \| `round` \| `permanent`), `target` | Wert erhöhen |
| `stun` | `ticks`, `target` | Betäubung |
| `gainMana` | `amount`, `target` | Mana |
| `startManaPercent` | `amount`, `target`, optional `class`, `when` | Start-Mana in Prozent von `manaMax` |
| `summon` | `token`, `count`, `where`, optional `statOverride`, `countsForResonance` | Token erzeugen |
| `move` | `target` | gewählte Einheiten auf gewählte freie Felder setzen |
| `wound` | `target` | verwunden (R-14.4) |
| `gainGold` | `amount`, `when` (`now` \| `nextRound` \| `roundStart`), optional `to` (`pool` \| `treasury`, Standard `pool`) | Gold |
| `stealGold` | `amount`, `from` | Gold aus fremder Schatzkammer sofort in die eigene Schatzkammer (R-10.3) |
| `giveCurse` | `to` | Fluch auf den Ablagestapel (R-14.7) |
| `trash` | `from` | Karten dauerhaft entfernen (R-14.8) |
| `gainLeaderXp` | `amount` | XP für den eigenen Anführer |
| `grantKeyword` | `keyword`, optional `duration`, `target` | Schlüsselwort verleihen (ohne `duration` bei Resonanz: gilt für die Runde) |
| `costModifier` | `amount`, `appliesTo` | Kosten ändern (R-17.3) |
| `returnOnDeath` | `hp`, `limit`, `target` | Wiederkehr (Untote) |
| `onFrontWinOfChosen` | `effects` | verzögerter Auslöser für die gewählten Einheiten |
| `bonusInterest` | `perGold`, `amount` | zusätzliche Zinsen (R-17.4) |
| `bonusXp` | `amount`, `target` | zusätzliche XP beim Überleben eines Kampfes (R-17.5) |

Erlaubte Werte weiterer Parameter:
- `summon.where`: `adjacentFree`, `zoneFree`, `targetHexThenAdjacentFree`; `summon.token` muss eine Karte mit `pool: "token"` sein.
- `trash.from`: `chosenOwnCards` (die bei `ownCards` gewählten Karten, R-14.8)
- `costModifier.appliesTo`: `raceCards`
- `returnOnDeath.limit`: `firstRaceUnitPerCombat`, `oncePerUnitPerCombat`
- `giveCurse.to`, `stealGold.from`: Spieler-Ziele (siehe unten)
- `startManaPercent.when`: `now` \| `nextRound`; `startManaPercent.class`: Klassen-ID
- `buff.stat`, `statOverride`-Schlüssel: `attack`, `hp`, `breakthrough`, `range`, `armor`, `attackInterval`, `moveInterval`, `manaMax`

`amount` ist eine Zahl oder ein berechneter Wert: `{ "kind": "distinctOwnRaces" }`, `{ "kind": "selfAttackTimes", "factor": n }`. Feste Zahlen bei `damage` und `shield` sind ★1-Werte und skalieren im Kampf mit dem Stern der auslösenden Einheit (R-15.2, abgerundet, mindestens der ★1-Wert; Anführer und Tokens ★1); berechnete Werte skalieren nicht noch einmal (`selfAttackTimes` nutzt schon den skalierten Angriff).

### Ziele (`target`)
Als Text: `self`, `currentTarget`, `currentTargetAndNeighbors`, `weakestAlly` (wenigste aktuelle LP), `adjacentAllies`, `allAllies`, `alliesInArena`, `zoneAllies`, `raceUnits`, `ownClassUnits`, `hexEnemies`, `hexNeighborEnemies`, `hexAndNeighborEnemies`, `hexAlly`, `chosenUnits`.
Als Objekt: `{ "kind": "nearestEnemies", "count": n }`, `{ "kind": "alliesInRange", "range": r }`.
Spieler: `frontOpponent`, `frontOpponentTreasury`, `targetPlayer`.

Im Kampf (F30): Ziele werden vor dem Anwenden festgelegt und nach ID aufsteigend abgearbeitet. „Verbündete“ (`weakestAlly`, `allAllies`, `alliesInArena`, `alliesInRange`) schließen die Einheit selbst ein, `adjacentAllies` nicht. `currentTargetAndNeighbors` = aktuelles Ziel plus dessen gegnerische Nachbarn. `nearestEnemies`: Hex-Abstand, dann wenigste Lebenspunkte, dann kleinste ID. `distinctOwnRaces`: verschiedene Rassen der lebenden eigenen Kämpfer der Arena (inkl. Anführer und Tokens). `selfAttackTimes`: aktueller Angriff × `factor`. Feld-, Zonen- und gewählte Ziele gibt es nur bei Zaubern und Anführer-Fähigkeiten (E11).

### Ziel-Angaben bei Zaubern und Anführer-Fähigkeiten
`{ "kind": "hex" | "zone" | "player" | "ownCards" | "moveUnits" | "none", … }`. Parameter: `hex`: `arenas`, optional `mustBeFree`; `zone`: `arenas`; `player`: `allowed` (`neighbors`); `ownCards`: `max`, `from` (Liste aus `deck` \| `discard`, mindestens ein Eintrag; R-14.8: nie Hand oder ausgespielte Karten); `moveUnits`: `count`, `destination` (`ownFreeHex` \| `participatingFreeHex`, R-16.6). `arenas`: `participating` (eigene Fronten und Mitte, R-14.2) oder `own` (nur eigene Zonen).

### Schlüsselwörter
`firstStrike` (R-9.3), `unwoundable`, `woundOnKill`.

## Anführer

`active.category` bestimmt die Reihenfolge in R-8.2. `base` gilt auf Stufe 1, `branches[].levels` ab Stufe 2. Zusätzliche Parameter einer Stufe:
- `zones` (Brann): Anzahl wählbarer Zonen
- `hexes` (Ilyra): Anzahl wählbarer Felder
- `count` (Vex): Anzahl bewegbarer Einheiten

Alle drei sind Höchstwerte (mindestens 1, F23). Ohne Angabe gilt 1 bzw. `target.count`.

## Ziele in der Planung

Spieler geben Ziele von Zaubern (`setSpell`, R-7.3) und Anführer-Fähigkeiten (`setLeaderAbility`, R-7.4) als `ActionTarget` an (`src/actions.ts`), geprüft in `src/targets.ts`:

| Ziel-Angabe (`kind`) | Eingabe |
| --- | --- |
| `none` | `{ "kind": "none" }` (bei Zaubern auch weglassen) |
| `hex` | `{ "kind": "hex", "arena", "cell" }` oder mehrere als `{ "kind": "hexes", "hexes": [{ "arena", "cell" }] }` |
| `zone` | `{ "kind": "zone", "arenas": ["left", …] }` |
| `player` | `{ "kind": "player", "player": 0–3 }`, `allowed: neighbors` = linker oder rechter Nachbar im aktiven Ring (R-2.2) |
| `ownCards` | `{ "kind": "ownCards", "cardInstanceIds": [...] }` |
| `moveUnits` | `{ "kind": "moveUnits", "moves": [{ "unitId", "to": { "arena", "cell" } }] }` |

`arena` ist `left`, `right` (die Frontarena der eigenen linken bzw. rechten Zone) oder `center`. `cell` steht in **Arena-Koordinaten**: Frontarena 5 × 6 nach R-3.2 (in `right` ist der Spieler der erste und belegt die Zeilen 0–2, in `left` der zweite mit den Zeilen 3–5), Mittelarena 7 × 7 nach R-3.4. `arenas: own` bzw. `destination: ownFreeHex` erlaubt nur eigene Felder (in der Mitte der eigene Startbereich, F24), `participating` jedes Feld dieser Arenen. `mustBeFree` und Bewegungsziele prüfen beim Planen nur eigene Einheiten.

## Validierung

`loadGameData()` prüft alle Dateien beim Laden (`src/validate.ts`) und wirft bei Fehlern einen `GameDataError` mit allen Fundstellen. Geprüft werden: Pflichtfelder und Datentypen, unbekannte Felder (Tippfehler; Felder mit `_` am Anfang sind Kommentare), jeder `op`, jedes `target`, jeder Auslöser, jede Bedingung, jedes Schlüsselwort, doppelte IDs, alle Verweise auf Rassen, Klassen und Tokens sowie, dass `leaderStart` innerhalb der Frontzone liegt. Wer einen neuen Baustein oder Wert einführt, ergänzt ihn in `src/dataTypes.ts`, in `src/validate.ts` und in dieser Datei.
