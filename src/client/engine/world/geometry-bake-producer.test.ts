import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { Rng, type RngPort } from '../../../shared/engine/core/rng';
import { blob, plank, rock } from './geometryKit';
import { addGeometryBake, bakedGeometry, encodeGeometryBake, recordGeometryBake } from './geometryBake';

test('an authored recorder replaces a retired builder and releases its borrowed table', () => {
  const rng = new Rng(7), recorder = recordGeometryBake((id, _inputs, stream) => {
    if (id !== 'fixture/required' || stream === null) return null;
    return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([stream.next(), 0, 0]), 3));
  });
  const missing = (): never => { throw new Error('Required geometry missing'); };
  try {
    bakedGeometry('fixture/required', [1], rng, missing).dispose();
    let delegated = false;
    bakedGeometry('fixture/ordinary', [], null, () => { delegated = true; return new BufferGeometry(); }).dispose();
    expect(delegated).toBe(true);
  } finally { recorder.stop(); }
  const bytes = encodeGeometryBake(recorder.entries), release = addGeometryBake(Uint8Array.from(bytes).buffer), restored = new Rng(7);
  try {
    const geometry = bakedGeometry('fixture/required', [1], restored, missing);
    expect(geometry.getAttribute('position').getX(0)).toBeGreaterThan(0);
    expect(restored.snapshot()).toEqual(rng.snapshot());
    geometry.dispose();
  } finally { release(); }
  expect(() => bakedGeometry('fixture/required', [1], new Rng(7), missing)).toThrow('Required geometry missing');
  const ordinary = recordGeometryBake();
  try { bakedGeometry('fixture/default', [], null, () => new BufferGeometry()).dispose(); expect(ordinary.entries.size).toBeGreaterThan(0); }
  finally { ordinary.stop(); }
});

function publicStream(seed: number): RngPort {
  const rng = new Rng(seed);
  const wrap = (source: Rng): RngPort => ({
    next: () => source.next(), range: (a, b) => source.range(a, b), int: (a, b) => source.int(a, b),
    pick: <T>(values: readonly T[]): T => source.pick(values), chance: (p) => source.chance(p),
    weighted: <T>(pairs: readonly (readonly [T, number])[]): T => source.weighted(pairs),
    fork: (salt) => wrap(source.fork(salt)), snapshot: () => source.snapshot(), restore: (state) => { source.restore(state); },
  });
  return wrap(rng);
}

test('structural streams retain primitive bits and recorded continuations', () => {
  const original = new Rng(531), stream = publicStream(531);
  const shapes = [(rng: RngPort) => rock(2, 1, rng), (rng: RngPort) => plank(3, 1, 0.2, rng), (rng: RngPort) => blob(2, rng)];
  const recorder = recordGeometryBake();
  try {
    for (const shape of shapes) {
      const expected = shape(original), actual = shape(stream);
      try {
        expect(Object.keys(actual.attributes)).toEqual(Object.keys(expected.attributes));
        for (const key of Object.keys(expected.attributes)) expect(actual.getAttribute(key).array).toEqual(expected.getAttribute(key).array);
        expect(actual.index?.array).toEqual(expected.index?.array);
        expect(actual.groups).toEqual(expected.groups);
        expect(stream.snapshot()).toEqual(original.snapshot());
      } finally { expected.dispose(); actual.dispose(); }
    }
  } finally { recorder.stop(); }
  const release = addGeometryBake(Uint8Array.from(encodeGeometryBake(recorder.entries)).buffer), restored = publicStream(531);
  try {
    // Advance through the same first two shapes; the recorded blob must restore its end state without rebuilding.
    rock(2, 1, restored).dispose(); plank(3, 1, 0.2, restored).dispose();
    const missing = (): never => { throw new Error('A recorded structural stream rebuilt'); };
    bakedGeometry('engine/blob', [2, 1, 0.75, 0.22], restored, missing).dispose();
    expect(restored.snapshot()).toEqual(stream.snapshot());
    expect(restored.fork('branch').next()).toBe(original.fork('branch').next());
  } finally { release(); }
});
