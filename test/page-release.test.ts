// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- An in-memory Ed25519 key signs the fake channel files; SHA-1 is the fake host's digest.
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The Workers host packages a real dist/ in owned scratch under tmp/.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the scratch root to this checkout.
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {CHANNELS, CHECKED_DOCUMENTS, PHASES, RefusedError, runPhase, type Channel, type Deps, type PageHost, type Phase} from '../scripts/page-release/flow.mjs';
import {PROJECTS} from '../scripts/page-release/hosts/vercel.mjs';
import {runRedacted} from '../scripts/page-release/redact.mjs';
import {CONFIG, isVersionUrl, workersHost} from '../scripts/page-release/hosts/workers.mjs';
import {measureAssets} from '../scripts/app-build/assetLimits.mjs';

const build = 'a'.repeat(40);
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const key = publicKey.export({format: 'der', type: 'spki'}).toString('hex');
const token = ['host', 'credential', 'marker'].join('-');

function signed(channel: 'staging' | 'production', serial: number, engineBuild = build) {
  const body = JSON.stringify({channel, serial, engineBuild, saveEpoch: 1, socket: CHANNELS[channel].socket});
  return {body, signature: sign(null, Buffer.from(body), privateKey).toString('hex')};
}

function page(channel: Channel) {
  if (channel === 'preview') return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};</script>`);
  const world = JSON.stringify({release: CHANNELS[channel].release, key});
  return Buffer.from(`<script>globalThis.__WS_BUILD_ID__=${JSON.stringify(build)};globalThis.__WS_WORLD__=${world};</script>`);
}

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
    release: (channel === 'preview' ? undefined : signed(channel, 7)) as unknown,
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
      calls.push(`fetch ${url}`);
      const config = CHANNELS[channel];
      if (!config.solo && url === config.release) return Promise.resolve(live.release);
      if (!config.solo && url === config.health) return Promise.resolve(live.health);
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
    'prepare', 'run pnpm build:game', 'run node scripts/app-build/splitOutput.mjs dist --join', 'package', 'state build',
    'packs.publish', 'upload', 'state upload',
    'deployedDigests', 'packs.verify', 'state check',
    'deployedDigests', 'goLive', 'state go-live',
  ]);
  expect(lines.some(line => line.includes('alias last'))).toBe(true);
});

test('--content publishes the content set before the packs and the page (PAGE-SIZE PZ2)', async () => {
  const {deps, calls} = rig();
  const seen: {dir: string, cors: string, dryRun: boolean}[] = [];
  deps.content = {publish: context => {
    seen.push(context); calls.push('content.publish');
    return Promise.resolve({set: '0123456789abcdef', base: 'https://packs.wildshard.io/content/0123456789abcdef/', files: 5, bytes: 50, uploaded: 2, uploadedBytes: 20, held: 3, cors: context.cors});
  }};
  await through(deps, 'upload');
  expect(fetched(calls)).toEqual(['prepare', 'run pnpm build:game', 'run node scripts/app-build/splitOutput.mjs dist --join', 'package', 'state build', 'content.publish', 'packs.publish', 'upload', 'state upload']);
  expect(seen).toEqual([{dir: '/out', cors: CHANNELS.staging.origin, dryRun: false}]);
  deps.content = {publish: () => Promise.resolve({set: 's', base: 'b', files: 5, bytes: 50, uploaded: 1, uploadedBytes: 10, held: 3, cors: CHANNELS.staging.origin})};
  await expect(runPhase('upload', deps)).rejects.toThrow(/content: 3 held \+ 1 uploaded is not 5/u);
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
  expect(fetched(calls).at(-2)).toBe('goLive');
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

test('the Vercel host tells production deployments from staging ones', () => {
  expect(PROJECTS.production.host.test('https://wildshard-e7-g9ykhchce-raynos-projects.vercel.app')).toBe(true);
  expect(PROJECTS.production.host.test('https://wildshard-e7-staging-q82kfzcen-raynos-projects.vercel.app')).toBe(false);
  expect(PROJECTS.staging.host.test('https://wildshard-e7-staging-q82kfzcen-raynos-projects.vercel.app')).toBe(true);
});

test('preview is the solo game: no release file, no packs, no gate, and the alias still moves last', async () => {
  const {deps, calls, lines} = rig('preview');
  const seen: Record<string, string>[] = [];
  const run = deps.run;
  deps.run = (file, args, env) => { seen.push(env); run(file, args, env); };
  await through(deps, 'go-live');
  expect(fetched(calls)).toEqual([
    'prepare', 'run pnpm build:game', 'run node scripts/app-build/splitOutput.mjs dist --join', 'package', 'state build',
    'upload', 'state upload',
    'deployedDigests', 'state check',
    'deployedDigests', 'goLive', 'state go-live',
  ]);
  // Only the domain is read: never a release file or /health.
  expect(calls.filter(call => call.startsWith('fetch ')).every(call => call.startsWith(`fetch ${CHANNELS.preview.origin}/`))).toBe(true);
  expect(seen[0]?.['WILDSHARD_RELEASE_URL']).toBeUndefined();
  expect(seen[0]?.['WS_CHANNEL']).toBe('preview');
  expect(seen[0]?.['WS_PREVIOUS_DEPLOY_ORIGIN']).toBe('https://preview.wildshard.io');
  expect(lines.some(line => line.includes('solo, no gate'))).toBe(true);
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
  const worker = {preview: 'wildshard-play-preview', staging: 'wildshard-play-staging', production: 'wildshard-play'}[channel];
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
  production.deps.afterStagingProofs = true;
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
