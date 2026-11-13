/**
 * QA-FEEDBACK-2026-11-13 row 6 (Jake's friend, Android Chrome, staging v0.1.16): the game joined and played, the HUD and
 * the minimap drew, but the world was the page's own background, and nothing reached Sentry. The world draws through
 * the composer's half-float targets (RGBA16F); WebGL2 can only draw into those where the GPU offers
 * EXT_color_buffer_float or EXT_color_buffer_half_float. Without either the targets are incomplete framebuffers: every
 * draw into them is dropped without a throw, and the screen pass copies their empty (transparent) texels to the canvas.
 *
 * So the engine's HDR targets take `hdrTargetType`: half float where the GPU can draw into it, else 8-bit (the same
 * passes, less headroom for bloom), and `DrawCheck` makes a world that still draws nothing loud: twice after the first
 * frames, in the same task as the draw (the drawing buffer is not preserved), it reads the composer's input framebuffer
 * status and a 3×3 grid of the canvas. An incomplete target, or a canvas that stayed fully transparent at both checks,
 * is reported once as a fault (Sentry, and the error card) naming the GPU and what it lacks.
 */
import * as THREE from 'three';
import type { Renderer } from './renderer';

/** whether this renderer's GPU can draw into half-float colour targets (asking also enables the extension) */
export function halfFloatTargets(renderer: Pick<Renderer, 'extensions'>): boolean {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}

/** the type of the engine's HDR targets (the composer; volumetrics through fitHdrTarget): half float where it can be drawn into, else
 *  8-bit. Not yet: keyedSky's environment equirect (game layer) and staticCapture, which stay half float (a darker world, not a black one). */
export function hdrTargetType(renderer: Pick<Renderer, 'extensions'>): THREE.TextureDataType {
  return halfFloatTargets(renderer) ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

/** A half-float target made before the renderer was known, retyped to 8-bit (and reallocated) where the GPU cannot draw into half float. */
export function fitHdrTarget(renderer: Pick<Renderer, 'extensions'>, target: THREE.WebGLRenderTarget): void {
  if (target.texture.type !== THREE.HalfFloatType || halfFloatTargets(renderer)) return;
  target.texture.type = THREE.UnsignedByteType; target.dispose();
}

/** what a draw report names about the GPU: its model (no player identifier), and the limits a phone GPU runs short of */
export function gpuSummary(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  const has = (ext: string): string => (gl.getSupportedExtensions() ?? []).includes(ext) ? 'yes' : 'no';
  const n = (p: number): string => String(gl.getParameter(p));
  return `GPU ${name} · color_buffer_float ${has('EXT_color_buffer_float')} · color_buffer_half_float ${has('EXT_color_buffer_half_float')}`
    + ` · frag uniforms ${n(gl.MAX_FRAGMENT_UNIFORM_VECTORS)} · varyings ${n(gl.MAX_VARYING_VECTORS)} · textures ${n(gl.MAX_TEXTURE_IMAGE_UNITS)}`
    + ` · max texture ${n(gl.MAX_TEXTURE_SIZE)}`;
}

/** true when every sample of a 3×3 grid of the bound framebuffer is fully transparent (nothing drawn: the page shows through) */
export function blankFramebuffer(gl: Pick<WebGLRenderingContext, 'readPixels' | 'RGBA' | 'UNSIGNED_BYTE' | 'drawingBufferWidth' | 'drawingBufferHeight'>): boolean {
  const px = new Uint8Array(4), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
    gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[3] !== 0) return false;
  }
  return true;
}

/** the frames (counted from the loop's start) a draw check runs on */
export const DRAW_CHECK_FRAMES: readonly number[] = [60, 300];

export interface DrawCheckHost {
  renderer: { getContext: () => WebGLRenderingContext | WebGL2RenderingContext; getRenderTarget: () => THREE.WebGLRenderTarget | null; setRenderTarget: (target: THREE.WebGLRenderTarget | null) => void };
  /** the composer's input buffer (where the world draws), null before the composer exists */
  target: () => THREE.WebGLRenderTarget | null;
  /** `certain`: the target is incomplete (nothing can draw); otherwise the canvas only read transparent twice */
  report: (error: Error, certain: boolean) => void;
}

/** The world's draw check: `afterDraw(frame)` right after each loop draw, in the same task. Reports at most once. */
export class DrawCheck {
  private blank = 0;
  private done = false;
  private readonly host: DrawCheckHost;
  constructor(host: DrawCheckHost) { this.host = host; }

  afterDraw(frame: number): void {
    if (this.done || !DRAW_CHECK_FRAMES.includes(frame)) return;
    const { renderer } = this.host, gl = renderer.getContext();
    if (gl.isContextLost()) return; // GpuRecovery owns a lost context
    const prev = renderer.getRenderTarget();
    let why = '', certain = false;
    try {
      const target = this.host.target();
      if (target !== null) {
        renderer.setRenderTarget(target);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) { certain = true; why = `the world's target is incomplete (status 0x${status.toString(16)})`; }
      }
      renderer.setRenderTarget(null);
      if (why === '' && blankFramebuffer(gl) && ++this.blank === DRAW_CHECK_FRAMES.length) why = `the canvas stayed transparent at frames ${DRAW_CHECK_FRAMES.join(' and ')}`;
    } catch { return; } finally { renderer.setRenderTarget(prev); }
    if (why === '' && frame !== DRAW_CHECK_FRAMES.at(-1)) return;
    this.done = true;
    if (why === '') return;
    let gpu = '';
    try { gpu = gpuSummary(gl); } catch { gpu = 'GPU unknown'; }
    this.host.report(new Error(`World drew nothing: ${why} · ${gpu}`), certain);
  }
}
