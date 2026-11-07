import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect this build-only source's diagnostic, never execute a shader.
import { readFileSync } from 'node:fs';
import { geometryWriter } from '../src/shards/nine-dragon-stack/generators/bakeWrite';
import { rawShaderLines } from '../scripts/shard-platform.mjs';

test('the writer retains typed vertex bytes, normalization, padding and index deltas', () => {
  const geometry = new BufferGeometry(), position = new Float32Array([0, -0, 0, 1, 0, 0, 0, 1, 0]), colour = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  geometry.setAttribute('position', new BufferAttribute(position, 3)); geometry.setAttribute('color', new BufferAttribute(colour, 3, true)); geometry.setIndex([0, 1, 2]);
  const writer = geometryWriter('fixture');
  expect(writer.add(geometry)).toEqual({ attrs: [['position', 'f32', 3, false], ['color', 'u8', 3, true]], count: 3, index: 'u16', indexCount: 3, box: false });
  expect(writer.blocks).toEqual([new Uint8Array(position.buffer), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]), new Uint8Array(new Int32Array([0, 1, 1]).buffer)]);
  geometry.dispose();
});

test('unsupported storage refuses with a precise diagnostic and no written blocks', () => {
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float64Array(9), 3));
  const writer = geometryWriter('fixture'); expect(() => writer.add(geometry)).toThrow('fixture: unsupported vertex storage'); expect(writer.blocks).toEqual([]); geometry.dispose();
  const path = 'src/shards/nine-dragon-stack/generators/bakeWrite.ts';
  expect(rawShaderLines(readFileSync(path, 'utf8'), path)).toBe(0);
});
