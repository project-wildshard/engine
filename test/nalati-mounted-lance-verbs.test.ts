// oxlint-disable-next-line import/no-nodejs-modules -- Bound the real mounted visit and independent native replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained native proof.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader uses an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('real mounted steering lands a lance contact and restores its exact native continuation',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-mounted-lance-run.ts')],{encoding:'utf8',timeout:175_000});
  console.info(child.stdout);
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain('"story":"native-mounted-lance"');
},180_000);
