import * as v from 'valibot';
import { StaticCaptureSchema, type StaticCaptureRows } from '@wildshard/format/fieldPresentation';
import * as THREE from 'three';
import { onGpuRestored } from '@wildshard/engine/core/gpuOnly';
import { TIER } from '@wildshard/engine/core/tier';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { Scope } from '@wildshard/engine/app/scope';
import { loadLookGraphCompiler } from '@wildshard/engine/render/graphBackend';
import type { GraphIr } from '@wildshard/format/materialGraph';

import { offscreenBakesHeld, registerOffscreenPreparation } from '@wildshard/engine/render/offscreenPreparation';


/** Client-only static shadow and contact capture. Scene bounds and quality are authored rows; the pass programs are the host's. */
export function staticCaptureUniforms(input: unknown): StaticCaptureUniforms {
  const row = v.parse(StaticCaptureSchema,input);
  const SIZE = row.shadowSize[TIER], HALF = row.half;
  return {
  tBakeShadow: { value: null as THREE.Texture | null },
  uBakeMatrix: { value: new THREE.Matrix4() },
  /** x = on (0 until the first bake), y = depth bias (0..1 depth units), z = texel (uv) */
  uBakeInfo: { value: new THREE.Vector3(0, 0.0004, 1 / SIZE) },
  tBakeContact: { value: null as THREE.Texture | null },
  /** xz origin (m), 1 / size (1/m), strength */
  uContactXf: { value: new THREE.Vector4(-HALF, -HALF, 1 / (HALF * 2), 0) },
};

}

export interface StaticCaptureUniforms {
  readonly tBakeShadow: { value: THREE.Texture | null }; readonly uBakeMatrix: { value: THREE.Matrix4 };
  readonly uBakeInfo: { value: THREE.Vector3 }; readonly tBakeContact: { value: THREE.Texture | null };
  readonly uContactXf: { value: THREE.Vector4 };
}

/** the casters' material for the depth pass: only its depth is kept (instancing / batching as the casters draw) */
function depthMaterial(): THREE.Material {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  material.name = 'static-capture-depth';
  return material;
}

/**
 * The contact pass as a graph: how far above the ground each caster fragment stands (m, clamped to 0 .. 8), its world
 * place against the ground's height texture. `xf` x, y: the height texture's corner where the level is drawn (its
 * origin - 256), z: 1 / its size, w: the origin's height.
 */
export const STATIC_CONTACT_GRAPH: GraphIr = {
  version: 1, kind: 'material', model: 'unlit', effectState: { fog: false },
  params: { height: { type: 'texture', role: 'lent', value: 'height' }, xf: { type: 'vec4', value: [0, 0, 1, 0] } },
  nodes: {
    wp: { op: 'positionWorld' }, xz: { op: 'swizzle', in: ['wp'], mask: 'xz' }, xf: { op: 'param', param: 'xf' },
    corner: { op: 'swizzle', in: ['xf'], mask: 'xy' }, scale: { op: 'swizzle', in: ['xf'], mask: 'z' }, base: { op: 'swizzle', in: ['xf'], mask: 'w' },
    rel: { op: 'sub', in: ['xz', 'corner'] }, uv: { op: 'mul', in: ['rel', 'scale'] }, sample: { op: 'texture', in: ['uv'], param: 'height' },
    ground: { op: 'swizzle', in: ['sample'], mask: 'x' }, y: { op: 'swizzle', in: ['wp'], mask: 'y' },
    above: { op: 'sub', in: ['y', 'base'] }, rise: { op: 'sub', in: ['above', 'ground'] }, height: { op: 'clamp', in: ['rise', 0, 8] },
    colour: { op: 'combine', in: ['height', 0, 0] },
  },
  stages: { surface: { colour: 'colour', alpha: 1 } },
};
/** the compiled contact pass: its material and its param writer */
interface ContactPass { readonly material: THREE.Material; readonly setParam: (name: string, value: readonly number[]) => void }

const _at = new THREE.Vector3();

export class StaticCapture {
  private readonly shadowRT: THREE.WebGLRenderTarget;
  private readonly contactRT: THREE.WebGLRenderTarget;
  private readonly shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1400);
  private readonly contactCam = new THREE.OrthographicCamera();
  private readonly depthMat: THREE.Material;
  private readonly contactMat: THREE.Material;
  private readonly contactXf = new THREE.Vector4();
  private readonly lastDir = new THREE.Vector3(0, -1, 0);
  /** where the level's frame is drawn (its scene's world position: zero standalone, the cell's root in a grid cell) */
  private readonly origin = new THREE.Vector3();
  private dirty = true;
  /** contact darkening strength (0 = off) */
  contact: number;
  private readonly row: StaticCaptureRows;

  /** Admit the rows, load the graph compiler and compile the contact pass over `tHeight`, then make the capture. */
  static async create(renderer: Renderer, scene: THREE.Scene, tHeight: THREE.Texture, scope: Scope, input: unknown, uniforms: StaticCaptureUniforms): Promise<StaticCapture> {
    const row = v.parse(StaticCaptureSchema, input), compiler = await loadLookGraphCompiler(renderer);
    if (scope.disposed) throw new Error('Static capture scope unloaded during the graph compiler load');
    const compiled = compiler.compileGraph(STATIC_CONTACT_GRAPH, {}); compiled.setTexture('height', tHeight);
    return new StaticCapture(renderer, scene, scope, row, uniforms, { material: compiled.material, setParam: (name, value) => { compiled.setParam(name, value); } });
  }
  private constructor(private readonly renderer: Renderer, private readonly scene: THREE.Scene, scope: Scope, row: StaticCaptureRows, private readonly uniforms: StaticCaptureUniforms,
    private readonly contactPass: ContactPass) {
    this.row = row;
    const SIZE = row.shadowSize[TIER], AO_SIZE = row.contactSize, HALF = row.half, LAYER = row.layer;
    this.depthMat = depthMaterial(); this.contact = row.contact;
    this.contactCam.left = -HALF; this.contactCam.right = HALF; this.contactCam.top = HALF; this.contactCam.bottom = -HALF; this.contactCam.near = 1; this.contactCam.far = 600; this.contactCam.updateProjectionMatrix();
    this.contactXf.set(row.heightOrigin, row.heightOrigin, 1 / row.heightSize, 0);
    contactPass.setParam('xf', this.contactXf.toArray());
    const depthTexture = new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType);
    this.shadowRT = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthTexture, depthBuffer: true, type: THREE.UnsignedByteType });
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.contactRT = new THREE.WebGLRenderTarget(AO_SIZE, AO_SIZE, {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.contactMat = contactPass.material;
    this.shadowCam.layers.set(LAYER);
    this.contactCam.layers.set(LAYER);
    // straight down over the slab: image right = +x, image up = −z (bakedContact's uv follows)
    this.contactCam.position.set(0, 300, 0);
    this.contactCam.up.set(0, 0, -1);
    this.contactCam.lookAt(0, 0, 0);
    this.contactCam.updateMatrixWorld();
    this.uniforms.tBakeShadow.value = depthTexture;
    this.uniforms.tBakeContact.value = this.contactRT.texture;
    if (typeof window !== 'undefined') scope.expose(window, '__staticCapture', this);
    scope.own(this.shadowRT); scope.own(this.contactRT); scope.own(this.depthMat); scope.own(this.contactMat);
    scope.onDispose(() => {
      this.roots.length = 0;
      if (this.uniforms.tBakeShadow.value === depthTexture) { this.uniforms.tBakeShadow.value = null; this.uniforms.uBakeInfo.value.x = 0; }
      if (this.uniforms.tBakeContact.value === this.contactRT.texture) { this.uniforms.tBakeContact.value = null; this.uniforms.uContactXf.value.w = 0; }
    });
    // These exact override programs draw only on the bake's first update; prepare them while the resident is hidden.
    registerOffscreenPreparation(scene, scope, { label: 'static shadow', camera: this.shadowCam, material: this.depthMat,
      target: this.shadowRT, positionOnly: true, roots: () => this.roots });
    registerOffscreenPreparation(scene, scope, { label: 'static contact', camera: this.contactCam, material: this.contactMat,
      target: this.contactRT, positionOnly: true, roots: () => this.roots });
    onGpuRestored(() => { this.invalidate(); }, scope); // the maps live only on the GPU: an in-place WebGL restore bakes them again (E54)
  }

  private readonly roots: THREE.Object3D[] = [];
  private seen = 0;

  /**
   * put every mesh under `root` into the bake (static things only). On the phone they also leave the realtime
   * shadow map: the bake is their shadow there (the terrain and the grass read it), so the CSM pass draws only what
   * moves — every static caster drawn a second time each frame was ~20 calls and ~0.4 M triangles.
   */
  add(root: THREE.Object3D): void {
    this.roots.push(root);
    this.sweep();
    this.dirty = true;
  }

  /** this tier's statics are off the realtime shadow map (the capture is their shadow): it need only hold what moves */
  get staticOffCsm(): boolean { return this.row.staticOffCsm[TIER]; }

  /** the groups stream in (the dressing, the GLB props): pick up meshes added since — cheap, call it every second or two */
  sweep(): void {
    let n = 0;
    for (const root of this.roots) root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      n++;
      o.layers.enable(this.row.layer);
      if (this.row.staticOffCsm[TIER]) o.castShadow = false;
    });
    if (n !== this.seen) { this.seen = n; this.dirty = true; }
  }

  /** the casters changed (the dressing landed, a model streamed in) */
  invalidate(): void { this.dirty = true; }

  /** each frame: re-bake when the key light has swung past the threshold (or the casters changed) */
  update(keyDir: THREE.Vector3): void {
    if (offscreenBakesHeld()) return;
    this.scene.updateWorldMatrix(true, false);
    const at = _at.setFromMatrixPosition(this.scene.matrixWorld);
    if (!at.equals(this.origin)) { this.origin.copy(at); this.dirty = true; }
    if (!this.dirty && keyDir.dot(this.lastDir) > Math.cos(this.row.rekeyDegrees * Math.PI / 180)) return;
    this.lastDir.copy(keyDir);
    this.dirty = false;
    this.bake(keyDir);
  }

  private bake(keyDir: THREE.Vector3): void {
    const { renderer, scene, row } = this;
    const HALF = row.half, SIZE = row.shadowSize[TIER];
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevAutoClear = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevBg = scene.background;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    scene.background = null;
    try {
      // the key's view of the slab: an orthographic box turned to the light, wide enough for the diagonal
      // (G321 part 4) in the level's own frame, where its scene is drawn: a grid cell's casters and receivers stand at its
      // root, so both maps are centred there and the receivers read them at their world position
      const cam = this.shadowCam, o = this.origin;
      const d = keyDir.clone().normalize();
      cam.position.copy(d).multiplyScalar(650).add(o).add(new THREE.Vector3(0, 10, 0));
      cam.up.set(0, 1, 0);
      if (Math.abs(d.y) > 0.99) cam.up.set(0, 0, -1);
      cam.lookAt(o.x, o.y + 10, o.z);
      const r = HALF * 1.42;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 300; cam.far = 1000;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      scene.overrideMaterial = this.depthMat;
      renderer.setRenderTarget(this.shadowRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.render(scene, cam);
      this.uniforms.uBakeMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      // depth bias: ~0.25 m in the camera's depth range
      this.uniforms.uBakeInfo.value.set(1, row.depthBias / (cam.far - cam.near), 1 / SIZE);
      // the contact map: the casters' height above the ground, straight down
      this.contactCam.position.set(o.x, o.y + 300, o.z);
      this.contactCam.lookAt(o);
      this.contactCam.updateMatrixWorld();
      this.contactXf.set(o.x + row.heightOrigin, o.z + row.heightOrigin, 1 / row.heightSize, o.y);
      this.contactPass.setParam('xf', this.contactXf.toArray());
      this.uniforms.uContactXf.value.set(o.x - HALF, o.z - HALF, 1 / (HALF * 2), this.uniforms.uContactXf.value.w);
      scene.overrideMaterial = this.contactMat;
      renderer.setRenderTarget(this.contactRT);
      renderer.setClearColor(0x000000, 1);
      renderer.render(scene, this.contactCam);
      this.uniforms.uContactXf.value.w = this.contact;
    } finally {
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.autoClear = prevAutoClear;
      renderer.shadowMap.autoUpdate = prevAuto;
    }
  }
}
