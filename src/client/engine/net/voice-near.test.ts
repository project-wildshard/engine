import { afterEach, expect, test } from 'vitest';
import { VOICE_SILENT_M, talkerKey, voiceGain, voiceNear } from './voiceNear';

// VOICE-POLISH V7: voice fades with distance and is silent from 40 m; a page with no bodies stays cell-wide.
let give: (() => void) | null = null;
afterEach(() => { give?.(); give = null; });

test('full near, fading between, silent from 40 m', () => {
  expect(voiceGain(0)).toBe(1); expect(voiceGain(5)).toBe(1);
  expect(voiceGain(10)).toBeGreaterThan(0.9);
  expect(voiceGain(25)).toBeGreaterThan(0.2); expect(voiceGain(25)).toBeLessThan(0.8);
  expect(voiceGain(39)).toBeGreaterThan(0); expect(voiceGain(39)).toBeLessThan(0.01);
  expect(voiceGain(VOICE_SILENT_M)).toBe(0); expect(voiceGain(60)).toBe(0);
  for (let metres = 0; metres < 60; metres++) expect(voiceGain(metres + 1)).toBeLessThanOrEqual(voiceGain(metres));
});

test('a body 10 m away is heard and one 60 m away is not; without bodies, everyone is', () => {
  const near = { body: 'p1', name: 'Alex' }, far = { body: 'p2', name: 'Alex' };
  expect(voiceNear.gain(near)).toBe(1);
  // Codex review: two players share a Name; each voice goes by its own body, so the far one stays silent.
  const where: Record<string, number> = { p1: 10, p2: 60 };
  give = voiceNear.lend({ distanceTo: talker => where[talker.body ?? ''] ?? null });
  expect(voiceNear.gain(near)).toBeGreaterThan(0.9);
  expect(voiceNear.gain(far)).toBe(0);
  expect(voiceNear.gain({ body: 'gone', name: 'Gone' })).toBe(0);
  expect(talkerKey(near)).toBe('p1'); expect(talkerKey({ body: null, name: 'Alex' })).toBe('name:Alex');
  give(); give = null;
  expect(voiceNear.bodies).toBeNull();
  expect(voiceNear.gain(far)).toBe(1);
});
