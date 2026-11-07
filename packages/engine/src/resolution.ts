/**
 * Kampfauswertung (E12, R-10), Phase `combatResolution`.
 *
 * E12a: Durchbruch-Schaden und Grundschaden an den Fronten (R-10.1, R-10.5) sowie die Beute bei leerer
 * Front (R-10.2, Gold sofort in die Schatzkammer nach R-10.3). E12b: Halteserie und Belohnung der Mitte
 * (R-10.4). E12c: Schwung und Trotz (R-10.6) und Anführer-XP für überlebte Kämpfe (R-10.8). Das Ausscheiden
 * folgt in E12d.
 */
import type { ConfigData, GameData } from "./data";
import { gainLeaderXp } from "./aftermath";
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

/** R-10.6: Ausgang einer Runde für einen Spieler nach seinen Frontkämpfen. */
export type RoundOutcome = "won" | "lost" | "neutral";

/**
 * R-10.6: Zählt gewonnene und verlorene Frontkämpfe eines Spielers in dieser Runde. Unentschieden und Fronten
 * ohne Kampf zählen weder als Sieg noch als Niederlage; die Mitte zählt nicht. Mehr Siege als Niederlagen =
 * gewonnen, umgekehrt verloren, sonst neutral.
 */
export function roundOutcome(state: GameState, player: PlayerIndex): { outcome: RoundOutcome; wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const result of state.frontResults) {
    if (result.round !== state.round) continue;
    if (result.winner === player) wins += 1;
    else if (frontLoser(result) === player) losses += 1;
  }
  const outcome: RoundOutcome = wins > losses ? "won" : losses > wins ? "lost" : "neutral";
  return { outcome, wins, losses };
}

/**
 * R-10.6: Bonusgold für eine Serie der Länge `streak` = `gold` des Eintrags aus `config.streakGold` mit dem
 * größten `minStreak` ≤ `streak`, sonst 0. Gilt für Sieges- und Niederlagenserien gleich.
 */
export function streakGold(config: ConfigData, streak: number): number {
  let best: ConfigData["streakGold"][number] | null = null;
  for (const entry of config.streakGold) {
    if (entry.minStreak <= streak && (best === null || entry.minStreak > best.minStreak)) best = entry;
  }
  return best?.gold ?? 0;
}

/**
 * R-10.6: Schwung und Trotz. Für jeden nicht ausgeschiedenen Spieler (Prioritätsreihenfolge spielt keine Rolle,
 * es wird nach Spielerindex abgehandelt): gewonnene Runde → Siegesserie +1, Niederlagenserie 0; verlorene Runde
 * umgekehrt; neutrale Runde → beide Serien unverändert. Danach Bonusgold für die laufende Serie sofort in die
 * Schatzkammer (R-10.3), auch in einer neutralen Runde (F49, R-1.9). Ereignisse `round_outcome`, dann
 * `streak_gold` und `gold_gained`.
 */
export function resolveStreaks(state: GameState, data: GameData): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    const { outcome, wins, losses } = roundOutcome(state, p.index);
    if (outcome === "won") {
      p.winStreak += 1;
      p.lossStreak = 0;
    } else if (outcome === "lost") {
      p.lossStreak += 1;
      p.winStreak = 0;
    }
    emit(state, { type: "round_outcome", player: p.index, outcome, wins, losses, winStreak: p.winStreak, lossStreak: p.lossStreak });
    const kind = p.winStreak > 0 ? "win" : p.lossStreak > 0 ? "loss" : null;
    if (kind === null) continue;
    const streak = kind === "win" ? p.winStreak : p.lossStreak;
    const amount = streakGold(data.config, streak);
    if (amount <= 0) continue;
    emit(state, { type: "streak_gold", player: p.index, kind, streak, amount });
    gainGoldAfterPlanning(state, p.index, amount);
  }
}

/**
 * R-10.8: Ein Anführer, der in dieser Runde an einem Kampf teilgenommen und ihn überlebt hat, erhält
 * `config.leader.xpPerSurvivedFight` XP (je solchem Kampf; ein Anführer steht in einer Runde nur in einer
 * Arena). Wie bei den Einheiten-XP (F36) zählen auch die leere Front und die unbestrittene Mitte (F49).
 * Reihenfolge: Fronten wie im Ergebnis, dann die Mitte. Ereignis `leader_xp_gained`.
 */
export function grantLeaderFightXp(state: GameState, data: GameData): void {
  const amount = data.config.leader.xpPerSurvivedFight;
  if (amount <= 0) return;
  const fights: { participants: readonly number[]; survivors: readonly number[] }[] = state.frontResults.filter(
    (r) => r.round === state.round,
  );
  if (state.centerResult !== null && state.centerResult.round === state.round) fights.push(state.centerResult);
  for (const fight of fights) {
    for (const p of state.players) {
      if (p.eliminated) continue;
      const id = p.leader.unitId;
      if (fight.participants.includes(id) && fight.survivors.includes(id)) gainLeaderXp(state, p.index, amount);
    }
  }
}

/**
 * R-10: Kampfauswertung in der Phase `combatResolution`: Fronten (E12a), Mitte (E12b), Schwung und Trotz,
 * Anführer-XP (E12c).
 */
export function runCombatResolution(state: GameState, data: GameData): void {
  resolveFrontDamage(state, data);
  resolveCenterHold(state, data);
  resolveStreaks(state, data);
  grantLeaderFightXp(state, data);
}
