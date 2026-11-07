import { expect, test } from 'vitest';
import { selectTestCohort,PURE_TESTS } from '../scripts/vitest-shard';
import { CI_SERIAL_TESTS, CI_NATIVE_GROUPS } from '../scripts/vitest-ci-files';
import { packShards,readDurations,CI_SHARD_COUNT } from '../scripts/test-shard-plan';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the actual workflow covers every discovered test partition.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect actual Vitest discovery without collecting or executing suites.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Match discovery paths to the repository-relative duration registry.
import {relative,resolve} from 'node:path';

test('duration partitions retain every file once, including unmeasured files', () => {
  const paths = Array.from({ length: 137 }, (_, i) => `test/fixture-${i}.test.ts`);
  const durations = new Map(paths.slice(0, 120).map((path, i) => [path, i % 9]));
  for (const count of [1, 10, 12, 16, 24, 32]) {
    const parts = packShards(paths, durations, count);
    expect(parts).toHaveLength(count);
    expect(parts.flat().sort()).toEqual([...paths].sort());
    expect(new Set(parts.flat()).size).toBe(paths.length);
    expect(packShards([...paths].reverse(), durations, count)).toEqual(parts);
  }
});

test('measured long tests get separate partitions instead of sharing a fallback weight', () => {
  const paths = ['long-a', 'long-b', 'long-c', ...Array.from({ length: 100 }, (_, i) => `short-${i}`)];
  const durations = new Map(paths.map(path => [path, path.startsWith('long-') ? 100 : 1]));
  const parts = packShards(paths, durations, 10);
  expect(parts.filter(files => files.some(path => path.startsWith('long-')))).toHaveLength(3);
  for (const part of parts) expect(part.filter(path => path.startsWith('long-')).length).toBeLessThanOrEqual(1);
});

test('isolated setup cost balances short-file tails against long test bodies', () => {
  const paths = [...Array.from({ length: 4 }, (_, i) => `long-${i}`),
    ...Array.from({ length: 160 }, (_, i) => `short-${i}`)];
  const durations = new Map(paths.map(path => [path, path.startsWith('long-') ? 100 : .001]));
  const parts = packShards(paths, durations, 8);
  // The observed six-second setup belongs to each file, including tiny bodies.
  const wall = parts.map(files => files.reduce((sum, path) => sum + (durations.get(path) ?? 0) + 6, 0));
  expect(Math.max(...wall) - Math.min(...wall)).toBeLessThanOrEqual(6.01);
  expect(Math.max(...parts.map(files => files.length))).toBeLessThan(40);
  expect(parts.flat().sort()).toEqual([...paths].sort());
});

test('cohorts separate real product consumers before duration or fallback sharding',()=>{
 const registry={'test/product.test.ts':['pine-hollow'],'test/declared-pure.test.ts':[]};
 const files=['test/new.test.ts','test/product.test.ts','test/declared-pure.test.ts'];
 expect(selectTestCohort(files,registry,undefined)).toEqual(files);
 expect(selectTestCohort(files,registry,'product-free')).toEqual(['test/new.test.ts','test/declared-pure.test.ts']);
 expect(selectTestCohort(files,registry,'products')).toEqual(['test/product.test.ts']);
 expect(()=>selectTestCohort(files,registry,'typo')).toThrow('Unknown test cohort');
});

test('parallel and dedicated native CI discover every existing file exactly once',()=>{
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
 const job=workflow.split('\n  behaviour:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
 if(job===undefined)throw new Error('Missing behavior wave');
 expect(workflow).not.toContain('\n  behaviour-products:');
 expect(job).toContain('needs: [prepare, fixtures]');
 expect(job).toContain("needs.fixtures.result == 'success'");
 expect(job).toContain('name: native-fixtures');
 expect(job).toContain('Restore source-host native constructor inputs');
 expect(job).toContain('WS_NALATI_NATIVE_CACHE:');
 expect(job).toContain("needs.prepare.result == 'success'");
 expect(job).toContain(`WS_TEST_PRODUCTS_SHA: \${{ github.sha }}`);
 expect(job).not.toContain('WS_TEST_COHORT:');
 expect(job).toContain('fail-fast: false');
 expect(job).toContain(`--config scripts/vitest-ci.config.ts --shard=\${{ matrix.shard }}/${CI_SHARD_COUNT} --bail=0`);
 expect(job).toContain('name: vitest-plan');
 expect(job).toContain('WS_VITEST_PLAN: tmp/ci-vitest/plan.json');
 expect(job).toContain('WS_VITEST_TIMINGS: tmp/ci-vitest/timings.json');
 expect(job).toContain('--reporter=./scripts/vitest-timings.ts');
 expect(job).toContain('python3 scripts/ci-products.py unpack');
 const matrix=/^\s+shard: \[([\d, ]+)\]/mu.exec(job)?.[1]?.split(',').map(Number);
 expect(matrix).toEqual(Array.from({length:CI_SHARD_COUNT},(_,i)=>i+1));
 const list=(config?:string):{file:string;projectName?:string}[]=>{
  const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'list','--filesOnly','--json',
   ...(config===undefined?[]:['--config',config])],{encoding:'utf8',timeout:10000});
  expect(result.status,result.stderr).toBe(0);
  return v.parse(v.array(v.object({file:v.string(),projectName:v.exactOptional(v.string())})),JSON.parse(result.stdout));
 };
 const normal=list(),ci=list('scripts/vitest-ci.config.ts'),native=list('scripts/vitest-native-escape.config.ts');
 const paths=normal.map(row=>relative('.',row.file));
 const actual=ci.map(row=>relative('.',row.file));
 const serial=native.map(row=>relative('.',row.file));
 expect(actual.length).toBeGreaterThan(0);
 expect([...serial].sort()).toEqual([...CI_SERIAL_TESTS].sort());
 expect([...actual,...serial].sort()).toEqual([...paths].sort());
 expect(new Set([...actual,...serial]).size).toBe(paths.length);
 expect(ci.filter(row=>row.projectName==='pure').map(row=>relative('.',row.file)).sort()).toEqual([...PURE_TESTS].sort());
 const parts=packShards(actual,readDurations('.')??new Map(),CI_SHARD_COUNT);
 const selected=(matrix??[]).flatMap(index=>parts[index-1]??[]);
 expect(selected.sort()).toEqual([...actual].sort());
 expect(new Set(selected).size).toBe(actual.length);
 const registry=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(readFileSync('scripts/test-products.json','utf8')));
 for(const [file,products] of Object.entries(registry))if(products.length>0)expect(paths).toContain(file);
 const ship=workflow.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
 expect(ship).toContain('needs: [prepare, typecheck-lint, behaviour, native-escape, journeys, stage-prebuilt]');
 expect(ship).toContain(`CI_WAVE_BOOT_OUTCOME: \${{ steps.boot.outcome }}`);
 const nativeJob=workflow.split('\n  native-escape:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
 expect(nativeJob).toBeDefined();
 expect(nativeJob).toContain('runs-on: ubuntu-latest');
 expect(nativeJob).toContain('--config scripts/vitest-native-escape.config.ts');
 expect(nativeJob).not.toContain('--shard=');
 expect(nativeJob).toContain("WS_VITEST_MAX_WORKERS: '1'");
 for(const file of ['test/pine-quest-verbs.test.ts','test/pine-door-continuation.test.ts','test/native-runtime-observation.test.ts','test/driftwood-story-verbs.test.ts','test/sky-progression-verbs.test.ts','test/nalati-discovery-verbs.test.ts','test/nalati-chapter-one.test.ts','test/nalati-titan-verbs.test.ts','test/driftwood-optional-verbs.test.ts','test/driftwood-trade-verbs.test.ts','test/nalati-patrol-verbs.test.ts','test/physics-nalati-headless.test.ts','test/nalati-chapter-binding.test.ts','test/nalati-qara-verbs.test.ts'])
  expect(serial).toContain(file);
 expect(CI_NATIVE_GROUPS['native-routes']).toContain('test/driftwood-trade-verbs.test.ts');
 for(const file of ['test/nalati-discovery-verbs.test.ts','test/native-runtime-observation.test.ts','test/physics-headless.test.ts','test/physics-shards-headless.test.ts']){
  expect(CI_NATIVE_GROUPS['native-routes']).toContain(file);
  expect(CI_NATIVE_GROUPS['stories-qara']).not.toContain(file);
 }
 expect(CI_NATIVE_GROUPS['stories-qara']).toContain('test/nalati-qara-verbs.test.ts');
 expect(CI_NATIVE_GROUPS['escape-titan']).not.toContain('test/driftwood-trade-verbs.test.ts');
 expect(CI_NATIVE_GROUPS['stories-qara']).not.toContain('test/driftwood-trade-verbs.test.ts');
 expect(nativeJob).toContain('needs: [prepare, fixtures]');
 expect(nativeJob).toContain("NATIVE_INPUT_PROOF: 'cache-v4'");
 expect(nativeJob).toContain('name: test-products');
 expect(nativeJob).toContain('python3 scripts/ci-products.py unpack');
 expect(nativeJob).toContain(`WS_TEST_PRODUCTS_SHA: \${{ github.sha }}`);
 const restore=nativeJob?.indexOf('python3 scripts/ci-products.py unpack')??-1;
 const warm=nativeJob?.indexOf('node scripts/warm-native-chrome.mjs')??-1;
 const controls=nativeJob?.indexOf('--config scripts/vitest-native-escape.config.ts')??-1;
 expect(restore).toBeGreaterThanOrEqual(0);expect(warm).toBeGreaterThan(restore);expect(controls).toBeGreaterThan(warm);
 if(nativeJob===undefined)throw new Error('Missing native runner');
 const warmed=nativeJob.indexOf('node scripts/warm-native-chrome.mjs');
 expect(warmed).toBeGreaterThan(nativeJob.indexOf('pnpm install --frozen-lockfile'));
 expect(warmed).toBeLessThan(nativeJob.indexOf('Run the original native Escape controls alone'));
 expect(nativeJob).toContain('post-read warmed');
 expect(nativeJob).toContain('tmp/ci-native-escape/warm-read.json');
 const nativeRuns=[...nativeJob.matchAll(/pnpm exec vitest run (.+?) --config scripts\/vitest-native-escape\.config.ts/gu)]
  .map(match=>match[1]?.split(/\s+/u)??[]);
 const runsByGroup=new Map<string,string[]>();
 for(const step of nativeJob.split('\n      - ')){
  const files=/pnpm exec vitest run (.+?) --config scripts\/vitest-native-escape\.config\.ts/u.exec(step)?.[1];
  if(files===undefined)continue;
  const group=/matrix.group == '([^']+)'/u.exec(step)?.[1];
  if(group===undefined)throw new Error('Native command must belong to an explicit runner group');
  runsByGroup.set(group,[...(runsByGroup.get(group)??[]),...files.split(/\s+/u)]);
 }
 expect(new Set(runsByGroup.keys())).toEqual(new Set(Object.keys(CI_NATIVE_GROUPS)));
 for(const [group,files] of Object.entries(CI_NATIVE_GROUPS))expect(runsByGroup.get(group)).toEqual([...files]);
 expect(CI_NATIVE_GROUPS['chapter-one']).toEqual(['test/nalati-chapter-one.test.ts']);
 expect(CI_NATIVE_GROUPS['stories-qara']).not.toContain('test/nalati-chapter-one.test.ts');
 expect(nativeJob).toContain('timeout-minutes: 30');
 const groups=/group: \[([^\]]+)\]/u.exec(nativeJob)?.[1]?.split(',').map(group=>group.trim());
 expect(groups).toHaveLength(Object.keys(CI_NATIVE_GROUPS).length);
 expect(new Set(groups)).toEqual(new Set(Object.keys(CI_NATIVE_GROUPS)));
 expect(nativeJob).toContain('fail-fast: false');
 for(const group of Object.keys(CI_NATIVE_GROUPS))
  expect(nativeJob).toContain(`!cancelled() && steps.native-inputs.outcome == 'success' && matrix.group == '${group}'`);
 expect(nativeJob).toContain(`name: native-escape-results-\${{ matrix.group }}`);
 expect(nativeJob).toContain(`name: ci-failures-native-escape-\${{ matrix.group }}`);
 expect(nativeRuns.flat().sort()).toEqual([...CI_SERIAL_TESTS].sort());
 expect(new Set(nativeRuns.flat()).size).toBe(nativeRuns.flat().length);
 expect(nativeJob).toContain("!cancelled() && steps.native-inputs.outcome == 'success'");
 expect(nativeJob).toContain('tmp/ci-native-escape/sim-results.json');
 expect(ship).toContain("needs.native-escape.result == 'success'");
});

test('shared workers admit only reviewed format suites without host or import-state mutation',()=>{
 for(const file of PURE_TESTS){
  const source=readFileSync(file,'utf8');
  expect(source,file).not.toMatch(/vi\.(?:mock|doMock|resetModules|stubGlobal|useFakeTimers|spyOn)|globalThis|process\.env|@vitest-environment|beforeAll|afterAll/u);
  expect(source,file).not.toMatch(/from ['"](?:node:|[^'"]*(?:engine|game|shards)\/)/u);
 }
});

test('native source suites start with verified inputs and never wait for a product', () => {
  const registry = v.parse(v.record(v.string(), v.array(v.string())), JSON.parse(readFileSync('scripts/test-products.json', 'utf8')));
  const native = ['nalati-dressing-inputs', 'nalati-dressing-placement-program', 'nalati-dressing-source',
    'nalati-native-dressing-reader', 'nalati-place-construction', 'nalati-places-program'].map(name => `test/${name}.test.ts`);
  expect(selectTestCohort(native, registry, 'product-free')).toEqual(native);
  expect(selectTestCohort(native, registry, 'products')).toEqual([]);
  for (const path of native) {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/fixtures\/builtProduct|readBuiltShardfile/u);
    expect(source).not.toContain('authoring-shard.mjs');
  }
});

test('one preparation owns the source cache, generation and complete admission', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const prepare = workflow.split('\n  prepare:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  if (prepare === undefined) throw new Error('Missing preparation owner');
  for (const path of ['~/.cache/wildshard/shardfiles', '~/.cache/wildshard/gen', '~/.cache/wildshard/basis'])
    expect(prepare).toContain(path);
  const key = /^ {10}key: (.+)$/mu.exec(prepare)?.[1];
  expect(key).toContain(`\${{ steps.inputs.outputs.tree }}`);
  expect(key).toContain(`\${{ runner.arch }}`);
  expect(prepare).not.toMatch(/^ {4}needs:/mu);
  // Prior artifacts may supply timing hints, never generated/product inputs.
  const downloads = [...prepare.matchAll(/- uses: actions\/download-artifact@v4\n([\s\S]*?)(?=\n {6}- |$)/gu)].map(match => match[1]);
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toContain('pattern: vitest-times-*');
  expect(downloads[0]).toContain(`run-id: \${{ steps.timing-history.outputs.run }}`);
  expect(prepare).toContain('--branch main --event push --status completed');
  expect(prepare).toContain(`node scripts/vitest-plan.ts --shards ${CI_SHARD_COUNT} --workers 2`);
  const generation = prepare.indexOf('node scripts/gen.mjs --reuse');
  expect(prepare).not.toContain('node scripts/build-shardfiles.mjs');
  expect(prepare).not.toContain('node scripts/gen.mjs --inputs-only');
  const pack = prepare.indexOf('python3 scripts/ci-products.py pack\n');
  expect(generation).toBeGreaterThan(prepare.indexOf('uses: actions/cache@v4'));
  expect(pack).toBeGreaterThan(generation);
  expect(prepare.indexOf('node scripts/check-closed-components.mjs')).toBeGreaterThan(generation);
  expect(prepare.indexOf('node scripts/ci-product-cache.mjs')).toBeGreaterThan(generation);
  expect(prepare.indexOf('scripts/ci-checks.mjs --prepared')).toBeGreaterThan(pack);
});


test('every former quarantine owner remains in exactly one blocking product cohort', () => {
 const files=['test/nalati-creature-views.test.ts','test/shard-headless.test.ts','test/heavy-lane.test.ts'];
 const registry=v.parse(v.record(v.string(),v.array(v.string())),JSON.parse(readFileSync('scripts/test-products.json','utf8')));
 const selected=[...selectTestCohort(files,registry,'product-free'),...selectTestCohort(files,registry,'products')];
 expect(selected.sort()).toEqual([...files].sort());
 expect(new Set(selected).size).toBe(files.length);
 expect(() => selectTestCohort(files,registry,'quarantine')).toThrow('Unknown test cohort');
});
