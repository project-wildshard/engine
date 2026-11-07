// oxlint-disable-next-line import/no-nodejs-modules -- Execute the fixed native recorder and independent replay, under one child deadline.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Only the maintained fixture and loader can run.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The source loader requires its absolute URL.
import {pathToFileURL} from 'node:url';
import {expect,test} from 'vitest';
import * as v from 'valibot';

const result=v.object({phase:v.literal('replayed'),story:v.literal('sky-roost'),ticks:v.number(),commands:v.number(),parts:v.number(),removedSwings:v.number()});
test('Sky earns the roost with actual fan swings, while the same walk without swings cannot',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/sky-roost-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"phase":"replayed"'));
  if(line===undefined)throw new Error('Missing actual Sky roost replay');
  const observed=v.parse(result,JSON.parse(line));
  expect(observed.ticks).toBeGreaterThan(0);expect(observed.commands).toBeGreaterThan(0);
  expect(observed.parts).toBeGreaterThan(1);expect(observed.removedSwings).toBeGreaterThan(0);
  console.info(line);
},35_000);
