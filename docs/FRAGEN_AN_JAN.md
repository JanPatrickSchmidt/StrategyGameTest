# Fragen an Jan

Offene Design-Fragen. Jede Frage nennt die **Standardlösung**, mit der bis zu Jans Antwort gearbeitet wird. Neue Fragen unten anhängen, beantwortete nach `docs/ENTSCHEIDUNGEN.md` verschieben.

| Nr. | Frage | Standard bis zur Antwort | Seit |
| --- | --- | --- | --- |
| F22 | Zauber haben laut Kartendaten einen festen Slot (`pre` oder `post`). Darf ein Spieler einen Zauber auch in den anderen Slot legen (R-7.3 nennt `slot` als Wahl)? | Nein: Der Slot muss zum Slot der Karte passen, sonst Ablehnung `wrongSlot`. | 2026-10-29 |
| F23 | Sind die Anzahlen bei Anführer-Fähigkeiten (Brann „Weite“: Zonen, Ilyra „Kette“: Felder, Vex: bewegte Einheiten) Höchstwerte oder Pflicht? | Höchstwerte: mindestens 1, höchstens die Zahl der Stufe; verschiedene Zonen/Felder/Einheiten (R-1.9). | 2026-10-29 |
| F24 | „Eigene Felder“ (`arenas: own`, z. B. Schutzrune, Morgras Beschwörung) in der Mittelarena: nur der eigene Startbereich (5 Felder)? Und „freies Feld“ wird beim Planen nur gegen eigene Einheiten geprüft? | Ja: in der Mitte nur der eigene Startbereich (R-3.4); beim Planen zählt nur, ob eine eigene Einheit dort steht, Konflikte mit fremden Einheiten klärt die Auflösung (R-8.2, R-8.5). | 2026-10-29 |
| F25 | Verschmelzen (R-15.1): Behält die neue Einheit die Identität einer der drei Einheiten? Und welche drei verschmelzen, wenn es ausnahmsweise mehr als drei gleiche gibt? | Die Einheit mit den meisten XP (Gleichstand: kleinste ID) bleibt bestehen, bekommt den Stern, die XP und die Karten der anderen beiden; die anderen verschwinden. Spätere Aktionen derselben Planung, die sich auf diese Einheit beziehen, bleiben dadurch gültig. Bei mehr als drei gleichen verschmelzen die drei mit den meisten XP (R-1.9: möglichst viel XP bleibt erhalten). Verschmolzen wird nach jeder Aktion, auch nach einer abgelehnten. | 2026-10-30 |
