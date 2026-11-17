import { Bone } from 'three';
import { expect, test } from 'vitest';
import { CREATURE_SKELETONS } from '@wildshard/format/creatureSkeletons';
import { QuadrupedRigPose } from './animalRig';

function joints(decorated = false): Record<string, Bone> {
  const contract = CREATURE_SKELETONS.quadruped,
    names = [contract.root, ...Object.values(contract.chains).flatMap(chain => chain.bones), ...(decorated ? ['earL', 'earR', 'belly'] : [])];
  return Object.fromEntries(names.map(name => { const bone = new Bone(); bone.name = name; return [name, bone]; }));
}
const clock = { bodyY: .62, alive: true, deathT: -1, deathSide: 1, speed: 4, legAbd: new Float32Array(4) };

test('canonical quadrupeds bind without cosmetic ears and belly only through the kit opt-in', () => {
  const bones = joints();
  expect(() => new QuadrupedRigPose(bones)).toThrow('Missing quadruped pose joint: earL');
  const pose = new Float32Array(27); pose[15] = .2; pose[16] = .4; pose[17] = -.1;
  new QuadrupedRigPose(bones, true).apply(pose, 1 / 60, clock);
  expect(bones['FL_shoulder']?.rotation.x).toBeCloseTo(-.2, 6);
  expect(bones['FL_carpus']?.rotation.x).toBeCloseTo(.4, 6);
  expect(bones['FL_fetlock']?.rotation.x).toBeCloseTo(-.1, 6);
  expect(bones['body']?.position.y).toBe(.62);
});

test('the kit opt-in still refuses every missing defining joint', () => {
  for (const name of Object.keys(joints())) {
    const bones = joints(); delete bones[name];
    expect(() => new QuadrupedRigPose(bones, true), name).toThrow(`Missing quadruped pose joint: ${name}`);
  }
});

test('decorated native transforms and breath continuation stay exact with either binding mode', () => {
  const native = joints(true), kit = joints(true), first = new QuadrupedRigPose(native), second = new QuadrupedRigPose(kit, true);
  const pose = Float32Array.from({ length: 27 }, (_, index) => Math.sin(index) * .1);
  for (let frame = 0; frame < 300; frame++) { first.apply(pose, 1 / 60, clock); second.apply(pose, 1 / 60, clock); }
  for (const name of Object.keys(native)) {
    expect(kit[name]?.position.toArray()).toEqual(native[name]?.position.toArray());
    expect(kit[name]?.quaternion.toArray()).toEqual(native[name]?.quaternion.toArray());
    expect(kit[name]?.scale.toArray()).toEqual(native[name]?.scale.toArray());
  }
  expect(second.snapshot()).toBe(first.snapshot());
});
