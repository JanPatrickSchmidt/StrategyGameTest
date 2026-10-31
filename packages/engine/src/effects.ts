/**
 * Effekt-System im Kampf (E10a, Spec R-9.0, R-9.3, R-9.5, R-9.6, R-14.1, R-14.3).
 *
 * Wertet die Fähigkeiten der Kämpfer (Karten, Tokens, Anführer) über die Haken der Kampfsimulation aus:
 * Auslöser `onCombatStart`, `onManaFull`, `onDeath`, `onKill`, `onAllyDeath` und die Bausteine, die nur
 * die Simulation betreffen (`damage`, `heal`, `shield`, `buff`, `stun`, `gainMana`, `summon`,
 * `grantKeyword`). Bausteine, die über den Kampf hinaus wirken (z. B. `gainGold`, `gainLeaderXp`) und
 * dauerhafte Buffs werden als `DeferredEffect` gesammelt; die Anwendung auf den Spielzustand folgt mit E10b.
 */
import {
  addMana,
  buffFighter,
  type CombatHooks,
  type CombatSim,
  dealDamage,
  type Fighter,
  type FighterInit,
  fighterFromData,
  grantFighterKeyword,
  healFighter,
  isCellFree,
  shieldFighter,
  spawnFighter,
  stunFighter,
} from "./combat";
import type { GameData } from "./data";
import type { Ability, Amount, Effect, Trigger, UnitTarget } from "./dataTypes";
import { compareRowCol, hexDistance, neighbors } from "./hex";

/** Auslöser, die während der Kampfsimulation ausgewertet werden. */
export const COMBAT_TRIGGERS: readonly Trigger[] = ["onCombatStart", "onManaFull", "onDeath", "onKill", "onAllyDeath"];

/** Ein im Kampf ausgelöster Effekt, der den Spielzustand betrifft (Anwendung mit E10b). */
export interface DeferredEffect {
  tick: number;
  /** Kämpfer, dessen Fähigkeit ausgelöst hat. */
  unit: number;
  team: number;
  sourceId: string;
  trigger: Trigger;
  effect: Effect;
  /** Bei dauerhaften Buffs: die betroffenen Kämpfer (im Kampf schon angewendet). */
  targets?: number[];
}

export interface EffectHooks {
  hooks: CombatHooks;
  deferred: DeferredEffect[];
}

/** Haken für `createCombat`/`simulateCombat`, die alle Kampf-Fähigkeiten auswerten. */
export function effectHooks(data: GameData): EffectHooks {
  const deferred: DeferredEffect[] = [];
  const run = (sim: CombatSim, f: Fighter, trigger: Trigger): void => runTrigger(data, sim, f, trigger, deferred);
  const hooks: CombatHooks = {
    onCombatStart: (sim, f) => run(sim, f, "onCombatStart"),
    onManaFull: (sim, f) => run(sim, f, "onManaFull"),
    // R-9.6: sofort beim Tod. Reihenfolge: die sterbende Einheit, dann der Bezwinger, dann die
    // lebenden Verbündeten in derselben Arena nach aufsteigender ID.
    onDeath: (sim, f, killer) => {
      run(sim, f, "onDeath");
      if (killer && killer.alive && killer.team !== f.team) run(sim, killer, "onKill");
      for (const ally of [...sim.fighters]) {
        if (ally.alive && ally.team === f.team && ally.id !== f.id) run(sim, ally, "onAllyDeath");
      }
    },
  };
  return { hooks, deferred };
}

function runTrigger(data: GameData, sim: CombatSim, f: Fighter, trigger: Trigger, deferred: DeferredEffect[]): void {
  for (const ability of f.abilities) {
    if (ability.trigger !== trigger || !conditionHolds(ability)) continue;
    for (const effect of ability.effects) applyEffect(data, sim, f, trigger, effect, deferred);
  }
}

/** Bedingungen (`inReserve`, `wonFrontThisRound`) gelten nie für Kampf-Auslöser. */
function conditionHolds(ability: Ability): boolean {
  return ability.condition === undefined;
}

// ---------------------------------------------------------------------------
// Werte und Ziele
// ---------------------------------------------------------------------------

/** Berechnete Werte (`data/README.md`). */
export function resolveAmount(sim: CombatSim, f: Fighter, amount: Amount): number {
  if (typeof amount === "number") return amount;
  switch (amount.kind) {
    case "selfAttackTimes":
      return f.attack * amount.factor;
    case "distinctOwnRaces": {
      // Verschiedene Rassen unter den lebenden eigenen Kämpfern dieser Arena (inkl. Anführer, Tokens), F30.
      const races = new Set<string>();
      for (const o of sim.fighters) if (o.alive && o.team === f.team && o.race !== null) races.add(o.race);
      return races.size;
    }
  }
}

const byId = (a: Fighter, b: Fighter): number => a.id - b.id;

function allies(sim: CombatSim, f: Fighter): Fighter[] {
  return sim.fighters.filter((o) => o.alive && o.team === f.team);
}

function enemies(sim: CombatSim, f: Fighter): Fighter[] {
  return sim.fighters.filter((o) => o.alive && o.team !== f.team);
}

/**
 * Einheiten-Ziele im Kampf, nach ID aufsteigend. „Verbündete“ schließen die Einheit selbst ein, außer bei
 * `adjacentAllies` (F30). Ziele, die nur Zauber und Anführer-Fähigkeiten nutzen (Feld, Zone, gewählte
 * Einheiten), gibt es im Kampf nicht (E11) und treffen niemanden.
 */
export function resolveUnitTargets(sim: CombatSim, f: Fighter, target: UnitTarget): Fighter[] {
  if (typeof target === "object") {
    if (target.kind === "nearestEnemies") {
      // Hex-Abstand, dann wenigste aktuelle Lebenspunkte, dann kleinste ID.
      return enemies(sim, f)
        .sort((a, b) => hexDistance(f.pos, a.pos) - hexDistance(f.pos, b.pos) || a.hp - b.hp || a.id - b.id)
        .slice(0, target.count)
        .sort(byId);
    }
    return allies(sim, f).filter((o) => hexDistance(f.pos, o.pos) <= target.range);
  }
  const current = (): Fighter | undefined => {
    if (f.targetId === null) return undefined;
    const t = sim.fighters.find((o) => o.id === f.targetId);
    return t && t.alive && t.team !== f.team ? t : undefined;
  };
  switch (target) {
    case "self":
      return f.alive ? [f] : [];
    case "currentTarget": {
      const t = current();
      return t ? [t] : [];
    }
    case "currentTargetAndNeighbors": {
      const t = current();
      if (!t) return [];
      return enemies(sim, f).filter((o) => o.id === t.id || hexDistance(o.pos, t.pos) === 1);
    }
    case "weakestAlly": {
      const w = allies(sim, f).sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
      return w ? [w] : [];
    }
    case "adjacentAllies":
      return allies(sim, f).filter((o) => hexDistance(o.pos, f.pos) === 1);
    case "allAllies":
    case "alliesInArena":
      return allies(sim, f);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function applyEffect(
  data: GameData,
  sim: CombatSim,
  f: Fighter,
  trigger: Trigger,
  effect: Effect,
  deferred: DeferredEffect[],
): void {
  const defer = (targets?: Fighter[]): void => {
    const entry: DeferredEffect = { tick: sim.tick, unit: f.id, team: f.team, sourceId: f.sourceId, trigger, effect };
    if (targets) entry.targets = targets.map((t) => t.id);
    deferred.push(entry);
  };
  switch (effect.op) {
    case "damage": {
      // R-9.5: Fähigkeitsschaden geht durch Schild und Panzer. Ziele werden vorher festgelegt.
      const amount = resolveAmount(sim, f, effect.amount);
      for (const t of resolveUnitTargets(sim, f, effect.target)) dealDamage(sim, f, t, amount, "ability");
      return;
    }
    case "heal": {
      const amount = resolveAmount(sim, f, effect.amount);
      for (const t of resolveUnitTargets(sim, f, effect.target)) healFighter(sim, f, t, amount);
      return;
    }
    case "shield": {
      const amount = resolveAmount(sim, f, effect.amount);
      for (const t of resolveUnitTargets(sim, f, effect.target)) shieldFighter(sim, f, t, amount);
      return;
    }
    case "buff": {
      const amount = resolveAmount(sim, f, effect.amount);
      const targets = resolveUnitTargets(sim, f, effect.target);
      for (const t of targets) buffFighter(sim, f, t, effect.stat, amount);
      // Dauerhafte Buffs gelten sofort im Kampf und werden für den Spielzustand vorgemerkt (E10b).
      if (effect.duration === "permanent" && targets.length > 0) defer(targets);
      return;
    }
    case "stun":
      for (const t of resolveUnitTargets(sim, f, effect.target)) stunFighter(sim, t, effect.ticks);
      return;
    case "gainMana": {
      const amount = resolveAmount(sim, f, effect.amount);
      for (const t of resolveUnitTargets(sim, f, effect.target)) addMana(sim, f, t, amount);
      return;
    }
    case "grantKeyword":
      for (const t of resolveUnitTargets(sim, f, effect.target)) grantFighterKeyword(sim, f, t, effect.keyword);
      return;
    case "summon":
      summon(data, sim, f, effect);
      return;
    default:
      // Wirkt außerhalb der Kampfsimulation (E10b, E11).
      defer();
  }
}

/**
 * `summon` im Kampf: `adjacentFree` = freie Nachbarfelder der Einheit, kleinstes `(row, col)` zuerst.
 * Ohne freies Feld entsteht kein Token. Andere Platzierungen nutzen Zauber (E11).
 */
function summon(data: GameData, sim: CombatSim, f: Fighter, effect: Extract<Effect, { op: "summon" }>): void {
  if (effect.where !== "adjacentFree") return;
  for (let i = 0; i < effect.count; i++) {
    const cell = neighbors(f.pos, sim.size)
      .filter((c) => isCellFree(sim, c))
      .sort(compareRowCol)[0];
    if (!cell) return;
    const init: FighterInit = fighterFromData(data, {
      id: 0,
      team: f.team,
      kind: "token",
      sourceId: effect.token,
      stars: 1,
      pos: cell,
    });
    const { id: _id, pos: _pos, ...rest } = init;
    if (effect.statOverride) rest.stats = { ...rest.stats, ...effect.statOverride };
    spawnFighter(sim, f, rest, cell);
  }
}
