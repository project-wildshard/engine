// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict source loader requires its absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('the continuous lookout walk and actual cable landing earn the zipline feat',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/driftwood-story-run.ts'),'zipline'],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain('"story":"zipline"');
},35_000);
