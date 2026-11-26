// meta ALPHA-2-TRAILER AT16: the flat-frame check's judge. Nalati on the grid drew one flat colour with the AO pass on (a
// spread of exactly 0 in every channel); a whole frame of it reads 17-45.
import { expect, test } from 'vitest';
import { centreSpread, FLAT_SPREAD, flatFrame } from '../scripts/trailer/flat-frame-check.mjs';

/** an RGBA image of `width` × `height` from a pixel function */
const image = (width, height, at) => { const out = new Uint8ClampedArray(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set([...at(x, y), 255], (y * width + x) * 4); return out; };

test('one flat colour, as Nalati drew it, is refused; its drift does not save it', () => {
  for (const colour of [[0, 0, 0], [134, 140, 68], [156, 122, 97], [211, 204, 186]]) {
    const sample = centreSpread(image(32, 18, () => colour), 32, 18);
    expect(sample.spread).toEqual([0, 0, 0]);
    expect(sample.mean).toEqual(colour);
    expect(flatFrame(sample)).toContain('one colour');
  }
});

test('a drawn world passes, and only its centre is judged (a HUD bar at the edge saves nothing)', () => {
  const world = image(40, 20, (x, y) => [(x * 13 + y * 7) % 256, (x * 5) % 256, (y * 11) % 256]);
  expect(flatFrame(centreSpread(world, 40, 20))).toBeNull();
  const flatWithBar = image(40, 20, (_x, y) => (y < 2 ? [255, 255, 255] : [90, 100, 60]));
  expect(flatFrame(centreSpread(flatWithBar, 40, 20))).toContain('one colour');
  // the threshold sits under any drawn frame: a faint gradient of one level per pixel clears it
  const faint = image(64, 64, (x) => [100 + (x % 8), 100, 100]);
  expect(Math.max(...centreSpread(faint, 64, 64).spread)).toBeGreaterThan(FLAT_SPREAD);
  expect(flatFrame(centreSpread(faint, 64, 64))).toBeNull();
});

test('no pixels, or a broken sample, is no verdict of whole', () => {
  expect(flatFrame({ spread: [0, 0, 0], pixels: 0 })).toBe('no frame to judge');
  expect(flatFrame({ spread: [Number.NaN, 1, 1], pixels: 4 })).toBe('no frame to judge');
});
