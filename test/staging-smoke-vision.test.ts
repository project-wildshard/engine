// Meta STAGING-SMOKE SM3: the per-release store and the Opus vision judge, with a stub `claude` on PATH. A sheet whose bottom
// row shows the main menu where play was gives `regressed` P1 and holds; the same sheet with a changelog bullet that names
// the new main menu gives `changed`; no previous release gives `baseline` and no call.
// oxlint-disable-next-line import/no-nodejs-modules -- It writes a stub CLI and fixture frames.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { holds } from '../scripts/staging-smoke/checks.mjs';
import { KEYFRAMES } from '../scripts/staging-smoke/scenarios.mjs';
import { keepRun, lastRelease, releases } from '../scripts/staging-smoke/store.mjs';
import { changelogBullets, parseVision, visionFindings, visionPass } from '../scripts/staging-smoke/vision.mjs';

const ROOT = resolve('tmp/staging-smoke-vision-test');
const FFMPEG = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const PATH = process.env['PATH'];

/** A solid 402x874 frame. */
function frame(path: string, color: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=402x874:d=1`, '-frames:v', '1', path]);
  return path;
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'bin'), { recursive: true });
  // the stub reads its prompt: a bullet about the main menu explains the change, otherwise it is a regression
  writeFileSync(join(ROOT, 'bin', 'claude'), `#!/bin/sh
echo "$@" >> "${join(ROOT, 'calls.log')}"
case "$2" in
  *"new main menu"*) printf '%s\n' '{"type":"result","result":"Looking at it.\\n{\\"verdict\\":\\"changed\\",\\"severity\\":null,\\"bullet\\":\\"The new main menu shows every zone.\\",\\"line\\":\\"the title is the new main menu\\"}"}' ;;
  *) printf '%s\n' '{"type":"result","result":"{\\"verdict\\":\\"regressed\\",\\"severity\\":\\"P1\\",\\"bullet\\":null,\\"line\\":\\"the main menu shows where play was\\"}"}' ;;
esac
`);
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

test.skipIf(!FFMPEG)('the vision judge: regressed P1 holds, a matching bullet is changed, no previous release is baseline', () => {
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
  const regressed = visionPass({ scenarios, release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: ['Faster loading.'], out });
  expect(regressed).toMatchObject([{ scenario: 'K3', verdict: 'regressed', severity: 'P1' }]);
  expect(existsSync(regressed[0]?.sheet ?? '')).toBe(true);
  expect(holds(visionFindings(regressed))).toBe(true);
  expect(readFileSync(join(ROOT, 'calls.log'), 'utf8')).toContain('--model claude-opus-5-5');
  const changed = visionPass({ scenarios, release: 'v0.1.34', ...(last === undefined ? {} : { last }), bullets: ['The new main menu shows every zone.'], out });
  expect(changed).toMatchObject([{ scenario: 'K3', verdict: 'changed', bullet: 'The new main menu shows every zone.' }]);
  expect(visionFindings(changed)).toEqual([]);
  const baseline = visionPass({ scenarios, release: 'v0.1.34', bullets: [], out });
  expect(baseline).toMatchObject([{ scenario: 'K3', verdict: 'baseline' }]);
});

test('the store keeps the last 5 releases', () => {
  const store = join(ROOT, 'retain'), out = join(ROOT, 'retain-run');
  for (let i = 1; i <= 7; i++) keepRun(store, `v0.1.${String(i)}`, out, { release: `v0.1.${String(i)}`, at: `2026-11-1${String(i)}T00:00:00.000Z`, scenarios: [], findings: [], hold: false });
  expect(releases(store).map(r => r.release)).toEqual(['v0.1.7', 'v0.1.6', 'v0.1.5', 'v0.1.4', 'v0.1.3']);
});
