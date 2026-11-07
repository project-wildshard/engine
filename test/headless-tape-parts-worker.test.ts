// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual isolated native worker with fixed source.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Select only the checked-in fixture and normal native loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Node imports the loader by file URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('bounded tape parts retain the same resident and native checkpoint across requests',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/tape-parts-run.mjs')],{encoding:'utf8',timeout:20_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain('bounded tape parts retain native parity, commits, ownership, aggregate budgets and request deadlines');
},25_000);
