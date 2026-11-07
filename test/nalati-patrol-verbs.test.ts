// oxlint-disable-next-line import/no-nodejs-modules -- Keep the original bounded native subprocess and loader.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the checked-in proof.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader requires an explicit file URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('Nalati night riders appear naturally and retain an unearned captain gate after native restore',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-patrol-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain('"story":"nalati-night-patrol"');
},35_000);
