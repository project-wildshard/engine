import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { Flags } from '../src/shared/engine/world/interact/flags';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import type { QuestPageComposition } from '../src/client/game/quest/pageComposition';
import { QuestPageReference } from '../src/client/game/quest/pageReference';
import { FolderFigureCatalogue } from '../src/client/game/models/figureCatalogue';
import { fixedDraws } from '../src/client/game/models/fixedDraws';
import { SceneHandles } from '../src/client/game/shardfile/sceneHandles';
import { publishEntryOwner, lendEntryOwner, entryOwner } from '../src/shared/game/shardfile/entryOwners';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { fixtureFolderFile, fixtureJsonCheck } from './fixtures/folderFile';
import { installEntryQuestComposition, installEntryQuestReference } from '../src/client/game/shardfile/clientQuestComposition';
import * as composition from '../src/client/game/quest/pageComposition';
import * as enteredFigures from '../src/client/game/quest/figures';
import * as worldScenes from '../src/client/game/shardfile/worldScenes';
import { bindResidentWorldScope } from '../src/client/game/shardfile/hybridPresentation';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const row: Extract<ClientFeatureRow, { kind: 'quest.composition' }> = { kind: 'quest.composition', id: 'orchard.quest',
  file: 'quest.json', reference: 'orchard.reference', figures: { file: 'figures.json', draws: 'orchard.draws' } };
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
function deferred<T>() {
  let release: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, resolve(value: T): void { if (release === undefined) throw new Error('Missing resolver'); release(value); } };
}
function fixture(readOverride?: (name: string) => Promise<Uint8Array>) {
  const resident = new Scope('orchard-resident'), scope = resident.child('orchard-entered'), reads: string[] = [];
  const shardfile = emptyShardfile({ slug: 'orchard', name: 'Orchard', author: 'Fixture', revision: 1, seed: 1 });
  const files = new Map(['quest.json', 'figures.json', 'people/catalogue.json', 'models/world-scenes.json'].map(name => [name, fixtureFolderFile(name, { hash: name, url: name })]));
  const product = createShardFolder({ slug: 'orchard', revision: 1, shardfile, sections: new Map([['world/scenes', {}]]), files, jsonCheck: fixtureJsonCheck,
    read: name => { reads.push(name); if (readOverride !== undefined) return readOverride(name);
      return Promise.resolve(bytes(name === 'quest.json' ? { id: row.id } : name === 'models/world-scenes.json' ? { product: 'orchard', models: [] } : { figures: [] })); } });
  // These two composition projections feed mocked host builders below;
  // preserve their byte/retirement schedule while real books stay admitted.
  const named = product.json.bind(product);
  vi.spyOn(product, 'json').mockImplementation(async name => {
    if (name !== row.file && name !== row.figures?.file) return named(name);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await product.file(name)));
    return value;
  });
  const draws = fixedDraws(product, [{ slot: 'original', file: 'original.glb', channels: [] }]);
  const hooks = {}, ctx = legacyDouble<ShardContext>({ scope, product, game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<ShardRuntime>({ hooks }) }) });
  bindResidentWorldScope(scope, resident);
  publishEntryOwner(resident, 'fixed-draws', 'orchard.draws', draws);
  const reference = new QuestPageReference(scope);
  publishEntryOwner(scope, 'quest-reference', 'orchard.reference', reference);
  return { resident, scope, ctx, reads, draws, reference, hooks };
}
function quest(): QuestPageComposition {
  return { flags: new Flags('orchard', false), places: null, content: null, kit: legacyDouble<QuestPageComposition['kit']>({}),
    spine: null, finale: null, ecology: null, complete: null, zipline: null, trader: null,
    place: p => ({ x: p.x, z: p.z, y: p.y ?? 0, yaw: p.yaw ?? 0 }), floorAt: () => 0, setAnchor: () => undefined,
    facets: { achievements: null, people: [], cable: null, motion: null, director: null, board: null, shop: null, pages: new Map() } };
}

test('the compiled figures step uses one preparation and original loans before publishing the quest', async () => {
  const f = fixture(), order: string[] = [], adventure = quest(), catalogue = new FolderFigureCatalogue('orchard', 'people/catalogue.json');
  lendEntryOwner(f.scope, f.resident, 'fixed-draws', 'orchard.draws');
  const prepare = vi.spyOn(composition, 'prepareQuestPageComposition').mockImplementation(() => { order.push('prepare');
    return Promise.resolve({ place: p => ({ x: p.x, z: p.z, y: p.y ?? 0, yaw: p.yaw ?? 0 }), floorAt: () => 0, setAnchor: () => undefined }); });
  const install = vi.spyOn(composition, 'installQuestPageComposition').mockImplementation(() => { order.push('install'); return Promise.resolve(adventure); });
  const book = vi.spyOn(FolderFigureCatalogue, 'fromFolder').mockResolvedValue(catalogue);
  const scenes = vi.spyOn(worldScenes, 'installWorldScenes').mockResolvedValue(new SceneHandles());
  const figures = vi.spyOn(enteredFigures, 'installQuestFigures').mockImplementation((_ctx, _input, ports) => {
    order.push('figures'); expect(ports?.draws).toBe(f.draws); expect(ports?.catalogue).toBe(catalogue); return [];
  });
  try {
    await installEntryQuestComposition(f.ctx, row);
    expect(order).toEqual(['prepare', 'figures', 'install']); expect(prepare).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledWith(f.ctx.product, 'people/catalogue.json', f.resident);
    expect(entryOwner(f.scope, 'quest', row.id)).toBe(adventure);
    expect(() => entryOwner(f.scope, 'animals', 'unused.animals')).toThrow('Missing live');
    expect(f.draws.ready).toBe(false);
  } finally { f.resident.dispose(); prepare.mockRestore(); install.mockRestore(); book.mockRestore(); scenes.mockRestore(); figures.mockRestore(); }
});

test('a missing fixed-draw loan refuses before reading or preparing the composition', async () => {
  const f = fixture();
  try { await expect(installEntryQuestComposition(f.ctx, row)).rejects.toThrow('Missing live entry owner: fixed-draws'); expect(f.reads).toEqual([]); }
  finally { f.resident.dispose(); }
});

test('leaving during the figures read prevents preparation or live rig construction', async () => {
  const pending = deferred<Uint8Array>(), reached = deferred<string>();
  const f = fixture(name => {
    if (name === 'figures.json') { reached.resolve(name); return pending.promise; }
    return Promise.resolve(bytes({ id: row.id }));
  });
  lendEntryOwner(f.scope, f.resident, 'fixed-draws', 'orchard.draws');
  const prepare = vi.spyOn(composition, 'prepareQuestPageComposition'), figures = vi.spyOn(enteredFigures, 'installQuestFigures');
  try {
    const work = installEntryQuestComposition(f.ctx, row); expect(await reached.promise).toBe('figures.json');
    f.scope.dispose(); pending.resolve(bytes({ figures: [] }));
    await expect(work).rejects.toThrow('Entry left');
    expect(prepare).not.toHaveBeenCalled(); expect(figures).not.toHaveBeenCalled();
    expect(f.reads).toEqual(['quest.json', 'figures.json']);
  } finally { f.resident.dispose(); prepare.mockRestore(); figures.mockRestore(); }
});

test('the world reference publishes a scoped stable hook before a composition exists', () => {
  const scope = new Scope('reference-world'), hooks = {}, ctx = legacyDouble<ShardContext>({ scope,
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<ShardRuntime>({ hooks }) }) });
  try {
    installEntryQuestReference(ctx, 'orchard.reference');
    expect(entryOwner(scope, 'quest-reference', 'orchard.reference').places()).toEqual([]);
    expect(Reflect.get(hooks, 'places')).toBe(entryOwner(scope, 'quest-reference', 'orchard.reference').places);
    scope.dispose(); expect(Reflect.get(hooks, 'places')).toBeUndefined();
  } finally { scope.dispose(); }
});
