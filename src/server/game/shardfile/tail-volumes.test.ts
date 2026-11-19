// ONE-FORMAT CC58b1/b2: a horizontal biped's tail volumes ride trail bones behind its hips; its spine leans by the pitch.
import { expect, test } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { HORIZONTAL_SPINE_PITCH } from '@wildshard/format/creatureSkeletons';
import { TailCreatureVolumes } from '../../../shared/game/shardfile/tailCreatureVolumes';
import { RestCreatureVolumes, type CreatureRestJoint } from '../../../shared/game/shardfile/creatureVolumes';
import { CreatureSockets } from '../../../shared/game/shardfile/creatureSockets';

/** How far apart two rotations are, safe where `angleTo`'s acos sees a dot a hair over 1. */
const apart = (a: Quaternion, b: Quaternion): number => 1 - Math.min(1, Math.abs(a.dot(b)));

const HIP = 1.2, SPACING = 0.8, TAIL = 4;
const body = { skeleton: 'biped' as const, stance: 'horizontal' as const, trail: { count: TAIL, spacing: SPACING }, size: 'large' as const, scale: 1, look: 'rex.look' };
const { trail: _trail, ...plain } = body;
const upright = { ...plain, stance: 'upright' as const };
/** A plain biped rest rig (position-only joints) with its tail straight back from the hips. */
const joints: CreatureRestJoint[] = [
  { name: 'body', parent: -1, position: [0, 0, 0] },
  { name: 'hips', parent: 0, position: [0, HIP, 0] },
  { name: 'spine', parent: 1, position: [0, 0.3, 0] },
  { name: 'chest', parent: 2, position: [0, 0.3, 0] },
  { name: 'neck', parent: 3, position: [0, 0.2, 0] },
  { name: 'head', parent: 4, position: [0, 0.2, 0] },
  ...Array.from({ length: TAIL }, (_unused, index): CreatureRestJoint => ({ name: `tail${String(index + 1)}`, parent: index === 0 ? 1 : 5 + index, position: [0, 0, -SPACING] })),
];

/** The root walking +z at 1.6 m a 10 Hz sample, the ring fed every tick as the server's trail step does. */
function rex(z: (tick: number) => number = tick => tick * 1.6 / 6, ticks = 120): { tail: TailCreatureVolumes; root: { position: Vector3; yaw: number; scale: number } } {
  const root = { position: new Vector3(0, 0, z(0)), yaw: 0, scale: 1 };
  const tail = new TailCreatureVolumes(body, joints, root);
  for (let tick = 0; tick <= ticks; tick++) { root.position.set(0, 0, z(tick)); tail.sample(tick); }
  return { tail, root };
}

test('the tail volumes trail the walking hips, a capsule a bone, after the body and head', () => {
  const { tail, root } = rex();
  expect(tail.volumes.map(row => row.part)).toEqual(['body', 'head', 'tail1', 'tail2', 'tail3', 'tail4']);
  expect(tail.volumes.slice(2).every(row => row.multiplier === 0.5)).toBe(true);
  expect('motorless' in tail).toBe(false);
  const rear = new Vector3(), front = new Vector3(), centre = new Vector3();
  for (let bone = 0; bone < TAIL; bone++) {
    tail.segment(2 + bone, rear, front);
    centre.addVectors(rear, front).multiplyScalar(0.5);
    expect(Math.abs(centre.z - (root.position.z - (bone + 1) * SPACING))).toBeLessThan(0.05);
    expect(Math.abs(centre.y - HIP)).toBeLessThan(0.05);
    expect(front.z - rear.z).toBeCloseTo(SPACING, 6);
  }
});

test('turning, the tail follows the path the hips drew, not the body axis', () => {
  // walk +z for 2 s, then +x: the tail's far bones are still on the +z leg of the path
  const root = { position: new Vector3(), yaw: 0, scale: 1 };
  const tail = new TailCreatureVolumes(body, joints, root);
  for (let tick = 0; tick <= 240; tick++) {
    const z = Math.min(tick, 120) * 0.25, x = Math.max(0, tick - 120) * 0.025;
    root.position.set(x, 0, z); root.yaw = tick > 120 ? Math.PI / 2 : 0; tail.sample(tick);
  }
  // hips at (3, 30): tail3 is 2.4 m back along the +x leg, tail4 3.2 m back, round the corner onto the +z leg
  const third = tail.bone(2, new Vector3()), last = tail.bone(TAIL - 1, new Vector3());
  expect(third.x).toBeCloseTo(0.6, 1);
  expect(third.z).toBeCloseTo(30, 1);
  expect(last.x).toBeCloseTo(0, 1);
  expect(last.z).toBeCloseTo(29.8, 1);
});

test('the spine pitch leans the head out over the legs', () => {
  const root = { position: new Vector3(), yaw: 0, scale: 1 };
  const straight = new RestCreatureVolumes(upright, joints, root);
  const leaning = new TailCreatureVolumes(body, joints, root);
  const rear = new Vector3(), front = new Vector3();
  straight.segment(1, rear, front);
  expect(rear.z).toBeCloseTo(0, 6);
  expect(rear.y).toBeCloseTo(HIP + 1, 6);
  leaning.segment(1, rear, front);
  // hips, then the spine's 0.3 m up, then 0.7 m along the pitched spine
  expect(rear.z).toBeCloseTo(0.7 * Math.sin(HORIZONTAL_SPINE_PITCH), 6);
  expect(rear.y).toBeCloseTo(HIP + 0.3 + 0.7 * Math.cos(HORIZONTAL_SPINE_PITCH), 6);
});

test('a sweep from the tail starts at its tip; the mouth stays on the pitched head', () => {
  const { tail, root } = rex();
  const sockets = new CreatureSockets(body, joints, root, { names: ['tail', 'mouth'],
    posed: (index, _at, out) => tail.socket(joints[index]?.name ?? '', out) });
  const tip = sockets.point(0, new Vector3());
  expect(tip.distanceTo(tail.bone(TAIL - 1, new Vector3()))).toBeLessThan(1e-9);
  expect(Math.abs(tip.z - (root.position.z - TAIL * SPACING))).toBeLessThan(0.05);
  const mouth = sockets.point(1, new Vector3());
  expect(mouth.z - root.position.z).toBeCloseTo(0.7 * Math.sin(HORIZONTAL_SPINE_PITCH) + 0.2 * Math.cos(HORIZONTAL_SPINE_PITCH), 6);
});

test('the ring is saved state: a restored rex poses the same tail', () => {
  const { tail, root } = rex(tick => Math.sin(tick / 20) * 3);
  const copy = new TailCreatureVolumes(body, joints, root);
  copy.restore(structuredClone(tail.snapshot()));
  const a = new Vector3(), b = new Vector3();
  for (let bone = 0; bone < TAIL; bone++) expect(copy.bone(bone, a)).toEqual(tail.bone(bone, b));
  expect(() => { copy.restore({ ...tail.snapshot(), points: [1, 2, 3] }); }).toThrow('Incompatible trail continuation');
});

test('only a horizontal biped poses tail volumes, never from clips', () => {
  const root = { position: new Vector3(), yaw: 0, scale: 1 };
  expect(() => new TailCreatureVolumes(upright, joints, root)).toThrow('Tail volumes need a horizontal biped body');
  expect(() => new TailCreatureVolumes({ ...body, size: 'giant', hits: 'clip' }, joints, root)).toThrow('not from clips');
  // a rig with its spine renamed has nothing to pitch
  const renamed = joints.map((row): CreatureRestJoint => (row.name === 'spine' ? { name: 'back', parent: row.parent, position: row.position } : row));
  expect(() => new TailCreatureVolumes(body, renamed, root)).toThrow('Missing creature pitch bone spine');
});

test('the tail poser lends local joints that compose back onto the trail (CC58b2)', () => {
  const { tail, root } = rex(tick => Math.sin(tick / 15) * 2 + tick * 0.1);
  root.yaw = 0.7;
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), root.yaw);
  // the root, then the hips' rest offset (position-only), then each tail joint in turn
  const world = new Matrix4().compose(root.position, yaw, new Vector3(1, 1, 1)).multiply(new Matrix4().makeTranslation(0, HIP, 0));
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3(), expected = new Vector3();
  for (let bone = 0; bone < TAIL; bone++) {
    expect(tail.trailJoint(tail.bones[bone] ?? '', position, quaternion, scale)).toBe(true);
    world.multiply(new Matrix4().compose(position, quaternion, scale));
    expect(new Vector3().setFromMatrixPosition(world).distanceTo(tail.bone(bone, expected))).toBeLessThan(1e-6);
  }
  expect(tail.trailJoint('head', position, quaternion, scale)).toBe(false);
});

test('a rest tail lends its rest joints: straight back, unrotated', () => {
  const root = { position: new Vector3(), yaw: 0, scale: 1 };
  const tail = new TailCreatureVolumes(body, joints, root);
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  for (const name of tail.bones) {
    tail.trailJoint(name, position, quaternion, scale);
    expect(position.distanceTo(new Vector3(0, 0, -SPACING))).toBeLessThan(1e-9);
    expect(apart(quaternion, new Quaternion())).toBeLessThan(1e-9);
  }
});
