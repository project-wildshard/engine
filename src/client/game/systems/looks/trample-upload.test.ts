import { expect, test } from 'vitest';
import { GrassTrample } from './trample';
import { RECOVER, TrampleField, type TrampleState } from '../../../../shared/game/systems/looks/trampleField';

function texels(field: GrassTrample): Uint8Array {
  const data = field.texture.image.data;
  if (!(data instanceof Uint8Array)) throw new Error('Missing RG8 trample image');
  return data;
}

function recoveredImage(state: TrampleState, dt: number): Uint8Array {
  const image = new Uint8Array(256 * 256 * 2).fill(128);
  const decay = (state.tick + dt) / RECOVER;
  for (let at = 0; at < state.cells.length; at += 3) {
    const index = state.cells[at], amount = state.cells[at + 1], angle = state.cells[at + 2];
    if (index === undefined || amount === undefined || angle === undefined) throw new Error('Missing trample cell');
    const value = amount - decay;
    if (value <= 0) continue;
    image[index * 2] = Math.round(127.5 + 127 * Math.cos(angle) * value);
    image[index * 2 + 1] = Math.round(127.5 + 127 * Math.sin(angle) * value);
  }
  return image;
}

test('uploads only changed RG8 bytes while the native field continues every recovery', () => {
  const drawn = new GrassTrample(), native = new TrampleField(), centre = { x: .25, z: .25 };
  let skipped = 0, uploads = 0;
  try {
    for (let step = 0; step < 120; step++) {
      centre.x = step < 60 ? .25 : step < 90 ? 64.25 : -150.25;
      centre.z = step < 90 ? .25 : 150.25;
      for (const field of [drawn, native]) {
        field.update(0, centre);
        if (step < 80) field.push(centre.x, centre.z, .55, 1, step < 40 ? 0 : 1, 0);
      }
      const before = native.snapshot(), bytes = texels(drawn).slice(), version = drawn.texture.version;
      drawn.update(.1, centre); native.update(.1, centre);
      const expected = recoveredImage(before, .1), changed = Buffer.compare(Buffer.from(bytes), Buffer.from(expected)) !== 0;
      expect(Buffer.compare(Buffer.from(texels(drawn)), Buffer.from(expected))).toBe(0);
      expect(drawn.snapshot()).toEqual(native.snapshot());
      expect(drawn.texture.version - version).toBe(Number(changed));
      if (changed) uploads++; else skipped++;
      if (step === 45) {
        const restored = native.snapshot(); restored.dirty = true;
        drawn.restore(restored); native.restore(restored);
      }
    }
    expect(uploads).toBeGreaterThan(0); expect(skipped).toBeGreaterThan(0);
  } finally { drawn.texture.dispose(); }
});

test('standing stamps keep live movers while identical quantized images stay resident', () => {
  const field = new GrassTrample(), at = { x: .25, z: .25 };
  try {
    field.update(0, at); field.push(at.x, at.z, .55); field.update(.1, at);
    const version = field.texture.version, image = texels(field).slice();
    for (let frame = 0; frame < 30; frame++) {
      field.push(at.x, at.z, .55); field.update(1 / 30, at);
      expect(field.uniforms.uMoverCount.value).toBe(1);
    }
    expect(field.texture.version).toBe(version);
    expect(Buffer.compare(Buffer.from(texels(field)), Buffer.from(image))).toBe(0);
  } finally { field.texture.dispose(); }
});
