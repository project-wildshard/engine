#!/usr/bin/env node
// Ring 1's server half, coverage rows 4 and 7: step every Ring 1 product and server slice on the real server path, and compare a
// digest chain with `test/pins/ring-digests.json`. A slice holds no art, so a read of a file a server shouldn't need fails here.
//
//   node scripts/ring-step.ts [--ticks 240] [--update] [--only slug,slug]
//
// Run `pins.ts install --ring 1` first. Digests are kept per platform and architecture (J97).
// A platform with no baseline fails a full comparison. `--update` records measurements in the running platform's baseline.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import './bake-loader.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// A room's cell worker steps on the portable Math (`dedicated/cellWorker.ts`), and so does the tick worker; the in-process paths
// in `ring-step-paths.ts` do too, so it goes in before any module body reads Math.
await import('../src/shared/engine/core/portableMathFirst.ts');

interface Ring { readonly products: readonly string[]; readonly slices: readonly string[] }
type Digests = Record<string, Record<string, Record<string, readonly string[]>>>;

const option = (name: string): string | undefined => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? undefined : process.argv[at + 1]; };
const TICKS = Number(option('ticks') ?? 240), LINK = 60, BASELINE = 'test/pins/ring-digests.json', PLATFORM = `${process.platform}-${process.arch}`;
const only = option('only')?.split(',');
const update = process.argv.includes('--update');
if (only === undefined && process.argv.includes('--only')) throw new Error('--only requires a list of Ring 1 slugs');

const { prepareAssetDecoders } = await import('@wildshard/format/shardfileAssets');
const { stepRingFolder } = await import('./ring-step-paths.ts');

/** A product's folder is its discovery folder, the one `pins.ts` wrote. */
function outputFolderOf(slug: string): string {
  for (const name of [slug, `_${slug}`]) if (existsSync(join('out', name, 'validation.json'))) return join('out', name);
  throw new Error(`${slug}: not installed: run pins.ts install --ring 1`);
}

await prepareAssetDecoders();
const ring = (JSON.parse(readFileSync('test/pins/rings.json', 'utf8')) as Record<string, Ring>)['1'];
if (ring === undefined) throw new Error('No ring 1');
const slugs = [...ring.products, ...ring.slices];
for (const slug of only ?? []) if (!slugs.includes(slug)) throw new Error(`${slug}: not a Ring 1 slug`);
const rows = slugs.filter(slug => only === undefined || only.includes(slug));
const baseline = (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}) as Digests, held = baseline[PLATFORM]?.[String(TICKS)] ?? {};
const measured: Record<string, readonly string[]> = {};
let failed = 0;
for (const slug of rows) {
  try {
    const folder = ring.products.includes(slug) ? outputFolderOf(slug) : join('out/.slices', slug);
    const { chain, seconds, path } = await stepRingFolder(folder, !ring.products.includes(slug), { ticks: TICKS, link: LINK });
    measured[slug] = chain;
    const was = held[slug], same = JSON.stringify(was) === JSON.stringify(chain);
    if (!update && was !== undefined && !same) failed++;
    console.log(`${slug}: ${path}, ${TICKS} ticks in ${seconds.toFixed(1)}s, ${chain.at(-1)?.slice(0, 16) ?? 'no chain'} ${was === undefined ? 'no baseline' : same ? 'same' : `DIFFERS from ${was.at(-1)?.slice(0, 16) ?? 'none'}`}`);
  } catch (error) {
    failed++;
    console.error(`${slug}: FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}
const report = option('report');
if (report !== undefined) writeFileSync(report, `${JSON.stringify({version: 1, sha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), platform: PLATFORM, ticks: TICKS, measured}, null, 2)}\n`);
if (update) {
  if (failed === 0) {
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, [PLATFORM]: { ...baseline[PLATFORM], [String(TICKS)]: { ...held, ...measured } } }, null, 1)}\n`);
    console.log(`${BASELINE}: recorded ${Object.keys(measured).length} rows for ${PLATFORM}`);
  } else console.error('A row failed to step: nothing recorded');
} else if (only === undefined && Object.keys(held).length === 0) {
  failed++;
  console.error(`${PLATFORM} has no baseline in ${BASELINE}: a compare that can't fail is no gate. Record one with --update.`);
}
process.exitCode = failed > 0 ? 1 : 0;
