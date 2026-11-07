import { installCatalogueFixture } from './fixtures/bootSetup';
import { expect, test, vi } from 'vitest';
import { readGridEdges } from '../src/client/game/grid/edgeSources';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';

await installCatalogueFixture();

test.each([false, true])('edge readiness holds the admitted lease until preparation settles (failure %s)', async fail => {
  const release = vi.fn(), row = { heights: [0, 0], colours: [[0, 0, 0] as [number, number, number], [0, 0, 0] as [number, number, number]], roadHeight: 0 as const };
  const source = { edge: { north: row, south: row, east: row, west: row }, entryways: [], runtime: { kind: 'client-plan' as const, cost: FIXTURE_RUNTIME_COST, binds: [] } };
  let finish = (): void => undefined;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const prepare = vi.fn(async () => { await wait; if (fail) throw new Error('module failed'); });
  const work = readGridEdges({ instance: 'cell', slug: 'content', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } }, {
    product: () => Promise.resolve({ admitted: { source }, release }), prepare,
    fetch: () => Promise.reject(new Error('unexpected fetch')),
  });
  await Promise.resolve(); expect(prepare).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
  finish();
  if (fail) await expect(work).rejects.toThrow('module failed');
  else { const edges = await work; expect(edges.kind).toBe('declared'); }
  expect(release).toHaveBeenCalledOnce();
});
