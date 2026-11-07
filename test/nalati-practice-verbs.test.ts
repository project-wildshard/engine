// oxlint-disable-next-line import/no-nodejs-modules -- Keep real native inventory replay inside the original short proof bounds.
import {execFile} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Await exit without blocking Vitest's cancellation clock.
import {promisify} from 'node:util';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained native proof and strict loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader takes an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('actual practice inputs lend the admitted rifle and revoke it on exit without permanent ownership',async({signal})=>{
  const child=await promisify(execFile)(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-practice-run.ts')],{encoding:'utf8',timeout:60_000,signal});
  expect(child.stdout).toContain('"story":"native-practice-loan"');
},65_000); // Cold product admission, independent replay, restore and worker retirement exceeded 30 s on CI.
