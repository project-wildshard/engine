// oxlint-disable-next-line import/no-nodejs-modules -- Execute actual native reins in the bounded input recorder/replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixed checked-in runner only.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Same renderer-free loader as the trusted native worker.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';

test('Nalati borrowed-horse Kokpar earns and replays its real delivery checkpoint',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-kokpar-run.ts')],{encoding:'utf8',timeout:150_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain('"story":"kokpar"');
// The full entry, mounted bank climb and earned checkpoint use the existing
// native field-taming proof's finite ceiling; shorter camp tests stay unchanged.
},180_000);
