// oxlint-disable-next-line import/no-nodejs-modules -- Bound the actual field visit and independent native worker.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained fixed native fixture.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The strict source loader requires an absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('real bow inputs kill a natural raider and replay the complete flock defense',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-wolf-fight-run.ts')],{encoding:'utf8',timeout:175_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);expect(child.stdout).toContain('"story":"native-wolf-fight"');
},180_000);
