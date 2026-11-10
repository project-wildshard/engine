/** Small immutable public assets omitted by a frozen product's legacy mount
 * list. Keep producer bytes and provenance without rewriting its archive,
 * source hash, preparation evidence or admission receipt. */
import {createHash} from 'node:crypto';
import {closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import * as v from 'valibot';

const hex = (length: number) => v.pipe(v.string(), v.regex(new RegExp(`^[a-f0-9]{${length}}$`, 'u')));
const Asset = v.strictObject({
  slug: v.pipe(v.string(), v.regex(/^[a-z0-9_-]+$/u)),
  url: v.pipe(v.string(), v.regex(/^\/assets\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:jpg|webp|png|glb|gltf)$/u)),
  file: v.string(), sha256: hex(64), bytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4_000_000)),
  remote: v.optional(v.literal(true)),
  source: v.strictObject({repo: v.union([v.pipe(v.string(), v.regex(/^shard-[a-z0-9-]+$/u)),v.literal('Raynos/project-wildshard-singleplayer')]), commit: hex(40), path: v.string(), blob: hex(40)}),
});
const AssetPins = v.strictObject({version: v.literal(1), assets: v.pipe(v.array(Asset), v.maxLength(256))});

/** Verify exact bytes before a caller publishes them through its ordinary
 * collision-checked mount ledger. No private producer checkout is needed. */
function assetCache(): string {
  const {WILDSHARD_PIN_CACHE: cache} = process.env;
  return resolve(cache ?? resolve(homedir(), '.cache/wildshard/pins'));
}
function assetPins(root: string) {
  const manifest = resolve(root, 'test/pins/assets.json');
  if (!existsSync(manifest)) return [];
  const pins = v.parse(AssetPins, JSON.parse(readFileSync(manifest, 'utf8'))), seen = new Set<string>();
  for (const row of pins.assets) {
    const extension = row.url.slice(row.url.lastIndexOf('.'));
    if (row.file !== `test/pins/assets/${row.sha256}${extension}` || row.source.path !== `public${row.url}`
      || row.url.split('/').some(part => part === '.' || part === '..') || seen.has(row.url)) throw new Error(`Invalid pinned public asset: ${row.url}`);
    seen.add(row.url);
    if (row.remote !== true && row.bytes > 1_000_000) throw new Error(`Local pinned public asset exceeds the Git blob limit: ${row.url}`);
  }
  return pins.assets;
}
function verify(row: ReturnType<typeof assetPins>[number], body: Uint8Array): void {
  const hash = createHash('sha256').update(body).digest('hex');
  const blob = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  if (body.length !== row.bytes || hash !== row.sha256 || blob !== row.source.blob) throw new Error(`Pinned public asset bytes differ: ${row.url}`);
}
/** Materialize larger fallback pins from their immutable public producer Git
 * commit. Hash, byte length and Git blob remain authority; no credentials,
 * mutable branch or producer checkout is used. Transport is injectable for
 * a real local HTTP corruption proof. Nothing is published until all verify. */
export async function fetchPinnedPublicAssets(root: string, slugs?: readonly string[], cache = assetCache(), request: typeof fetch = fetch): Promise<void> {
  for (const row of assetPins(root)) {
    if (row.remote !== true || slugs !== undefined && !slugs.includes(row.slug)) continue;
    const file = resolve(cache, `${row.sha256}${row.url.slice(row.url.lastIndexOf('.'))}`);
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size !== row.bytes) throw new Error(`Pinned public asset bytes differ: ${row.url}`);
      verify(row, readFileSync(file));continue;
    }
    const repository = row.source.repo === 'Raynos/project-wildshard-singleplayer' ? row.source.repo : `project-wildshard/${row.source.repo}`;
    const response = await request(`https://raw.githubusercontent.com/${repository}/${row.source.commit}/${row.source.path}`, {signal: AbortSignal.timeout(30_000)});
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new Error(`Pinned public asset unavailable: ${row.url} (${response.status})`);
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();if (next.done) break;
        length += next.value.byteLength;
        if (length > row.bytes) throw new Error(`Pinned public asset bytes differ: ${row.url}`);
        chunks.push(next.value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined);throw error; }
    finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks);verify(row, body);
    mkdirSync(cache, {recursive: true});
    const temporary = `${file}.${process.pid}`;
    const descriptor = openSync(temporary, 'wx');
    try {
      try { writeFileSync(descriptor, body); } finally { closeSync(descriptor); }
      renameSync(temporary, file);
    } finally { rmSync(temporary, {force: true}); }
  }
}
/** Verify installed fallback bytes before the ordinary mount ledger sees them. */
export function pinnedPublicAssets(root: string, slugs?: readonly string[], cache = assetCache()): readonly {url: string; body: Uint8Array}[] {
  return assetPins(root).flatMap(row => {
    if (slugs !== undefined && !slugs.includes(row.slug)) return [];
    const file = row.remote === true ? resolve(cache, `${row.sha256}${row.url.slice(row.url.lastIndexOf('.'))}`) : resolve(root, row.file), stat = lstatSync(file);
    if (!stat.isFile() || stat.size !== row.bytes) throw new Error(`Pinned public asset bytes differ: ${row.url}`);
    const body = readFileSync(file);
    verify(row, body);
    return [{url: row.url, body}];
  });
}
