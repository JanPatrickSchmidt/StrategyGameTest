/**
 * Partie mit Bots durchspielen (E14): `advance` bis zur Planung, jeder wartende Spieler bekommt die
 * Planung seines Bots (in Spielerreihenfolge), dann weiter bis zum Spielende (R-13).
 */
import type { GameData } from "../data";
import { advance, submitPlanning } from "../round";
import { createGame, defaultLeaders } from "../setup";
import type { GameState } from "../state";
import type { Bot } from "./bot";

export interface BotGameOptions {
  seed: number;
  /** Ein Bot je Spieler, Index = Spieler. */
  bots: readonly Bot[];
  leaders?: readonly string[];
}

/** Spielt eine Partie vollständig und gibt den Endzustand zurück (`state.result` ist gesetzt). */
export function playBotGame(data: GameData, options: BotGameOptions): GameState {
  if (options.bots.length !== data.config.players) {
    throw new RangeError(`Es werden genau ${data.config.players} Bots benötigt, erhalten: ${options.bots.length}`);
  }
  const state = createGame(data, options.leaders ?? defaultLeaders(data), options.seed);
  // Jede Runde wartet höchstens einmal auf Planungen; mehr Durchläufe als Runden bedeuten einen Fehler.
  const maxSteps = data.config.maxRounds + 2;
  for (let step = 0; step < maxSteps; step++) {
    const result = advance(state, data);
    if (result.waitingFor === "nothing") return state;
    for (const player of [...result.players].sort((a, b) => a - b)) {
      const bot = options.bots[player] as Bot;
      const submitted = submitPlanning(state, player, bot.plan(state, data, player));
      if (!submitted.ok) throw new Error(`Planung von Spieler ${player} abgelehnt: ${submitted.reason}`);
    }
  }
  throw new Error(`Partie nach ${maxSteps} Planungsrunden nicht beendet`);
}
