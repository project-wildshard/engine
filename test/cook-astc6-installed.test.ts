// oxlint-disable-next-line import/no-nodejs-modules -- Lays out the installed copy.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The retry control serves only its own package on loopback.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- npm verifies the owned registry tarball against this digest.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { runCommitJobs } from '../src/scripts/precommit-jobs.mjs';

// npm defaults to a five-minute request timeout, longer than this proof's existing ninety-second command clock.
// Revalidate the registry metadata so an older cached response cannot hide a newly published pinned dependency.
const INSTALL_ARGS = ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false',
  '--prefer-online', '--fetch-retries=1', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', '--fetch-timeout=15000'];

/** Keep subprocess clocks live while Vitest enforces the case clock; drain each owned tree before removing its files. */
function installedCommands(root: string, signal: AbortSignal) {
  const logs = join(root, 'commands'); mkdirSync(logs);
  const active = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const record = (row: Record<string, unknown>) => {
    const report = process.env['WS_CI_TIMINGS'];
    if (report === undefined) return;
    mkdirSync(resolve(report, '..'), {recursive: true});
    appendFileSync(`${report}.installed-cook.jsonl`, `${JSON.stringify(row)}\n`);
  };
  return {
    async run(name: string, command: string, args: string[], cwd: string, timeoutMs = 90_000, maxBuffer = 16 * 1024 * 1024) {
      signal.throwIfAborted();
      const stdout = join(logs, `${name}.stdout`), stderr = join(logs, `${name}.stderr`);
      writeFileSync(stdout, ''); writeFileSync(stderr, '');
      const started = performance.now(); console.error(`installed-cook ${name}: start`);
      record({name, state: 'started', command, at: Date.now()});
      // Positional arguments preserve argv without shell interpolation, and separate npm's JSON from its warnings.
      const work = runCommitJobs(cwd, [{name, command: ['bash', '-c', 'out=$1; err=$2; shift 2; exec "$@" >"$out" 2>"$err"',
        'installed-cook', stdout, stderr, command, ...args]}], started + timeoutMs, {...process.env, COOK_CPU_SLOTS: '2'}, signal);
      active.add(work);
      let result;
      try { result = (await work)[0]; } finally { active.delete(work); }
      if (result === undefined) throw new Error(`Missing installed-cook ${name} result`);
      console.error(`installed-cook ${name}: exit ${result.code}, ${Math.round(performance.now() - started)} ms`);
      record({name, state: 'finished', code: result.code, timedOut: result.timedOut, cancelled: result.cancelled ?? false,
        elapsedMs: performance.now() - started, at: Date.now()});
      if (statSync(stdout).size > maxBuffer || statSync(stderr).size > maxBuffer) throw new Error(`Installed-cook ${name} output exceeds ${maxBuffer} bytes`);
      return {status: result.code, timedOut: result.timedOut, cancelled: result.cancelled ?? false, stdout: readFileSync(stdout, 'utf8'),
        stderr: `${readFileSync(stderr, 'utf8')}${result.output}`};
    },
    close() {
      closing ??= Promise.allSettled([...active]).then(() => { rmSync(root, {recursive: true, force: true}); });
      return closing;
    },
  };
}

// The cases run concurrently, each in its own root (QA 11-25 row 83): the registry case idles about 15 s on npm's real
// --fetch-timeout, which the package cook's pack, install and two cooks overlap instead of queueing behind.

// Mini QA 2026-11-16 row 41 (NB18): a shard repo cooking with the npm engine died in the 6x6 encoder's flush. Its worker
// threads import astc6Wasm.ts, Node strips types under node_modules only through src/scripts/format-hook.mjs, and module
// hooks are per thread, so every worker refused with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.

test.concurrent('the cook\'s ASTC 6x6 flush runs its worker lanes from an installed engine', async ({signal, onTestFinished}) => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/cook-astc6-installed-'));
  const commands = installedCommands(root, signal); onTestFinished(commands.close);
  try {
    const engine = join(root, 'node_modules/@wildshard/engine');
    mkdirSync(join(engine, 'src/cook/game'), { recursive: true });
    mkdirSync(join(engine, 'src/scripts/vendor'), { recursive: true });
    cpSync('src/cook/game/astc6Wasm.ts', join(engine, 'src/cook/game/astc6Wasm.ts'));
    // SF15: its lanes are bounded by their heaps (`encodeLanes.ts`), a value import the worker threads resolve too.
    cpSync('src/cook/game/encodeLanes.ts', join(engine, 'src/cook/game/encodeLanes.ts'));
    cpSync('src/scripts/format-hook.mjs', join(engine, 'src/scripts/format-hook.mjs'));
    symlinkSync(resolve('src/scripts/vendor/basisu'), join(engine, 'src/scripts/vendor/basisu'), 'dir');
    // What a shard repo's cook does: the hook on its own thread, then the engine's encoder, one lane, one input.
    writeFileSync(join(root, 'cook.mjs'), [
      "const {wasmAstc6} = await import('./node_modules/@wildshard/engine/src/cook/game/astc6Wasm.ts');",
      'const astc6 = await wasmAstc6({lanes: 1});',
      "astc6.record(new Uint8Array([1, 2, 3, 4]), 'albedo');",
      "await astc6.flush();",
      "console.log('flushed');",
    ].join('\n'));
    const run = await commands.run('worker', process.execPath, ['--import', './node_modules/@wildshard/engine/src/scripts/format-hook.mjs', 'cook.mjs'], root, 60_000, 1024 * 1024);
    expect(run.stderr).not.toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
    expect(run.stdout.trim(), run.stderr).toBe('flushed');
    expect(run.status).toBe(0);
  } finally { await commands.close(); }
}, 90_000);

// QA41's remaining package boundary: npm packs the real candidate and installs it with its declared dependencies.
// The full cook uses a valid UASTC master and the default tiers, so an invalid input cannot hide encoder failures.
test.concurrent('a freshly installed engine tarball completes a full ASTC phone cook', async ({signal, onTestFinished}) => {
  mkdirSync('tmp/codex-shards', { recursive: true });
  const root = mkdtempSync(resolve('tmp/codex-shards/cook-package-'));
  const commands = installedCommands(root, signal); onTestFinished(commands.close);
  try {
    const packed = await commands.run('pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd());
    expect(packed.status, packed.stderr).toBe(0);
    const rows = JSON.parse(packed.stdout) as {filename: string}[];
    const archive = rows[0]?.filename;
    if (archive === undefined) throw new Error('npm pack returned no archive');
    const project = join(root, 'project'); mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'installed-cook-proof', private: true, type: 'module', dependencies: { '@wildshard/engine': `file:../${archive}` } }));
    const installed = await commands.run('install', 'npm', INSTALL_ARGS, project);
    expect(installed.status, installed.stderr).toBe(0);
    cpSync('test/fixtures/installedCook.mjs', join(project, 'proof.mjs'));
    const worker = join(project, 'node_modules/@wildshard/engine/src/cook/game/astc6Wasm.ts');
    const fixed = readFileSync(worker, 'utf8');
    const old = fixed.replace('import(workerData.hook).then(() => import(workerData.module))', 'import(workerData.module)');
    expect(old).not.toBe(fixed);
    const args = ['--import', './node_modules/@wildshard/engine/src/scripts/bake-loader.mjs', 'proof.mjs'];
    // Only this owned installed fixture loses the hook. Reproduce the exact pre-fix failure, then heal it.
    writeFileSync(worker, old);
    const broken = await commands.run('broken', process.execPath, args, project);
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
    writeFileSync(worker, fixed);
    const cooked = await commands.run('cooked', process.execPath, args, project);
    expect(cooked.status, cooked.stderr).toBe(0);
    expect(JSON.parse(cooked.stdout)).toMatchObject({ slug: 'installed-cook', manifests: 4, phoneEncoded: true });
  } finally { await commands.close(); }
}, 120_000);

test.concurrent('a stalled registry request retries inside the installed cook command budget', async ({signal, onTestFinished}) => {
  const root = mkdtempSync(resolve('tmp/cook-astc6-registry-'));
  const commands = installedCommands(root, signal); onTestFinished(commands.close);
  const name = 'installed-cook-network-fixture', version = '1.0.0';
  const source = join(root, 'source'), project = join(root, 'project'); mkdirSync(source); mkdirSync(project);
  writeFileSync(join(source, 'package.json'), JSON.stringify({name, version}));
  writeFileSync(join(source, 'sentinel.txt'), 'real installed package');
  writeFileSync(join(project, 'package.json'), JSON.stringify({name: 'registry-proof', private: true, dependencies: {[name]: version}}));
  let base = '', requests = 0;
  let archive: Uint8Array = new Uint8Array();
  const server = createServer((request, response) => {
    if (request.url === `/${name}`) {
      requests++;
      if (requests === 1) return; // A real request stays open until npm's own fetch deadline expires.
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({name, 'dist-tags': {latest: version}, versions: {[version]: {name, version,
        dist: {tarball: `${base}/fixture.tgz`, shasum: createHash('sha1').update(archive).digest('hex')}}}}));
    } else if (request.url === '/fixture.tgz') response.end(archive);
    else { response.statusCode = 404; response.end(); }
  });
  try {
    const packed = await commands.run('fixture-pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], source);
    expect(packed.status, packed.stderr).toBe(0);
    const filename = (JSON.parse(packed.stdout) as {filename: string}[])[0]?.filename;
    if (filename === undefined) throw new Error('Missing registry fixture tarball');
    archive = readFileSync(join(root, filename));
    await new Promise<void>(done => { server.listen(0, '127.0.0.1', done); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing registry fixture address');
    base = `http://127.0.0.1:${address.port}`;
    const installed = await commands.run('registry-retry', 'npm', [...INSTALL_ARGS, '--registry', base, '--cache', join(root, 'cache')], project);
    expect(installed.status, installed.stderr).toBe(0);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(project, 'node_modules', name, 'sentinel.txt'), 'utf8')).toBe('real installed package');
  } finally {
    try {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((done, reject) => { server.close(error => { if (error) reject(error); else done(); }); });
    } finally { await commands.close(); }
  }
});

for (const mode of ['timeout', 'abort']) test.concurrent(`installed commands ${mode} a TERM-resistant child without blocking the case clock`, async ({signal, onTestFinished}) => {
  const root = mkdtempSync(resolve('tmp/cook-astc6-timeout-'));
  const controller = new AbortController();
  const commands = installedCommands(root, AbortSignal.any([signal, controller.signal])); onTestFinished(commands.close);
  const child = "process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)";
  try {
    let ticked = false;
    const tick = setTimeout(() => { ticked = true; }, 0);
    const abort = mode === 'abort' ? setTimeout(() => { controller.abort(); }, 1000) : undefined;
    const result = await commands.run(mode, process.execPath, ['-e', child], root, mode === 'timeout' ? 1000 : 90_000);
    clearTimeout(tick); clearTimeout(abort);
    expect(ticked).toBe(true);
    expect(result).toMatchObject(mode === 'timeout' ? {status: 124, timedOut: true, cancelled: false} : {status: 130, timedOut: false, cancelled: true});
    const pid = Number(result.stdout.trim()); expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { await commands.close(); }
});
