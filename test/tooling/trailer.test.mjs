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

// AT2: the cut, titles, conform and build-beat tools are importable; their pure parts are checked here, the chain itself
// by the smoke cut in the commit body (cuts/test.mjs).
test('the capture runtime compiles and keeps only the frames a cut uses', async () => {
  const { RUNTIME, keepFrame } = await import('../../scripts/trailer/capture.mjs');
  expect(() => new Function(`return ${RUNTIME}`)).not.toThrow();
  const edl = { clips: [{ shot: 'a', in: 1, dur: 2 }] };
  expect(keepFrame(null, 'a', 0)).toBe(true);
  expect([44, 45, 194, 195].map(i => keepFrame(edl, 'a', i))).toEqual([false, true, true, false]);
  expect(keepFrame(edl, 'b', 60)).toBe(false);
});

test('a cut takes its own options, and the smoke cut fills its length', async () => {
  const { cutOptions } = await import('../../scripts/trailer/cut.mjs');
  expect(cutOptions(['o', 't', 's', '--cut', 'test', '--bug', 'b.png', '--portrait', '--build-1=x.mp4', '--flag'])).toEqual({ bug: 'b.png', 'build-1': 'x.mp4', flag: true });
  const { cut } = await import('../../scripts/trailer/cuts/test.mjs');
  const { edl, mix } = cut({ TAKE: 'take.wav', SFX: 'sfx' });
  expect(edl.clips.reduce((s, c) => s + c.dur, 0)).toBe(edl.length);
  expect(mix.length).toBe(edl.length);
});

test('the conform counts frames on the cut and blurs over sub-frames', async () => {
  const { clipFrames, clipFilter } = await import('../../scripts/trailer/edit.mjs');
  expect(clipFrames({ at: 1.005, dur: 1 })).toBe(60);
  expect(clipFilter({ dur: 2 }, { sub: 2, zone: 'driftwood-isle' }, [1920, 1080])).toMatch(/^tmix=frames=2,select=.*scale=1920:1080.*eq=contrast=1\.04/u);
  expect(clipFilter({ dur: 2, flashIn: 0.1 }, { sub: 1 }, [1920, 1080])).not.toMatch(/tmix/u);
  const { cardTimes } = await import('../../scripts/trailer/titles.mjs');
  expect(cardTimes({ dur: 0.5 }, false)).toHaveLength(30);
  expect(cardTimes({ dur: 3, at: 1.2 }, true)).toEqual([1.2]);
});

test('a build beat replays a session up to its /exit, from a chosen second', async () => {
  const { castSpan } = await import('../../scripts/trailer/build-beat.mjs');
  const cast = [JSON.stringify({ version: 2, width: 80, height: 24 }), '[0.5, "o", "hello "]', '[2, "o", "world"]', '[3, "i", "/exit"]', '[4, "o", "bye"]'].join('\n');
  expect(castSpan(cast).length).toBe(2);
  const span = castSpan(cast, { from: 1 });
  expect(span.events[0]).toEqual([0, 'o', 'hello ']);
  expect(span.events.at(-1)).toEqual([1, 'o', 'world']);
});

// AT7: a real session replayed as a terminal, and the pictures it read as the panel beside it
test('a session transcript replays as cast lines, in order, with its pictures and no secrets', async () => {
  const { replay, toolLine, sniff, BEAT } = await import('../../scripts/trailer/transcript-cast.mjs');
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]).toString('base64');
  const rows = [
    { type: 'assistant', timestamp: '2026-11-19T08:00:00Z', message: { content: [{ type: 'text', text: 'too early' }] } },
    { type: 'assistant', timestamp: '2026-11-19T08:01:00Z', message: { content: [{ type: 'text', text: 'Shoot the wyrm.' }, { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/home/me/shot.png' } }] } },
    { type: 'user', timestamp: '2026-11-19T08:01:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'image', source: { media_type: 'image/png', data: png } }] }] } },
    { type: 'assistant', timestamp: '2026-11-19T08:01:02Z', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls\nmore' } }] } },
    { type: 'user', timestamp: '2026-11-19T08:01:03Z', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'a\nb\nc\napi_key=abcdefghijkl' }] } },
  ].map((r) => JSON.stringify(r)).join('\n');
  const { events, images, length } = replay(rows, { from: '08:01', home: '/home/me' });
  expect(events.map((e) => e[2]).join('')).not.toMatch(/too early|abcdefghijkl/u);
  expect(events[0][2]).toContain('Shoot the wyrm.');
  expect(images).toHaveLength(1);
  expect(images[0].path).toBe('~/shot.png');
  expect(events.at(-1)[2]).toContain('… +1 lines');
  expect(length).toBeCloseTo(BEAT.text + BEAT.tool + BEAT.image + BEAT.tool + BEAT.result, 6);
  expect(toolLine({ name: 'Edit', input: { file_path: 'a.ts' } })).toBe('Update(a.ts)');
  expect(sniff(Buffer.from(png, 'base64'))).toBe('png');
  expect(sniff(Buffer.from([0xFF, 0xD8, 0, 0]))).toBe('jpg');
});

test('the panel shows each picture from its moment to the next, the first from 0', async () => {
  const { spans } = await import('../../scripts/trailer/panel.mjs');
  expect(spans([{ t: 1, file: 'a' }, { t: 3, file: 'b' }], 5)).toEqual([{ file: 'a', dur: 3 }, { file: 'b', dur: 2 }]);
  expect(() => spans([], 5)).toThrow(/no pictures/u);
});
