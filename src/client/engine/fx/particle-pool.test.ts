import { PointsMaterial } from 'three';
import { expect, test } from 'vitest';
import { ParticlePool } from './ParticlePool';

// NINE-DRAGON-BENCHMAX NB8 (mini-nb8d): an idle pool its owner settles draws once (its program is built), then hides until a
// burst claims a slot; a pool never settled draws every frame, as before.
const pool = (): ParticlePool => new ParticlePool({ capacity: 8, material: new PointsMaterial(), renderOrder: 0, attributes: {}, parkY: -1000 });
const drawn = (p: ParticlePool): void => { p.points.onAfterRender(...([] as unknown as Parameters<typeof p.points.onAfterRender>)); };

test('a settled idle pool hides after its first draw and shows again on a claim', () => {
  const p = pool();
  p.settle(0);
  expect(p.points.visible).toBe(true);
  drawn(p);
  expect(p.points.visible).toBe(false);
  p.claim();
  expect(p.points.visible).toBe(true);
  drawn(p);
  expect(p.points.visible).toBe(true);
  p.settle(0);
  expect(p.points.visible).toBe(false);
});

test('a pool its owner never settles keeps drawing', () => {
  const p = pool();
  drawn(p);
  p.claim();
  drawn(p);
  expect(p.points.visible).toBe(true);
});
