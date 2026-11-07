/**
 * The scene pass that keeps the world's depth for the post chain (PINE-HOLLOW-REMASTER, the render-fix lane).
 *
 * Every first-person viewmodel (the crossbow, the rifles, the longbow, the sword, the swim hands, the hoverboard, the
 * skinning knife) draws a clearer at renderOrder 999 whose `onBeforeRender` calls `renderer.clearDepth()`, so the weapon
 * — at 1000 — never clips into a wall. The post chain's depth readers (n8ao's AO, the volumetric march in Volumetrics.ts,
 * the god rays' sun mask) read the composer's stable depth, which postprocessing blits from the scene pass's target
 * AFTER the scene pass: by then it held the weapon alone, every world pixel cleared to the far plane. So with a weapon
 * out the AO shaded only the weapon, the march integrated 120 m of height fog through every wall and never saw a
 * shadow, and the sun's rays shone through rock and trunks.
 *
 * `WorldRenderPass` is the RenderPass with the depth kept: the first depth clear of the pass blits the world's depth into
 * the composer's stable target first, and after the pass the viewmodel's own depth is merged over it (one full-screen,
 * depth-only draw, LESS) — the effects see world + weapon exactly as if the weapon had been drawn without the clear. The
 * pixels, the draw order and the grade are untouched; the frame gains one draw (the merge, only while a viewmodel
 * cleared) and the composer's own post-pass blit becomes this pass's. No viewmodel shown (a menu, the golden-hour reward
 * view) = no clear = the plain blit, as before.
 */
import * as THREE from 'three';
import { RenderPass, type EffectComposer } from 'postprocessing';
import type { Renderer } from '../render/renderer';

/**
 * E142 (the 30-fps-at-2× lane): the depth slices. The blit above runs mid-pass — at the viewmodel's clear — and on a
 * tile GPU (every iPhone) that ends the scene pass: the colour (half float) and depth tiles are stored, the depth copied,
 * both reloaded to finish the pass, then the merge draws. At the phone's 804×1748 that is ~45 MB of memory traffic a
 * frame. Instead of clearing, the viewmodels draw into a near slice of the depth range (`gl.depthRange`): the world is
 * drawn at depth ≥ 0.3 (nothing of it within 0.114 m of the eye, near plane 0.08), each clear moves to the next slice
 * nearer the eye, so the weapon still never clips into a wall and a later viewmodel still draws over an earlier one.
 * The scene's own depth texture then holds the world (+ the weapon, near 0) with no copy at all, and the depth readers
 * read it directly (Game.buildComposer). Same colour for the world; on the weapon only the pixels where two of its own
 * parts meet can round the other way (the crossbow's arrow on its rail: ~0.01–0.03 % of the frame), and the march /
 * god rays see the weapon ~0.1 m away instead of ~0.4 m (no visible difference: 0.4 m of air). −0.07…−0.17 ms on the
 * M5 at 1206×2622 (scripts/pine-hollow-gpu.mjs, the old `depthcopy` subtraction), more on the phone's narrower memory.
 */
const DEPTH_SLICES: readonly (readonly [number, number])[] = [[0.225, 0.3], [0.15, 0.225], [0.075, 0.15], [0, 0.075]];

/** a render target's framebuffer, once three has set it up */
function framebufferOf(renderer: Renderer, rt: THREE.WebGLRenderTarget): WebGLFramebuffer | null {
  const props: unknown = renderer.properties.get(rt);
  if (typeof props !== 'object' || props === null || !('__webglFramebuffer' in props)) return null;
  const fb = props.__webglFramebuffer;
  return fb instanceof WebGLFramebuffer ? fb : null;
}

/**
 * Copy `src`'s depth into `dst` (same size, same depth format — postprocessing makes the stable target so). Leaves `src`
 * bound for drawing, three's framebuffer cache in step: safe in the middle of a scene render.
 */
function blitDepth(renderer: Renderer, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget): boolean {
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) return false;
  const s = framebufferOf(renderer, src), d = framebufferOf(renderer, dst);
  if (s === null || d === null) return false;
  const state = renderer.state;
  state.bindFramebuffer(gl.READ_FRAMEBUFFER, s);
  state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d);
  gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s);
  return true;
}

export class WorldRenderPass extends RenderPass {
  /** the scene pass's own target while it draws (null otherwise): the only target whose clear is the viewmodels' */
  private drawing: THREE.WebGLRenderTarget | null = null;
  /** the world's depth is in the stable target this frame (a viewmodel cleared) */
  private kept = false;
  /** the merge: the viewmodel's depth over the world's, into the stable target (depth-only; the input's 1.0 = discard) */
  private readonly depthIn: THREE.IUniform<THREE.Texture | null> = { value: null };
  readonly mergeMaterial: THREE.ShaderMaterial = new THREE.ShaderMaterial({
    name: 'ViewmodelDepthMerge',
    uniforms: { tDepth: this.depthIn },
    depthTest: true, depthWrite: true, depthFunc: THREE.LessDepth, colorWrite: false, fog: false,
    vertexShader: /* glsl */`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform highp sampler2D tDepth;
      void main() {
        float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
        if (d >= 1.0) discard;
        gl_FragDepth = d;
      }`,
  });
  private readonly mergeScene = new THREE.Scene();
  private readonly mergeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** the depth slices (above): the next one a clear moves to; DEPTH_SLICES.length = past the last (it stays there) */
  private slice = 0;

  private readonly composer: EffectComposer;
  readonly slices: boolean;
  /**
   * `slices` (E142): the viewmodels draw into the near depth slices instead of clearing, and the effects read the scene
   * target's own depth texture (Game.buildComposer points them at it) — no copy, no merge
   */
  constructor(scene: THREE.Scene, camera: THREE.Camera, composer: EffectComposer, slices = false) {
    super(scene, camera);
    this.composer = composer;
    this.slices = slices;
    Reflect.set(this, 'needsDepthBlit', false); // this pass fills the stable depth itself (render below)
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, this.mergeMaterial);
    quad.frustumCulled = false;
    this.mergeScene.add(quad);
    const renderer = composer.getRenderer();
    const clearDepth = renderer.clearDepth.bind(renderer);
    renderer.clearDepth = () => { if (!this.keepWorldDepth(renderer)) clearDepth(); };
  }

  /** the composer's stable depth target (made when the first depth-reading pass is added; null = nothing reads depth) */
  private stableTarget(): THREE.WebGLRenderTarget | null {
    const rt: unknown = Reflect.get(this.composer, 'depthRenderTarget');
    return rt instanceof THREE.WebGLRenderTarget ? rt : null;
  }

  /** read through a call: the clear sets it from inside `super.render`, where control-flow narrowing cannot see */
  private keptThisFrame(): boolean { return this.kept; }

  /**
   * before a depth clear: the first one of the scene pass saves the world's depth. With the slices, a clear of the scene
   * pass moves the depth range to the next slice instead; true = do not clear
   */
  private keepWorldDepth(renderer: Renderer): boolean {
    const target = this.drawing;
    if (target === null || renderer.getRenderTarget() !== target) return false;
    if (this.slices) {
      const s = DEPTH_SLICES[Math.min(this.slice, DEPTH_SLICES.length - 1)];
      if (s === undefined) return false;
      renderer.getContext().depthRange(s[0], s[1]);
      this.slice++;
      return true;
    }
    if (this.kept) return false;
    const stable = this.stableTarget();
    if (stable !== null && blitDepth(renderer, target, stable)) this.kept = true;
    return false;
  }

  override render(renderer: Renderer, inputBuffer: THREE.WebGLRenderTarget | null, outputBuffer: THREE.WebGLRenderTarget | null, deltaTime?: number, stencilTest?: boolean): void {
    const clear = this.clearPass;
    if (inputBuffer === null || this.renderToScreen || !clear.enabled || clear.overrideClearColor !== null || clear.overrideClearAlpha !== -1) { this.renderWorld(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); return; }
    // FC10: three clears the scene target after its shadow pass (its background step, with autoClear) instead of the
    // clear pass clearing it before: a target cleared and then left for the shadow map is stored and loaded back by a
    // tile GPU. autoClear returns to the composer's at that first clear of the scene target, so nested renders keep it.
    // the renderer's own clear, put back as it was (never a bound copy, which would nest a frame at a time)
    const autoClear = renderer.autoClear, own: unknown = Reflect.get(renderer, 'clear');
    if (typeof own !== 'function') throw new Error('Renderer clear is not a function');
    let restored = false;
    const restore = (): void => { if (restored) return; restored = true; renderer.autoClear = autoClear; Reflect.set(renderer, 'clear', own); };
    Reflect.set(renderer, 'clear', (color?: boolean, depth?: boolean, stencil?: boolean): void => {
      if (renderer.getRenderTarget() === inputBuffer) restore();
      Reflect.apply(own, renderer, [color, depth, stencil]);
    });
    clear.enabled = false; renderer.autoClear = true;
    try { this.renderWorld(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); } finally { clear.enabled = true; restore(); }
  }

  private renderWorld(renderer: Renderer, inputBuffer: THREE.WebGLRenderTarget | null, outputBuffer: THREE.WebGLRenderTarget | null, deltaTime?: number, stencilTest?: boolean): void {
    const stable = this.stableTarget();
    if (stable === null || inputBuffer === null || this.renderToScreen) { super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); return; }
    if (this.slices) {
      this.slice = 0;
      this.drawing = inputBuffer;
      try { super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); } finally {
        this.drawing = null;
        renderer.getContext().depthRange(0, 1);
      }
      return;
    }
    renderer.initRenderTarget(stable); // a no-op once set up (again after a resize)
    this.kept = false;
    this.drawing = inputBuffer;
    try { super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest); } finally { this.drawing = null; }
    // no viewmodel cleared: the world's depth is the whole buffer — the composer's own blit, done here
    if (!this.keptThisFrame()) { blitDepth(renderer, inputBuffer, stable); return; }
    this.depthIn.value = inputBuffer.depthTexture;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(stable);
    renderer.render(this.mergeScene, this.mergeCamera);
    renderer.autoClear = autoClear;
  }
}
