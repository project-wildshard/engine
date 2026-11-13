/** C3 (J61, D7): the catalogue a page read at boot. A build bakes `catalogue.json` and inlines it in `index.html`, so the
 * first paint waits on no fetch and a head or placement changes with no client rebuild. This holds no data, so the
 * title's chunk can carry it: `catalogueDocument.ts` adds the default that Node tools and tests read. */
export interface CataloguePlacement {
  readonly instance: string;
  readonly slug: string;
  readonly cell: readonly number[];
  readonly size: readonly number[];
  readonly order?: number;
  readonly status?: string;
}
/** A head of the catalogue's stage: the revision of a shard this build runs. */
export interface CatalogueHead {readonly slug: string; readonly name: string; readonly revision: number; readonly hash: string}
export interface CatalogueDocument {
  readonly placements: readonly CataloguePlacement[];
  /** Parsed by `parseGridCatalogue`, which owns its shape. */
  readonly grid: {readonly cells: readonly {readonly instance: string; readonly slug: string}[]};
  readonly shards?: readonly CatalogueHead[];
}

const SLOT = Symbol.for('game.catalogue');
const isDocument = (value: unknown): value is CatalogueDocument => typeof value === 'object' && value !== null && 'placements' in value && Array.isArray(value.placements)
  && 'grid' in value && typeof value.grid === 'object' && value.grid !== null && 'cells' in value.grid && Array.isArray(value.grid.cells);

/** The composition root installs what it read; a worker gets the page's copy. One slot per realm, like the shard list. */
export function installCatalogue(document: unknown): void {
  if (!isDocument(document)) throw new Error('Invalid catalogue');
  Reflect.set(globalThis, SLOT, document);
}
export function installedCatalogue(): CatalogueDocument | undefined {
  const installed: unknown = Reflect.get(globalThis, SLOT);
  return isDocument(installed) ? installed : undefined;
}
/** Read the build's inlined copy. A page with none (a shell or a source document) keeps the default. */
export function installInlineCatalogue(page: Pick<Document, 'getElementById'>): void {
  const text = page.getElementById('ws-catalogue')?.textContent;
  if (text !== undefined && text !== null && text !== '') installCatalogue(JSON.parse(text));
}
/** A product's slug for a placement's or cell's, which keep the authored spelling (`_template`). */
export const bareSlug = (slug: string): string => slug.replace(/^_/u, '');
/** J313 (Jake, 2026-11-12 ~23:05 Cancún): a shard's player-facing status is its catalogue placement's when the installed
 *  catalogue gives one (api-server's grid; `test/pins/catalogue.json` in a release build), else its own. The title deck, the
 *  summary, the saves list and the title prefetch all read it, so the catalogue opens a shard with no shard upload. */
export function placedStatus(row: {readonly slug: string}): string | undefined {
  return installedCatalogue()?.placements.find(placed => bareSlug(placed.slug) === bareSlug(row.slug))?.status;
}
export function titleStatus(row: {readonly slug: string; readonly status?: string}): string | undefined {
  return placedStatus(row) ?? row.status;
}
/** Hidden from a player: a `hidden` status, or a `_` prototype whose catalogue placement doesn't open it (J313: Mossgate). */
export function playerHidden(row: {readonly slug: string; readonly status?: string}): boolean {
  return titleStatus(row) === 'hidden' || (row.slug.startsWith('_') && placedStatus(row) === undefined);
}
/**
 * SA34 (J314, grill Q12): an auto-placed shard gets no Shard Select card; you cross in from a neighbour. Auto-placed means the
 * installed catalogue's grid places the slug and its `placements` (the title's rows) don't name it: api-server's first-upload
 * placement (SA30, `grid-autoplace.ts`) writes only a `grid.cells` row, never a placement, while every carded shard (J305's
 * grid shards and the off-grid ones) has a placement row. A page with no installed catalogue has nothing auto-placed.
 */
export function autoPlaced(row: {readonly slug: string}): boolean {
  const catalogue = installedCatalogue();
  if (catalogue === undefined || catalogue.placements.some(placed => bareSlug(placed.slug) === bareSlug(row.slug))) return false;
  return catalogue.grid.cells.some(cell => bareSlug(cell.slug) === bareSlug(row.slug));
}
