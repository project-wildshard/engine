import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the look loop's Python checks (ΔE00, globbing, target jobs).
import { spawnSync } from 'node:child_process';
import { captureName, facing, parseCameraFile, parseFlags, resolveCameras, resolveMissing, SHOTS, yawTo } from '../scripts/look-loop/cameras.mjs';

const file = () => parseCameraFile({
  query: 'chunk=_template', fp: { viewport: [390, 844] }, god: { viewport: [1600, 900], topUp: 40, diagUp: 18, diagOut: 24, lookAhead: 8 },
  anchors: [{ id: 'spawn', P: { x: 0, z: 0 }, faceTo: { x: 0, z: -12 } }],
});
const near = (a: readonly number[] | undefined, b: readonly number[]): void => {
  expect(a).toHaveLength(b.length);
  b.forEach((v, i) => { expect(a?.[i]).toBeCloseTo(v, 3); });
};

test('a yaw faces (-sin, -cos): facing -z is yaw 0, facing -x is yaw pi/2', () => {
  expect(yawTo({ x: 0, z: 0 }, { x: 0, z: -12 })).toBeCloseTo(0);
  expect(yawTo({ x: 0, z: 0 }, { x: -5, z: 0 })).toBeCloseTo(Math.PI / 2);
  near(facing(yawTo({ x: 1, z: 2 }, { x: 4, z: 6 })), [0.6, 0.8]);
});

test('the nine cameras: four FP turns at P, TOP above P front-up, four diagonals looking at P', () => {
  const def = file(), cams = resolveCameras(def, def.anchors[0]!, 2);
  expect(cams.map(c => `${c.n}:${c.id}:${c.mode}`)).toEqual(SHOTS.map((id, i) => `${i + 1}:${id}:${i < 4 ? 'fp' : 'god'}`));
  near(cams.slice(0, 4).map(c => c.yaw ?? NaN), [0, 1.571, -1.571, 3.142]);
  expect(cams.slice(0, 4).every(c => c.x === 0 && c.z === 0 && c.pitch === -0.06)).toBe(true);
  near(cams[4]!.pos, [0, 42, 0]); near(cams[4]!.look, [0, 2, 0]); near(cams[4]!.up, [0, 0, -1]);
  near(cams[5]!.pos, [0, 20, 24]); near(cams[5]!.look, [0, 2, -8]);   // behind P, looking ahead of it
  near(cams[6]!.pos, [-24, 20, 0]); near(cams[7]!.pos, [24, 20, 0]);  // left is -x when facing -z
  near(cams[8]!.pos, [0, 20, -24]);
  for (const c of cams.slice(6)) near(c.look, [0, 2, 0]);
  expect(cams.slice(4).every(c => c.fovV === 72)).toBe(true);
});

test('resolveMissing fills only anchors without cameras, so later rounds re-shoot the same frames', () => {
  const def = file();
  expect(resolveMissing(def, () => 1.23456)).toEqual(['spawn']);
  expect(def.anchors[0]!.groundY).toBe(1.235);
  const first = JSON.stringify(def.anchors[0]!.cameras);
  expect(resolveMissing(def, () => 99)).toEqual([]);
  expect(JSON.stringify(def.anchors[0]!.cameras)).toBe(first);
});

test('the file is checked and flags are strict', () => {
  expect(() => parseCameraFile({ fp: { viewport: [390, 844] }, god: { viewport: [1600, 900] }, anchors: [] })).toThrow();
  expect(() => parseCameraFile({ fp: { viewport: [390, 844] }, god: { viewport: [1600, 900] }, anchors: [{ id: 'A B', P: { x: 0, z: 0 }, faceTo: { x: 0, z: 1 } }] })).toThrow();
  expect(parseFlags(['--cameras=a.json', '--tag=r2', '--help'], ['cameras', 'tag', 'help'])).toEqual({ cameras: 'a.json', tag: 'r2', help: true });
  expect(() => parseFlags(['--camera=a.json'], ['cameras'])).toThrow(/unknown argument/u);
  expect(captureName('r2', { n: 5, id: 'top' })).toBe('r2-capture-5-top.jpg');
  expect(captureName('', { n: 1, id: 'fp-front' })).toBe('capture-1-fp-front.jpg');
});

test('the Python side: CIEDE2000 reference pairs, capture globbing, seed-mode target jobs', () => {
  const run = spawnSync('python3', ['scripts/look-loop/test_look_loop.py'], { encoding: 'utf8', timeout: 30000 });
  expect(run.stderr).toMatch(/OK/u);
  expect(run.status).toBe(0);
});
