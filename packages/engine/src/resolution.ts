/**
 * Kampfauswertung (E12, R-10), Phase `combatResolution`.
 *
 * E12a: Durchbruch-Schaden und Grundschaden an den Fronten (R-10.1, R-10.5) sowie die Beute bei leerer
 * Front (R-10.2, Gold sofort in die Schatzkammer nach R-10.3). E12b: Halteserie und Belohnung der Mitte
 * (R-10.4). Schwung/Trotz und Anführer-XP folgen in E12c, das Ausscheiden in E12d.
 */
import type { ConfigData, GameData } from "./data";
import { gainGoldAfterPlanning } from "./economy";
import { emit, type FrontResult, type GameState, getPlayer, type PlayerIndex } from "./state";

type CenterReward = ConfigData["center"]["rewards"][number];

/** R-10.5: Grundschaden einer Runde = `base + max(0, Runde − rampStartsAfterRound) × perRound` aus `config.baseDamage`. */
export function baseDamage(config: ConfigData, round: number): number {
  const b = config.baseDamage;
  return b.base + Math.max(0, round - b.rampStartsAfterRound) * b.perRound;
}

/** Verlierer einer Front-Paarung mit Sieger, sonst `null` (Unentschieden oder kein Kampf). */
export function frontLoser(result: FrontResult): PlayerIndex | null {
  if (result.winner === null) return null;
  return result.winner === result.first ? result.second : result.first;
}

/**
 * R-10.1, R-10.2, R-10.5: Für jede Front-Paarung der Runde (in der Reihenfolge der Ergebnisse) verliert der
 * Verlierer Leben = Durchbruch der überlebenden Einheiten des Siegers + Grundschaden. Bei leerer Front bekommt
 * der Sieger zusätzlich `config.emptyFrontLoot` Gold sofort in die Schatzkammer. Unentschieden und Fronten
 * ohne Kampf richten keinen Schaden an. Leben darf unter 0 fallen; ausgeschieden wird erst nach der ganzen
 * Kampfauswertung (R-13.1, E12d).
 */
export function resolveFrontDamage(state: GameState, data: GameData): void {
  const base = baseDamage(data.config, state.round);
  for (const result of state.frontResults) {
    if (result.round !== state.round) continue;
    const loser = frontLoser(result);
    if (loser === null || result.winner === null) continue;
    const winner = result.winner;
    const amount = result.winnerBreakthrough + base;
    const p = getPlayer(state, loser);
    p.life -= amount;
    emit(state, {
      type: "breakthrough_damage",
      arena: result.arena,
      winner,
      loser,
      breakthrough: result.winnerBreakthrough,
      baseDamage: base,
      amount,
      life: p.life,
    });
    if (result.outcome === "emptyFront") {
      const loot = data.config.emptyFrontLoot;
      emit(state, { type: "front_loot", arena: result.arena, player: winner, amount: loot });
      gainGoldAfterPlanning(state, winner, loot);
    }
  }
}

/**
 * R-10.4: Belohnung für eine Halteserie der Länge `streak` = der Eintrag aus `config.center.rewards` mit der
 * größten Serienlänge ≤ `streak` (der letzte Eintrag gilt für alle längeren Serien). `null` = keine.
 */
export function centerReward(config: ConfigData, streak: number): CenterReward | null {
  let best: CenterReward | null = null;
  for (const reward of config.center.rewards) {
    if (reward.streak <= streak && (best === null || reward.streak > best.streak)) best = reward;
  }
  return best;
}

/**
 * R-10.4: Mitte. Der Halter der Mitte dieser Runde (`state.centerResult.holder`) erhöht seine Halteserie um 1,
 * alle anderen Spieler setzen ihre auf 0 (ohne Halter alle). Danach bekommt der Halter die Belohnung seiner
 * Serie: Gold sofort in die Schatzkammer (R-10.3), Bonuskarten beim Nachziehen am Rundenende (R-12.6, über
 * `nextRound.cards`) und Machtpunkte sofort. Ereignisse: `center_streak_reset` je zurückgesetzter Serie (nur
 * wenn sie > 0 war), `center_held`, dann `gold_gained` und `power_gained`.
 */
export function resolveCenterHold(state: GameState, data: GameData): void {
  const result = state.centerResult;
  const holder = result !== null && result.round === state.round ? result.holder : null;
  for (const p of state.players) {
    if (p.index === holder || p.centerStreak === 0) continue;
    const previous = p.centerStreak;
    p.centerStreak = 0;
    emit(state, { type: "center_streak_reset", player: p.index, previous });
  }
  if (holder === null) return;
  const p = getPlayer(state, holder);
  p.centerStreak += 1;
  const reward = centerReward(data.config, p.centerStreak);
  const gold = reward?.gold ?? 0;
  const cards = reward?.cards ?? 0;
  const power = reward?.power ?? 0;
  emit(state, { type: "center_held", player: holder, streak: p.centerStreak, gold, cards, power });
  if (gold > 0) gainGoldAfterPlanning(state, holder, gold);
  if (cards > 0) p.nextRound.cards += cards;
  if (power > 0) {
    p.power += power;
    emit(state, { type: "power_gained", player: holder, amount: power, power: p.power });
  }
}

/** R-10: Kampfauswertung in der Phase `combatResolution`: Fronten (E12a), dann die Mitte (E12b). */
export function runCombatResolution(state: GameState, data: GameData): void {
  resolveFrontDamage(state, data);
  resolveCenterHold(state, data);
}
