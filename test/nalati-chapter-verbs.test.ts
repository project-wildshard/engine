// oxlint-disable-next-line import/no-nodejs-modules -- The real fixed native input tape owns its bounded child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained in-repository runner.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the same strict renderer-free native source loader.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('Nalati chapter journal follows completed talks and retains real progression prerequisites',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-chapter-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);expect(child.stdout).toContain('"story":"chapter-talks"');
},35_000);
