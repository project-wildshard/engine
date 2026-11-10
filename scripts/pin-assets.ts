/** Small immutable public assets omitted by a frozen product's legacy mount
 * list. Keep producer bytes and provenance without rewriting its archive,
 * source hash, preparation evidence or admission receipt. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as v from 'valibot';

const hex = (length: number) => v.pipe(v.string(), v.regex(new RegExp(`^[a-f0-9]{${length}}$`, 'u')));
const Asset = v.strictObject({
  slug: v.pipe(v.string(), v.regex(/^[a-z0-9_-]+$/u)),
  url: v.pipe(v.string(), v.regex(/^\/assets\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:jpg|webp|png)$/u)),
  file: v.string(), sha256: hex(64), bytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
  source: v.strictObject({repo: v.pipe(v.string(), v.regex(/^shard-[a-z0-9-]+$/u)), commit: hex(40), path: v.string(), blob: hex(40)}),
});
const AssetPins = v.strictObject({version: v.literal(1), assets: v.pipe(v.array(Asset), v.maxLength(256))});

/** Verify exact bytes before a caller publishes them through its ordinary
 * collision-checked mount ledger. No private producer checkout is needed. */
export function pinnedPublicAssets(root: string, slugs: readonly string[]): readonly {url: string; body: Uint8Array}[] {
  const manifest = resolve(root, 'test/pins/assets.json');
  if (!existsSync(manifest)) return [];
  const pins = v.parse(AssetPins, JSON.parse(readFileSync(manifest, 'utf8'))), seen = new Set<string>();
  return pins.assets.flatMap(row => {
    const extension = row.url.slice(row.url.lastIndexOf('.'));
    if (row.file !== `test/pins/assets/${row.sha256}${extension}` || row.source.path !== `public${row.url}`
      || row.url.split('/').includes('..') || seen.has(row.url)) throw new Error(`Invalid pinned public asset: ${row.url}`);
    seen.add(row.url);
    if (!slugs.includes(row.slug)) return [];
    const body = readFileSync(resolve(root, row.file));
    const hash = createHash('sha256').update(body).digest('hex');
    const blob = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
    if (body.length !== row.bytes || hash !== row.sha256 || blob !== row.source.blob) throw new Error(`Pinned public asset bytes differ: ${row.url}`);
    return [{url: row.url, body}];
  });
}
