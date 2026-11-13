import { expect, test } from 'vitest';
import * as THREE from 'three';
import { DRAW_CHECK_FRAMES, DrawCheck, fitHdrTarget, hdrTargetType } from './drawCheck';

// QA-FEEDBACK-2026-11-13 row 6: an Android Chrome player saw the HUD over the page's background, and nothing was reported.

test('the HDR targets fall back to 8-bit where the GPU cannot draw into half float', () => {
  const gpu = (...exts: string[]) => ({ extensions: { has: (name: string) => exts.includes(name) } }) as unknown as Parameters<typeof hdrTargetType>[0];
  expect(hdrTargetType(gpu())).toBe(THREE.UnsignedByteType);
  expect(hdrTargetType(gpu('EXT_color_buffer_float'))).toBe(THREE.HalfFloatType);
  expect(hdrTargetType(gpu('EXT_color_buffer_half_float'))).toBe(THREE.HalfFloatType);
  // a target made before the renderer was known (Volumetrics' light rays) is retyped the same way
  const rays = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  fitHdrTarget(gpu('EXT_color_buffer_float'), rays); expect(rays.texture.type).toBe(THREE.HalfFloatType);
  fitHdrTarget(gpu(), rays); expect(rays.texture.type).toBe(THREE.UnsignedByteType);
});

const COMPLETE = 0x8cd5, INCOMPLETE_ATTACHMENT = 0x8cd6;
function fixture(status: number, alpha: number) {
  const reports: { message: string; certain: boolean }[] = [], bound: (THREE.WebGLRenderTarget | null)[] = [];
  const gl = {
    FRAMEBUFFER: 0x8d40, FRAMEBUFFER_COMPLETE: COMPLETE, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, drawingBufferWidth: 100, drawingBufferHeight: 200,
    isContextLost: () => false,
    checkFramebufferStatus: () => status,
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, px: Uint8Array) => { px[3] = alpha; },
    // the report's GPU line (WEBGL_debug_renderer_info absent: the masked name)
    getExtension: () => null, getParameter: (p: number) => p === 0x1f01 ? 'Test GPU' : 1, RENDERER: 0x1f01, getSupportedExtensions: () => [],
  };
  const target = new THREE.WebGLRenderTarget(1, 1);
  const check = new DrawCheck({
    renderer: { getContext: () => gl as unknown as WebGL2RenderingContext, getRenderTarget: () => bound.at(-1) ?? null, setRenderTarget: (t) => { bound.push(t); } },
    target: () => target,
    report: (error, certain) => { reports.push({ message: error.message, certain }); },
  });
  const run = (): void => { for (let frame = 1; frame <= 400; frame++) check.afterDraw(frame); };
  return { reports, run, bound };
}

test('an incomplete world target is reported once, at the first check, as certain', () => {
  const f = fixture(INCOMPLETE_ATTACHMENT, 255); f.run();
  expect(f.reports).toHaveLength(1);
  expect(f.reports[0]?.certain).toBe(true);
  expect(f.reports[0]?.message).toMatch(/^World drew nothing: the world's target is incomplete \(status 0x8cd6\) · GPU Test GPU/u);
  expect(f.bound.at(-1)).toBeNull(); // the renderer's own target is put back
});

test('a canvas transparent at both checks is reported; a drawn one never is', () => {
  const blank = fixture(COMPLETE, 0); blank.run();
  expect(blank.reports).toEqual([{ message: expect.stringContaining(`the canvas stayed transparent at frames ${DRAW_CHECK_FRAMES.join(' and ')}`), certain: false }]);
  const drawn = fixture(COMPLETE, 255); drawn.run();
  expect(drawn.reports).toEqual([]);
});
