// PZ24 (meta PAGE-SIZE): the page's own road textures on the phone. The sign atlas paints the same commands at half size
// (a quarter of the texels), and a split road's halves share one asphalt and one junction upload.
import { expect, test } from 'vitest';
import type { Texture } from 'three';
import { paintRoadSignCanvas, roadSignPaintLayout } from './roadSignPaint';
import { RoadMapShare } from './roadResources';

const signs = Array.from({ length: 9 }, (_, k) => ({ lines: [{ arrow: (['left', 'right', 'ahead'] as const)[k % 3] ?? 'ahead', names: [`Shard ${String(k)}`], metres: 100 + k }] }));

test('the half-scale sign atlas holds a quarter of the texels at the same uvs', () => {
  const full = roadSignPaintLayout(signs), half = roadSignPaintLayout(signs, 0.5);
  expect([full.width, full.height, full.scale]).toEqual([1024, 320, 1]);
  expect([half.width, half.height, half.scale]).toEqual([512, 160, 0.5]);
  expect(half.width * half.height * 4).toBe(full.width * full.height);
  for (let k = 0; k <= signs.length; k++) {
    const [fx, fy] = full.slot(k), [hx, hy] = half.slot(k);
    expect([hx / half.width, hy / half.height]).toEqual([fx / full.width, fy / full.height]);
  }
  expect(() => roadSignPaintLayout(signs, 0.3)).toThrow(/scale/u);
});

/** a 2D context that records every call, its transform calls apart */
function recorder(): { g: CanvasRenderingContext2D; calls: string[]; transforms: string[] } {
  const calls: string[] = [], transforms: string[] = [];
  const g = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 17 });
      return (...args: unknown[]) => { (key === 'save' || key === 'restore' || key === 'scale' && args[0] !== args[1] ? calls : key === 'scale' ? transforms : calls).push(`${String(key)}(${args.join(',')})`); };
    },
    set: (_t, key, value) => { calls.push(`${String(key)}=${String(value)}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls, transforms };
}

test('the half-scale atlas paints the full-size commands under one scale transform', () => {
  const full = recorder(), half = recorder();
  paintRoadSignCanvas(full.g, roadSignPaintLayout(signs));
  paintRoadSignCanvas(half.g, roadSignPaintLayout(signs, 0.5));
  // the background fills the texels; everything after it is the same command in painted units
  expect(full.calls.slice(0, 2)).toEqual(['fillStyle=#0d6b3c', 'fillRect(0,0,1024,320)']);
  expect(half.calls.slice(0, 2)).toEqual(['fillStyle=#0d6b3c', 'fillRect(0,0,512,160)']);
  expect(half.calls.slice(2)).toEqual(full.calls.slice(2));
  expect(full.transforms).toContain('scale(1,1)');
  expect(half.transforms).toContain('scale(0.5,0.5)');
});

test('a shared road map is disposed once, by its last user', () => {
  let disposed = 0;
  const map = { dispose: () => { disposed++; } } as unknown as Texture, share = new RoadMapShare();
  expect(share.take('road.asphalt')).toBeUndefined();
  share.hold('road.asphalt', map);
  expect(share.has('road.asphalt')).toBe(true);
  expect(share.take('road.asphalt')).toBe(map);
  share.release('road.asphalt', map); expect(disposed).toBe(0);
  share.release('road.asphalt', map); expect(disposed).toBe(1);
  expect(share.has('road.asphalt')).toBe(false);
  // a map the share does not hold (a later repaint) is the caller's own
  const other = { dispose: () => { disposed++; } } as unknown as Texture;
  share.release('road.asphalt', other); expect(disposed).toBe(2);
});
