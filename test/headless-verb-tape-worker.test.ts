// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real isolated SDK worker, not an emulated tick loop.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixed owned fixture and the native source guard.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The loader is an absolute native URL.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the same Node executable as the test.
import process from 'node:process';
import {expect,test} from 'vitest';
import {loadScaledMs} from './fixtures/loadBudget';

// The child's fence is 20 s on an idle machine (the file passes alone in about 9 s). Under other lanes' pre-push load
// (35-50 on 18 cores, 2026-11-16) its cold first tick ran past a fixed 20 s; the fence now scales with load per core.
const FENCE_MS=loadScaledMs(20_000);

test('native verb tape matches ordinary ticks and preserves terminal, failure and runtime fences',()=>{
  const child=spawnSync(process.execPath,['--import',pathToFileURL(resolve('src/scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/verb-tape-run.mjs')],{encoding:'utf8',timeout:FENCE_MS});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain('native verb tape parity, terminal ownership and runtime refusal pass');
},FENCE_MS+5_000);
