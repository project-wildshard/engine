// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real isolated SDK worker, not an emulated tick loop.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixed owned fixture and the native source guard.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The loader is an absolute native URL.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the same Node executable as the test.
import process from 'node:process';
import {expect,test} from 'vitest';

test('native verb tape matches ordinary ticks and preserves terminal, failure and runtime fences',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/verb-tape-run.mjs')],{encoding:'utf8',timeout:20_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain('native verb tape parity, terminal ownership and runtime refusal pass');
},25_000);
