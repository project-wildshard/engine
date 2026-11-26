// TC28/J186: explicit report-only proof, never discovered by hooks.
// This file runs no real cook locally. The hosted companion owns those.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {cookRevision} from './cook-revision.ts';
import {rendererCandidate, RENDER_ROOT} from './renderer-revision.mjs';
import {committedSourceFiles} from './source-input-proof.mjs';
import {collectGarbage, createCookWorker, indexKey, type CookIndex} from '../cook/game/cookWorker.ts';
import {folderStore, type PackStore} from '../cook/game/packStore.ts';

const engine = process.cwd(), digest = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
const text = (body: Uint8Array | undefined): string => {assert.ok(body); return new TextDecoder().decode(body);};
const revisionOf = (bytes: Uint8Array | undefined): unknown => {
  const value: unknown = JSON.parse(text(bytes));
  assert.ok(typeof value === 'object' && value !== null && 'revision' in value);
  return value.revision;
};
const parent = resolve(process.env.WS_PROOF_SCRATCH ?? 'tmp/cook-cache-proof');
mkdirSync(parent, {recursive: true});
const reports = resolve(process.env.WS_COOK_CACHE_REPORT ?? 'tmp/cook-cache-report');
mkdirSync(reports, {recursive: true});
const quickReceipt = join(reports, 'quick.json');
rmSync(quickReceipt, {force: true});
let completed = 0;
async function fixture(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(parent, 'run-'));
  try {await run(root);} finally {rmSync(root, {recursive: true, force: true});}
  completed++;
}

await test('every actual cook input and the pinned format change cookRevision', () => fixture(root => {
  const baseline = cookRevision(engine);
  const renderFiles = committedSourceFiles(engine).filter(rendererCandidate);
  const rendererInput = renderFiles.find(file => file.startsWith(RENDER_ROOT) && file.endsWith('.ts') && !baseline.files.includes(file));
  assert.ok(rendererInput);
  // The real cook closure plus one actual renderer file exercises the
  // renderer seam without copying/re-hashing the entire app 25 times.
  const copied = [...new Set([...baseline.files, rendererInput, 'package.json'])];
  for (const file of copied) {
    mkdirSync(dirname(join(root, file)), {recursive: true}); copyFileSync(join(engine, file), join(root, file));
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Cook proof', '-c', 'user.email=cook@example.invalid', ...args],
    {cwd: root, encoding: 'utf8', stdio: 'pipe', env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}});
  git('init', '--quiet', '--initial-branch=main');git('add', '--', ...copied);git('commit', '--quiet', '-m', 'cook input fixture');
  const expected = cookRevision(root);
  assert.deepEqual(expected.files, baseline.files);
  for (const file of ['src/scripts/bake-loader.mjs', 'src/scripts/format-hook.mjs']) assert.ok(baseline.files.includes(file), file);
  for (const file of baseline.files) {
    const at = join(root, file), bytes = readFileSync(at);
    writeFileSync(at, Buffer.concat([bytes, Buffer.from('\n')]));
    // Meta QA 11-24 row 44 (MA14b): package.json joins the closure (engineFloor's literal URL) but none of its bytes move
    // the revision (src/scripts/cook-revision.ts revisionBytes), so a release's version bump carries every head; its one cook
    // input, the format pin, is hashed on its own (the 'format dependency' case below).
    if (file === 'package.json') assert.equal(cookRevision(root).revision, expected.revision, file);
    else assert.notEqual(cookRevision(root).revision, expected.revision, file);
    writeFileSync(at, bytes);
  }
  const rendererPath = join(root, rendererInput), rendererBytes = readFileSync(rendererPath);
  writeFileSync(rendererPath, Buffer.concat([rendererBytes, Buffer.from('\n')]));
  assert.notEqual(cookRevision(root).revision, expected.revision, 'renderer-only input');
  writeFileSync(rendererPath, rendererBytes);
  // A newly imported producer input must join the closure without
  // teaching this proof or a hand-maintained inventory its name.
  const entry = join(root, 'src/cook/game/cookJob.ts'), source = readFileSync(entry);
  const added = join(root, 'src/cook/game/tc28-new-input.ts');
  writeFileSync(added, 'export const input = 1;\n');
  writeFileSync(entry, Buffer.concat([source, Buffer.from("\nimport './tc28-new-input';\n")]));
  const expanded = cookRevision(root);
  assert.ok(expanded.files.includes('src/cook/game/tc28-new-input.ts'));
  writeFileSync(added, 'export const input = 2;\n');
  assert.notEqual(cookRevision(root).revision, expanded.revision);
  writeFileSync(entry, Buffer.concat([source, Buffer.from("\nimport {} from './tc28-new-input';\n")]));
  const emptyImport = cookRevision(root);
  assert.ok(emptyImport.files.includes('src/cook/game/tc28-new-input.ts'));
  writeFileSync(added, 'export const input = 3;\n');
  assert.notEqual(cookRevision(root).revision, emptyImport.revision, 'Empty imports still execute their module');
  writeFileSync(entry, source);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {dependencies: Record<string, string>};
  pkg.dependencies['@wildshard/format'] += '-changed';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  assert.notEqual(cookRevision(root).revision, expected.revision, 'format dependency');
  console.log(JSON.stringify({criterion: 'cook-inputs', files: baseline.files.length, revision: baseline.revision}));
}));

const slug = 'sunscar-dunes', header = `shardfiles/${slug}/shard.json`;
const part = `assets/spawn/parts/${digest(Buffer.from('shared-part'))}.pack.br`;
// A counting double at the real worker's child-process boundary. It
// writes real products/store bytes, but performs no asset or sim cook.
const job = `import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {brotliCompressSync} from 'node:zlib';
const [tar,out]=process.argv.slice(2),body=readFileSync(tar),revision=body.toString();
const cache=resolve(out,'../../cache'),counter=join(cache,'launches');
mkdirSync(cache,{recursive:true});writeFileSync(counter,String((existsSync(counter)?Number(readFileSync(counter,'utf8')):0)+1));
// J450: a cook ends with its map, so the double draws both sizes too.
const maps=['','-cell'].map(size=>[${JSON.stringify(`shardfiles/${slug}/cooked-map-v1`)}+size+'.png','png']);
for(const [file,value] of [[${JSON.stringify(header)},JSON.stringify({revision})],[${JSON.stringify(part)},brotliCompressSync(Buffer.from('shared-part'))],...maps]){
 const path=join(out,'client',file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);
}
mkdirSync(join(out,'server'),{recursive:true});writeFileSync(join(out,'server/shard.json'),JSON.stringify({revision}));
console.log(JSON.stringify({slug:${JSON.stringify(slug)},hash:createHash('sha256').update(body).digest('hex'),proof:'unmeasured',check:{pass:true},cook:{manifests:[],map:{full:1,cell:1,drawn:'plain'}},header:${JSON.stringify(header)},server:{files:1,bytes:1},seconds:0}));`;

function harness(root: string): {store: PackStore; worker: (build?: string, store?: PackStore) => ReturnType<typeof createCookWorker>;
  launches: () => number; downloads: () => number; counter: string} {
  const store = folderStore(join(root, 'store')), jobs = join(root, 'jobs'), script = join(jobs, 'job.mjs');
  mkdirSync(jobs, {recursive: true});
  writeFileSync(script, job);
  const blobs = new Map(['one', 'two'].map(value => {const body = Buffer.from(value); return [digest(body), body] as const;}));
  let downloaded = 0;
  const counter = join(jobs, 'cache/launches');
  return {store, counter, downloads: () => downloaded, launches: () => Number(readFileSync(counter, 'utf8')),
    worker: (build = 'same', target = store) => createCookWorker({build, store: target, serverPacks: join(root, 'server'), scratch: jobs,
      launcher: {root: engine, execPath: process.execPath, loader: join(engine, 'src/scripts/bake-loader.mjs'), script, wrap: [],
        limits: {seconds: 5, memoryMB: 2048, heapMB: 1024, cpuSlots: 1}},
      source: {heads: () => Promise.resolve([]), download: hash => {downloaded++; const bytes = blobs.get(hash); assert.ok(bytes); return Promise.resolve(bytes);}}}),
  };
}

await test('a persistent hit launches no child and two revisions retain their own shard.json', () => fixture(async root => {
  const h = harness(root), first = {slug, hash: digest(Buffer.from('one'))}, next = {slug, hash: digest(Buffer.from('two'))};
  const cookedFirst = await h.worker().cook(first);
  assert.equal(cookedFirst.state, 'cooked', cookedFirst.detail);
  assert.equal(h.launches(), 1); assert.equal(h.downloads(), 1);
  const before = await h.store.list('');
  // A separate worker cannot pass through its own in-memory verdict.
  assert.equal((await h.worker().cook(first)).state, 'present');
  assert.equal(h.launches(), 1); assert.equal(h.downloads(), 1);
  assert.deepEqual(await h.store.list(''), before);
  const cookedNext = await h.worker().cook(next);
  assert.equal(cookedNext.state, 'cooked', cookedNext.detail);
  assert.equal(h.launches(), 2); assert.equal(h.downloads(), 2);
  for (const [head, revision] of [[first, 'one'], [next, 'two']] as const) {
    const index = JSON.parse(text(await h.store.get(indexKey('same', head.hash)))) as CookIndex;
    assert.ok(index.loose); assert.ok(index.keys.includes(index.loose + index.header));
    assert.equal(revisionOf(await h.store.get(index.loose + index.header)), revision);
    assert.equal(revisionOf(readFileSync(join(root, 'server', slug, head.hash, 'shard.json'))), revision);
  }
  assert.equal(await h.store.get(header), undefined, 'A cook cannot replace the shared descriptor');
  console.log(JSON.stringify({criterion: 'hit-and-revisions', launches: h.launches(), downloads: h.downloads(), revisions: 2}));
}));

await test('GC before the new index commits cannot delete a reused part', () => fixture(async root => {
  const h = harness(root);
  const cookedOld = await h.worker('old').cook({slug, hash: digest(Buffer.from('one'))});
  assert.equal(cookedOld.state, 'cooked', cookedOld.detail);
  const stale = Date.now() / 1000 - 7200;
  utimesSync(join(root, 'store', part), stale, stale);
  let interleaved = false;
  const hash = digest(Buffer.from('two'));
  const racing: PackStore = {...h.store, put: async (key, bytes, headers) => {
    if (key === indexKey('new', hash)) {interleaved = true; await collectGarbage(h.store, ['new'], 1e12, Date.now());}
    await h.store.put(key, bytes, headers);
  }};
  const cookedNew = await h.worker('new', racing).cook({slug, hash});
  assert.equal(cookedNew.state, 'cooked', cookedNew.detail);
  assert.equal(interleaved, true);
  const index = JSON.parse(text(await h.store.get(indexKey('new', hash)))) as CookIndex;
  assert.ok(index.keys.includes(part));
  for (const key of index.keys) assert.equal(await h.store.has(key), true, key);
  console.log(JSON.stringify({criterion: 'reuse-gc', keys: index.keys.length, interleaved}));
}));

assert.equal(completed, 3, 'Every quick fixture, including cleanup, must complete before publishing its receipt');
writeFileSync(quickReceipt, JSON.stringify({version: 1, complete: true, cases: completed,
  sha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), cookRevision: cookRevision(engine).revision}, null, 2));
