// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and strict source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The native loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

// The walk took 36 s at load 60 against the old 30 s cap (opus-pvpage land, 2026-11-26): room for a loaded gate.
test('a real camp walk reaches a mount, rides through native reins and dismounts',()=>{
  const child=spawnSync(process.execPath,['--import',pathToFileURL(resolve('src/scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-ride-run.ts')],{encoding:'utf8',timeout:90_000});
  if(child.error!==undefined)throw child.error;
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"camp-ride"');
},95_000);
