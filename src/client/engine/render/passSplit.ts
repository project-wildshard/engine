/**
 * MG10 (mini-ninesteady3, 2026-11-18): no Metal render pass carries more than `PASS_SPLIT_VERTICES` vertex invocations.
 *
 * Apple's GPUs bin a pass's transformed vertices (position and every varying) in a parameter buffer before any pixel is
 * shaded. The driver sizes that buffer to the heaviest pass the page ever submitted and never shrinks it: it sits in the
 * GPU process as "Owned physical footprint (unmapped)". Nine draws ~1.17 M vertex invocations a play frame through
 * programs with ~14 varyings, and its loading frames up to ~1.6 M, so the buffer held ~104 MB for the whole play (Playwright
 * WebKit [K], footprint -j; a blank WebGL page holds 8). A `flush()` ends ANGLE's Metal encoder and commits its command
 * buffer, so the next draw opens a new pass on the same attachments (load, not clear) and the driver reuses the buffer.
 * Splitting at 400 k left it at 68 MB (600 k: 70, 800 k: 89, none: 113); the pixels are GL's either way.
 *
 * Counted per draw: `count x instances` (multi-draw is not counted). A framebuffer change ends the pass by itself, so the
 * count restarts there. WebKit only (every iPhone browser): Blink's flush is a shallow IPC flush whose effect on its
 * GPU process was not measured.
 */
import { webKitEngine } from './drawHooks';

/** WebGL2's READ_FRAMEBUFFER: binding one moves no draw */
const READ_FRAMEBUFFER = 0x8ca8;

/** the vertex invocations one pass may carry before the next draw opens a new one */
export const PASS_SPLIT_VERTICES = 400_000;

const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'] as const;
type DrawName = typeof DRAWS[number];
/** each draw's vertex invocations from its arguments (GL's own argument order) */
const INVOCATIONS: Readonly<Record<DrawName, (args: readonly number[]) => number>> = {
  drawArrays: (a) => a[2] ?? 0,
  drawElements: (a) => a[1] ?? 0,
  drawArraysInstanced: (a) => (a[2] ?? 0) * (a[3] ?? 1),
  drawElementsInstanced: (a) => (a[1] ?? 0) * (a[4] ?? 1),
  drawRangeElements: (a) => a[3] ?? 0,
};

/** The draw and framebuffer calls `installPassSplit` wraps, and the flush it inserts. */
export interface PassSplitContext {
  flush: () => void;
  bindFramebuffer: (target: number, framebuffer: WebGLFramebuffer | null) => void;
  drawArrays: (...args: readonly number[]) => void;
  drawElements: (...args: readonly number[]) => void;
  drawArraysInstanced: (...args: readonly number[]) => void;
  drawElementsInstanced: (...args: readonly number[]) => void;
  drawRangeElements: (...args: readonly number[]) => void;
}

/** Wrap `gl`'s draws so a pass flushes before the draw that would carry it past `limit`. False: not installed. */
export function installPassSplit(gl: PassSplitContext, userAgent: string = globalThis.navigator?.userAgent ?? '', limit: number = PASS_SPLIT_VERTICES): boolean {
  if (!webKitEngine(userAgent)) return false;
  let carried = 0, bound: WebGLFramebuffer | null | undefined;
  const flush = gl.flush.bind(gl);
  const bind = gl.bindFramebuffer.bind(gl);
  gl.bindFramebuffer = (target, framebuffer) => {
    if (target !== READ_FRAMEBUFFER && framebuffer !== bound) { carried = 0; bound = framebuffer; }
    bind(target, framebuffer);
  };
  for (const name of DRAWS) {
    const draw: (...args: readonly number[]) => void = gl[name].bind(gl), count = INVOCATIONS[name];
    gl[name] = (...args: readonly number[]) => {
      const n = count(args);
      if (carried > 0 && carried + n > limit) { flush(); carried = 0; }
      carried += n;
      draw(...args);
    };
  }
  return true;
}
