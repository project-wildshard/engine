/**
 * A shard's own post graph as one pass of the engine's composer (SHARD-PLATFORM SF59 step 4), drawn by its classic GLSL
 * program (nine-fix NF18: the node runtime's `GraphPostPass` it replaces). Each frame the graph's scene input moves to the
 * composer's input buffer (and its depth input to the composer's depth texture, when the pass reads `sceneDepth`:
 * `needsDepthTexture` asks the composer for one), the scene camera's clip range feeds the depth's linearisation, and the
 * graph draws the composer's fullscreen triangle into the output buffer. The pass fades over the scene by its owner weight
 * (`compileClassicGraph(…, { weighted: true })`); at weight 0 it is disabled, so it costs nothing.
 */
import * as THREE from 'three';
import { Pass } from 'postprocessing';
import type { GraphShaderMaterial } from './glslMaterial';
import { feedViewRay } from './viewRay';

/** the program's uniforms by name (a host uniform absent: the graph never reads that input) */
type Uniforms = GraphShaderMaterial['uniforms'];

/** A compiled weighted post graph (`ClassicGraph.material`) as a composer pass. */
export class ClassicPostPass extends Pass {
  /** the graph's uniforms (not the material: the pass disposes its fullscreen material once, as it does any pass's) */
  private readonly graph: Uniforms;
  private readonly sceneCamera: THREE.Camera;
  private readonly readsDepth: boolean;
  /** `normal`: the normal pre-pass's target, when the graph reads `sceneNormal` */
  constructor(graph: GraphShaderMaterial, sceneCamera: THREE.Camera, readsDepth: boolean, normal: THREE.Texture | null = null) {
    super('GraphPostPass');
    if (graph.uniforms['wsWeight'] === undefined) throw new Error('material graph: a scene post pass needs a weighted post graph');
    this.graph = graph.uniforms; this.sceneCamera = sceneCamera; this.readsDepth = readsDepth;
    this.needsDepthTexture = readsDepth;
    this.fullscreenMaterial = graph;
    const normals = graph.uniforms['wsNormal'];
    if (normals !== undefined && normal !== null) normals.value = normal;
  }
  /** the stack's owner weight (0 … 1): the graph fades over the scene; 0 skips the pass */
  setWeight(w: number): void {
    const weight = this.graph['wsWeight'];
    if (weight !== undefined) weight.value = Math.min(1, Math.max(0, w));
    this.enabled = w > 0;
  }
  override setDepthTexture(depthTexture: THREE.Texture): void {
    const depth = this.graph['wsDepth'];
    if (depth !== undefined) depth.value = depthTexture;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null, outputBuffer: THREE.WebGLRenderTarget | null): void {
    const scene = this.graph['wsScene'];
    if (inputBuffer !== null && scene !== undefined) scene.value = inputBuffer.texture;
    const camera = this.sceneCamera;
    if (this.readsDepth && camera instanceof THREE.PerspectiveCamera) {
      const near = this.graph['wsDepthNear'], far = this.graph['wsDepthFar'];
      if (near !== undefined) near.value = camera.near;
      if (far !== undefined) far.value = camera.far;
    }
    feedViewRay(this.graph, camera);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }
}

/**
 * The normal pre-pass a post stack pays once when a pass reads `sceneNormal` (SF59 (2b)): the scene again with packed
 * view-space normals into its own target (no background, the shadow maps not redrawn); `texture` is what the passes'
 * `normal` input reads. Swaps no buffer.
 */
export class GraphNormalPrepass extends Pass {
  readonly target: THREE.WebGLRenderTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly normals = new THREE.MeshNormalMaterial();
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super('GraphNormalPrepass', scene, camera);
    this.needsSwap = false;
  }
  get texture(): THREE.Texture { return this.target.texture; }
  override render(renderer: THREE.WebGLRenderer): void {
    const scene = this.scene, auto = renderer.shadowMap.autoUpdate, override = scene.overrideMaterial, background = scene.background;
    renderer.shadowMap.autoUpdate = false; scene.overrideMaterial = this.normals; scene.background = null;
    try { renderer.setRenderTarget(this.target); renderer.clear(); renderer.render(scene, this.camera); }
    finally { scene.overrideMaterial = override; scene.background = background; renderer.shadowMap.autoUpdate = auto; }
  }
  override setSize(width: number, height: number): void { this.target.setSize(width, height); }
  override dispose(): void { this.target.dispose(); this.normals.dispose(); super.dispose(); }
}
