// meta ALPHA-2-TRAILER AT1: the trailer's shots are data keyed by zone slug (scripts/trailer/shots/lib.mjs). A shot file loads
// against the live grid's slugs (test/pins/staging.json, J507), and an unknown slug, a bad light or a broken rig is refused.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { bootGroups, gridZones, loadShots, refuseShot } from '../../scripts/trailer/shots/lib.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'trailer-shots-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const file = (name, body) => { const path = join(scratch, name); writeFileSync(path, body); return path; };

test('the grid zones come from the live pin, and include the zones a trailer shoots', () => {
  const zones = gridZones();
  expect(zones).toContain('driftwood-isle');
  expect(zones.length).toBeGreaterThanOrEqual(10);
});

test('a shot file loads; its shots keep their zone and fields', async () => {
  const path = file('ok.mjs', `export const shots = [
    { name: 'a-one', zone: 'driftwood-isle', time: 'golden', weather: 'clear', secs: 4, rig: { keys: [{ t: 0, p: [0, 1, 0], l: [0, 0, -1] }, { t: 4, p: [1, 1, 0], l: [0, 0, -1] }] } },
    { name: 'a-two', zone: 'driftwood-isle', secs: 2, tick: (t) => '' },
  ];`);
  const shots = await loadShots([path], ['driftwood-isle', 'glowfen']);
  expect(shots.map(s => s.name)).toEqual(['a-one', 'a-two']);
  expect(bootGroups(shots).map(g => g.shots.length)).toEqual([1, 1]); // golden/clear and live/live are two boots
});

test('an unknown zone slug is refused', async () => {
  const path = file('bad.mjs', `export const shots = [{ name: 'x', zone: 'atlantis', secs: 4 }];`);
  await expect(loadShots([path], ['driftwood-isle'])).rejects.toThrow(/unknown zone "atlantis"/u);
});

test('a bad light, a short rig and a duplicate name are refused', async () => {
  const zones = ['driftwood-isle'];
  expect(refuseShot({ name: 'x', zone: 'driftwood-isle', secs: 4, time: 'dusk' }, zones)).toMatch(/time dusk/u);
  expect(refuseShot({ name: 'x', zone: 'driftwood-isle', secs: 4, rig: { keys: [{ t: 0, p: [0, 0, 0], l: [0, 0, 0] }] } }, zones)).toMatch(/at least 2 keys/u);
  expect(refuseShot({ name: 'x', zone: 'driftwood-isle', secs: 0 }, zones)).toMatch(/secs/u);
  const dup = file('dup.mjs', `export const shots = [{ name: 'x', zone: 'driftwood-isle', secs: 1 }, { name: 'x', zone: 'driftwood-isle', secs: 1 }];`);
  await expect(loadShots([dup], zones)).rejects.toThrow(/duplicate shot x/u);
});

test('every shot file in scripts/trailer/shots loads against the live grid', async () => {
  const shots = await loadShots(['driftwood-isle']);
  expect(shots.length).toBeGreaterThan(0);
  expect(new Set(shots.map(s => s.zone))).toEqual(new Set(['driftwood-isle']));
});
