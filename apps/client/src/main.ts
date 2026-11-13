/**
 * Einstieg des Browser-Clients (C1): startet eine Partie gegen 3 Bots, zeigt den Zustand als Text und
 * darüber das 3D-Brett (C2). Die Planungsoberfläche folgt mit C3.
 */
import { loadGameData } from "@game/engine";
import { createBoardScene, type BoardScene } from "./scene";
import { GameSession, HUMAN } from "./session";
import { formatState } from "./stateText";

const data = loadGameData();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} fehlt`);
  return found as T;
}

const stateText = element<HTMLPreElement>("state");
const seedInput = element<HTMLInputElement>("seed");
const message = element<HTMLParagraphElement>("message");
const buttons = {
  newGame: element<HTMLButtonElement>("new-game"),
  pass: element<HTMLButtonElement>("pass"),
  autopilot: element<HTMLButtonElement>("autopilot"),
  toEnd: element<HTMLButtonElement>("to-end"),
};

let scene: BoardScene | null = null;
try {
  scene = createBoardScene(element<HTMLCanvasElement>("board"), {
    data,
    layout: { ...data.config.arenas, reserveSlots: data.config.reserveSlots },
    startLife: data.config.startingLife,
    players: data.config.players,
    viewer: HUMAN,
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

function render(note = ""): void {
  const view = session.view();
  stateText.textContent = formatState(data, view);
  scene?.update(view);
  const waiting = session.status === "waitingForHuman";
  buttons.pass.disabled = !waiting;
  buttons.autopilot.disabled = !waiting;
  buttons.toEnd.disabled = !waiting;
  message.textContent = note || (waiting ? `Runde ${view.round}: deine Planung fehlt.` : "Die Partie ist beendet.");
}

function guarded(action: () => string | void): void {
  try {
    render(action() ?? "");
  } catch (error) {
    render(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
  }
}

buttons.newGame.addEventListener("click", () =>
  guarded(() => {
    const seed = Number.parseInt(seedInput.value, 10);
    session = new GameSession(data, { seed: Number.isFinite(seed) && seed >= 0 ? seed : 1 });
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(session.options.seed));
    window.history.replaceState(null, "", url);
    return `Neue Partie mit Seed ${session.options.seed}.`;
  }),
);
buttons.pass.addEventListener("click", () =>
  guarded(() => {
    const result = session.pass();
    return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
  }),
);
buttons.autopilot.addEventListener("click", () =>
  guarded(() => {
    const result = session.autopilot();
    return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
  }),
);
buttons.toEnd.addEventListener("click", () => guarded(() => session.autopilotToEnd()));

render();
