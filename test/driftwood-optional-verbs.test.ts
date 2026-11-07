// oxlint-disable-next-line import/no-nodejs-modules -- A fixed native recorder and its independent replay own one bounded child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- No caller-selected executable or fixture source.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Same strict source loader as the native worker.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';
import * as v from 'valibot';

const result=v.object({story:v.picklist(['driftwood-optional','driftwood-reef']),ticks:v.number(),commands:v.number(),parts:v.number(),glass:v.number(),vista:v.number(),doubloons:v.number(),divingTicks:v.number(),boardTicks:v.number()});
for(const stage of ['bench','reef'] as const)test(stage==='bench'
  ?'Driftwood walk-in glass and bench USE earn their real counters exactly once'
  :'Driftwood reaches the reef through real HOVER, swim and DIVE before opening its treasure',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/driftwood-optional-run.ts'),stage],{encoding:'utf8',timeout:stage==='reef'?60_000:30_000});
  const outcome=JSON.stringify({stage,status:child.status,signal:child.signal,error:child.error?.message});
  expect(child.error,`${outcome}\n${child.stdout}${child.stderr}`).toBeUndefined();
  expect(child.status,`${outcome}\n${child.stdout}${child.stderr}`).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"story":"driftwood-'));
  if(line===undefined)throw new Error('Missing actual optional Driftwood replay');
  const observed=v.parse(result,JSON.parse(line));
  expect(observed.ticks).toBeGreaterThan(0);expect(observed.commands).toBeGreaterThan(0);expect(observed.parts).toBeGreaterThan(1);
  if(stage==='bench'){expect(observed.glass).toBe(2);expect(observed.vista).toBe(1);}
  else{expect(observed.doubloons).toBe(8);expect(observed.divingTicks).toBeGreaterThan(0);expect(observed.boardTicks).toBeGreaterThan(0);}
  console.info(line);
},35_000);
