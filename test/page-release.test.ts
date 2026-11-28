// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- An in-memory Ed25519 key signs the fake channel files; SHA-1 is the fake host's digest.
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The Workers host packages a real dist/ in owned scratch under tmp/.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The CLI's usage check runs as a child, before any git or host call.
import {spawnSync} from 'node:child_process';
import {afterEach, expect, test} from 'vitest';
import {CHANNELS, CHECKED_DOCUMENTS, PHASES, PUBLIC_ROOMS, QA_LEGS, RELEASE_PUBLIC_KEY, qaGap, pinnedReleaseKey, RefusedError, runPhase, ownTablePath, type Channel, type Deps, type PageHost, type Phase} from '../src/scripts/page-release/flow.mjs';
import {runRedacted} from '../src/scripts/page-release/redact.mjs';
import {finishQaLeg} from '../src/scripts/page-release/staging-deploy.mjs';
import {CONFIG, WORKERS, isVersionUrl, workersHost} from '../src/scripts/page-release/hosts/workers.mjs';
import {measureAssets} from '../src/scripts/app-build/assetLimits.mjs';

const build = 'a'.repeat(40);
const zoneEntry = (on = build) => ({build:on, engine:'webkit', profile:'phone', pass:true, expected:2, arrivals:[
  {from:'driftwood-isle', to:'far-reach'}, {from:'far-reach', to:'driftwood-isle'},
]});
/** STAGING-QA SQ15: one staging-qa verdict for `on`, the candidate's full leg, clean unless `hold`. */
const qaOn = (on: string = build, hold = false) => ({qa: true, kind: 'candidate', full: true, build: on, url: CHANNELS.staging.origin,
  scenarios: QA_LEGS.candidate.map(id => ({id, status: id === 'K1' ? 'skip' : 'ran'})), hold,
  findings: hold ? [{scenario: 'K6', key: 'black-world', severity: 'P0', text: 'the world is black or empty'}] : [],
  deploy:{zoneEntry:zoneEntry(on)}});
const source = 'b'.repeat(40);
const localQa = {qa: true, kind: 'local', full: true, build: source, release: 'v0.1.10', url: 'http://127.0.0.1:4400', hold: false,
  scenarios: ['K3', 'K4', 'K5'].map(id => ({id, status: 'ran'})),
  proofs: [{id: 'gate-chromium', pass: true}, {id: 'journey-webkit', pass: true}]};
const candidateQa = (deploymentId = 'dpl_1') => ({...qaOn(), release: 'v0.1.10', deploymentId, roomsSerial: 7});
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const key = publicKey.export({format: 'der', type: 'spki'}).toString('hex');
const token = ['host', 'credential', 'marker'].join('-');

function signed(channel: Exclude<Channel, 'explore'>, serial: number, engineBuild = build) {
  const body = JSON.stringify({channel, serial, engineBuild, saveEpoch: 1, ...(channel === 'preview' ? {} : {socket: CHANNELS[channel].socket})});
  return {body, signature: sign(null, Buffer.from(body), privateKey).toString('hex')};
}

function page(channel: Channel) {
  if (channel === 'explore') return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};globalThis.__WS_EXPLORE__=true;</script>`);
  if (channel === 'preview') return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};</script>`);
  const world = JSON.stringify({release: CHANNELS[channel].release, key});
  return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};globalThis.__WS_WORLD__=${world};</script>`);
}

/** PV16: a staging build writes its own zone table first (none in the rig: its pins name no shard version). */
const OWN_TABLE = `run node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs own /root/tmp/page-release/staging-${build}-zone-table.json --channel=staging --build=${build}`;

function rig(channel: Channel = 'staging') {
  const calls: string[] = [];
  const lines: string[] = [];
  const state: Record<string, object> = {};
  const files = new Map<string, Uint8Array>([
    ['/out/version.json', Buffer.from(JSON.stringify({build, saveEpoch: 1}))],
    ['/out/index.html', page(channel)],
    ['/out/sw.js', Buffer.from('self.addEventListener("fetch", () => {});')],
    ['/out/deploy-chunks.json', Buffer.from(JSON.stringify({builds: [build]}))],
  ]);
  const deployedFiles = new Map(files);
  const live = {
    release: signed(channel === 'explore' ? 'staging' : channel, 7) as unknown,
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
    ...(channel === 'staging' ? {localQa, localQaSource: source, qa: candidateQa()} : {}),
    packs: {
      publish: ({dryRun}) => { if (!dryRun) calls.push('packs.publish'); return Promise.resolve({parts: 3, uploaded: 1, held: 2, book: 'b', cors: CHANNELS[channel].origin}); },
      verify: () => { calls.push('packs.verify'); return Promise.resolve({parts: 3, uploaded: 0, held: 3, book: 'b', cors: CHANNELS[channel].origin}); },
    },
    run: (file, args) => { calls.push(`run ${file} ${args.join(' ')}`); },
    fetchJSON: url => {
      calls.push(`fetch ${url}`);
      const config = CHANNELS[channel];
      if (url === config.release) return Promise.resolve(live.release);
      if (!config.solo && url === config.health) return Promise.resolve(live.health);
      if (url === `${CHANNELS.staging.origin}/version.json` && (channel === 'production' || channel === 'explore')) return Promise.resolve(live.stagingVersion);
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

const fetched = (calls: string[]) => calls.filter(call => !call.startsWith('fetch '));

async function through(deps: Deps, last: Phase) {
  for (const phase of PHASES) {
    await runPhase(phase, deps);
    if (phase === last) return;
  }
}

test('the four phases run in order and move the alias last', async () => {
  const {deps, calls, lines} = rig();
  await through(deps, 'go-live');
  expect(fetched(calls)).toEqual([
    OWN_TABLE, 'prepare', 'run pnpm build:game', 'run node src/scripts/app-build/splitOutput.mjs dist --join --no-shard-content', 'package', 'state build',
    'packs.publish', 'upload', 'state upload',
    'run node src/scripts/release-cook.mjs --staging --build=' + build,
    'run node --import ./src/scripts/bake-loader.mjs src/scripts/release-placed-ready.mjs staging',
    'deployedDigests', 'packs.verify', 'state check',
    'run node --import ./src/scripts/bake-loader.mjs src/scripts/release-placed-ready.mjs staging',
    'deployedDigests', 'run node src/scripts/release-cook.mjs --staging --build=' + build, 'goLive', 'state go-live',
  ]);
  expect(lines.some(line => line.includes('alias last'))).toBe(true);
});

test('staging go-live binds both complete QA verdicts to the source, deployment and signed serial', async () => {
  const {deps, calls, live} = rig();
  await through(deps, 'check');
  delete deps.localQa;
  delete deps.qa;
  const dry = await runPhase('go-live', {...deps, dryRun: true});
  expect(dry.refusals.join(' ')).toMatch(/--local-qa.*--qa=/u);
  await expect(runPhase('go-live', deps)).rejects.toThrow(/--local-qa/u);
  deps.localQa = {...localQa, build};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/exact release source/u);
  const gate = {id: 'gate-chromium', pass: true};
  deps.localQa = {...localQa, proofs: [gate, {id: 'ios-safari', pass: true}]};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/journey-webkit/u);
  deps.localQa = {...localQa, proofs: [gate, {id: 'journey-webkit', pass: false}]};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/journey-webkit/u);
  deps.localQa = localQa;
  await expect(runPhase('go-live', deps)).rejects.toThrow(/--qa=/u);
  deps.qa = {...candidateQa(), build: source};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/verdict is for/u);
  deps.qa = {...candidateQa(), hold: true};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/it holds/u);
  deps.qa = candidateQa('old-deployment');
  await expect(runPhase('go-live', deps)).rejects.toThrow(/different Worker deployment/u);
  deps.qa = candidateQa();
  live.release = signed('staging', 8);
  live.health = {build, serial: 8};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/serial changed since candidate QA/u);
  expect(calls).not.toContain('goLive');
  live.release = signed('staging', 7);
  live.health = {build, serial: 7};
  await runPhase('go-live', deps);
  expect(calls).toContain('goLive');
});

test('PV15: no channel publishes a content set or stamps a base; staging and production join no shard content', async () => {
  for (const channel of ['preview', 'explore', 'staging', 'production'] as const) {
    // the dry run of the release plans no `content/<set>/` key and no stamped base (`dist-content/` is the local tree
    // it joins), and the world channels' join refuses shard content
    const dry = rig(channel);
    dry.deps.dryRun = true;
    if (channel === 'explore') dry.deps.catalogue = '/catalogue.json';
    for (const phase of ['build', 'upload'] as const) await runPhase(phase, dry.deps);
    expect(dry.lines.some(line => /(?<![-\w])content\/|content set's base/u.test(line))).toBe(false);
    const world = channel === 'staging' || channel === 'production';
    expect(dry.lines.some(line => line.includes('join build-owned files and engine art into dist/, refusing zone payloads'))).toBe(world);
    expect(dry.lines.some(line => line.includes('join dist-content/ back into dist/'))).toBe(!world);
    if (channel === 'explore') continue;
    // the real build passes no content base to build:game
    const real = rig(channel);
    const envs: Record<string, string>[] = [];
    const run = real.deps.run;
    real.deps.run = (file, args, env) => { envs.push(env); run(file, args, env); };
    await runPhase('build', real.deps);
    expect(envs.length).toBeGreaterThan(0);
    expect(envs.some(env => 'WS_CONTENT_BASE' in env)).toBe(false);
  }
});

test('the build bakes the channel release file from packs.wildshard.io', async () => {
  for (const channel of ['staging', 'production'] as const) {
    const {deps} = rig(channel);
    const seen: Record<string, string>[] = [];
    deps.run = (_file, _args, env) => { seen.push(env); };
    await runPhase('build', deps);
    expect(seen[1]?.['WILDSHARD_RELEASE_URL']).toBe(`https://releases.wildshard.io/${channel}.json`);
    expect(seen[1]?.['WS_BUILD_ID']).toBe(build);
    // OFF-VERCEL OV3: a release build says so, and carries old builds from its own channel's domain.
    expect(seen[1]?.['WS_RELEASE']).toBe('1');
    expect(seen[1]?.['WS_CHANNEL']).toBe(channel);
    expect(seen[1]?.['WS_PREVIOUS_DEPLOY_ORIGIN']).toBe(channel === 'production' ? 'https://play.wildshard.io' : 'https://staging.wildshard.io');
    expect(seen[1]?.['VITE_API_ORIGIN']).toBe('https://api.wildshard.io');
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

// SHELL-CUTOVER SC2 (WWW W8): the train promotes only a client the production world accepts. Go-live re-reads production's
// signed release file and the world's /health; a candidate either doesn't name holds with the reason, and play's alias stays.
test('production go-live holds a candidate the world does not run, with the reason, and never moves play', async () => {
  const {deps, calls, live} = rig('production');
  await through(deps, 'check');
  deps.qa = qaOn();
  live.release = signed('production', 8, 'd'.repeat(40));
  await expect(runPhase('go-live', deps)).rejects.toThrow(/production\.json serial 8 signs d+, not /u);
  live.release = signed('production', 7);
  live.health = {build: 'd'.repeat(40), serial: 7};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/health shows d+ serial 7, not /u);
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

test('staging moves the cook once the new rooms release is signed, before waiting on rooms', async () => {
  const {deps, calls, live} = rig();
  await through(deps, 'upload');
  live.release = signed('staging', 6, source);
  live.health = {build: source, serial: 6};
  calls.length = 0;
  let clock = 0;
  deps.now = () => clock;
  deps.waitMs = 20_000;
  deps.sleep = ms => {
    clock += ms;
    if (clock === 5000) {
      live.release = signed('staging', 7);
      calls.push('new rooms release signed');
    }
    if (clock >= 10_000) live.health = {build, serial: 7};
    return Promise.resolve();
  };
  await runPhase('check', deps);
  const move = 'run node src/scripts/release-cook.mjs --staging --build=' + build;
  const health = 'fetch ' + CHANNELS.staging.health;
  expect(calls.filter(call => call === move)).toHaveLength(1);
  expect(calls.indexOf(move)).toBeGreaterThan(calls.indexOf('new rooms release signed'));
  expect(calls.indexOf(move)).toBeLessThan(calls.indexOf(health));
  expect(calls.indexOf(move)).toBeLessThan(calls.indexOf('run node --import ./src/scripts/bake-loader.mjs src/scripts/release-placed-ready.mjs staging'));
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
  await expect(runPhase('go-live', deps)).rejects.toThrow(/staging QA verdict.*no --qa verdict/u);
  expect(calls).not.toContain('goLive');
  deps.qa = qaOn();
  await runPhase('go-live', deps);
  expect(fetched(calls).at(-2)).toBe('goLive');
});

test('QA59 production waits for the exact HTML after version.json reaches the edge', async () => {
  const {deps, calls, state} = rig('production');
  await through(deps, 'check');
  deps.qa = qaOn();
  const current = page('production').toString(), pauses: number[] = [];
  const responses = [current.replace(build, 'f'.repeat(40)), current.replace(CHANNELS.production.release, CHANNELS.staging.release), current];
  deps.fetchText = () => Promise.resolve(responses.shift() ?? current);
  deps.sleep = ms => { pauses.push(ms); return Promise.resolve(); };
  await runPhase('go-live', deps);
  expect(pauses).toEqual([10000, 10000]);
  expect(calls.filter(call => call === `fetch ${CHANNELS.production.origin}/version.json`)).toHaveLength(3);
  expect(state['go-live']).toMatchObject({build});

  deps.fetchText = () => Promise.resolve(current.replace(CHANNELS.production.release, CHANNELS.staging.release));
  await expect(runPhase('go-live', deps)).rejects.toThrow(/page does not name only/u);
  expect(pauses).toHaveLength(14);
});

// Production go-live reads one staging deploy verdict with J451's full phone walk. A P0 or P1 holds it.
test('production go-live needs one clean staging QA verdict for this build', async () => {
  const {deps, calls} = rig('production');
  await through(deps, 'check');
  await expect(runPhase('go-live', deps)).rejects.toThrow(/staging QA verdict.*no --qa verdict/u);
  deps.qa = qaOn('b'.repeat(40));
  await expect(runPhase('go-live', deps)).rejects.toThrow(/staging QA verdict.*verdict is for bbbbbbbb, not aaaaaaaa/u);
  deps.qa = qaOn(build, true);
  await expect(runPhase('go-live', deps)).rejects.toThrow(/staging QA verdict.*holds: P0 K6 the world is black or empty/u);
  deps.qa = {...qaOn(), kind: 'local'};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/a local leg/u);
  deps.qa = {...qaOn(), full: false};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/partial run/u);
  deps.qa = {...qaOn(), qa: false};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/not a staging-qa\.mjs verdict/u);
  deps.qa = {...qaOn(), url: 'http://127.0.0.1:4400'};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/ran on http:\/\/127\.0\.0\.1:4400/u);
  deps.qa = {...qaOn(), scenarios: [{id: 'K1', status: 'ran'}, {id: 'K6', status: 'crashed'}]};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/K2 missing, K5 missing, K6 crashed/u);
  deps.qa = {problem: 'tmp/qa/verdict.json: ENOENT'};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/ENOENT/u);
  deps.qa = {...qaOn(), deploy: {}};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/no J451 zone-entry smoke/u);
  deps.qa = {...qaOn(), deploy:{zoneEntry: {...zoneEntry(), arrivals: zoneEntry().arrivals.slice(0, 1)}}};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/did not complete every live neighbour pair/u);
  deps.qa = {...qaOn(), deploy:{zoneEntry: {...zoneEntry(), pass:false,
    failure:{from:'driftwood-isle', to:'far-reach', reason:'world is black'}}}};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/driftwood-isle -> far-reach: world is black/u);
  expect(calls).not.toContain('goLive');
  expect(qaGap({...qaOn(), kind: 'staging', scenarios: QA_LEGS.staging.map(id => ({id, status: 'ran'}))}, build)).toBeUndefined();
  deps.qa = qaOn();
  await runPhase('go-live', deps);
  expect(fetched(calls).at(-2)).toBe('goLive');
});

test('production accepts the exact saved live verdict after staging moves on', async () => {
  const {deps, calls, live} = rig('production');
  await through(deps, 'upload');
  live.stagingVersion = {build: 'b'.repeat(40), saveEpoch: 1};
  deps.qa = qaOn();
  await expect(runPhase('check', deps)).rejects.toThrow(/exact live verdict/u);
  deps.qa = {...qaOn(), kind: 'staging', scenarios: QA_LEGS.staging.map(id => ({id, status: 'ran'}))};
  await runPhase('check', deps);
  await runPhase('go-live', deps);
  expect(calls).toContain('goLive');
});

test('a dirty tree or another HEAD refuses before the host is touched', async () => {
  const {deps, calls} = rig();
  deps.git.clean = () => false;
  await expect(runPhase('build', deps)).rejects.toThrow(/not clean/);
  deps.git.clean = () => true;
  deps.git.head = () => 'b'.repeat(40);
  await expect(runPhase('build', deps)).rejects.toThrow(/HEAD/);
  expect(fetched(calls)).toEqual([]);
});

test('--dry-run mutates nothing, reports gates and never prints a credential', async () => {
  const {deps, calls, lines, live} = rig();
  deps.dryRun = true;
  live.health = {build, serial: 6};
  const refusals: string[] = [];
  for (const phase of PHASES) refusals.push(...(await runPhase(phase, deps)).refusals);
  expect(fetched(calls)).toEqual([]);
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

test('every channel has one page host, workers: any other --host is a usage error (OFF-VERCEL OV9)', () => {
  for (const channel of ['preview', 'staging', 'production']) {
    const old = spawnSync(process.execPath, ['src/scripts/page-release.mjs', channel, 'build', '--host=old', '--dry-run'], {encoding: 'utf8', timeout: 20_000});
    expect(old.status, old.stderr).toBe(2);
    expect(old.stderr).toContain('[--host=workers]');
  }
});

test('a build with no signing key is refused before any work (v0.1.96 failed it after the whole build)', () => {
  const env = {...process.env, E7_RELEASE_SIGNING_KEY: ''};
  for (const channel of ['preview', 'staging', 'production']) {
    const run = spawnSync(process.execPath, ['src/scripts/page-release.mjs', channel, 'build,upload'], {encoding: 'utf8', timeout: 20_000, env});
    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toContain('E7_RELEASE_SIGNING_KEY');
  }
});

test('--print-env: the three channels build alike but for named keys (PAGE-SIZE PZ6)', () => {
  const envs = Object.fromEntries((['preview', 'staging', 'production'] as const).map(channel => {
    const run = spawnSync(process.execPath, ['src/scripts/page-release.mjs', '--print-env', channel], {encoding: 'utf8', timeout: 20_000});
    expect(run.status, run.stderr).toBe(0);
    return [channel, new Map(run.stdout.trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))];
  }));
  const names = new Set(Object.values(envs).flatMap(env => [...env.keys()]));
  const differing = [...names].filter(name => new Set(Object.values(envs).map(env => env.get(name))).size > 1).sort();
  // PZ6's done-when allows release URL, previous origin, Sentry env, icon channel and Worker env (WS_CHANNEL carries the
  // last three). Preview uses the same key for its deployment-only signed gate (PZ6 D2).
  expect(differing).toEqual(['WILDSHARD_RELEASE_URL', 'WS_CHANNEL', 'WS_PREVIOUS_DEPLOY_ORIGIN']);
  expect(envs['preview']?.get('WS_PREVIOUS_DEPLOY_ORIGIN')).toBe(CHANNELS.preview.origin);
  for (const bad of [['nowhere'], ['toString'], ['staging', '--catalogue=x.json']]) {
    const run = spawnSync(process.execPath, ['src/scripts/page-release.mjs', '--print-env', ...bad], {encoding: 'utf8', timeout: 20_000});
    expect(run.status, bad.join(' ')).toBe(2);
  }
  const borrowed = spawnSync(process.execPath, ['src/scripts/page-release.mjs', '--print-env', 'preview', '--catalogue=x.json'], {encoding: 'utf8', timeout: 20_000});
  expect(borrowed.stdout).toContain(`WILDSHARD_CATALOGUE=${resolve('x.json')}`);
});

test('PV13: preview signs no release file, reads no gate of its own, stays solo and moves the alias last', async () => {
  const {deps, calls, lines, live} = rig('preview');
  // a stale or forged releases/preview.json no longer matters: preview never reads it
  live.release = undefined;
  const seen: Record<string, string>[] = [];
  const run = deps.run;
  deps.run = (file, args, env) => { seen.push(env); run(file, args, env); };
  await through(deps, 'go-live');
  expect(fetched(calls)).toEqual([
    'prepare', 'run pnpm build:game', 'run node src/scripts/app-build/splitOutput.mjs dist --join', 'package', 'state build',
    'upload', 'state upload',
    'deployedDigests', 'state check',
    'deployedDigests', 'goLive', 'state go-live',
  ]);
  // Fix-preview PV13 (Jake, 2026-11-26: "preview deploy github action should not write to R2"): no sign step, no read of
  // the signed file, no rooms or health reads; only the preview origin itself.
  expect(calls.some(call => call.includes('page-release/preview.mjs'))).toBe(false);
  expect(calls.filter(call => call.startsWith('fetch ')).every(call => call.startsWith(`fetch ${CHANNELS.preview.origin}/`))).toBe(true);
  expect(seen[0]?.['WILDSHARD_RELEASE_URL']).toBeUndefined();
  expect(seen[0]?.['WS_CHANNEL']).toBe('preview');
  expect(seen[0]?.['WS_PREVIOUS_DEPLOY_ORIGIN']).toBe('https://preview.wildshard.io');
  expect(seen[0]?.['VITE_API_ORIGIN']).toBe('https://api.wildshard.io');
  expect(lines.some(line => line.includes('no gate of its own'))).toBe(true);
});

test('SA35: preview bakes the grid it borrowed from staging; staging and production refuse a borrowed catalogue', async () => {
  const preview = rig('preview'), seen: Record<string, string>[] = [], run = preview.deps.run;
  preview.deps.run = (file, args, env) => { seen.push(env); run(file, args, env); };
  preview.deps.catalogue = 'tmp/preview-grid/catalogue.json';
  await runPhase('build', preview.deps);
  expect(seen[0]?.['WILDSHARD_CATALOGUE']).toBe('tmp/preview-grid/catalogue.json');
  const pinned = rig('preview'), plain: Record<string, string>[] = [], runPinned = pinned.deps.run;
  pinned.deps.run = (file, args, env) => { plain.push(env); runPinned(file, args, env); };
  await runPhase('build', pinned.deps);
  expect(plain[0]?.['WILDSHARD_CATALOGUE']).toBe('test/pins/catalogue.json');
  for (const channel of ['staging', 'production'] as const) {
    const {deps} = rig(channel);
    deps.catalogue = 'tmp/preview-grid/catalogue.json';
    await expect(runPhase('build', deps)).rejects.toThrow(/--catalogue is preview's/);
  }
});

// Fix preview PV2: preview bakes the zone table it took from staging's release, and its check HEADs every cooked object before the alias.
test('PV2: preview bakes its zone table and checks the cook before go-live; staging and production refuse one', async () => {
  const preview = rig('preview'), seen: Record<string, string>[] = [], run = preview.deps.run;
  preview.deps.run = (file, args, env) => { seen.push(env); run(file, args, env); };
  preview.deps.zoneTable = 'tmp/preview-zones/zone-table.json';
  await through(preview.deps, 'check');
  expect(seen[0]?.['WS_ZONE_TABLE']).toBe('tmp/preview-zones/zone-table.json');
  const check = preview.calls.indexOf('run node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs check tmp/preview-zones/zone-table.json --page=https://preview.wildshard.io --catalogue=test/pins/catalogue.json');
  expect(check).toBeGreaterThan(preview.calls.indexOf('upload'));
  expect(check).toBeLessThan(preview.calls.indexOf('state check'));
  const plain = rig('preview'), envs: Record<string, string>[] = [], runPlain = plain.deps.run;
  plain.deps.run = (file, args, env) => { envs.push(env); runPlain(file, args, env); };
  await runPhase('build', plain.deps);
  expect(envs[0]?.['WS_ZONE_TABLE']).toBeUndefined();
  for (const channel of ['staging', 'production'] as const) {
    const {deps} = rig(channel);
    deps.zoneTable = 'tmp/preview-zones/zone-table.json';
    await expect(runPhase('build', deps)).rejects.toThrow(/--zone-table is preview's/);
  }
});

// Fix preview PV16, PV3 per channel: staging and production write their own zone table (their pins, main's cook) and build from it,
// so no channel's page holds a zone (the build's zoneless check, app-build/zoneless.mjs); its check HEADs the cook before go-live.
test('PV16: staging and production build zoneless from their own zone table, and check the cook before go-live', async () => {
  for (const channel of ['staging', 'production'] as const) {
    const {deps, calls, files} = rig(channel), seen: Record<string, string>[] = [], run = deps.run, own = ownTablePath(deps);
    expect(own).toBe(`/root/tmp/page-release/${channel}-${build}-zone-table.json`);
    deps.run = (file, args, env) => { seen.push(env); run(file, args, env); };
    files.set(own, Buffer.from('{}'));
    await runPhase('build', deps);
    const write = calls.indexOf(`run node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs own ${own} --channel=${channel} --build=${build}`);
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(calls.findIndex(call => call.startsWith('run pnpm build:game')));
    expect(seen.find(env => env['WS_CHANNEL'] === channel)?.['WS_ZONE_TABLE']).toBe(own);
    // a pin set with no shard versions writes no table (zone-table.mjs own's NOTE): the build bakes its zones, as before RL12
    const old = rig(channel), envs: Record<string, string>[] = [], runOld = old.deps.run;
    old.deps.run = (file, args, env) => { envs.push(env); runOld(file, args, env); };
    await runPhase('build', old.deps);
    expect(envs.find(env => env['WS_CHANNEL'] === channel)?.['WS_ZONE_TABLE']).toBeUndefined();
  }
  const staging = rig('staging');
  staging.files.set(ownTablePath(staging.deps), Buffer.from('{}'));
  await through(staging.deps, 'check');
  expect(staging.calls).toContain(`run node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs check ${ownTablePath(staging.deps)} --page=https://staging.wildshard.io --catalogue=test/pins/catalogue.json`);
});

// SA35 (opus-place1, 2026-11-13): flow.mjs passed the borrowed catalogue in the environment, and `build:game` set its own on top,
// so preview baked the pins' grid every time. The script's assignment now keeps a catalogue it is given, and only defaults one.
test('SA35: build:game keeps the catalogue it is given, and defaults to the pins', () => {
  const script = String((JSON.parse(readFileSync('package.json', 'utf8')) as {scripts: Record<string, string>}).scripts['build:game']);
  const assignment = /WILDSHARD_CATALOGUE=\S+/u.exec(script)?.[0];
  expect(assignment, 'build:game names a catalogue').toBeDefined();
  const baked = (given?: string): string => spawnSync('bash', ['-c', `${String(assignment)} printenv WILDSHARD_CATALOGUE`], {encoding: 'utf8',
    env: {PATH: process.env['PATH'] ?? '', ...(given === undefined ? {} : {WILDSHARD_CATALOGUE: given})}}).stdout.trim();
  expect(baked('tmp/preview-grid/catalogue.json')).toBe('tmp/preview-grid/catalogue.json');
  expect(baked()).toBe('test/pins/catalogue.json');
});

test('a preview page stamped with a world never builds', async () => {
  const {deps, files} = rig('preview');
  files.set('/out/index.html', page('staging'));
  await expect(runPhase('build', deps)).rejects.toThrow(/solo game/);
});

test('check compares every checked document, sw.js and deploy-chunks.json included', async () => {
  expect(CHECKED_DOCUMENTS).toEqual(['version.json', 'index.html', 'sw.js', 'deploy-chunks.json']);
  const {deps, deployedFiles} = rig();
  await through(deps, 'upload');
  deployedFiles.set('/out/deploy-chunks.json', Buffer.from('{"builds":[]}'));
  await expect(runPhase('check', deps)).rejects.toThrow(/deployed deploy-chunks.json/);
});

// OFF-VERCEL OV4: the Workers host, driven through the real flow by a fake wrangler and a fake version URL.
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, {recursive: true, force: true}); });

test('a child exit without a QA verdict keeps its log and reports the last lines', () => {
  const root = mkdtempSync(resolve('tmp/page-release-logs-'));
  scratch.push(root);
  const proof = join(root, 'proof');
  const logFile = 'qualification.log';
  const log = ['startup', ...Array.from({length: 12}, (_, i) => `step ${i}`), 'browser admission failed'].join('\n');
  writeFileSync(join(root, logFile), log);
  const messages: string[] = [];
  expect(() => finishQaLeg({work:root, proof, name:'qualification', code:1, log:line => messages.push(line)}))
    .toThrow('qualification did not produce its QA verdict');
  expect(readFileSync(join(proof, logFile), 'utf8')).toBe(log);
  expect(messages).toEqual([
    `qualification exited 1 (${join(proof, logFile)})`,
    log.split('\n').slice(-12).join('\n'),
  ]);
});

const versionId = '0123abcd-1111-4222-8333-444455556666';

function workersRig(channel: Channel = 'staging') {
  mkdirSync(resolve('tmp'), {recursive: true});
  const root = mkdtempSync(resolve('tmp/page-release-workers-'));
  scratch.push(root);
  mkdirSync(join(root, 'pages'), {recursive: true});
  writeFileSync(join(root, CONFIG), readFileSync(resolve(CONFIG)));
  mkdirSync(join(root, 'dist/assets'), {recursive: true});
  const {deps, live} = rig(channel);
  const local = new Map<string, Uint8Array>([
    ['version.json', Buffer.from(JSON.stringify({build, saveEpoch: 1}))],
    ['index.html', page(channel)],
    ['sw.js', Buffer.from('self.addEventListener("fetch", () => {});')],
    ['deploy-chunks.json', Buffer.from(JSON.stringify({builds: [build]}))],
  ]);
  for (const [name, bytes] of local) writeFileSync(join(root, 'dist', name), bytes);
  writeFileSync(join(root, 'dist/assets/main.js'), 'export {};');
  writeFileSync(join(root, 'dist/assets/main.js.map'), '{}');
  const served = new Map(local);
  const worker = WORKERS[channel].worker;
  const url = `https://${versionId.slice(0, 8)}-${worker}.raynos.workers.dev`;
  const wrangler: {args: string[], secrets: string[], env: NodeJS.ProcessEnv}[] = [];
  const uploadedMaps: number[] = [];
  let tag = build;
  const exec = (file: string, args: string[], options: {cwd: string, env: NodeJS.ProcessEnv}, secrets: string[]) => {
    if (file === 'node') return '';
    expect(file).toBe(join(root, 'node_modules/.bin/wrangler'));
    wrangler.push({args, secrets, env: options.env});
    if (args[0] === 'versions' && args[1] === 'upload') {
      // The upload set is dist/ as wrangler sees it (pages/wrangler.jsonc assets.directory): no source map in it.
      uploadedMaps.push(measureAssets(join(root, 'dist')).maps);
      const out = options.env['WRANGLER_OUTPUT_FILE_PATH'] ?? '';
      mkdirSync(join(out, '..'), {recursive: true});
      writeFileSync(out, `${JSON.stringify({type: 'wrangler-session', version: 1})}\n${JSON.stringify({type: 'version-upload', version: 1, worker_name: worker, version_id: versionId, preview_url: url})}\n`);
      return 'Uploaded\n';
    }
    if (args[0] === 'versions' && args[1] === 'deploy') live.domain = {build, saveEpoch: 1};
    if (args[0] === 'versions' && args[1] === 'view') return `${JSON.stringify({id: versionId, annotations: {'workers/tag': tag}})}\n`;
    return '';
  };
  const get = (input: string | URL | Request) => {
    const name = String(input).slice(url.length + 1);
    const bytes = String(input).startsWith(`${url}/`) ? served.get(name) : undefined;
    return Promise.resolve(bytes === undefined ? new Response('missing', {status: 404}) : new Response(new Uint8Array(bytes)));
  };
  const host = workersHost({token: () => token, exec, fetch: get as typeof fetch, log: () => {}});
  deps.root = root;
  deps.host = host;
  if (channel === 'staging') deps.qa = candidateQa(versionId);
  deps.readFile = path => readFileSync(path);
  return {deps, live, root, served, wrangler, url, uploadedMaps, setTag: (value: string) => { tag = value; }};
}

const verbs = (calls: {args: string[]}[]) => calls.map(call => call.args.slice(0, 2).join(' '));

test('the Workers host uploads a version, checks it, gates and deploys it last, with the token never in argv', async () => {
  const {deps, root, wrangler, uploadedMaps} = workersRig('staging');
  await through(deps, 'go-live');
  expect(uploadedMaps).toEqual([0]);
  expect(verbs(wrangler)).toEqual(['versions upload', 'versions view', 'versions view', 'versions deploy']);
  const [upload, , , deploy] = wrangler;
  expect(upload?.args).toEqual(['versions', 'upload', '--tag', build, '--message', 'v0.1.10', '--config', CONFIG, '--env', 'staging']);
  expect(deploy?.args.slice(0, 4)).toEqual(['versions', 'deploy', `${versionId}@100%`, '--yes']);
  expect(deploy?.args.slice(-2)).toEqual(['--env', 'staging']);
  for (const call of wrangler) {
    expect(call.args.join(' ')).not.toContain(token);
    expect(call.secrets).toEqual([token]);
    expect(call.env['CLOUDFLARE_ACCOUNT_ID']).toBe('0a870ffdd1b0bca67f7fedad77f67957');
  }
  // The maps left dist/ before the build phase hashed it.
  expect(existsSync(join(root, 'dist/assets/main.js.map'))).toBe(false);
  expect(existsSync(join(root, 'dist/assets/main.js'))).toBe(true);
});

test('the Workers host names production --env \'\' and preview --env preview', async () => {
  const production = workersRig('production');
  production.deps.qa = qaOn();
  await through(production.deps, 'go-live');
  expect(production.wrangler.every(call => call.args.slice(-2).join('|') === '--env|')).toBe(true);
  expect(verbs(production.wrangler).at(-1)).toBe('versions deploy');
  const preview = workersRig('preview');
  await through(preview.deps, 'go-live');
  expect(preview.wrangler.every(call => call.args.slice(-2).join('|') === '--env|preview')).toBe(true);
  expect(verbs(preview.wrangler)).toEqual(['versions upload', 'versions view', 'versions view', 'versions deploy']);
});

test('Workers go-live refuses without a /health match and never runs versions deploy', async () => {
  const {deps, live, wrangler} = workersRig('staging');
  await through(deps, 'check');
  live.health = {build, serial: 6};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/health shows/);
  live.health = {build: 'b'.repeat(40), serial: 7};
  await expect(runPhase('go-live', deps)).rejects.toThrow(RefusedError);
  expect(verbs(wrangler)).not.toContain('versions deploy');
});

test('Workers check refuses other bytes on the version URL, or a version tagged with another build', async () => {
  const bytes = workersRig('staging');
  await through(bytes.deps, 'upload');
  bytes.served.set('sw.js', Buffer.from('other'));
  await expect(runPhase('check', bytes.deps)).rejects.toThrow(/deployed sw.js/);
  const tagged = workersRig('staging');
  await through(tagged.deps, 'upload');
  tagged.setTag('c'.repeat(40));
  await expect(runPhase('check', tagged.deps)).rejects.toThrow(/tagged c+/);
  expect(verbs([...bytes.wrangler, ...tagged.wrangler])).not.toContain('versions deploy');
});

test('the Workers dry run names wrangler and the env, never the token', async () => {
  const {deps, wrangler, live} = workersRig('production');
  const lines: string[] = [];
  deps.log = line => lines.push(line);
  deps.dryRun = true;
  live.health = {build, serial: 6};
  for (const phase of PHASES) await runPhase(phase, deps);
  expect(wrangler).toEqual([]);
  const out = lines.join('\n');
  expect(out).toContain("--env ''");
  expect(out).toContain('wrangler versions deploy <deployment>@100% --yes');
  expect(out).not.toContain(token);
});

test('a version URL belongs to its id and its Worker', () => {
  expect(isVersionUrl(`https://0123abcd-wildshard-play.raynos.workers.dev`, versionId, 'wildshard-play')).toBe(true);
  expect(isVersionUrl(`https://0123abcd-wildshard-play-staging.raynos.workers.dev`, versionId, 'wildshard-play')).toBe(false);
  expect(isVersionUrl(`https://ffffffff-wildshard-play.raynos.workers.dev`, versionId, 'wildshard-play')).toBe(false);
  expect(isVersionUrl(`https://0123abcd-wildshard-play.raynos.workers.dev.evil.example`, versionId, 'wildshard-play')).toBe(false);
});

test('the Workers upload refuses a dist/ that still holds a source map (PAGE-SIZE PZ1)', async () => {
  const {deps, root, wrangler} = workersRig('staging');
  await runPhase('build', deps);
  writeFileSync(join(root, 'dist/assets/late.js.map'), '{}');
  await expect(runPhase('upload', deps)).rejects.toThrow(/source maps/);
  expect(verbs(wrangler)).toEqual([]);
});

test('page publication configuration cannot replace the pinned trust root', () => {
  for (const value of [undefined, '', '  ', RELEASE_PUBLIC_KEY, `  ${RELEASE_PUBLIC_KEY} `]) expect(pinnedReleaseKey(value)).toBe(RELEASE_PUBLIC_KEY);
  expect(() => pinnedReleaseKey(key)).toThrow('differs from the pinned release key');
  for (const channel of ['preview', 'staging', 'production']) {
    const run = spawnSync(process.execPath, ['src/scripts/page-release.mjs', '--print-env', channel], {
      encoding: 'utf8', timeout: 20_000, env: {...process.env, E7_RELEASE_PUBLIC_KEY: key},
    });
    expect(run.status).not.toBe(0); expect(run.stderr).toContain('differs from the pinned release key');
    expect(run.stdout).toBe('');
  }
});

test('retention-enabled publisher signs before packaging and gates alias on its exact deployed bytes', async () => {
  const {deps, calls, files, deployedFiles} = rig();
  deps.codeRetention = true;
  const run = deps.run;
  deps.run = (file, args, env) => {
    run(file, args, env);
    if (args[0] === 'src/scripts/code-retention.mjs') {
      files.set('/out/code-retention.json', Buffer.from('signed retained-code graph'));
      deployedFiles.set('/out/code-retention.json', Buffer.from('signed retained-code graph'));
    }
  };
  await through(deps, 'check');
  expect(calls.indexOf('run node src/scripts/code-retention.mjs /out staging')).toBeLessThan(calls.indexOf('package'));
  deployedFiles.set('/out/code-retention.json', Buffer.from('different graph'));
  await expect(runPhase('go-live', deps)).rejects.toThrow('code-retention.json');
  expect(calls).not.toContain('goLive');
});

test('an unready placed head stops the staging check before acceptance', async () => {
  const rig_ = rig();
  await through(rig_.deps, 'upload');
  const guarded: Deps = {...rig_.deps, run: (file, args, env) => {
    rig_.deps.run(file, args, env);
    if (args.includes('src/scripts/release-placed-ready.mjs')) throw new Error('placed head has no exact-build index');
  }};
  await expect(runPhase('check', guarded)).rejects.toThrow('placed head has no exact-build index');
  expect(rig_.state['check']).toBeUndefined();
  expect(rig_.calls).not.toContain('goLive');
});

test('a placement changes after check: staging rechecks it before aliasing', async () => {
  const rig_ = rig();
  await through(rig_.deps, 'check');
  const guarded: Deps = {...rig_.deps, run: (file, args, env) => {
    rig_.deps.run(file, args, env);
    if (args.includes('src/scripts/release-placed-ready.mjs')) throw new Error('new placed head is unready');
  }};
  await expect(runPhase('go-live', guarded)).rejects.toThrow('new placed head is unready');
  expect(rig_.calls).not.toContain('goLive');
});

test('staging cannot move the alias while the cook still runs the previous build', async () => {
  const rig_ = rig();
  await through(rig_.deps, 'check');
  const guarded: Deps = {...rig_.deps, run: (file, args, env) => {
    rig_.deps.run(file, args, env);
    if (args.includes('src/scripts/release-cook.mjs')) throw new Error('cook is not staging');
  }};
  await expect(runPhase('go-live', guarded)).rejects.toThrow('cook is not staging');
  expect(rig_.calls).not.toContain('goLive');
});

test('Explore deploys the live staging SHA without publishing a new world release or packs', async () => {
  const {deps, calls, files, live} = rig('explore');
  const catalogue = '/staging/catalogue.json', body = '{"placements":[]}';
  files.set(catalogue, Buffer.from(body));
  const explore = {...deps, catalogue, fetchText: (url: string) => Promise.resolve(url.endsWith('/catalogue.json') ? body : page('explore').toString())};
  for (const step of PHASES) await runPhase(step, explore);
  expect(calls).toContain('goLive');
  expect(calls).toContain('fetch https://releases.wildshard.io/staging.json');
  expect(calls).toContain('fetch https://staging.wildshard.io/version.json');
  expect(calls.some(line => line.startsWith('packs.') || line.includes('page-release/preview.mjs'))).toBe(false);
  live.stagingVersion = {...live.stagingVersion, build: source};
  await expect(runPhase('check', explore)).rejects.toThrow('version.json names');
});

test('an Explore build refuses a catalogue other than the live staging bytes', async () => {
  const {deps, files} = rig('explore');
  const catalogue = '/staging/catalogue.json';
  files.set(catalogue, Buffer.from('old'));
  await expect(runPhase('build', deps)).rejects.toThrow('Explore requires --catalogue');
  await expect(runPhase('build', {...deps, catalogue, fetchText: () => Promise.resolve('current')})).rejects.toThrow('Explore catalogue differs');
});

// FR-A15 (QA 11-25 row 31): a release reads both public rooms /up URLs before the cook and harden, after them and after the
// alias, and stops on anything but 200, because its own gates read the tailnet and passed through an hour of 521s.
test('a staging release stops when a public rooms host answers 521, and ALLOW_ROOMS_DOWN lets a fix through', async () => {
  const {deps, calls, lines} = rig();
  const status = new Map(PUBLIC_ROOMS.map(url => [url, 200]));
  deps.roomsStatus = url => { calls.push(`fetch ${url}`); return Promise.resolve(status.get(url) ?? 0); };
  await through(deps, 'go-live');
  expect(lines.filter(line => line.startsWith('PASS public rooms'))).toEqual([
    'PASS public rooms before the check: both answer 200', 'PASS public rooms after the cook and harden: both answer 200',
    'PASS public rooms after the cook and harden: both answer 200', 'PASS public rooms after the alias move: both answer 200']);

  const down = rig();
  down.deps.roomsStatus = url => Promise.resolve(url === PUBLIC_ROOMS[0] ? 521 : 200);
  await through(down.deps, 'upload');
  await expect(runPhase('check', down.deps)).rejects.toThrow(/public rooms before the check: https:\/\/rooms\.wildshard\.io\/up answered 521/);
  expect(down.calls).not.toContain('state check');

  const unread = rig();
  unread.deps.roomsStatus = () => Promise.reject(new Error('refused'));
  unread.deps.allowRoomsDown = true;
  await through(unread.deps, 'check');
  expect(unread.lines).toContain(`NOTE public rooms before the check: ${PUBLIC_ROOMS[0]} answered nothing; ${PUBLIC_ROOMS[1]} answered nothing (ALLOW_ROOMS_DOWN=1)`);
});

// FR-A17 (QA 11-25 row 35): a zone with no packs for the page's build reload-looped the shell. Production check and
// go-live read every advertised head's exact-build index and refuse while any is missing.
test('production refuses to check or go live while an advertised head has no packs for the build', async () => {
  const {deps, calls, lines} = rig('production');
  let missing = ['nalati-grasslands 404'];
  deps.productionPacks = got => { calls.push(`packs ${got}`); return Promise.resolve(missing); };
  await through(deps, 'upload');
  await expect(runPhase('check', deps)).rejects.toThrow(/production packs for .* missing on 1 head\(s\): nalati-grasslands 404/u);
  missing = [];
  await runPhase('check', deps);
  expect(lines).toContain(`PASS production packs check: every advertised head has index/${build}`);
  deps.qa = qaOn();
  missing = ['glowfen 0'];
  deps.allowMissingPacks = true;
  await runPhase('go-live', deps);
  expect(lines).toContain('NOTE production packs go-live: glowfen 0 (ALLOW_MISSING_PACKS=1)');
});

// QA 11-25 row 131 (v0.1.92, rows 121 and 123): production's go-live reads the page against its content set before the
// alias moves and again after it, comparing bytes with the set staging QA played; a miss stops the release.
test('production go-live stops on a content set that lacks what the page names, before and after the alias move', async () => {
  const {deps, calls, lines} = rig('production');
  const asked: string[] = [];
  let problems: Record<'before' | 'after', string[]> = {before: ['4 named content path(s) are not in content.json: assets/boot-tables-e42a1de3.json'], after: []};
  deps.contentReach = (when, stagingBase) => { asked.push(`${when} ${stagingBase ?? 'none'}`); return Promise.resolve({summary: `${when} ok`, problems: problems[when]}); };
  await through(deps, 'check');
  deps.qa = {...qaOn(), contentBase: 'https://packs.wildshard.io/content/d21a64ad329cfe38/'};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/production go-live refused: production content before the alias move: 4 named content path\(s\) are not in content\.json/u);
  expect(calls).not.toContain('goLive');
  expect(asked).toEqual(['before https://packs.wildshard.io/content/d21a64ad329cfe38/']);

  problems = {before: [], after: ['1 named content path(s) do not answer 200 with CORS: 404 assets/title/title-day.jpg']};
  await expect(runPhase('go-live', deps)).rejects.toThrow(/production content after the alias move: 1 named .* \(the alias has moved: fix the set forward\)/u);
  expect(calls).toContain('goLive');
  expect(calls).not.toContain('state go-live');
  expect(lines).toContain('PASS production content before the alias move: before ok');

  problems = {before: [], after: []};
  delete deps.qa.contentBase;
  await runPhase('go-live', deps);
  expect(lines).toContain('PASS production content after the alias move: after ok');
  expect(lines.some(line => line.startsWith('NOTE production content before the alias move: the staging verdict names no content set'))).toBe(true);
  expect(asked.slice(-2)).toEqual(['before none', 'after none']);

  // an unreadable page or set refuses too; ALLOW_CONTENT_GAPS=1 (J381) lets a fix-forward release through, and says so
  deps.contentReach = () => Promise.reject(new Error('content.json answered 500'));
  await expect(runPhase('go-live', deps)).rejects.toThrow(/the page or its set could not be read: content\.json answered 500/u);
  deps.allowContentGaps = true;
  await runPhase('go-live', deps);
  expect(lines).toContain('NOTE production content after the alias move: the page or its set could not be read: content.json answered 500 (ALLOW_CONTENT_GAPS=1)');
});

// QA 11-26 row 90 (J505): v0.1.102 went live on production with npm latest left on 0.1.100. Production go-live ends with
// npm latest at the tag; a miss refuses after the alias move, so the release never reads as done.
test('production go-live is not done until npm latest names the tag', async () => {
  const {deps, calls} = rig('production');
  const asked: string[] = [];
  let fail = true;
  deps.npmFinal = tag => { asked.push(tag); return fail ? Promise.reject(new Error('npm-publish run 9 for v0.1.10 ended failure')) : Promise.resolve(); };
  await through(deps, 'check');
  deps.qa = qaOn();
  await expect(runPhase('go-live', deps)).rejects.toThrow(/npm latest after the alias move: npm-publish run 9 for v0\.1\.10 ended failure \(the alias has moved; the release is not done until npm latest is 0\.1\.10/u);
  expect(calls).toContain('goLive');
  expect(asked).toEqual(['v0.1.10']);
  fail = false;
  await runPhase('go-live', deps);
  expect(asked).toEqual(['v0.1.10', 'v0.1.10']);

  // staging never asks npm for latest
  const staging = rig('staging');
  staging.deps.npmFinal = tag => { asked.push(`staging ${tag}`); return Promise.resolve(); };
  await through(staging.deps, 'go-live');
  expect(asked).toEqual(['v0.1.10', 'v0.1.10']);
});
