// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and strict source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The source loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('J108: in real Nalati a bot breaks the stallion for its own mount and the wild refills',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-bot-taming-run.ts')],{encoding:'utf8',timeout:150_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"bot-taming"');
},155_000); // the bound stops a hang and claims no speed: 18 s on a laptop passed 60 s on a CI runner
