// oxlint-disable-next-line import/no-nodejs-modules -- A child Node with --expose-gc measures the heap a restored listing keeps.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {COOK_PREFIXES, createCookWorker, type JobLauncher} from '../src/cook/game/cookWorker';
import {appendPut, loadListing, saveListing} from '../src/cook/game/keptListing';
import {folderStore, type PackStore} from '../src/cook/game/packStore';

// FAST-RELEASE FR-A21 (the planner, 11-25): each cook restart listed the whole pack bucket again before its first publish,
// 929 s at 12:53 and 963.5 s at 13:23 UTC on the box. The worker now saves its kept listing (after each listing, and each
// PUT after it) and a restarted worker serves the saved copy while a fresh listing refreshes it.
const slug = 'sunscar-dunes', root = process.cwd(), MIN = 60_000;
const hex = (n: number): string => createHash('sha256').update(String(n)).digest('hex');
const PARTS = [0, 1].map(n => `assets/spawn/parts/${hex(n)}.pack.br`);
const JOB = `import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const [tarball, out] = process.argv.slice(2);
const write = key => { const file = join(out, 'client', key); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, key); };
for (const key of ${JSON.stringify(PARTS)}) write(key);
for (const size of ['', '-cell']) write('shardfiles/${slug}/cooked-map-v1' + size + '.png');
mkdirSync(join(out, 'server'), {recursive: true});
const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
const check = {slug: ${JSON.stringify(slug)}, pass: true, proof: 'unmeasured', performance: {}, failures: []};
console.log(JSON.stringify({slug: ${JSON.stringify(slug)}, hash, proof: 'unmeasured', check, cook: {manifests: [], map: {full: 1, cell: 1, drawn: 'plain'}}, header: '', server: {}, seconds: 0}));
`;
let scratch = '', launcher: JobLauncher;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cook-resume-'));
  const script = join(scratch, 'job.mjs');
  writeFileSync(script, JOB);
  launcher = {root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
});
afterAll(() => { rmSync(scratch, {recursive: true, force: true}); });

test('FR-A21: a saved listing reads back with every PUT noted after it, and a broken one reads as none', () => {
  const file = join(scratch, 'unit', 'listing.tsv');
  expect(loadListing(file), 'no file yet').toBeUndefined();
  saveListing(file, 1_000, [{key: 'a/one', bytes: 3, modified: 900}, {key: 'b/two', bytes: 4, modified: 950}]);
  appendPut(file, {key: 'c/three', bytes: 5, modified: 1_100});
  appendPut(file, {key: 'a/one', bytes: 6, modified: 1_200});
  const back = loadListing(file);
  expect(back?.at).toBe(1_000);
  expect([...(back?.rows.values() ?? [])]).toEqual([{key: 'a/one', bytes: 6, modified: 1_200}, {key: 'b/two', bytes: 4, modified: 950}, {key: 'c/three', bytes: 5, modified: 1_100}]);
  // a new listing starts a new journal: the PUTs before it are in the listing or were never written
  saveListing(file, 2_000, [{key: 'b/two', bytes: 4, modified: 950}]);
  expect([...(loadListing(file)?.rows.keys() ?? [])]).toEqual(['b/two']);
  writeFileSync(file, 'not a listing\n1\t2\tkey\n');
  expect(loadListing(file), 'a file without the header').toBeUndefined();
});

test('FR-A21: a restarted worker publishes on its saved listing without waiting on store.list, and re-PUTs a key reclaimed since', async () => {
  const file = join(scratch, 'resume', 'listing.tsv'), inner = folderStore(join(scratch, 'store-resume'));
  const tar = new TextEncoder().encode('resume-one'), hash = createHash('sha256').update(tar).digest('hex');
  const [fresh = '', reclaimed = ''] = PARTS;
  // The box saved its listing 90 min before this restart, past the 40 a live worker's kept copy may serve. One part was
  // written 5 min ago, so GC (it takes nothing younger than an hour) can't have taken it; the other 50 min ago, and a
  // reclaim took it from the store since.
  const now = 500 * MIN;
  saveListing(file, now - 90 * MIN, [{key: fresh, bytes: fresh.length, modified: now - 50 * MIN}, {key: reclaimed, bytes: reclaimed.length, modified: now - 50 * MIN}]);
  appendPut(file, {key: fresh, bytes: fresh.length, modified: now - 5 * MIN});
  let release = (): void => undefined, listings = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const puts: string[] = [], lines: string[] = [];
  const store: PackStore = {...inner,
    // CF4: a refresh lists the cook prefixes one by one, starting with COOK_PREFIXES[0]; holding that one holds it all
    list: async prefix => { if (prefix === COOK_PREFIXES[0]) { listings++; await held; } return inner.list(prefix); },
    put: async (key, body, headers) => { puts.push(key); await inner.put(key, body, headers); }};
  const worker = createCookWorker({build: 'b-resume', store, launcher, serverPacks: join(scratch, 'server-resume'), scratch: join(scratch, 'work-resume'),
    now: () => now, listingFile: file, log: line => { lines.push(line); }, source: {heads: () => Promise.resolve([]), download: () => Promise.resolve(tar)}});

  const row = await Promise.race([worker.cook({slug, hash}), new Promise<undefined>(resolve => { setTimeout(resolve, 20_000); })]);
  release();

  expect(row?.state, 'published while the refresh listing was held').toBe('cooked');
  expect(listings, 'the restart started one refresh listing').toBe(1);
  expect(lines.some(line => line.startsWith('cook listing restored: 2 objects, listed 90.0 min ago'))).toBe(true);
  expect(puts, 'a part written 5 min ago is skipped').not.toContain(fresh);
  expect(puts, 'a part reclaimed since is written again').toContain(reclaimed);
  // each PUT is noted, so a second restart has it too
  expect(loadListing(file)?.rows.get(reclaimed)?.modified).toBe(now);
});

test('FR-A21: a worker saves each listing it takes, and a restart picks it up', async () => {
  const file = join(scratch, 'save', 'listing.tsv'), store = folderStore(join(scratch, 'store-save'));
  await store.put('assets/textures/old.ktx2', new TextEncoder().encode('old'), {type: 'image/ktx2', cache: 'public'});
  const tar = new TextEncoder().encode('save-one'), hash = createHash('sha256').update(tar).digest('hex');
  // a clock past GC_GRACE_MS / 2, so a key the listing lacks is never read as current
  let now = 500 * MIN;
  const options = {build: 'b-save', store, launcher, serverPacks: join(scratch, 'server-save'), scratch: join(scratch, 'work-save'), now: () => now, listingFile: file,
    source: {heads: () => Promise.resolve([]), download: () => Promise.resolve(tar)}};
  expect((await createCookWorker(options).cook({slug, hash})).state).toBe('cooked');

  const saved = loadListing(file);
  expect(saved?.at, 'the listing the first publish took').toBe(500 * MIN);
  expect(saved?.rows.has('assets/textures/old.ktx2')).toBe(true);
  expect(saved?.rows.has(PARTS[0] ?? ''), 'its PUTs are noted after it').toBe(true);
  expect(readFileSync(file, 'utf8').split('\n')[0]).toBe(`wildshard-cook-listing 1 ${500 * MIN}`);

  now = 505 * MIN;
  const lines: string[] = [];
  createCookWorker({...options, log: line => { lines.push(line); }});
  expect(lines).toContain('cook listing restored: 6 objects, listed 5.0 min ago');
});

// FR-A16's lesson (11-25, the box cook OOM-killed at its 4G MemoryMax): a kept listing row must not keep its source text
// alive. A restored 100k-row listing, Map included, costs under the 260 bytes a row FR-A16 allows a fresh listing.
test('FR-A21: a restored listing keeps no file text: each row costs under 260 bytes of heap', () => {
  const file = join(scratch, 'memory', 'listing.tsv');
  const script = `
const {saveListing, loadListing} = await import(${JSON.stringify(resolve('src/cook/game/keptListing.ts'))});
function* rows() { for (let i = 0; i < 100000; i++) yield {key: 'assets/spawn/parts/' + i.toString(16).padStart(8, '0') + 'a'.repeat(56) + '.pack.br', bytes: 12345, modified: 1795614973168 + i}; }
saveListing(${JSON.stringify(file)}, 1, rows());
global.gc(); const before = process.memoryUsage().heapUsed;
const kept = loadListing(${JSON.stringify(file)});
global.gc(); const after = process.memoryUsage().heapUsed;
console.log(JSON.stringify({rows: kept.rows.size, perRow: (after - before) / kept.rows.size}));
`;
  const run = spawnSync(process.execPath, ['--expose-gc', '--experimental-strip-types', '--input-type=module', '-e', script], {encoding: 'utf8', timeout: 120_000});
  expect(run.status, run.stderr).toBe(0);
  const {rows, perRow} = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}') as {rows: number; perRow: number};
  expect(rows).toBe(100_000);
  expect(perRow).toBeLessThan(260);
});
