import { expect, test } from 'vitest';
import { FrameWindow } from './frameWindow';

test.each([30, 60])('completed draws report %i wall-clock fps', fps => {
  const window = new FrameWindow(0, 0);
  for (let i = 1; i <= fps * 2; i++) window.observe(i, Math.round(i * 1000 / fps));
  expect(window.read(2000).fps).toBe(fps);
});

test('one resumed draw after a second-long freeze reads one fps and retains its peak', () => {
  const window = new FrameWindow(0, 0);
  for (let i = 1; i <= 60; i++) window.observe(i, Math.round(i * 1000 / 60));
  window.observe(61, 2000);
  expect(window.read(2000)).toEqual({ fps: 1, worst: 1000 });
  for (let i = 1; i <= 50; i++) window.observe(61 + i, 2000 + i * 20);
  expect(window.read(3000)).toEqual({ fps: 50, worst: 1000 });
  for (let i = 51; i <= 151; i++) window.observe(61 + i, 2000 + i * 20);
  expect(window.read(5020)).toEqual({ fps: 50, worst: 20 });
});

test('a timer observes zero fps and a growing gap when every draw stops', () => {
  const window = new FrameWindow(0, 0);
  window.observe(1, 20);
  expect(window.read(1020)).toEqual({ fps: 0, worst: 1000 });
  expect(window.read(2020)).toEqual({ fps: 0, worst: 2000 });
});

test('polling cannot duplicate a draw or credit an undated synchronous draw', () => {
  const window = new FrameWindow(0, 0);
  window.observe(1, null); window.observe(1, null);
  window.observe(2, 500); window.observe(2, 500);
  expect(window.read(1000)).toEqual({ fps: 1, worst: 500 });
});

test('explicit reactivation excludes the hidden menu interval', () => {
  const window = new FrameWindow(0, 0);
  window.observe(1, 20);
  window.reset(10_000, 1);
  window.observe(2, 10_020);
  expect(window.read(10_020)).toEqual({ fps: 50, worst: 20 });
});
