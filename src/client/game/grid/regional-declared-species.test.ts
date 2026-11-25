import {expect, test, vi} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the tracked regional kit hook without a browser world.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Strip the hook's types while preserving its production code.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Controlled foundation and request ports isolate the entered kit.
import {runInNewContext} from 'node:vm';
import {Scope} from '@wildshard/engine/app/scope';
import {clientNativeBook} from '../shardfile/clientNativeBook';
import {declareNativePage, declarePageSpecies, nativeDeclaresOwnSpecies, pageDeclaresOwnSpecies, type DeclaredCreatureModels} from '../shardfile/declaredCreatures';
import type {ShardContext} from '../plugin/context';
import type {ShardFolder} from '../../../shared/game/shardfile/shardFolder';

// K6 (v0.1.56): Sunscar Dunes r5's declared bodies draw from their looks (OF19d1). Standalone its
// data client's kit registers the declared species (OF19d2); the grid's entered install never did, so `population.homes`
// refused ("Population requires its actual catalogue and saved page") and the cell stalled at finish on every phone.

const PAGE = {version: 1};
function product(kinds: readonly string[], spawns: readonly {species: string; variant: number}[] = [], runtime: object | null = null,
  {page = true, species = 0}: {page?: boolean; species?: number} = {}): ShardFolder {
  const shardfile = {runtime, questHost: page ? {page: PAGE} : null, creatures: {spawns}, rows: {species: Array.from({length: species}, (_, i) => ({id: `s${String(i)}`})), looks: []}};
  return {shardfile, has: (name: string): boolean => name === 'client/plan',
    section: (name: string): unknown => { if (name !== 'client/plan') throw new Error(`no ${name}`); return {version: 1, features: kinds.map(kind => ({kind}))}; }} as unknown as ShardFolder;
}
function entered(folder: ShardFolder): ShardContext {
  return {scope: new Scope('entered'), product: folder, game: {runtime: {hooks: {}}}, rows: {}} as unknown as ShardContext;
}

function kitHook(ports: {foundation: object; request: object; owner: {disposed: boolean}; declare: typeof declarePageSpecies; native?: typeof declareNativePage}): (context: ShardContext) => Promise<void> {
  const source = readFileSync(new URL('regionalRuntime.ts', import.meta.url), 'utf8');
  const start = source.indexOf('            kit: async entered =>');
  const end = source.indexOf('            afterKit: async entered =>', start);
  if (start === -1 || end === -1) throw new Error('Regional entered kit hook missing');
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(function(deps) {
    const {foundation, request, owner, declarePageSpecies, pageDeclaresOwnSpecies, declareNativePage, nativeDeclaresOwnSpecies} = deps;
    return {${source.slice(start, end)}}.kit;
  })`), {});
  if (typeof factory !== 'function') throw new Error('Regional entered kit hook missing');
  const hook: unknown = Reflect.apply(factory, undefined, [{...ports, declarePageSpecies: ports.declare, pageDeclaresOwnSpecies,
    declareNativePage: ports.native ?? declareNativePage, nativeDeclaresOwnSpecies}]);
  if (typeof hook !== 'function') throw new Error('Regional entered kit hook missing');
  return async (context) => { await Reflect.apply(hook, undefined, [context]); };
}

test('a declared page declares its own species (FORMAT-PRUNE FP20: no plan feature owns them)', () => {
  expect(pageDeclaresOwnSpecies(product(['quest.page', 'population.homes']))).toBe(true);
  expect(pageDeclaresOwnSpecies(product(['population.homes'], [], {}))).toBe(false); // a runtime page owns its own stages
});

test('the grid entered kit registers a declared-species page before population reads it', async () => {
  const folder = product(['quest.page', 'population.homes']), context = entered(folder);
  const load = vi.fn<(given: unknown) => Promise<DeclaredCreatureModels>>();
  const kit = kitHook({foundation: {declaredCreatures: load}, request: {admitted: {source: folder.shardfile}}, owner: {disposed: false}, declare: declarePageSpecies});
  expect(clientNativeBook(context).species).toBe(false);
  await kit(context);
  // the precondition installClientPopulation checks on this same entered context
  expect(clientNativeBook(context).species).toBe(true);
  expect(load).not.toHaveBeenCalled(); // no declared spawns: nothing to draw
});

test('the grid entered kit loads the declared bodies once it has spawns, on the entered context', async () => {
  const folder = product(['quest.page', 'population.homes'], [{species: 'duneRay', variant: 0}]), context = entered(folder);
  const models = {materials: new Map(), skins: new Map(), rigLooks: new Map(), attachmentModels: new Map(), recipes: new Map()} as unknown as DeclaredCreatureModels;
  const load = vi.fn((_given: unknown) => Promise.resolve(models));
  const declare = vi.fn<typeof declarePageSpecies>();
  const kit = kitHook({foundation: {declaredCreatures: load}, request: {admitted: {source: folder.shardfile}}, owner: {disposed: false}, declare});
  await kit(context);
  expect(load).toHaveBeenCalledWith(folder);
  expect(declare).toHaveBeenCalledTimes(1);
  const [given, source, read] = declare.mock.calls[0] ?? [];
  expect(given).toBe(context); expect(source).toBe(folder.shardfile); expect(read?.()).toBe(models);
});

test('a declared page without its presentation refuses', async () => {
  const declare = vi.fn<typeof declarePageSpecies>();
  const own = product(['population.homes']);
  await expect(kitHook({foundation: {}, request: {admitted: {source: own.shardfile}}, owner: {disposed: false}, declare})(entered(own)))
    .rejects.toThrow('Declared species page requires its regional presentation');
});

test('the entered kit stage runs the resident kit hook before the plan kit features', () => {
  const source = readFileSync(new URL('../shardfile/runtimePage.ts', import.meta.url), 'utf8');
  const hook = source.indexOf('await installation.kit?.(context);'), plan = source.indexOf("await runtimeClientPhase(context, 'kit', resident.scope);");
  expect(hook).toBeGreaterThan(-1); expect(plan).toBeGreaterThan(hook);
});

// K4 (v0.1.67 local): Pine r10 is a native page whose species are its declared rows (OF23e4). Standalone its client declares its rows; on the grid nobody did, and its deep link stopped at finish on
// "unknown animal kind 'deer' (registered: boar, bear)".
test('a native page with declared species and no species owner declares its own', () => {
  const spawn = [{species: 's0', variant: 0}];
  expect(nativeDeclaresOwnSpecies(product(['world.forest-page'], spawn, {}, {page: false, species: 1}))).toBe(true);
  expect(nativeDeclaresOwnSpecies(product([], [], {}, {page: false, species: 1}))).toBe(false);
  expect(nativeDeclaresOwnSpecies(product([], spawn, null, {species: 1}))).toBe(false); // a data page: pageDeclaresOwnSpecies
});

test('the grid entered kit declares a native page\'s own species with its loaded bodies', async () => {
  const folder = product(['world.forest-page'], [{species: 's0', variant: 0}], {}, {page: false, species: 1}), context = entered(folder);
  const models = {materials: new Map()} as unknown as DeclaredCreatureModels;
  const load = vi.fn((_given: unknown) => Promise.resolve(models));
  const declare = vi.fn<typeof declarePageSpecies>(), native = vi.fn<typeof declareNativePage>(() => Promise.resolve());
  await kitHook({foundation: {declaredCreatures: load}, request: {admitted: {source: folder.shardfile}}, owner: {disposed: false}, declare, native})(context);
  expect(load).toHaveBeenCalledWith(folder);
  expect(native).toHaveBeenCalledWith(context, folder.shardfile, models);
  expect(declare).not.toHaveBeenCalled();
  await expect(kitHook({foundation: {}, request: {admitted: {source: folder.shardfile}}, owner: {disposed: false}, declare, native})(entered(folder)))
    .rejects.toThrow('Declared native species require their regional presentation');
});
