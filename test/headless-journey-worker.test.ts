// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual isolated SDK worker and physics host.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixed source loader and native proof fixture.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Node's fixed loader is an absolute URL.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- The child uses this same Node runtime.
import process from 'node:process';
import {expect,test} from 'vitest';

test('terminal journey matches native step movement, retires, and refuses runtime/invalid requests',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/journey-run.mjs')],{encoding:'utf8',timeout:20_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain('native journey parity, terminal disposal and runtime refusal pass');
},25_000);


test('the public route cursor loads in strip-only Node without a TypeScript transform',()=>{
  const moduleURL=pathToFileURL(resolve('src/shared/host/headlessJourney.ts')).href;
  const code=`import assert from 'node:assert/strict';
    const {PhysicsRouteCursor}=await import(${JSON.stringify(moduleURL)});
    const route=new PhysicsRouteCursor([{x:0,z:0},{x:5,z:0}]);
    assert.equal(route.command([0,0,0],0).moveX,1);
    assert.throws(()=>new PhysicsRouteCursor([]),/two finite/);`;
  const child=spawnSync(process.execPath,['--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    '--input-type=module','-e',code],{encoding:'utf8',timeout:10_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
});
