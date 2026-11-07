// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real installed sequencer in bounded child runs.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns its synthetic specs, plan and dispatch trace.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only repository tooling and private scratch inputs.
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createShardPlan } from '../scripts/test-shard-plan';

const owned: string[] = [], sha = 'a'.repeat(40);
afterEach(() => { for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(stockSort = false) {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/vitest-plan-order-')); owned.push(directory);
  const trace = resolve(directory, 'dispatch.jsonl'), order = resolve(directory, 'sort.txt'), config = resolve(directory, 'vitest.config.mjs'), plan = resolve(directory, 'plan.json');
  const names = ['large-fast', 'medium', 'small-slow', 'pure'], paths = names.map(name => resolve(directory, `${name}.test.ts`));
  for (const [i, path] of paths.entries()) writeFileSync(path, `import {test,expect} from 'vitest';
import {appendFileSync} from 'node:fs';
test('dispatch',()=>{appendFileSync(${JSON.stringify(trace)},${JSON.stringify(`${names[i]}\n`)});expect(2+2).toBe(4);});
/*${' padding '.repeat(i === 0 ? 3000 : i === 1 ? 300 : 0)}*/`);
  const relative = paths.map(path => path.slice(resolve('.').length + 1));
  const weights = new Map(relative.map((path, i) => [path, [1, 20, 100, .5][i] ?? 1]));
  writeFileSync(plan, JSON.stringify(createShardPlan(relative, weights, { count: 1, workers: 1, sha, run: '1', fallbackSeconds: 1, measuredFiles: 4 })));
  const base = resolve('vitest.config.ts'), sequencer = resolve('scripts/vitest-shard.ts');
  writeFileSync(config, `import base from ${JSON.stringify(base)};
import {DurationSequencer} from ${JSON.stringify(sequencer)};
import {writeFileSync} from 'node:fs';
import {BaseSequencer} from 'vitest/node';
class ObservedSequencer extends DurationSequencer {async sort(files){const checked=await super.sort(files);const sorted=${stockSort?'await BaseSequencer.prototype.sort.call(this,checked)':'checked'};writeFileSync(${JSON.stringify(order)},sorted.map(file=>file.moduleId.split('/').at(-1).replace('.test.ts','')).join('\\n'));return sorted;}}
export default {...base,cacheDir:${JSON.stringify(resolve(directory, 'vite'))},test:{...base.test,maxWorkers:1,setupFiles:[],sequence:{sequencer:ObservedSequencer},projects:[
{...base,extends:false,test:{...base.test,name:'a-isolated',include:${JSON.stringify(paths.slice(0, 3))},setupFiles:[],isolate:true,pool:'forks'}},
{...base,extends:false,test:{...base.test,name:'z-pure',include:${JSON.stringify(paths.slice(3))},setupFiles:[],isolate:false,pool:'forks'}}]}};`);
  return { directory, trace, order, config, plan, paths };
}
function run(input: ReturnType<typeof fixture>, mode: 'planned' | 'default' | 'wrong-source') {
  const env = { ...process.env, WS_VITEST_MAX_WORKERS: '1' };
  for (const name of ['WS_VITEST_PLAN', 'WS_TEST_COHORT', 'WS_COMMIT_RELATED_TOKEN', 'GITHUB_SHA', 'GITHUB_RUN_ID']) Reflect.deleteProperty(env, name);
  if (mode !== 'default') Object.assign(env, { WS_VITEST_PLAN: input.plan, GITHUB_SHA: mode === 'wrong-source' ? 'b'.repeat(40) : sha, GITHUB_RUN_ID: '1' });
  const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', ...input.paths,
    '--config', input.config, '--shard=1/1'], { encoding: 'utf8', timeout: 10_000, env });
  return { result, trace: existsSync(input.trace) ? readFileSync(input.trace, 'utf8').trim().split('\n') : [],
    order: existsSync(input.order) ? readFileSync(input.order, 'utf8').trim().split('\n') : [] };
}

test('the checked plan dispatches small slow wrappers first within the original project boundaries', () => {
  const stock = run(fixture(true), 'planned');
  expect(stock.result.status, stock.result.stdout + stock.result.stderr).toBe(0);
  expect(stock.order).toEqual(['large-fast', 'medium', 'small-slow', 'pure']);
  const { result, trace, order } = run(fixture(), 'planned');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(order).toEqual(['small-slow', 'medium', 'large-fast', 'pure']);
  expect([...trace].sort()).toEqual(['large-fast', 'medium', 'pure', 'small-slow']);
});

test('a local run without a plan retains the original file-size order', () => {
  const { result, trace, order } = run(fixture(), 'default');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(order).toEqual(['large-fast', 'medium', 'small-slow', 'pure']);
  expect([...trace].sort()).toEqual(['large-fast', 'medium', 'pure', 'small-slow']);
});

test('the original plan source guard refuses before dispatching any file', () => {
  const { result, trace, order } = run(fixture(), 'wrong-source');
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout + result.stderr).toContain('Shard plan source/run differs');
  expect(trace).toEqual([]); expect(order).toEqual([]);
});
