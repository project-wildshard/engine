import * as THREE from 'three';
import { engineString } from '../../../shared/engine/strings';
import { pageScope } from '../../../shared/engine/app/resources';
import { linkStandIn } from '../app/sceneOwnership';
import type { Renderer } from './renderer';
import { runPrecompile, type CompileJob } from './precompile';

interface Draw {
  root: THREE.Object3D; camera: THREE.Camera; target: THREE.WebGLRenderTarget;
  viewport: THREE.Vector4; scissor: THREE.Vector4; scissorTest: boolean;
  autoClear: boolean; toneMapping: THREE.ToneMapping; xr: boolean;
  material: THREE.Material | THREE.Material[] | null;
  background: THREE.Scene['background'] | undefined;
  uniforms: Map<THREE.ShaderMaterial, Map<string, unknown>>;
}

const isMesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh;
const isScene = (object: THREE.Object3D): object is THREE.Scene => object instanceof THREE.Scene;

function materialUniforms(material: THREE.ShaderMaterial, clone = true): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const [key, uniform] of Object.entries(material.uniforms)) { const value: unknown = uniform.value; entries.set(key, clone ? uniformValue(value) : value); }
  return entries;
}

function uniformValue(value: unknown): unknown {
  if (value instanceof THREE.Color || value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4
    || value instanceof THREE.Matrix3 || value instanceof THREE.Matrix4 || value instanceof THREE.Quaternion) return value.clone();
  if (Array.isArray(value)) return value.map(uniformValue);
  // Samplers and render targets stay borrowed, never cloned or decoded a second time.
  return value;
}

function uniformsOf(root: THREE.Object3D, clone = true): Draw['uniforms'] {
  const result: Draw['uniforms'] = new Map();
  root.traverse(object => {
    if (!isMesh(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material instanceof THREE.ShaderMaterial && !result.has(material)) {
      result.set(material, materialUniforms(material, clone));
    }
  });
  return result;
}

function applyUniforms(uniforms: Draw['uniforms']): void {
  for (const [material, entries] of uniforms) {
    for (const [key, value] of entries) {
      const uniform = material.uniforms[key];
      if (uniform === undefined) throw new Error('Offscreen uniform disappeared during preparation');
      uniform.value = value;
    }
    material.uniformsNeedUpdate = true;
  }
}

const paint = (): Promise<void> => new Promise(resolve => { pageScope.raf(() => { pageScope.timeout(0, resolve); }); });

function captureCommands(renderer: Renderer): { commands: Renderer; draws: Draw[]; finish: () => void } {
  const draws: Draw[] = [];
  let capturing = true;
  let target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  let autoClear = renderer.autoClear, toneMapping = renderer.toneMapping;
  const xr = { enabled: renderer.xr.enabled };
  const commands = new Proxy(renderer, {
    get(object, key): unknown {
      if (!capturing) {
        const value: unknown = Reflect.get(object, key, object);
        return typeof value === 'function' ? (...args: unknown[]): unknown => { const result: unknown = Reflect.apply(value, object, args); return result; } : value;
      }
      if (key === 'autoClear') return autoClear;
      if (key === 'toneMapping') return toneMapping;
      if (key === 'xr') return xr;
      if (key === 'getRenderTarget') return () => target;
      if (key === 'getActiveCubeFace') return () => face;
      if (key === 'getActiveMipmapLevel') return () => mip;
      if (key === 'setRenderTarget') return (next: THREE.WebGLRenderTarget | null, nextFace = 0, nextMip = 0): void => { target = next; face = nextFace; mip = nextMip; };
      if (key === 'clearDepth') return (): never => { throw new Error('Offscreen depth clear is not supported during capture'); };
      if (key === 'render') return (root: THREE.Object3D, camera: THREE.Camera): void => {
        if (target === null || face !== 0 || mip !== 0) throw new Error('Offscreen build requires an ordinary offscreen target');
        if (draws.length >= 256) throw new Error('Offscreen build exceeds the pass limit');
        draws.push({ root, camera: camera.clone(), target, viewport: target.viewport.clone(), scissor: target.scissor.clone(), scissorTest: target.scissorTest,
          autoClear, toneMapping, xr: xr.enabled, material: isMesh(root) ? root.material : null,
          background: isScene(root) ? root.background : undefined, uniforms: uniformsOf(root) });
      };
      const value: unknown = Reflect.get(object, key, object);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => { const result: unknown = Reflect.apply(value, object, args); return result; };
    },
    set(object, key, value: unknown): boolean {
      if (!capturing) return Reflect.set(object, key, value, object);
      if (key === 'autoClear' && typeof value === 'boolean') { autoClear = value; return true; }
      if (key === 'toneMapping' && typeof value === 'number') { toneMapping = value as THREE.ToneMapping; return true; }
      throw new Error('Offscreen build changed an unsupported renderer setting');
    },
  });
  return { commands, draws, finish: () => { capturing = false; target = null; } };
}

/** The captured draws' actual shader variants, linked in parallel (`runPrecompile`) before any of them is drawn. */
async function precompileDraws(renderer: Renderer, draws: readonly Draw[], current: () => boolean): Promise<void> {
  const jobs: CompileJob[] = draws.map((draw, index) => {
    const copy = draw.root.clone(true);
    const link = (source: THREE.Object3D, clone: THREE.Object3D): void => {
      linkStandIn(clone, source);
      for (const [i, child] of source.children.entries()) { const cloned = clone.children[i]; if (cloned !== undefined) link(child, cloned); }
    };
    link(draw.root, copy);
    if (isMesh(copy) && draw.material !== null) copy.material = draw.material;
    if (isScene(copy) && draw.background !== undefined) copy.background = draw.background;
    return { label: engineString('s_4bdf150dd0ed', [index + 1]), root: copy, camera: draw.camera, target: isScene(copy) ? copy : null, rt: draw.target, toneMapping: draw.toneMapping };
  });
  await runPrecompile(renderer, new THREE.PerspectiveCamera(), jobs, new Set(draws.flatMap(draw => [...draw.uniforms.keys()])).size, undefined, undefined, current);
}

const webKit = (): boolean => navigator.userAgent.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(navigator.userAgent);

/** DL23: link a synchronous offscreen factory's programs (PMREM's equirect and GGX passes, the source pass) without
 * drawing anything, so the factory's later real run in a frame finds them linked. The factory runs once on capturing
 * commands (no draw reaches the GPU) and its output is freed; whatever it made and keeps (a generator's materials and
 * ping-pong target) is the caller's to reuse. `webKitOnly` does nothing elsewhere, as `prepareOffscreenBuild`. */
export async function warmOffscreenBuild(renderer: Renderer, build: (commands: Renderer) => THREE.WebGLRenderTarget,
  current: () => boolean, options: { webKitOnly?: boolean } = {}): Promise<void> {
  if (!current()) throw new Error('Offscreen build owner left');
  if (options.webKitOnly === true && !webKit()) return;
  const capture = captureCommands(renderer), draws = capture.draws;
  let output: THREE.WebGLRenderTarget | null = null;
  try {
    try { output = build(capture.commands); } finally { capture.finish(); }
    await precompileDraws(renderer, draws, current);
  } finally { output?.dispose(); draws.length = 0; }
}

/** Capture a synchronous, offscreen-only factory such as PMREM, prepare its actual shader variants,
 * then replay its draws in painted slices. The factory retains its meshes/materials until resolution;
 * cameras, viewports and scalar/vector uniforms are captured, while samplers stay borrowed.
 * Canvas draws refuse. Live renderer state is restored before every yield, failure and return.
 * `webKitOnly` leaves other browsers on the synchronous factory path. */
export async function prepareOffscreenBuild(renderer: Renderer, build: (commands: Renderer) => THREE.WebGLRenderTarget,
  current: () => boolean, options: { webKitOnly?: boolean } = {}): Promise<THREE.WebGLRenderTarget> {
  const check = (): void => { if (!current()) throw new Error('Offscreen build owner left'); };
  check();
  if (options.webKitOnly === true && !webKit()) return build(renderer);
  const capture = captureCommands(renderer), draws = capture.draws;
  let output: THREE.WebGLRenderTarget;
  try { output = build(capture.commands); } catch (error) { draws.length = 0; throw error; } finally { capture.finish(); }
  try {
    await precompileDraws(renderer, draws, current);
    for (const draw of draws) {
      check();
      const priorTarget = renderer.getRenderTarget(), priorFace = renderer.getActiveCubeFace(), priorMip = renderer.getActiveMipmapLevel();
      const priorAuto = renderer.autoClear, priorTone = renderer.toneMapping, priorXr = renderer.xr.enabled;
      const priorViewport = draw.target.viewport.clone(), priorScissor = draw.target.scissor.clone(), priorTest = draw.target.scissorTest;
      const priorMaterial = isMesh(draw.root) ? draw.root.material : null;
      const priorBackground = isScene(draw.root) ? draw.root.background : undefined;
      const priorUniforms: Draw['uniforms'] = new Map();
      const priorUpdate = new Map<THREE.ShaderMaterial, boolean>();
      for (const material of draw.uniforms.keys()) {
        priorUniforms.set(material, materialUniforms(material, false));
        priorUpdate.set(material, material.uniformsNeedUpdate);
      }
      try {
        if (isMesh(draw.root) && draw.material !== null) draw.root.material = draw.material;
        if (isScene(draw.root) && draw.background !== undefined) draw.root.background = draw.background;
        applyUniforms(draw.uniforms);
        renderer.autoClear = draw.autoClear; renderer.toneMapping = draw.toneMapping; renderer.xr.enabled = draw.xr;
        draw.target.viewport.copy(draw.viewport); draw.target.scissor.copy(draw.scissor); draw.target.scissorTest = draw.scissorTest;
        renderer.setRenderTarget(draw.target);
        renderer.render(draw.root, draw.camera);
      } finally {
        applyUniforms(priorUniforms);
        for (const [material, update] of priorUpdate) material.uniformsNeedUpdate = update;
        if (isMesh(draw.root) && priorMaterial !== null) draw.root.material = priorMaterial;
        if (isScene(draw.root) && priorBackground !== undefined) draw.root.background = priorBackground;
        draw.target.viewport.copy(priorViewport); draw.target.scissor.copy(priorScissor); draw.target.scissorTest = priorTest;
        renderer.autoClear = priorAuto; renderer.toneMapping = priorTone; renderer.xr.enabled = priorXr;
        renderer.setRenderTarget(priorTarget, priorFace, priorMip);
      }
      await paint();
    }
    check(); return output;
  } catch (error) { output.dispose(); throw error; }
  finally { draws.length = 0; }
}
