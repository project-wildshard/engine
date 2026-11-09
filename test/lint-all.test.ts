// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the lint runner through an isolated fake CLI.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Test artifacts stay in the repository scratch root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the real runner before creating its fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the fixture's pinned CLI with the current runtime.
import { env, execPath } from 'node:process';
import { expect, test } from 'vitest';
import { lintEnvironment } from '../scripts/lint-tools.mjs';

test('one typed process covers the complete selection and propagates failure', () => {
  mkdirSync('tmp', { recursive: true });
  const fixture = mkdtempSync(resolve('tmp', 'lint-all-'));
  const binary = resolve(fixture, 'node_modules/oxlint/bin'), calls = resolve(fixture, 'calls.txt');
  mkdirSync(binary, { recursive: true });
  writeFileSync(resolve(binary, '../package.json'), JSON.stringify({ type: 'module' }));
  const runner = resolve(fixture, 'scripts/lint-all.mjs');
  mkdirSync(resolve(runner, '..'));
  writeFileSync(runner, readFileSync('scripts/lint-all.mjs', 'utf8'));
  writeFileSync(resolve(fixture, 'scripts/lint-tools.mjs'), readFileSync('scripts/lint-tools.mjs', 'utf8'));
  const nativeEnvironment = lintEnvironment();
  const files = Array.from({ length: 1025 }, (_, index) => resolve(fixture, `source ${index}.ts`));
  for (const file of files) writeFileSync(file, 'export const value = 0;');
  const selection = resolve(fixture, 'files.txt');
  writeFileSync(selection, files.join('\n'));
  const cli = resolve(binary, 'oxlint');
  writeFileSync(cli, String.raw`import * as fs from 'node:fs';
const args = process.argv.slice(process.argv[2] === '-c' ? 4 : 2);
if (args.join(' ') === '--debug files') {
  process.stdout.write(fs.readFileSync(process.env.LINT_ALL_SELECTION, 'utf8'));
} else {
  if (args[0] !== '--type-aware') process.exit(9);
  const threads = Number(args[2]);
  if (args[1] !== '--threads' || !Number.isSafeInteger(threads) || threads < 1 || threads > 8) process.exit(9);
  const goThreads = Number(process.env.GOMAXPROCS);
  if (!Number.isSafeInteger(goThreads) || goThreads < 1 || goThreads > threads) process.exit(9);
  if (process.env.LINT_ALL_EXPECT_GO && process.env.GOMAXPROCS !== process.env.LINT_ALL_EXPECT_GO) process.exit(9);
  if (!process.env.LINT_ALL_EXPECT_GO && goThreads !== Math.min(process.platform === 'darwin' ? 4 : 8, threads)) process.exit(9);
  for (const name of ['GOGC', 'GOMEMLIMIT']) {
    const expected = process.env['LINT_ALL_EXPECT_' + name];
    if (expected && process.env[name] !== expected) process.exit(9);
  }
  if (process.platform === 'darwin' && !process.env.LINT_ALL_EXPECT_GOGC && process.env.GOGC !== '200') process.exit(9);
  if (process.platform === 'darwin' && !process.env.LINT_ALL_EXPECT_GOMEMLIMIT && process.env.GOMEMLIMIT !== '5GiB') process.exit(9);
  fs.appendFileSync(process.env.LINT_ALL_CALLS, args.slice(3).join('\n') + '\n--batch--\n');
  if (process.env.LINT_ALL_FAIL === 'yes' && args.some(file => file.endsWith('source 256.ts'))) process.exit(7);
}
`, { mode: 0o755 });
  const run = (failure: boolean, args: readonly string[] = [], settings: { workers?: string; gc?: string; memory?: string } = {}): ReturnType<typeof spawnSync> => spawnSync(execPath, [runner, ...args], {
    encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(nativeEnvironment).filter(([key]) => !['GOMAXPROCS', 'GOGC', 'GOMEMLIMIT'].includes(key))),
      ...(settings.workers === undefined ? {} : { GOMAXPROCS: settings.workers, LINT_ALL_EXPECT_GO: settings.workers }),
      ...(settings.gc === undefined ? {} : { GOGC: settings.gc, LINT_ALL_EXPECT_GOGC: settings.gc }),
      ...(settings.memory === undefined ? {} : { GOMEMLIMIT: settings.memory, LINT_ALL_EXPECT_GOMEMLIMIT: settings.memory }),
      LINT_ALL_SELECTION: selection, LINT_ALL_CALLS: calls, LINT_ALL_FAIL: failure ? 'yes' : 'no' },
  });
  try {
    const success = run(false);
    expect(success.status, success.stderr.toString()).toBe(0);
    const batches = readFileSync(calls, 'utf8').trim().split('\n--batch--').filter(Boolean).map(batch => batch.trim().split('\n'));
    expect(batches.flat()).toEqual(files);
    expect(batches.map(batch => batch.length)).toEqual([1025]);
    writeFileSync(calls, '');
    expect(run(true).status).toBe(7);
    expect(readFileSync(calls, 'utf8').match(/--batch--/gu)).toHaveLength(1);
    expect(readFileSync(calls, 'utf8')).toContain('source 1024.ts');
    writeFileSync(calls,'');
    expect(run(false,['--threads=4']).status).toBe(0);
    expect(readFileSync(calls,'utf8').match(/--batch--/gu)).toHaveLength(1);
    expect(readFileSync(calls,'utf8').split('\n').filter(line=>line.length>0 && line!=='--batch--')).toEqual(files);
    expect(run(false, [], { workers: '1', gc: '100', memory: '3GiB' }).status).toBe(0);
    for (const invalid of ['--shard=1/1','--shard=1/5','--shard=0/4','--shard=bad','--threads=0','--threads=9','--type-aware','source.ts']) {
      expect(run(false, [invalid]).status).toBe(2);
    }

    writeFileSync(selection, 'missing-lint-source.ts');
    expect(run(false).status).toBe(1);
    rmSync(cli);
    expect(run(false).status).toBe(1);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('CI runs one complete type and typed-lint job with verified inputs', () => {
  const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
  const job=workflow.split('\n  typecheck-lint:')[1]?.split('\n  prepare:')[0]??'';
  expect(job).not.toContain('strategy:');expect(job).not.toContain('matrix.');
  expect(job).not.toContain('lint:fast');expect(job).not.toContain('--shard=');
  expect(job).toContain('python3 scripts/ci-products.py unpack');
  expect(job).toContain('python3 scripts/ci-fail-fast.py -- /usr/bin/time -v bash scripts/typecheck-lint.sh');
  const body=readFileSync('scripts/typecheck-lint.sh','utf8');
  expect(body.match(/pnpm exec npr tsc -b tsconfig\.layers\.json --builders 1/gu)).toHaveLength(1);
  expect(body.match(/pnpm run lint:typed --threads=4/gu)).toHaveLength(1);
  expect(body).toContain('wait "$typecheck_pid"');expect(body).toContain('wait "$typed_lint_pid"');
});

test('the combined CI command overlaps both checks and drains each failure',()=>{
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/combined-type-lint-'));
 try{
  mkdirSync(resolve(root,'bin'));writeFileSync(resolve(root,'package.json'),'{}');
  writeFileSync(resolve(root,'bin/pnpm'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),kind=args[0]==='exec'?'types':'lint',other=kind==='types'?'lint':'types';
fs.appendFileSync('trace.txt',kind+':start:'+args.join(' ')+'\\n');fs.writeFileSync(kind+'.started','');
let complete=false;const watcher=fs.watch('.',finish);
function finish(){if(!complete&&fs.existsSync(other+'.started')){complete=true;watcher.close();fs.appendFileSync('trace.txt',kind+':finish\\n');process.exit(Number(process.env[kind==='types'?'TYPE_STATUS':'LINT_STATUS']));}}
finish();setTimeout(()=>{watcher.close();process.exit(70);},2000).unref();
`,{mode:0o755});
  for(const [index,statuses]of [[0,0],[7,0],[0,9],[7,9]].entries()){
   const [types,lint]=statuses;if(types===undefined || lint===undefined)throw new Error('Missing status');
   const cwd=resolve(root,`case-${index}`);mkdirSync(cwd);
   const run=spawnSync('bash',[resolve('scripts/typecheck-lint.sh')],{cwd,encoding:'utf8',env:{...env,PATH:`${resolve(root,'bin')}:${env['PATH']??''}`,TYPE_STATUS:String(types),LINT_STATUS:String(lint)}});
   expect(run.status,run.stdout+run.stderr).toBe(types || lint);
   const trace=readFileSync(resolve(cwd,'trace.txt'),'utf8').trim().split('\n');
   expect(trace.slice(0,2).every(line=>line.includes(':start:'))).toBe(true);
   expect(trace).toContain('types:start:exec npr tsc -b tsconfig.layers.json --builders 1 --force');
   expect(trace).toContain('lint:start:run lint:typed --threads=4');
   expect(trace.filter(line=>line.endsWith(':finish')).sort()).toEqual(['lint:finish','types:finish']);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
