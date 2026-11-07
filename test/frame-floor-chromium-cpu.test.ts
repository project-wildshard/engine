import {expect, test} from 'vitest';
import {frameFloorChromiumCpuRate, validateFrameFloorArgs} from '../scripts/frame-floor-args.mjs';

test('ordinary floor remains unthrottled and phone CPU attribution is explicit', () => {
  expect(frameFloorChromiumCpuRate([])).toBe(1);
  const args = ['--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--cpu-profile=tmp/profile'];
  expect(frameFloorChromiumCpuRate(args)).toBe(4);
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
});

test('invalid CPU diagnostics refuse before browser or Simulator admission', () => {
  const base = ['--surface=desktop', '--chromium-phone', '--cpu-profile=tmp/profile'];
  for (const value of ['', '0', '-1', '1.5', '21', 'NaN'])
    expect(() => validateFrameFloorArgs([...base, `--chromium-cpu=${value}`])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs([...base, '--chromium-cpu=4', '--chromium-cpu=6'])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs(['--surface=sim', '--chromium-phone', '--chromium-cpu=4', '--cpu-profile=tmp/profile'])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs(['--surface=desktop', '--chromium-cpu=4', '--cpu-profile=tmp/profile'])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs(['--surface=desktop', '--chromium-phone', '--chromium-cpu=4'])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs([...base, '--chromium-cpu=4', '--quiet'])).toThrow('Quiet frame floors');
  expect(() => validateFrameFloorArgs([...base, '--chromium-cpu=4', '--regrade=progress/frame-floor/old.json'])).toThrow('diagnostic phone Chromium');
  expect(() => validateFrameFloorArgs(['--chromium-cp=4'])).toThrow('Unknown frame-floor');
});
