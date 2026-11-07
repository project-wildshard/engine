import { expect, test, vi } from 'vitest';
import type { RegionalRuntimeTextures } from './regionalRuntime';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual admission prefix with controlled source ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Strip only repository TypeScript before executing the admission seam.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the scheduling fixture backed by the actual source branch.
import { runInNewContext } from 'node:vm';

function fixture(load: () => Promise<void>) {
  const source = readFileSync(new URL('liveSession.ts', import.meta.url), 'utf8');
  const method = source.indexOf('  private async admitRuntime(');
  const start = source.indexOf('    const manifest = findShard(cell.slug)', method);
  const end = source.indexOf('    let closed = false;', start);
  if (method === -1 || start === -1 || end === -1) throw new Error('Regional entry import boundary missing');
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(async function(metadata, inputs) {
    const {cell, retained, findShard, hasDeclaredClientPage, resolveRegionalRuntimeTextures,
      regionalRuntimeAccountedBytes, GridCellWaitingError, choice} = inputs;
    return await (async function() {
      ${source.slice(start, end)}
      return {fresh: true};
    }).call(inputs.receiver);
  })`), { Promise, Error });
  if (typeof factory !== 'function') throw new Error('Missing regional admission factory');
  let mode: RegionalRuntimeTextures['mode'] = 'img';
  const resolveTextures = vi.fn((): RegionalRuntimeTextures => ({ mode, enter: () => () => undefined }));
  const accounted = vi.fn((_admitted: unknown, _manifest: unknown, selected: RegionalRuntimeTextures['mode']): number => selected === 'img' ? 489909910 : 197073318);
  const choice: { textures?: RegionalRuntimeTextures } = {};
  const inputs = { choice,
    cell: { slug: 'fixture', instance: 'fixture' },
    retained: { admitted: { source: { runtime: {}, tiles: [{ lod: 0 }] } }, release: () => undefined },
    findShard: () => ({ clientPlanRuntime: true, load }), hasDeclaredClientPage: () => false,
    resolveRegionalRuntimeTextures: resolveTextures, regionalRuntimeAccountedBytes: accounted,
    GridCellWaitingError: Error, receiver: { page: { runtimePage: () => ({}) }, ports: { allocator: { cost: () => ({ input: {} }) } } },
  };
  const promise = (value: unknown): Promise<unknown> => {
    if (typeof value !== 'object' || value === null || typeof Reflect.get(value, 'then') !== 'function') throw new Error('Missing import promise');
    return Promise.resolve(value);
  };
  return { resolveTextures, accounted, select: (next: RegionalRuntimeTextures['mode']) => { mode = next; },
    admit: (metadata: boolean) => { const result: unknown = Reflect.apply(factory, undefined, [metadata, inputs]); return promise(result); },
    prepare: (admission: unknown) => {
      if (typeof admission !== 'object' || admission === null) throw new Error('Missing metadata admission');
      const prepare: unknown = Reflect.get(admission, 'prepareRuntime');
      if (typeof prepare !== 'function') throw new Error('Missing retained importer');
      const result: unknown = Reflect.apply(prepare, admission, []); return promise(result);
    } };
}

test('actual metadata admission exposes tiled capability before starting its retained importer', async () => {
  let finish = (): void => undefined;
  const gate = new Promise<void>(resolve => { finish = resolve; }), load = vi.fn(() => gate), f = fixture(load);
  const admission = await f.admit(true);
  expect(admission).toMatchObject({ tilePreparation: true, exclusiveRuntime: true }); expect(load).not.toHaveBeenCalled();
  const preparing = f.prepare(admission); expect(load).toHaveBeenCalledTimes(1);
  finish(); await preparing;
});

test('fresh construction still waits for the real importer before its owner can be created', async () => {
  let finish = (): void => undefined, settled = false;
  const gate = new Promise<void>(resolve => { finish = resolve; }), load = vi.fn(() => gate), f = fixture(load);
  const preparing = (async () => { try { return await f.admit(false); } finally { settled = true; } })();
  expect(load).toHaveBeenCalledTimes(1); await Promise.resolve(); expect(settled).toBe(false);
  finish(); expect(await preparing).toEqual({ fresh: true });
});

test('import refusal remains authoritative for both deferred metadata and fresh construction', async () => {
  const refused = new Error('Compiled entry refused'), f = fixture(() => Promise.reject(refused));
  const metadata = await f.admit(true);
  await expect(f.prepare(metadata)).rejects.toBe(refused);
  await expect(f.admit(false)).rejects.toBe(refused);
});


test('metadata and fresh construction keep one admitted texture choice when Auto changes', async () => {
  const f = fixture(() => Promise.resolve());
  const metadata = await f.admit(true);
  expect(metadata).toMatchObject({ bytes: 489909910 });
  f.select('ktx2');
  expect(await f.admit(false)).toEqual({ fresh: true });
  expect(f.resolveTextures).toHaveBeenCalledOnce();
  expect(f.accounted.mock.calls.map(call => call[2])).toEqual(['img', 'img']);
  expect(f.accounted.mock.results.map(result => {
    if (result.type !== 'return') throw new Error('Texture accounting refused');
    return result.value;
  })).toEqual([489909910, 489909910]);
  const next = fixture(() => Promise.resolve()); next.select('ktx2');
  expect(await next.admit(true)).toMatchObject({ bytes: 197073318 });
});
