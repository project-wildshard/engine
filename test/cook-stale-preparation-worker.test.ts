// J262 (SP1a): exercise the real bounded child and publication for each renderer state.
// The in-process suite uses a published zone for content and pack checks.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its temporary output directories.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The wrapper's per-run temp root.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The worker's launcher takes absolute script paths.
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, expect, test} from 'vitest';
import {outputSectionPayloads} from '@wildshard/format/outputFields';
import {FIRST_VERSION} from '@wildshard/format/sectionVersions';
import {writeTar} from '@wildshard/format/tar';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {outputIndexEnvelope} from '@wildshard/format/version';
import {createCookWorker, indexKey} from '../src/cook/game/cookWorker';
import {sidecarTar} from '../src/cook/game/cookSidecar';
import {folderStore} from '../src/cook/game/packStore';
import {cookedMapPath} from '../src/shared/game/shardfile/cookedMapPath';
import {emptyShardfile} from '../src/shared/host/author';
import {digest, json, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';
import {compileCookWorker} from './fixtures/compileCookWorker';

const root = mkdtempSync(join(tmpdir(), 'cook-stale-preparation-worker-'));
const slug = 'stale-preparation-fixture';

function workerProduct(): Map<string, Uint8Array> {
  const source = emptyShardfile({slug, name: 'Stale Preparation Fixture', author: 'Test', revision: 1, seed: 1});
  const files = new Map<string, Uint8Array>();
  const sections = Array.from(outputSectionPayloads(source), ([name, payload]) => {
    const path = `sections/${name}.json`, bytes = validationSourceBytes(payload);
    files.set(path, bytes);
    return {name, path, hash: digest(bytes), bytes: bytes.length, schema: `wildshard:${name}@${FIRST_VERSION}`};
  });
  const {identity, version, requires, budgets, serverBudget, authorCaps, critical, library} = source;
  const cook = validationSourceBytes({version: 1, mounts: []});
  files.set('cook.json', cook);
  files.set('shard.json', validationSourceBytes(outputIndexEnvelope({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2',
    version, identity, requires, admission: {budgets, serverBudget, authorCaps, critical, library},
    build: {sourceHash: digest(validationSourceBytes(source)), validator: 'fixture'}, sections, schemas: [], files: [], runtime: null,
    cook: {path: 'cook.json', hash: digest(cook), bytes: cook.length}})));
  return files;
}

const entryScope = new AbortController();
let entry: Awaited<ReturnType<typeof compileCookWorker>> | undefined;
let preparing: ReturnType<typeof compileCookWorker> | undefined;
beforeAll(async () => { preparing = compileCookWorker(entryScope.signal); entry = await preparing; });
afterAll(async () => { entryScope.abort(); await preparing?.catch(() => undefined); entry?.dispose(); rmSync(root, {recursive: true, force: true}); });

test('the cook worker cooks a stale preparation in its bounded child, and its index and row say so', {timeout: 120_000}, async () => {
  const product = workerProduct();
  expect(product.has('sections/look/map.json')).toBe(false);
  const tarball = writeTar(prepared(product, PREPARED)), hash = digest(tarball), lines: string[] = [];
  const worker = (build: string, renderer?: string, sidecars?: string): ReturnType<typeof createCookWorker> => createCookWorker({build, store: folderStore(join(root, 'worker-store')),
    source: {heads: () => Promise.resolve([{slug, hash, revision: 1}]), download: () => Promise.resolve(tarball)},
    serverPacks: join(root, 'worker-server'), scratch: join(root, 'worker-jobs'), log: line => { lines.push(line); },
    launcher: {root: process.cwd(), execPath: process.execPath, loader: resolve('src/scripts/bake-loader.mjs'), get script() { if (entry === undefined) throw new Error('Missing fixed cook entry'); return entry.script; }, wrap: [],
      limits: {seconds: 50, memoryMB: 4096, heapMB: 2048}, ...(renderer === undefined ? {} : {renderer}), ...(sidecars === undefined ? {} : {sidecars})}});
  const stale = await worker('moved', MOVED).cook({slug, hash});
  expect(stale, lines.join('\n')).toMatchObject({state: 'cooked', preparation: 'stale'});
  expect(lines.some(line => line.includes(`stale preparation: ${slug}`))).toBe(true);
  const store = folderStore(join(root, 'worker-store'));
  expect(json(await store.get(indexKey('moved', hash)))).toMatchObject({slug, preparation: 'stale'});
  const fast = await worker('prepared', PREPARED).cook({slug, hash});
  expect(fast).toMatchObject({state: 'cooked', preparation: 'current'});
  // Same parts either way: the second build's index names exactly the first one's stored objects.
  const keys = (build: string): Promise<string[]> => store.get(indexKey(build, hash)).then(body => (json(body) as {keys: string[]}).keys);
  const staleKeys = await keys('moved');
  expect(staleKeys.length).toBeGreaterThan(0);
  for (const size of ['full', 'cell'] as const) {
    const key = `loose/${hash}/${cookedMapPath(slug, size)}`;
    expect(staleKeys).toContain(key);
    expect(await store.has(key)).toBe(true);
  }
  expect(await keys('prepared')).toEqual(staleKeys);
  // A host that hands its job no fingerprint still cooks: the job can't run git under --permission, so it can't call it current.
  expect(await worker('unnamed').cook({slug, hash})).toMatchObject({state: 'cooked', preparation: 'stale'});

  // SHARD-COMPAT SP1b4: the worker hands its job the sidecar it holds for this shard on its renderer (`<hash>/<renderer>.tar`).
  const again = prepared(product, MOVED), cook = again.get('cook.json');
  if (cook === undefined) throw new Error('prepared() wrote no cook.json');
  const sidecar = {cook, mounts: new Map([...again].filter(([path]) => path.startsWith('mounts/')))};
  const sidecars = (name: string, bytes: Uint8Array): string => {
    const folder = join(root, name);
    mkdirSync(join(folder, hash), {recursive: true}); writeFileSync(join(folder, hash, `${MOVED}.tar`), bytes);
    return folder;
  };
  lines.length = 0;
  expect(await worker('sidecar-hit', MOVED, sidecars('hit', sidecarTar(sidecar))).cook({slug, hash}), lines.join('\n')).toMatchObject({state: 'cooked', preparation: 'cook'});
  expect(lines.some(line => line.includes(`prepared by cook: ${slug}`))).toBe(true);
  expect(json(await store.get(indexKey('sidecar-hit', hash)))).toMatchObject({slug, preparation: 'cook'});
  const other = prepared(product, PREPARED).get('cook.json');
  if (other === undefined) throw new Error('prepared() wrote no cook.json');
  expect(await worker('sidecar-miss', MOVED, sidecars('miss', sidecarTar({...sidecar, cook: other}))).cook({slug, hash})).toMatchObject({state: 'cooked', preparation: 'stale'});
  expect(await worker('sidecar-corrupt', MOVED, sidecars('corrupt', new TextEncoder().encode('not a tar'))).cook({slug, hash})).toMatchObject({state: 'cooked', preparation: 'stale'});
});
