import { expect, test } from 'vitest';
import { Bone } from 'three';
import { QuadrupedRigPose } from './animalRig';

const upper = ['FL_shoulder', 'FR_shoulder', 'BL_hip', 'BR_hip'];
const middle = ['FL_carpus', 'FR_carpus', 'BL_stifle', 'BR_stifle'];
const lower = ['FL_fetlock', 'FR_fetlock', 'BL_hock', 'BR_hock'];
const names = ['body', 'neck1', 'neck2', 'head', 'earL', 'earR', 'tail', 'belly', ...upper, ...middle, ...lower];
const rig = () => Object.fromEntries(names.map(name => [name, new Bone()]));

test('upper leg publication preserves native rotation bits through motion and death', () => {
  const bones = rig(), oracle = rig(), owner = new QuadrupedRigPose(bones);
  const pose = new Float32Array(27), legAbd = new Float32Array([.2, -.3, .4, -.5]);
  for (const order of ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as const) {
    for (const name of upper) {
      const a = bones[name], b = oracle[name];
      if (a === undefined || b === undefined) throw new Error('Missing test joint');
      a.rotation.set(.3, -.27, -.4, order); b.rotation.copy(a.rotation);
    }
    for (let tick = 0; tick < 720; tick++) {
      for (let i = 0; i < pose.length; i++) pose[i] = tick % 17 === 0 ? -0 : Math.sin(tick * .03 + i);
      const alive = tick < 500, deathT = alive ? 0 : (tick - 500) / 60, deathSide = tick % 2 ? -1 : 1;
      owner.apply(pose, 1 / 60, { bodyY: .4, alive, deathT, deathSide, speed: tick % 7, legAbd });
      const t = Math.max(0, deathT), dead = alive ? 0 : t * t * (3 - 2 * t);
      for (let i = 0; i < upper.length; i++) {
        const name = upper[i], a = name === undefined ? undefined : bones[name], b = name === undefined ? undefined : oracle[name];
        if (a === undefined || b === undefined) throw new Error('Missing test joint');
        b.rotation.x = -(pose[15 + i * 3] ?? 0);
        b.rotation.z = dead * (legAbd[i] ?? 0) * (deathSide < 0 ? 1 : -1);
        for (const axis of ['x', 'y', 'z'] as const) expect(Object.is(a.rotation[axis], b.rotation[axis])).toBe(true);
        for (const axis of ['x', 'y', 'z', 'w'] as const) expect(Object.is(a.quaternion[axis], b.quaternion[axis])).toBe(true);
        a.updateMatrix(); b.updateMatrix();
        expect(a.matrix.elements).toEqual(b.matrix.elements);
      }
    }
  }
});

test('a shared joint keeps the final write order of its leg chain', () => {
  for (const shared of ['FL_carpus', 'FL_fetlock']) {
    const bones = rig(), oracle = rig(), a = bones['FL_shoulder'], b = oracle['FL_shoulder'];
    if (a === undefined || b === undefined) throw new Error('Missing test joint');
    bones[shared] = a; oracle[shared] = b;
    const owner = new QuadrupedRigPose(bones), pose = new Float32Array(27);
    pose[15] = -.7; pose[16] = .4; pose[17] = -.2;
    owner.apply(pose, 1 / 60, { bodyY: 0, alive: false, deathT: .5, deathSide: -1, speed: 0, legAbd: new Float32Array([.3]) });
    b.rotation.x = -(pose[15] ?? 0);
    const mid = oracle['FL_carpus'], low = oracle['FL_fetlock'];
    if (mid === undefined || low === undefined) throw new Error('Missing test joint');
    mid.rotation.x = pose[16] ?? 0; low.rotation.x = pose[17] ?? 0;
    b.rotation.z = .5 * Math.fround(.3);
    expect(a.rotation.toArray()).toEqual(b.rotation.toArray());
    expect(a.quaternion.toArray()).toEqual(b.quaternion.toArray());
  }
});
