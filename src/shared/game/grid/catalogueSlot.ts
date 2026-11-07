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
