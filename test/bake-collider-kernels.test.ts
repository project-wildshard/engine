// oxlint-disable-next-line import/no-nodejs-modules -- Keep the original fresh Node renderer guard in the author proof.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { BoxGeometry, Matrix4, Quaternion, Vector3, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { poseOf, poseGeometry, drawnHullWorld } from '../src/client/engine/models/colliders';
import { supportPoints } from './fixtures/native-support-points';
import { bakePlacementPose, bakePlacedGeometry, bakeWorldHull, bakeSupportPoints } from '../src/sharddev/bake/colliders';
import type { AuthorPlacement } from '../src/sharddev/bake/placement';
import { hashImmutableBytes } from '../src/shared/host/immutable';

const rows: readonly AuthorPlacement<object>[] = [
  { x: 0, y: -0, z: 0 },
  { x: 2.31, y: -0.71, z: 9.37, scale: 1 },
  { x: -13.11, y: 0.27, z: 41.3, scale: 1.37, yaw: 0.73, leanX: -0.27, leanZ: 0.91 },
  { x: 0.13, y: 9.21, z: -4.7, scale: -0.83, yaw: 0, leanX: 0, leanZ: 0 },
  { x: 0.31, y: -2.73, z: 1.9, matrix: new Matrix4().compose(new Vector3(4, 5, 6), new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.37), new Vector3(1.3, 1.3, 1.3)) },
  { x: 1, y: 2, z: 3, matrix: new Matrix4().makeTranslation(1, 2, 3) },
];
const bytes = (values: Float32Array) => hashImmutableBytes(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));

test('successive author poses retain every native matrix, channel rounding and relative hull bit', () => {
  for (const row of rows) {
    const native = new BoxGeometry(1.713, 0.739, 2.149, 2, 3, 4), owned = native.clone();
    const before = row.matrix?.clone();
    try {
      expect(bakePlacementPose(row)).toEqual(poseOf(row));
      poseGeometry(native, row); bakePlacedGeometry(owned, row);
      for (const name of Object.keys(native.attributes)) {
        expect(owned.getAttribute(name).array).toEqual(native.getAttribute(name).array);
      }
      const nativeHull = drawnHullWorld([native, native], poseOf(row)), ownedHull = bakeWorldHull([owned, owned], bakePlacementPose(row));
      if (nativeHull.kind !== 'hull') throw new Error('Native world hull changed its kind');
      expect(bytes(ownedHull.points)).toBe(bytes(nativeHull.points));
      expect(ownedHull).toEqual(nativeHull);
      expect(ownedHull.points).not.toBe(nativeHull.points);
      expect(row.matrix).toEqual(before);
    } finally { native.dispose(); owned.dispose(); }
  }
});

test('support selection retains numeric strided reads, duplicate ties and stable first-vertex order', () => {
  const channel = new InterleavedBuffer(new Float32Array([1, 2, 3, 99, -4, 0.2, 1, 98, 1, 2, 3, 97, 0, -2, 4, 96]), 4);
  const geometry = new BufferGeometry().setAttribute('position', new InterleavedBufferAttribute(channel, 3, 0));
  try {
    for (const matrix of [new Matrix4(), rows[4]?.matrix ?? new Matrix4()]) {
      const before = channel.array.slice(), expected = supportPoints(geometry, matrix), actual = bakeSupportPoints(geometry, matrix);
      expect(bytes(actual)).toBe(bytes(expected));
      expect(actual).not.toBe(expected); expect(channel.array).toEqual(before);
    }
  } finally { geometry.dispose(); }
});

test('all author collider kernels execute beneath the unchanged native renderer guard', () => {
  const source = `import {BoxGeometry,Matrix4} from 'three';
    import {bakePlacementPose,bakePlacedGeometry,bakeWorldHull,bakeSupportPoints} from './src/sharddev/bake/colliders.ts';
    const row={x:1,y:2,z:3,yaw:0.4,leanX:0.2,scale:1.3},geometry=new BoxGeometry(1,2,3);
    bakePlacedGeometry(geometry,row);const hull=bakeWorldHull([geometry],bakePlacementPose(row));
    console.log(JSON.stringify({kind:hull.kind,vertices:hull.points.length,support:bakeSupportPoints(geometry,new Matrix4()).length}));geometry.dispose();`;
  const result = execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30_000 });
  expect(JSON.parse(result)).toEqual({ kind: 'hull', vertices: 72, support: 24 });
});
