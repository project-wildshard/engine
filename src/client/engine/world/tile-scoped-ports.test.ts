import { expect, test } from 'vitest';
import { disposalErrorMessages, Scope } from '../../../shared/engine/app/scope';
import { scopedTilePorts, type RingTile } from './tileStreamer';

interface Prepared { readonly scope: Scope; readonly value: string }
const tile: RingTile = { key: 'level:l0/0/0', instance: 'level', type: 'level', level: 'l0', x: 0, z: 0 };
function refusal(result: Prepared | Error): string {
  if (!(result instanceof Error)) throw new Error('Expected refused preparation');
  return result.message;
}
function fixture() {
  const owner = new Scope('render-owner'), live = new Set<Scope>(), masks: ReadonlySet<number>[] = [], shadows: boolean[] = [];
  const waiting: { readonly scope: Scope; readonly finish: () => void }[] = [];
  let resources = 0;
  const ports = scopedTilePorts(owner, async (current, scope): Promise<Prepared> => {
    resources++; scope.own({ dispose: () => { resources--; } });
    await new Promise<void>(resolve => { waiting.push({ scope, finish: resolve }); });
    return { scope, value: current.key };
  }, (_current, prepared) => {
    live.add(prepared.scope); prepared.scope.onDispose(() => { live.delete(prepared.scope); });
    return { mask: excluded => { masks.push(excluded); }, shadow: enabled => { shadows.push(enabled); } };
  });
  const start = (current = tile) => {
    const result = new Promise<Prepared | Error>(resolve => { ports.fetch(current, resolve); });
    const work = waiting.shift(); if (work === undefined) throw new Error('Missing tile preparation');
    return { ...work, result };
  };
  return { owner, ports, live, masks, shadows, start, resources: () => resources };
}

test('prepared content stays detached until upload and all handles borrow the original scope', async () => {
  const f = fixture(), baseline = f.owner.census;
  try {
    const work = f.start(); expect(f.resources()).toBe(1); expect(f.live.size).toBe(0);
    // Knowing the construction scope is not permission to publish an unfinished result.
    expect(() => f.ports.upload(tile, { scope: work.scope, value: tile.key })).toThrow('not awaiting publication');
    work.finish(); const prepared = await work.result; if (prepared instanceof Error) throw prepared;
    expect(prepared.scope).toBe(work.scope); expect(f.live.size).toBe(0);
    const view = f.ports.upload(tile, prepared); expect(f.live.has(work.scope)).toBe(true);
    view.mask(new Set([1, 3])); view.shadow(true);
    expect(f.masks).toEqual([new Set([1, 3])]); expect(f.shadows).toEqual([true]);
    expect(() => f.ports.upload(tile, prepared)).toThrow('not awaiting publication');
    view.dispose(); view.dispose(); expect(f.live.size).toBe(0); expect(f.resources()).toBe(0);
    expect(f.owner.census).toEqual(baseline);
  } finally { f.owner.dispose(); }
});

test('twenty cancelled constructions retire immediately before their late completions', async () => {
  const f = fixture(), baseline = f.owner.census;
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      const work = f.start(); expect(f.resources()).toBe(1);
      f.ports.cancel?.(tile); expect(work.scope.disposed).toBe(true);
      expect(f.resources()).toBe(0); expect(f.owner.census).toEqual(baseline);
      work.finish(); expect(await work.result).toBeInstanceOf(Error); expect(f.live.size).toBe(0);
    }
  } finally { f.owner.dispose(); }
});

test('duplicate keys refuse and late old completions cannot retire the replacement', async () => {
  const f = fixture();
  try {
    const old = f.start();
    const duplicate = await new Promise<Prepared | Error>(resolve => { f.ports.fetch(tile, resolve); });
    expect(refusal(duplicate)).toContain('already preparing');
    expect(f.resources()).toBe(1);
    f.ports.cancel?.(tile); const next = f.start();
    old.finish(); expect(await old.result).toBeInstanceOf(Error);
    expect(next.scope.disposed).toBe(false); expect(f.resources()).toBe(1);
    next.finish(); const prepared = await next.result; if (prepared instanceof Error) throw prepared;
    const view = f.ports.upload(tile, prepared); view.dispose(); expect(f.resources()).toBe(0);
  } finally { f.owner.dispose(); }
});

test('discarding an old prepared value leaves its same-key replacement intact', async () => {
  const f = fixture();
  try {
    const old = f.start(); old.finish(); const prepared = await old.result; if (prepared instanceof Error) throw prepared;
    f.ports.cancel?.(tile); const next = f.start();
    f.ports.discard?.(tile, prepared); expect(next.scope.disposed).toBe(false);
    next.finish(); const replacement = await next.result; if (replacement instanceof Error) throw replacement;
    const view = f.ports.upload(tile, replacement); expect(f.live.size).toBe(1);
    f.ports.cancel?.(tile); expect(f.live.size).toBe(0); expect(f.resources()).toBe(0); view.dispose();
  } finally { f.owner.dispose(); }
});

test('independent owners and content kinds cannot cancel one another', async () => {
  const level = fixture(), road = fixture(), roadTile: RingTile = { ...tile, type: 'road' };
  try {
    const first = level.start(), second = road.start(roadTile);
    level.owner.dispose(); expect(first.scope.disposed).toBe(true); expect(second.scope.disposed).toBe(false);
    first.finish(); expect(await first.result).toBeInstanceOf(Error);
    second.finish(); const prepared = await second.result; if (prepared instanceof Error) throw prepared;
    const view = road.ports.upload(roadTile, prepared); expect(road.live.size).toBe(1);
    road.owner.dispose(); expect(road.live.size).toBe(0); expect(road.resources()).toBe(0); view.dispose();
  } finally { level.owner.dispose(); road.owner.dispose(); }
});

test.each(['prepare', 'publish'] as const)('%s failure closes the original construction scope', async phase => {
  const owner = new Scope('failed-render'), baseline = owner.census;
  let resources = 0;
  const ports = scopedTilePorts<Prepared>(owner, (_current, scope) => {
    resources++; scope.own({ dispose: () => { resources--; } });
    return phase === 'prepare' ? Promise.reject(new Error('Preparation failed')) : Promise.resolve({ scope, value: tile.key });
  }, () => { throw new Error('Publication failed'); });
  try {
    const result = await new Promise<Prepared | Error>(resolve => { ports.fetch(tile, resolve); });
    if (phase === 'prepare') expect(result).toMatchObject({ message: 'Preparation failed' });
    else { if (result instanceof Error) throw result; expect(() => ports.upload(tile, result)).toThrow('Publication failed'); }
    expect(resources).toBe(0); expect(owner.census).toEqual(baseline);
  } finally { owner.dispose(); }
});

test('a changed scope refuses without disposing the foreign owner', async () => {
  const owner = new Scope('original'), foreign = new Scope('foreign'), baseline = owner.census;
  const ports = scopedTilePorts(owner, () => Promise.resolve({ scope: foreign, value: tile.key }), () => { throw new Error('No publication expected'); });
  try {
    const result = await new Promise<Prepared | Error>(resolve => { ports.fetch(tile, resolve); });
    expect(refusal(result)).toContain('changed its scope');
    expect(owner.census).toEqual(baseline); expect(foreign.disposed).toBe(false);
  } finally { owner.dispose(); foreign.dispose(); }
});

test('work and cleanup failures both survive the asynchronous result', async () => {
  const owner = new Scope('cleanup-failure');
  const ports = scopedTilePorts<Prepared>(owner, (_current, scope) => {
    scope.onDispose(() => { throw new Error('Cleanup failed'); });
    return Promise.reject(new Error('Preparation failed'));
  }, () => { throw new Error('No publication expected'); });
  try {
    const result = await new Promise<Prepared | Error>(resolve => { ports.fetch(tile, resolve); });
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) throw new Error('Missing combined failures');
    expect(disposalErrorMessages(result)).toEqual(['Preparation failed', 'Cleanup failed']);
  } finally { owner.dispose(); }
});

test('a retired owner refuses new work before construction', async () => {
  const f = fixture(); f.owner.dispose();
  const result = await new Promise<Prepared | Error>(resolve => { f.ports.fetch(tile, resolve); });
  expect(refusal(result)).toContain('owner left');
  expect(f.resources()).toBe(0);
});

test('published mask and shadow methods retain their native receiver', async () => {
  const owner = new Scope('native-view');
  const native = { count: 0, enabled: false,
    mask(excluded: ReadonlySet<number>): void { this.count = excluded.size; },
    shadow(enabled: boolean): void { this.enabled = enabled; },
  };
  const ports = scopedTilePorts(owner, (_current, scope) => Promise.resolve({ scope, value: tile.key }), () => native);
  try {
    const prepared = await new Promise<Prepared | Error>(resolve => { ports.fetch(tile, resolve); });
    if (prepared instanceof Error) throw prepared;
    const view = ports.upload(tile, prepared); view.mask(new Set([0, 1])); view.shadow(true);
    expect(native.count).toBe(2); expect(native.enabled).toBe(true); view.dispose();
  } finally { owner.dispose(); }
});
