import { expect, test } from 'vitest';
import { drawFrames } from '../scripts/perf/draw-census-page.mjs';

function fixture() {
  const noop = () => undefined;
  const extension = Object.fromEntries(['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL'].map(name => [name, noop]));
  const prototype = { uniform1f: noop }, gl = Object.assign(Object.create(prototype), {
    CURRENT_PROGRAM: 1, getParameter: () => ({}), getExtension: () => extension, useProgram: noop,
    drawElements: noop, drawArrays: noop, drawElementsInstanced: noop, drawArraysInstanced: noop, drawRangeElements: noop,
  });
  const material = { uuid: 'material', type: 'Basic' }, geometry = { uuid: 'geometry' }, object = { type: 'BatchedMesh', name: 'forest' };
  const renderer = { getContext: () => gl, getRenderTarget: () => null, shadowMap: { render: noop },
    renderBufferDirect: () => { gl.uniform1f(); extension.multiDrawElementsWEBGL(4, [], 0, 1, [], 0, 9); } };
  let observer;
  const game = { renderer, composer: { passes: [] }, frameCount: 0, frameI: 0, frameMs: [16], workMs: [4], renderMs: [3],
    lastFrame: { calls: 1, triangles: 20 }, frameGate: () => true,
    watchFrames: fn => { observer = fn; return () => { observer = undefined; }; } };
  const world = { game, hud: { entered: true, paused: false } };
  const originals = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __wildshard: { world } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  const restore = () => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } };
  return { restore, renderer, gl, extension, original: renderer.renderBufferDirect, prototype, game,
    frame: () => { observer(); renderer.renderBufferDirect(null, null, geometry, material, object); game.frameCount++; observer(); } };
}

test('multi-draw is one native call with all sub-draws retained and hooks restored', async () => {
  const f = fixture();
  try {
    const pending = drawFrames({ frames: 1, attribution: true }); f.frame();
    const rows = await pending;
    expect(rows[0].draws).toMatchObject([{ count: 1, subDraws: 9, owner: 'forest' }]);
    expect(rows[0].uniforms).toBe(1);
    expect(f.renderer.renderBufferDirect).toBe(f.original);
    expect(Object.hasOwn(f.gl, 'uniform1f')).toBe(false);
    expect(f.gl.uniform1f).toBe(f.prototype.uniform1f);
  } finally { f.restore(); }
});

test('a native counter disagreement refuses and restores every hook', async () => {
  const f = fixture(); f.game.lastFrame.calls = 2;
  try {
    const pending = drawFrames({ frames: 1, attribution: true });
    const refused = expect(pending).rejects.toThrow('disagree'); f.frame(); await refused;
    expect(f.renderer.renderBufferDirect).toBe(f.original);
    expect(Object.hasOwn(f.gl, 'uniform1f')).toBe(false);
  } finally { f.restore(); }
});
