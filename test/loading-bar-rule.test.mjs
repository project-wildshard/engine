import { expect, test } from 'vitest';
import { barStalls, untracedChanges } from '../scripts/loading-bar-rule.mjs';

/** @param {number} t @param {string} bar @param {number} pct @param {Partial<import('../scripts/loading-bar-rule.mjs').BarRow>} [rest] */
const row = (t, bar, pct, rest = {}) => ({ t, bar, pct, step: '', atomic: 0, bytes: 0, files: 0, ...rest });

test('LS3: 1 % inside every 2 s passes; the edge itself passes and a millisecond over names the stage', () => {
  expect(barStalls([row(2000, 'start', 1), row(4000, 'start', 2)], 0, 4000).stalls).toEqual([]);
  const late = barStalls([row(0, 'start', 0, { step: 'start.app:three-import' }), row(2001, 'start', 1)], 0, 2001);
  expect(late.stalls).toEqual([{ from: 0, to: 2001, ms: 2001, stages: ['start.app:three-import'] }]);
});

test('LS3: the phases add up; small steps accumulate and a quiet end of boot still counts', () => {
  // half a percent on two different bars is one percent of movement
  expect(barStalls([row(1000, 'download', 0.5), row(1900, 'load', 0.5), row(3800, 'load', 1.5)], 0, 3800).stalls).toEqual([]);
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
