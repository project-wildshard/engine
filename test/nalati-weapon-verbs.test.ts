// oxlint-disable-next-line import/no-nodejs-modules -- Run fixed native commands and their independent worker replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained fixed fixture and loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('real held inputs drive the bow, three-hit sabre/heavy/pass and spear/javelin laws',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-weapons-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"native-weapons"');
},35_000);
