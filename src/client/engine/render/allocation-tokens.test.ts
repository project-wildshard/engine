import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { realGc } from '../../../test/engine/realGc';
import { cachedResourceAllocations } from './textureBytes';

// D227: the residency books hold each charged allocation's identity for as long as it is charged. An identity is a
// stand-in token, so holding it never keeps the geometry's bytes alive once their owner lets them go.
test('allocation identities are stable tokens, never the buffer or attribute they charge', () => {
  const geometry = new BufferGeometry(), position = new BufferAttribute(new Float32Array(9), 3);
  geometry.setAttribute('position', position);
  const first = cachedResourceAllocations(geometry), again = cachedResourceAllocations(geometry);
  expect(first.map(row => row.kind).sort()).toEqual(['cpu', 'gpu']);
  expect(again.map(row => row.identity)).toEqual(first.map(row => row.identity));
  for (const row of first) { expect(row.identity).not.toBe(position.array.buffer); expect(row.identity).not.toBe(position); }
  expect(first.find(row => row.kind === 'cpu')?.bytes).toBe(36);
});

const name = 'a held allocation identity lets its geometry and bytes be collected';
test(name, async () => {
  await realGc('src/client/engine/render/allocation-tokens.test.ts', name, async collect => {
    const held: object[] = [];
    const refs = (() => {
      const bytes = new Float32Array(256 * 1024), geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(bytes, 3));
      for (const row of cachedResourceAllocations(geometry)) held.push(row.identity);
      return { geometry: new WeakRef(geometry), backing: new WeakRef(bytes.buffer) };
    })();
    await collect(refs.geometry); await collect(refs.backing);
    expect(held).toHaveLength(2);
  });
});
