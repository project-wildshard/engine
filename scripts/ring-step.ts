#!/usr/bin/env node
// Ring 1's server half, coverage rows 4 and 7: step every Ring 1 product and server slice on the real server path, and compare a
// digest chain with `test/pins/ring-digests.json`. A slice holds no art, so a read of a file a server shouldn't need fails here.
//
//   node --experimental-transform-types scripts/ring-step.ts [--ticks 240] [--update] [--only slug,slug]
//
// Run `pins.ts install --ring 1` first. Digests are kept per platform and architecture (J97).
// A platform with no baseline fails a full comparison. `--update` records measurements in the running platform's baseline.
// oxlint-disable-next-line import/no-unassigned-import -- Its hooks are the point, and they must run first.
import './bake-loader.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { ringStepDigest } from './ring-step-digest.mjs';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol.ts';

interface Ring { readonly products: readonly string[]; readonly slices: readonly string[] }
interface Stepped { readonly chain: readonly string[]; readonly seconds: number; readonly path: string }
type Digests = Record<string, Record<string, Record<string, readonly string[]>>>;

const option = (name: string): string | undefined => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? undefined : process.argv[at + 1]; };
const TICKS = Number(option('ticks') ?? 240), LINK = 60, BASELINE = 'test/pins/ring-digests.json', PLATFORM = `${process.platform}-${process.arch}`;
/** One fixed line of play: a walk, with a jump and a dodge in it. It installs every host and moves the player. A host that sleeps until
 *  its own verb is proved to load, not to work: that's what the tapes in row 7 are for. */
const line = (tick: number): HeadlessCommand => ({ kind: 'player', moveX: 0.3 * Math.sin(tick / 90), moveZ: -1, yaw: 0, ...(tick % 47 === 0 ? { jump: true as const } : {}), ...(tick % 97 === 0 ? { dodge: true as const } : {}) });
const only = option('only')?.split(',');
const update = process.argv.includes('--update');
if (only === undefined && process.argv.includes('--only')) throw new Error('--only requires a list of Ring 1 slugs');

const { prepareAssetDecoders } = await import('@wildshard/format/shardfileAssets');
const { loadRapier } = await import('../src/shared/engine/physics/rapier.ts');
const { loadHeadlessFolder } = await import('../src/server/host/headlessFolder.ts');
const { createNativeHeadlessResident } = await import('../src/server/host/headlessRuntime.ts');
const { HeadlessSimulation } = await import('../src/server/host/headless.ts');
const { outputDescriptor, serverReadsFile } = await import('../src/shared/game/shardfile/outputDescriptor.ts');
const { serializeSimSnapshot, snapshotSimHostBytes } = await import('../src/shared/engine/sim/snapshot.ts');

/** A declared shard runs in the tick worker on its whole asset table, as the cook's proof does. */
async function stepDeclared(shard: Awaited<ReturnType<typeof loadHeadlessFolder>>['shardfile'], assets: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory' }), chain: string[] = [];
  try {
    for (let tick = 1; tick <= TICKS; tick++) {
      const commit = await sim.step([{ source: 'ring', commands: [line(tick)] }]);
      if (commit.tick !== tick) throw new Error(`Stepped to tick ${commit.tick}, not ${tick}`);
      if (tick % LINK === 0) chain.push(ringStepDigest(chain.at(-1) ?? '', commit.snapshot));
    }
    return chain;
  } finally { await sim.dispose(); }
}

/** Held-melee and native-assembly shards: the resident a worker composes, in this process, walking a fixed line. */
async function stepResident(input: { shard: Awaited<ReturnType<typeof loadHeadlessFolder>>['shardfile']; assets: ReadonlyMap<string, Uint8Array>; product: Awaited<ReturnType<typeof loadHeadlessFolder>> }): Promise<string[]> {
  const rapier = await loadRapier(readFileSync(createRequire(resolve('package.json')).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const resident = await createNativeHeadlessResident({ ...input, rapier }), chain: string[] = [];
  try {
    for (let tick = 1; tick <= TICKS; tick++) {
      resident.step([line(tick)]);
      if (tick % LINK === 0) chain.push(ringStepDigest(chain.at(-1) ?? '', serializeSimSnapshot(snapshotSimHostBytes(resident.host))));
    }
    if (resident.host.state.tick !== TICKS) throw new Error(`Stepped to tick ${resident.host.state.tick}, not ${TICKS}`);
    return chain;
  } finally { resident.dispose(); }
}

async function step(folder: string): Promise<Stepped> {
  const started = performance.now(), product = await loadHeadlessFolder(folder), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`${folder}: no verified index`);
  const declared = shard.runtime === null && !product.has('sim/runtime-plan'), assets = new Map<string, Uint8Array>();
  for (const file of descriptor.index.files) {
    if (!declared && !(serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'))) continue;
    assets.set(file.commons === true ? `commons:${file.hash}` : file.hash, readFileSync(join(folder, file.path)));
  }
  const chain = declared ? await stepDeclared(shard, assets) : await stepResident({ shard, assets, product });
  return { chain, seconds: (performance.now() - started) / 1000, path: declared ? 'declared' : shard.runtime === null ? 'held-melee' : 'native-assembly' };
}

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
    const { chain, seconds, path } = await step(folder);
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
