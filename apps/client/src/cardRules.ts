/**
 * Kartentexte aus den Effekt-Bausteinen (C5b2): reine Logik ohne DOM.
 *
 * Die Karten in `packages/engine/data/cards.json` haben keinen geschriebenen Regeltext; der Text entsteht hier
 * allein aus den Daten, damit er nie von der Engine abweicht:
 * - Einheiten: Rasse und Klasse (mit dem Kampfverhalten der Klasse, R-9.4), Werte (R-9.2, ★1), Schlüsselwörter,
 *   Fähigkeiten mit Auslöser und Bedingung (R-9.0, R-9.3, R-17a.1) und alternative Kosten (R-14.6).
 * - Zauber: Zeitpunkt (Vorkampf R-8.3 / Nachkampf R-8.4) mit Tempo, Ziel (R-7.3), Bedingung (verpufft sonst) und
 *   Wirkung.
 * - Ressourcen: Gold beim Ausspielen; Flüche (R-14.7): keine Wirkung.
 * Zahlen bei Schaden und Schild sind ★1-Werte; sie steigen mit dem Stern der Einheit (R-15.2).
 */
import type {
  Ability,
  AltCost,
  Amount,
  CardData,
  ConditionKind,
  Duration,
  Effect,
  GameData,
  Keyword,
  PlayerTarget,
  SpellCard,
  Stat,
  TargetSpec,
  Trigger,
  UnitCard,
  UnitTarget,
  UnitTargetName,
} from "@game/engine";

export const STAT_NAMES: Record<Stat, string> = {
  attack: "Angriff",
  hp: "Leben",
  breakthrough: "Durchbruch",
  range: "Reichweite",
  armor: "Panzer",
  attackInterval: "Angriffstakt",
  moveInterval: "Lauftakt",
  manaMax: "Mana",
};

export const KEYWORD_NAMES: Record<Keyword, string> = {
  firstStrike: "Erstschlag",
  unwoundable: "Unverwundbar",
  woundOnKill: "Verwundet beim Töten",
};

/** Kurze Erklärung der Schlüsselwörter (R-9.3, R-14.4). */
export const KEYWORD_HINTS: Record<Keyword, string> = {
  firstStrike: "handelt in jedem Tick vor den anderen",
  unwoundable: "kann nicht verwundet werden",
  woundOnKill: "von ihr besiegte Einheiten sind verwundet",
};

export const TRIGGER_TEXTS: Record<Trigger, string> = {
  onCombatStart: "Zu Kampfbeginn",
  onManaFull: "Bei vollem Mana",
  onDeath: "Wenn sie stirbt",
  onAllyDeath: "Wenn eine verbündete Einheit in derselben Arena stirbt",
  onKill: "Wenn sie eine gegnerische Einheit besiegt",
  onFrontWin: "Wenn ihre Seite den Frontkampf gewinnt",
  onRoundStart: "Zu Rundenbeginn",
};

export const CONDITION_TEXTS: Record<ConditionKind, string> = {
  inReserve: "wenn sie in der Reserve steht",
  wonFrontThisRound: "nur wenn du in dieser Runde eine Front gewonnen hast",
};

const DURATION_TEXTS: Record<Duration, string> = {
  combat: "für den Kampf",
  round: "für diese Runde",
  permanent: "dauerhaft",
};

/** Kampfverhalten der Klassen (R-9.4), nach `combatBehavior` in `classes.json`. */
const BEHAVIOR_TEXTS: Record<string, string> = {
  taunt: "zieht Angriffe auf sich",
  backlineJump: "springt zu Kampfbeginn neben das entfernteste gegnerische Ziel",
};

/** Einheiten-Ziele im Dativ („an …“, „bei …“). */
const UNIT_TARGET_TEXTS: Record<UnitTargetName, string> = {
  self: "sich selbst",
  currentTarget: "dem aktuellen Ziel",
  currentTargetAndNeighbors: "dem aktuellen Ziel und dessen Nachbarn",
  weakestAlly: "dem schwächsten Verbündeten (wenigste Leben)",
  adjacentAllies: "benachbarten Verbündeten",
  allAllies: "allen Verbündeten",
  alliesInArena: "allen Verbündeten in der Arena",
  zoneAllies: "allen eigenen Einheiten der gewählten Zone",
  raceUnits: "allen Einheiten dieser Rasse",
  ownClassUnits: "allen eigenen Einheiten der Klasse",
  hexEnemies: "den Gegnern auf dem gewählten Feld",
  hexNeighborEnemies: "den Gegnern auf den Nachbarfeldern",
  hexAndNeighborEnemies: "den Gegnern auf dem gewählten Feld und den Nachbarfeldern",
  hexAlly: "der eigenen Einheit auf dem gewählten Feld",
  chosenUnits: "den gewählten Einheiten",
};

const PLAYER_TARGET_TEXTS: Record<PlayerTarget, string> = {
  frontOpponent: "dem Gegner dieser Front",
  frontOpponentTreasury: "der Schatzkammer des Gegners dieser Front",
  targetPlayer: "dem gewählten Spieler",
};

/** Ziel einer Einheiten-Wirkung im Dativ, z. B. „den 3 nächsten Gegnern“. */
export function unitTargetText(data: GameData, target: UnitTarget, className?: string): string {
  if (typeof target !== "string") {
    if (target.kind === "nearestEnemies") return target.count === 1 ? "dem nächsten Gegner" : `den ${target.count} nächsten Gegnern`;
    return `Verbündeten im Umkreis von ${target.range} ${target.range === 1 ? "Feld" : "Feldern"}`;
  }
  if (target === "ownClassUnits" && className) return `allen eigenen ${data.classes.get(className)?.name ?? className}n`;
  return UNIT_TARGET_TEXTS[target];
}

/** Einheiten-Ziele im Akkusativ („verwundet …“); sonst die Dativ-Form in Klammern. */
const UNIT_TARGET_ACCUSATIVE: Partial<Record<UnitTargetName, string>> = {
  self: "sich selbst",
  currentTarget: "das aktuelle Ziel",
  currentTargetAndNeighbors: "das aktuelle Ziel und dessen Nachbarn",
  hexEnemies: "alle Gegner auf dem gewählten Feld",
  hexNeighborEnemies: "alle Gegner auf den Nachbarfeldern",
  hexAndNeighborEnemies: "alle Gegner auf dem gewählten Feld und den Nachbarfeldern",
  hexAlly: "die eigene Einheit auf dem gewählten Feld",
  chosenUnits: "die gewählten Einheiten",
};

function accusativeTarget(data: GameData, target: UnitTarget): string {
  if (typeof target === "string") {
    const text = UNIT_TARGET_ACCUSATIVE[target];
    if (text) return text;
  } else if (target.kind === "nearestEnemies") {
    return target.count === 1 ? "den nächsten Gegner" : `die ${target.count} nächsten Gegner`;
  }
  return `die Einheiten bei ${unitTargetText(data, target)}`;
}

/** „an“/„bei“ mit Dativ, „an dem“ wird zu „am“, „bei dem“ zu „beim“. */
function withPrep(prep: "an" | "bei", phrase: string): string {
  if (phrase === "sich selbst" && prep === "bei") return "für sich selbst";
  if (phrase.startsWith("dem ")) return `${prep === "an" ? "am" : "beim"} ${phrase.slice(4)}`;
  return `${prep} ${phrase}`;
}

/** Zahl oder berechneter Wert; berechnete Werte heißen „X“ und bekommen eine Erklärung. */
function amountParts(amount: Amount): { value: string; note: string } {
  if (typeof amount === "number") return { value: String(amount), note: "" };
  if (amount.kind === "distinctOwnRaces") return { value: "X", note: " (X = Zahl verschiedener eigener Rassen in der Arena)" };
  return { value: "X", note: amount.factor === 1 ? " (X = eigener Angriff)" : ` (X = eigener Angriff × ${amount.factor})` };
}

function signed(amount: Amount, stat: Stat): string {
  const { value, note } = amountParts(amount);
  const text = typeof amount === "number" && amount < 0 ? `−${Math.abs(amount)}` : `+${value}`;
  return `${text} ${STAT_NAMES[stat]}${note}`;
}

function goldText(amount: Amount): string {
  const { value, note } = amountParts(amount);
  return `${value} Gold${note}`;
}

function tokenText(data: GameData, effect: Extract<Effect, { op: "summon" }>): string {
  const token = data.cards.get(effect.token);
  const name = token?.name ?? effect.token;
  if (!token || token.type !== "unit") return name;
  const attack = effect.statOverride?.attack ?? token.stats.attack;
  const hp = effect.statOverride?.hp ?? token.stats.hp;
  return `${name} (${attack}/${hp})`;
}

const SUMMON_PLACES: Record<Extract<Effect, { op: "summon" }>["where"], [string, string]> = {
  adjacentFree: ["auf ein freies Nachbarfeld", "auf freie Nachbarfelder"],
  zoneFree: ["auf ein freies Feld der gewählten Zone", "auf freie Felder der gewählten Zone"],
  targetHexThenAdjacentFree: ["auf das gewählte Feld (sonst ein freies Nachbarfeld)", "auf das gewählte Feld, dann auf freie Nachbarfelder"],
};

/** Text eines Effekt-Bausteins, z. B. „5 Schaden an den Gegnern auf dem gewählten Feld“. */
export function effectText(data: GameData, effect: Effect): string {
  switch (effect.op) {
    case "damage": {
      const { value, note } = amountParts(effect.amount);
      const wound = effect.wound ? "; davon besiegte Einheiten sind verwundet" : "";
      return `${value} Schaden${note} ${withPrep("an", unitTargetText(data, effect.target))}${wound}`;
    }
    case "heal": {
      const { value, note } = amountParts(effect.amount);
      return `heilt ${value} Leben${note} ${withPrep("bei", unitTargetText(data, effect.target))}`;
    }
    case "shield": {
      const { value, note } = amountParts(effect.amount);
      return `Schild ${value}${note} ${withPrep("bei", unitTargetText(data, effect.target))}`;
    }
    case "buff":
      return `${signed(effect.amount, effect.stat)} ${DURATION_TEXTS[effect.duration]} ${withPrep("bei", unitTargetText(data, effect.target))}`;
    case "stun":
      return `betäubt ${accusativeTarget(data, effect.target)} ${effect.ticks} Ticks lang`;
    case "gainMana": {
      const { value, note } = amountParts(effect.amount);
      return `+${value} Mana${note} ${withPrep("bei", unitTargetText(data, effect.target))}`;
    }
    case "startManaPercent": {
      const { value, note } = amountParts(effect.amount);
      const when = effect.when === "nextRound" ? " in der nächsten Runde" : "";
      return `${value} % Start-Mana${note}${when} ${withPrep("bei", unitTargetText(data, effect.target, effect.class))}`;
    }
    case "summon": {
      const count = effect.count;
      const place = SUMMON_PLACES[effect.where][count === 1 ? 0 : 1];
      const resonance = effect.countsForResonance ? "; zählt für die Resonanz" : "";
      return `beschwört ${count === 1 ? "" : `bis zu ${count}× `}${tokenText(data, effect)} ${place}${resonance}`;
    }
    case "move":
      return `versetzt ${accusativeTarget(data, effect.target)} auf das gewählte freie Feld`;
    case "wound":
      return `verwundet ${accusativeTarget(data, effect.target)}; sie kämpfen in dieser Runde nicht`;
    case "destroy":
      return `vernichtet ${accusativeTarget(data, effect.target)}; ihre Karten gehen auf den Ablagestapel`;
    case "gainGold": {
      const where = effect.to === "treasury" ? "in die Schatzkammer" : "in den Rundenvorrat";
      const when = effect.when === "nextRound" ? " zu Beginn der nächsten Runde" : effect.when === "roundStart" ? " zu Rundenbeginn" : "";
      return `+${goldText(effect.amount)}${when} ${where}`;
    }
    case "stealGold":
      return `stiehlt ${goldText(effect.amount)} aus ${PLAYER_TARGET_TEXTS[effect.from]} in deine Schatzkammer`;
    case "giveCurse":
      return `legt ${PLAYER_TARGET_TEXTS[effect.to]} einen Fluch auf den Ablagestapel`;
    case "trash":
      return "entfernt die gewählten Karten dauerhaft aus dem Spiel";
    case "gainLeaderXp": {
      const { value, note } = amountParts(effect.amount);
      return `+${value} XP${note} für deinen Anführer`;
    }
    case "grantKeyword": {
      const duration = effect.duration ? ` ${DURATION_TEXTS[effect.duration]}` : "";
      return `verleiht ${unitTargetText(data, effect.target)} „${KEYWORD_NAMES[effect.keyword]}“${duration} (${KEYWORD_HINTS[effect.keyword]})`;
    }
    case "costModifier": {
      const { value } = amountParts(effect.amount);
      const n = typeof effect.amount === "number" ? Math.abs(effect.amount) : value;
      const dir = typeof effect.amount === "number" && effect.amount > 0 ? "mehr" : "weniger";
      return `Einheiten dieser Rasse kosten ${n} Gold ${dir} (nie unter 0)`;
    }
    case "returnOnDeath": {
      const limit = effect.limit === "firstRaceUnitPerCombat" ? "nur die erste Einheit dieser Rasse je Kampf" : "einmal je Einheit und Kampf";
      return `Wiederkehr mit ${effect.hp} Leben nach dem Tod (${limit}) ${withPrep("bei", unitTargetText(data, effect.target))}`;
    }
    case "onFrontWinOfChosen":
      return `gewinnst du eine Front, an der eine gewählte Einheit kämpft: ${effect.effects.map((e) => effectText(data, e)).join(", ")}`;
    case "bonusInterest":
      return `+${effect.amount} Gold Zinsen je volle ${effect.perGold} Gold in der Schatzkammer`;
    case "bonusXp": {
      const { value, note } = amountParts(effect.amount);
      return `+${value} XP${note} beim Überleben eines Kampfes ${withPrep("bei", unitTargetText(data, effect.target))}`;
    }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function effectsText(data: GameData, effects: readonly Effect[]): string {
  return effects.map((e) => effectText(data, e)).join(", ");
}

/** Fähigkeit einer Einheit, z. B. „Bei vollem Mana: 2 Schaden am aktuellen Ziel.“ */
export function abilityText(data: GameData, ability: Ability): string {
  const condition = ability.condition ? `, ${CONDITION_TEXTS[ability.condition.kind]}` : "";
  const name = ability.name ? `${ability.name} – ` : "";
  return `${name}${TRIGGER_TEXTS[ability.trigger]}${condition}: ${effectsText(data, ability.effects)}.`;
}

/** Ziel-Angabe eines Zaubers (R-7.3), z. B. „ein Feld deiner Fronten oder der Mitte“. */
export function targetSpecText(spec: TargetSpec): string {
  switch (spec.kind) {
    case "hex": {
      const free = spec.mustBeFree ? "freies " : "";
      return spec.arenas === "own" ? `ein ${free}eigenes Feld` : `ein ${free}Feld deiner Fronten oder der Mitte`;
    }
    case "zone":
      return spec.arenas === "own" ? "eine eigene Zone" : "eine Zone deiner Fronten oder der Mitte";
    case "player":
      return "ein Nachbar (linker oder rechter Gegner)";
    case "ownCards": {
      const from = spec.from.map((z) => (z === "deck" ? "Deck" : "Ablagestapel")).join(" oder ");
      return `bis zu ${spec.max} eigene ${spec.max === 1 ? "Karte" : "Karten"} aus ${from}`;
    }
    case "moveUnits":
      return `bis zu ${spec.count} eigene ${spec.count === 1 ? "Einheit" : "Einheiten"} und je ein freies Feld`;
    case "none":
      return "keins";
  }
}

/** R-14.6: alternative Kosten als Text, z. B. „2 Leben“ oder „2 Gold und 1 eigene Einheit opfern“. */
export function altCostRulesText(alt: AltCost): string {
  const parts: string[] = [];
  if (alt.gold) parts.push(`${alt.gold} Gold`);
  if (alt.bloodToll) parts.push(`${alt.bloodToll} Leben (mindestens 1 bleibt)`);
  if (alt.sacrifice) parts.push(`${alt.sacrifice} eigene ${alt.sacrifice === 1 ? "Einheit" : "Einheiten"} opfern`);
  return parts.length > 0 ? parts.join(" und ") : "kostenlos";
}

/** Werte einer Einheit (★1), z. B. „Angriff 3 · Leben 2 · Durchbruch 3 · Reichweite 1“. */
export function statsText(card: UnitCard): string {
  const s = card.stats;
  const parts = [`Angriff ${s.attack}`, `Leben ${s.hp}`, `Durchbruch ${s.breakthrough}`, `Reichweite ${s.range}`];
  if (s.armor) parts.push(`Panzer ${s.armor}`);
  if (s.attackInterval !== undefined) parts.push(`Angriffstakt ${s.attackInterval}`);
  if (s.moveInterval !== undefined) parts.push(`Lauftakt ${s.moveInterval}`);
  if (s.manaMax !== undefined) parts.push(`Mana ${s.manaMax}`);
  return parts.join(" · ");
}

function unitLines(data: GameData, card: UnitCard): string[] {
  const race = card.race ? (data.races.get(card.race)?.name ?? card.race) : null;
  const cls = data.classes.get(card.class);
  const behavior = cls ? BEHAVIOR_TEXTS[cls.combatBehavior] : undefined;
  const kind = [race, cls?.name ?? card.class].filter((x): x is string => Boolean(x)).join(" · ");
  const lines = [`Einheit · ${kind}`, statsText(card)];
  if (behavior) lines.push(`${cls?.name}: ${behavior}.`);
  for (const keyword of card.keywords ?? []) lines.push(`${KEYWORD_NAMES[keyword]}: ${KEYWORD_HINTS[keyword]}.`);
  for (const ability of card.abilities ?? []) lines.push(abilityText(data, ability));
  if (card.altCost) lines.push(`Alternative Kosten: ${altCostRulesText(card.altCost)}.`);
  return lines;
}

function spellLines(data: GameData, card: SpellCard): string[] {
  const slot = card.slot === "pre" ? "Vorkampf-Zauber (wirkt vor den Kämpfen)" : "Nachkampf-Zauber (wirkt nach den Kämpfen)";
  const lines = [`${slot} · Tempo ${card.tempo}`];
  if (card.target.kind !== "none") lines.push(`Ziel: ${targetSpecText(card.target)}.`);
  if (card.condition) lines.push(`Bedingung: ${CONDITION_TEXTS[card.condition.kind]}, sonst verpufft er.`);
  lines.push(`Wirkung: ${capitalize(effectsText(data, card.effects))}.`);
  return lines;
}

/**
 * C5b2: vollständiger Kartentext als Zeilen. Erste Zeile: Kartenart (bei Einheiten mit Rasse und Klasse);
 * danach Werte, Schlüsselwörter, Fähigkeiten bzw. Zeitpunkt, Ziel und Wirkung.
 */
export function cardRulesLines(data: GameData, card: CardData): string[] {
  switch (card.type) {
    case "resource":
      return ["Ressource", `Beim Ausspielen +${card.gold} Gold.`];
    case "unit":
      return unitLines(data, card);
    case "spell":
      return spellLines(data, card);
    case "curse":
      return ["Fluch", "Keine Wirkung; belegt nur Platz in deinem Deck."];
  }
}

/** Kartentext in einer Zeichenkette (Zeilen mit Zeilenumbruch), z. B. für Tooltips. */
export function cardRulesText(data: GameData, card: CardData): string {
  return cardRulesLines(data, card).join("\n");
}
