import { beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { installAssetTables } from '@wildshard/engine/boot/tables';
import type { ShardContext } from './context';
import type { ForestPage } from '../shardfile/forestPage';
import type { CaveInterior } from '../shardfile/caveInterior';
import { publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { FOREST_PAGE_PORTS, enterClientForestPage, installClientForestPage, installClientForestWeather, installClientPageLife, type ForestPagePorts } from '../shardfile/clientForestPage';

beforeAll(() => {
  // This owner-only fixture supplies water ports and declares no common bake files.
  installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} });
});

// sp-x8 QX on G571's forest page features: every installer stops when its owner retires (it left during an awaited read,
// or an ancestor is retiring in slices), and borrows its owners only after a read.
type Ranged = ReturnType<ForestPagePorts['rangedPage']>;
type Life = Awaited<ReturnType<ForestPagePorts['installPageLife']>>;
type Library = Awaited<ReturnType<ForestPagePorts['library']>>;

function fixture(hold: (file: string) => boolean) {
  const parent = new Scope('forest.parent'), scope = new Scope('forest.entered', parent), waiting: (() => void)[] = [];
  const calls = { looks: 0, library: 0, page: 0, cave: 0, weather: 0, life: 0, spots: 0, registered: 0 };
  const json = <T>(file: string): Promise<T> => new Promise<T>(resolve => {
    const value = { id: 'fixture.forest' } as T;
    if (hold(file)) waiting.push(() => { resolve(value); }); else resolve(value);
  });
  // stand-ins: typed empty owners filled with just what the installers read
  const ambience = {} as Ranged['ambience'], ranged = {} as Ranged, page = {} as ForestPage, rows = {} as ForestPage['rows'], library = {} as Library;
  Object.assign(ambience, { addSpot: () => { calls.spots++; } }); Object.assign(ranged, { compendium: null, ambience });
  Object.assign(rows, { id: 'fixture.forest' }); Object.assign(page, { rows, finish: () => Promise.resolve(), update: () => undefined });
  Object.assign(library, { name: 'wildlife' });
  const ports: ForestPagePorts = { ...FOREST_PAGE_PORTS, preloadWaterRipples: () => Promise.resolve(),
    prepareForestPageLooks: () => { calls.looks++; return Promise.resolve(); }, bindPageWater: () => undefined, preparePageWater: () => Promise.resolve(),
    library: () => { calls.library++; return Promise.resolve(library); },
    runtimeLookMaterials: () => Promise.resolve({} as Awaited<ReturnType<ForestPagePorts['runtimeLookMaterials']>>), lendLooks: () => undefined,
    prepareForestPage: () => { calls.page++; return Promise.resolve(page); }, placeForestPageModels: () => Promise.resolve(),
    loadCave: () => { calls.cave++; return Promise.reject(new Error('the cave must not load')); },
    installForestWeather: () => { calls.weather++; return Promise.resolve(null); },
    installPageLife: () => { calls.life++; return Promise.resolve({} as Life); },
    rangedPage: () => ranged, publishEntryOwner: () => undefined,
  };
  const runtime = { world: { registry: { add: () => { calls.registered++; } }, sky: {} }, hooks: {}, objects: {} };
  const product = {} as ShardContext['product'], game = {} as ShardContext['game'], ctx = {} as ShardContext;
  Object.assign(product, { json }); Object.assign(game, { runtime }); Object.assign(ctx, { scope, product, game });
  return { parent, scope, ctx, ports, calls, runtime, release: () => { for (const go of waiting.splice(0)) go(); } };
}
type Fixture = ReturnType<typeof fixture>;
/** Leave the entered scope, or start its ancestor's sliced retirement (the child is then disposing, not yet disposed). */
function retire(f: Fixture, ancestor: boolean): Generator | undefined {
  if (!ancestor) { f.scope.dispose(); return undefined; }
  f.parent.onDispose(() => undefined);
  const steps = f.parent.disposeSteps(); steps.next();
  expect(f.scope.disposed).toBe(false); expect(f.scope.disposing).toBe(true);
  return steps;
}
const drain = (f: Fixture, steps: Generator | undefined): void => { if (steps !== undefined) for (const _step of steps) { /* drain */ } f.parent.dispose(); };
const row = { kind: 'world.forest-page', file: 'world/forest-page.json', cave: { file: 'world/cave-interior.json', cap: { shard: null, grid: null }, spots: { ranged: 'pine.ranged', zone: 'cave', fade: 3, max: 4 } } } as const;
const life = { kind: 'page.life', file: 'actors/page-life.json', ranged: 'pine.ranged', object: 'pineLife' } as const;

test.each([false, true])('leaving during the page read builds nothing (ancestor %s)', async ancestor => {
  const f = fixture(file => file === row.file), run = installClientForestPage(f.ctx, row, f.ports);
  const steps = retire(f, ancestor); f.release(); await run;
  expect([f.calls.looks, f.calls.library, f.calls.page, f.calls.cave]).toEqual([0, 0, 0, 0]);
  drain(f, steps);
});

test.each([false, true])('leaving during the cave read loads no cave and registers nothing (ancestor %s)', async ancestor => {
  const f = fixture(file => file === row.cave.file), run = installClientForestPage(f.ctx, row, f.ports);
  await vi.waitFor(() => { expect(f.calls.page).toBe(1); });
  const steps = retire(f, ancestor); f.release(); await run;
  expect([f.calls.cave, f.calls.registered]).toEqual([0, 0]); expect(f.runtime.hooks).toEqual({});
  drain(f, steps);
});

test.each([false, true])('the cave spots, weather and life stop after a retiring read (ancestor %s)', async ancestor => {
  const f = fixture(() => true);
  const runs = [enterClientForestPage(f.ctx, row, f.ports), installClientForestWeather(f.ctx, 'world/forest-weather.json', f.ports), installClientPageLife(f.ctx, life, f.ports)];
  const steps = retire(f, ancestor); f.release(); await Promise.all(runs);
  expect([f.calls.spots, f.calls.weather, f.calls.life]).toEqual([0, 0, 0]); expect(f.runtime.objects).toEqual({});
  drain(f, steps);
});

test('a live owner still gets its spots, weather and life, and a replaced ranged page publishes no life', async () => {
  const f = fixture(() => false);
  const cave = {} as CaveInterior; Object.assign(cave, { spots: () => [{ x: 0, z: 0, r: 1 }] });
  publishEntryOwner(f.scope, 'cave', 'fixture.forest', cave);
  await enterClientForestPage(f.ctx, row, f.ports); await installClientForestWeather(f.ctx, 'world/forest-weather.json', f.ports);
  await installClientPageLife(f.ctx, life, f.ports);
  expect([f.calls.spots, f.calls.weather, f.calls.life]).toEqual([1, 1, 1]); expect(Object.keys(f.runtime.objects)).toEqual(['pineLife']);
  let first = true; const other = { ...f.ports.rangedPage(f.scope, 'pine.ranged') };
  const swapping: ForestPagePorts = { ...f.ports, rangedPage: () => { const page = first ? f.ports.rangedPage(f.scope, 'pine.ranged') : other; first = false; return page; } };
  const g = fixture(() => false); await installClientPageLife(g.ctx, life, swapping);
  expect(g.runtime.objects).toEqual({});
  f.parent.dispose(); g.parent.dispose();
});
