// Meta STAGING-SMOKE SM4: the old-cache profile hand-off. K1 and K2 leave their profiles in the release store; the next
// release's K1 and K2 restore the newest pair for the same origin; only the latest pair is kept.
// The browser run needs two built dists (an older clientVersion first) and runs only by name:
//   WS_SMOKE_HANDOFF=<old dist>,<new dist> src/scripts/browser-lane.sh --max 15 pnpm exec vitest run test/staging-smoke-profiles.test.ts
// Both are served on one port in turn (one origin, as staging), and the new one's /version.json raises minClient to its own
// clientVersion, so the old profile takes J383's forced update.
// oxlint-disable-next-line import/no-nodejs-modules -- It serves two builds and reads the store.
import { spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { runSmoke } from '../src/scripts/staging-smoke.mjs';
import { keepRun, newestProfiles, saveProfiles } from '../src/scripts/staging-smoke/store.mjs';

const ROOT = resolve('tmp/staging-smoke-profiles-test');
const HANDOFF = process.env['WS_SMOKE_HANDOFF']?.split(',');

test('saving the live leg keeps candidate history only in the archive', () => {
  const store = join(ROOT, 'leg-history');
  const release = 'v0.1.46';
  const verdict = (ids: string[]) => ({
    build: 'a'.repeat(40), hold: false, findings: [], scenarios: ids.map(id => ({id, status: 'ran'})),
  });
  const live = verdict(['K3', 'K5']);
  try {
    keepRun(store, release, join(ROOT, 'candidate-empty'), verdict(['K1', 'K2', 'K5', 'K6']));
    const archive = keepRun(store, release, join(ROOT, 'live-empty'), live);
    expect(live.scenarios.map(s => s.id)).toEqual(['K3', 'K5']);
    expect(live.hold).toBe(false);
    const kept = JSON.parse(readFileSync(join(archive, 'verdict.json'), 'utf8')) as typeof live;
    expect(kept.scenarios.map(s => s.id)).toEqual(['K1', 'K2', 'K6', 'K3', 'K5']);
  } finally {
    rmSync(store, {recursive: true, force: true});
  }
});

test('two pairs stay (this release and the one before), a re-run starts from the one before, and only the same origin restores', () => {
  const store = join(ROOT, 'unit');
  rmSync(store, { recursive: true, force: true });
  const fake = (name: string) => { const dir = join(ROOT, 'src', name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'Cookies'), name); return dir; };
  const state = { caches: ['shell'], databases: ['wildshard-saves@1'] };
  saveProfiles(store, { release: 'v0.1.33', origin: 'https://staging.wildshard.io', clientVersion: '0.1.33', states: { webkit: state } }, { chromium: fake('c33'), webkit: fake('w33') });
  saveProfiles(store, { release: 'v0.1.34', origin: 'https://staging.wildshard.io', clientVersion: '0.1.34', states: { webkit: state } }, { chromium: fake('c34'), webkit: fake('w34') });
  saveProfiles(store, { release: 'v0.1.35', origin: 'https://staging.wildshard.io', clientVersion: '0.1.35', states: { webkit: state } }, { chromium: fake('c35'), webkit: fake('w35') });
  expect(existsSync(join(store, 'v0.1.33', 'profiles'))).toBe(false);
  expect(existsSync(join(store, 'v0.1.34', 'profiles'))).toBe(true);
  // a re-run of v0.1.35 starts from v0.1.34, and saving again keeps v0.1.34
  expect(newestProfiles(store, 'https://staging.wildshard.io', 'v0.1.35')?.note.release).toBe('v0.1.34');
  saveProfiles(store, { release: 'v0.1.35', origin: 'https://staging.wildshard.io', clientVersion: '0.1.35', states: { webkit: state } }, { chromium: fake('c35'), webkit: fake('w35') });
  expect(existsSync(join(store, 'v0.1.34', 'profiles'))).toBe(true);
  const newest = newestProfiles(store, 'https://staging.wildshard.io', 'v0.1.35');
  expect(newest?.note.release).toBe('v0.1.34');
  expect(readFileSync(join(newest?.dir ?? '', 'webkit', 'Cookies'), 'utf8')).toBe('w34');
  expect(newestProfiles(store, 'http://127.0.0.1:4400')).toBeUndefined();
  rmSync(ROOT, { recursive: true, force: true });
});

/** Serve a dist with the repo's preview server; resolves when it listens. */
async function serve(dist: string, port: number): Promise<() => void> {
  const child = spawn('node', ['src/scripts/preview-server.mjs', '--outDir', dist, '--port', String(port), '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((ready, fail) => {
    child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes(`:${String(port)}/`)) ready(); });
    child.on('exit', code => { fail(new Error(`preview-server exited ${String(code)}`)); });
  });
  return () => { child.kill('SIGTERM'); };
}

test.skipIf(HANDOFF === undefined)('two builds: the first run saves the profiles, the second restores them and sees the wipe, the save and the new build', async () => {
  const [oldDist, newDist] = HANDOFF ?? [];
  if (oldDist === undefined || newDist === undefined) throw new Error('WS_SMOKE_HANDOFF=<old dist>,<new dist>');
  const store = join(ROOT, 'store'), port = 4497, url = `http://127.0.0.1:${String(port)}`;
  rmSync(ROOT, { recursive: true, force: true });
  const lines: string[] = [];
  const log = (line: string) => { lines.push(line); };
  let stop = await serve(oldDist, port);
  try {
    const first = await runSmoke({ url, release: 'v-old', out: join(ROOT, 'old'), only: ['K1', 'K2'], store, vision: false, watchMs: 3000, log });
    expect(first.scenarios.map(s => `${s.id} ${s.status}`), lines.join('\n')).toEqual(['K1 skip', 'K2 skip']);
    expect(newestProfiles(store, url)?.note.release).toBe('v-old');
  } finally { stop(); }
  // the server raises minClient to the new build's own version, as codex-ms did on staging for v0.1.31
  const versionFile = join(newDist, 'version.json'), original = readFileSync(versionFile, 'utf8');
  const version = JSON.parse(original) as { build: string, clientVersion: string, minClient: string };
  writeFileSync(versionFile, JSON.stringify({ ...version, minClient: version.clientVersion }));
  stop = await serve(newDist, port);
  try {
    const second = await runSmoke({ url, release: 'v-new', out: join(ROOT, 'new'), only: ['K1', 'K2'], store, vision: false, watchMs: 3000, log });
    expect(second.scenarios.map(s => `${s.id} ${s.status}`), lines.join('\n')).toEqual(['K1 ran', 'K2 ran']);
    for (const s of second.scenarios) {
      const checks = Object.fromEntries((s.checks ?? []).map(c => [c.key, c.ok]));
      expect(s.oldCache?.after.build, `${s.id}\n${s.log.join('\n')}`).toBe(version.build);
      expect(checks, `${s.id}\n${s.log.join('\n')}`).toMatchObject({ 'old-cache-build': true, 'old-cache-save': true, 'old-cache-wipe': true, play: true });
      expect(s.oldCache?.before.databases.some(name => name.startsWith('wildshard-saves'))).toBe(true);
    }
    expect(lines.join('\n')).toContain('old cache: v-old profiles');
    expect(newestProfiles(store, url)?.note.release).toBe('v-new');
    expect(existsSync(join(store, 'v-old', 'profiles'))).toBe(true);
  } finally { stop(); writeFileSync(versionFile, original); }
}, 900_000);
