import * as v from 'valibot';
import type { BootSpec, BootModeRows } from '@wildshard/engine/level/spec';
import type { ChunkFiles } from '@wildshard/engine/boot/bytes';
import type { Ktx2Table } from '@wildshard/engine/boot/gpuFiles';
import { isJsonData } from '@wildshard/format/json';
import { currentPageMode } from '../../../shared/game/grid/pageMode';

const urls = v.array(v.pipe(v.string(), v.minLength(1)));
const sources = v.strictObject({ sky: urls, baked: urls, terrain: urls, trees: urls,
  physics: urls, cabins: urls, props: urls, art: urls, music: urls, sfx: urls });
const textures = v.strictObject({ img: sources, ktx2: sources });
const variant = v.strictObject({ modes: v.strictObject({ phone: textures, desktop: textures }) });
const gpu = v.strictObject({ phone: v.record(v.string(), v.string()), desktop: v.record(v.string(), v.string()) });
const gpuSchema = v.strictObject({ shard: gpu, grid: gpu });
const schema = v.strictObject({ shard: variant, grid: variant,
  bakedUnreadPrefixes: v.pipe(v.array(v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]+$/u))), v.minLength(1)),
});
/** Fully resolved page inventories. Array order and repeated URLs are significant. */
export interface PageBootRows {
  readonly shard: BootModeRows<ChunkFiles>;
  readonly grid: BootModeRows<ChunkFiles>;
  readonly bakedUnreadPrefixes: readonly string[];
}
/** Kept in a separate lazy JSON binding so image boots do not load GPU tables. */
export interface PageKtx2Rows { readonly shard: Ktx2Table; readonly grid: Ktx2Table }
const admitted = new WeakMap<object, PageBootRows>();
const admittedGpu = new WeakMap<object, PageKtx2Rows>();
function jsonObject(input: unknown): object {
  if (typeof input !== 'object' || input === null) throw new Error('Page boot requires JSON rows');
  if (!isJsonData(input)) throw new Error('Page boot requires JSON rows');
  return input;
}

/** Install only file selectors; every call reads the current declared page mode. */
export function pageModeBoot(input: unknown): Pick<BootSpec, 'files' | 'sources' | 'bakedUnread'> {
  const cached = typeof input === 'object' && input !== null ? admitted.get(input) : undefined;
  const data = cached ?? v.parse(schema, jsonObject(input));
  if (typeof input === 'object' && input !== null) admitted.set(input, data);
  return {
    sources: (tier, tex = 'img') => data[currentPageMode()].modes[tier][tex],
    files: tier => Object.values(data[currentPageMode()].modes[tier].img).flat(),
    bakedUnread: new RegExp(`/(${data.bakedUnreadPrefixes.join('|')})[^/]*$`, 'u'),
  };
}

/** Called by the lazy KTX2 binding, never registered or installed on import. */
export function pageModeKtx2(input: unknown): { GPU_FILES: Ktx2Table } {
  const cached = typeof input === 'object' && input !== null ? admittedGpu.get(input) : undefined;
  const data = cached ?? v.parse(gpuSchema, jsonObject(input));
  if (typeof input === 'object' && input !== null) admittedGpu.set(input, data);
  return { GPU_FILES: data[currentPageMode()] };
}
