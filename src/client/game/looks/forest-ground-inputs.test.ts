import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';
import type { WholeGeometryView } from '../plugin/geometry';
import type { CoverAppearance } from './coverAppearance';
import { readForestGroundInputs } from './forestGroundInputs';

function deferred<T>() {
  let finish: (value: T) => void = () => undefined;
  let fail: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, finish, fail };
}
const rows = { appearance: 'cover.json', layout: 'placements.json', sources: ['ground.glb'] };

function fixture() {
  const scope = new Scope('ground.inputs'), calls: string[] = [];
  const appearance = deferred<CoverAppearance>(), layout = deferred<unknown>(), geometry = deferred<Map<string, WholeGeometryView>>();
  const product = {} as ShardContext['product'];
  Object.assign(product, { shardfile: {}, json: (file: string) => { calls.push(file); return layout.promise; } });
  const ports = {
    appearance: (value: ShardContext['product'], file: string) => { expect(value).toBe(product); calls.push(file); return appearance.promise; },
    geometry: (owner: Scope, source: unknown, files?: readonly string[]) => {
      expect(owner).toBe(scope); expect(source).toBe(product.shardfile); expect(files).toBe(rows.sources);
      calls.push('geometry'); return geometry.promise;
    },
  };
  return { scope, product, calls, appearance, layout, geometry, ports };
}

test('starts all independent reads before waiting and keeps exact scope/input identities', async () => {
  const f = fixture(), run = readForestGroundInputs(f, rows, f.ports);
  expect(f.calls).toEqual(['cover.json', 'placements.json', 'geometry']);
  const appearance = {} as CoverAppearance, layout = { kinds: [] }, geometry = new Map<string, WholeGeometryView>();
  f.geometry.finish(geometry); f.layout.finish(layout); f.appearance.finish(appearance);
  const result = await run;
  expect(result).toEqual([{ status: 'fulfilled', value: appearance }, { status: 'fulfilled', value: layout }, { status: 'fulfilled', value: geometry }]);
  f.scope.dispose();
});

test('drains successful and failed work and retains failures in original consumption order', async () => {
  const f = fixture(), first = new Error('appearance'), second = new Error('layout'), third = new Error('geometry');
  let completed = false;
  const run = readForestGroundInputs(f, rows, f.ports).then(result => { completed = true; return result; });
  f.geometry.fail(third); f.appearance.fail(first);
  await Promise.resolve(); await Promise.resolve();
  expect(completed).toBe(false);
  f.layout.fail(second);
  expect(await run).toEqual([{ status: 'rejected', reason: first }, { status: 'rejected', reason: second }, { status: 'rejected', reason: third }]);
  f.scope.dispose();
});

test.each([false, true])('retired owner starts no read (sliced %s)', async sliced => {
  const f = fixture();
  f.scope.onDispose(() => undefined);
  const steps = sliced ? f.scope.disposeSteps() : undefined;
  if (steps === undefined) f.scope.dispose(); else steps.next();
  await expect(readForestGroundInputs(f, rows, f.ports)).rejects.toThrow('Forest ground owner is retired');
  expect(f.calls).toEqual([]);
  if (steps !== undefined) for (const _step of steps) { /* finish retirement */ }
});

test('retirement drains late inputs before refusing the prepared result', async () => {
  const f = fixture(), geometry = new Map<string, WholeGeometryView>();
  let completed = false;
  const run = readForestGroundInputs(f, rows, f.ports).finally(() => { completed = true; });
  // Install the rejection observer before retirement: a failed preparation is
  // expected, and no late input is allowed to escape its drain.
  const refused = expect(run).rejects.toThrow('Forest ground owner is retired');
  f.geometry.finish(geometry); f.scope.dispose(); f.layout.finish({});
  await Promise.resolve(); await Promise.resolve(); expect(completed).toBe(false);
  f.appearance.finish({} as CoverAppearance);
  await refused;
});
