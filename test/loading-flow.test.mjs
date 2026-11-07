import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- the recorded run is a committed fixture file.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the recorder expression in a browser-free sandbox.
import { runInNewContext } from 'node:vm';
import { analyse } from '../scripts/loading-flow/analyse.mjs';
import { profileFrames } from '../scripts/loading-flow/profile.mjs';

// DL23: the analyser that judges every Simulator recording against Jake's loading bar (E529, G1006, G1008).
const TAP = 1_000_000;
const card = (s, extra = {}) => ({ ev: 'poll', documentId: 'world', t: TAP + s * 1000, shown: true, styled: true, clock: '00:01.0', slug: 'Nine', tier: 'phone',
  dl: 'Spawn view · 1.00 MB of 9.00 MB', dlPct: '11', su: 'step 3 / 30 · Audio', suPct: '6', line: '', rows: 0, lastRow: null, err: null,
  foot: 'Now waiting for: Read audio 1 / 10 · 0.2 s', control: false, ...extra });
/** A frame every `ms` from `from` to `to` seconds after the tap, one page. */
const frames = (from, to, ms, origin = TAP, documentId = 'world') => ({ ev: 'frames', documentId, origin, f: Array.from({ length: Math.floor(((to - from) * 1000) / ms) + 1 }, (_, i) => from * 1000 + i * ms) });
/** The game's drawn-frame ring as each poll reads it: `perPoll` new frames of `ms` each call (Game.frameCount / frameMs). */
const ring = () => { let n = 0, i = 0; const ms = Array.from({ length: 120 }, () => 0);
  return (perPoll, frameMs) => { for (let k = 0; k < perPoll; k++) { ms[i] = frameMs; i = (i + 1) % 120; n++; } return { n, i, ms: [...ms] }; }; };

test('a load that moves every poll, names its waits and plays smoothly passes every bar line', () => {
  const rows = [{ ev: 'recStart', t: TAP - 5000, recStart: TAP - 5000 }, { ev: 'tapEnter', t: TAP }];
  for (let s = 0; s < 10; s += 0.25) rows.push(card(s, { dl: `Spawn view · ${(s / 2).toFixed(2)} MB of 9.00 MB` }));
  rows.push(card(10, { shown: false, control: true }), frames(0, 40, 16.7));
  // the play window: 10 s on foot at 1.4 m/s, then the board at boost, 15 m/s; the game draws 30 frames a poll (60 fps)
  const drawn = ring(); rows[rows.length - 2] = card(10, { shown: false, control: true, origin: TAP, drawn: drawn(0, 17) });
  for (let s = 10.5, x = 0; s <= 40; s += 0.5) {
    const boost = s > 20; x += boost ? 7.5 : 0.7;
    rows.push(card(s, { shown: false, control: true, origin: TAP, drawn: drawn(30, 17), play: boost ? 'boost' : 'walk', player: { x, y: 0, z: 0, v: boost ? 15 : 1.4, hover: boost, boost } }));
  }
  const r = analyse(rows);
  expect(r.controlS).toBe(10);
  expect(r.cardStill_ge1s).toEqual([]);
  expect(r.play.source).toBe('game drawn frames');
  expect(r.play.fps).toBeGreaterThan(55);
  expect(r.play.settledFps).toBeGreaterThan(55);
  expect(r.bar).toEqual({ reachesControl: true, styledFromFirstFrame: true, cardMovesEverySecond: true, noLoadingFrameOver250ms: true,
    everyLongStepNamed: true, playNoFrameOver250ms: true, playSteadyFromSecondOne: true, stuckShowsRetry: true, playWalkedAndBoosted: true });
  expect(r.play.motion).toEqual({ walkM: 13, boostM: 300, boostTopMps: 15, boostEngaged: true });
  expect(r.pass).toBe(true);
});

test('a frozen card, an unnamed step, an unstyled first frame and a hitch after control each fail their own line', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }, card(0, { styled: false })];
  // 0.25-4.5 s: the same card, the foot only repeats the step's own title
  for (let s = 0.25; s <= 4.5; s += 0.25) rows.push(card(s, { foot: 'Now working on: Audio' }));
  rows.push(card(5, { su: 'step 4 / 30 · Props', suPct: '9' }), card(6, { shown: false, control: true }));
  // 60 fps, but a 4.4 s frame one second into play (Jake's G1008 Chromium reading on 69fa647 Nine)
  rows.push(frames(0, 7, 16.7), frames(11.4, 40, 16.7));
  const r = analyse(rows);
  expect(r.cardStill_ge1s[0]).toMatchObject({ from: 0.3, s: 4.8 });
  expect(r.setupStalls_ge3s[0]).toMatchObject({ named: false, step: 'step 3 / 30 · Audio' });
  expect(r.play.longestFrameMs).toBeGreaterThanOrEqual(4400);
  expect(r.play.framesOver250).toBe(1);
  expect(r.bar).toMatchObject({ reachesControl: true, styledFromFirstFrame: false, cardMovesEverySecond: false, everyLongStepNamed: false,
    noLoadingFrameOver250ms: true, playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
});

test('a held step that names a sub-step or a wait is named; a one-poll blip between waits is not a silent step', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }];
  for (let s = 0; s <= 4; s += 0.2) {
    const foot = Math.abs(s - 2) < 0.01 ? 'Now working on: First drawn frames' : s < 2 ? 'Now waiting for: Read Model data · 0.3 s' : 'Now working on: World program links';
    rows.push(card(s, { su: 'step 27 / 30 · First drawn frames', suPct: '90', foot, dl: `Spawn view · ${s.toFixed(1)} MB` }));
  }
  rows.push(card(4.2, { shown: false, control: true }), frames(0, 40, 16.7));
  const stall = analyse(rows).setupStalls_ge3s[0];
  expect(stall).toMatchObject({ named: true, s: 4.2 });
  expect(stall.waits).toEqual(['Now waiting for: Read Model data', 'Now working on: World program links']);
});

test('after control the game\'s drawn frames judge fps: the page can tick at 60 while the world draws a 4.4 s frame', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }, card(0), card(0.5, { dl: 'Spawn view · 9.00 MB' }), frames(0, 40, 16.7)];
  // control at 1 s; each 0.5 s poll reads the ring: 30 frames of 17 ms, except one poll whose only new frame took 4400 ms
  let n = 0, i = 0;
  const slots = Array.from({ length: 120 }, () => 0);
  for (let s = 1; s <= 34; s += 0.5) {
    const slow = Math.abs(s - 2) < 0.01, count = slow ? 1 : 30;
    for (let k = 0; k < count; k++) { slots[i] = slow ? 4400 : 17; i = (i + 1) % 120; n++; }
    rows.push(card(s, { shown: false, control: true, origin: TAP, drawn: { n, i, ms: [...slots] } }));
  }
  const { play } = analyse(rows);
  expect(play.source).toBe('game drawn frames');
  expect(play.page.longestFrameMs).toBeLessThan(20);
  expect(play.longestFrameMs).toBe(4400);
  expect(play.settledFps).toBe(60);
  expect(play.firstSecondFps).toBeLessThan(48);
  expect(analyse(rows).bar).toMatchObject({ playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
});

test('a load that never reaches control fails unless the card offers Retry; a navigation is not a frame', () => {
  const stuck = [{ ev: 'tapEnter', t: TAP }, card(0), card(0.5, { dl: 'Spawn view · 2.00 MB of 9.00 MB' }), frames(0, 0.5, 16.7, TAP), frames(0.6, 1, 16.7, TAP + 600, 'new-document')];
  const r = analyse(stuck);
  expect(r.bar.reachesControl).toBe(false);
  expect(r.bar.stuckShowsRetry).toBe(false);
  expect(r.loading.longestFrameMs).toBeLessThan(20);
  expect(analyse([...stuck, card(1, { retry: true })]).bar.stuckShowsRetry).toBe(true);
});

test('a legacy recorded run retains card data but cannot qualify frames without document identity', () => {
  // the drive's own rows, trimmed to the fields the analyser reads (scripts/loading-flow/drive.mjs, 11-04)
  const rows = JSON.parse(readFileSync('test/fixtures/loading-flow/nine-86f2590-warm.json', 'utf8'));
  const r = analyse(rows);
  expect(r.controlS).toBe(10.4);
  // the build before d077785db6: the title page's card is unstyled, and the card sat 1.6 s twice (Props, step 27)
  expect(r.bar.styledFromFirstFrame).toBe(false);
  expect(r.cardStill_ge1s.map(s => [s.from, s.s])).toEqual([[4.6, 1.6], [7.9, 1.6]]);
  expect(r.documentIdentity).toMatchObject({ loading: false, play: false });
  expect(r.bar).toMatchObject({ noLoadingFrameOver250ms: false, playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
  expect(r.pass).toBe(false);
});

test('a spawn download holding the card is named while its bytes move, and a frozen one is not', () => {
  const run = moved => {
    const rows = [{ t: 0, ev: 'tapEnter' }];
    for (let i = 0; i < 25; i++) rows.push({ t: 100 + i * 200, ev: 'poll', shown: true, styled: true, su: '—', suPct: '0', line: 'Reading download inventory', foot: '', dl: `Spawn view · ${moved(i)} MB of 54.5 MB` });
    rows.push({ t: 5200, ev: 'poll', shown: true, styled: true, su: 'step 1 / 30 · Application modules', suPct: '9', line: 'x', foot: '', dl: 'Spawn view · 54.5 MB' }, { t: 5400, ev: 'control' });
    return analyse(rows).setupStalls_ge3s[0];
  };
  expect(run(i => (i * 2).toFixed(1))).toMatchObject({ named: true, longestUnnamedS: 0 });
  expect(run(i => Math.min(i, 6).toFixed(1))).toMatchObject({ named: false });
});

test('the stage\'s reads tally is not a named wait: a step held 3.5 s behind it fails, as Nine\'s cold step 27 did', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }];
  for (let s = 0; s <= 3.6; s += 0.2) rows.push(card(s, { su: 'step 27 / 30 · First drawn frames and minimap', suPct: '90', dl: `Spawn view · ${s.toFixed(1)} MB`,
    foot: `Now waiting for: Reading 8 files · 0.0 MB · ${s.toFixed(1)} s` }));
  rows.push(card(3.8, { shown: false, control: true }), frames(0, 40, 16.7));
  expect(analyse(rows).setupStalls_ge3s[0]).toMatchObject({ named: false, waits: [] });
  // the footer's real suffixes (a second pending wait, a quiet prefix) leave it the same tally (sp-x1)
  const footed = (foot) => rows.map(row => (row.ev === 'poll' && row.shown ? Object.assign(structuredClone(row), { foot: foot(row.foot) }) : row));
  const suffixed = footed(foot => `No reported progress for 1.0 s · ${foot} · 2 waits`);
  expect(analyse(suffixed).setupStalls_ge3s[0]).toMatchObject({ named: false, waits: [] });
  // a real file wait or a sub-step stays named
  const named = footed(() => 'Now waiting for: Read Model data · 37 files · 4.1 MB read so far · 0.4 s · 1 files in flight · 2 waits');
  expect(analyse(named).setupStalls_ge3s[0]).toMatchObject({ named: true });
});

test('loading frames are measured per Setup step: a 900 ms unpresented frame lands on the step the card showed', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }];
  for (let s = 0; s <= 4; s += 0.25) rows.push(card(s, s < 2 ? {} : { su: 'step 24 / 30 · Shaders · 5 / 76 programs linked', suPct: '80', dl: `Spawn view · ${s} MB` }));
  rows.push(card(4.2, { shown: false, control: true }));
  // frames every 16.7 ms, then nothing from 2.5 s to 3.4 s (the GPU process linking), then on again
  rows.push(frames(0, 2.5, 16.7), frames(3.4, 40, 16.7));
  const r = analyse(rows);
  expect(r.loading.byStep[0]).toMatchObject({ step: '24 Shaders', over250: 1 });
  expect(r.loading.byStep[0].longestMs).toBeGreaterThanOrEqual(880);
  expect(r.bar.noLoadingFrameOver250ms).toBe(false);
});

test('the play lines need the whole 30 s on the game\'s own frames: a short log or a missing frame ring is no pass', () => {
  const run = (until, withRing) => {
    const rows = [{ ev: 'tapEnter', t: TAP }, card(0), card(0.5, { dl: 'Spawn view · 9.00 MB' }), frames(0, 40, 16.7)];
    const drawn = ring();
    for (let s = 1; s <= until; s += 0.5) rows.push(card(s, { shown: false, control: true, origin: TAP, ...(withRing ? { drawn: drawn(s === 1 ? 0 : 30, 17) } : {}) }));
    return analyse(rows);
  };
  expect(run(33, true).bar).toMatchObject({ playNoFrameOver250ms: true, playSteadyFromSecondOne: true });
  // a log cut short of control + 30 s, by 18 s or by a fraction of a second (sp-x1): no reading of the rest
  for (const until of [13, 30, 30.5]) expect(run(until, true).bar).toMatchObject({ playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
  expect(run(31, true).bar).toMatchObject({ playNoFrameOver250ms: true, playSteadyFromSecondOne: true });
  // no game frame ring: the page's 60 Hz rAF alone does not judge the world's frame rate
  const pageOnly = run(33, false);
  expect(pageOnly.play.source).toBe('page requestAnimationFrame');
  expect(pageOnly.bar).toMatchObject({ playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
});

test('a row whose only change is its own running time is a still card (sp-x1\'s review)', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }];
  for (let s = 0; s <= 2; s += 0.2) rows.push(card(s, { lastRow: `▸ 1 · Application modulesPreparing application services${Math.round(400 + s * 1000)} ms` }));
  rows.push(card(2.2, { lastRow: '▸ 2 quick steps1.4 s' }), card(2.4, { shown: false, control: true }), frames(0, 40, 16.7));
  expect(analyse(rows).cardStill_ge1s[0]).toMatchObject({ from: 0, s: 2.2 });
});

test('profile.mjs: the samples inside a long loading frame name the function holding it', () => {
  const origin = TAP;
  const rows = [{ ev: 'tapEnter', t: TAP }, frames(0, 2, 16.7, origin), frames(3.7, 5, 16.7, origin), { ev: 'control', t: TAP + 6000 }];
  // the profiler's clock starts at 100 s when the page reads 1000 ms; samples every 1 ms through the 1.7 s frame
  const samples = [];
  for (let ms = 2000; ms <= 3700; ms += 1) samples.push({ t: 100 + (ms - 1000) / 1000, frames: [['update', 'animals.js', 12], ['stepFrame', 'Game.js', 900]] });
  const [frame] = profileFrames(rows, { calibration: { profilerS: 100, pageMs: 1000, origin }, samples });
  expect(frame.ms).toBeGreaterThanOrEqual(1700);
  expect(frame.self[0]).toEqual({ fn: 'update animals.js:12', samples: frame.samples });
  expect(frame.inclusive.map(row => row.fn)).toContain('stepFrame Game.js:900');
});

test('a frame ring that stops advancing while the polls go on is a world that stopped drawing (sp-x1)', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }, card(0), card(0.5, { dl: 'Spawn view · 9.00 MB' }), frames(0, 40, 16.7)];
  const drawn = ring();
  // 60 fps for the first 10 s after control, then the ring stands still through 32 s while the page and polls run on
  for (let s = 1; s <= 33; s += 0.5) rows.push(card(s, { shown: false, control: true, origin: TAP, drawn: drawn(s === 1 || s > 11 ? 0 : 30, 17) }));
  const { play, bar } = analyse(rows);
  expect(play.longestFrameMs).toBeGreaterThanOrEqual(19_000);
  expect(play.settledFps).toBe(0);
  expect(bar).toMatchObject({ playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
});


// Exact counter progress and poll intervals from the retained DL5 Driftwood
// failures: only Safari's timeOrigin changed, while each batch held 15 frames.
test.each([
  { label: 'packs 2', initial: 4, flip: 2.517, delta: 1, offsets: [0, .505, 1.008, 1.511, 2.014, 2.517, 3.020, 3.530, 4.033, 4.537, 5.039] },
  { label: 'shardfile 3', initial: 3, flip: 4.042, delta: -1, offsets: [0, .511, 1.014, 1.517, 2.023, 2.526, 3.030, 3.538, 4.042, 4.545, 5.050] },
])('stable document identity keeps the jittered native batch: $label', sample => {
  const rows = [{ ev: 'tapEnter', t: TAP }, card(0), frames(0, 40, 16.7)];
  const drawn = ring();
  let offset = 0;
  for (let index = 0; index < sample.offsets.length; index++) {
    offset = sample.offsets[index];
    const count = index === 0 ? sample.initial : index === 7 ? 16 : 15;
    rows.push(card(1 + offset, { shown: false, control: true, href: 'https://game.test/world',
      origin: TAP + (offset >= sample.flip ? sample.delta : 0), drawn: drawn(count, 33) }));
  }
  for (offset += .5; offset <= 32; offset += .5) rows.push(card(1 + offset, {
    shown: false, control: true, origin: TAP + sample.delta, drawn: drawn(15, 33) }));
  const result = analyse(rows);
  expect(result.documentIdentity).toMatchObject({ loading: true, play: true });
  expect(result.play.perSecond.slice(0, 5).every(n => n >= 24)).toBe(true);
  expect(result.bar.playSteadyFromSecondOne).toBe(true);
});

test('a same-URL navigation cannot join drawn batches even with the same origin and increasing frame counter', () => {
  const rows = [{ ev: 'tapEnter', t: TAP }, card(0), frames(0, 40, 16.7)];
  const drawn = ring();
  for (let s = 1; s <= 33; s += .5) rows.push(card(s, { shown: false, control: true,
    href: 'https://game.test/world', origin: TAP, documentId: s < 4 ? 'world' : 'new-world',
    drawn: drawn(s === 1 ? 0 : 15, 33) }));
  const result = analyse(rows);
  expect(result.documentIdentity.play).toBe(false);
  expect(result.play).toBeNull();
  expect(result.bar).toMatchObject({ playNoFrameOver250ms: false, playSteadyFromSecondOne: false });
});

test('the real recorder token survives repeated sampler installs but changes with its document', () => {
  const source = readFileSync('scripts/loading-flow/drive.mjs', 'utf8');
  const script = /const SAMPLER = `([^`]+)`;/u.exec(source)?.[1];
  expect(script).toBeTypeOf('string');
  if (script === undefined) throw new Error('Missing sampler source');
  let serial = 0;
  const window = {}, env = { window, crypto: { randomUUID: () => `document-${++serial}` }, requestAnimationFrame: () => 0 };
  runInNewContext(script, env); const first = window.__lf.documentId;
  runInNewContext(script, env); expect(window.__lf.documentId).toBe(first);
  const next = {}; runInNewContext(script, { ...env, window: next });
  expect(next.__lf.documentId).not.toBe(first);
});
