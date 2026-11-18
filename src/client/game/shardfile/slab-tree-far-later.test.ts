import { afterAll, expect, test, vi } from 'vitest';

// MG10 (mini-ninemem6, mini-ninemem7): under the loader the slab tree worker builds a chunk's tree alone; the far levels
// come later from a fresh worker, sent the tree's corners, the positions (given back with the tree) and the tree's nodes
// from the main thread. The
// levels it builds then are the ones it would have built with the tree.
afterAll(() => { vi.unstubAllGlobals(); });

function wall(): { corners: Uint32Array; xyz: Float32Array } {
  const positions: number[] = [], corners: number[] = [];
  for (let i = 0; i < 200; i++) for (let j = 0; j < 20; j++) {
    const x = i * 0.1 - 10, y = j * 0.1, at = positions.length / 3;
    positions.push(x, y, 0, x + 0.1, y, 0, x + 0.1, y + 0.1, 0, x, y + 0.1, 0);
    corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return { corners: Uint32Array.from(corners), xyz: Float32Array.from(positions) };
}

test('a chunk sent without its far levels gets its tree at once, and the same far levels from a later far job', async () => {
  const posted: Record<string, unknown>[] = [];
  const scope: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (message: Record<string, unknown>) => void } = {
    onmessage: null, postMessage: message => { posted.push(message); },
  };
  vi.stubGlobal('self', scope);
  await import('./slabTree.worker');
  const send = (data: unknown): Record<string, unknown> => {
    scope.onmessage?.({ data });
    const reply = posted.at(-1); if (reply === undefined) throw new Error('no reply');
    return reply;
  };
  const cells = [0.3, 0.8], room = 4000;
  const now = wall(), later = wall();
  const whole = send({ id: 1, index: now.corners, xyz: now.xyz, far: cells, room, kinds: [] });
  const kept = send({ id: 2, index: later.corners, xyz: later.xyz, keep: true });
  const wholeTree = whole['tree'] as Record<string, unknown>, keptTree = kept['tree'] as Record<string, unknown>;
  expect(keptTree['farCorners']).toBeUndefined();
  // its positions come back with the tree, for the far job
  expect(kept['xyz']).toBe(later.xyz);
  expect(Array.from(keptTree['index'] as Uint32Array)).toEqual(Array.from(wholeTree['index'] as Uint32Array));
  const far = send({ farOf: 2, corners: keptTree['index'], xyz: kept['xyz'], nodes: keptTree['nodes'], triangles: keptTree['triangles'], far: cells, room, kinds: [] })['far'] as Record<string, unknown>;
  expect((wholeTree['farCorners'] as Uint32Array).length).toBeGreaterThan(0);
  for (const key of ['farCorners', 'farCells', 'farStarts', 'farEnds']) expect(Array.from(far[key] as ArrayLike<number>)).toEqual(Array.from(wholeTree[key] as ArrayLike<number>));
  // a far job without its chunk: nothing
  expect(send({ farOf: 3 })['far']).toBeNull();
});
