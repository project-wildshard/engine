// J505 / CP16: the stored cook can mark a native plan unmeasured. A
// production promotion must also boot the real room code on every live head.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { validateShardfileFolder } from '@wildshard/format/shardfileValidation';
import { StandaloneCatalogueSchema } from '@wildshard/format/standaloneCatalogue';
import { readTar } from '@wildshard/format/tar';
import * as v from 'valibot';
import { apiSource } from '../src/cook/game/cookWorker.ts';
import { loadCookedFolder } from '../src/server/host/headlessFolder.ts';
import { openCellWorld } from '../src/server/host/standalone/cellWorld.ts';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier.ts';
import { SaveStore } from '../src/shared/engine/saves/store.ts';
import { readPlatformItemCatalogue, type PlatformItemCatalogue } from '../src/shared/game/loot/platformCatalogue.ts';
import { agentFetch } from './agent-requests.mjs';
import { admitPin } from './pin-admit.ts';
import { restorePacks, type PackedIndex } from './pin-packs.ts';
import { openReleaseRun } from './release-run.mjs';
import { fetchItemCatalogue } from './server-release/items.mjs';

const API = 'https://api.wildshard.io';
export const PRODUCTION_PLAY_TICKS = 600;

interface Head {
  readonly slug: string;
  readonly revision: number;
  readonly hash: string;
}
type Outcome =
  | (Head & { readonly pass: true; readonly ticks: number })
  | (Head & { readonly pass: false; readonly reason: string });

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const safe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replaceAll(/(?:https?|wss?):\/\/[^\s]+|\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[redacted]').slice(0, 2000);

/** A refusal is named, and cannot hide the verdicts for the other heads. */
export async function replayProductionHeads(heads: readonly Head[], play: (head: Head) => Promise<number>): Promise<readonly Outcome[]> {
  if (heads.length === 0 || new Set(heads.map(head => head.slug)).size !== heads.length) {
    throw new Error('Production must advertise a nonempty list of distinct heads');
  }
  const outcomes: Outcome[] = [];
  for (const head of heads) {
    try {
      const ticks = await play(head);
      if (ticks !== PRODUCTION_PLAY_TICKS) throw new Error(`Room advanced ${ticks} ticks; expected ${PRODUCTION_PLAY_TICKS}`);
      outcomes.push({ ...head, pass: true, ticks });
    } catch (error) {
      outcomes.push({ ...head, pass: false, reason: safe(error) });
    }
  }
  return outcomes;
}

async function productionHeads(): Promise<readonly Head[]> {
  const response = await agentFetch(`${API}/api/catalogue.json?channel=production`, {
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Production catalogue answered HTTP ${response.status}`);
  const document = v.parse(StandaloneCatalogueSchema, await response.json());
  return document.shards.map(({ slug, revision, hash }) => ({ slug, revision, hash }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

async function playOriginal(head: Head, bytes: Uint8Array, folder: string, rapier: Rapier, catalogue: PlatformItemCatalogue['items']): Promise<number> {
  const { files } = admitPin(readTar(bytes), sha256, members => validateShardfileFolder({
    read: (path, maximum) => {
      const body = members.get(path);
      if (body === undefined || body.length > maximum) throw new Error(`Invalid original member ${path}`);
      return body;
    },
    paths: () => members.keys(),
  }, { hash: sha256, judged: 'stored' }));
  const header = files.get('shard.json');
  if (header === undefined) throw new Error('Admitted original has no header');
  const index = JSON.parse(new TextDecoder().decode(header)) as PackedIndex;
  const restored = restorePacks(index, files);
  for (const [name, body] of [...files, ...restored]) {
    if (name.endsWith('/') || name === 'validation.json') continue;
    const file = resolve(folder, name);
    if (!file.startsWith(folder + sep)) throw new Error('Product path escaped the replay folder');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  const input = await loadCookedFolder(folder, rapier, head.slug);
  const room = await openCellWorld({ instance: head.slug }, { ...input, catalogue }, undefined, {
    saves: new SaveStore({ local: null, session: null }), lone: false, wholeSolids: true, pageless: true,
  });
  try {
    const first = room.host.state.tick;
    for (let i = 0; i < PRODUCTION_PLAY_TICKS; i++) room.step([]);
    return room.host.state.tick - first;
  } finally { room.dispose(); }
}

async function main(): Promise<void> {
  const [build, out] = process.argv.slice(2);
  if (build === undefined || !/^[a-f0-9]{40}$/u.test(build)
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== build) {
    throw new Error('Usage: release-prod-play.ts <exact checkout SHA> [verdict.json]');
  }
  const [heads, itemBytes] = await Promise.all([productionHeads(), fetchItemCatalogue(agentFetch)]);
  const catalogue = readPlatformItemCatalogue(JSON.parse(new TextDecoder().decode(itemBytes))).items;
  const source = apiSource(API, agentFetch);
  await prepareAssetDecoders();
  const wasm = createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm');
  const rapier = await loadRapier(await readFile(wasm));
  const run = openReleaseRun(process.cwd(), 'production-play');
  try {
    const outcomes = await replayProductionHeads(heads, async head => {
      const folder = await mkdtemp(join(run.work, 'head-'));
      try { return await playOriginal(head, await source.download(head.hash), folder, rapier, catalogue); }
      finally { await rm(folder, { recursive: true, force: true }); }
    });
    const [current, currentItemBytes] = await Promise.all([productionHeads(), fetchItemCatalogue(agentFetch)]);
    const unchanged = JSON.stringify(heads) === JSON.stringify(current);
    const itemsUnchanged = sha256(itemBytes) === sha256(currentItemBytes);
    const failures = outcomes.filter(row => !row.pass);
    const verdict = { build, pass: unchanged && itemsUnchanged && failures.length === 0, heads: outcomes, unchanged, itemsUnchanged };
    if (out !== undefined) await writeFile(out, `${JSON.stringify(verdict, null, 2)}\n`, { mode: 0o600 });
    for (const row of failures) console.error(`${row.slug} r${row.revision}: ${row.reason}`);
    if (!unchanged) console.error('Production heads changed during the play preflight');
    if (!itemsUnchanged) console.error('The platform item catalogue changed during the play preflight');
    console.log(`${build.slice(0, 10)} production play: ${heads.length - failures.length}/${heads.length} advanced ${PRODUCTION_PLAY_TICKS} room ticks`);
    if (!verdict.pass) process.exitCode = 1;
  } finally { run.close(); }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(safe(error));
    process.exitCode = 1;
  });
}
