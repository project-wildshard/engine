// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The source loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('real rail USE and typed text name a camp horse without granting a bond',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-name-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"name-horse"');
},35_000);
