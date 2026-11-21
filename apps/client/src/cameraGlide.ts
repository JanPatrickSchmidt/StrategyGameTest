/**
 * Kamerafahrt des 3D-Bretts (C4c1, Befund aus C4d): Die Kamera gleitet weich zu einem Ziel (Arena der laufenden
 * Wiedergabe bzw. Übersicht), ohne ihren Blickwinkel um die Hochachse (`alpha`) zu verändern.
 *
 * Hintergrund: `ArcRotateCamera.target = …` behält die Kameraposition und rechnet daraus `alpha`, `beta` und
 * `radius` neu aus. Wandert das Ziel Bild für Bild, dreht sich dadurch die Blickrichtung mit; nach einer Runde
 * schaute die Kamera nicht mehr aus der eigenen Ecke. Deshalb wird das Ziel mit `setTarget(…, cloneAlphaBetaRadius)`
 * gesetzt.
 */
import { type ArcRotateCamera, Vector3 } from "@babylonjs/core";

export interface CameraGoal {
  readonly target: Vector3;
  readonly radius: number;
  readonly beta?: number;
}

/** Zeitkonstante der Fahrt in Millisekunden. */
const GLIDE_MS = 220;

/**
 * Bewegt die Kamera um `dt` Millisekunden auf `goal` zu (Ziel, Abstand, Neigung). `alpha` bleibt unverändert.
 * Liefert `true`, wenn das Ziel erreicht ist.
 */
export function glideCamera(camera: ArcRotateCamera, goal: CameraGoal, dt: number): boolean {
  const k = 1 - Math.exp(-dt / GLIDE_MS);
  const alpha = camera.alpha;
  camera.setTarget(Vector3.Lerp(camera.target, goal.target, k), false, true, true);
  camera.alpha = alpha;
  camera.radius += (goal.radius - camera.radius) * k;
  const beta = goal.beta ?? camera.beta;
  camera.beta += (beta - camera.beta) * k;
  const settled = Math.abs(camera.radius - goal.radius) < 0.05 && Math.abs(camera.beta - beta) < 0.005;
  return settled && Vector3.Distance(camera.target, goal.target) < 0.05;
}
