/**
 * meta DRIFTWOOD-FPS DF8 (mini-df8b, 2026-11-21): the device slot `debug.programFold` folds program variants that draw the
 * same pixels into one, so fewer programs exist and fewer link in play. Nothing drawn changes.
 *
 * - **The environment fold** (`installEnvironmentFold`). three keys a lit program by its environment's presence and cube
 *   height (`envMapCubeUVHeight`). A grid page has none (its road), while a cell's backdrop layer swaps the cell's PMREM in
 *   beside it, so every lit material had two programs, and the road crossing linked the no-environment one of each far
 *   batch and kit batch (the iPhone 13's 1.1 to 1.4 s frames, DF10). With the slot on, a scene drawn or compiled with no
 *   environment draws with a black one of the page's latest cube height instead: an all-zero cube-UV atlas adds zero to
 *   three's image-based light (`getIBLIrradiance`, `getIBLRadiance`) and to the graph's (`wsEnvironmentIrradianceAt`), so
 *   the pixels are those of the no-environment program, and the one program serves both.
 * - **Empty batches** (drawGuards.ts `skipEmptyBatches`): a BatchedMesh whose culling left no copy to draw is refused
 *   before its program is looked up (a kit batch whose members left with their cell linked two variants of its program
 *   for draws of nothing).
 * - **Batched members** (precompile.ts): a mesh a batch draws (`BATCHED_VIEW`, layers off) is never warmed for its own
 *   program.
 * - The far ring's batch programs warm before their batch replaces its proxies (game/grid/farBatch.ts). A creature's
 *   card shot keeps one plain material (entities/AnimalHerdView.ts) on every tier whose cards draw, fold or not.
 * Off by default; on at phone Low (DF8, mini-dwfps2) and on desktop (DF14, mini-dwfps).
 */
import * as THREE from 'three';
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';
import { latestEnvironmentHeight } from './drawnEnvironment';

export const PROGRAM_FOLD_SLOT = 'debug.programFold';
export const PROGRAM_FOLD_DEFAULT = false;
/** Unset at phone Low: on (meta DRIFTWOOD-FPS DF8, mini-dwfps2, 2026-11-23). With programReuse, programFold and
 *  bootRoadPrograms on, the calibrated stand-in (headless Chromium, phone Low, cap 30, CPU 2.0x, the driftwood-fps route)
 *  links no program after control and holds fewer programs (meta project/evidence/driftwood-fps/df8-phone-low-defaults-2026-11-23.md). */
export const PROGRAM_FOLD_PHONE_LOW = true;
/** Unset on desktop: on (meta DRIFTWOOD-FPS DF14, mini-dwfps, 2026-11-23). With the three DF8 program slots on, desktop High's
 *  driftwood-fps quick route linked 2 programs after control, not 73, and lost its village long frames (97 and 71 ms). */
export const PROGRAM_FOLD_DESKTOP = true;

/** The slot's value: a boolean (or a capture's `true`/`on`/1) wins; unset, PROGRAM_FOLD_PHONE_LOW at phone Low, PROGRAM_FOLD_DESKTOP on desktop, else PROGRAM_FOLD_DEFAULT. */
export function programFold(saved: unknown, phoneLow = false, desktop = false): boolean {
  if (typeof saved === 'boolean') return saved;
  if (saved === 'true' || saved === 'on' || saved === 1) return true;
  if (saved === 'false' || saved === 'off' || saved === 0) return false;
  return phoneLow ? PROGRAM_FOLD_PHONE_LOW : desktop ? PROGRAM_FOLD_DESKTOP : PROGRAM_FOLD_DEFAULT;
}

let picked: boolean | undefined;
/** Whether this page folds program variants; read once per page. */
export function programFoldOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(PROGRAM_FOLD_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = programFold(saved, phoneLow, TIER === 'desktop');
  return picked;
}
/** Tests only: read the slot again. */
export function resetProgramFold(): void { picked = undefined; }

/** the black environments, one per cube height */
const blacks = new Map<number, THREE.WebGLRenderTarget>();
const black = new WeakSet();
/** Whether `texture` is one of the fold's black environments (never a page environment to record). */
export function isFoldEnvironment(texture: unknown): boolean { return typeof texture === 'object' && texture !== null && black.has(texture); }

/** PMREM's cube-UV atlas for cube height `height` (3·max(size, 112) × 4·size, size = height / 4): every texel 0 */
function blackEnvironment(renderer: THREE.WebGLRenderer, height: number): THREE.Texture {
  const held = blacks.get(height);
  if (held !== undefined) return held.texture;
  const size = height / 4;
  const target = new THREE.WebGLRenderTarget(3 * Math.max(size, 16 * 7), height, {
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, type: THREE.HalfFloatType,
    format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false,
  });
  target.texture.mapping = THREE.CubeUVReflectionMapping;
  target.texture.name = 'program-fold:black-environment';
  const before = { target: renderer.getRenderTarget(), colour: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  try { renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false); }
  finally { renderer.setClearColor(before.colour, before.alpha); renderer.setRenderTarget(before.target); }
  blacks.set(height, target); black.add(target.texture);
  return target.texture;
}

/**
 * A scene's `userData` flag: the fold leaves it unlit by any environment (mini-df8c). A creature's card shot (spriteViews.ts)
 * draws its own scene with none, at boot (its warm, AnimalHerdView.stageWarmCards) and in play. Folded, its program keyed
 * on whether the page had recorded a cube height yet, so the boot's warm linked the unfolded program and the first shot in
 * play the folded one (31.5 s into the Driftwood route). Exempt, both are the one unfolded program; the pixels are those
 * of an environment of zero either way.
 */
export const FOLD_EXEMPT = 'programFold.exempt';
const foldExempt = (scene: THREE.Scene): boolean => scene.userData[FOLD_EXEMPT] === true;

type Call = (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Object3D | null) => unknown;
const isScene = (value: unknown): value is THREE.Scene => value instanceof THREE.Scene;
const usableHeight = (height: number | null): height is number => height !== null && Number.isInteger(height) && height >= 64 && height % 4 === 0;

/** the renderers with the fold installed: their height source and draw depth (`foldScene`) */
const folds = new WeakMap<object, { readonly height: () => number | null; readonly depth: () => number }>();

/**
 * The environment fold on `renderer`: its `render`, `compile` and `compileAsync` see a scene with no environment as lit by
 * the black environment of the page's latest cube height (none recorded yet: unchanged), restored as the call returns
 * (an async compile issues its programs inside the call). A render inside another draws as its outer one left it. Returns
 * the undo.
 */
export function installEnvironmentFold(renderer: THREE.WebGLRenderer, height: () => number | null = latestEnvironmentHeight): () => void {
  let depth = 0;
  folds.set(renderer, { height, depth: () => depth });
  const wrap = (name: 'render' | 'compile' | 'compileAsync'): (() => void) => {
    const own = Object.getOwnPropertyDescriptor(renderer, name);
    const call = Reflect.get(renderer, name) as Call;
    const folded: Call = function folded(scene, camera, target) {
      const lit = target ?? scene;
      const at = height();
      if (!isScene(lit) || lit.environment !== null || foldExempt(lit) || !usableHeight(at)) { depth++; try { return Reflect.apply(call, renderer, [scene, camera, ...target === undefined ? [] : [target]]); } finally { depth--; } }
      // the atlas is cleared between draws only, never inside another draw's state
      const environment = depth === 0 || blacks.has(at) ? blackEnvironment(renderer, at) : null;
      if (environment !== null) lit.environment = environment;
      depth++;
      try { return Reflect.apply(call, renderer, [scene, camera, ...target === undefined ? [] : [target]]); } finally {
        depth--;
        if (environment !== null && lit.environment === environment) lit.environment = null;
      }
    };
    Reflect.set(renderer, name, folded);
    return () => { if (Reflect.get(renderer, name) !== folded) return; if (own !== undefined) Object.defineProperty(renderer, name, own); else Reflect.deleteProperty(renderer, name); };
  };
  const undo = [wrap('render'), wrap('compile'), wrap('compileAsync')];
  return () => { folds.delete(renderer); for (const u of undo.reverse()) u(); };
}

/**
 * Light `scene` (no environment) by the fold's black environment until the returned undo, on a renderer with the fold
 * installed (else a no-op): for a warm-up that runs a material's own draw hook before `compile` (a classic graph reads its
 * scene's environment there, precompile.ts), so the hook and the compile key the program the draw will use.
 */
export function foldScene(renderer: object, scene: THREE.Object3D | null | undefined): () => void {
  const fold = folds.get(renderer);
  if (fold === undefined || !isScene(scene) || scene.environment !== null || foldExempt(scene) || !(renderer instanceof THREE.WebGLRenderer)) return () => undefined;
  const at = fold.height();
  if (!usableHeight(at) || (fold.depth() > 0 && !blacks.has(at))) return () => undefined;
  const environment = blackEnvironment(renderer, at);
  scene.environment = environment;
  return () => { if (scene.environment === environment) scene.environment = null; };
}
