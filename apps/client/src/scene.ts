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
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { GameData, PlayerIndex, PlayerView, UnitId } from "@game/engine";
import { type BoardLayout, buildBoardLayout, frontPairsFor, type LayoutConfig, locationPosition, seatAngle } from "./boardLayout";
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
  dispose(): void;
}

export interface BoardSceneOptions {
  /** Spieldaten (für die Form der Einheiten nach Kartenwerten). */
  data: GameData;
  layout: Omit<LayoutConfig, "hexSize">;
  startLife: number;
  players: number;
  /** Sitz des Betrachters; die Kamera schaut aus seiner Ecke. */
  viewer: PlayerIndex;
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
  function figureSource(figure: UnitFigure): Mesh {
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
        entry = { mesh: figureSource(figure).createInstance(`unit${figure.unitId}`), key, badge };
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

  scene.onBeforeRenderObservable.add(() => {
    const scale = Math.min(BADGE_MAX_SCALE, Math.max(1, camera.radius / BADGE_REFERENCE_RADIUS));
    for (const entry of figures.values()) entry.badge.mesh.scaling.setAll(scale);
  });

  const onResize = (): void => engine.resize();
  window.addEventListener("resize", onResize);
  engine.runRenderLoop(() => scene.render());

  return {
    update(view: PlayerView): void {
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
      const holder = view.centerResult?.holder ?? null;
      centerFreeMat.diffuseColor = holder === null ? STONE : Color3.Lerp(STONE, playerColor(holder), 0.3);
    },
    dispose(): void {
      window.removeEventListener("resize", onResize);
      engine.dispose();
    },
  };
}
