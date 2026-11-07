// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed native worker in an owned child.
import {execFile} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Await exit without blocking Vitest's cancellation clock.
import {promisify} from 'node:util';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixture and strict source loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The source loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('J108: in real Nalati a bot breaks the stallion for its own mount and the wild refills',async({signal})=>{
  const child=await promisify(execFile)(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-bot-taming-run.ts')],{encoding:'utf8',timeout:240_000,signal});
  expect(child.stdout).toContain('"story":"bot-taming"');
},245_000); // Full five-round native story: measured 148.6 s on CI, 72.8 s with the bounded outer pool.
