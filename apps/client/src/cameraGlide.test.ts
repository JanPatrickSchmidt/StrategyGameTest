import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { glideCamera } from "./cameraGlide";

function makeCamera(alpha: number): { camera: ArcRotateCamera; dispose: () => void } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("camera", alpha, 0.95, 40, Vector3.Zero(), scene);
  return { camera, dispose: () => engine.dispose() };
}

describe("glideCamera", () => {
  it("C4d: die Kamera behält beim Gleiten zur Arena und zurück ihren Blickwinkel (alpha)", () => {
    const { camera, dispose } = makeCamera(0.8);
    const arena = { target: new Vector3(14, 0, -9), radius: 18, beta: 0.7 };
    let settled = false;
    for (let i = 0; i < 400 && !settled; i++) settled = glideCamera(camera, arena, 16);
    expect(settled).toBe(true);
    expect(camera.alpha).toBeCloseTo(0.8, 9);
    expect(camera.radius).toBeCloseTo(18, 1);
    expect(camera.beta).toBeCloseTo(0.7, 2);
    expect(Vector3.Distance(camera.target, arena.target)).toBeLessThan(0.05);
    const overview = { target: Vector3.Zero(), radius: 35, beta: 0.95 };
    settled = false;
    for (let i = 0; i < 400 && !settled; i++) settled = glideCamera(camera, overview, 16);
    expect(settled).toBe(true);
    expect(camera.alpha).toBeCloseTo(0.8, 9);
    dispose();
  });

  it("C4d: ohne Neigung im Ziel bleibt die Neigung, ein großer Zeitschritt landet direkt am Ziel", () => {
    const { camera, dispose } = makeCamera(-2.1);
    camera.beta = 0.5;
    const settled = glideCamera(camera, { target: new Vector3(3, 0, 4), radius: 20 }, 100_000);
    expect(settled).toBe(true);
    expect(camera.beta).toBeCloseTo(0.5, 9);
    expect(camera.alpha).toBeCloseTo(-2.1, 9);
    dispose();
  });
});
