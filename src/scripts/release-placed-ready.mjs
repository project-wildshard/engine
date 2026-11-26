// MU13: a staging probe uploaded after the cut otherwise made native entry GET a missing build index.
import { agentFetch as fetch } from './agent-requests.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ensurePlacedHeads, placedIndexProblem} from './page-release/placed-ready.mjs';

async function main() {
  if (process.argv[2] !== 'staging' || process.argv.length !== 3) throw new Error('usage: node --import ./src/scripts/bake-loader.mjs src/scripts/release-placed-ready.mjs staging');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
  const build = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  if (process.env.WS_BUILD_ID !== undefined && process.env.WS_BUILD_ID !== build) throw new Error('Placement readiness needs the exact release checkout');
  /** @type {typeof import('../server/host/dedicated/placementFile.ts')} */
  const placement = await import(pathToFileURL(join(root, 'src/server/host/dedicated/placementFile.ts')).href);
  /** @type {typeof import('../shared/game/grid/placementRows.ts')} */
  const {PLACEMENT_PUBLIC_KEY} = await import(pathToFileURL(join(root, 'src/shared/game/grid/placementRows.ts')).href);
  /** @type {{grid: {cells: {instance: string, slug: string}[]}}} */
  const base = JSON.parse(readFileSync(join(root, 'test/pins/catalogue.json'), 'utf8'));
  const scratch = join(root, 'tmp/page-release/placed', build);
  /** @type {import('../cook/game/cookWorker.ts').CookWorker | undefined} */
  let worker;
  const published = new Set();
  const workerOf = async () => {
    if (worker !== undefined) return worker;
    const need = (/** @type {string} */ name) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}; cook staging placements before aliasing`); return value; };
    /** @type {typeof import('../cook/game/cookWorker.ts')} */
    const {apiSource, createCookWorker, DEFAULT_LIMITS} = await import(pathToFileURL(join(root, 'src/cook/game/cookWorker.ts')).href);
    /** @type {typeof import('../cook/game/packStore.ts')} */
    const {r2Store} = await import(pathToFileURL(join(root, 'src/cook/game/packStore.ts')).href);
    /** @type {typeof import('./renderer-revision.mjs')} */
    const {rendererRevision} = await import(pathToFileURL(join(root, 'src/scripts/renderer-revision.mjs')).href);
    /** @type {typeof import('./shardfile-validation-revision.mjs')} */
    const {shardfileValidationRevision} = await import(pathToFileURL(join(root, 'src/scripts/shardfile-validation-revision.mjs')).href);
    // FAST-RELEASE FR-A21: each release run is a new process, and each listed the whole bucket first (729.6 s for v0.1.90's
    // Brasscap from the MacBook, 11-25); the saved listing outlives release checkouts in the machine's cache.
    const listingFile = join(homedir(), '.cache/wildshard', `cook-listing-${need('R2_BUCKET_PACKS')}.tsv`);
    worker = createCookWorker({build, source: apiSource('https://api.wildshard.io'), listingFile,
      store: r2Store({endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`, bucket: need('R2_BUCKET_PACKS'), accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY')}),
      validator: shardfileValidationRevision(root), serverPacks: join(scratch, 'server'), scratch: join(scratch, 'jobs'), log: line => console.log(line),
      launcher: {root, wrap: [], execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script: join(root, 'src/scripts/cook-job.mjs'), renderer: rendererRevision(root), limits: DEFAULT_LIMITS}});
    return worker;
  };
  const result = await ensurePlacedHeads({base: base.grid.cells,
    read: async () => {
      const file = await placement.fetchPlacementFile('https://packs.wildshard.io/releases/staging-placements.json', PLACEMENT_PUBLIC_KEY);
      if (file.channel !== 'staging') throw new Error('A non-staging placement file cannot qualify staging');
      return file;
    },
    ready: async head => {
      const url = `https://packs.wildshard.io/index/${build}/${head.hash}.json?ready=${Date.now()}`;
      let response;
      for (let attempt = 0; attempt < 6; attempt++) {
        response = await fetch(`${url}&attempt=${attempt}`, {headers: {Origin: 'https://staging.wildshard.io'}, cache: 'no-store', signal: AbortSignal.timeout(20_000)});
        if (response.status !== 404 || !published.has(head.hash) || attempt === 5) break;
        await response.body?.cancel();
        await delay(1000);
      }
      if (response === undefined) throw new Error('Placed index read did not run');
      if (response.status === 404) { await response.body?.cancel(); return false; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Placed index answered ${response.status}`); }
      const index = await response.json();
      if (response.headers.get('access-control-allow-origin') !== 'https://staging.wildshard.io') throw new Error(`Placed ${head.slug} has an invalid exact-build index: no staging CORS`);
      const problem = placedIndexProblem(index, {build, slug: head.slug, hash: head.hash});
      if (problem !== null) throw new Error(`Placed ${head.slug} has an invalid exact-build index: ${problem}`);
      return true;
    },
    cook: async head => {
      const row = await (await workerOf()).cook(head);
      if (!['cooked', 'present'].includes(row.state)) throw new Error(`Placed ${head.slug}: ${row.detail ?? row.state}`);
      // Bound public propagation retries after the normal publisher's index-last PUT.
      published.add(head.hash);
    },
  });
  mkdirSync(scratch, {recursive: true});
  writeFileSync(join(scratch, 'ready.json'), `${JSON.stringify({build, ...result}, null, 2)}\n`);
  console.log(`PASS staging placed readiness ${build}: ${result.heads.length} extra heads, ${result.cooked} cooked, serial ${result.serial}`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((/** @type {unknown} */ error) => {
    console.error(`Placed readiness refused: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  });
}
