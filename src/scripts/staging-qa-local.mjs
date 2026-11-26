// SQ5: build the source and exercise a real signed world on loopback.
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeGateCopy } from './push-gate-copy.mjs';
import { TOUR_FEATURED } from './zone-entry-featured.mjs';

/** @param {string} root @param {string} file @param {string[]} args @param {NodeJS.ProcessEnv} env @param {string} log */
async function run(root, file, args, env, log) {
  const fd = openSync(log, 'w', 0o600);
  try {
    const child = spawn(file, args, { cwd: root, env, stdio: ['ignore', fd, fd] });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve(undefined) :
        reject(new Error(`Local QA ${basename(log)} failed (${code === null ? signal : `exit ${String(code)}`}). See ${log}`)));
    });
  } finally { closeSync(fd); }
}

/** @param {string} root @param {string} build */
export function checkLocalSource(root, build) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (head !== build) throw new Error('Local QA root must be checked out at the source build');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (dirty !== '') throw new Error('Local QA needs clean tracked source');
}

/** Build the tour's fixture from its pinned products and the reviewed positions of any missing featured cells: the seeded
 * draw's shards, or with no seed every zone the J451 tour features (QA 11-23-b row 37: the default rig hosts the roster).
 * @param {string} checkout @param {number} [seed] */
export async function tourFixture(checkout, seed) {
  const home = (/** @type {string} */ path) => JSON.parse(readFileSync(join(checkout, path), 'utf8'));
  const catalogue = home('test/pins/catalogue.json');
  const snapshot = home('test/pins/staging.json').catalogue;
  const {TOUR_FEATURED: featured} = /** @type {{TOUR_FEATURED: readonly string[]}} */ (await import(pathToFileURL(join(checkout, 'src/scripts/zone-entry-featured.mjs')).href));
  /** @type {import('./zone-entry-tour.mjs').Cell[]} */ const cells = catalogue.grid.cells;
  /** @type {import('./zone-entry-tour.mjs').Cell[]} */ const reviewed = snapshot.grid.cells;
  for (const cell of reviewed) {
    const slug = cell.slug ?? cell.instance;
    if (featured.includes(slug) && !cells.some(row => (row.slug ?? row.instance) === slug)) cells.push(cell);
  }
  // Import from this exact source so both the fixture selection and the browser use the same featured list.
  const {featuredZoneEntry} = await import(pathToFileURL(join(checkout, 'src/scripts/zone-entry-tour.mjs')).href);
  /** @type {ReturnType<typeof import('./zone-entry-tour.mjs').featuredZoneEntry>} */
  const route = seed === undefined ? [] : featuredZoneEntry(cells, seed);
  const selected = new Set(seed === undefined ? featured : route.flatMap(({from,to}) => [from.slug ?? from.instance,to.slug ?? to.instance]));
  const base = /** @type {import('./zone-entry-tour.mjs').Cell[]} */ (home('test/pins/catalogue.json').grid.cells);
  const builtIn = new Set(base.map(cell => cell.instance));
  const extras = cells.filter(cell => !builtIn.has(cell.instance) && selected.has(cell.slug ?? cell.instance));
  return {catalogue, extras, more: [...selected].filter(slug => slug !== 'driftwood-isle')};
}

/** Build-max C4 (2026-11-23): the shards the local rig hosts when no tour picks them: its home and `more`. Every local gate
 * leg (staging-qa.mjs `gateLeg`, the journey card) must stay inside this list; v0.1.77 held when the gate walked into Nalati.
 * QA 11-23-b row 37 (J505): it is every zone the J451 tour features, so a local probe of any featured crossing has its far
 * side (v0.1.78's fixed-route probe never reached Nalati on the old three-shard rig and reported no error). */
export const QA_RIG_HOME = 'driftwood-isle';
export const QA_RIG_MORE = Object.freeze(TOUR_FEATURED.filter(slug => slug !== QA_RIG_HOME));
export const QA_RIG_SHARDS = Object.freeze([QA_RIG_HOME, ...QA_RIG_MORE]);

/** @param {{root: string, build: string, out: string, tourSeed?: number}} options */
export async function openQaRig({ root, build, out, tourSeed }) {
  const work = join(out, 'local'), dist = join(work, 'dist'), keyFile = join(work, 'fixture-key.json');
  mkdirSync(work, { recursive: true });
  const source = makeGateCopy(root, build, { directory: join(work, 'copies') });
  const checkout = source.path;
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const placementFile = join(work, 'fixture-placements.json');
  try {
    writeFileSync(keyFile, JSON.stringify({ private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: key }), { mode: 0o600, flag: 'wx' });
    // Both the app and server are built using this source checkout's tools.
    process.env.WS_RIG_PORTS ??= '19476';
    const { RELEASE_PORT, WORLD_PORT, openRig } = await import(pathToFileURL(join(checkout, 'scripts', 'online-rig.mjs')).href);
    const tour = await tourFixture(checkout, tourSeed);
    const catalogueFile = join(work, 'fixture-catalogue.json');
    {
      writeFileSync(catalogueFile, JSON.stringify(tour.catalogue), {mode:0o600});
      const body = JSON.stringify({kind:'placement',channel:'staging',serial:1,cells:tour.extras});
      writeFileSync(placementFile, JSON.stringify({body,signature:sign(null, Buffer.from(body), pair.privateKey).toString('hex')}), {mode:0o600,flag:'wx'});
    }
    await run(checkout, 'pnpm', ['pins'], process.env, join(work, 'pins.log'));
    await run(checkout, 'python3', ['src/scripts/heavy-lane.py', 'build', '--', process.execPath, 'src/scripts/build-app.mjs', '--outDir', dist],
      { ...process.env, WS_BUILD_ID: build, WILDSHARD_RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, WILDSHARD_RELEASE_KEY: key,
        WILDSHARD_CATALOGUE: catalogueFile },
      join(work, 'build.log'));
    checkLocalSource(checkout, build);
    const rig = await openRig({ dist, work: join(work, 'rig'), keyFile, pgBin: 'pglite:', more: tour.more, cells: 'grid', isolated: true,
      channel: 'staging', placement: {url: pathToFileURL(placementFile).href, key} });
    return { base: String(rig.base), socket: `ws://127.0.0.1:${String(WORLD_PORT)}`, source: checkout, close: async () => {
      try { await rig.close(); } finally {
        rmSync(placementFile, { force: true });
        source.remove();
      }
    } };
  } catch (error) {
    rmSync(placementFile, { force: true });
    source.remove();
    throw error;
  } finally { rmSync(keyFile, { force: true }); }
}
