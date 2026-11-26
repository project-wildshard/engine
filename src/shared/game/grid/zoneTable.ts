// Fix preview PV2 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md; Jake, 2026-11-26: option (a), "preview is kind of
// a staticly built app/game client. Its not a dynamic MMO where every time you hit F5 the shard version or zone list might change."):
// the zone table a page build bakes. At deploy time preview reads staging's signed release and placement file and writes, per zone,
// its slug, raw shard version and the cook index key; F5 never changes it, the next deploy does. Game layer: the page's zone loader
// (PV4) reads it, the deploy's go-live check (PV2) HEADs every key it names.
import * as v from 'valibot';
import { cookedIndexKey, type CookedShardRef } from '../shardfile/cookedPackPaths';

export interface ZoneTableRow {
  readonly slug: string;
  /** The raw, unmigrated `X.Y.Z` the zone was uploaded as (J524). */
  readonly shardVersion: string;
  /** `shards/<slug>/<shardVersion>/cooks/<cookVersion>/<cookHash>/index.json` in the cooked bucket. */
  readonly index: string;
}
export interface ZoneTable {
  readonly version: 1;
  /** The release the table was taken from: staging's, for preview (option (a)). */
  readonly from: { readonly channel: 'staging' | 'production'; readonly serial: number; readonly engineBuild: string };
  readonly cookVersion: string;
  readonly cookHash: string;
  /** The cooked bucket's origin when it is not `COOKED_ORIGIN`: a local folder served for the headless proof (PV4). https, or http on
   *  the loopback only. */
  readonly origin?: string;
  readonly zones: readonly ZoneTableRow[];
}

const RowSchema = v.strictObject({ slug: v.string(), shardVersion: v.string(), index: v.string() });
const TableSchema = v.strictObject({ version: v.literal(1),
  from: v.strictObject({ channel: v.picklist(['staging', 'production']), serial: v.pipe(v.number(), v.safeInteger(), v.minValue(1)), engineBuild: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/u)) }),
  cookVersion: v.string(), cookHash: v.string(),
  origin: v.exactOptional(v.pipe(v.string(), v.regex(/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?)\/$/u))), zones: v.pipe(v.array(RowSchema), v.minLength(1), v.maxLength(256)) });

/** One zone's cooked identity, as `cookedPackPaths.ts` keys it. */
export const zoneRef = (table: Pick<ZoneTable, 'cookVersion' | 'cookHash'>, row: Pick<ZoneTableRow, 'slug' | 'shardVersion'>): CookedShardRef =>
  ({ slug: row.slug, shardVersion: row.shardVersion, cookVersion: table.cookVersion, cookHash: table.cookHash });

/** A zone table, refused unless every row's index is the key its slug, shard version and the table's cook name, once per slug. */
export function readZoneTable(input: unknown): ZoneTable {
  const table = v.parse(TableSchema, input);
  const seen = new Set<string>();
  for (const row of table.zones) {
    if (seen.has(row.slug)) throw new Error(`The zone table names ${row.slug} twice`);
    seen.add(row.slug);
    if (row.index !== cookedIndexKey(zoneRef(table, row))) throw new Error(`The zone table's index for ${row.slug} is not its cook key`);
  }
  return table;
}

/** The inline element a built page carries the table in, beside the catalogue (`ws-catalogue`), so the first paint and an offline
 *  reload read it with no fetch. */
export const ZONE_TABLE_ELEMENT_ID = 'ws-zone-table';
/** The same table as a file at the page's root. */
export const ZONE_TABLE_FILE = 'zone-table.json';
