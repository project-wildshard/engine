import {expect, test} from 'vitest';
import {frameFloorStanding} from '../scripts/frame-floor-standing.mjs';
import {validateFrameFloorArgs} from '../scripts/frame-floor-args.mjs';

const pose = {name: 'road-entry', x: 0, y: 1.7, z: -241, yaw: Math.PI, pitch: 0};

test('fixed standing inputs retain exact positions and require full coverage', () => {
  const source = {'open-plot-mosslight-ruins': [pose]};
  expect(frameFloorStanding(source, ['open-plot-mosslight-ruins'])).toEqual(source);
  expect(frameFloorStanding({_template: [pose]}, ['_template'])).toEqual({_template: [pose]});
  expect(() => frameFloorStanding(source, ['grid'])).toThrow('exactly');
  expect(() => frameFloorStanding(source, [])).toThrow('exactly');
  expect(() => validateFrameFloorArgs(['--standing-file=tmp/poses.json'])).not.toThrow();
});

test('refuses malformed, empty, duplicate and unbounded pose inputs', () => {
  for (const rows of [[], [pose, pose], [{...pose, x: Number.NaN}], [{...pose, yaw: Infinity}],
    [{...pose, camera: true}], Array.from({length: 9}, (_, i) => ({...pose, name: `p${i}`}))])
    expect(() => frameFloorStanding({grid: rows}, ['grid'])).toThrow();
});
