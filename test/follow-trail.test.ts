import { expect, test } from 'vitest';
import { BufferAttribute, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3, Scene } from 'three';
import { SlashTrail } from '../src/client/engine/combat/view/slashTrail';
import { RangedTrace } from '../src/client/engine/render/viewmodelFeel';
import { parse } from 'valibot';
import { FollowTrailSamplingSchema } from '@wildshard/format/trail';

// Frozen wakeRibbon.ts algorithm before G502. In particular, a slow frame
// shifts once, not floor(dt / every), and despawn preserves clock remainder.
function wakeOracle(points: number, every: number, width: number) {
  const trail = Array.from({ length: points }, () => new Vector3());
  const side = new Vector3(), dir = new Vector3(), toCam = new Vector3();
  const pos = new Float32Array(points * 6);
  let clock = 0, seeded = false;
  return (at: Vector3, alive: boolean, camera: Vector3, dt: number) => {
    if (!alive) { seeded = false; return pos; }
    if (!seeded) { for (const p of trail) p.copy(at); seeded = true; }
    clock += dt;
    if (clock >= every) { clock = 0; for (let i = points - 1; i > 0; i--) trail[i]?.copy(trail[i - 1] ?? at); }
    trail[0]?.copy(at);
    for (let i = 0; i < points; i++) {
      const p = trail[i] ?? at, q = trail[Math.min(points - 1, i + 1)] ?? p;
      dir.subVectors(p, q); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      toCam.subVectors(camera, p);
      side.crossVectors(dir, toCam).normalize().multiplyScalar(width * (1 - i / (points - 1)) * 0.5 + 0.05);
      pos.set([p.x + side.x, p.y + side.y, p.z + side.z], i * 6); pos.set([p.x - side.x, p.y - side.y, p.z - side.z], i * 6 + 3);
    }
    return pos;
  };
}

test.each([['phone', 1 / 30], ['desktop', 1 / 60]] as const)('%s wake has exact moving-frame buffer parity', (_device, dt) => {
  const follow = SlashTrail.follow({ kind: 'fx.trail', points: 56, every: 0.07, movementSq: 0 });
  const oracle = wakeOracle(56, 0.07, 1.6), actual = new Float32Array(56 * 6);
  const point = new Vector3(), camera = new Vector3();
  for (let i = 0; i < 420; i++) {
    const alive = i < 97 || i > 111;
    point.set(Math.sin(i / 25) * 20 + 500, 15 + Math.cos(i / 41), Math.cos(i / 25) * 20 - 500);
    camera.copy(point).add(new Vector3(Math.sin(i / 19) * 3, 1.5, 5));
    const step = i % 71 === 0 ? 0.23 : dt;
    const expected = oracle(point, alive, camera, step);
    if (follow.follow(point, alive, step)) follow.face(camera, 1.6, 0.05, actual);
    expect(actual).toEqual(expected);
  }
});

test.each([new Vector2(1206, 2622), new Vector2(1920, 1080)])('projected bolt keeps exact buffers, cap, reuse and impact fade at %s', resolution => {
  const scene = new Scene(), material = new MeshBasicMaterial(), marker = { group: new Group(), ring: new Mesh(), material };
  const trace = new RangedTrace(scene, { mode: 'trail', points: 2048, width: 8, color: [1, 0, 0], order: 1200,
    lifetime: 6, fade: 1.5, markerScale: 0.32, follow: { kind: 'fx.trail', every: null, movementSq: 1e-8 } }, marker);
  const camera = new PerspectiveCamera(), expected = new Float32Array(2047 * 6), last = new Vector3();
  const point = new Vector3();
  for (let run = 0; run < 2; run++) {
    trace.begin(point.set(4, 2, -3)); last.copy(point); let n = 1;
    for (let i = 0; i < 2100; i++) {
      if (i % 7 !== 0) point.set(4 + i / 9, 2 - i * i / 1e6, -3 - i / 8);
      if (n < 2048 && point.distanceToSquared(last) >= 1e-8) {
        expected.set([last.x, last.y, last.z, point.x, point.y, point.z], (n - 1) * 6); last.copy(point); n++;
      }
      trace.addPoint(point);
      trace.publish(i / 60, camera, resolution);
      expect(trace.n).toBe(n);
    }
    const attribute = trace.line.geometry.getAttribute('instanceStart');
    expect(attribute.array).toEqual(expected);
    trace.finish(point, 40); trace.publish(45.25, camera, resolution);
    expect(trace.mat.opacity).toBe(0.5); expect(marker.material.opacity).toBe(0.5);
    expect(marker.group.position).toEqual(point); expect(trace.mat.resolution).toEqual(resolution);
    trace.publish(46, camera, resolution); expect(trace.active).toBe(false); expect(marker.group.visible).toBe(false);
  }
  trace.line.geometry.dispose(); trace.mat.dispose(); material.dispose();
});

test('invalid sampling refuses before allocation and blade profile stays independent', () => {
  for (const row of [{ points: 1, every: null, movementSq: 0 }, { points: 2, every: 0, movementSq: 0 }, { points: 2, every: null, movementSq: -1 }])
    expect(() => SlashTrail.follow({ kind: 'fx.trail', ...row })).toThrow(RangeError);
  expect(() => parse(FollowTrailSamplingSchema, { kind: 'fx.trail', every: null, movementSq: 0, owner: 'shard' })).toThrow();
  expect(() => parse(FollowTrailSamplingSchema, { kind: 'fx.trail', every: 0, movementSq: 0 })).toThrow();
  const blade = new SlashTrail({ samples: 4, subdivisions: 1, movementSq: 0, channel: 'age' });
  blade.sample(new Vector3(), new Vector3(0, 1, 0), 0);
  blade.sample(new Vector3(1, 0, 0), new Vector3(1, 1, 0), 0.1);
  expect(blade.rebuild(0.2, 1)).toBe(true); expect(blade.pos).toBeInstanceOf(BufferAttribute); blade.dispose();
});
