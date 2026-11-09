/**
 * Bots (E14): ein Bot liefert für einen Spieler die Planung einer Runde (R-5). Bots sind rein und
 * deterministisch: Zufall nur über einen eigenen Seed-Generator, nie über den Zufall der Partie.
 */
import type { Planning } from "../actions";
import type { GameData } from "../data";
import type { GameState, PlayerIndex } from "../state";

export interface Bot {
  /** Kurzname für Protokolle und Simulation, z. B. `random`. */
  readonly name: string;
  /**
   * Planung für `player` in der laufenden Planungsphase. Der Bot bekommt den vollständigen Zustand, nutzt
   * aber nur, was der Spieler sehen darf (eigene Karten und öffentliche Informationen, R-18).
   */
  plan(state: GameState, data: GameData, player: PlayerIndex): Planning;
}
