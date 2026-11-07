import type { Camera, Material, Object3D, Scene, WebGLRenderTarget } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';

/** An existing offscreen override pass: preparation borrows its exact material, camera and target, without drawing it. */
export interface OffscreenPreparation {
  readonly label: string;
  readonly camera: Camera;
  readonly material: Material;
  readonly target: WebGLRenderTarget;
  /** The authored vertex shader reads position only (plus object transforms), not normal/colour/UV attributes.
   * Three's draw cache reuses those unused attribute variants; prepare one caster per object flag set too. */
  readonly positionOnly?: boolean;
  /** Current authored caster roots, including content that completed streaming before warm-up. */
  readonly roots: () => readonly Object3D[];
}

const passes = new WeakMap<Scene, Set<OffscreenPreparation>>();

/** Register a live offscreen pass for sliced shader preparation. The owner removes it before its resources retire. */
export function registerOffscreenPreparation(scene: Scene, owner: Scope, pass: OffscreenPreparation): void {
  if (owner.disposed) throw new Error('Offscreen preparation requires a live owner');
  let entries = passes.get(scene);
  if (entries === undefined) { entries = new Set(); passes.set(scene, entries); }
  if (entries.has(pass)) throw new Error('Offscreen preparation is already registered');
  entries.add(pass);
  const held = entries;
  owner.onDispose(() => { held.delete(pass); if (held.size === 0) passes.delete(scene); });
}

let heldBakes = 0;
/** DL10: a frame of systems that may not bake. The loader's pose step runs before Shaders has linked anything, and a registered
 *  pass that bakes in it links its programs inside that frame (Nalati's static capture: 1.1-1.5 s on the Simulator, 311 of 811 ms
 *  on one link read at phone CPU, read as step 17, 19 or 24 by where the card last moved). The next frame bakes. */
export function withoutOffscreenBakes(run: () => void): void {
  heldBakes++;
  try { run(); } finally { heldBakes--; }
}
export const offscreenBakesHeld = (): boolean => heldBakes > 0;

/** Read the borrowed passes for one scene; empty after their owners retire. Does not run any render or update. */
export function offscreenPreparations(scene: Scene): readonly OffscreenPreparation[] { return [...(passes.get(scene) ?? [])]; }
