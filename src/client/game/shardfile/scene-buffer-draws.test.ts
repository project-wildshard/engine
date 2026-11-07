import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshBasicMaterial, Points } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { prepareSceneBufferDraws } from './sceneBuffers';

test('one construction shares detached channels without retaining them after its scope', () => {
  const scope = new Scope('buffer-build'), next = new Scope('next-buffer-build');
  const a = new MeshBasicMaterial(), b = new MeshBasicMaterial();
  const words = new Float32Array([0, -0, 1]);
  const files = new Map([['position.bin', new Uint8Array(words.buffer)]]);
  const row = { version: 1, buffers: [{ id: 'p', storage: 'f32', file: 'position.bin', byteLength: 12 }],
    attributes: [{ id: 'p', buffer: 'p', size: 3 }], geometries: [{ id: 'g', attributes: { position: 'p' } }],
    draws: [{ id: 'draw', draw: { kind: 'points', geometry: 'g' } }] };
  try {
    const draw = prepareSceneBufferDraws(row, scope, undefined, files);
    const first = draw(a), second = draw(b), left = first.children[0], right = second.children[0];
    if (!(left instanceof Points) || !(right instanceof Points)) throw new Error('Missing buffered points');
    expect(first).not.toBe(second); expect(left).not.toBe(right);
    expect(left.material).toBe(a); expect(right.material).toBe(b);
    expect(left.geometry).toBe(right.geometry);
    const geometry: unknown = left.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Missing buffered geometry');
    const position: unknown = geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Missing position channel');
    expect(position.array.buffer).not.toBe(words.buffer);
    expect(Array.from(position.array)).toEqual([0, -0, 1]);
    const disposed = vi.spyOn(geometry, 'dispose');
    scope.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    expect(() => draw(a)).toThrow('retired');
    const rebuilt = prepareSceneBufferDraws(row, next, undefined, files)(a).children[0];
    if (!(rebuilt instanceof Points)) throw new Error('Missing rebuilt points');
    expect(rebuilt.geometry).not.toBe(left.geometry);
  } finally { scope.dispose(); next.dispose(); a.dispose(); b.dispose(); }
});
