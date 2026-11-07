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

const resultSchema=v.object({phase:v.literal('replayed'),slug:v.literal('sunscar-dunes'),ticks:v.number(),quest:v.literal('sunscar.signal'),complete:v.literal(true),segments:v.number(),
  retries:v.pipe(v.number(),v.integer(),v.minValue(1)),stormRetry:v.literal(true),arenaBounded:v.literal(true)});
test('Signal earns the full quest and a bounded Matriarch storm retry through real input replay',()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/signal-story-run.ts')],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"phase":"replayed"'));
  if(line===undefined)throw new Error('Missing real native quest completion');
  const result=v.parse(resultSchema,JSON.parse(line));expect(result.ticks).toBeGreaterThan(0);expect(result.segments).toBeGreaterThan(1);
},35_000);
