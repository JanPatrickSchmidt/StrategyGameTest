/**
 * Partie im Browser (C1): reine Logik ohne DOM, damit sie getestet werden kann.
 *
 * Spieler 0 ist der Mensch, die Spieler 1–3 sind Bots (GreedyBot). Die Engine läuft vollständig lokal.
 * `GameSession` treibt die Partie mit `advance` voran, lässt die Bots ihre Planung einreichen und hält an,
 * sobald die Planung des Menschen fehlt oder die Partie vorbei ist. Der Mensch plant mit `planner()` (C3a),
 * reicht eine leere Planung ein (R-7.9) oder lässt den Autopiloten (GreedyBot für Spieler 0) planen.
 */
import {
  advance,
  type Bot,
  createGame,
  defaultLeaders,
  type GameData,
  type GameState,
  GreedyBot,
  type Planning,
  type PlayerIndex,
  type PlayerView,
  playerView,
  submitPlanning,
  type SubmitResult,
} from "@game/engine";
import { PlanBuilder } from "./planner";

/** Der Mensch spielt immer auf Platz 0. */
export const HUMAN: PlayerIndex = 0;

export type SessionStatus = "waitingForHuman" | "gameOver";

export interface SessionOptions {
  seed: number;
  /** Anführer je Spieler (Index = Spieler); fehlt = Standard der Daten. */
  leaders?: readonly string[];
}

/** Seed des Bots für einen Spieler; getrennt vom Zufall der Partie (siehe `bots/bot.ts`). */
export function botSeed(gameSeed: number, player: PlayerIndex): number {
  return (gameSeed * 31 + player + 1) >>> 0;
}

export class GameSession {
  readonly state: GameState;
  private readonly bots: Bot[];
  private currentStatus: SessionStatus = "waitingForHuman";

  constructor(
    readonly data: GameData,
    readonly options: SessionOptions,
  ) {
    this.state = createGame(data, options.leaders ?? defaultLeaders(data), options.seed);
    // Ein Bot je Platz; der Bot auf Platz 0 ist der Autopilot des Menschen.
    this.bots = Array.from({ length: data.config.players }, (_, p) => new GreedyBot(botSeed(options.seed, p as PlayerIndex)));
    this.run();
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  /** Sicht des Menschen (R-18.3): nur, was Spieler 0 sehen darf. */
  view(): PlayerView {
    return playerView(this.state, HUMAN);
  }

  /** Reicht die Planung des Menschen ein und spielt bis zur nächsten Planung des Menschen oder zum Ende. */
  submitHuman(planning: Partial<Planning>): SubmitResult {
    if (this.currentStatus !== "waitingForHuman") return { ok: false, reason: "wrongPhase" };
    const result = submitPlanning(this.state, HUMAN, planning);
    if (result.ok) this.run();
    return result;
  }

  /** C3a: neuer Planungsentwurf für die laufende Planung des Menschen. */
  planner(): PlanBuilder {
    if (this.currentStatus !== "waitingForHuman") throw new RangeError("Keine Planung offen");
    return new PlanBuilder(this.state, this.data, HUMAN);
  }

  /** R-7.9: leere Planung (der Mensch tut in dieser Runde nichts). */
  pass(): SubmitResult {
    return this.submitHuman({ play: [], buy: [], position: [] });
  }

  /** Der Autopilot (GreedyBot) plant die laufende Runde für den Menschen. */
  autopilot(): SubmitResult {
    if (this.currentStatus !== "waitingForHuman") return { ok: false, reason: "wrongPhase" };
    return this.submitHuman(this.botFor(HUMAN).plan(this.state, this.data, HUMAN));
  }

  /** Spielt mit dem Autopiloten bis zum Spielende. */
  autopilotToEnd(): void {
    while (this.currentStatus === "waitingForHuman") {
      const result = this.autopilot();
      if (!result.ok) throw new Error(`Autopilot-Planung abgelehnt: ${result.reason}`);
    }
  }

  private botFor(player: PlayerIndex): Bot {
    const bot = this.bots[player];
    if (!bot) throw new RangeError(`Kein Bot für Spieler ${player}`);
    return bot;
  }

  /**
   * `advance`, bis die Planung des Menschen fehlt oder die Partie vorbei ist. Bots reichen in
   * Spielerreihenfolge ein. Scheidet der Mensch aus, laufen die Bots allein bis zum Ende weiter.
   */
  private run(): void {
    // Jede Runde wartet höchstens einmal; mehr Durchläufe als Runden bedeuten einen Fehler.
    const maxSteps = this.data.config.maxRounds + 2;
    for (let step = 0; step < maxSteps; step++) {
      const result = advance(this.state, this.data);
      if (result.waitingFor === "nothing") {
        this.currentStatus = "gameOver";
        return;
      }
      const waiting = [...result.players].sort((a, b) => a - b);
      for (const player of waiting) {
        if (player === HUMAN) continue;
        const submitted = submitPlanning(this.state, player, this.botFor(player).plan(this.state, this.data, player));
        if (!submitted.ok) throw new Error(`Planung von Bot ${player} abgelehnt: ${submitted.reason}`);
      }
      if (waiting.includes(HUMAN)) {
        this.currentStatus = "waitingForHuman";
        return;
      }
    }
    throw new Error(`Partie nach ${maxSteps} Durchläufen nicht beim Menschen angekommen`);
  }
}
