// Meta STAGING-SMOKE SM3: the per-release store and the Opus vision judge, with a stub `herdr` on PATH (J474: each judge is an
// interactive Claude in a herdr pane; `claude -p` is gone, and a stub `claude` there fails the test if anything calls it). A
// sheet whose bottom row shows the main menu where play was gives `regressed` P1 and holds; the same sheet with a changelog
// bullet that names the new main menu gives `changed`; no previous release gives `baseline` and no judge; no herdr, `skipped`.
// oxlint-disable-next-line import/no-nodejs-modules -- It writes a stub CLI and fixture frames.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, relative, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- As above: the source scan.
import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { holds } from '../src/scripts/staging-smoke/checks.mjs';
import { KEYFRAMES } from '../src/scripts/staging-smoke/scenarios.mjs';
import { keepRun, lastRelease, releases } from '../src/scripts/staging-smoke/store.mjs';
import { changelogBullets, deployVision, judgeArgs, parseVision, visionFindings, visionPass } from '../src/scripts/staging-smoke/vision.mjs';

const ROOT = resolve('tmp/staging-smoke-vision-test');
const FFMPEG = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const PATH = process.env['PATH'];
/** The judge's herdr: a session with a caller pane (HERDR_ENV unset means no judge at all). */
const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w9:p0' };
/** The judges' own folders (in the run, ~/.cache/wildshard/plan-artifacts/vision-judge): the test keeps them in its tmp. */
const WORK = resolve('tmp/staging-smoke-vision-test/judges');
const herdrCalls = (verb: string): number => existsSync(join(ROOT, 'calls.log')) ? readFileSync(join(ROOT, 'calls.log'), 'utf8').split('\n').filter(l => l.startsWith(verb)).length : 0;

/** A solid 402x874 frame. */
function frame(path: string, color: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=402x874:d=1`, '-frames:v', '1', path]);
  return path;
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'bin'), { recursive: true });
  // the herdr stub: a pane split, the judge started, then the prompt, whose verdict file it writes like the judge would (a bullet
  // about the main menu explains the change, otherwise it is a regression); every call is logged
  writeFileSync(join(ROOT, 'bin', 'herdr'), `#!/bin/sh
echo "$*" >> "${join(ROOT, 'calls.log')}"
case "$1 $2" in
  "pane split") printf '%s\n' '{"result":{"pane":{"pane_id":"w9:p7"}}}' ;;
  "agent prompt")
    file=$(printf '%s' "$4" | sed -n 's/.*to the file \\(.*\\) with the Write tool.*/\\1/p')
    case "$4" in
      *"new main menu"*) printf '%s' '{"verdict":"changed","severity":null,"bullet":"The new main menu shows every zone.","line":"the title is the new main menu"}' > "$file" ;;
      *) printf '%s' '{"verdict":"regressed","severity":"P1","bullet":null,"line":"the main menu shows where play was"}' > "$file" ;;
    esac
    printf '%s\n' '{"result":{"status":"done"}}' ;;
  *) printf '%s\n' '{"result":{}}' ;;
esac
`);
  chmodSync(join(ROOT, 'bin', 'herdr'), 0o755);
  // J474: nothing may call claude itself any more
  writeFileSync(join(ROOT, 'bin', 'claude'), `#!/bin/sh\necho "$*" >> "${join(ROOT, 'claude-calls.log')}"\nexit 1\n`);
  chmodSync(join(ROOT, 'bin', 'claude'), 0o755);
  process.env['PATH'] = `${join(ROOT, 'bin')}:${PATH ?? ''}`;
});
afterAll(() => { process.env['PATH'] = PATH; rmSync(ROOT, { recursive: true, force: true }); });

test('a reply parses to its last verdict object; anything else is no verdict', () => {
  expect(parseVision('x {"verdict":"same","severity":null,"bullet":null,"line":"ok"}')).toEqual({ verdict: 'same', line: 'ok' });
  expect(parseVision('{"verdict":"regressed","line":"broken"}')).toEqual({ verdict: 'regressed', severity: 'P1', line: 'broken' });
  expect(parseVision('{"verdict":"maybe"}')).toBeUndefined();
  expect(parseVision('no json')).toBeUndefined();
});

test('the changelog section of a release is its bullets', () => {
  const file = join(ROOT, 'CHANGELOG.md');
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(file, '# Engine changelog\n\n## v0.1.34 (2026-11-17)\n\n- The new main menu shows every zone.\n- Faster loading.\n\n## v0.1.33 (2026-11-16)\n\n- Old.\n');
  expect(changelogBullets(file, 'v0.1.34')).toEqual(['The new main menu shows every zone.', 'Faster loading.']);
  expect(changelogBullets(file, 'v0.1.99')).toEqual([]);
});

test.skipIf(!FFMPEG)('the vision judge: regressed P1 holds, a matching bullet is changed, no previous release is baseline', async () => {
  const store = join(ROOT, 'store'), out = join(ROOT, 'run');
  // the last release: the world at play
  const lastOut = join(ROOT, 'last-run');
  const lastFrames = Object.fromEntries(KEYFRAMES.map(k => [k, frame(join(lastOut, 'K3', 'frames', `${k}.jpg`), k.startsWith('play') || k === 'last' ? 'green' : 'navy')]));
  keepRun(store, 'v0.1.33', lastOut, { release: 'v0.1.33', at: '2026-11-16T20:00:00.000Z', scenarios: [{ id: 'K3', title: 'Driftwood chain (WebKit)', status: 'ran', frames: lastFrames, timeToPlay: 10_000 }], findings: [], hold: false });
  const last = lastRelease(store, 'v0.1.34');
  expect(last?.release).toBe('v0.1.33');
  expect(last?.timeToPlay).toEqual({ K3: 10_000 });
  // this release: the main menu where play was
  const frames = Object.fromEntries(KEYFRAMES.map(k => [k, frame(join(out, 'K3', 'frames', `${k}.jpg`), 'navy')]));
  const scenarios = [{ id: 'K3', title: 'Driftwood chain (WebKit)', status: 'ran', frames }];
  const regressed = await visionPass({ scenarios, release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: ['Faster loading.'], out, env: HERDR, workRoot: WORK });
  expect(regressed).toMatchObject([{ scenario: 'K3', verdict: 'regressed', severity: 'P1' }]);
  expect(existsSync(regressed[0]?.sheet ?? '')).toBe(true);
  expect(holds(visionFindings(regressed))).toBe(true);
  // J474: a no-focus pane outside the repo, silent, an interactive Opus Claude in it, and the pane closed after
  const log = readFileSync(join(ROOT, 'calls.log'), 'utf8');
  expect(log).toMatch(/^pane split --pane w9:p0 --direction down --cwd \S+\/judges\/vision-judge\/judge-[0-9a-f]{8} --env CC_SOUND_VOL=0 --no-focus$/mu);
  expect(log).toMatch(/^agent start judge-[0-9a-f]{8} --kind claude --pane w9:p7 --timeout 60000 -- --model claude-opus-5-5 /mu);
  expect(log).toMatch(/^pane close w9:p7$/mu);
  // the verdict lands in the run beside its sheet; the judge's own folder is gone
  expect(existsSync(join(out, 'K3', 'verdict.json'))).toBe(true);
  expect(existsSync(join(WORK, 'vision-judge')) ? readdirSync(join(WORK, 'vision-judge')) : []).toEqual([]);
  expect(log).not.toContain('--add-dir');
  const changed = await visionPass({ scenarios, release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: ['The new main menu shows every zone.'], out, env: HERDR, workRoot: WORK });
  expect(changed).toMatchObject([{ scenario: 'K3', verdict: 'changed', bullet: 'The new main menu shows every zone.' }]);
  expect(visionFindings(changed)).toEqual([]);
  const baseline = await visionPass({ scenarios, release: 'v0.1.34', bullets: [], out, env: HERDR });
  expect(baseline).toMatchObject([{ scenario: 'K3', verdict: 'baseline' }]);
  // no herdr (CI): skipped, the same shape, and nothing started
  const prompts = herdrCalls('agent prompt');
  const bare = await visionPass({ scenarios, release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: [], out, env: {} });
  expect(bare).toMatchObject([{ scenario: 'K3', verdict: 'skipped', line: expect.stringContaining('herdr') }]);
  expect(herdrCalls('agent prompt')).toBe(prompts);
  expect(existsSync(join(ROOT, 'claude-calls.log'))).toBe(false);
});

test('the store keeps the last 5 releases', () => {
  const store = join(ROOT, 'retain'), out = join(ROOT, 'retain-run');
  for (let i = 1; i <= 7; i++) keepRun(store, `v0.1.${String(i)}`, out, { release: `v0.1.${String(i)}`, at: `2026-11-1${String(i)}T00:00:00.000Z`, scenarios: [], findings: [], hold: false });
  expect(releases(store).map(r => r.release)).toEqual(['v0.1.7', 'v0.1.6', 'v0.1.5', 'v0.1.4', 'v0.1.3']);
});

test.skipIf(!FFMPEG)('the deploy judge (STAGING-QA SQ13) only reports, skips what holds and stops at its call cap', async () => {
  const store = join(ROOT, 'store-sq13'), out = join(ROOT, 'run-sq13'), lastOut = join(ROOT, 'last-sq13');
  const ids = ['K1', 'K2', 'K3', 'K4'];
  const lastScenarios = ids.map(id => ({ id, title: id, status: 'ran', frames: Object.fromEntries(KEYFRAMES.map(k => [k, frame(join(lastOut, id, 'frames', `${k}.jpg`), 'green')])) }));
  keepRun(store, 'v0.1.33', lastOut, { release: 'v0.1.33', at: '2026-11-16T20:00:00.000Z', scenarios: lastScenarios, findings: [], hold: false });
  const last = lastRelease(store, 'v0.1.34');
  const scenarios = ids.map(id => ({ id, title: id, status: 'ran', frames: Object.fromEntries(KEYFRAMES.map(k => [k, frame(join(out, id, 'frames', `${k}.jpg`), 'navy')])) }));
  const before = herdrCalls('agent prompt'), closed = herdrCalls('pane close');
  const looks = await deployVision({ scenarios, held: new Set(['K2']), release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: [], out, maxCalls: 2, env: HERDR, workRoot: WORK });
  expect(looks.map(v => `${v.scenario} ${v.verdict}`)).toEqual(['K1 regressed', 'K2 skipped', 'K3 regressed', 'K4 skipped']);
  expect(herdrCalls('agent prompt') - before).toBe(2); expect(herdrCalls('pane close') - closed).toBe(2);
  expect(looks[3]?.line).toContain('2-call cap');
  // no herdr: every scenario that would be judged is skipped, nothing started
  const bare = await deployVision({ scenarios, held: new Set(), release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: [], out, env: {} });
  expect(bare.map(v => v.verdict)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  expect(herdrCalls('agent prompt') - before).toBe(2);
  expect(existsSync(join(ROOT, 'claude-calls.log'))).toBe(false);
});

test('a release keeps each leg\'s newest scenarios: the candidate\'s K6 stays when live staging runs K3 (STAGING-QA SQ16)', () => {
  const store = join(ROOT, 'store-merge'), out = join(ROOT, 'run-merge');
  const build = 'c'.repeat(40);
  keepRun(store, 'v0.1.40', out, { release: 'v0.1.40', build, at: '2026-11-18T20:00:00.000Z', scenarios: [{ id: 'K6', frames: {}, timeToPlay: 12_000, legTimes: { 'far-reach': 12_000 } }], findings: [] });
  keepRun(store, 'v0.1.40', out, { release: 'v0.1.40', build, at: '2026-11-18T20:10:00.000Z', scenarios: [{ id: 'K3', frames: {}, timeToPlay: 9000 }], findings: [] });
  expect(lastRelease(store, 'v0.1.41')?.timeToPlay).toEqual({ K6: 12_000, 'K6:far-reach': 12_000, K3: 9000 });
  keepRun(store, 'v0.1.40', out, { release: 'v0.1.40', build: 'd'.repeat(40), at: '2026-11-18T21:00:00.000Z', scenarios: [{ id: 'K3', frames: {}, timeToPlay: 8000 }], findings: [] });
  expect(lastRelease(store, 'v0.1.41')?.timeToPlay).toEqual({ K3: 8000 });
});

test('J474 (Jake: "Claude -p is bad we need to stop"): no code path runs claude with -p or --print', () => {
  // the judge's own arguments carry neither
  for (const flag of ['-p', '--print']) expect(judgeArgs()).not.toContain(flag);
  // and no script or source file passes either flag in a claude call
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : files(join(dir, e.name)))
    : /\.(?:mjs|cjs|js|ts|mts|sh)$/u.test(e.name) ? [join(dir, e.name)] : []);
  const flagged = ['scripts', 'src', '.githooks', '.agents'].filter(existsSync).flatMap(files).flatMap(file => readFileSync(file, 'utf8').split('\n')
    // a comment that names the old call is no call
    .flatMap((line, i) => /^\s*(?:\/\/|\/?\*|#)/u.test(line) ? [] : /\bclaude\b.{0,120}(?:['"`\s])(?:-p|--print)(?:['"`\s]|$)|(?:['"`])(?:-p|--print)(?:['"`]).{0,160}--model\b/u.test(line) ? [`${relative('.', file)}:${String(i + 1)}`] : []));
  expect(flagged).toEqual([]);
});
