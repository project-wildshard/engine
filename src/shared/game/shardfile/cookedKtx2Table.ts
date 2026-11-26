/** SF15 (J525): the KTX2 table in the cooked index. The cook makes every KTX2 from the shardfile's images, so the table the
 *  client reads to swap an image for its KTX2 (`gpuFiles.ts` `standIn`) is the cook's, and the cooked index carries it
 *  (fix preview PV24's `shards/<slug>/<shardVersion>/cooks/<cookVersion>/<cookHash>/index.json`, field `ktx2`).
 *
 *  Shape: per tier, a source URL to the URL of the file that stands in for it.
 *  - A source is the URL a loader asks for: a mount's URL as the shard names it (`/assets/<slug>/tex/leafy_grass/diffuse.jpg`,
 *    a GLB, the phone's `.phone` copy), or that URL plus `#layer` for a ground layer's unflipped array twin.
 *  - A target is the cook's own file (`…-<hash8>.ktx2|glb`, the phone's `….t<size>-<hash8>.ktx2|glb`), which the index maps
 *    to its key under `cooks/<cookVersion>/`, as it maps every other URL a manifest lists. The image itself stays a
 *    shardfile file (in `common/`), read by a GPU that can't sample KTX2 (`texMode` 'img').
 *  The client registers it as it registers a discovery document's table: `registerGpuFiles(cookedKtx2Table)`. */
import * as v from 'valibot';

type Rows = Readonly<Record<string, string>>;
/** The cooked index's table: per tier, a source URL to the cook's file (see the header). */
export interface CookedKtx2Table {readonly version: 1; readonly phone: Rows; readonly desktop: Rows}

const url = v.pipe(v.string(), v.minLength(2), v.maxLength(512), v.regex(/^\/[^\s?]*$/u, 'a path with no query'));
const tier = v.pipe(v.record(url, url), v.check(rows => Object.keys(rows).length <= 16_384, 'at most 16384 rows a tier'));
export const CookedKtx2TableSchema: v.GenericSchema<unknown, CookedKtx2Table> = v.strictObject({version: v.literal(1), phone: tier, desktop: tier});

/** The table as a cooked index holds it, checked; throws on any other shape. */
export function readCookedKtx2Table(input: unknown): CookedKtx2Table {
  return v.parse(CookedKtx2TableSchema, input);
}

export const EMPTY_COOKED_KTX2_TABLE: CookedKtx2Table = {version: 1, phone: {}, desktop: {}};

const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is Record<string, string> => isMap(value) && Object.values(value).every(target => typeof target === 'string');

/** The cooked index's table from the discovery document a cook serves (`native.ktx2`, any shape: `pageModeKtx2` args, a
 *  `GPU_FILES` table, a bare tier map). A one-shard page's map is taken over a grid page's where both name a source; the
 *  cook writes the same rows into both. An empty table when the document has none. */
export function cookedKtx2TableOf(discovery: unknown): CookedKtx2Table {
  const native = isMap(discovery) && isMap(discovery['native']) ? discovery['native'] : undefined;
  const pairs: {phone: Record<string, string>; desktop: Record<string, string>; shard: boolean}[] = [];
  const walk = (value: unknown, shard: boolean): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item, shard); return; }
    if (!isMap(value)) return;
    if (strings(value['phone']) && strings(value['desktop'])) { pairs.push({phone: value['phone'], desktop: value['desktop'], shard}); return; }
    for (const [key, item] of Object.entries(value)) walk(item, shard || key === 'shard');
  };
  walk(native?.['ktx2'], false);
  const ordered = [...pairs.filter(pair => !pair.shard), ...pairs.filter(pair => pair.shard)];
  const phone: Record<string, string> = {}, desktop: Record<string, string> = {};
  for (const pair of ordered) { Object.assign(phone, pair.phone); Object.assign(desktop, pair.desktop); }
  return readCookedKtx2Table({version: 1, phone, desktop});
}
