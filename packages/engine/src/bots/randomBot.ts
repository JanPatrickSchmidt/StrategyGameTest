/**
 * `RandomBot` (E14a): wählt in jedem Abschnitt (`play`, `buy`, `position`, R-5) zufällig unter den
 * gültigen Aktionen. Gültig heißt: die Engine nimmt die Aktion im Planungsentwurf an (`PlanningDraft`).
 * Zufall nur über den eigenen Seed (`rng.ts`).
 */
import { PLANNING_SECTIONS, type Planning } from "../actions";
import type { GameData } from "../data";
import { createRngState, nextInt, type RngState, shuffleInPlace } from "../rng";
import { PlanningDraft } from "../round";
import type { GameState, PlayerIndex } from "../state";
import type { Bot } from "./bot";
import { candidateActions } from "./candidates";

export interface RandomBotOptions {
  /** Höchstzahl angenommener Aktionen je Abschnitt. */
  maxActionsPerSection?: number;
  /** Chance (0–1), vor jeder weiteren Aktion den Abschnitt zu beenden. */
  stopChance?: number;
}

export class RandomBot implements Bot {
  readonly name = "random";
  private readonly rng: RngState;
  private readonly maxActions: number;
  private readonly stopChance: number;

  constructor(seed: number, options: RandomBotOptions = {}) {
    this.rng = createRngState(seed);
    this.maxActions = options.maxActionsPerSection ?? 6;
    this.stopChance = options.stopChance ?? 0.25;
  }

  plan(state: GameState, data: GameData, player: PlayerIndex): Planning {
    const draft = new PlanningDraft(state, data, player);
    for (const section of PLANNING_SECTIONS) {
      draft.enter(section);
      for (let n = 0; n < this.maxActions; n++) {
        if (nextInt(this.rng, 1_000_000) < this.stopChance * 1_000_000) break;
        const candidates = shuffleInPlace(this.rng, candidateActions(draft, data, this.rng));
        const accepted = candidates.some((action) => draft.attempt(action) === null);
        if (!accepted) break;
      }
    }
    return draft.planning;
  }
}
