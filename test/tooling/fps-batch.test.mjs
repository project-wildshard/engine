import { expect, test } from 'vitest';
import { retryColdBoot, runBatch } from '../../scripts/fps/batch.mjs';

test('an interrupted capture never starts the next cold profile', async () => {
  let stopped = false;
  const started = [], recorded = [];
  const status = await runBatch(['phone','desktop'], async job => {
    started.push(job); stopped = true; return 3;
  }, job => recorded.push(job), () => stopped);
  expect(status).toBe(3);
  expect(started).toEqual(['phone']);
  expect(recorded).toEqual([]);
});

test('a foreign GPU user yields the whole lease without starting another profile', async () => {
  const started = [], recorded = [];
  const status = await runBatch(['low','high','native'], async job => {
    started.push(job); return job === 'high' ? 75 : 0;
  }, job => recorded.push(job), () => false);
  expect(status).toBe(75);
  expect(started).toEqual(['low','high']);
  expect(recorded).toEqual(['low']);
});

test('a failed profile preserves subsequent independent captures and fails the batch', async () => {
  const recorded = [];
  const status = await runBatch(['low','high','native'], async job => job === 'high' ? 3 : 0,
    (job,result) => recorded.push([job,result]), () => false);
  expect(status).toBe(3);
  expect(recorded).toEqual([['low',0],['high',3],['native',0]]);
});


test('only a failed boot with no control or route samples gets one fresh chance', () => {
  const boot = {browser:'Chromium',cold:{verdict:'incomplete',boot:{routeStarted:false}},warm:null};
  expect(retryColdBoot(boot)).toBe(true);
  expect(retryColdBoot({...boot,cold:{...boot.cold,boot:{routeStarted:true}}})).toBe(false);
  expect(retryColdBoot({...boot,cold:{...boot.cold,legs:[{name:'dock spawn',error:'lost frames'}]}})).toBe(false);
  expect(retryColdBoot({...boot,cold:{verdict:'miss'}})).toBe(false);
  expect(retryColdBoot({...boot,cold:{verdict:'incomplete'}})).toBe(false);
  expect(retryColdBoot(null)).toBe(false);
});
