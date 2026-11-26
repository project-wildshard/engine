import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the maintained page probe without a browser.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Supply deterministic browser frame callbacks.
import { runInNewContext } from 'node:vm';

interface Probe { on: boolean; drawn: number[]; slowMs: number; slowFrames: number }
const source = readFileSync(new URL('../src/scripts/net-lag-proof.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function pageProbe('), end = source.indexOf('/** @param {number[]} list', start);
if (start === -1 || end <= start) throw new Error('Missing maintained page probe');

function fixture() {
  let callbacks: ((now: number) => void)[] = [];
  const intervals: (() => void)[] = [];
  const renderer = { render: () => undefined };
  let clock = 0;
  const window: { __wildshard: unknown; __netLag?: Probe } = {
    __wildshard: { world: { game: { renderer } } },
  };
  runInNewContext(`${source.slice(start, end)}; pageProbe(0)`, {
    window,
    requestAnimationFrame: (callback: (now: number) => void) => { callbacks.push(callback); },
    setInterval: (callback: () => void) => { intervals.push(callback); },
    performance: { now: () => clock++ },
  });
  for (const hook of intervals) hook();
  const probe = window.__netLag;
  if (probe === undefined) throw new Error('Page probe did not initialize');
  probe.on = true;
  return {
    probe,
    frame: (now: number, passes = 0) => {
      const ready = callbacks;
      callbacks = [];
      for (const callback of ready) callback(now);
      for (let pass = 0; pass < passes; pass++) renderer.render();
    },
  };
}

test('forced slow frames count once per drawn frame across render passes', () => {
  const { probe, frame } = fixture();
  probe.slowMs = 60;
  frame(0, 3); frame(60, 2); frame(120, 0);
  expect(probe.slowFrames).toBe(2);
  probe.slowMs = 0; frame(180, 1);
  expect(probe.slowFrames).toBe(2);
});

test('draw gaps use the rendering frame rather than the following observer frame', () => {
  const { probe, frame } = fixture();
  frame(67, 1); frame(84); frame(100, 1); frame(140, 1);
  frame(157); frame(173, 1); frame(190);
  // The old next-observer timestamps fabricate a 56 ms gap from 40 ms-or-less draws.
  expect(probe.drawn).toEqual([33, 40, 33]);
});

test('offscreen and main passes count as one draw, including timestamp zero', () => {
  const { probe, frame } = fixture();
  frame(0, 3); frame(16); frame(33, 2); frame(50); frame(66, 1);
  expect(probe.drawn).toEqual([33, 33]);
});
