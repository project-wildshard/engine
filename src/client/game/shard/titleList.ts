import type { ShardManifest } from './manifest';
import { shards } from './list';
import { bareSlug, installedCatalogue } from '../../../shared/game/grid/catalogueSlot';

/** Cold-title metadata contains no executable shard bindings. */
export type TitleManifest = Pick<ShardManifest, 'slug' | 'name' | 'biome' | 'status' | 'card' | 'shardSelect' | 'shardfile' | 'gridShardfile'> & Pick<Partial<ShardManifest>, 'order' | 'bag'> & {
  /** Where this shard's discovery document is served (C3); a shard with none enters on another row's page. */
  readonly discovery?: string;
};
type TitleSource = TitleManifest & { readonly load?: unknown };
/** Copy the scalar title fields, never executable bindings. */
export function titleMetadata(row: TitleSource): TitleManifest {
  const { slug, name, biome, status, card, shardSelect, shardfile, gridShardfile, order, bag, discovery } = row;
  return { slug, name, biome, status, card, ...(order === undefined ? {} : {order}), ...(bag === undefined ? {} : {bag}), ...(discovery === undefined ? {} : {discovery}),
    ...(shardSelect === undefined ? {} : { shardSelect }), ...(shardfile === undefined ? {} : { shardfile }),
    ...(gridShardfile === undefined ? {} : { gridShardfile }) };
}
let title: readonly TitleManifest[] | null = null;
const worldRows = new WeakMap<readonly ShardManifest[], readonly TitleManifest[]>();
const indexes = new WeakMap<readonly TitleManifest[], ReadonlyMap<string, TitleManifest>>();
const isRows = (value: unknown): value is readonly TitleManifest[] => Array.isArray(value);
/** C3: the title's rows, inlined in the document by the build and by each shard the catalogue added after it. A page with none
 *  (a shell, a source document) lists what the catalogue names. */
export function readTitleRows(page: Pick<Document, 'getElementById'>): readonly TitleManifest[] {
  const text = page.getElementById('ws-title-rows')?.textContent;
  if (text === undefined || text === null || text === '') return [];
  const rows: unknown = JSON.parse(text);
  if (!isRows(rows)) throw new Error('Invalid title rows');
  return rows;
}
/** The composition root installs generated data before recovery or title navigation.
 * Publish the same scalar rows for built-page catalogue inspection without loading worlds. */
export function installTitleManifests(rows: readonly TitleManifest[]): void {
  title = rows;
  Reflect.set(globalThis, Symbol.for('game.titleManifests'), rows);
}
/** Loaded-world menus retain the full installed list when no title catalogue is supplied. */
export function titleManifests(): readonly TitleManifest[] {
  if (title !== null) return title;
  const installed = shards();
  let rows = worldRows.get(installed);
  if (rows === undefined) { rows = installed.map(titleMetadata); worldRows.set(installed, rows); }
  return rows;
}
/** Data-only cards plus original prepared manifests: grids and desktop keep their
 * full runnable catalogue; standalone pages prepare only the selected world. */
export function catalogueManifests():readonly (ShardManifest|TitleManifest)[]{
  const prepared=shards();
  if(title===null)return prepared;
  const rows=new Map<string,ShardManifest|TitleManifest>(title.map(row=>[row.slug,row]));
  for(const manifest of prepared)rows.set(manifest.slug,manifest);
  return [...rows.values()];
}
const NO_ART = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"%3E%3Crect width="3" height="4" fill="%23273340"/%3E%3C/svg%3E';
/** C3: a head with a placement and no card in this build: a shard added to the catalogue after the build. Its name is all
 * the catalogue says, so it wears a plain card until its product is admitted. */
export function withCatalogueHeads(rows: readonly TitleManifest[]): readonly TitleManifest[] {
  const catalogue = installedCatalogue(), known = new Set(rows.map(row => bareSlug(row.slug)));
  if (catalogue === undefined) return rows;
  const { shards: heads = [], placements } = catalogue;
  const placed = new Map(placements.map(row => [bareSlug(row.slug), row]));
  const added = heads.filter(head => !known.has(head.slug)).flatMap(head => {
    const placement = placed.get(head.slug);
    if (placement === undefined) return [];
    const row: TitleManifest = { slug: placement.slug, name: head.name, biome: '', status: 'live', order: placement.order ?? rows.length, shardfile: `/shardfiles/${placement.slug}/shard.json`, card: { thumb: NO_ART, portrait: NO_ART, landscape: NO_ART } };
    return [row];
  });
  return added.length === 0 ? rows : [...rows, ...added];
}
/** The row of a URL's shard when this page loaded another's discovery for it: a catalogue shard with no discovery here. */
export function unloadedTitleRow(named: string | null, loaded: Pick<ShardManifest, 'slug'>): TitleManifest | undefined {
  const row = named === null ? undefined : findTitleManifest(named);
  return row === undefined || new Set([loaded.slug]).has(row.slug) ? undefined : row;
}
export function findTitleManifest(slug: string): TitleManifest | undefined {
  const rows = titleManifests();
  let index = indexes.get(rows);
  if (index === undefined) { index = new Map(rows.map(row => [row.slug, row])); indexes.set(rows, index); }
  return index.get(slug);
}
