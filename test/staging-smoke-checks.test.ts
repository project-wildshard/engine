// Meta STAGING-SMOKE SM2: each hard check, fed a recorded sample or log, gives its listed severity; `hold` is true exactly when
// a P0 or P1 is present.
import { describe, expect, it, test } from 'vitest';
import {createTempRepo} from '../src/test/helpers/git';
import {engineRelease} from '../scripts/changelog.mjs';
import { checkScenario, holds, olderVersion, seatReload, verdictOf } from '../scripts/staging-smoke/checks.mjs';
import type { ScenarioResult } from '../scripts/staging-smoke/scenarios.mjs';
import { isThirdPartyBeacon, ownPageErrors } from '../scripts/staging-smoke/thirdParty.mjs';
import { PAGE_BG, blackWorld, worldStats } from '../scripts/staging-smoke/worldFrame.mjs';

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

// QA 11-25 row 16: headless WebKit reports Cloudflare's analytics beacon post (refused cross-origin) as an uncaught page
// error; it held staging K6 on a P1 that is not Wildshard's. The beacon is ignored; our own errors beside it still hold.
const BEACON_ERROR = 'Fetch API cannot load https://cloudflareinsights.com/cdn-cgi/rum due to access control checks.';

test('the Cloudflare analytics beacon is not an uncaught page error of ours', () => {
  expect(failed(clean({ errors: [BEACON_ERROR] }))).toEqual([]);
  expect(verdictOf([clean({ errors: [BEACON_ERROR] })], ctx).hold).toBe(false);
  const ours = 'Error: Discovery of driftwood-isle answered 404';
  expect(failed(clean({ errors: [BEACON_ERROR, ours] }))).toEqual(['P1 page-error']);
  const text = checkScenario(clean({ errors: [BEACON_ERROR, ours] }), ctx).find(check => check.key === 'page-error')?.text;
  expect(text).toBe(`uncaught page error: ${ours}`);
});

test('the beacon rule matches only Cloudflare analytics hosts', () => {
  expect(isThirdPartyBeacon('https://static.cloudflareinsights.com/beacon.min.js/v123')).toBe(true);
  expect(isThirdPartyBeacon('/cloudflareinsights.com/cdn-cgi/rum due to access control checks')).toBe(true);
  expect(isThirdPartyBeacon('https://staging.wildshard.io/cdn-cgi/rum')).toBe(false);
  expect(isThirdPartyBeacon('https://notcloudflareinsights.com/x')).toBe(false);
  expect(ownPageErrors([BEACON_ERROR, 'TypeError: x is undefined'])).toEqual(['TypeError: x is undefined']);
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
  ['SB48: the world is not drawn 10 s into play', clean({ frames: { play10: 'p10.jpg' }, world: { play10: { stats: { mean: 8, sd: 4.7, pageBg: 0.999, pixels: 9000 }, black: 'the page background shows through 100% of the world region' } } }), 'P0 black-world'],
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

// A repair on an untagged release branch deliberately keeps its commit count
// (engineRelease/SB7). The smoke must accept that label for this exact build.
test('an actual untagged release repair keeps its verified describe label', () => {
  const repo=createTempRepo();
  try {
    repo.commit({'package.json':JSON.stringify({version:'0.1.33'})},'chore(release): v0.1.33');
    repo.git(['tag','v0.1.33']);
    repo.commit({'package.json':JSON.stringify({version:'0.1.34'})},'chore(release): v0.1.34');
    repo.commit({'repair.txt':'fixed'},'fix(grid): placed metadata');
    const build=repo.git(['rev-parse','HEAD']).trim(), release=engineRelease(repo.dir);
    expect(release.describe).toMatch(/^v0\.1\.34-1-g[0-9a-f]+$/u);
    expect(failed(clean(),{...ctx,build,version:{...ctx.version,build,describe:release.describe}})).toEqual([]);
  } finally {repo.cleanup();}
});

test.each([
  {describe:'v0.1.34-2-gcccccccc'},
  {describe:'v0.1.33-2-gbbbbbbbb'},
  {describe:'v0.1.34-0-gbbbbbbbb'},
  {describe:'v0.1.34-2-gbbbbbb'},
  {describe:'v0.1.34-2-gbbbbbbbb-extra'},
  {clientVersion:'0.1.33'},
])('a repaired label never excuses a mismatched version or SHA: %j', patch => {
  expect(failed(clean(),{...ctx,version:{...ctx.version,...patch}})).toEqual(['P1 version']);
});

/** a w x h RGB frame: `world` paints the world region, the rest is the HUD's dark edge */
function frame(w: number, h: number, world: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(world(x, y), (y * w + x) * 3);
  return data;
}

test('SB48: the world region of a play frame, with no golden image', () => {
  const W = 134, H = 291; // a 402x874 phone frame at a third
  // Jake's iPhone, v0.1.43: the page background through the canvas
  const jake = worldStats(frame(W, H, () => [PAGE_BG[0] ?? 0, PAGE_BG[1] ?? 0, PAGE_BG[2] ?? 0]), W, H, 3);
  expect(blackWorld(jake)).toContain('page background');
  // a canvas drawn opaque black
  expect(blackWorld(worldStats(frame(W, H, () => [0, 0, 0]), W, H, 3))).toContain('flat dark');
  // Driftwood's sky over sea, and a dark textured night: drawn
  expect(blackWorld(worldStats(frame(W, H, (_x, y) => (y < H / 2 ? [120, 190, 240] : [30, 90, 120])), W, H, 3))).toBeNull();
  expect(blackWorld(worldStats(frame(W, H, (x, y) => ((x + y) % 4 < 2 ? [4, 6, 12] : [40, 46, 60])), W, H, 3))).toBeNull();
});

describe('the deploy load budget (STAGING-QA SQ12)', () => {
  const deploy = { ...ctx, deploy: true, lastTimeToPlay: { K3: 10_000, 'K6:pine-hollow': 10_000 } };
  it('holds a return visit over 20 s as a P1 and passes one inside it', () => {
    const k2 = (ms: number) => clean({ id: 'K2', legs: [leg({ name: 'journey', tapAt: 0, playAt: ms })] });
    expect(failed(k2(21_000), deploy)).toEqual(['P1 load']);
    expect(failed(k2(19_000), deploy)).toEqual([]);
  });
  it('reports a 30% rise over the last release as a P2, per K6 card', () => {
    expect(failed(clean({ legs: [leg({ tapAt: 0, playAt: 13_000 })] }), deploy)).toEqual(['P2 slow-play']);
    expect(failed(clean({ legs: [leg({ tapAt: 0, playAt: 12_000 })] }), deploy)).toEqual([]);
    const k6 = clean({ id: 'K6', legs: [leg({ name: 'pine-hollow', tapAt: 0, playAt: 13_000 }), leg({ name: 'far-reach', tapAt: 0, playAt: 30_000 })] });
    expect(failed(k6, deploy)).toEqual(['P2 slow-play']);
    expect(checkScenario(k6, deploy).find(check => check.key === 'slow-play')?.text).toContain('pine-hollow 13.0 s against 10.0 s');
  });
  // Meta QA 11-25 row 60: v0.1.91 held on K2 at 20.9 s against 20 s while lanes' local runs loaded the Mac.
  it('records the 15-minute load beside each timing, and over the load line a miss reads "noisy, rerun", not a hold', () => {
    const k2 = (load15: number) => clean({ id: 'K2', load15, legs: [leg({ name: 'journey', tapAt: 0, playAt: 20_900 })] });
    const loaded = { ...deploy, noisyLoad: 12 };
    const noisy = checkScenario(k2(19.4), loaded).find(check => check.key === 'load');
    expect(noisy).toMatchObject({ ok: false, severity: 'P2' });
    expect(noisy?.text).toMatch(/^noisy, rerun: a return visit at Low Power and 400 ms reached play in 20\.9 s, over the 20 s budget \(SB47\) \(15-min load 19\.4, over the 12\.0 line; QA 11-25 row 60\)$/u);
    const judged = verdictOf([k2(19.4)], loaded);
    expect(judged.hold).toBe(false);
    expect(judged.rows[0]).toMatchObject({ load15: 19.4, timeToPlay: 20_900 });
    // Under the line the same miss still holds, with the load beside it; a pass carries the load too.
    const quiet = checkScenario(k2(3.2), loaded).find(check => check.key === 'load');
    expect(quiet).toMatchObject({ ok: false, severity: 'P1' });
    expect(quiet?.text).toContain('(15-min load 3.2)');
    expect(verdictOf([k2(3.2)], loaded).hold).toBe(true);
    const fast = clean({ id: 'K2', load15: 19.4, legs: [leg({ name: 'journey', tapAt: 0, playAt: 9_000 })] });
    expect(checkScenario(fast, loaded).find(check => check.key === 'load')).toMatchObject({ ok: true, severity: 'P1', text: expect.stringContaining('(15-min load 19.4)') });
    // No line given (an old caller): a miss holds as before.
    expect(failed(k2(19.4), deploy)).toEqual(['P1 load']);
  });
  // Meta QA 11-25 row 62: v0.1.91's second K2 attempt (27.2 s) reloaded at 13.3 s on "online seat elsewhere (driftwood-isle)".
  it('a timing whose leg reloaded on a seat still held reads "harness, rerun", not a hold', () => {
    const seated = clean({ id: 'K2', legs: [leg({ name: 'journey', tapAt: 0, playAt: 27_200,
      ends: [{ t: 13_300, document: 1, reason: 'online seat elsewhere (driftwood-isle)' }] })] });
    expect(seatReload(seated)).toBe('journey: online seat elsewhere (driftwood-isle)');
    const load = checkScenario(seated, deploy).find(check => check.key === 'load');
    expect(load).toMatchObject({ ok: false, severity: 'P2' });
    expect(load?.text).toMatch(/^harness, rerun: .* \(the leg reloaded on "journey: online seat elsewhere \(driftwood-isle\)", a player still seated from the attempt before; QA 11-25 row 62\)$/u);
    expect(verdictOf([seated], deploy).hold).toBe(false);
    // Any other reload still holds.
    const other = clean({ id: 'K2', legs: [leg({ name: 'journey', tapAt: 0, playAt: 27_200, ends: [{ t: 13_300, document: 1, reason: 'REV-BEHIND' }] })] });
    expect(failed(other, deploy)).toEqual(['P1 load']);
  });
});
