// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {join} from 'node:path';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {createCookWorker, indexKey, inParallel, PUT_PARALLEL, type JobLauncher} from '../src/cook/game/cookWorker';
import {folderStore, type PackStore} from '../src/cook/game/packStore';

// FAST-RELEASE FR-A2 (meta FAST-RELEASE-PLAN; J505; Jake, 2026-11-24 ~18:20 Cancún: "Do the same audit & review ... of
// all the other release processes"): the cook's publish PUT one object at a time, so Pine's packs took 1,100 to 4,580 s
// to reach R2 after its cook had finished, and the box's one cook queue waited behind each. The publish now sends each
// order group PUT_PARALLEL at a time and keeps the groups in order: parts, then the rest, then spawn, then the loose
// files, then the index. The real worker and folder store, with a stand-in job that writes every kind of key.
const slug = 'sunscar-dunes', root = process.cwd();
const hex = (n: number, length: number): string => createHash('sha256').update(String(n)).digest('hex').slice(0, length);
const PARTS = Array.from({length: 12}, (_, n) => `assets/spawn/parts/${hex(n, 64)}.pack.br`);
const OTHERS = Array.from({length: 6}, (_, n) => `assets/textures/${hex(100 + n, 16)}.ktx2`);
const SPAWN = Array.from({length: 3}, (_, n) => `assets/spawn/${hex(200 + n, 16)}.json`);
const JOB = `import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const [tarball, out] = process.argv.slice(2);
const write = key => { const file = join(out, 'client', key); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, key); };
for (const key of ${JSON.stringify([...PARTS, ...OTHERS, ...SPAWN])}) write(key);
for (const size of ['', '-cell']) write('shardfiles/${slug}/cooked-map-v1' + size + '.png');
mkdirSync(join(out, 'server'), {recursive: true});
const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
const check = {slug: ${JSON.stringify(slug)}, pass: true, proof: 'unmeasured', performance: {}, failures: []};
console.log(JSON.stringify({slug: ${JSON.stringify(slug)}, hash, proof: 'unmeasured', check, cook: {manifests: [], map: {full: 1, cell: 1, drawn: 'plain'}}, header: '', server: {}, seconds: 0}));
`;
let scratch = '', script = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cook-parallel-'));
  script = join(scratch, 'job.mjs');
  writeFileSync(script, JOB);
});
afterAll(() => { rmSync(scratch, {recursive: true, force: true}); });

type Put = {readonly key: string; readonly start: number; end: number};

/** The folder store, with each PUT held a few milliseconds and recorded, and the most PUTs in flight at once. */
function timedStore(store: PackStore): {readonly store: PackStore; readonly puts: Put[]; readonly peak: () => number} {
  const puts: Put[] = [];
  let open = 0, peak = 0, tick = 0;
  return {puts, peak: () => peak, store: {...store, put: async (key, body, headers) => {
    const row: Put = {key, start: tick++, end: -1};
    puts.push(row);
    open++; peak = Math.max(peak, open);
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.put(key, body, headers);
    open--; row.end = tick++;
  }}};
}

test('FR-A2: the cook publishes each order group in parallel, and the groups in order', async () => {
  const timed = timedStore(folderStore(join(scratch, 'store'))), hash = createHash('sha256').update('one').digest('hex');
  const launcher: JobLauncher = {root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
  const worker = createCookWorker({build: 'b-parallel', store: timed.store, launcher, serverPacks: join(scratch, 'server'), scratch: join(scratch, 'work'),
    source: {heads: () => Promise.resolve([]), download: () => Promise.resolve(new TextEncoder().encode('one'))}});

  const row = await worker.cook({slug, hash});

  expect(row.state, row.detail).toBe('cooked');
  const of = (keys: readonly string[]): Put[] => timed.puts.filter(put => keys.includes(put.key));
  const loose = timed.puts.filter(put => put.key.startsWith('loose/'));
  const index = timed.puts.filter(put => put.key === indexKey('b-parallel', hash));
  const groups = [of(PARTS), of(OTHERS), of(SPAWN), loose, index];
  expect(groups.map(group => group.length)).toEqual([PARTS.length, OTHERS.length, SPAWN.length, 2, 1]);
  // every PUT of one group ends before the next group's first PUT starts
  for (let at = 1; at < groups.length; at++) {
    const before = Math.max(...(groups[at - 1] ?? []).map(put => put.end)), after = Math.min(...(groups[at] ?? []).map(put => put.start));
    expect(before, `group ${at - 1} ends before group ${at} starts`).toBeLessThan(after);
  }
  expect(timed.peak(), 'more than one PUT in flight').toBeGreaterThan(1);
  expect(timed.peak(), 'never more than the bound').toBeLessThanOrEqual(PUT_PARALLEL);
});

test('FR-A2: inParallel bounds its work, runs every item and stops taking new ones after a failure', async () => {
  let open = 0, peak = 0;
  const done: number[] = [];
  await inParallel([1, 2, 3, 4, 5, 6, 7], 3, async item => {
    open++; peak = Math.max(peak, open);
    await new Promise(resolve => setTimeout(resolve, 2));
    open--; done.push(item);
  });
  expect(peak).toBe(3);
  expect(done.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);

  const started: number[] = [];
  await expect(inParallel([1, 2, 3, 4, 5, 6], 2, async item => {
    started.push(item);
    await new Promise(resolve => setTimeout(resolve, 2));
    if (item === 1) throw new Error('R2 PUT one answered 500');
  })).rejects.toThrow('R2 PUT one answered 500');
  expect(started.length, 'no new PUT starts after the first failure').toBeLessThan(6);
});

// FR-A2, second half (opus-rel86, 11-25): listing staging's bucket takes minutes (999,467 objects on 11-19), and the
// worker re-lists once its copy is LISTING_MAX_AGE_MS old, so a publish often waited on a whole listing after its cook
// (v0.1.85's recook: Pine's publish 5.2 min after an 820 s cook). The worker now lists while the job runs.
test('FR-A2: the bucket listing runs while the job cooks, not after it', async () => {
  // The job may write only under its own out folder: it leaves `job-done` there once it has slept a little.
  const slow = join(scratch, 'slow-job.mjs'), work = join(scratch, 'work-listing');
  writeFileSync(slow, `${JOB}\nawait new Promise(resolve => setTimeout(resolve, 300));\nwriteFileSync(join(out, 'job-done'), '');\n`);
  const done = (): boolean => existsSync(work) && readdirSync(work, {recursive: true}).some(name => String(name).endsWith('job-done'));
  const inner = folderStore(join(scratch, 'store-listing')), listed: boolean[] = [];
  const store: PackStore = {...inner, list: async prefix => {
    if (prefix === '') listed.push(done());
    return inner.list(prefix);
  }};
  const hash = createHash('sha256').update('listing').digest('hex');
  const launcher: JobLauncher = {root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script: slow, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
  const worker = createCookWorker({build: 'b-listing', store, launcher, serverPacks: join(scratch, 'server-listing'), scratch: work,
    source: {heads: () => Promise.resolve([]), download: () => Promise.resolve(new TextEncoder().encode('listing'))}});

  const row = await worker.cook({slug, hash});

  expect(row.state, row.detail).toBe('cooked');
  expect(listed, 'one listing, taken before the job finished').toEqual([false]);
});

// FR-A2 follow-up (opus-rel86, 11-25): v0.1.87's first publishes on staging each listed for 835.8 s, and a publish whose
// kept listing was 10 to 20 min old waited for the prefetch's fresh one instead of using the kept copy.
test('FR-A2: a publish uses a kept listing still young enough while a prefetch refreshes it', async () => {
  const inner = folderStore(join(scratch, 'store-kept')), work = join(scratch, 'work-kept');
  let now = 0, listings = 0, release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const store: PackStore = {...inner, list: async prefix => {
    if (prefix === '' && ++listings === 2) await held;
    return inner.list(prefix);
  }};
  const tars = new Map(['one', 'two'].map(word => [createHash('sha256').update(`kept-${word}`).digest('hex'), new TextEncoder().encode(`kept-${word}`)]));
  const [first = '', second = ''] = tars.keys();
  const launcher: JobLauncher = {root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
  const worker = createCookWorker({build: 'b-kept', store, launcher, serverPacks: join(scratch, 'server-kept'), scratch: work, now: () => now,
    source: {heads: () => Promise.resolve([]), download: hash => Promise.resolve(tars.get(hash) ?? new Uint8Array())}});

  expect((await worker.cook({slug, hash: first})).state).toBe('cooked');
  now = 11 * 60_000;
  const row = await Promise.race([worker.cook({slug, hash: second}), new Promise<undefined>(resolve => { setTimeout(resolve, 20_000); })]);
  release();

  expect(listings, 'the second job started a prefetch').toBe(2);
  expect(row?.state, 'the publish did not wait for the held prefetch').toBe('cooked');
});

test('FR-A2: while a refresh runs, a kept listing past its age still serves, up to twice it', async () => {
  const inner = folderStore(join(scratch, 'store-aged')), work = join(scratch, 'work-aged');
  let now = 0, listings = 0, release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const store: PackStore = {...inner, list: async prefix => {
    if (prefix === '' && ++listings === 2) await held;
    return inner.list(prefix);
  }};
  const tars = new Map(['one', 'two'].map(word => [createHash('sha256').update(`aged-${word}`).digest('hex'), new TextEncoder().encode(`aged-${word}`)]));
  const [first = '', second = ''] = tars.keys();
  const launcher: JobLauncher = {root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
  const worker = createCookWorker({build: 'b-aged', store, launcher, serverPacks: join(scratch, 'server-aged'), scratch: work, now: () => now,
    source: {heads: () => Promise.resolve([]), download: hash => Promise.resolve(tars.get(hash) ?? new Uint8Array())}});

  expect((await worker.cook({slug, hash: first})).state).toBe('cooked');
  now = 25 * 60_000;
  const row = await Promise.race([worker.cook({slug, hash: second}), new Promise<undefined>(resolve => { setTimeout(resolve, 20_000); })]);
  release();

  expect(listings).toBe(2);
  expect(row?.state, 'a 25-minute listing served while the refresh ran').toBe('cooked');
});
