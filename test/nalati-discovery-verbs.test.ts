// oxlint-disable-next-line import/no-nodejs-modules -- Run only the fixed renderer-free native input proof.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the checked-in proof and strict native loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The loader accepts an explicit local URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('Nalati places require real native arrival and survive independent input replay',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-discovery-run.ts')],{encoding:'utf8',timeout:150_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain('"story":"nalati-discoveries"');
  console.info(child.stdout.trim());
},180_000);
