import { Vector3, WebGLRenderer, WebGLRenderTarget, type Camera, type PMREMGenerator, type Scene, type Texture } from 'three';
import { tierPmremCube, tierPmremGenerator } from './pmremSize';

/**
 * A day clock's sky as the scene's image-based light (SHARD-PLATFORM W2 C2; Pine Hollow's keyed sky and Driftwood's faceted
 * day): the sky drawn into a PMREM environment and refreshed as the clock moves on, in place. After the first build the
 * same cube-UV target is filled again, so `scene.environment` keeps its identity (every program its envmap define) and no
 * second target is allocated beside the old one. Nothing here knows a shard or its sky: the caller hands over what to draw
 * and keeps the generator and the target.
 *
 *   cube = refreshSkyEnvironment(gen, source, cube);   // the whole refresh (the first call allocates the target)
 *   step = stepSkyEnvironment(gen, source, cube, step); // a stepped refresh: one step a frame, -1 when done
 *
 * Everything draws with the generator's own renderer.
 *
 * THE SOURCE is an equirect pass (a scene + camera drawn into an equirect target, PMREM'd from that texture; the cube is a
 * quarter of its width) or a scene seen from the origin by PMREM's cube camera (`size` the cube, `near` / `far` its planes).
 *
 * THE STEPS (E142, the 30-fps-at-2× lane): the whole refresh is the source into the cube's top level, then r186's GGX
 * prefilter, ten 256-sample passes (~2 ms of an M5's GPU in one frame, a phone frame's whole budget). A stepped refresh
 * runs one step a frame instead: the top level, then one GGX level a frame. Both drive PMREMGenerator's internals
 * (`canStepSkyEnvironment`); a three upgrade that renames one falls back to the public whole refresh (a new target, the
 * old one freed).
 */

/** What the environment is drawn from. */
export type SkyEnvironmentSource =
  | { readonly kind: 'equirect'; readonly scene: Scene; readonly camera: Camera; readonly target: WebGLRenderTarget }
  | { readonly kind: 'scene'; readonly scene: Scene; readonly size: number; readonly near: number; readonly far: number };

/** the PMREMGenerator (r186) internals the in-place and stepped refreshes drive */
interface PmremSteps {
  _renderer: WebGLRenderer;
  _setSize: (cubeSize: number) => void;
  _textureToCubeUV: (texture: Texture, target: WebGLRenderTarget) => void;
  _sceneToCubeUV: (scene: Scene, near: number, far: number, target: WebGLRenderTarget, position: Vector3) => void;
  _applyGGXFilter: (target: WebGLRenderTarget, lodIn: number, lodOut: number) => void;
  _lodMeshes: unknown[];
}
/** The generator still has the internals the in-place and stepped refreshes drive. */
export function canStepSkyEnvironment(gen: object): gen is PmremSteps {
  return ['_setSize', '_textureToCubeUV', '_sceneToCubeUV', '_applyGGXFilter'].every((k) => typeof Reflect.get(gen, k) === 'function') && Array.isArray(Reflect.get(gen, '_lodMeshes')) && Reflect.get(gen, '_renderer') instanceof WebGLRenderer;
}

const ORIGIN = new Vector3();
/** a target's GPU bytes: half-float RGBA colour (8 a texel), its depth buffer at 4 */
const targetBytes = (t: { readonly width: number; readonly height: number; readonly depthBuffer: boolean }): number => t.width * t.height * (t.depthBuffer ? 12 : 8);
/** one of PMREM's cube-UV atlases at cube size `size` (3·max(size, 112) × 4·size) */
const atlasBytes = (size: number, depth: boolean): number => 3 * Math.max(size, 16 * 7) * 4 * size * (depth ? 12 : 8);
const cubeSize = (source: SkyEnvironmentSource): number => tierPmremCube(source.kind === 'equirect' ? source.target.width / 4 : source.size);

/** run one PMREM step, then PMREMGenerator._cleanup's target reset (its own restores a module-level target from its last whole run) */
function inPlace(renderer: WebGLRenderer, cube: WebGLRenderTarget, atlas: boolean, run: () => void): void {
  const prev = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), autoClear = renderer.autoClear;
  try {
    if (atlas) renderer.autoClear = false; // as PMREMGenerator._applyPMREM: each level is drawn into its own rectangle of the atlas
    run();
  } finally {
    renderer.autoClear = autoClear;
    cube.scissorTest = false;
    cube.viewport.set(0, 0, cube.width, cube.height);
    cube.scissor.set(0, 0, cube.width, cube.height);
    renderer.setRenderTarget(prev, face, mip);
  }
}

/** the source into the cube's top level (a scene: its depth cleared first, PMREM draws the six faces without clearing) */
function topLevel(renderer: WebGLRenderer, gen: PmremSteps, source: SkyEnvironmentSource, cube: WebGLRenderTarget): void {
  gen._setSize(cubeSize(source));
  renderer.setRenderTarget(source.kind === 'equirect' ? source.target : cube);
  if (source.kind === 'equirect') {
    renderer.render(source.scene, source.camera);
    gen._textureToCubeUV(source.target.texture, cube);
  } else {
    renderer.clearDepth();
    gen._sceneToCubeUV(source.scene, source.near, source.far, cube, ORIGIN);
  }
}

/** a stepped scene source draws its top level one cube face a step (each face its background box and the scene) */
const sourceFaces = (source: SkyEnvironmentSource): number => source.kind === 'scene' ? 6 : 1;

/**
 * One face of a scene's top level (G913: the six faces in one frame were 12 draws above the frame's own). PMREM sets each
 * face's rectangle as the target's viewport before it draws that face, so only the draws made while the viewport is on
 * face `face` go through; the depth is cleared with the first face.
 */
function topLevelFace(renderer: WebGLRenderer, gen: PmremSteps, source: Extract<SkyEnvironmentSource, { kind: 'scene' }>, cube: WebGLRenderTarget, face: number): void {
  const size = cubeSize(source), render: unknown = Reflect.get(renderer, 'render'), own = Object.hasOwn(renderer, 'render');
  if (typeof render !== 'function') throw new Error('sky environment: the renderer has no render');
  gen._setSize(size);
  renderer.setRenderTarget(cube);
  if (face === 0) renderer.clearDepth();
  renderer.render = (scene, camera) => {
    const at = Math.round(cube.viewport.x / size) + (cube.viewport.y >= size ? 3 : 0);
    if (at === face) Reflect.apply(render, renderer, [scene, camera]);
  };
  try { gen._sceneToCubeUV(source.scene, source.near, source.far, cube, ORIGIN); }
  finally { if (own) Reflect.set(renderer, 'render', render); else Reflect.deleteProperty(renderer, 'render'); }
}

/** The whole refresh: the source PMREM'd into `cube` in place (the first call, `cube` null, allocates it); returns the target. */
export function refreshSkyEnvironment(gen: PMREMGenerator, source: SkyEnvironmentSource, cube: WebGLRenderTarget | null): WebGLRenderTarget {
  if (source.kind === 'equirect') {
    const renderer: unknown = Reflect.get(gen, '_renderer');
    if (!(renderer instanceof WebGLRenderer)) throw new Error('sky environment: the PMREM generator has no renderer');
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(source.target);
    renderer.render(source.scene, source.camera);
    renderer.setRenderTarget(prev);
    return gen.fromEquirectangular(source.target.texture, cube);
  }
  if (cube === null || !canStepSkyEnvironment(gen)) {
    const rt = gen.fromScene(source.scene, 0, source.near, source.far, { size: cubeSize(source) });
    cube?.dispose();
    return rt;
  }
  const renderer = gen._renderer;
  inPlace(renderer, cube, false, () => { topLevel(renderer, gen, source, cube); });
  for (let i = 1; i < gen._lodMeshes.length; i++) inPlace(renderer, cube, true, () => { gen._applyGGXFilter(cube, i - 1, i); });
  return cube;
}

/**
 * One step of a stepped refresh into `cube` (built by a whole refresh first; check `canStepSkyEnvironment`): the top level
 * from the source (an equirect in one step, a scene one face a step), then one GGX level a step from the one above.
 * Returns the next step, or -1 when the refresh is done.
 */
export function stepSkyEnvironment(gen: PmremSteps, source: SkyEnvironmentSource, cube: WebGLRenderTarget, step: number): number {
  const renderer = gen._renderer, faces = sourceFaces(source), level = step - faces + 1;
  if (step < faces) inPlace(renderer, cube, false, () => { if (source.kind === 'scene') topLevelFace(renderer, gen, source, cube, step); else topLevel(renderer, gen, source, cube); });
  else inPlace(renderer, cube, true, () => { gen._applyGGXFilter(cube, level - 1, level); });
  return step + 1 < faces + gen._lodMeshes.length - 1 ? step + 1 : -1;
}

/** The GPU bytes held now: an equirect pass's target, the environment target and the generator's ping-pong atlas. */
export function skyEnvironmentBytes(source: SkyEnvironmentSource, cube: WebGLRenderTarget | null, gen: PMREMGenerator | null): number {
  let bytes = (source.kind === 'equirect' ? targetBytes(source.target) : 0) + (cube === null ? 0 : targetBytes(cube));
  const ping: unknown = gen === null ? null : Reflect.get(gen, '_pingPongRenderTarget');
  if (ping instanceof WebGLRenderTarget) bytes += targetBytes(ping);
  return bytes;
}

/** The most it can hold: an equirect pass's target and two atlases (a scene's: two environment targets beside the ping-pong). */
export function skyEnvironmentCeiling(source: SkyEnvironmentSource): number {
  const size = cubeSize(source);
  if (source.kind === 'equirect') return targetBytes(source.target) + 2 * atlasBytes(size, false);
  return 2 * atlasBytes(size, true) + atlasBytes(size, false);
}

/** How a `SkyEnvironment` refreshes: every `every` seconds, whole or one step a frame; `ready` false skips a refresh. */
export interface SkyEnvironmentRefresh { readonly every: number; readonly stepped: boolean; readonly ready?: () => boolean }

/**
 * A day clock's environment owner: its PMREM generator (made on the first refresh, after a context loss again), the one
 * cube-UV target filled in place, the refresh timer (whole, or `stepped` one step a frame), `scene.environment`, and their
 * release (the environment cleared only if still its own). The backdrop keeps its source and calls `refresh` on a jump.
 */
export class SkyEnvironment {
  private gen: PMREMGenerator | null = null;
  private cube: WebGLRenderTarget | null = null;
  private texture: Texture | null = null;
  private timer = 0;
  /** the stepped refresh's next step: -1 idle, 0 the top level, i GGX level i */
  private step = -1;
  private disposed = false;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly source: SkyEnvironmentSource;
  private readonly how: SkyEnvironmentRefresh;

  constructor(renderer: WebGLRenderer, scene: Scene, source: SkyEnvironmentSource, how: SkyEnvironmentRefresh) {
    this.renderer = renderer; this.scene = scene; this.source = source; this.how = how;
  }

  /** take over a generator and target built elsewhere (an offscreen first build) as the scene's environment */
  adopt(gen: PMREMGenerator | null, cube: WebGLRenderTarget): void { this.gen = gen; this.set(cube); }

  /** the whole refresh now, in place (a stepped one in flight is superseded) */
  refresh(): void {
    if (this.disposed) return;
    this.timer = 0;
    this.step = -1;
    if (this.how.ready?.() === false) return;
    this.gen ??= tierPmremGenerator(this.renderer);
    this.set(refreshSkyEnvironment(this.gen, this.source, this.cube));
  }

  /** the clock's tick: a refresh due every `every` seconds, whole or one step a frame */
  update(dt: number): void {
    this.timer += dt;
    if (!this.how.stepped) { if (this.timer > this.how.every) this.refresh(); return; }
    if (this.step < 0 && this.timer > this.how.every) { this.timer = 0; this.step = 0; }
    if (this.step < 0) return;
    const gen = this.gen, cube = this.cube;
    if (gen === null || cube === null || !canStepSkyEnvironment(gen) || this.how.ready?.() === false) { this.refresh(); return; }
    this.step = stepSkyEnvironment(gen, this.source, cube, this.step);
  }

  /** after an in-place WebGL restore: the old generator and target belong to the lost context; the next refresh rebuilds */
  rebuild(): void { this.gen = null; this.cube = null; }

  /** free the target and the generator; the scene's environment is cleared only if still its own */
  dispose(): void {
    this.disposed = true;
    if (this.texture !== null && this.scene.environment === this.texture) this.scene.environment = null;
    this.texture = null;
    this.cube?.dispose(); this.cube = null;
    this.gen?.dispose(); this.gen = null;
  }

  /** the GPU bytes held now (skyEnvironmentBytes) */
  bytes(): number { return skyEnvironmentBytes(this.source, this.cube, this.gen); }
  /** the most it can hold (skyEnvironmentCeiling) */
  ceiling(): number { return skyEnvironmentCeiling(this.source); }

  private set(cube: WebGLRenderTarget): void { this.cube = cube; this.texture = cube.texture; this.scene.environment = cube.texture; }
}
