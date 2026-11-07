// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and strict source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The native loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('a real camp walk reaches a mount, rides through native reins and dismounts',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-ride-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"camp-ride"');
},35_000);
