import * as v from 'valibot';

/** MMO-PLAN MP3.4 / Q37: api-server's /api/items.json, copied into a signed release. */
export interface PlatformItemCatalogue { readonly version: 1; readonly items: readonly { readonly id: string; readonly maxTier: number }[] }
export const MAX_ITEM_CATALOGUE_BYTES = 1_048_576;
const item = v.strictObject({ id: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u)), maxTier: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });
const document: v.GenericSchema<PlatformItemCatalogue> = v.strictObject({ version: v.literal(1), items: v.pipe(v.array(item), v.maxLength(4096)) });
const schema = v.pipe(document, v.check(value => new Set(value.items.map(row => row.id)).size === value.items.length, 'Duplicate platform item'));
export function readPlatformItemCatalogue(input: unknown): PlatformItemCatalogue { return v.parse(schema, input); }
/** Stable bytes make an unchanged catalogue keep its digest across releases and API row ordering. */
export function platformItemCatalogueBytes(input: unknown): Uint8Array {
  const value = readPlatformItemCatalogue(input), items = [...value.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return new TextEncoder().encode(JSON.stringify({ version: value.version, items }));
}
