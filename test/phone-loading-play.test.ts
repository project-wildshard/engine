import {expect, test} from 'vitest';
import {parsePlayCapture, playReading, type PlayCapture} from '../scripts/phone-loading/play';

/** `fps` drawn frames a second for `seconds`, the frame at `slowAt` (ms after start) taking `slowMs` instead */
function capture(seconds: number, fps: number, slow?: {at: number; ms: number}): PlayCapture {
  const frames = [], track = [];
  for (let at = 1000 / fps; at <= seconds * 1000; at += 1000 / fps) frames.push({at: 10_000 + at, ms: 1000 / fps});
  if (slow !== undefined) frames.push({at: 10_000 + slow.at, ms: slow.ms});
  for (let at = 0; at <= seconds * 1000; at += 250) {
    const boost = at >= 10_000;
    track.push({at: 10_000 + at, x: boost ? 10 + (at - 10_000) / 25 : at / 1000, z: 0, v: boost ? 40 : 1, hover: boost, boost, phase: boost ? 'boost' : 'walk'});
  }
  return {start: 10_000, seconds, frames, pageGaps: [], track, phase: 'done'};
}

test('a steady walk and boost at 30 fps passes every line', () => {
  const reading = playReading(capture(30, 30), 9_900);
  expect(reading).toMatchObject({startAfterControlMs: 100, firstSecondFps: 30, settledFps: 30, framesOver250: 0,
    pass: {noFrameOver250ms: true, steadyFromSecondOne: true, walkedAndBoosted: true}});
  expect(reading.motion.walkM).toBeGreaterThanOrEqual(5);
});

test('one 400 ms frame fails the 250 ms line, a slow first second the steady one', () => {
  expect(playReading(capture(30, 30, {at: 2_000, ms: 400}), null).pass.noFrameOver250ms).toBe(false);
  const slowStart = capture(30, 30);
  slowStart.frames = slowStart.frames.filter(frame => frame.at > 11_000 || Math.round(frame.at) % 200 === 0);
  expect(playReading(slowStart, null).pass.steadyFromSecondOne).toBe(false);
});

test('the page capture parses field by field and refuses a malformed row', () => {
  const page = capture(12, 30);
  expect(parsePlayCapture(JSON.stringify(page))).toEqual(page);
  expect(parsePlayCapture('null')).toBeNull();
  expect(() => parsePlayCapture(JSON.stringify({...page, frames: [{at: 'x', ms: 1}]}))).toThrow('Invalid play frame');
});
