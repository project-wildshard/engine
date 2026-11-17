// Meta STAGING-SMOKE SM2: each hard check, fed a recorded sample or log, gives its listed severity; `hold` is true exactly when
// a P0 or P1 is present.
import { expect, test } from 'vitest';
import { checkScenario, holds, olderVersion, verdictOf } from '../scripts/staging-smoke/checks.mjs';
import type { ScenarioResult } from '../scripts/staging-smoke/scenarios.mjs';

const BUILD = 'b'.repeat(40);
const ctx = { release: 'v0.1.34', build: BUILD, version: { build: BUILD, describe: 'v0.1.34', clientVersion: '0.1.34', minClient: '0.1.31' }, lastTimeToPlay: { K3: 10_000 } };
const screen = (over: Record<string, boolean>) => ({ doc: 1, path: '/', shell: false, title: false, select: false, loading: false, bar: false, hud: false, modal: false, ...over });
const leg = (over: Record<string, unknown> = {}) => ({ name: 'cold', at: 0, samples: [{ t: 0, s: screen({ select: true }) }], problems: [], path: '', tapAt: 1000, playAt: 11_000, stick: true, modals: [], ...over });
const clean = (over: Partial<ScenarioResult> = {}): ScenarioResult => ({ id: 'K3', title: 'Driftwood chain (WebKit)', browser: 'webkit', status: 'ran', seconds: 100, legs: [leg()], errors: [], events: [], log: [], frames: {}, drops: 0, settings: { opened: true, closed: true }, quietTitle: { drop: false, left: false }, ...over } as ScenarioResult);
const failed = (s: ScenarioResult, c = ctx) => checkScenario(s, c).filter(check => !check.ok).map(check => `${check.severity} ${check.key}`);

test('a clean run passes every check and does not hold', () => {
  expect(failed(clean())).toEqual([]);
  expect(verdictOf([clean()], ctx).hold).toBe(false);
});

test.each([
  ['never reaches play', clean({ legs: [leg({ playAt: null, problems: [{ at: 90_000, text: 'never reached play within 90000 ms' }] })] }), 'P0 play'],
  ['the scenario crashed', clean({ status: 'crashed', reason: 'locator.tap: Timeout' }), 'P0 play'],
  ['an error card', clean({ legs: [leg({ modals: ['error'], problems: [{ at: 900, text: 'an error or drop modal opened' }] })] }), 'P0 error-card'],
  ['the stick does not move', clean({ legs: [leg({ stick: false })] }), 'P0 stick'],
  ['shell on a world page', clean({ legs: [leg({ problems: [{ at: 140, text: 'the bare launch shell (lone SHARD SELECT, LOADING) shows on the world page' }] })] }), 'P1 journey'],
  ['menu back after Enter World', clean({ legs: [leg({ problems: [{ at: 325, text: 'the main menu came back after Enter World' }] })] }), 'P1 journey'],
  ['HUD over a menu', clean({ legs: [leg({ problems: [{ at: 600, text: 'the in-game HUD is drawn over a menu' }] })] }), 'P1 journey'],
  ['a bar-sized loading card', clean({ legs: [leg({ problems: [{ at: 600, text: 'the loading card is shrunk to a bar' }] })] }), 'P1 journey'],
  ['a blank over 500 ms', clean({ legs: [leg({ problems: [{ at: 600, text: 'a blank screen for over 500 ms' }] })] }), 'P1 journey'],
  ['an uncaught page error', clean({ errors: ['Error: Discovery of driftwood-isle answered 404'] }), 'P1 page-error'],
  ['title SETTINGS does not open', clean({ settings: { opened: false, closed: false } }), 'P1 settings'],
  ['title SETTINGS does not close', clean({ settings: { opened: true, closed: false } }), 'P1 settings'],
  ['a drop modal on the way into play', clean({ legs: [leg({ modals: ['drop'], problems: [{ at: 900, text: 'an error or drop modal opened' }] })] }), 'P1 drop'],
  ['a drop modal after a back out', clean({ quietTitle: { drop: true, left: false } }), 'P1 backout-drop'],
  ['a RECONNECTING strip 12 s into play', clean({ events: [{ kind: 'strip', shown: true, at: 23_000 }, { kind: 'wsclose', code: 1006, reason: '', at: 22_900 }] }), 'P2 strip'],
  ['time to play 40% slower', clean({ legs: [leg({ playAt: 15_000 })] }), 'P2 slow-play'],
  ['a 2.4 s long task after arrival', clean({ events: [{ kind: 'longtask', ms: 2400, at: 20_000 }] }), 'P2 long-task'],
])('%s', (_name, scenario, expected) => {
  expect(failed(scenario)).toEqual([expected]);
  expect(verdictOf([scenario], ctx).hold).toBe(expected.startsWith('P0') || expected.startsWith('P1'));
});

test('a strip before play or after 30 s, and a long task before arrival, are not findings', () => {
  expect(failed(clean({ events: [{ kind: 'strip', shown: true, at: 5000 }, { kind: 'strip', shown: true, at: 45_000 }, { kind: 'longtask', ms: 5000, at: 4000 }] }))).toEqual([]);
});

test('/version.json must name the candidate build and release (SB7)', () => {
  expect(failed(clean(), { ...ctx, version: { ...ctx.version, describe: 'v0.1.33-108-gd520b5606' } })).toEqual(['P1 version']);
  expect(failed(clean(), { ...ctx, version: { ...ctx.version, build: 'c'.repeat(40) } })).toEqual(['P1 version']);
});

const old = (over: Record<string, unknown>) => clean({ id: 'K1', browser: 'chromium', settings: undefined, quietTitle: undefined, legs: [leg({ name: 'journey' })], ...over } as unknown as Partial<ScenarioResult>);
const before = { build: 'a'.repeat(40), clientVersion: '0.1.31', caches: ['ws-shell-aaaaaaa-1'], databases: ['ws-built-home-v1', 'wildshard-saves@1'] };

test('old cache: the candidate reached and the save kept, else P0 (an old first page is P2); a forced update leaves no old shell, else P2; its drop modal is P2', () => {
  const after = { build: BUILD, caches: [], databases: ['wildshard-saves@1'] };
  expect(failed(old({ oldCache: { before, after, minClient: '0.1.31' } }))).toEqual([]);
  // the old build on the first page: P2 when the world entry then loads the candidate, P0 when it never does
  expect(failed(old({ endState: after, oldCache: { before, after: { ...after, build: before.build }, minClient: '0.1.31' } }))).toEqual(['P2 old-cache-first-page']);
  expect(failed(old({ endState: { ...after, build: before.build }, oldCache: { before, after: { ...after, build: before.build }, minClient: '0.1.31' } }))).toEqual(['P0 old-cache-build']);
  expect(failed(old({ oldCache: { before, after: { ...after, databases: [] }, minClient: '0.1.31' } }))).toEqual(['P0 old-cache-save']);
  // not forced (0.1.31 is not below minClient 0.1.31): the shell cache may stay
  expect(failed(old({ oldCache: { before, after: { ...after, caches: ['ws-shell-aaaaaaa-1'], databases: ['ws-built-home-v1', 'wildshard-saves@1'] }, minClient: '0.1.31' } }))).toEqual([]);
  // forced (minClient 0.1.34): once play holds, no cache named for the old build is left (the new build's own ws-built-home-v1 may be)
  const stale = { ...after, caches: ['ws-shell-aaaaaaa-1', 'ws-shell-bbbbbbb-2'], databases: ['ws-built-home-v1', 'wildshard-saves@1'] };
  expect(failed(old({ endState: stale, oldCache: { before, after: stale, minClient: '0.1.34' } }))).toEqual(['P2 old-cache-wipe']);
  expect(failed(old({ endState: { ...stale, caches: ['ws-shell-bbbbbbb-2'] }, oldCache: { before, after: stale, minClient: '0.1.34' } }))).toEqual([]);
  expect(failed(old({ drops: 1, oldCache: { before, after, minClient: '0.1.34' } }))).toEqual(['P2 forced-drop']);
});

test('a skipped scenario has no checks; hold is true exactly with a P0 or P1', () => {
  expect(checkScenario(clean({ status: 'skip', reason: 'no profile' }), ctx)).toEqual([]);
  const finding = (severity: 'P0' | 'P1' | 'P2') => ({ scenario: 'K3', key: 'x', severity, text: '', source: 'check' as const });
  expect(holds([finding('P2'), finding('P2')])).toBe(false);
  expect(holds([finding('P2'), finding('P1')])).toBe(true);
  expect(holds([finding('P0')])).toBe(true);
  expect(holds([])).toBe(false);
  expect(olderVersion('0.1.9', '0.1.31')).toBe(true);
  expect(olderVersion('0.1.31', '0.1.31')).toBe(false);
});
