import { expect, test } from 'vitest';
import { sampleCreatureSwing, type CreatureSwingSpec } from './fixtures/creatureSwing';

test('swing winds, cuts and recovers in lent scratch, refusing malformed rows before writes', () => {
  const spec: CreatureSwingSpec<'arm' | 'body'> = { wind: [0, .4], cut: [.5, .7], recover: [.8, 1], channels: { arm: [.2, -2, 1], body: [0, -.3, .5] } };
  const pose = { arm: 0, body: 0 };
  sampleCreatureSwing(-1, spec, pose); const rest = { ...pose };
  sampleCreatureSwing(.4, spec, pose); expect(pose.arm).toBeLessThan(rest.arm); expect(pose.body).toBeLessThan(rest.body);
  sampleCreatureSwing(.7, spec, pose); expect(pose.arm).toBeGreaterThan(rest.arm); expect(pose.body).toBeGreaterThan(rest.body);
  sampleCreatureSwing(1, spec, pose); expect(pose).toEqual(rest);
  for (const invalid of [Number.NaN, Infinity]) expect(() => sampleCreatureSwing(invalid, spec, pose)).toThrow('swing');
  expect(() => sampleCreatureSwing(.4, { ...spec, recover: [1, .5] }, pose)).toThrow('swing');
  expect(() => sampleCreatureSwing(.4, { ...spec, channels: { arm: [.2, -2, 1], body: [0, Number.NaN, .5] } }, pose)).toThrow('swing');
  expect(() => sampleCreatureSwing(.4, { ...spec, channels: { constructor: [0, 1, 0] } }, { constructor: 0 })).toThrow('swing');
  const missing = { arm: 1, body: 0 }; Reflect.deleteProperty(missing, 'body');
  expect(() => sampleCreatureSwing(.4, spec, missing)).toThrow('swing');
  expect(pose).toEqual(rest);
});
