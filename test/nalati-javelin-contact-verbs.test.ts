// oxlint-disable-next-line import/no-nodejs-modules -- Bound each real entry visit and independent native replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the maintained fixed fixture.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

const mode='javelin';
test(`real ${mode} inputs strike a natural raider and replay its native state`,()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-polearm-contact-run.ts'),mode],{encoding:'utf8',timeout:175_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);expect(child.stdout).toContain(`"story":"native-polearm-${mode}"`);
},180_000);
