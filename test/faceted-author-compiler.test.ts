// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the unchanged native renderer import guard in a fresh realm.
import { execFileSync } from 'node:child_process';
import { expect, expectTypeOf, test } from 'vitest';
import { BoxGeometry, BufferAttribute, type BufferGeometry, Color, Matrix4, PlaneGeometry, SphereGeometry } from 'three';
import { LowPolyKit } from '../src/client/engine/world/lowpolyKit';
import { withoutHidden } from '../src/client/engine/world/geometryKit';
import { FacetedGeometryBuilder, cullFacetedParts, type FacetedGeometrySink } from '../src/sharddev/bake/facetedGeometry';
import { hashImmutableBytes } from '../src/shared/host/immutable';

type Options = NonNullable<Parameters<FacetedGeometryBuilder['finish']>[0]>;
function run(make: () => LowPolyKit | FacetedGeometryBuilder, options: Options) {
  const kit = make();
  kit.add(new SphereGeometry(0.7, 8, 6), '#a8794d', { wobble: 0.03, matrix: new Matrix4().makeTranslation(-0.3, 0.2, 0) });
  kit.addTopped(new BoxGeometry(1, 0.4, 1), '#394b68', new Color('#96a374'), { jitter: 0.09, wobble: 0.02, minY: 0.4 });
  kit.addParts([[new PlaneGeometry(0.7, 1), '#6a9d51'], [new PlaneGeometry(0.4, 0.8), '#416f39']], { sway: { w: 0.2, hang: true } });
  kit.add(new PlaneGeometry(0.6, 1.1), '#d5bd90', { sway: { w: 0.4, phase: 0.25, span: [-0.5, 0.6] } });
  const painted = new BoxGeometry(0.2, 0.3, 0.4);
  painted.setAttribute('color', new BufferAttribute(new Float32Array(painted.getAttribute('position').count * 3).fill(0.4), 3));
  kit.addPainted(painted, new Matrix4().makeTranslation(0.2, 0.1, 0));
  const geometry = kit.finish(options), continuation = kit.rng.snapshot();
  // The same builder starts a fresh pending part list after finishing.
  kit.add(new PlaneGeometry(0.2, 0.1), '#abcdef');
  const next = kit.finish({ ao: false });
  return { geometry, next, continuation };
}
function identity(geometry: BufferGeometry): unknown {
  const channel = (a: BufferAttribute) => ({ storage: a.array.constructor.name, width: a.itemSize, normalized: a.normalized,
    count: a.count, hash: hashImmutableBytes(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength)) });
  const attributes = Object.entries(geometry.attributes).map(([name, a]) => {
    if (!(a instanceof BufferAttribute)) throw new Error('Unexpected interleaved compiler output');
    const row = { name }; return Object.assign(row, channel(a));
  });
  return { attributes, index: geometry.index === null ? null : channel(geometry.index), box: geometry.boundingBox,
    sphere: geometry.boundingSphere, groups: geometry.groups };
}
const cases: readonly { readonly label: string; readonly options: Options }[] = [
  { label: 'unshaded', options: { ao: false } },
  { label: 'floor AO', options: { ao: { floorY: -0.2, cell: 0.2, strength: 0.5, tint: '#39445b' } } },
  { label: 'terrain AO and hidden faces', options: { ao: { ground: (x, z) => 0.1 * x - 0.02 * z, cell: 0.2 }, hidden: { ground: () => -0.1, margin: 0.05 } } },
];
for (const { label, options } of cases) test(`the author compiler retains native ${label} bits, bounds and stream`, () => {
  expectTypeOf<LowPolyKit extends FacetedGeometrySink ? true : false>().toEqualTypeOf<true>();
  const native = run(() => new LowPolyKit(731), options), authored = run(() => new FacetedGeometryBuilder(731), options);
  try {
    expect(identity(authored.geometry)).toEqual(identity(native.geometry));
    expect(identity(authored.next)).toEqual(identity(native.next));
    expect(authored.continuation).toEqual(native.continuation);
    expect(authored.geometry.getAttribute('position').array).not.toBe(native.geometry.getAttribute('position').array);
  } finally { native.geometry.dispose(); native.next.dispose(); authored.geometry.dispose(); authored.next.dispose(); }
});

test('the actual author compiler runs beneath the unchanged native renderer guard', () => {
  const source = `import {FacetedGeometryBuilder} from './src/sharddev/bake/facetedGeometry.ts';
    import {BoxGeometry} from 'three'; const kit=new FacetedGeometryBuilder(1);
    kit.add(new BoxGeometry(1,1,1),'#abcdef');const g=kit.finish({ao:{floorY:0}});
    console.log(g.getAttribute('position').count);g.dispose();`;
  const result = execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30_000 });
  expect(result.trim()).toBe('36');
});

test('finished-part culling preserves native hidden faces and every retained attribute bit', () => {
  const parts = [new BoxGeometry(3, 3, 3).toNonIndexed(), new BoxGeometry(0.7, 0.7, 0.7).toNonIndexed(),
    new BoxGeometry(1, 1, 1).toNonIndexed().translate(2, -4, 0), new PlaneGeometry(2, 2).toNonIndexed().translate(7, 0, 0)];
  for (const row of parts) {
    const count = row.getAttribute('position').count;
    row.setAttribute('aTest', new BufferAttribute(new Int8Array(count).map((_value, i) => i % 127 - 63), 1, true));
    row.userData = { owner: 'author' };
  }
  const copies = parts.map(row => row.clone()), options = { ground: () => -1 };
  const native = withoutHidden(parts, options), actual = cullFacetedParts(copies, options);
  try {
    expect(actual.map(identity)).toEqual(native.map(identity));
    expect(actual[1]?.getAttribute('position').count).toBe(0);
    expect(actual[2]?.getAttribute('position').count).toBe(0);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i] === copies[i]).toBe(native[i] === parts[i]);
      expect(actual[i]?.userData).toBe(copies[i]?.userData);
    }
  } finally { for (const row of [...native, ...actual]) row.dispose(); }
});

test('finished-part culling lends untouched part identity without disposing it', () => {
  const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
  let disposals = 0;
  geometry.addEventListener('dispose', () => { disposals++; });
  const result = cullFacetedParts([geometry]);
  expect(result).toEqual([geometry]); expect(result[0]).toBe(geometry); expect(disposals).toBe(0);
  geometry.dispose(); expect(disposals).toBe(1);
});
