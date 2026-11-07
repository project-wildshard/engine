// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual bounded native command recorder and fresh worker replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixed checked-in runner, not caller-selected source.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Same source loader used by the native worker.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Retain the current Node runtime without a shell.
import process from 'node:process';
import {expect,test} from 'vitest';
import * as v from 'valibot';

const resultSchema=v.object({phase:v.literal('replayed'),slug:v.literal('far-reach'),mode:v.picklist(['priority','gust']),
  ticks:v.number(),segments:v.number(),boardTicks:v.number(),flags:v.array(v.string())});
for(const mode of ['priority','gust'] as const)test(`Sky ${mode} verbs use real movement, actions and fresh native replay`,()=>{
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/sky-verbs-run.ts'),mode],{encoding:'utf8',timeout:30_000});
  expect(child.status,child.stdout+child.stderr).toBe(0);
  const line=child.stdout.split('\n').find(row=>row.includes('"phase":"replayed"'));
  if(line===undefined)throw new Error('Missing actual Sky verb completion');
  const result=v.parse(resultSchema,JSON.parse(line));expect(result.mode).toBe(mode);
  console.info(line);
  expect(result.ticks).toBeGreaterThan(0);expect(result.segments).toBeGreaterThan(1);
},35_000);
