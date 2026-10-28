# Datenformat

Die Engine liest alle Spielinhalte und Zahlen aus diesen Dateien. Code enthält keine Karten und keine Balancing-Zahlen.

| Datei | Inhalt |
| --- | --- |
| `config.json` | Startwerte (Spec R-3 bis R-16) |
| `races.json` | Rassen und ihre Resonanz-Boni (R-17) |
| `classes.json` | Klassen und ihr Kampfverhalten (R-9.4) |
| `cards.json` | Alle Karten inkl. Tokens |
| `leaders.json` | Anführer mit Kampfwerten, Mana-Fähigkeit, aktiver Fähigkeit und Ästen (R-16) |

## Karten

Pflichtfelder: `id`, `name`, `type` (`resource` | `unit` | `spell` | `curse`), `cost`, `pool`.

- `pool`: `starter` (nur Startdeck), `basic` (immer im Königreich), `kingdom`, `class:<classId>` (privater Klassen-Pool), `token` (nie im Deck).
- `pileSize`: optional; sonst aus `config.pileSizeByCost` bzw. `config.classPoolPileSize`.
- `buyable`: Standard `true`.
- Ressourcen: `gold`.
- Einheiten: `race` (oder `null`), `class`, `stats` (`attack`, `hp`, `breakthrough`, `range`, optional `armor`, `attackInterval`, `moveInterval`, `manaMax`), optional `keywords`, `abilities`, `altCost`, `starterFor`.
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
- `trash.from`: `chosenHandCards`
- `costModifier.appliesTo`: `raceCards`
- `returnOnDeath.limit`: `firstRaceUnitPerCombat`, `oncePerUnitPerCombat`
- `giveCurse.to`, `stealGold.from`: Spieler-Ziele (siehe unten)
- `startManaPercent.when`: `now` \| `nextRound`; `startManaPercent.class`: Klassen-ID
- `buff.stat`, `statOverride`-Schlüssel: `attack`, `hp`, `breakthrough`, `range`, `armor`, `attackInterval`, `moveInterval`, `manaMax`

`amount` ist eine Zahl oder ein berechneter Wert: `{ "kind": "distinctOwnRaces" }`, `{ "kind": "selfAttackTimes", "factor": n }`.

### Ziele (`target`)
Als Text: `self`, `currentTarget`, `currentTargetAndNeighbors`, `weakestAlly` (wenigste aktuelle LP), `adjacentAllies`, `allAllies`, `alliesInArena`, `zoneAllies`, `raceUnits`, `ownClassUnits`, `hexEnemies`, `hexNeighborEnemies`, `hexAndNeighborEnemies`, `hexAlly`, `chosenUnits`.
Als Objekt: `{ "kind": "nearestEnemies", "count": n }`, `{ "kind": "alliesInRange", "range": r }`.
Spieler: `frontOpponent`, `frontOpponentTreasury`, `targetPlayer`.

### Ziel-Angaben bei Zaubern und Anführer-Fähigkeiten
`{ "kind": "hex" | "zone" | "player" | "handCards" | "moveUnits" | "none", … }`. Parameter: `hex`: `arenas`, optional `mustBeFree`; `zone`: `arenas`; `player`: `allowed` (`neighbors`); `handCards`: `max`; `moveUnits`: `count`, `destination` (`ownFreeHex` \| `participatingFreeHex`, R-16.6). `arenas`: `participating` (eigene Fronten und Mitte, R-14.2) oder `own` (nur eigene Zonen).

### Schlüsselwörter
`firstStrike` (R-9.3), `unwoundable`, `woundOnKill`.

## Anführer

`active.category` bestimmt die Reihenfolge in R-8.2. `base` gilt auf Stufe 1, `branches[].levels` ab Stufe 2. Zusätzliche Parameter einer Stufe:
- `zones` (Brann): Anzahl wählbarer Zonen
- `hexes` (Ilyra): Anzahl wählbarer Felder
- `count` (Vex): Anzahl bewegbarer Einheiten

## Validierung

`loadGameData()` prüft alle Dateien beim Laden (`src/validate.ts`) und wirft bei Fehlern einen `GameDataError` mit allen Fundstellen. Geprüft werden: Pflichtfelder und Datentypen, unbekannte Felder (Tippfehler; Felder mit `_` am Anfang sind Kommentare), jeder `op`, jedes `target`, jeder Auslöser, jede Bedingung, jedes Schlüsselwort, doppelte IDs sowie alle Verweise auf Rassen, Klassen und Tokens. Wer einen neuen Baustein oder Wert einführt, ergänzt ihn in `src/dataTypes.ts`, in `src/validate.ts` und in dieser Datei.
