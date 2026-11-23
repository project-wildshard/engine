import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { prepareGlbCost } from '@wildshard/format/glbCost';
import { CreatureClipSampler } from '../src/shared/game/shardfile/creatureClipSampler';
import { creatureRestRig } from '@wildshard/format/creatureRestRig';
import { creatureVolumeGlb, volumeJoints } from './fixtures/creature-volume-skin';

beforeAll(prepareGlbCost);
test.each(['translation', 'rotation', 'scale'] as const)('headless %s tracks match the admitted Three interpolants', property => {
  const bytes = creatureVolumeGlb(property), joints = creatureRestRig(bytes, volumeJoints), sampler = new CreatureClipSampler(bytes, joints);
  expect(sampler.has('idle')).toBe(true); expect(sampler.duration('idle')).toBe(1);
  const head = joints.findIndex(row => row.name === 'head'), out = new Vector3(), pose = sampler.sample('idle', .5, false);
  pose.point(head, [1, 0, 0], out);
  const expected = property === 'translation' ? [1.5, 2, 0] : property === 'scale' ? [1.5, 2, 0] : [Math.SQRT1_2, 2 + Math.SQRT1_2, 0];
  out.toArray().forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 6));
  const same = out.clone(); sampler.sample('idle', 1.5, true).point(head, [1, 0, 0], out); expect(out.distanceTo(same)).toBeLessThan(1e-6);
  sampler.sample('idle', 2, false).point(head, [0, 0, 0], out); expect(out.x).toBe(property === 'translation' ? 1 : 0);
  sampler.sample('idle', 0, false).point(head, [0, 0, 0], out); expect(out.toArray()).toEqual([0, 2, 0]);
  expect(() => sampler.sample('missing', 0, false)).toThrow(); expect(() => sampler.sample('idle', NaN, false)).toThrow();
});
test('only named rig joints may drive clip-hit transforms; malformed GLB refuses', () => {
  const bytes = creatureVolumeGlb(), joints = creatureRestRig(bytes, volumeJoints);
  expect(() => new CreatureClipSampler(bytes, joints.filter(row => row.name !== 'head'))).toThrow('named skin joint');
  expect(() => new CreatureClipSampler(bytes.subarray(0, 30), joints)).toThrow();
});
