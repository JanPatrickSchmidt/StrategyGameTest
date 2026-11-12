/**
 * Babylon.js-Szene (C1): Platzhalter, bis C2 das 3D-Brett baut. Zeigt je Spieler eine sechseckige Säule
 * im Ring der Sitze (R-2.1) und die Mitte; die Höhe folgt den Lebenspunkten, Ausgeschiedene werden grau.
 * Farbwelt nach `docs/stil/visuelle-richtung.md`: gedeckter Untergrund, gedämpfte Spielerfarben,
 * warmes Hauptlicht mit kühlem Gegenlicht.
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { PlayerView } from "@game/engine";

/** Gedämpfte, klar unterscheidbare Spielerfarben (Platz 1–4). */
export const PLAYER_COLORS: readonly string[] = ["#4f7fa8", "#a8513f", "#5f8a4f", "#b08a3a"];

export interface BoardScene {
  update(view: PlayerView): void;
  dispose(): void;
}

export function createBoardScene(canvas: HTMLCanvasElement, players: number, startLife: number): BoardScene {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.16, 0.15, 0.14, 1);

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3.2, 14, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 24;
  camera.attachControl(canvas, true);

  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.45;
  fill.diffuse = new Color3(0.7, 0.78, 0.9);
  fill.groundColor = new Color3(0.2, 0.18, 0.16);
  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.4), scene);
  sun.intensity = 0.9;
  sun.diffuse = new Color3(1, 0.86, 0.68);

  const ground = MeshBuilder.CreateCylinder("ground", { diameter: 13, height: 0.2, tessellation: 6 }, scene);
  ground.position.y = -0.1;
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.36, 0.33, 0.29);
  groundMat.specularColor = new Color3(0.05, 0.05, 0.05);
  ground.material = groundMat;

  const center = MeshBuilder.CreateCylinder("center", { diameter: 2.2, height: 0.3, tessellation: 6 }, scene);
  center.position.y = 0.15;
  const centerMat = new StandardMaterial("centerMat", scene);
  centerMat.diffuseColor = new Color3(0.5, 0.46, 0.4);
  center.material = centerMat;

  const pillars: { mesh: Mesh; material: StandardMaterial }[] = [];
  for (let p = 0; p < players; p++) {
    const mesh = MeshBuilder.CreateCylinder(`player${p}`, { diameter: 1.8, height: 1, tessellation: 6 }, scene);
    // Sitz 0 vorne (zur Kamera), dann im Uhrzeigersinn.
    const angle = -Math.PI / 2 - (2 * Math.PI * p) / players;
    mesh.position.x = Math.cos(angle) * 4.2;
    mesh.position.z = Math.sin(angle) * 4.2;
    const material = new StandardMaterial(`player${p}Mat`, scene);
    material.diffuseColor = Color3.FromHexString(PLAYER_COLORS[p % PLAYER_COLORS.length] ?? "#888888");
    material.specularColor = new Color3(0.08, 0.08, 0.08);
    mesh.material = material;
    pillars.push({ mesh, material });
  }

  const onResize = (): void => engine.resize();
  window.addEventListener("resize", onResize);
  engine.runRenderLoop(() => scene.render());

  return {
    update(view: PlayerView): void {
      for (const entry of view.players) {
        const pillar = pillars[entry.index];
        if (!pillar) continue;
        const height = 0.15 + 2.5 * Math.max(0, entry.life) / Math.max(1, startLife);
        pillar.mesh.scaling.y = height;
        pillar.mesh.position.y = height / 2;
        pillar.material.diffuseColor = entry.eliminated
          ? new Color3(0.3, 0.3, 0.3)
          : Color3.FromHexString(PLAYER_COLORS[entry.index % PLAYER_COLORS.length] ?? "#888888");
      }
      const holder = view.centerResult?.holder ?? null;
      centerMat.diffuseColor =
        holder === null ? new Color3(0.5, 0.46, 0.4) : Color3.FromHexString(PLAYER_COLORS[holder] ?? "#888888").scale(0.8);
    },
    dispose(): void {
      window.removeEventListener("resize", onResize);
      engine.dispose();
    },
  };
}
