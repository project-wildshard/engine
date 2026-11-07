/**
 * E174: Driftwood's phone rig's shadow maps — depth only, 16-bit depth. Jake picked C of the four variants (6e7fd106); E318
 * deleted the others (A three's own maps, B depth only at 24-bit, D a half-size far cascade and ghosts) and the Debug row.
 *
 * The rig (Sky.ts PHONE_SHADOW, E123 / E147) is 3 cascades at 2048² plus the sun fade's 2 ghosts (shadowFade.ts) at
 * 2048². three r186 gives every PCF shadow map a WebGLRenderTarget: an RGBA8 colour texture (16 MB at 2048²) that nothing
 * ever samples, plus the DEPTH_COMPONENT24 depth texture the lit shaders compare against (16 MB; 4 bytes a texel on the
 * GPU): 5 × 32 MB = 160 MB. These maps are 5 × 8 MB = 40 MB: DEPTH_COMPONENT16 (0.9 cm depth steps over the light's
 * 1–600 m range, under the 7 cm bias) and no colour texture.
 *
 * The maps are made here, in three's own shape (WebGLShadowMap: a render target with a compare-mode depth texture), and set
 * on `shadow.map` before three would make one; the colour texture is detached from the framebuffer and deleted right after
 * the target is initialised (a depth-only framebuffer is complete in WebGL 2; three only ever samples the depth texture).
 */
import * as THREE from 'three';
import type { Renderer } from '../render/renderer';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';

/** the rig's shadow map bytes: `cascades` + `ghosts` maps at `size`², 2 bytes a texel (16-bit depth, no colour) */
export function shadowBytes(size: number, cascades: number, ghosts: number): number {
  return (cascades + ghosts) * size * size * 2;
}


/** the targets whose colour texture is gone (a second detach would free a deleted texture) */
const depthOnly = new WeakSet();

/**
 * Detach a shadow map's colour texture from its framebuffer and free it: the depth texture is all the shaders read. For
 * this rig's maps and, with the Memory saver (SF22d, render/memorySaver.ts), for a map three made itself. Call it once
 * the target is set up (initRenderTarget, or after its first shadow draw).
 */
export function dropShadowColour(renderer: Renderer, rt: THREE.WebGLRenderTarget): void {
  if (depthOnly.has(rt)) return;
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) return;
  const rtProps: unknown = renderer.properties.get(rt), texProps: unknown = renderer.properties.get(rt.texture);
  const fb: unknown = typeof rtProps === 'object' && rtProps !== null ? Reflect.get(rtProps, '__webglFramebuffer') : null;
  const tex: unknown = typeof texProps === 'object' && texProps !== null ? Reflect.get(texProps, '__webglTexture') : null;
  if (!(fb instanceof WebGLFramebuffer) || !(tex instanceof WebGLTexture)) return;
  depthOnly.add(rt);
  const state = renderer.state;
  state.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  if (!ok) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); // keep three's shape
  state.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (ok) gl.deleteTexture(tex);
  else console.warn('[sky] E174: a depth-only shadow framebuffer is incomplete here: the colour texture stays');
}

/** Whether `rt`'s colour texture was let go (`dropShadowColour`): a stand-in for it must drop its own too (op-hitch33,
 *  render/parkedDraws.ts), or its depth draws build pipelines with a colour attachment the real map does not have. */
export function shadowColourDropped(rt: THREE.RenderTarget): boolean {
  return depthOnly.has(rt);
}

export class ShadowMaps {
  /** the lights whose map this module made (a light missing here holds three's own map, or none yet) */
  private readonly made = new Set<THREE.DirectionalLight>();

  private readonly renderer: Renderer;
  private readonly csm: CSM;
  private readonly ghosts: readonly THREE.DirectionalLight[];
  readonly size: number;
  constructor(renderer: Renderer, csm: CSM, ghosts: readonly THREE.DirectionalLight[], size: number) {
    this.renderer = renderer;
    this.csm = csm;
    this.ghosts = ghosts;
    this.size = size;
  }

  /** the GPU bytes of the rig's shadow maps */
  get bytes(): number { return shadowBytes(this.size, this.csm.lights.length, this.ghosts.length); }

  /** make every light's map. `force` remakes them (after an in-place WebGL restore: the targets came back uninitialised and
   *  three would give them their colour texture again) */
  apply(force = false): void {
    for (const light of [...this.csm.lights, ...this.ghosts]) {
      if (!force && this.made.has(light)) continue;
      this.drop(light, !force); // after a restore the old targets' GL objects went with the lost context: nothing to free
      light.shadow.mapSize.set(this.size, this.size);
      this.make(light);
    }
  }

  private drop(light: THREE.DirectionalLight, free = true): void {
    const map = light.shadow.map;
    if (map !== null && free) { map.depthTexture?.dispose(); map.dispose(); }
    light.shadow.map = null;
    this.made.delete(light);
  }

  /** three's directional PCF map (WebGLShadowMap, r186), made now, initialised, and its colour texture let go */
  private make(light: THREE.DirectionalLight): void {
    const size = this.size;
    const rt = new THREE.WebGLRenderTarget(size, size);
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedShortType);
    depth.name = `${light.name}.shadowMap`;
    depth.format = THREE.DepthFormat;
    depth.compareFunction = this.renderer.state.buffers.depth.getReversed() ? THREE.GreaterEqualCompare : THREE.LessEqualCompare;
    depth.minFilter = THREE.LinearFilter;
    depth.magFilter = THREE.LinearFilter;
    rt.depthTexture = depth;
    light.shadow.map = rt;
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true; // a ghost's map renders only while a fade runs: draw it once now
    this.renderer.initRenderTarget(rt);
    this.dropColour(rt);
    this.made.add(light);
  }

  /** detach the render target's colour texture from its framebuffer and free it: the depth texture is all the shaders read */
  private dropColour(rt: THREE.WebGLRenderTarget): void { dropShadowColour(this.renderer, rt); }
}
