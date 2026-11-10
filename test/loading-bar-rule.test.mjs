import { expect, test } from 'vitest';
import { barStalls, untracedChanges } from '../scripts/loading-bar-rule.mjs';
import { timeLeftScore } from '../scripts/loading-time-left-rule.mjs';

/** @param {number} t @param {string} bar @param {number} pct @param {Partial<import('../scripts/loading-bar-rule.mjs').BarRow>} [rest] */
const row = (t, bar, pct, rest = {}) => ({ t, bar, pct, step: '', atomic: 0, bytes: 0, files: 0, ...rest });

test('J204: a visible 0.1 % inside every 2 s passes; the edge itself passes and a millisecond over names the stage', () => {
  expect(barStalls([row(2000, 'start', 0.1), row(4000, 'start', 0.2)], 0, 4000).stalls).toEqual([]);
  const late = barStalls([row(0, 'start', 0, { step: 'start.app:three-import' }), row(2001, 'start', 0.1)], 0, 2001);
  expect(late.stalls).toEqual([{ from: 0, to: 2001, ms: 2001, stages: ['start.app:three-import'] }]);
});

test('J204: a tenth read off two widths counts, despite float error', () => {
  expect(barStalls([row(0, 'load', 91.2), row(1900, 'load', 91.3), row(3800, 'load', 91.4)], 0, 3800).stalls).toEqual([]);
});

test('J204: less than a visible tenth is no advance', () => {
  const crumbs = barStalls([row(1000, 'load', 0.04), row(1900, 'load', 0.08), row(3000, 'load', 0.09)], 0, 3000);
  expect(crumbs.stalls.map(s => s.ms)).toEqual([3000]);
});

test('LS3: the phases add up; small steps accumulate and a quiet end of boot still counts', () => {
  // half a tenth on two different bars is a tenth of movement
  expect(barStalls([row(1000, 'download', 0.05), row(1900, 'load', 0.05), row(3800, 'load', 0.15)], 0, 3800).stalls).toEqual([]);
  const tail = barStalls([row(500, 'load', 90, { step: 'world' }), row(600, 'step', 0, { step: 'audio' })], 0, 5000);
  expect(tail.stalls).toEqual([{ from: 500, to: 5000, ms: 4500, stages: ['world', 'audio'] }]);
});

test('LS3: a bar never runs backwards', () => {
  expect(barStalls([row(100, 'download', 40), row(200, 'download', 30)], 0, 300).backwards).toEqual([{ t: 200, bar: 'download', from: 40, to: 30 }]);
});

test('J188: labels, unrelated counters and an unearned initial bar do not earn progress', () => {
  const log=[row(0,'load',0),row(10,'load',5,{step:'renamed',bytes:100}),row(20,'download',50,{atomic:3})];
  expect(untracedChanges(log)).toEqual(log.slice(1));
});

test('J188: phase-specific earned fractions pass and decreases or false denominators fail', () => {
  const log=[row(0,'start',0),row(10,'start',25,{source:{kind:'start',done:1,total:3,bytes:0,byteTotal:100}}),
    row(20,'download',50,{source:{kind:'download',done:50,total:100}}),
    row(30,'load',25,{source:{kind:'load',configured:true,rows:[{state:'on',fraction:.5},{state:'todo'}]}}),
    row(40,'load',30,{source:{kind:'load',configured:true,rows:[{state:'on',fraction:.5},{state:'todo'}]}}),
    row(50,'download',40,{source:{kind:'download',done:40,total:100}}),
    row(60,'start',50,{source:{kind:'start',done:9,total:3,bytes:0,byteTotal:100}})];
  expect(untracedChanges(log)).toEqual(log.slice(4));
});

test('J188: an initial positive reading must be earned by its own producer', () => {
  const good=row(0,'download',50,{source:{kind:'download',done:50,total:100}});
  expect(untracedChanges([good])).toEqual([]);
  const bad={...good,pct:51};expect(untracedChanges([bad])).toEqual([bad]);
  const unrelated={...good,bar:'load'};expect(untracedChanges([unrelated])).toEqual([unrelated]);
});

test('J188: control-ready retains exact row credit until its final completion paint',()=>{
  const source={kind:'load',configured:true,complete:true,rows:[{state:'ok',weight:998},{state:'on',weight:2}]};
  expect(untracedChanges([row(0,'load',99.8,{source}),row(1,'load',100,{source})])).toEqual([]);
  const guessed=row(0,'load',99.9,{source});expect(untracedChanges([guessed])).toEqual([guessed]);
  const premature=row(0,'load',100,{source:{...source,complete:false}});expect(untracedChanges([premature])).toEqual([premature]);
});


/** LS5: a boot that ends at `ready` ms, painted every 100 ms, with the card showing `estimate(t)` (null hides). */
const timeLeftBoot = (ready, estimate) => {
  const frames = [];
  for (let t = 0; t < ready + 300; t += 100) {
    const left = estimate(t);
    frames.push({ t, left, seconds: left === null ? null : Math.max(1, Math.round(left / 1000)) });
  }
  return frames;
};

test('LS5: a true time left passes; only the last half of the boot is scored', () => {
  const score = timeLeftScore(timeLeftBoot(20000, t => (t < 4000 ? 60000 : 20000 - t)), 20000);
  expect(score).toMatchObject({ half: 10000, frames: 100, shown: 100, within: 100, strict: 100, flickers: 0, pass: true });
});

test('LS5: 25 % off fails; under half a second off passes at the end, where 25 % is less than the card shows', () => {
  const late = timeLeftScore(timeLeftBoot(20000, t => 1.3 * (20000 - t)), 20000);
  expect(late.pass).toBe(false);
  // 30 % late is under half a second only in the last 1.6 s
  expect(late.within).toBe(16);
  expect(late.worst).toBeCloseTo(0.3, 6);
  const end = timeLeftScore(timeLeftBoot(20000, t => 20000 - t + 400), 20000);
  expect(end.pass).toBe(true);
  expect(end.strict).toBeLessThan(end.within);
});

test('LS5: hidden frames are honest and pass, but a boot that never shows a number does not', () => {
  const late = timeLeftScore(timeLeftBoot(20000, t => (t < 15000 ? null : 20000 - t)), 20000);
  expect(late).toMatchObject({ frames: 100, shown: 50, pass: true, firstShown: 15000 });
  expect(timeLeftScore(timeLeftBoot(20000, () => null), 20000).pass).toBe(false);
});

test('LS5: a rise is allowed; a rise taken back within half a second is a flicker', () => {
  const rise = timeLeftScore(timeLeftBoot(20000, t => (t < 12000 ? 0.9 * (20000 - t) : 20000 - t)), 20000);
  expect(rise.rises).toBeGreaterThan(0);
  expect(rise.flickers).toBe(0);
  const flicker = timeLeftScore(timeLeftBoot(20000, t => (t === 12000 ? 20000 - t + 2000 : 20000 - t)), 20000);
  expect(flicker.flickers).toBe(1);
  expect(flicker.pass).toBe(false);
});
