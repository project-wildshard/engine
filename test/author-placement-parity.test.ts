import { expect, expectTypeOf, test } from 'vitest';
import { Noise2D as AuthorNoise, smoothstep as authorSmoothstep, clamp as authorClamp, lerp as authorLerp } from '../src/sharddev/noise';
import { Rng as AuthorRng } from '../src/sharddev/random';
import { annulus as authorAnnulus } from '../src/sharddev/bake/annulus';
import { Noise2D, smoothstep, clamp, lerp } from '../src/shared/engine/core/noise';
import { Rng } from '../src/shared/engine/core/rng';
import { annulus } from '../src/client/engine/fx/groundFx';
import { specimenKey, siteFloor as authorSiteFloor, type FloorRect as AuthorFloor, type ColliderDesc, type BoxSpec, type Draw, type ContactSurface } from '../src/sharddev/bake/placement';
import type { ColliderDesc as RuntimeCollider } from '../src/client/engine/world/registry';
import { siteFloor, type FloorRect as RuntimeFloor, type BoxSpec as RuntimeBox } from '../src/shared/engine/physics/box';
import type { Draw as RuntimeDraw } from '../src/client/engine/models/place';
import type { Material } from '../src/shared/engine/physics/surface';
import { specimenKey as runtimeSpecimenKey } from '../src/client/game/models/specimenCatalogue';

test('author placement types preserve the complete native data contract', () => {
  expectTypeOf<ColliderDesc>().toEqualTypeOf<RuntimeCollider>();
  expectTypeOf<BoxSpec>().toEqualTypeOf<RuntimeBox>();
  expectTypeOf<AuthorFloor>().toEqualTypeOf<RuntimeFloor>();
  expectTypeOf<Draw>().toEqualTypeOf<RuntimeDraw>();
  expectTypeOf<ContactSurface>().toEqualTypeOf<Material>();
});

test('author RNG and every noise operation match native arithmetic exactly', () => {
  const seeds = [0, 1, -1, 0x0d7e, 0xc1a7, 0xba1b, 0xffffffff];
  const points = [-250, -7.125, -0.001, 0, 0.33, 7.125, 250];
  for (const seed of seeds) {
    const before = new Rng(seed), after = new AuthorRng(seed);
    const native = new Noise2D(seed), author = new AuthorNoise(seed);
    for (const x of points) for (const y of points) {
      expect(after.next()).toBe(before.next());
      expect(author.get(x, y)).toBe(native.get(x, y));
      for (const octaves of [1, 2, 4, 5]) {
        expect(author.fbm(x, y, octaves)).toBe(native.fbm(x, y, octaves));
        expect(author.ridged(x, y, octaves)).toBe(native.ridged(x, y, octaves));
      }
      expect(author.fbm(x, y, 3, 2.1, 0.4)).toBe(native.fbm(x, y, 3, 2.1, 0.4));
      expect(authorSmoothstep(-0.3, 0.4, x)).toBe(smoothstep(-0.3, 0.4, x));
      expect(authorSmoothstep(4.5, 1.6, x)).toBe(smoothstep(4.5, 1.6, x));
      expect(authorClamp(x, -1, 1)).toBe(clamp(x, -1, 1));
      expect(authorLerp(x, y, 0.37)).toBe(lerp(x, y, 0.37));
    }
    expect(after.snapshot()).toEqual(before.snapshot());
  }
});

test('authored annuli preserve every native attribute and triangle byte', () => {
  for (const args of [[0.84, 1, 128], [5.85, 6.15, 64, Math.PI * 0.6], [0, 2, 3], [1, 1, 8]] as const) {
    const [inner, outer, segments, arc] = args;
    const native = annulus(inner, outer, segments, arc), author = authorAnnulus(inner, outer, segments, arc);
    expect(Object.keys(author.attributes)).toEqual(Object.keys(native.attributes));
    for (const name of Object.keys(native.attributes)) {
      const actual = author.getAttribute(name), expected = native.getAttribute(name);
      expect(actual.itemSize).toBe(expected.itemSize);
      expect(actual.normalized).toBe(expected.normalized);
      expect(actual.array).toEqual(expected.array);
    }
    expect(author.getIndex()?.array).toEqual(native.getIndex()?.array);
    native.dispose(); author.dispose();
  }
});

test('specimen keys preserve insertion order, Unicode and JSON number spelling', () => {
  for (const params of [{}, { b: -0, a: 1.25 }, { label: 'Қазақ', rows: [1, null, 'x'] }]) {
    expect(specimenKey('nalati-grasslands/fieldstone', params)).toBe(runtimeSpecimenKey('nalati-grasslands/fieldstone', params));
  }
  expect(specimenKey('x', { a: 1, b: 2 })).not.toBe(specimenKey('x', { b: 2, a: 1 }));
});


test('author site floors retain every native coordinate, optional field and signed zero', () => {
  for (const rotation of [-Math.PI, -0.7, -0, 0, 0.7, Math.PI]) {
    for (const slope of [undefined, -0, 0, -0.3, 0.5]) {
      expect(authorSiteFloor(rotation, -3.2, 2, 4, 7, slope)).toEqual(siteFloor(rotation, -3.2, 2, 4, 7, slope));
    }
  }
});
