// DS16c: each enqueue preflight check refuses today's (2026-11-10) real queue
// bounce shape in a real Git fixture, and lets the clean change through.
// oxlint-disable-next-line import/no-nodejs-modules -- Real Git repositories and the real preflight CLI.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture repositories stay in the repository scratch root.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';

const engine = resolve(import.meta.dirname, '..');
const preflightCli = join(engine, 'scripts/push-preflight.mjs');
mkdirSync(resolve(engine, 'tmp'), { recursive: true });
const scratch = mkdtempSync(resolve(engine, 'tmp', 'push-preflight-'));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

// Ambient Git config, CI markers and an outer gate's lease/timing variables must not decide a fixture.
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_EDITOR: 'true',
  GIT_AUTHOR_NAME: 'Preflight', GIT_AUTHOR_EMAIL: 'preflight@example.test', GIT_COMMITTER_NAME: 'Preflight', GIT_COMMITTER_EMAIL: 'preflight@example.test',
  WS_LANE_RECEIPTS: join(scratch, 'receipts.log') };
for (const key of Object.keys(env)) {
  if (/^(?:CI|GITHUB_.*|VITEST.*|WILDSHARD_RING|WS_TEST_QUARANTINE|WS_PUSH_.*|WS_CPU_.*|WS_HEAVY_.*|WS_FULL_SUITE|WS_PREFLIGHT_.*|WS_VITEST_.*|NODE_OPTIONS)$/u.test(key)) Reflect.deleteProperty(env, key);
}

const git = (cwd: string, args: readonly string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (root: string, file: string, text: string): void => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const commit = (root: string, message: string, files: Record<string, string>): string => {
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, ['add', '--', ...Object.keys(files)]);
  git(root, ['commit', '--quiet', '--no-verify', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
};

interface Finding { readonly check: string; readonly message: string; readonly fix?: string }
interface Report { readonly refusals: readonly Finding[]; readonly warnings: readonly Finding[]; readonly seconds: number }
const check = (root: string): { code: number | null; report: Report } => {
  const result = spawnSync(process.execPath, [preflightCli, 'check', root, '--json'], { cwd: root, env, encoding: 'utf8' });
  return { code: result.status, report: JSON.parse(result.stdout) as Report };
};
const checks = (rows: readonly Finding[]): string[] => rows.map(row => row.check);

const source = (observations: readonly unknown[] = []): string => `${JSON.stringify({ localPushObservations: observations, additionalFileObservations: [] }, null, 2)}\n`;
const passing = (name: string): string => `import { expect, test } from 'vitest';\n\ntest('${name}', () => {\n  expect(1 + 1).toBe(2);\n});\n`;

/** A bare origin, a lane clone and an upstream clone sharing one seeded main. */
function fixture(name: string, seed: Record<string, string> = {}): { lane: string; upstream: string } {
  const root = join(scratch, name), remote = join(root, 'remote.git'), lane = join(root, 'lane'), upstream = join(root, 'upstream');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  git(root, ['clone', '--quiet', remote, lane]);
  git(lane, ['checkout', '--quiet', '-B', 'main']);
  commit(lane, 'seed', {
    '.gitignore': 'node_modules\ntmp\n',
    'vitest.config.mjs': "export default { test: { include: ['test/**/*.test.ts'] } };\n",
    'test/durations.json': '{}\n', 'test/durations-ring1.json': '{}\n', 'test/durations-source.json': source(),
    'src/client/engine/ui/BootSettings.ts': 'export const scale = 1;\nexport const theme = "dark";\n',
    ...seed,
  });
  git(lane, ['push', '--quiet', 'origin', 'main']);
  git(root, ['clone', '--quiet', remote, upstream]);
  for (const clone of [lane, upstream]) symlinkSync(join(engine, 'node_modules'), join(clone, 'node_modules'));
  return { lane, upstream };
}
const publish = (upstream: string, message: string, files: Record<string, string>): void => { commit(upstream, message, files); git(upstream, ['push', '--quiet', 'origin', 'main']); };

test('1. a new test file without a committed clock is refused; the local recorder fixes it', () => {
  const { lane } = fixture('timings');
  commit(lane, 'test(loading): pin the stall clock', { 'test/load-stalls.test.ts': passing('a stall is clipped') });
  const refused = check(lane);
  expect(refused.code).toBe(1);
  expect(checks(refused.report.refusals)).toEqual(['timings']);
  expect(refused.report.refusals[0]?.message).toContain('test/load-stalls.test.ts (full + Ring 1)');
  expect(refused.report.refusals[0]?.fix).toContain('push-preflight.mjs timings');

  // The fix it names: measure only that file with the gate's reporter, record, commit.
  const recorded = spawnSync(process.execPath, [preflightCli, 'timings', lane], { cwd: lane, env, encoding: 'utf8' });
  expect(recorded.status, recorded.stderr).toBe(0);
  expect(recorded.stdout).toContain('full:test/load-stalls.test.ts');
  git(lane, ['commit', '--quiet', '--no-verify', '-m', 'test(ci): record the stall clock', '--', 'test/durations.json', 'test/durations-ring1.json', 'test/durations-source.json']);
  const clean = check(lane);
  expect(clean.code).toBe(0);
  expect(clean.report.refusals).toEqual([]);
}, 60_000);

test('2. a durations-source.json append behind origin is refused; merge-durations keeps both sides', () => {
  const observation = (id: string): unknown => ({ schema: 'push-test-timing/1', sha: id.repeat(40), files: [] });
  const { lane, upstream } = fixture('durations', { 'test/durations-source.json': source([observation('a')]) });
  publish(upstream, 'test(ci): record clocks upstream', { 'test/durations-source.json': source([observation('a'), observation('b')]) });
  commit(lane, 'test(ci): record clocks in the lane', { 'test/durations-source.json': source([observation('a'), observation('c')]) });
  const refused = check(lane);
  expect(refused.code).toBe(1);
  expect(checks(refused.report.refusals)).toEqual(['conflicts']);
  expect(refused.report.refusals[0]?.message).toContain('test/durations-source.json');
  expect(refused.report.refusals[0]?.fix).toContain('merge-durations');

  expect(spawnSync('git', ['pull', '--quiet', '--rebase', 'origin', 'main'], { cwd: lane, env }).status).not.toBe(0);
  const merged = spawnSync(process.execPath, [preflightCli, 'merge-durations', lane], { cwd: lane, env, encoding: 'utf8' });
  expect(merged.status, merged.stderr).toBe(0);
  git(lane, ['add', 'test/durations-source.json']);
  git(lane, ['rebase', '--continue']);
  const both = JSON.parse(readFileSync(join(lane, 'test/durations-source.json'), 'utf8')) as { localPushObservations: unknown[] };
  expect(both.localPushObservations).toEqual([observation('a'), observation('b'), observation('c')]);
  expect(check(lane).code).toBe(0);
}, 30_000);

test('3. a new test file the gate wholly skips is refused; an unprovable condition is not', () => {
  const { lane } = fixture('skips');
  // The real Q261 shape: an env-gated browser check the queue's gate never sets.
  commit(lane, 'test(hud): check the HUD layout', { 'test/hud-layout-browser.test.ts':
    "import { test } from 'vitest';\n\nconst BASE = process.env['WS_HUD_BASE'];\n\ntest.skipIf(BASE === undefined)('no panel covers the HUD', () => {\n  if (BASE === undefined) return;\n});\n" });
  const refused = check(lane);
  expect(refused.code).toBe(1);
  expect(checks(refused.report.refusals).sort()).toEqual(['skips', 'timings']);
  expect(refused.report.refusals.find(row => row.check === 'skips')?.message).toContain('ValiError');

  const { lane: clean } = fixture('skips-clean');
  commit(clean, 'test(hud): check the HUD layout', { 'test/hud-layout.test.ts':
    "import { describe, test } from 'vitest';\n\ndescribe('hud', () => {\n  test.skipIf(process.platform === 'win32')('lays out', () => {});\n  test('counts', () => {});\n});\ndescribe.skip('later', () => { test('x', () => {}); });\n" });
  const report = check(clean).report;
  expect(checks(report.refusals)).toEqual(['timings']);
  expect(report.warnings.find(row => row.check === 'skips')?.message).toContain('test/hud-layout.test.ts adds 3 skipped or conditional');
}, 30_000);

test('4. stale official stamps only warn: the queue regenerates them after its rebase', () => {
  const stamp = (revision: string): string => `${JSON.stringify({ revision })}\n`;
  const seed = { 'package.json': '{"name":"fixture","private":true}\n', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'scripts/renderer-revision.json': stamp('0'.repeat(64)), 'scripts/validation-revision.json': stamp('0'.repeat(64)) };
  const { lane } = fixture('stamps', seed);
  commit(lane, 'fix(boot): change a renderer input', { 'src/client/engine/boot/a.ts': 'export const a = 1;\n' });
  const stale = check(lane);
  expect(stale.code).toBe(0);
  expect(stale.report.warnings.find(row => row.check === 'stamps')?.message).toContain('scripts/renderer-revision.json, scripts/validation-revision.json');

  // Fresh stamps (the official generators' values) give no warning.
  const values = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const {rendererRevision}=await import(${JSON.stringify(join(engine, 'scripts/renderer-revision.mjs'))});const {shardfileValidationRevision}=await import(${JSON.stringify(join(engine, 'scripts/shardfile-validation-revision.mjs'))});console.log(JSON.stringify([rendererRevision(process.cwd()),shardfileValidationRevision(process.cwd())]));`],
    { cwd: lane, env, encoding: 'utf8' })) as [string, string];
  commit(lane, 'chore(build): stamp', { 'scripts/renderer-revision.json': stamp(values[0]), 'scripts/validation-revision.json': stamp(values[1]) });
  // The renderer stamp hashes its own tree's inputs except itself, so one commit settles it.
  const fresh = check(lane);
  expect(fresh.code).toBe(0);
  expect(checks(fresh.report.warnings)).not.toContain('stamps');
}, 30_000);

test('5. the journal rule only warns: the queue runs no pre-commit hook', () => {
  const { lane } = fixture('journal');
  commit(lane, 'feat(ui): a big change', { 'src/client/engine/ui/big.ts': Array.from({ length: 40 }, (_, index) => `export const v${index} = ${index};`).join('\n') });
  const warned = check(lane);
  expect(warned.code).toBe(0);
  expect(warned.report.warnings.find(row => row.check === 'journal')?.message).toContain('40 lines');
  commit(lane, 'feat(ui): another big change', { 'src/client/engine/ui/big2.ts': Array.from({ length: 40 }, (_, index) => `export const w${index} = ${index};`).join('\n'), 'project/journal/2026-11-10-big.md': 'Why.\n' });
  expect(check(lane).report.warnings.filter(row => row.check === 'journal')).toHaveLength(1);
}, 30_000);

test('6. a source conflict with origin/main is refused before the queue; separate edits pass', () => {
  const { lane, upstream } = fixture('conflicts');
  publish(upstream, 'feat(ui): boot scale 2', { 'src/client/engine/ui/BootSettings.ts': 'export const scale = 2;\nexport const theme = "dark";\n' });
  commit(lane, 'feat(ui): boot scale 3', { 'src/client/engine/ui/BootSettings.ts': 'export const scale = 3;\nexport const theme = "dark";\n' });
  const refused = check(lane);
  expect(refused.code).toBe(1);
  expect(refused.report.refusals[0]?.message).toMatch(/conflicts with origin\/main \w+ on src\/client\/engine\/ui\/BootSettings\.ts/u);

  const { lane: clean, upstream: other } = fixture('conflicts-clean');
  publish(other, 'feat(ui): boot scale 2', { 'src/client/engine/ui/BootSettings.ts': 'export const scale = 2;\nexport const theme = "dark";\n' });
  commit(clean, 'feat(ui): a new file', { 'src/client/engine/ui/Other.ts': 'export const other = 1;\n' });
  const passed = check(clean);
  expect(passed.code).toBe(0);
  expect(passed.report.seconds).toBeLessThan(5);
}, 30_000);

test('enqueue refuses before capture, and an override is explicit and recorded in the job', async () => {
  const { lane, upstream } = fixture('enqueue', { '.githooks/pre-push': '#!/usr/bin/env bash\nexit 1\n' });
  publish(upstream, 'feat(ui): boot scale 2', { 'src/client/engine/ui/BootSettings.ts': 'export const scale = 2;\nexport const theme = "dark";\n' });
  commit(lane, 'feat(ui): boot scale 3', { 'src/client/engine/ui/BootSettings.ts': 'export const scale = 3;\nexport const theme = "dark";\n' });
  const root = join(scratch, 'queue');
  const enqueue = (extra: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, [join(engine, 'scripts/push-queue.mjs'), 'enqueue', lane, `--root=${root}`], { cwd: lane, env: { ...env, WS_LANE_NAME: 'fixture-lane', ...extra }, encoding: 'utf8' });
  const jobs = (): string[] => existsSync(root) ? readdirSync(root).flatMap(name => readdirSync(join(root, name)).filter(file => /^\d+-[a-f0-9]{8}\.json$/u.test(file)).map(file => join(root, name, file))) : [];

  const refused = enqueue({});
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('not enqueued');
  expect(jobs()).toEqual([]);
  expect(readFileSync(join(scratch, 'receipts.log'), 'utf8')).toMatch(/fixture-lane push preflight refused \w+ in [\d.]+ s: conflicts:/u);

  expect(enqueue({ WS_PREFLIGHT_SKIP: '1' }).status).toBe(1);
  expect(jobs()).toEqual([]);

  const reason = 'fixture proves the override is recorded';
  const overridden = enqueue({ WS_PREFLIGHT_SKIP: reason });
  expect(overridden.status, String(overridden.stderr)).toBe(0);
  const [file] = jobs();
  expect(file).toBeDefined();
  // Wait for the fixture's worker to finish (its private rebase meets the same conflict), so the
  // record we read has been rewritten by the worker and still carries the override.
  let job: { state: string; preflight?: { override?: string; refused: string[] } } = { state: 'capturing' };
  for (const started = Date.now(); Date.now() - started < 20_000;) {
    job = JSON.parse(readFileSync(file ?? '', 'utf8')) as typeof job;
    if (['failed', 'pushed'].includes(job.state)) break;
    await new Promise(done => { setTimeout(done, 50); });
  }
  expect(job.state).toBe('failed');
  expect(job.preflight?.override).toBe(reason);
  expect(job.preflight?.refused[0]).toMatch(/^conflicts: /u);
  expect(readFileSync(join(scratch, 'receipts.log'), 'utf8')).toContain(`override`);
}, 40_000);
