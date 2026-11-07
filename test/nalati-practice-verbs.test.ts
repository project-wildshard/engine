// oxlint-disable-next-line import/no-nodejs-modules -- Keep real native inventory replay inside the original short proof bounds.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained native proof and strict loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader takes an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('actual practice inputs lend the admitted rifle and revoke it on exit without permanent ownership',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-practice-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain('"story":"native-practice-loan"');
},35_000);
