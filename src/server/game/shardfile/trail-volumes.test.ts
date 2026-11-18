// ONE-FORMAT CC23b: a serpent's volumes ride its trail bones; buried segments are off, surfaced ones are hit.
import { expect, test } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { createNativeTargetQueries, type NativeTargetBody } from '../plugin/simulation';
import { TrailCreatureVolumes } from '../../../shared/game/shardfile/trailCreatureVolumes';

const SAND = 0;
const body = { skeleton: 'serpent' as const, trail: { count: 6, spacing: 1.6 }, size: 'giant' as const, scale: 1, look: 'wyrm.look' };
const ground = (): number => SAND;

/** A serpent's root walking +z at 1.6 m a 10 Hz sample, its ring fed every tick as the server's step does. */
function serpent(y: (tick: number) => number, ticks = 120, count = 6): { trail: TrailCreatureVolumes; root: { position: Vector3; yaw: number; scale: number } } {
  const root = { position: new Vector3(0, y(0), 0), yaw: 0, scale: 1 };
  const trail = new TrailCreatureVolumes({ ...body, trail: { count, spacing: 1.6 } }, root, ground);
  for (let tick = 0; tick <= ticks; tick++) { root.position.set(0, y(tick), tick * 1.6 / 6); trail.sample(tick); }
  return { trail, root };
}
function target(trail: TrailCreatureVolumes, root: { position: Vector3 }): NativeTargetBody {
  return { alive: true, scale: 1, position: root.position, hitVolumes: trail, headWorld: out => out, bodyCapsule: () => undefined,
    dims: { headRadius: 0.3, bodyRadius: 0.3, bodyHalfLen: 0.5, bodyY: 0.5 } };
}

test('a surfaced serpent lays a capsule a segment back along its path, head first', () => {
  const { trail, root } = serpent(() => 1);
  expect(trail.volumes.map(row => row.part)).toEqual(['head', 'seg1', 'seg2', 'seg3', 'seg4', 'tail']);
  expect(trail.motorless).toBe(true);
  const rear = new Vector3(), front = new Vector3();
  for (let index = 1; index < trail.volumes.length; index++) {
    trail.segment(index, rear, front);
    // bone i sits i × 1.6 m back along +z from the head, the capsule ±0.8 m along the path
    expect(rear.z).toBeCloseTo(root.position.z - index * 1.6 - 0.8, 6);
    expect(front.z).toBeCloseTo(root.position.z - index * 1.6 + 0.8, 6);
    expect(trail.off(index)).toBe(false);
  }
  expect(trail.buried).toBe(false);
});

test('a buried serpent cannot be hit; a surfaced one can, on the segment the ray meets', () => {
  const queries = createNativeTargetQueries<NativeTargetBody>();
  const down = new Vector3(0, -1, 0);
  const under = serpent(() => -4);
  expect(under.trail.buried).toBe(true);
  expect(queries.ray([target(under.trail, under.root)], new Vector3(0, 10, under.root.position.z - 3 * 1.6), down, 30)).toBeNull();
  const up = serpent(() => 1);
  const hit = queries.ray([target(up.trail, up.root)], new Vector3(0, 10, up.root.position.z - 3 * 1.6), down, 30);
  expect(hit?.part).toBe('seg3');
  expect(hit?.multiplier).toBe(0.5);
});

test('half out of the sand: the surfaced head is hit, the buried tail is off', () => {
  // the head came up two seconds ago; the body behind still follows the path under the sand
  const { trail, root } = serpent(tick => (tick >= 108 ? 1 : -4));
  expect(trail.off(0)).toBe(false);
  expect(trail.off(5)).toBe(true);
  expect(trail.buried).toBe(false);
  const queries = createNativeTargetQueries<NativeTargetBody>();
  const tail = new Vector3();
  trail.bone(5, tail);
  expect(queries.ray([target(trail, root)], new Vector3(tail.x, 10, tail.z), new Vector3(0, -1, 0), 30)).toBeNull();
  expect(queries.ray([target(trail, root)], new Vector3(0, 10, root.position.z), new Vector3(0, -1, 0), 30)?.part).toBe('head');
});

test('the ring is saved state: a restored serpent poses the same trail', () => {
  const { trail, root } = serpent(tick => Math.sin(tick / 20) * 3);
  const copy = new TrailCreatureVolumes(body, root, ground);
  copy.restore(structuredClone(trail.snapshot()));
  const a = new Vector3(), b = new Vector3();
  for (let bone = 0; bone < 6; bone++) expect(copy.bone(bone, a)).toEqual(trail.bone(bone, b));
  expect(() => { copy.restore({ ...trail.snapshot(), points: [1, 2, 3] }); }).toThrow('Incompatible trail continuation');
});

test('only a serpent poses trail volumes, and its volumes sit on trail bones', () => {
  const root = { position: new Vector3(), yaw: 0, scale: 1 };
  expect(() => new TrailCreatureVolumes({ ...body, skeleton: 'quadruped', trail: undefined } as never, root, ground)).toThrow();
  const stray = { ...body, volumes: [{ part: 'fin', bone: 'fin', shape: 'sphere' as const, radius: 0.4, halfLength: 0, axis: 'y' as const, multiplier: 1 }] };
  expect(() => new TrailCreatureVolumes(stray, root, ground)).toThrow('A serpent volume sits on a trail bone, not fin');
});

test('the serpent poser lends local joints that compose back onto the trail (CC23c)', () => {
  const { trail, root } = serpent(tick => Math.sin(tick / 15) * 2 + 1);
  root.yaw = 0.7;
  const world = new Matrix4().compose(root.position, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), root.yaw), new Vector3(1, 1, 1));
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3(), expected = new Vector3();
  for (let bone = 0; bone < 6; bone++) {
    expect(trail.joint(trail.bones[bone] ?? '', position, quaternion, scale)).toBe(true);
    world.multiply(new Matrix4().compose(position, quaternion, scale));
    const got = new Vector3().setFromMatrixPosition(world);
    expect(got.distanceTo(trail.bone(bone, expected))).toBeLessThan(1e-6);
  }
  expect(trail.joint('fin', position, quaternion, scale)).toBe(false);
});

test('the poser frame cost for 20 serpents of 14 bones is stated', () => {
  const serpents = Array.from({ length: 20 }, (_unused, index) => serpent(tick => Math.sin((tick + index * 7) / 15) * 2, 240, 14).trail);
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  const frames = 600, start = performance.now();
  for (let frame = 0; frame < frames; frame++) for (const trail of serpents) for (const name of trail.bones) trail.joint(name, position, quaternion, scale);
  const perFrame = (performance.now() - start) / frames;
  console.info(`CC23c poser: 20 serpents x ${String(serpents[0]?.bones.length)} bones, ${perFrame.toFixed(3)} ms a frame`);
  expect(perFrame).toBeLessThan(5);
});
