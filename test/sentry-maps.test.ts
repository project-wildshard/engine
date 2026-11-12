// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The map walk reads a real build-shaped folder in owned tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under the repository's tmp directory.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { mapRoots, SENTRY_CLI, sentryMapPlan, sentryToken } from '../scripts/sentry-maps.mjs';
import { browserErrorDist, browserErrorRelease } from '../src/client/engine/telemetry/browserErrors';
import { WILDSHARD_IDENTITY } from '../src/client/game/identity';
import preview from '../.github/workflows/preview.yml?raw';
import workersHost from '../scripts/page-release/hosts/workers.mjs?raw';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function build(files: Record<string, string>): string {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/sentry-maps-')); roots.push(root);
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  }
  return root;
}

test('the upload names the release and dist the page reports with', () => {
  const build = '6f09c8b-mwcf6bcs';
  const plan = sentryMapPlan({ dir: 'dist', version: '0.1.8', build, environment: 'preview', roots: ['b'] });
  expect(plan.release).toBe(browserErrorRelease(WILDSHARD_IDENTITY.fileSlug, '0.1.8'));
  expect(plan.dist).toBe(browserErrorDist(build));
  const long = 'x'.repeat(65);
  expect(sentryMapPlan({ dir: 'dist', version: '0.1.8', build: long, environment: 'staging', roots: ['b'] }).dist)
    .toBe(browserErrorDist(long));
});

test('one upload per folder of maps, under that folder\'s URL, between the release and its deploy', () => {
  const plan = sentryMapPlan({ dir: 'dist', version: '0.1.8', build: 'a'.repeat(40), environment: 'production', roots: ['assets', 'b'] });
  expect(plan.commands.map((command) => command.slice(0, 2).join(' ')))
    .toEqual(['releases new', 'sourcemaps upload', 'sourcemaps upload', 'deploys new']);
  const uploads = plan.commands.filter((command) => command[0] === 'sourcemaps');
  expect(uploads.map((command) => command[command.indexOf('--url-prefix') + 1])).toEqual(['~/assets', '~/b']);
  expect(uploads.map((command) => command.at(-1))).toEqual([join('dist', 'assets'), join('dist', 'b')]);
  for (const command of plan.commands) expect(command).toEqual(expect.arrayContaining(['--org', 'wildshard', '--project', 'wildshard-game']));
  expect(plan.commands.at(-1)).toEqual(expect.arrayContaining(['--env', 'production', '--release', 'wildshard@0.1.8']));
});

test('it refuses an unknown environment, a bad version, no build id and a build with no maps', () => {
  const ok = { dir: 'dist', version: '0.1.8', build: 'abc', environment: 'staging', roots: ['b'] };
  expect(() => sentryMapPlan({ ...ok, environment: 'development' })).toThrow(/environment/u);
  expect(() => sentryMapPlan({ ...ok, version: 'main' })).toThrow(/version/u);
  expect(() => sentryMapPlan({ ...ok, build: '' })).toThrow(/build/u);
  expect(() => sentryMapPlan({ ...ok, roots: [] })).toThrow(/no source maps/u);
});

test('the map walk finds the folders that hold maps, at any depth', () => {
  const dir = build({ 'b/c/entry-1.js': 'x', 'b/c/entry-1.js.map': '{}', 'b/abc/main.js': 'x', 'b/abc/main.js.map': '{}',
    'assets/w.js': 'x', 'assets/w.js.map': '{}', 'shardfiles/home/blob.bin': 'x', 'sw.js': 'x', 'version.json': '{}' });
  expect(mapRoots(dir)).toEqual(['assets', 'b']);
  expect(mapRoots(build({ 'b/c/entry.js': 'x', 'version.json': '{}' }))).toEqual([]);
});

test('the token comes from the environment first, then the private file, else none', () => {
  const dir = build({ 'token': ' file-token\n' });
  expect(sentryToken({ SENTRY_AUTH_TOKEN: ' env-token ' }, join(dir, 'token'))).toBe('env-token');
  expect(sentryToken({}, join(dir, 'token'))).toBe('file-token');
  expect(sentryToken({}, join(dir, 'absent'))).toBe('');
});

test('preview releases through the Workers host, which sends the maps before it strips them, with the Sentry token', () => {
  expect(preview).toContain('node scripts/page-release.mjs preview build,upload,check,go-live --host=workers');
  const step = preview.slice(preview.lastIndexOf('- name:', preview.indexOf('scripts/page-release.mjs preview')));
  expect(step).toContain('SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}');
  expect(step).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
  const upload = workersHost.indexOf("'scripts/sentry-maps.mjs', 'dist', '--environment'");
  expect(upload).toBeGreaterThan(0);
  expect(upload).toBeLessThan(workersHost.indexOf('stripSourceMaps(dist)'));
  expect(SENTRY_CLI).toMatch(/^@sentry\/cli@\d+\.\d+\.\d+$/u);
});
