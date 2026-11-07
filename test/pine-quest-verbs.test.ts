// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Real Node worker and native command replay, with no renderer.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixed in-repository runner is the only command source.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Same checked native loader as the maintained worker.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Reuse the current Node binary; no shell command string.
import process from 'node:process';
import {expect,test} from 'vitest';
import * as v from 'valibot';

const resultSchema=v.object({phase:v.literal('replayed'),slug:v.literal('pine-hollow'),ticks:v.number(),quest:v.literal('wardens-hollow'),complete:v.literal(true),segments:v.number()});
test('Pine earns every story step through native commands and replays the fresh input frames',()=>{
  const started=performance.now();
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/pine-story-run.ts')],{encoding:'utf8',timeout:30_000});
  const facts=JSON.stringify({phase:'pine-child-exit',milliseconds:performance.now()-started,status:child.status,signal:child.signal,
    error:child.error===undefined?null:{name:child.error.name,message:child.error.message,code:'code' in child.error?child.error.code:null}});
  const details=`${facts}\n${child.stdout}${child.stderr}`;
  expect(child.error,details).toBeUndefined();
  expect(child.status,details).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"phase":"replayed"'));
  if(line===undefined)throw new Error('Missing real native quest completion');
  const result=v.parse(resultSchema,JSON.parse(line));expect(result.ticks).toBeGreaterThan(0);expect(result.segments).toBeGreaterThan(1);
  console.info(facts);
  for(const row of child.stdout.split('\n'))if(row.includes('"phase":"timing"')||row.includes('"phase":"replayed"'))console.info(row);
},35_000);
