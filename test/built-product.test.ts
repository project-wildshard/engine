// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own their complete source, receipts and product cache.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine all synthetic products to repository scratch.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Reproduce the builder's exact recipe namespace.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Prove refusal precedes worker setup in a tiny real Vitest run.
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { assertBuiltTestFolders, folderMapInput, folderFlags, readBuiltShardfile, retainFolderInputs, selectBuiltTestFolders } from '../scripts/built-folder.mjs';
import { captureFolderInputs, folderInputKey, folderToolchainKey, publishFolderInputs, recordBundle } from '../scripts/shardfile-inputs.mjs';
import { mapTilesHash } from '../scripts/map-hash.mjs';
import { InputHashMemo } from '../scripts/bake-input-hashes.mjs';
import { shardfileValidationRevision } from '../scripts/shardfile-validation-revision.mjs';
import { pruneShardfileCache } from '../scripts/shardfile-cache.mjs';
import {PUSH_PROFILE} from '../scripts/push-budget.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
/** Nested fixture roots own their inventories; the parent wave's artifact
 * addresses belong only to the parent checkout and must not cross that boundary. */
function fixtureEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, WS_VITEST_PLAN: undefined, WS_VITEST_TIMINGS: undefined,
    WS_PUSH_GATE_PROFILE:undefined,WS_CPU_ADMISSION:undefined,WS_CPU_BROKER:undefined,WS_CPU_SLOTS:undefined };
}
function write(root: string, file: string, body: string): void {
  const path = resolve(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body);
}
async function fixture(named = false) {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/built-folder-')); owned.push(root);
  const folder = 'author', name = named ? 'example' : folder, cacheRoot = resolve(root, 'cache');
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', `src/shards/${folder}/manifest.json`]) write(root, file, '{}');
  // These synthetic suites need no native tools, but still declare their runner input.
  write(root, 'test/build-tools.json', '{}');
  // This isolated root has no quarantined cases; cohort selection still reads its explicit registry.
  const source = `src/shards/${folder}/shard.config.ts`; write(root, source, 'export default {};');
  const flags = ['--copy-runtime'];
  if (named) {
    write(root, `src/shards/${folder}/outputs.json`, JSON.stringify({ outputs: [{ slug: name }] }));
    write(root, `src/shards/${folder}/look/map.${name}.baked.json`, JSON.stringify({ image: `/assets/${name}/map/top.webp`, tilesHash: 'b'.repeat(64) }));
    flags.push(`--map=<root>/public/assets/${name}/map/top.webp`, `--map-tiles-hash=${'b'.repeat(64)}`, `--output=${name}`);
  }
  const memo = new InputHashMemo(root), recipe = [name, ...flags, `${folderToolchainKey(root, memo)}:${shardfileValidationRevision(root)}`];
  const receipt = resolve(root, 'receipt.json');
  await captureFolderInputs(root, receipt, async () => { readFileSync(resolve(root, source)); recordBundle({ output: [] }); await Promise.resolve(); });
  const key = folderInputKey(root, receipt, recipe, memo); if (key === undefined) throw new Error('Missing fixture receipt');
  const receipts = resolve(cacheRoot, '.inputs-v2', name, createHash('sha256').update(JSON.stringify(recipe)).digest('hex'));
  publishFolderInputs(receipts, receipt, key);
  const directory = resolve(cacheRoot, name, key); write(directory, '.build-key', key); write(directory, 'shard.json', '{}');
  return { root, name, cacheRoot, directory, key, source, recipe, receipt: resolve(receipts, `${key}.json`), options: { cacheRoot, env: {} } };
}

test('local reads require current input bytes and leave product and output bytes untouched', async () => {
  const f = await fixture(), before = statSync(f.directory).mtimeMs;
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(f.directory);
  expect(statSync(f.directory).mtimeMs).toBe(before);
  expect(existsSync(resolve(f.root, 'out'))).toBe(false);
  expect(existsSync(resolve(f.root, '.cache'))).toBe(false);
  write(f.root, f.source, 'export default {changed:true};');
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow(`Missing current product ${f.name}; run: node scripts/build-shardfiles.mjs --reuse --shard=${f.name}`);
  expect(existsSync(resolve(f.root, 'out'))).toBe(false);
});

test('a returned cache path remains readable through this consumer process under eviction pressure', async () => {
  const f = await fixture();
  const directory = readBuiltShardfile(f.root, f.name, f.options);
  const result = pruneShardfileCache(f.cacheRoot, { capBytes: 0 });
  expect(result.locked).toBe(2); // the live body and its sealed input-receipt namespace
  expect(readFileSync(resolve(directory, 'shard.json'), 'utf8')).toBe('{}');
  expect(existsSync(resolve(f.root, 'out'))).toBe(false);
  // The live product loan also needs its sealed read receipt on the next
  // discovery lookup; evicting that proof strands otherwise current bytes.
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(directory);
});

test('slot proof survives shared cache eviction and still rejects stale or corrupt input receipts', async () => {
  const f = await fixture(), output = resolve(f.root, 'out', f.name);
  write(output, '.build-key', f.key); write(output, 'shard.json', '{}');
  retainFolderInputs(f.root, f.name, f.receipt, f.key, f.recipe, new InputHashMemo(f.root));
  const local = resolve(f.root, 'out/.app/product-inputs', `${f.name}.json`), original = readFileSync(local, 'utf8');
  expect(original).toBe(readFileSync(f.receipt, 'utf8'));
  expect(pruneShardfileCache(f.cacheRoot, {capBytes: 0}).deleted).toBe(2);
  expect(existsSync(f.receipt)).toBe(false); expect(existsSync(f.directory)).toBe(false);
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(output);
  writeFileSync(local, original.replace(/("seal":")[a-f0-9]{64}/u, `$1${'f'.repeat(64)}`));
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow('Missing current product');
  writeFileSync(local, original); write(output, '.build-key', 'f'.repeat(64));
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow('Missing current product');
  write(output, '.build-key', f.key); write(f.root, f.source, 'export default {changed:true};');
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow('Missing current product');
});

test('a stale local output never shadows the matching immutable cache product', async () => {
  const f = await fixture(), output = resolve(f.root, 'out', f.name);
  write(output, '.build-key', 'f'.repeat(64)); write(output, 'shard.json', '{}');
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(f.directory);
  write(output, '.build-key', f.key);
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(output);
  rmSync(resolve(output, 'shard.json'));
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(f.directory);
});

test('named-output map recipes resolve exactly and shared validation changes invalidate them', async () => {
  const f = await fixture(true);
  expect(readBuiltShardfile(f.root, f.name, f.options)).toBe(f.directory);
  write(f.root, 'src/shared/game/shardfile/new-law.ts', 'export const law=1;');
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow('Missing current product');
});

test('CI reads its preceding exact-SHA build; mismatched or malformed stamps do not bless output', async () => {
  const f = await fixture(), output = resolve(f.root, 'out', f.name), sha = 'a'.repeat(40);
  write(output, 'shard.json', '{}'); write(f.root, f.source, 'changed');
  expect(readBuiltShardfile(f.root, f.name, { cacheRoot: f.cacheRoot, env: { WS_TEST_PRODUCTS_SHA: sha, GITHUB_SHA: sha } })).toBe(output);
  for (const built of ['bad', 'b'.repeat(40)]) expect(() => readBuiltShardfile(f.root, f.name, { cacheRoot: f.cacheRoot, env: { WS_TEST_PRODUCTS_SHA: built, GITHUB_SHA: sha } })).toThrow('Missing current product');
  expect(() => readBuiltShardfile(f.root, '../escape', f.options)).toThrow('Invalid built product name');
});

test('partial cache entries and corrupt sealed input receipts refuse without building', async () => {
  const f = await fixture(), message = `Missing current product ${f.name}`;
  rmSync(resolve(f.directory, '.build-key'));
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow(message);
  write(f.directory, '.build-key', f.key);
  const receipt = readFileSync(f.receipt, 'utf8'), corrupt = receipt.replace(/("seal":")[a-f0-9]{64}/u, `$1${'f'.repeat(64)}`);
  expect(corrupt).not.toBe(receipt); writeFileSync(f.receipt, corrupt);
  expect(() => readBuiltShardfile(f.root, f.name, f.options)).toThrow(message);
  expect(existsSync(resolve(f.root, 'out'))).toBe(false);
});

test('selected suites reuse only current products and aggregate missing prerequisites once', async () => {
  const f = await fixture();
  write(f.root, 'scripts/test-folders.json', JSON.stringify({
    'test/current.test.ts': [f.name], 'test/other.test.ts': ['other', f.name], 'test/pure.test.ts': [],
  }));
  expect(() => assertBuiltTestFolders(f.root, ['test/current.test.ts', 'test/pure.test.ts'], f.options)).not.toThrow();
  expect(selectBuiltTestFolders(f.root, ['test/current.test.ts', 'test/other.test.ts', 'test/pure.test.ts'], f.options)).toEqual({
    ready: ['test/current.test.ts', 'test/pure.test.ts'], blocked: ['test/other.test.ts'], missing: ['other'],
    buildCommand: 'node scripts/build-shardfiles.mjs --reuse --shard=other',
  });
  write(f.root, f.source, 'export default {changed:true};');
  expect(() => assertBuiltTestFolders(f.root, ['test/pure.test.ts'], f.options)).not.toThrow();
  expect(() => assertBuiltTestFolders(f.root, ['test/current.test.ts', 'test/other.test.ts'], f.options)).toThrow(
    'Missing current products author, other (no verified product matches current inputs), required by test/current.test.ts, test/other.test.ts; run: node scripts/build-shardfiles.mjs --reuse --shard=author,other',
  );
  expect(existsSync(resolve(f.root, 'out'))).toBe(false);
});

test('product-suite preflight retains exact-SHA CI admission', async () => {
  const f = await fixture(), sha = 'a'.repeat(40);
  write(f.root, 'scripts/test-folders.json', JSON.stringify({ 'test/current.test.ts': [f.name] }));
  write(f.root, f.source, 'changed'); write(f.root, `out/${f.name}/shard.json`, '{}');
  expect(() => assertBuiltTestFolders(f.root, ['test/current.test.ts'], { cacheRoot: f.cacheRoot, env: { WS_TEST_PRODUCTS_SHA: sha, GITHUB_SHA: sha } })).not.toThrow();
  expect(() => assertBuiltTestFolders(f.root, ['test/current.test.ts'], { cacheRoot: f.cacheRoot, env: { WS_TEST_PRODUCTS_SHA: sha, GITHUB_SHA: 'b'.repeat(40) } })).toThrow('Missing current products');
});

test('real Vitest refuses missing products before loading worker setup or suite code', async () => {
  const f = await fixture();
  write(f.root, 'scripts/test-folders.json', JSON.stringify({ 'test/product.test.ts': [f.name] }));
  write(f.root, f.source, 'changed');
  write(f.root, 'test/product.test.ts', "throw new Error('suite must not load');");
  write(f.root, 'test/setup.mjs', "import fs from 'node:fs';fs.writeFileSync('worker-started','yes');");
  write(f.root, 'vitest.config.mts', `import {DurationSequencer} from ${JSON.stringify(resolve('scripts/vitest-shard.ts'))};export default {root:${JSON.stringify(f.root)},test:{include:['test/product.test.ts'],setupFiles:['test/setup.mjs'],sequence:{sequencer:DurationSequencer}}};`);
  expect(() => execFileSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(f.root, 'vitest.config.mts')], {
    cwd: f.root, env: { ...fixtureEnvironment(), WS_TEST_COHORT:undefined, WILDSHARD_SHARDFILE_CACHE: f.cacheRoot, WS_TEST_PRODUCTS_SHA: '', GITHUB_SHA: '' }, stdio: 'pipe', timeout: 10_000, maxBuffer: 1_048_576,
  })).toThrow('Missing current products author');
  expect(existsSync(resolve(f.root, 'worker-started'))).toBe(false);
});

test.each(['local-related', 'ci-related', 'focused', 'all-blocked', 'local-commit', 'ci-commit', 'push-related'] as const)('real Vitest product coverage: %s', async mode => {
  const f=await fixture();
  write(f.root,'scripts/test-folders.json',JSON.stringify({'test/product.test.ts':[f.name]}));
  write(f.root,f.source,'changed');
  write(f.root,'source.ts','export const value=1;');write(f.root,'other.ts','export const value=1;');
  write(f.root,'test/pure.test.ts',`import {test,expect} from 'vitest';import {value} from '../${mode==='all-blocked'?'other':'source'}';test('pure runs',()=>expect(value).toBe(1));`);
  write(f.root,'test/product.test.ts',"import '../source';throw new Error('product suite must not load');");
  write(f.root,'test/setup.mjs',"import fs from 'node:fs';fs.writeFileSync('worker-started','yes');");
  write(f.root,'vitest.config.mts',`import {DurationSequencer} from ${JSON.stringify(resolve('scripts/vitest-shard.ts'))};export default {root:${JSON.stringify(f.root)},test:{include:['test/*.test.ts'],setupFiles:['test/setup.mjs'],sequence:{sequencer:DurationSequencer}}};`);
  const args=mode==='focused'||mode.endsWith('-commit')?['run','test/pure.test.ts','test/product.test.ts']:['related','--run','source.ts'];
  const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),...args,'--config',resolve(f.root,'vitest.config.mts')],{
    cwd:f.root,env:{...fixtureEnvironment(),WS_PUSH_GATE_PROFILE:mode==='push-related'?PUSH_PROFILE:undefined,WS_TEST_COHORT:undefined,CI:mode.startsWith('ci-')?'1':'',GITHUB_ACTIONS:'',WS_COMMIT_RELATED_TOKEN:mode.endsWith('-commit')?'fixture':undefined,WILDSHARD_SHARDFILE_CACHE:f.cacheRoot,WS_TEST_PRODUCTS_SHA:'',GITHUB_SHA:'',NO_COLOR:'1'},
    encoding:'utf8',stdio:'pipe',timeout:15_000,maxBuffer:1_048_576,
  });
  expect(result.error).toBeUndefined();
  if(mode==='local-related'||mode==='local-commit'){
    expect(result.status,result.stdout+result.stderr).toBe(0);expect(result.stdout).toContain('1 passed');
    expect(result.stderr).toContain('skipping 1 product suites (CI still runs them): test/product.test.ts');
    expect(result.stderr).toContain('python3 scripts/heavy-lane.py build -- node scripts/build-shardfiles.mjs --reuse --shard=author');
    expect(existsSync(resolve(f.root,'worker-started'))).toBe(true);
  }else{
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(mode==='all-blocked'?'No runnable related suites':'Missing current products author');
    expect(existsSync(resolve(f.root,'worker-started'))).toBe(false);
  }
});

// Real worker discovery proves filtering precedes packing and strict product
// preflight, including the fallback when no durations have been recorded.
test.each([
  ['product-free',false],['product-free',true],['products',false],['products',true],
] as const)('real CI cohort %s with recorded durations %s',async(cohort,measured)=>{
  const f=await fixture();
  write(f.root,'scripts/test-folders.json',JSON.stringify({'test/product.test.ts':[f.name]}));
  if(cohort==='product-free')write(f.root,f.source,'missing-current-product');
  const timings=resolve(f.root,'timings');mkdirSync(timings,{recursive:true});
  if(measured)write(f.root,'timings/timings.json',JSON.stringify({version:1,run:'1',sha:'a'.repeat(40),measuredAt:0,full:{'test/product.test.ts':50,'test/pure.test.ts':1},ring1:{}}));
  for(const name of ['pure','product'])write(f.root,`test/${name}.test.ts`,
    `import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('${name}',()=>writeFileSync('${name}-ran','yes'));`);
  write(f.root,'vitest.config.mts',`import {DurationSequencer} from ${JSON.stringify(resolve('scripts/vitest-shard.ts'))};export default {root:${JSON.stringify(f.root)},test:{include:['test/*.test.ts'],sequence:{sequencer:DurationSequencer}}};`);
  const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--shard=1/1','--config',resolve(f.root,'vitest.config.mts')],{
    cwd:f.root,env:{...fixtureEnvironment(),CI:'1',WS_TIMINGS_DIR:timings,WS_TEST_COHORT:cohort,WILDSHARD_SHARDFILE_CACHE:f.cacheRoot,WS_TEST_PRODUCTS_SHA:'',GITHUB_SHA:'',NO_COLOR:'1'},
    encoding:'utf8',timeout:15_000,maxBuffer:1_048_576,
  });
  expect(result.error).toBeUndefined();
  expect(result.status,result.stdout+result.stderr).toBe(0);
  expect(result.stdout).toContain('1 passed');
  expect(existsSync(resolve(f.root,'pure-ran'))).toBe(cohort==='product-free');
  expect(existsSync(resolve(f.root,'product-ran'))).toBe(cohort==='products');
});


test('source-program maps key both builder and reader recipes on current world inputs without a source output stamp', async () => {
  const f = await fixture(), project = resolve(f.root, 'src/shards/author');
  write(project, 'source.txt', 'original world');
  write(project, 'data/map.json', JSON.stringify({ why: 'Source-program fixture', inputs: ['source.txt'], painter: { program: true } }));
  const first = folderMapInput(project, undefined);
  expect(first).toEqual({ tilesHash: mapTilesHash(project) });
  expect(folderFlags(f.root, undefined, first, false)).toEqual([`--generated-map-tiles-hash=${mapTilesHash(project)}`]);
  write(project, 'data/productMap.json', JSON.stringify({ tilesHash: 'stale source output' }));
  expect(folderMapInput(project, undefined)).toEqual(first);
  write(project, 'source.txt', 'changed world');
  expect(folderMapInput(project, undefined)?.tilesHash).not.toBe(first?.tilesHash);
});
