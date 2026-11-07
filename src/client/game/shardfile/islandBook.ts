/** A finite product book, shared by entered construction and Explorer readers.
 * Admission performs no reads or allocations. Native ownership is supplied by
 * the caller that later loads the book, never a parked page scope. */
import * as v from 'valibot';
import { parseClientPlan, type ClientFeatureRow } from '@wildshard/format/clientPlan';
import { WorldAssemblySchema } from '@wildshard/format/worldAssembly';
import { resourceScope } from '@wildshard/engine/app/resources';
import type { IslandLibrary } from '../models/islandLibrary';
import { ResolvedIslandLibrarySchema } from '@wildshard/format/islandLibrary';
import type { defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

type AssemblyRow = Extract<ClientFeatureRow, { kind: 'world.assembly' }>;
const books = new WeakMap<ShardProduct, Map<string, {
  readonly root: unknown; readonly row: string;
  readonly pending: Promise<{ readonly library: IslandLibrary<unknown>; readonly sites: ReturnType<typeof defineWorldSceneCatalogue> }>;
}>>();

/** Whole-plan preflight; only already-admitted section values and file names. */
export function preflightIslandBook(product: ShardProduct, row: AssemblyRow): void {
  const assembly = v.parse(WorldAssemblySchema, row.rows), construction = assembly.construction;
  if (row.native !== undefined) {
    if (construction?.prelude === undefined || construction.progress.kind !== 'checkpoints' || construction.root !== undefined || construction.cells !== undefined || construction.publish !== undefined) throw new Error('Native assembly requires its original prelude and checkpoints');
    const files = [construction.prelude.draws, ...assembly.stages.flatMap(stage => stage.kind === 'arena-room' ? 'mode' in stage ? [stage.file] : [stage.files.fight, stage.files.geometry] : [])];
    if (files.some(file => !product.hasFile(file))) throw new Error('Native assembly names no admitted product file');
    return;
  }
  if (construction?.looks === undefined) throw new Error('World assembly requires construction looks');
  for (const look of [...construction.looks.unbound, ...construction.looks.bound]) {
    if (product.shardfile.look.materials[look] === undefined) throw new Error(`World assembly names no look: ${look}`);
  }
  if (row.entered !== undefined) {
    const blocks = product.section('world/scenes').entry?.blocks;
    if (construction.root?.id !== row.entered.root || blocks === undefined || row.entered.blocks.some(id => blocks[id] === undefined || blocks[id].length === 0 || blocks[id].some(step => step.kind !== 'piece'))) throw new Error('Entered assembly requires its declared root and piece-only blocks');
  }
  if (row.library === undefined) {
    if (row.catalogue !== undefined || construction.root === undefined || construction.publish !== undefined || construction.cells !== undefined) throw new Error('Scene assembly requires its root without a library publication or cells');
    if (assembly.stages.some(stage => stage.kind === 'site' || stage.kind === 'rope-deck' || stage.kind === 'rope-chain' || stage.kind === 'ambient-flock' || stage.kind === 'streamed-cover' || stage.kind === 'arena-room')) throw new Error('Scene assembly cannot construct a library or native encounter stage');
    if (assembly.stages.some(stage => stage.kind === 'entry' && stage.rows.some(step => step.kind === 'piece' && step.active !== undefined))) throw new Error('Active pieces require their separate entered binding');
    return;
  }
  if (row.catalogue === undefined) throw new Error('Island book requires its catalogue');
  const book = v.parse(ResolvedIslandLibrarySchema, product.section('models/island-library'));
  if (book.id !== row.library || product.section('world/scenes').catalogue !== row.catalogue) throw new Error('Island book identity or catalogue differs');
  if (construction.publish === undefined) throw new Error('Island entry requires construction looks and publications');
  if (new Set(book.draws.map(draw => draw.slot)).size !== book.draws.length) throw new Error('Repeated island fixed draw slot');
  const slots = new Set(book.draws.map(draw => draw.slot));
  if (Object.values(book.collections).some(slot => !slots.has(slot))) throw new Error('Island collection names an undeclared draw');
  for (const name of [book.groups, book.figures, row.catalogue, ...book.draws.flatMap(draw => 'file' in draw ? [draw.file] : [])]) {
    if (!product.hasFile(name)) throw new Error(`Island book names no product file: ${name}`);
  }
}

/** Resolve the same declared product/id record for either entry order. This
 * uses only the pure plan parser, never recursive whole-plan admission. */
export async function admittedIslandBook(product: ShardProduct, id: string): Promise<{
  readonly library: IslandLibrary<unknown>; readonly sites: ReturnType<typeof defineWorldSceneCatalogue>;
}> {
  const owner = resourceScope();
  const live = (): void => { if (owner.disposed || owner.disposing) throw new Error('Island book caller left'); };
  live();
  const matching = parseClientPlan(product.section('client/plan')).features.filter((row): row is AssemblyRow => row.kind === 'world.assembly' && row.library === id);
  const [row] = matching;
  if (row?.catalogue === undefined || matching.length !== 1) throw new Error('Island book requires one matching assembly');
  preflightIslandBook(product, row);
  const root = product.section('models/island-library'), recipe = JSON.stringify(row);
  let byId = books.get(product);
  if (byId === undefined) { byId = new Map(); books.set(product, byId); }
  let record = byId.get(id);
  if (record !== undefined && (record.root !== root || record.row !== recipe)) throw new Error('Island book declaration changed');
  if (record === undefined) {
    const catalogue = row.catalogue;
    const pending = (async () => {
      const [{ IslandLibrary }, { defineWorldSceneCatalogue }] = await Promise.all([import('../models/islandLibrary'), import('../models/worldSceneCatalogue')]);
      live();
      if (product.section('models/island-library') !== root) throw new Error('Island book declaration changed during module read');
      const library = new IslandLibrary<unknown>(root, product);
      return product.json<unknown>(catalogue).then(input => ({ library, sites: defineWorldSceneCatalogue(input, product) }));
    })();
    record = { root, row: recipe, pending }; byId.set(id, record);
    const current = record, inventory = byId;
    void pending.catch(() => { if (inventory.get(id) === current) inventory.delete(id); });
  }
  const value = await record.pending; live();
  if (product.section('models/island-library') !== root) throw new Error('Island book declaration changed during read');
  return value;
}
