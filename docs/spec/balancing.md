# Balancing-Grundsätze

Vorgaben von Jan (2026-10-28). Gelten für das Tuning (M4), für neue Karten und für Evolutionen.

## B-1 Goldwert-Parität

- Was gleich viel Gold kostet, soll ungefähr gleich stark sein.
- **Verschmelzen:** Eine ★2-Einheit aus drei Kopien einer Einheit mit Kosten *k* (zusammen 3·*k* Gold) soll ungefähr so stark sein wie eine ★1-Einheit mit Kosten 3·*k*, **etwas stärker** (Richtwert +10 bis +20 %), weil sie mehr Aufwand bedeutet (drei Kopien kaufen, ziehen, ausspielen).
- Gleiches gilt sinngemäß für ★3 gegenüber noch teureren Einheiten und für Evolutionen (E-6 in `erweiterungen.md`).

## B-2 Teure Einheiten: größere und komplexere Effekte

Teure Einheiten werden nicht nur über höhere Zahlen stärker, sondern über **größere Wirkungsbereiche** (mehr Felder, mehr Ziele) und **komplexere Effekte** (Synergien, Bedingungen, Effekte über Systemgrenzen). Billige Einheiten haben einfache, direkte Effekte. So bleiben billige Massenstrategien (Verschmelzen) und teure Einzelstrategien gleichwertig, ohne dass eine die andere immer dominiert.

## B-3 Messung

- **Kalibrierungs-Kämpfe** (Aufgabe B0): automatisch erzeugte Armeen mit gleichem Goldwert kämpfen in der Frontarena gegeneinander, über viele zufällige Aufstellungen.
  - Ziel für Armeen gleichen Goldwerts: Siegquote je Karte zwischen 45 und 55 %.
  - Ziel für ★2 gegen eine ★1-Einheit mit dreifachen Kosten: Siegquote 50 bis 65 % für die ★2-Einheit.
- **Partie-Simulationen** (B1/B2): kein Anführer über 35 % Siegquote in 4er-Partien (fair wären 25 %), keine Siegart unter 10 % Anteil, Partien im Mittel 15 bis 20 Runden.
- Abweichungen werden über [TUNING]-Werte und Kartenwerte korrigiert und in `docs/ENTSCHEIDUNGEN.md` festgehalten. Kartenwerte (Angriff, Leben, Durchbruch, Effektzahlen) dürfen Agenten dafür um höchstens ±50 % ändern; Effekttexte nicht.
