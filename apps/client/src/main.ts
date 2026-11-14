/**
 * Einstieg des Browser-Clients (C1): startet eine Partie gegen 3 Bots, zeigt den Zustand als Text und
 * darüber das 3D-Brett (C2) und die Planungsleiste (C3a). Während der Planung zeigt das Brett die Vorschau;
 * Einheiten lassen sich direkt auf dem Brett platzieren und bewegen (C3b).
 */
import { loadGameData } from "@game/engine";
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
    guarded(() => {
      const builder = planning.active;
      if (!builder) return "Keine Planung offen.";
      const result = session.submitHuman(builder.planning());
      return result.ok ? "" : `Planung abgelehnt: ${result.reason}`;
    }),
});

/** Partie und Runde der offenen Planung; ein neuer Entwurf entsteht nur, wenn sich das ändert. */
let planningFor: { session: GameSession; round: number } | null = null;

function render(note = ""): void {
  const view = session.view();
  stateText.textContent = formatState(data, view);
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
