/**
 * Einstieg des Browser-Clients (C1): startet eine Partie gegen 3 Bots, zeigt den Zustand als Text und
 * darüber das 3D-Brett (C2) und die Planungsleiste (C3a). Während der Planung zeigt das Brett die Vorschau;
 * Einheiten lassen sich direkt auf dem Brett platzieren und bewegen (C3b). Nach jeder Runde spielt das Brett die
 * Kämpfe dieser Runde aus dem Ereignisprotokoll ab (C4c1, R-19.2), seit C4c2b mit den Anführer-Fähigkeiten und
 * Zaubern davor und dem Durchbruch-Schaden und den Zaubern danach. Unter der Planung stehen die eigenen Karten
 * (C5b1); in der letzten Runde gekaufte Karten sind als „neu“ markiert und werden in der Meldung genannt.
 */
import { loadGameData } from "@game/engine";
import { boughtInRound, boughtNote, CARD_ZONE_NAMES, cardCountText, ownCardOverview } from "./cardOverview";
import { BASE_TICKS_PER_SECOND, REPLAY_SPEEDS, type ReplaySpeed } from "./combatReplay";
import { RoundReplayPlayer, roundReplay } from "./effectReplay";
import { roundStatusText } from "./roundAnimation";
import { createBoardScene, type BoardScene } from "./scene";
import { PlanningPanel } from "./planningPanel";
import { GameSession, HUMAN } from "./session";
import { formatState } from "./stateText";

const data = loadGameData();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} fehlt`);
  return found as T;
}

const stateText = element<HTMLPreElement>("state");
const cardsList = element<HTMLUListElement>("cards");
const seedInput = element<HTMLInputElement>("seed");
const message = element<HTMLParagraphElement>("message");
const buttons = {
  newGame: element<HTMLButtonElement>("new-game"),
  pass: element<HTMLButtonElement>("pass"),
  autopilot: element<HTMLButtonElement>("autopilot"),
  toEnd: element<HTMLButtonElement>("to-end"),
};
const replayControls = {
  panel: element<HTMLDivElement>("replay"),
  status: element<HTMLSpanElement>("replay-status"),
  speed: element<HTMLSelectElement>("replay-speed"),
  skip: element<HTMLButtonElement>("replay-skip"),
  skipAll: element<HTMLButtonElement>("replay-skip-all"),
};

let scene: BoardScene | null = null;
try {
  scene = createBoardScene(element<HTMLCanvasElement>("board"), {
    data,
    layout: { ...data.config.arenas, reserveSlots: data.config.reserveSlots },
    startLife: data.config.startingLife,
    players: data.config.players,
    viewer: HUMAN,
    // Die Leiste entsteht erst weiter unten; die Brett-Eingaben werden bei Benutzung an sie weitergereicht.
    input: {
      canDrag: (unitId) => planning.canDrag(unitId),
      onUnitClick: (unitId) => planning.clickUnit(unitId),
      onLocationClick: (location) => planning.clickLocation(location),
      onUnitDrop: (unitId, location) => planning.dropUnit(unitId, location),
    },
  });
} catch (error) {
  element<HTMLCanvasElement>("board").hidden = true;
  element<HTMLParagraphElement>("no-3d").hidden = false;
  console.warn("3D-Anzeige nicht verfügbar", error);
}

function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get("seed");
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

let session = new GameSession(data, { seed: seedFromUrl() });
seedInput.value = String(session.options.seed);

const planning = new PlanningPanel(element<HTMLDivElement>("planning"), data, {
  onChange: (preview, note) => {
    scene?.update(preview);
    scene?.setMarkers(planning.targets(), planning.selectedUnit());
    message.textContent = note || `Runde ${preview.round}: Planung läuft, noch nicht bestätigt.`;
  },
  onConfirm: () =>
    guarded(() =>
      resolveRound(() => {
        const builder = planning.active;
        if (!builder) return "Keine Planung offen.";
        const result = session.submitHuman(builder.planning());
        return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
      }),
    ),
});

/** C5b1: zuletzt aufgelöste Runde der laufenden Partie (für „neu gekauft“); `null` = noch keine. */
let lastResolved: { session: GameSession; round: number } | null = null;

/** C5b1: eigene Karten je Bereich, Käufe der zuletzt aufgelösten Runde hervorgehoben. */
function renderCards(): void {
  const view = session.view();
  const round = lastResolved?.session === session ? lastResolved.round : null;
  const fresh = new Set(round === null ? [] : boughtInRound(view.log, round, HUMAN).map((b) => b.cardInstanceId));
  cardsList.replaceChildren();
  for (const zone of ownCardOverview(data, view, fresh)) {
    const item = document.createElement("li");
    item.append(`${CARD_ZONE_NAMES[zone.zone]} (${zone.total}): `);
    if (zone.cards.length === 0) item.append("–");
    zone.cards.forEach((card, i) => {
      if (i > 0) item.append(", ");
      const span = document.createElement("span");
      span.textContent = cardCountText(card);
      if (card.newCount > 0) span.className = "new";
      item.append(span);
    });
    cardsList.append(item);
  }
}

/** Partie und Runde der offenen Planung; ein neuer Entwurf entsteht nur, wenn sich das ändert. */
let planningFor: { session: GameSession; round: number } | null = null;

function render(note = ""): void {
  const view = session.view();
  stateText.textContent = formatState(data, view);
  renderCards();
  const waiting = session.status === "waitingForHuman";
  // Neue Planung nach jeder Runde (bzw. neuer Partie); das Brett zeigt die Vorschau des Entwurfs.
  const current = waiting ? { session, round: view.round } : null;
  if (current?.session !== planningFor?.session || current?.round !== planningFor?.round) {
    planningFor = current;
    planning.start(waiting ? session.planner() : null);
  }
  scene?.update(planning.active ? planning.active.preview() : view);
  scene?.setMarkers(planning.targets(), planning.selectedUnit());
  buttons.pass.disabled = !waiting;
  buttons.autopilot.disabled = !waiting;
  buttons.toEnd.disabled = !waiting;
  message.textContent = note || (waiting ? `Runde ${view.round}: plane deinen Zug und bestätige ihn.` : "Die Partie ist beendet.");
}

/** C4c1/C4c2b: laufende Wiedergabe der Runde (nur mit 3D-Brett). */
let replayPlayer: RoundReplayPlayer | null = null;

function selectedSpeed(): ReplaySpeed {
  const value = Number(replayControls.speed.value);
  return REPLAY_SPEEDS.find((s) => s === value) ?? 1;
}

/** Spielt die gerade aufgelöste Runde `round` ab (R-19.2: nur aus dem Protokoll der eigenen Sicht). */
function startReplay(round: number): void {
  if (!scene) return;
  const player = new RoundReplayPlayer(roundReplay(data, session.view().log, round));
  if (player.segments.length === 0) return;
  player.setSpeed(selectedSpeed());
  replayPlayer = player;
  replayControls.panel.hidden = false;
  let lastText = "";
  scene.playReplay(player, (finished) => {
    if (finished) {
      if (replayPlayer === player) {
        replayPlayer = null;
        replayControls.panel.hidden = true;
      }
      return;
    }
    const text = roundStatusText(data, player.segments, { ...player.position(), clock: player.clock() }, HUMAN, BASE_TICKS_PER_SECOND);
    if (text !== lastText) replayControls.status.textContent = lastText = text;
  });
}

/** Führt eine Planungsaktion aus und spielt danach die Kämpfe der aufgelösten Runde ab. */
function resolveRound(action: () => string | void): string | void {
  const round = session.view().round;
  const before = session;
  const note = action();
  // Abgelehnte Planungen lösen nichts auf; dann gibt es für diese Runde noch keine Kämpfe im Protokoll.
  if (session !== before) return note;
  startReplay(round);
  lastResolved = { session, round };
  return note || boughtNote(data, session.view(), round);
}

replayControls.speed.addEventListener("change", () => replayPlayer?.setSpeed(selectedSpeed()));
replayControls.skip.addEventListener("click", () => replayPlayer?.skipCurrent());
replayControls.skipAll.addEventListener("click", () => scene?.stopReplay());

function guarded(action: () => string | void): void {
  try {
    render(action() ?? "");
  } catch (error) {
    render(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
  }
}

buttons.newGame.addEventListener("click", () =>
  guarded(() => {
    scene?.stopReplay();
    const seed = Number.parseInt(seedInput.value, 10);
    session = new GameSession(data, { seed: Number.isFinite(seed) && seed >= 0 ? seed : 1 });
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(session.options.seed));
    window.history.replaceState(null, "", url);
    return `Neue Partie mit Seed ${session.options.seed}.`;
  }),
);
buttons.pass.addEventListener("click", () =>
  guarded(() =>
    resolveRound(() => {
      const result = session.pass();
      return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
    }),
  ),
);
buttons.autopilot.addEventListener("click", () =>
  guarded(() =>
    resolveRound(() => {
      const result = session.autopilot();
      return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
    }),
  ),
);
buttons.toEnd.addEventListener("click", () =>
  guarded(() => {
    scene?.stopReplay();
    session.autopilotToEnd();
  }),
);

render();
