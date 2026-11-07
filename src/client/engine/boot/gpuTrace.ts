/** E256: boot-only snapshots. Counts are observations, not estimates of iOS process memory. */
import type { Pass } from 'postprocessing';
import { texturePin } from './gpuFiles';
import { recordBootCheckpoint } from './bootTrace';
import type { Renderer } from '../render/renderer';

export function recordGpuCheckpoint(renderer: Renderer, operation: string): void {
  try {
    const gl = renderer.getContext();
    const memory: unknown = Reflect.get(performance, 'memory');
    const heap: unknown = typeof memory === 'object' && memory !== null ? Reflect.get(memory, 'usedJSHeapSize') : null;
    recordBootCheckpoint(operation, {
      width: renderer.domElement.width, height: renderer.domElement.height,
      pixelRatio: renderer.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      contextLost: gl.isContextLost(), gpuTextures: texturePin(),
      multiDraw: renderer.extensions.has('WEBGL_multi_draw'),
      jsHeapBytes: typeof heap === 'number' && Number.isFinite(heap) ? heap : null,
      userAgent: navigator.userAgent.slice(0, 250),
    });
  } catch { /* a failed diagnostic must never prevent rendering */ }
}

/** Wrap only the boot draw, restoring every pass even when a pass throws. No per-frame instrumentation. */
export function traceBootPasses(passes: readonly Pass[], checkpoint: (operation: string) => void, draw: () => void): void {
  const originals = passes.map((pass) => ({ pass, render: pass.render.bind(pass) }));
  try {
    for (const [i, { pass, render }] of originals.entries()) {
      pass.render = (...args) => {
        const label = `pass:${i}:${pass.name}`;
        checkpoint(`${label}:before`);
        render(...args);
        checkpoint(`${label}:submitted`);
      };
    }
    draw();
  } finally {
    for (const { pass, render } of originals) pass.render = render;
  }
}
