// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- An in-memory Ed25519 key signs the fake channel files; SHA-1 is the fake host's digest.
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {expect, test} from 'vitest';
import {CHANNELS, PHASES, RefusedError, runPhase, type Deps, type PageHost, type Phase} from '../scripts/page-release/flow.mjs';
import {PROJECTS, runRedacted} from '../scripts/page-release/hosts/vercel.mjs';

const build = 'a'.repeat(40);
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const key = publicKey.export({format: 'der', type: 'spki'}).toString('hex');
const token = ['host', 'credential', 'marker'].join('-');

function signed(channel: 'staging' | 'production', serial: number, engineBuild = build) {
  const body = JSON.stringify({channel, serial, engineBuild, saveEpoch: 1, socket: CHANNELS[channel].socket});
  return {body, signature: sign(null, Buffer.from(body), privateKey).toString('hex')};
}

function page(channel: 'staging' | 'production') {
  const world = JSON.stringify({release: CHANNELS[channel].release, key});
  return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};globalThis.__WS_WORLD__=${world};</script>`);
}

function rig(channel: 'staging' | 'production' = 'staging') {
  const calls: string[] = [];
  const lines: string[] = [];
  const state: Record<string, object> = {};
  const files = new Map<string, Uint8Array>([
    ['/out/version.json', Buffer.from(JSON.stringify({build, saveEpoch: 1}))],
    ['/out/index.html', page(channel)],
  ]);
  const deployedFiles = new Map(files);
  const live = {
    release: signed(channel, 7) as unknown,
    health: {build, serial: 7} as unknown,
    stagingVersion: {build, saveEpoch: 1},
    domain: {build: 'old', saveEpoch: 1},
  };
  const host: PageHost = {
    name: 'fake',
    buildEnv: () => ({HOST_TOKEN: token}),
    outputDir: () => '/out',
    prepare: () => { calls.push('prepare'); return Promise.resolve(); },
    package: () => { calls.push('package'); return Promise.resolve(); },
    upload: () => { calls.push('upload'); return Promise.resolve({id: 'dpl_1', url: 'https://one.example'}); },
    deployedDigests: (_context, names) => {
      calls.push('deployedDigests');
      const digest = (name: string) => createHash('sha1').update(deployedFiles.get(`/out/${name}`) ?? new Uint8Array()).digest('hex');
      return Promise.resolve(new Map(names.map(name => [name, {algorithm: 'sha1' as const, digest: digest(name)}])));
    },
    goLive: () => { calls.push('goLive'); live.domain = {build, saveEpoch: 1}; return Promise.resolve(); },
    describe: step => [`host ${step} --token <token>`],
  };
  const deps: Deps = {
    root: '/root', channel, build, host,
    packs: {
      publish: ({dryRun}) => { if (!dryRun) calls.push('packs.publish'); return Promise.resolve({parts: 3, uploaded: 1, held: 2, book: 'b', cors: CHANNELS[channel].origin}); },
      verify: () => { calls.push('packs.verify'); return Promise.resolve({parts: 3, uploaded: 0, held: 3, book: 'b', cors: CHANNELS[channel].origin}); },
    },
    run: (file, args) => { calls.push(`run ${file} ${args.join(' ')}`); },
    fetchJSON: url => {
      if (url === CHANNELS[channel].release) return Promise.resolve(live.release);
      if (url === CHANNELS[channel].health) return Promise.resolve(live.health);
      if (url === `${CHANNELS.staging.origin}/version.json` && channel === 'production') return Promise.resolve(live.stagingVersion);
      if (url === `${CHANNELS[channel].origin}/version.json`) return Promise.resolve(live.domain);
      return Promise.reject(new Error(`unexpected ${url}`));
    },
    fetchText: () => Promise.resolve(page(channel).toString()),
    readFile: path => { const bytes = files.get(path); if (bytes === undefined) throw new Error(path); return bytes; },
    state: {read: phase => state[phase], write: (phase, value) => { state[phase] = value; calls.push(`state ${phase}`); }},
    git: {clean: () => true, head: () => build, remoteTag: () => build},
    manifest: {version: '0.1.10', saveEpoch: 1},
    log: line => lines.push(line),
    now: () => 0, sleep: () => Promise.resolve(), waitMs: 0, releaseKey: key,
  };
  return {deps, calls, lines, state, live, files, deployedFiles};
}

async function through(deps: Deps, last: Phase) {
  for (const phase of PHASES) {
    await runPhase(phase, deps);
    if (phase === last) return;
  }
}

test('the four phases run in order and move the alias last', async () => {
  const {deps, calls, lines} = rig();
  await through(deps, 'go-live');
  expect(calls).toEqual([
    'prepare', 'run pnpm build:game', 'package', 'state build',
    'packs.publish', 'upload', 'state upload',
    'deployedDigests', 'packs.verify', 'state check',
    'deployedDigests', 'goLive', 'state go-live',
  ]);
  expect(lines.some(line => line.includes('alias last'))).toBe(true);
});

test('the build bakes the channel release file from packs.wildshard.io', async () => {
  for (const channel of ['staging', 'production'] as const) {
    const {deps} = rig(channel);
    const seen: Record<string, string>[] = [];
    deps.run = (_file, _args, env) => { seen.push(env); };
    await runPhase('build', deps);
    expect(seen[0]?.['WILDSHARD_RELEASE_URL']).toBe(`https://packs.wildshard.io/releases/${channel}.json`);
    expect(seen[0]?.['WS_BUILD_ID']).toBe(build);
    // OFF-VERCEL OV3: a release build says so, and carries old builds from its own channel's domain.
    expect(seen[0]?.['WS_RELEASE']).toBe('1');
    expect(seen[0]?.['WS_CHANNEL']).toBe(channel);
    expect(seen[0]?.['WS_PREVIOUS_DEPLOY_ORIGIN']).toBe(channel === 'production' ? 'https://play.wildshard.io' : 'https://staging.wildshard.io');
  }
});

test('a phase refuses until the one before it has run for this build', async () => {
  const {deps, calls} = rig();
  await expect(runPhase('upload', deps)).rejects.toThrow(/run the build phase first/);
  await runPhase('build', deps);
  await expect(runPhase('check', deps)).rejects.toThrow(/run the upload phase first/);
  await runPhase('upload', deps);
  await expect(runPhase('go-live', deps)).rejects.toThrow(/run the check phase first/);
  expect(calls).not.toContain('goLive');
});

test('go-live refuses without a /health match and never moves the alias', async () => {
  const {deps, calls, live} = rig();
  await through(deps, 'check');
  live.health = {build, serial: 6};
  await expect(runPhase('go-live', deps)).rejects.toThrow(RefusedError);
  live.health = {build: 'b'.repeat(40), serial: 7};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/health shows/);
  expect(calls).not.toContain('goLive');
});

test('go-live refuses when the signed release names another build or does not verify', async () => {
  const {deps, calls, live} = rig();
  await through(deps, 'check');
  live.release = signed('staging', 8, 'c'.repeat(40));
  await expect(runPhase('go-live', deps)).rejects.toThrow(/signs c+/);
  live.release = {...signed('staging', 7), signature: '00'.repeat(64)};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/does not verify/);
  expect(calls).not.toContain('goLive');
});

test('check waits for the signed serial and health, and gives up without a match', async () => {
  const {deps, live, lines} = rig();
  await through(deps, 'upload');
  live.health = {build: 'old', serial: 6};
  let clock = 0;
  deps.now = () => clock;
  deps.sleep = ms => { clock += ms; if (clock >= 60_000) live.health = {build, serial: 7}; return Promise.resolve(); };
  deps.waitMs = 120_000;
  await runPhase('check', deps);
  expect(lines.some(line => line.startsWith('waiting:'))).toBe(true);
  live.health = {build: 'old', serial: 6};
  clock = 0;
  deps.sleep = ms => { clock += ms; return Promise.resolve(); };
  await expect(runPhase('check', deps)).rejects.toThrow(/gave up waiting/);
});

test('check refuses when the uploaded bytes differ from the local build', async () => {
  const {deps, deployedFiles, calls} = rig();
  await through(deps, 'upload');
  deployedFiles.set('/out/index.html', Buffer.from('<html>other</html>'));
  await expect(runPhase('check', deps)).rejects.toThrow(/deployed index.html/);
  expect(calls).not.toContain('state check');
});

test('a page naming the other channel release file never builds', async () => {
  const {deps, files} = rig();
  files.set('/out/index.html', page('production'));
  await expect(runPhase('build', deps)).rejects.toThrow(/release file is/);
});

test('production needs its tag, staging live on the build and the strict staging proofs', async () => {
  const {deps, calls, live} = rig('production');
  await through(deps, 'upload');
  deps.git.remoteTag = () => undefined;
  await expect(runPhase('check', deps)).rejects.toThrow(/tag v0.1.10/);
  deps.git.remoteTag = () => build;
  live.stagingVersion = {build: 'old', saveEpoch: 1};
  await expect(runPhase('check', deps)).rejects.toThrow(/staging goes live first/);
  live.stagingVersion = {build, saveEpoch: 1};
  await runPhase('check', deps);
  await expect(runPhase('go-live', deps)).rejects.toThrow(/--after-staging-proofs/);
  expect(calls).not.toContain('goLive');
  deps.afterStagingProofs = true;
  await runPhase('go-live', deps);
  expect(calls.at(-2)).toBe('goLive');
});

test('a dirty tree or another HEAD refuses before the host is touched', async () => {
  const {deps, calls} = rig();
  deps.git.clean = () => false;
  await expect(runPhase('build', deps)).rejects.toThrow(/not clean/);
  deps.git.clean = () => true;
  deps.git.head = () => 'b'.repeat(40);
  await expect(runPhase('build', deps)).rejects.toThrow(/HEAD/);
  expect(calls).toEqual([]);
});

test('--dry-run mutates nothing, reports gates and never prints a credential', async () => {
  const {deps, calls, lines, live} = rig();
  deps.dryRun = true;
  live.health = {build, serial: 6};
  const refusals: string[] = [];
  for (const phase of PHASES) refusals.push(...(await runPhase(phase, deps)).refusals);
  expect(calls).toEqual([]);
  expect(refusals.some(line => line.includes('health shows'))).toBe(true);
  expect(lines.join('\n')).not.toContain(token);
  expect(lines.some(line => line.startsWith('DRY-RUN would host goLive'))).toBe(true);
});

test('child output reaches the terminal with the token replaced', () => {
  const echo = ['-e', 'process.stdout.write(process.env.SECRET)'];
  const out = runRedacted(process.execPath, echo, {cwd: '.', env: {SECRET: token}}, [token]);
  expect(out).toBe('<token>');
  expect(() => runRedacted(process.execPath, ['-e', 'process.exit(3)'], {cwd: '.', env: {SECRET: token}}, [token])).toThrow(/exited 3/);
});

test('the Vercel host tells production deployments from staging ones', () => {
  expect(PROJECTS.production.host.test('https://wildshard-e7-g9ykhchce-raynos-projects.vercel.app')).toBe(true);
  expect(PROJECTS.production.host.test('https://wildshard-e7-staging-q82kfzcen-raynos-projects.vercel.app')).toBe(false);
  expect(PROJECTS.staging.host.test('https://wildshard-e7-staging-q82kfzcen-raynos-projects.vercel.app')).toBe(true);
});
