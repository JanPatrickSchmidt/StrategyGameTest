/**
 * Babylon.js-Szene (C2a): 3D-Brett mit allen Arenen der Partie als Hexfelder. Die Aufteilung kommt aus
 * `boardLayout.ts` (reine Geometrie, getestet); hier wird sie nur gezeichnet.
 *
 * - Mittelarena in der Mitte, je aktive Front-Paarung eine Frontarena an der Kante zwischen zwei Sitzen.
 * - Felder der Zonen in einer gedämpften Mischung aus Stein und Spielerfarbe, freie Felder in Stein,
 *   dunkle Hex-Kanten darunter. Hält ein Spieler die Mitte, nehmen die freien Felder der Mitte seine Farbe an.
 * - An jeder Sitz-Ecke eine Säule in Spielerfarbe (Höhe = Leben, grau = ausgeschieden), daneben die
 *   Reserve-Plätze und eine Beschriftung.
 * - Kamera schräg von oben aus der Ecke des Betrachters.
 *
 * - Einheiten (C2b) als einfache Formen in Spielerfarbe auf ihren Feldern bzw. Reserve-Plätzen, Form nach
 *   Einheitenart aus `unitFigures.ts` (Anführer hohe Figur mit Kopf, Nahkampf Block, Fernkampf Kegel, Token
 *   Kugel), verwundete Einheiten grau gedämpft und geneigt. Nach jeder Runde werden die Figuren abgeglichen:
 *   neue entstehen, verschwundene werden entfernt, bewegte versetzt.
 *
 * - Lebens- und Sternanzeige (C2c): über jeder Figur ein kleines Schild mit Sternen (Anführer: Stufe) und
 *   Lebenspunkten (`unitBadgeText`), immer zur Kamera gedreht und über dem Brett gezeichnet, damit es nicht
 *   von Figuren verdeckt wird; an jeder Sitz-Ecke Name und Lebenspunkte des Spielers (`seatLabelText`).
 * - Bedienung (C3b): `setMarkers` hebt freie Zielorte als leuchtende Felder hervor und markiert die gewählte
 *   Einheit mit einem Ring. Klick auf eine Figur oder ein Feld und Ziehen einer eigenen Figur werden über
 *   `BoardInputHandlers` gemeldet; welcher eigene Ort getroffen wurde, bestimmt `nearestLocation`. Während eine
 *   Figur gezogen wird, dreht sich die Kamera nicht.
 * - Kampfwiedergabe (C4c1): `playReplay` spielt die Kämpfe einer Runde aus einem `ReplayPlayer` ab. Solange sie
 *   läuft, zeigt das Brett nur die Kämpfer aus `roundFighters` (laufender Kampf weich animiert, Gestorbene blenden
 *   aus, gespielte Kämpfe im Endbild, kommende in der Startaufstellung) mit Lebenspunkten und Schild; die Kamera
 *   gleitet zur laufenden Arena. Neue Sichten aus `update` werden bis zum Ende der Wiedergabe zurückgehalten, damit
 *   Brett, Säulen und Arenen zur Runde passen, die gerade abgespielt wird.
 * - Wirkungen (C4c2a) aus `combatEffects`: Ausfallschritt der Nahkämpfer, Geschosse der Fernkämpfer, Strahl und
 *   Ring bei Fähigkeiten, Ringe bei Beschwörung und Schild, aufsteigende Zahlen für Schaden (Schild-Anteil eigens),
 *   Heilung, Schild, Buffs, Schlüsselwörter, Betäubung und Verwundung.
 * Farbwelt nach `docs/stil/visuelle-richtung.md`: gedeckter Untergrund, dunkle Hex-Linien, gedämpfte
 * Spielerfarben, warmes Hauptlicht mit kühlem Gegenlicht.
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  type InstancedMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { GameData, PlayerIndex, PlayerView, UnitId, UnitLocation } from "@game/engine";
import type { ReplayPlayer } from "./combatReplay";
import { arenaFocus, fighterBadgeText, roundFighters } from "./replayAnimation";
import { combatEffects, type CombatEffects, type EffectTone } from "./replayEffects";
import { type BoardLayout, buildBoardLayout, frontPairsFor, type LayoutConfig, locationPosition, seatAngle, type WorldPoint } from "./boardLayout";
import { nearestLocation } from "./boardInput";
import { playerName, seatLabelText } from "./stateText";
import { type FigureShape, figureSourceKey, unitBadgeText, type UnitFigure, unitFigures } from "./unitFigures";

/** Gedämpfte, klar unterscheidbare Spielerfarben (Platz 1–4). */
export const PLAYER_COLORS: readonly string[] = ["#4f7fa8", "#a8513f", "#5f8a4f", "#b08a3a"];

const STONE = new Color3(0.42, 0.39, 0.35);
const EDGE = new Color3(0.11, 0.1, 0.09);
const GREY = new Color3(0.3, 0.3, 0.3);
/** Anteil der Spielerfarbe an den Zonenfeldern. */
const ZONE_TINT = 0.42;
const TILE_HEIGHT = 0.12;

export interface BoardScene {
  update(view: PlayerView): void;
  /** C3b: freie Zielorte des Betrachters hervorheben und die gewählte Einheit markieren. */
  setMarkers(targets: readonly UnitLocation[], selectedUnit: UnitId | null): void;
  /**
   * C4c1: spielt die Kämpfe aus `player` ab (die Zeit treibt die Szene voran). `onProgress` wird in jedem Bild
   * gerufen, zuletzt mit `finished = true`. Eine laufende Wiedergabe wird vorher beendet.
   */
  playReplay(player: ReplayPlayer, onProgress: (finished: boolean) => void): void;
  /** C4c1: beendet die Wiedergabe sofort und zeigt die zurückgehaltene Sicht. */
  stopReplay(): void;
  dispose(): void;
}

/** C3b: Eingaben auf dem Brett. Orte sind immer Orte des Betrachters (`null` = kein eigener Ort getroffen). */
export interface BoardInputHandlers {
  canDrag(unitId: UnitId): boolean;
  onUnitClick(unitId: UnitId): void;
  onLocationClick(location: UnitLocation | null): void;
  onUnitDrop(unitId: UnitId, location: UnitLocation | null): void;
}

/** Ab so vielen Bildpunkten Bewegung gilt ein Druck als Ziehen statt Klick. */
const DRAG_THRESHOLD_PX = 6;
const ACCENT = Color3.FromHexString("#e0b04a");

export interface BoardSceneOptions {
  /** Spieldaten (für die Form der Einheiten nach Kartenwerten). */
  data: GameData;
  layout: Omit<LayoutConfig, "hexSize">;
  startLife: number;
  players: number;
  /** Sitz des Betrachters; die Kamera schaut aus seiner Ecke. */
  viewer: PlayerIndex;
  /** C3b: Bedienung auf dem Brett (ohne = nur Anzeige). */
  input?: BoardInputHandlers;
}

function playerColor(player: number): Color3 {
  return Color3.FromHexString(PLAYER_COLORS[player % PLAYER_COLORS.length] ?? "#888888");
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  return m;
}

/** Schlichte, immer zur Kamera gedrehte Textfläche. */
function makeLabel(scene: Scene, name: string, text: string, color: string, width = 4): Mesh {
  const texture = new DynamicTexture(`${name}Tex`, { width: 512, height: 128 }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = "rgba(20,18,16,0.72)";
  ctx.fillRect(0, 16, 512, 96);
  texture.drawText(text, null, 88, "600 64px system-ui, sans-serif", color, null, true, true);
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(name, { width, height: width / 4 }, scene);
  plane.material = mat;
  plane.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  return plane;
}

/** Textschild, dessen Text sich nach jeder Runde ändern kann (C2c). Zeichnet nur neu, wenn sich etwas ändert. */
interface TextBadge {
  mesh: Mesh;
  setText(text: string, textColor: string, background: string): void;
  dispose(): void;
}

function makeTextBadge(scene: Scene, name: string, width: number, pixelWidth: number, aspect = 4): TextBadge {
  const pixelHeight = Math.round(pixelWidth / aspect);
  const texture = new DynamicTexture(`${name}Tex`, { width: pixelWidth, height: pixelHeight }, scene, true);
  texture.hasAlpha = true;
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(name, { width, height: width / aspect }, scene);
  plane.material = mat;
  plane.billboardMode = TransformNode.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  let last = "";
  return {
    mesh: plane,
    setText(text: string, textColor: string, background: string): void {
      const key = `${text}|${textColor}|${background}`;
      if (key === last) return;
      last = key;
      const ctx = texture.getContext();
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx.fillStyle = background;
      ctx.fillRect(0, pixelHeight * 0.1, pixelWidth, pixelHeight * 0.8);
      // Schrift so groß wie möglich, aber verkleinert, falls der Text sonst nicht auf das Schild passt.
      let fontPx = Math.round(pixelHeight * 0.62);
      const font = (px: number): string => `700 ${px}px system-ui, sans-serif`;
      ctx.font = font(fontPx);
      const measured = ctx.measureText(text).width;
      if (measured > pixelWidth * 0.94) fontPx = Math.floor((fontPx * pixelWidth * 0.94) / measured);
      texture.drawText(text, null, Math.round(pixelHeight * 0.5 + fontPx * 0.36), font(fontPx), textColor, null, true, true);
    },
    dispose(): void {
      plane.dispose(false, true);
    },
  };
}

/** Breite des Anzeigeschilds über einer Figur bei Kameraabstand `BADGE_REFERENCE_RADIUS` (C2c). */
const BADGE_WIDTH = 1.7;
/**
 * Die Schilde wachsen mit dem Kameraabstand mit (höchstens bis `BADGE_MAX_SCALE`), damit sie auch in der
 * Gesamtansicht lesbar bleiben, und schrumpfen beim Heranzoomen nicht unter ihre Grundgröße.
 */
const BADGE_REFERENCE_RADIUS = 24;
const BADGE_MAX_SCALE = 1.9;

/** Höhe des Anzeigeschilds über dem Fuß der Figur, je Form (C2c). */
const BADGE_HEIGHT: Record<FigureShape, number> = { leader: 2.85, melee: 1.75, ranged: 2.1, token: 1.35 };

/** Dunkler Hintergrund des Schilds mit einem Hauch Spielerfarbe, damit man den Besitzer auch am Schild erkennt. */
function badgeBackground(owner: number): string {
  const c = Color3.Lerp(new Color3(0.08, 0.07, 0.06), playerColor(owner), 0.45);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.88)`;
}

/** Höhe der Figuren über dem Brett (Oberkante der Felder). */
const FIGURE_BASE = TILE_HEIGHT + 0.02;

/** Baut die Grundform einer Figur, Fuß auf y = 0. */
function buildFigureMesh(scene: Scene, name: string, shape: FigureShape): Mesh {
  switch (shape) {
    case "leader": {
      const body = MeshBuilder.CreateCylinder(`${name}Body`, { diameterTop: 0.55, diameterBottom: 1.0, height: 1.5, tessellation: 8 }, scene);
      body.position.y = 0.75;
      const head = MeshBuilder.CreateSphere(`${name}Head`, { diameter: 0.62, segments: 8 }, scene);
      head.position.y = 1.78;
      const merged = Mesh.MergeMeshes([body, head], true, true);
      if (!merged) throw new Error("Figur konnte nicht gebaut werden");
      merged.name = name;
      return merged;
    }
    case "melee": {
      const block = MeshBuilder.CreateBox(name, { width: 0.85, depth: 0.85, height: 0.95 }, scene);
      block.position.y = 0.475;
      block.bakeCurrentTransformIntoVertices();
      return block;
    }
    case "ranged": {
      const cone = MeshBuilder.CreateCylinder(name, { diameterTop: 0, diameterBottom: 0.95, height: 1.3, tessellation: 12 }, scene);
      cone.position.y = 0.65;
      cone.bakeCurrentTransformIntoVertices();
      return cone;
    }
    case "token": {
      const ball = MeshBuilder.CreateSphere(name, { diameter: 0.6, segments: 8 }, scene);
      ball.position.y = 0.3;
      ball.bakeCurrentTransformIntoVertices();
      return ball;
    }
  }
}

export function createBoardScene(canvas: HTMLCanvasElement, options: BoardSceneOptions): BoardScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.13, 0.12, 0.11, 1);
  const layoutConfig: LayoutConfig = { ...options.layout, hexSize: 1 };

  const camera = new ArcRotateCamera("camera", seatAngle(options.viewer), 0.95, 40, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 12;
  camera.upperRadiusLimit = 80;
  camera.lowerBetaLimit = 0.15;
  camera.upperBetaLimit = 1.35;
  camera.wheelPrecision = 8;
  camera.pinchPrecision = 20;
  camera.attachControl(canvas, true);

  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  fill.diffuse = new Color3(0.62, 0.7, 0.85);
  fill.groundColor = new Color3(0.18, 0.16, 0.14);
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.35), scene);
  sun.intensity = 0.95;
  sun.diffuse = new Color3(1, 0.84, 0.64);

  const ground = MeshBuilder.CreateCylinder("ground", { diameter: 1, height: 0.2, tessellation: 48 }, scene);
  ground.position.y = -0.12;
  ground.material = material(scene, "groundMat", new Color3(0.2, 0.19, 0.17));

  const stoneMat = material(scene, "stoneMat", STONE);
  const edgeMat = material(scene, "edgeMat", EDGE);
  const zoneMats = Array.from({ length: options.players }, (_, p) =>
    material(scene, `zone${p}Mat`, Color3.Lerp(STONE, playerColor(p), ZONE_TINT)),
  );
  const centerFreeMat = material(scene, "centerFreeMat", STONE.clone());
  const reserveMat = material(scene, "reserveMat", new Color3(0.25, 0.23, 0.21));

  // Vorlagen für Instanzen: spitz oben in der Arena-Ebene (Babylon-Zylinder hat eine Ecke auf +x).
  const tile = MeshBuilder.CreateCylinder("tile", { diameter: 2 * 0.9, height: TILE_HEIGHT, tessellation: 6 }, scene);
  tile.isVisible = false;
  const edgeTile = MeshBuilder.CreateCylinder("edgeTile", { diameter: 2, height: TILE_HEIGHT * 0.6, tessellation: 6 }, scene);
  edgeTile.material = edgeMat;
  edgeTile.isVisible = false;
  const tileSources = new Map<StandardMaterial, Mesh>();
  function tileSource(mat: StandardMaterial): Mesh {
    let source = tileSources.get(mat);
    if (!source) {
      source = tile.clone(`tile-${mat.name}`);
      source.material = mat;
      source.isVisible = false;
      tileSources.set(mat, source);
    }
    return source;
  }

  // Figuren: eine unsichtbare Vorlage je Form, Besitzer und Verwundung, jede Einheit eine Instanz davon.
  const figureSources = new Map<string, Mesh>();
  function figureSource(figure: Pick<UnitFigure, "shape" | "owner" | "wounded">): Mesh {
    const key = figureSourceKey(figure);
    let source = figureSources.get(key);
    if (!source) {
      source = buildFigureMesh(scene, `figure-${key}`, figure.shape);
      // Figuren kräftiger als die Zonen darunter, damit sie sich auch auf eigenem Grund abheben.
      const bright = playerColor(figure.owner).scale(1.25);
      const color = figure.wounded ? Color3.Lerp(bright, GREY, 0.65) : bright;
      const mat = material(scene, `figure-${key}Mat`, color);
      mat.specularColor = new Color3(0.12, 0.12, 0.12);
      mat.emissiveColor = color.scale(0.18);
      source.material = mat;
      source.renderOutline = true;
      source.outlineColor = EDGE;
      source.outlineWidth = 0.03;
      source.isVisible = false;
      figureSources.set(key, source);
    }
    return source;
  }
  const figures = new Map<UnitId, { mesh: InstancedMesh; key: string; badge: TextBadge }>();

  function updateFigures(view: PlayerView, built: BoardLayout): void {
    const current = unitFigures(options.data, view, built);
    const seen = new Set<UnitId>();
    for (const figure of current) {
      seen.add(figure.unitId);
      const key = figureSourceKey(figure);
      let entry = figures.get(figure.unitId);
      if (entry && entry.key !== key) {
        entry.mesh.dispose();
        entry.badge.dispose();
        entry = undefined;
      }
      if (!entry) {
        const badge = makeTextBadge(scene, `badge${figure.unitId}`, BADGE_WIDTH, 256, 3);
        // Eigene Zeichengruppe: Schilde liegen immer über Brett und Figuren und bleiben lesbar.
        badge.mesh.renderingGroupId = 1;
        const instance = figureSource(figure).createInstance(`unit${figure.unitId}`);
        instance.metadata = { unitId: figure.unitId };
        entry = { mesh: instance, key, badge };
        figures.set(figure.unitId, entry);
      }
      entry.badge.setText(unitBadgeText(figure), figure.wounded ? "#c9c2b6" : "#fbf3e2", badgeBackground(figure.owner));
      entry.badge.mesh.position.set(figure.position.x, FIGURE_BASE + BADGE_HEIGHT[figure.shape], figure.position.z);
      const mesh = entry.mesh;
      mesh.position.set(figure.position.x, FIGURE_BASE, figure.position.z);
      // Verwundete liegen leicht schräg, damit man sie auch ohne Farbe erkennt.
      mesh.rotation.z = figure.wounded ? 0.45 : 0;
      mesh.rotation.y = figure.shape === "melee" ? Math.PI / 4 - seatAngle(figure.owner) : 0;
    }
    for (const [id, entry] of figures) {
      if (seen.has(id)) continue;
      entry.mesh.dispose();
      entry.badge.dispose();
      figures.delete(id);
    }
  }

  let boardRoot: TransformNode | null = null;
  let boardKey = "";
  let layout: BoardLayout | null = null;
  const pillars: { mesh: Mesh; material: StandardMaterial }[] = [];
  /** C2c: Beschriftung je Sitz mit Name und Lebenspunkten, wird in `update` neu beschrieben. */
  const seatLabels = new Map<number, TextBadge>();
  /** Meshes mit eigenem Material oder eigener Textur, die beim Neuaufbau samt Material entsorgt werden. */
  const ownedMeshes: Mesh[] = [];

  function buildBoard(view: PlayerView): void {
    // Gemeinsame Materialien der Felder bleiben erhalten; nur Beschriftungen und Säulen haben eigene.
    for (const own of ownedMeshes) own.dispose(false, true);
    ownedMeshes.length = 0;
    for (const label of seatLabels.values()) label.dispose();
    seatLabels.clear();
    boardRoot?.dispose(false, false);
    pillars.length = 0;
    const root = new TransformNode("board", scene);
    boardRoot = root;
    const pairs = frontPairsFor(view.players.map((p) => p.eliminated));
    const built = buildBoardLayout(layoutConfig, pairs, options.players);
    layout = built;
    ground.scaling = new Vector3(built.radius * 4, 1, built.radius * 4);

    let n = 0;
    for (const arena of built.arenas) {
      const rotationY = Math.PI / 6 - arena.rotation;
      for (const cell of arena.cells) {
        const mat =
          cell.owner === null ? (arena.kind === "center" ? centerFreeMat : stoneMat) : (zoneMats[cell.owner] ?? stoneMat);
        const t = tileSource(mat).createInstance(`cell${n}`);
        t.parent = root;
        t.position.set(cell.position.x, TILE_HEIGHT / 2 + 0.02, cell.position.z);
        t.rotation.y = rotationY;
        const e = edgeTile.createInstance(`edge${n}`);
        e.parent = root;
        e.position.set(cell.position.x, TILE_HEIGHT * 0.3, cell.position.z);
        e.rotation.y = rotationY;
        n++;
      }
      const label =
        arena.kind === "center"
          ? "Mitte"
          : `${playerName(arena.pair!.first, view.viewer)} – ${playerName(arena.pair!.second, view.viewer)}`;
      const outward = arena.kind === "center" ? 0 : 6.2;
      const plate = makeLabel(scene, `label-${arena.id}`, label, "#ece6dc", 5.5);
      plate.parent = root;
      ownedMeshes.push(plate);
      plate.position.set(
        arena.center.x + Math.cos(arena.rotation) * outward,
        arena.kind === "center" ? 2.2 : 1.4,
        arena.center.z + Math.sin(arena.rotation) * outward,
      );
    }

    for (let p = 0; p < options.players; p++) {
      const corner = built.seatCorners[p];
      if (!corner) continue;
      const mesh = MeshBuilder.CreateCylinder(`player${p}`, { diameter: 1.6, height: 1, tessellation: 6 }, scene);
      mesh.parent = root;
      const back = 2.6;
      mesh.position.x = corner.x + Math.cos(seatAngle(p)) * back;
      mesh.position.z = corner.z + Math.sin(seatAngle(p)) * back;
      const mat = material(scene, `player${p}Mat`, playerColor(p));
      mesh.material = mat;
      pillars.push({ mesh, material: mat });
      ownedMeshes.push(mesh);
      for (let slot = 0; slot < options.layout.reserveSlots; slot++) {
        const pos = locationPosition(built, p as PlayerIndex, { zone: "reserve", slot });
        if (!pos) continue;
        const r = MeshBuilder.CreateCylinder(`reserve${p}-${slot}`, { diameter: 1.5, height: 0.06, tessellation: 24 }, scene);
        r.parent = root;
        r.material = reserveMat;
        r.position.set(pos.x, 0.03, pos.z);
      }
      const label = makeTextBadge(scene, `seat${p}`, 5.5, 512);
      label.mesh.parent = root;
      label.mesh.position.set(mesh.position.x, 4.1, mesh.position.z);
      seatLabels.set(p, label);
    }
    camera.radius = built.radius * 1.75;
  }

  // C4c1: Kampfwiedergabe. Eigene Figuren (Klone statt Instanzen, damit jede einzeln ausblenden kann).
  interface Replay {
    player: ReplayPlayer;
    onProgress: (finished: boolean) => void;
    /** Zurückgehaltene Sicht aus `update`, die nach der Wiedergabe gezeigt wird. */
    pendingView: PlayerView | null;
    focusIndex: number | null;
  }
  let replay: Replay | null = null;
  const replayFigures = new Map<string, { mesh: Mesh; badge: TextBadge; shapeKey: string }>();
  /** Ziel, zu dem die Kamera weich gleitet (danach bleibt sie frei bedienbar). */
  let cameraGoal: { target: Vector3; radius: number; beta?: number } | null = null;
  /** Blickwinkel während eines Kampfs: steiler als die Gesamtansicht, damit Nachbararenen nicht ins Bild ragen. */
  const FOCUS_BETA = 0.7;
  /** Größter Zeitschritt je Bild, damit nach einem verdeckten Tab nicht ganze Kämpfe übersprungen werden. */
  const MAX_FRAME_MS = 100;

  function setBoardFiguresVisible(visible: boolean): void {
    for (const entry of figures.values()) {
      entry.mesh.isVisible = visible;
      entry.mesh.isPickable = visible;
      entry.badge.mesh.isVisible = visible;
    }
    for (const m of markers) m.isVisible = visible;
    if (!visible) selectionRing.isVisible = false;
  }

  function clearReplayFigures(): void {
    for (const entry of replayFigures.values()) {
      entry.mesh.dispose(false, false);
      entry.badge.dispose();
    }
    replayFigures.clear();
  }

  function overview(): { target: Vector3; radius: number; beta: number } {
    return { target: Vector3.Zero(), radius: (layout?.radius ?? 20) * 1.75, beta: 0.95 };
  }

  function drawReplay(active: Replay): void {
    if (!layout) return;
    const position = active.player.position();
    const fighters = roundFighters(layout, active.player.replays, position);
    const running = position.index === null ? undefined : active.player.replays[position.index];
    const clock = active.player.clock();
    const effects = running && clock !== null ? combatEffects(layout, running, Math.floor(clock), clock - Math.floor(clock)) : null;
    const seen = new Set<string>();
    for (const f of fighters) {
      const offset = f.active ? effects?.offsets.get(f.unitId) : undefined;
      if (offset) f.position = { x: f.position.x + offset.x, z: f.position.z + offset.z };
      const key = `${f.arena}:${f.unitId}`;
      seen.add(key);
      const shapeKey = figureSourceKey({ shape: f.shape, owner: f.player, wounded: false });
      let entry = replayFigures.get(key);
      if (entry && entry.shapeKey !== shapeKey) {
        entry.mesh.dispose(false, false);
        entry.badge.dispose();
        entry = undefined;
      }
      if (!entry) {
        const mesh = figureSource({ shape: f.shape, owner: f.player, wounded: false }).clone(`replay-${key}`);
        mesh.isVisible = true;
        mesh.isPickable = false;
        mesh.metadata = null;
        mesh.rotation.y = f.shape === "melee" ? Math.PI / 4 - seatAngle(f.player) : 0;
        const badge = makeTextBadge(scene, `replayBadge-${key}`, BADGE_WIDTH, 256, 3);
        badge.mesh.renderingGroupId = 1;
        entry = { mesh, badge, shapeKey };
        replayFigures.set(key, entry);
      }
      entry.mesh.position.set(f.position.x, FIGURE_BASE, f.position.z);
      entry.mesh.visibility = f.opacity;
      // Betäubte Figuren kippen leicht hin und her.
      entry.mesh.rotation.z = f.stunned ? 0.18 * Math.sin(performance.now() / 90) : 0;
      entry.badge.setText(fighterBadgeText(f), "#fbf3e2", badgeBackground(f.player));
      entry.badge.mesh.position.set(f.position.x, FIGURE_BASE + BADGE_HEIGHT[f.shape], f.position.z);
      entry.badge.mesh.visibility = f.opacity;
    }
    for (const [key, entry] of replayFigures) {
      if (seen.has(key)) continue;
      entry.mesh.dispose(false, false);
      entry.badge.dispose();
      replayFigures.delete(key);
    }
    drawEffects(effects, `${position.index ?? "-"}`);
    if (position.index !== active.focusIndex) {
      active.focusIndex = position.index;
      const focus = running ? arenaFocus(layout, running.arena) : null;
      cameraGoal = focus ? { target: new Vector3(focus.target.x, 0, focus.target.z), radius: focus.radius, beta: FOCUS_BETA } : overview();
    }
  }

  // C4c2a: Wirkungen des laufenden Kampfs. Meshes je Wirkung (Schlüssel aus Kampf und Ereignis), werden entsorgt,
  // sobald die Wirkung abgelaufen ist.
  const TONE_COLORS: Record<EffectTone, string> = {
    damage: "#ff7a66",
    shield: "#9fd0ff",
    heal: "#8ee69a",
    buff: "#f2c75c",
    status: "#efe6d8",
  };
  const effectMats = {
    ability: glowMaterial("fxAbilityMat", ACCENT),
    summon: glowMaterial("fxSummonMat", new Color3(0.92, 0.9, 0.85)),
    shield: glowMaterial("fxShieldMat", Color3.FromHexString("#9fd0ff")),
  };
  const shotMats = Array.from({ length: options.players }, (_, p) => glowMaterial(`fxShot${p}Mat`, Color3.Lerp(playerColor(p), Color3.White(), 0.45)));
  const effectTexts = new Map<string, TextBadge>();
  const effectMeshes = new Map<string, Mesh>();
  /** Höhe der Geschosse und Strahlen über dem Brett. */
  const LINE_HEIGHT = 0.9;

  function glowMaterial(name: string, color: Color3): StandardMaterial {
    const m = material(scene, name, color);
    m.emissiveColor = color;
    m.disableLighting = true;
    return m;
  }

  function effectMesh(key: string, build: () => Mesh): Mesh {
    let mesh = effectMeshes.get(key);
    if (!mesh) {
      mesh = build();
      mesh.isPickable = false;
      effectMeshes.set(key, mesh);
    }
    return mesh;
  }

  function drawEffects(effects: CombatEffects | null, prefix: string): void {
    const seenTexts = new Set<string>();
    const seenMeshes = new Set<string>();
    const scale = Math.min(BADGE_MAX_SCALE, Math.max(1, camera.radius / BADGE_REFERENCE_RADIUS));
    for (const t of effects?.texts ?? []) {
      const key = `${prefix}:${t.key}`;
      seenTexts.add(key);
      let badge = effectTexts.get(key);
      if (!badge) {
        badge = makeTextBadge(scene, `fxText-${key}`, 2.2, 384, 3.5);
        badge.mesh.renderingGroupId = 1;
        badge.setText(t.text, TONE_COLORS[t.tone], "rgba(20,18,16,0.6)");
        effectTexts.set(key, badge);
      }
      // Über dem Schild der Figur beginnen, aufsteigen, am Ende ausblenden.
      badge.mesh.position.set(t.position.x, FIGURE_BASE + BADGE_HEIGHT[t.shape] + 0.55 * scale + (t.age * 1.4 + t.stack * 0.62) * scale, t.position.z);
      badge.mesh.scaling.setAll(scale);
      badge.mesh.visibility = 1 - t.age * t.age;
    }
    for (const l of effects?.lines ?? []) {
      const key = `${prefix}:${l.key}`;
      const head = effectMesh(`${key}:head`, () => {
        const m = MeshBuilder.CreateSphere(`fxHead-${key}`, { diameter: l.kind === "shot" ? 0.32 : 0.42, segments: 8 }, scene);
        m.material = l.kind === "shot" ? (shotMats[l.player] ?? effectMats.summon) : effectMats.ability;
        return m;
      });
      seenMeshes.add(`${key}:head`);
      head.position.set(l.from.x + (l.to.x - l.from.x) * l.age, LINE_HEIGHT, l.from.z + (l.to.z - l.from.z) * l.age);
      if (l.kind === "ability") {
        const dx = l.to.x - l.from.x;
        const dz = l.to.z - l.from.z;
        const beam = effectMesh(`${key}:beam`, () => {
          const m = MeshBuilder.CreateCylinder(`fxBeam-${key}`, { diameter: 0.1, height: 1, tessellation: 6 }, scene);
          m.material = effectMats.ability;
          m.rotation.x = Math.PI / 2;
          m.rotation.y = Math.atan2(dx, dz);
          return m;
        });
        seenMeshes.add(`${key}:beam`);
        // Strahl wächst mit dem Kopf vom Wirker zum Ziel.
        const length = Math.max(0.01, Math.hypot(dx, dz) * l.age);
        beam.scaling.y = length;
        beam.position.set(l.from.x + (dx * l.age) / 2, LINE_HEIGHT, l.from.z + (dz * l.age) / 2);
        beam.visibility = 0.85;
      }
    }
    for (const f of effects?.flashes ?? []) {
      const key = `${prefix}:${f.key}`;
      seenMeshes.add(key);
      const ring = effectMesh(key, () => {
        const m = MeshBuilder.CreateTorus(`fxRing-${key}`, { diameter: 1.2, thickness: 0.1, tessellation: 32 }, scene);
        m.material = effectMats[f.kind];
        return m;
      });
      ring.position.set(f.position.x, FIGURE_BASE + 0.1 + (f.kind === "ability" ? 0.6 * f.age : 0), f.position.z);
      ring.scaling.setAll(0.7 + 1.1 * f.age);
      ring.visibility = 1 - f.age;
    }
    for (const [key, badge] of effectTexts) {
      if (seenTexts.has(key)) continue;
      badge.dispose();
      effectTexts.delete(key);
    }
    for (const [key, mesh] of effectMeshes) {
      if (seenMeshes.has(key)) continue;
      mesh.dispose(false, false);
      effectMeshes.delete(key);
    }
  }

  function endReplay(): void {
    const ended = replay;
    if (!ended) return;
    replay = null;
    clearReplayFigures();
    drawEffects(null, "");
    cameraGoal = overview();
    setBoardFiguresVisible(true);
    if (ended.pendingView) board.update(ended.pendingView);
    ended.onProgress(true);
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(MAX_FRAME_MS, engine.getDeltaTime());
    if (replay) {
      const active = replay;
      active.player.advance(dt);
      if (active.player.finished) endReplay();
      else {
        drawReplay(active);
        active.onProgress(false);
      }
    }
    if (cameraGoal) {
      const k = 1 - Math.exp(-dt / 220);
      camera.target = Vector3.Lerp(camera.target, cameraGoal.target, k);
      camera.radius += (cameraGoal.radius - camera.radius) * k;
      const beta = cameraGoal.beta ?? camera.beta;
      camera.beta += (beta - camera.beta) * k;
      const settled = Math.abs(camera.radius - cameraGoal.radius) < 0.05 && Math.abs(camera.beta - beta) < 0.005;
      if (Vector3.Distance(camera.target, cameraGoal.target) < 0.05 && settled) cameraGoal = null;
    }
    const scale = Math.min(BADGE_MAX_SCALE, Math.max(1, camera.radius / BADGE_REFERENCE_RADIUS));
    for (const entry of figures.values()) entry.badge.mesh.scaling.setAll(scale);
    for (const entry of replayFigures.values()) entry.badge.mesh.scaling.setAll(scale);
    // Auswahlring folgt der Figur (auch während sie gezogen wird) und pulsiert leicht.
    const chosen = selectedUnit === null || replay ? undefined : figures.get(selectedUnit);
    selectionRing.isVisible = chosen !== undefined;
    if (chosen) {
      selectionRing.position.set(chosen.mesh.position.x, FIGURE_BASE + 0.03, chosen.mesh.position.z);
      selectionRing.scaling.setAll(1 + 0.06 * Math.sin(performance.now() / 180));
    }
  });

  // C3b: Zielmarkierungen (leuchtende Felder) und Auswahlring.
  const markerMat = material(scene, "markerMat", ACCENT);
  markerMat.emissiveColor = ACCENT.scale(0.7);
  markerMat.alpha = 0.55;
  const markerSource = MeshBuilder.CreateCylinder("marker", { diameter: 2 * 0.72, height: 0.05, tessellation: 6 }, scene);
  markerSource.material = markerMat;
  markerSource.isPickable = false;
  markerSource.isVisible = false;
  const markers: InstancedMesh[] = [];
  const selectionRing = MeshBuilder.CreateTorus("selectionRing", { diameter: 1.35, thickness: 0.12, tessellation: 32 }, scene);
  const ringMat = material(scene, "ringMat", ACCENT);
  ringMat.emissiveColor = ACCENT;
  selectionRing.material = ringMat;
  selectionRing.isPickable = false;
  selectionRing.isVisible = false;
  let selectedUnit: UnitId | null = null;
  let markerTargets: readonly UnitLocation[] = [];

  function drawMarkers(): void {
    for (const m of markers) m.dispose();
    markers.length = 0;
    if (!layout) return;
    for (const [i, loc] of markerTargets.entries()) {
      const pos = locationPosition(layout, options.viewer, loc);
      if (!pos) continue;
      const m = markerSource.createInstance(`marker${i}`);
      m.isPickable = false;
      m.position.set(pos.x, TILE_HEIGHT + 0.05, pos.z);
      // Felder der Frontarenen und der Mitte haben die Drehung ihrer Arena; Reserve-Plätze sind rund genug.
      const arena = loc.zone === "center" ? layout.arenas.find((a) => a.kind === "center") : undefined;
      m.rotation.y = Math.PI / 6 - (arena?.rotation ?? frontRotationFor(loc) ?? 0);
      markers.push(m);
    }
  }

  function frontRotationFor(loc: UnitLocation): number | undefined {
    if (!layout || (loc.zone !== "left" && loc.zone !== "right")) return undefined;
    const viewer = options.viewer;
    return layout.arenas.find((a) => a.pair && (loc.zone === "right" ? a.pair.first : a.pair.second) === viewer)?.rotation;
  }

  /** Punkt auf Höhe der Figurenfüße unter dem Mauszeiger, `null`, wenn der Strahl die Ebene nicht trifft. */
  function groundPoint(x: number, y: number): WorldPoint | null {
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (FIGURE_BASE - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  function locationAt(x: number, y: number): UnitLocation | null {
    const point = groundPoint(x, y);
    return point && layout ? nearestLocation(options.data, layout, options.viewer, point, layoutConfig.hexSize) : null;
  }

  function unitAt(x: number, y: number): UnitId | null {
    const hit = scene.pick(x, y, (m) => typeof (m.metadata as { unitId?: unknown } | null)?.unitId === "number");
    const id = (hit?.pickedMesh?.metadata as { unitId?: number } | null)?.unitId;
    return hit?.hit && typeof id === "number" ? id : null;
  }

  const input = options.input;
  if (input) {
    let down: { x: number; y: number } | null = null;
    let drag: { unitId: UnitId; moved: boolean } | null = null;
    scene.onPointerObservable.add((info) => {
      const x = scene.pointerX;
      const y = scene.pointerY;
      if (info.type === PointerEventTypes.POINTERDOWN) {
        if (info.event.button !== 0) return;
        down = { x, y };
        const unitId = unitAt(x, y);
        if (unitId !== null && input.canDrag(unitId)) {
          drag = { unitId, moved: false };
          camera.detachControl();
        }
      } else if (info.type === PointerEventTypes.POINTERMOVE) {
        if (!drag || !down) return;
        if (!drag.moved && Math.hypot(x - down.x, y - down.y) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        const point = groundPoint(x, y);
        const figure = figures.get(drag.unitId);
        if (point && figure) {
          figure.mesh.position.set(point.x, FIGURE_BASE + 0.4, point.z);
          figure.badge.mesh.position.set(point.x, FIGURE_BASE + 0.4 + 1.8, point.z);
        }
      } else if (info.type === PointerEventTypes.POINTERUP) {
        const start = down;
        const current = drag;
        down = null;
        drag = null;
        if (current) {
          camera.attachControl(canvas, true);
          if (current.moved) input.onUnitDrop(current.unitId, locationAt(x, y));
          else input.onUnitClick(current.unitId);
          return;
        }
        if (!start || Math.hypot(x - start.x, y - start.y) >= DRAG_THRESHOLD_PX) return; // Kamera wurde gedreht
        const unitId = unitAt(x, y);
        if (unitId !== null) input.onUnitClick(unitId);
        else input.onLocationClick(locationAt(x, y));
      }
    });
  }

  const onResize = (): void => engine.resize();
  window.addEventListener("resize", onResize);
  engine.runRenderLoop(() => scene.render());

  const board: BoardScene = {
    update(view: PlayerView): void {
      if (replay) {
        replay.pendingView = view;
        return;
      }
      const key = view.players.map((p) => (p.eliminated ? "x" : "o")).join("");
      if (key !== boardKey || !layout) {
        boardKey = key;
        buildBoard(view);
      }
      for (const entry of view.players) {
        const pillar = pillars[entry.index];
        if (!pillar) continue;
        const height = 0.15 + 3 * Math.max(0, entry.life) / Math.max(1, options.startLife);
        pillar.mesh.scaling.y = height;
        pillar.mesh.position.y = height / 2;
        pillar.material.diffuseColor = entry.eliminated ? GREY : playerColor(entry.index);
        seatLabels.get(entry.index)?.setText(
          seatLabelText(entry, view.viewer),
          entry.eliminated ? "#b8b2a8" : Color3.Lerp(playerColor(entry.index), Color3.White(), 0.45).toHexString(),
          "rgba(20,18,16,0.8)",
        );
      }
      if (layout) updateFigures(view, layout);
      drawMarkers();
      const holder = view.centerResult?.holder ?? null;
      centerFreeMat.diffuseColor = holder === null ? STONE : Color3.Lerp(STONE, playerColor(holder), 0.3);
    },
    setMarkers(targets: readonly UnitLocation[], unit: UnitId | null): void {
      markerTargets = targets.slice();
      selectedUnit = unit;
      drawMarkers();
      if (replay) setBoardFiguresVisible(false);
    },
    playReplay(player: ReplayPlayer, onProgress: (finished: boolean) => void): void {
      endReplay();
      replay = { player, onProgress, pendingView: null, focusIndex: null };
      setBoardFiguresVisible(false);
      drawReplay(replay);
    },
    stopReplay(): void {
      endReplay();
    },
    dispose(): void {
      window.removeEventListener("resize", onResize);
      engine.dispose();
    },
  };
  return board;
}
