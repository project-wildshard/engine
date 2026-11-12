// J262 (SP1a), the cook worker's half of cook-stale-preparation.test.ts: a stale preparation cooks in the worker's bounded
// child, and the index and row say so. Split out so neither file passes the 60 s CI file budget (J193): together they
// measured 61.4 s on main run 43288951110.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its temporary output directories.
import {mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The wrapper's per-run temp root.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The worker's launcher takes absolute script paths.
import {join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {writeTar} from '@wildshard/format/tar';
import {createCookWorker, indexKey} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {digest, json, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

const root = mkdtempSync(join(tmpdir(), 'cook-stale-preparation-worker-'));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });

test('the cook worker cooks a stale preparation in its bounded child, and its index and row say so', {timeout: 60_000}, async () => {
  const tarball = writeTar(prepared(PREPARED)), hash = digest(tarball), lines: string[] = [];
  const worker = (build: string, renderer?: string): ReturnType<typeof createCookWorker> => createCookWorker({build, store: folderStore(join(root, 'worker-store')),
    source: {heads: () => Promise.resolve([{slug: 'template', hash, revision: 1}]), download: () => Promise.resolve(tarball)},
    serverPacks: join(root, 'worker-server'), scratch: join(root, 'worker-jobs'), log: line => { lines.push(line); },
    launcher: {root: process.cwd(), execPath: process.execPath, loader: resolve('scripts/bake-loader.mjs'), script: resolve('scripts/cook-job.mjs'), wrap: [],
      limits: {seconds: 50, memoryMB: 4096, heapMB: 2048}, ...(renderer === undefined ? {} : {renderer})}});
  const stale = await worker('moved', MOVED).cook({slug: 'template', hash});
  expect(stale).toMatchObject({state: 'cooked', preparation: 'stale'});
  expect(lines.some(line => line.includes('stale preparation: template'))).toBe(true);
  const store = folderStore(join(root, 'worker-store'));
  expect(json(await store.get(indexKey('moved', hash)))).toMatchObject({slug: 'template', preparation: 'stale'});
  const fast = await worker('prepared', PREPARED).cook({slug: 'template', hash});
  expect(fast).toMatchObject({state: 'cooked', preparation: 'current'});
  // Same parts either way: the second build's index names exactly the first one's stored objects.
  const keys = (build: string): Promise<unknown> => store.get(indexKey(build, hash)).then(body => (json(body) as {keys: string[]}).keys);
  expect(await keys('prepared')).toEqual(await keys('moved'));
  // A host that hands its job no fingerprint still cooks: the job can't run git under --permission, so it can't call it current.
  expect(await worker('unnamed').cook({slug: 'template', hash})).toMatchObject({state: 'cooked', preparation: 'stale'});
});
