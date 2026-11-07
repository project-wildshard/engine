// oxlint-disable-next-line import/no-nodejs-modules -- One bounded native recorder and fresh independent workers.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixed checked-in runner and source loader only.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Native source loader requires its absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';
import * as v from 'valibot';

const result=v.object({phase:v.literal('replayed'),story:v.picklist(['sky-vanes','sky-winch','sky-roc']),ticks:v.number(),commands:v.number(),parts:v.number(),removedGusts:v.number(),removedWinches:v.number(),removedRocAttacks:v.number(),rocDamageChanges:v.number(),negativeThroughTick:v.number()});
for(const stage of ['vanes','winch','roc'] as const)test(stage==='vanes'
  ?'Sky turns all three vanes through real GUSTs; movement alone cannot turn them'
  :stage==='winch'?'Sky earns the winch after the roost and vanes; omitting USE cannot raise the bridge'
  :'Sky defeats the Storm Roc with actual fan contacts and exact fresh-worker replay',()=>{
  const started=performance.now();
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/sky-roost-run.ts'),stage],{encoding:'utf8',timeout:30_000});
  const outcome=child.stdout+child.stderr+JSON.stringify({error:child.error?.message,code:child.error!==undefined&&'code' in child.error?child.error.code:null,signal:child.signal,elapsedMs:performance.now()-started});
  expect(child.error,outcome).toBeUndefined();expect(child.signal,outcome).toBeNull();expect(child.status,outcome).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"phase":"replayed"'));
  if(line===undefined)throw new Error('Missing actual Sky progression replay');
  const observed=v.parse(result,JSON.parse(line));
  expect(observed.ticks).toBeGreaterThan(0);expect(observed.commands).toBeGreaterThan(0);
  expect(observed.story).toBe(`sky-${stage}`);expect(observed.parts).toBeGreaterThan(1);
  expect(stage==='vanes'?observed.removedGusts:stage==='winch'?observed.removedWinches:observed.removedRocAttacks).toBeGreaterThan(0);
  if(stage==='roc'){expect(observed.rocDamageChanges).toBeGreaterThan(1);expect(observed.negativeThroughTick).toBeGreaterThan(0);}
  console.info(line);
},35_000);
