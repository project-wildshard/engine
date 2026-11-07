// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in a folder of its own.
import {join} from 'node:path';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {collectGarbage, createCookWorker, indexKey, type CookIndex, type JobLauncher} from '../src/cook/game/cookWorker';
import {folderStore, type PackStore} from '../src/cook/game/packStore';

/** CF-8: a cook reuses a part by skipping its PUT, so the part keeps its old date. A GC that lists before the index lands
 *  must not take it. The real worker, store and collector, with a stand-in job that writes one shared part. */
const part = `assets/spawn/parts/${'a'.repeat(64)}.pack.br`, slug = 'sunscar-dunes', root = process.cwd();
const JOB = `import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
const [tarball, out] = process.argv.slice(2), file = join(out, 'client', ${JSON.stringify(part)});
mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, 'part'); mkdirSync(join(out, 'server'), {recursive: true});
const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
console.log(JSON.stringify({slug: ${JSON.stringify(slug)}, hash, proof: 'unmeasured', cook: {manifests: []}, header: '', server: {}, seconds: 0}));
`;
const TWO_HOURS_S = 7_200;
const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');
let scratch = '', script = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cook-gc-'));
  script = join(scratch, 'job.mjs');
  writeFileSync(script, JOB);
});
afterAll(() => { rmSync(scratch, {recursive: true, force: true}); });

function worker(build: string, store: PackStore): ReturnType<typeof createCookWorker> {
  const launcher: JobLauncher = {root, execPath: process.execPath, loader: join(root, 'scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024}};
  return createCookWorker({build, store, launcher, serverPacks: join(scratch, 'server'), scratch: join(scratch, 'work'), source: {heads: () => Promise.resolve([]), download: hash => Promise.resolve(new TextEncoder().encode(hash === hashOf('one') ? 'one' : 'two'))}});
}

/** The store, with a GC of `keep` running the moment `key` is about to land. */
function collectingBefore(store: PackStore, key: string, keep: string): PackStore {
  return {...store, put: async (put, body, headers) => {
    if (put === key) await collectGarbage(store, [keep], 1e12, Date.now());
    await store.put(put, body, headers);
  }};
}

test('GC during a cook keeps a part the cook reused', async () => {
  const store = folderStore(join(scratch, 'store')), hash = hashOf('two');
  await worker('old', store).cook({slug, hash: hashOf('one')});
  const old = Date.now() / 1000 - TWO_HOURS_S;
  utimesSync(join(scratch, 'store', part), old, old);

  const row = await worker('new', collectingBefore(store, indexKey('new', hash), 'new')).cook({slug, hash});

  expect(row.state, row.detail).toBe('cooked');
  const index = JSON.parse(new TextDecoder().decode(await store.get(indexKey('new', hash)))) as CookIndex;
  expect(await Promise.all(index.keys.map(key => store.has(key)))).toEqual([true]);
});
