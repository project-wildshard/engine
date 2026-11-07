import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three';
import { expect, test } from 'vitest';
import { dropTriangles, hiddenTriangles } from './hiddenFaces';
import { LowPolyKit } from './lowpolyKit';

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry =>
  new BoxGeometry(w, h, d).toNonIndexed().applyMatrix4(new Matrix4().makeTranslation(x, y, z));
const count = (flags: Uint8Array): number => flags.reduce((n, flag) => n + flag, 0);

test('a part inside a closed part is hidden; the outer part is not', () => {
  const [outer, inner] = hiddenTriangles([box(2, 2, 2), box(0.5, 0.5, 0.5)]);
  expect(count(outer ?? new Uint8Array())).toBe(0);
  expect(count(inner ?? new Uint8Array())).toBe(12);
});

test('a part poking out of another keeps every face that reaches outside', () => {
  const [, poking] = hiddenTriangles([box(2, 2, 2), box(0.5, 3, 0.5)]);
  // its four long sides cross the outer box's faces: none of their triangles has all three corners inside
  expect(count(poking ?? new Uint8Array())).toBe(0);
});

test('a box standing on another hides only its own bottom face', () => {
  const [base, top] = hiddenTriangles([box(2, 1, 2, 0, 0.5, 0), box(0.5, 0.5, 0.5, 0, 1.25, 0)]);
  expect(count(base ?? new Uint8Array())).toBe(0);
  expect(count(top ?? new Uint8Array())).toBe(2);
});

test('two closed parts sharing a face hide it on both sides; a lone open part hides nothing', () => {
  const [a, b] = hiddenTriangles([box(1, 1, 1, 0, 0, 0), box(1, 1, 1, 1, 0, 0)]);
  expect(count(a ?? new Uint8Array())).toBe(2);
  expect(count(b ?? new Uint8Array())).toBe(2);
  const open = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-5, 0, -5, 5, 0, -5, 0, 0, 5], 3));
  expect(count(hiddenTriangles([open, box(0.2, 0.2, 0.2)])[1] ?? new Uint8Array())).toBe(0);
});

test('only triangles wholly under the ground by the margin are buried', () => {
  const [half] = hiddenTriangles([box(1, 1, 1, 0, 0, 0)], { ground: () => 0.25, margin: 0.1 });
  expect(count(half ?? new Uint8Array())).toBe(2);   // the bottom face (y −0.5) only; the sides reach above the ground
  const [deep] = hiddenTriangles([box(1, 1, 1, 0, -2, 0)], { ground: () => 0 });
  expect(count(deep ?? new Uint8Array())).toBe(12);
});

test('dropping keeps every attribute of the kept triangles bit for bit', () => {
  const g = box(1, 1, 1), flags = new Uint8Array(12); flags[0] = 1; flags[5] = 1;
  const before = Float32Array.from(g.getAttribute('position').array), kept = dropTriangles(g, flags), after = kept.getAttribute('position').array;
  expect(after.length).toBe(before.length - 18);
  expect(Array.from(after.subarray(0, 36))).toEqual(Array.from(before.subarray(9, 45)));
});

test('the kit drops hidden faces after its AO bake, leaving the kept faces their colours', () => {
  const build = (hidden: boolean): BufferGeometry => {
    const kit = new LowPolyKit(7);
    kit.add(new BoxGeometry(2, 2, 2), '#808080'); kit.add(new BoxGeometry(0.5, 0.5, 0.5), '#ff0000');
    return kit.finish({ ao: { floorY: -1 }, ...(hidden ? { hidden: {} } : {}) });
  };
  const all = build(false), shown = build(true);
  expect(shown.getAttribute('position').count).toBe(36);
  expect(Array.from(shown.getAttribute('color').array)).toEqual(Array.from(all.getAttribute('color').array.subarray(0, 108)));
});
