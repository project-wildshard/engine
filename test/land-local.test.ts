// J400 / J295: real Git coverage for local admission, races and proof reuse.
// oxlint-disable-next-line import/no-nodejs-modules -- Start the real land CLI and Git peers.
import { execFileSync, spawn } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Install and inspect owned fixture hooks.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture and script paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { localGateHatch } from '../scripts/land.mjs';
import { installProofFixture } from '../scripts/proof-fixture-install.mjs';
import { LAND, PRE_PUSH, cleanLandFixtures, fixture, prepushLines, type Fixture } from './fixtures/land-git';

afterEach(cleanLandFixtures);

function writeFixture(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

describe('land (J400): local gates and proof reuse', () => {
  test.each(['release', 'cancel-waiter', 'lost-waiter', 'cancel-holder', 'slow-holder', 'lost-holder', 'shared-origin', 'changed-waiter'])('FL8: independent clones queue full gates and cancel safely (%s)', async mode => {
    const cancelWaiter = mode === 'cancel-waiter' || mode === 'lost-waiter';
    const a = fixture(), b = fixture();
    if (mode === 'shared-origin') {
      b.git(b.repo, ['remote', 'set-url', 'origin', a.remote]);
      b.git(b.repo, ['fetch', '--quiet', 'origin', 'main']);
      b.git(b.repo, ['reset', '--hard', 'FETCH_HEAD']);
    }
    const wa = a.worktree('a'), wb = b.worktree('b');
    const c = cancelWaiter ? fixture() : undefined, wc = c?.worktree('c');
    a.env['WS_LAND_MODE'] = 'local'; b.env['WS_LAND_MODE'] = 'local';
    a.env['WS_LANE_NAME'] = 'fixture-a'; b.env['WS_LANE_NAME'] = 'fixture-b';
    b.env['WS_FULL_GATE_ROOT'] = a.env['WS_FULL_GATE_ROOT'];
    if (c !== undefined) { c.env['WS_LAND_MODE'] = 'local'; c.env['WS_LANE_NAME'] = 'fixture-c'; c.env['WS_FULL_GATE_ROOT'] = a.env['WS_FULL_GATE_ROOT']; }
    a.env['WS_HEAVY_ROOT'] = join(a.root, 'different-heavy-root');
    b.env['WS_HEAVY_ROOT'] = join(b.root, 'different-heavy-root');
    const ta = a.commit(wa, 'src/a.ts', 'export const a = 1;', 'feat: a');
    const tb = b.commit(wb, 'src/b.ts', 'export const b = 1;', 'feat: b');
    const tc = c === undefined || wc === undefined ? undefined : c.commit(wc, 'src/c.ts', 'export const c = 1;', 'feat: c');
    const sockets = new Map<string, import('node:net').Socket>();
    let firstDrained = false, overlapped = false;
    let first: () => void = () => {}, second: () => void = () => {}, third: () => void = () => {}, verdict: (value: string) => void = () => {}, queuedThird: () => void = () => {}, advancedThird: () => void = () => {};
    const readyA = new Promise<void>(done => { first = done; });
    const readyB = new Promise<void>(done => { second = done; });
    const queuedB = new Promise<string>(done => { verdict = done; });
    const readyC = new Promise<void>(done => { third = done; });
    const queuedC = new Promise<void>(done => { queuedThird = done; });
    const advancedC = new Promise<void>(done => { advancedThird = done; });
    const { createServer: gateServer } = await import('node:net');
    const server = gateServer(socket => { socket.once('data', chunk => {
      const name = chunk.toString(); sockets.set(name, socket);
      if (name === 'a') { socket.once('close', () => { firstDrained = true; }); first(); }
      else if (name === 'b') { if (!firstDrained) overlapped = true; second(); verdict('started'); } else third();
    }); });
    await new Promise<void>(done => { server.listen(0, '127.0.0.1', done); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing gate endpoint');
    const children: ReturnType<typeof spawn>[] = [];
    const stopped: Promise<void>[] = [];
    const start = (f: Fixture, wt: string, name: string) => {
      const worker = join(f.root, 'gate.mjs');
      const refresh = mode === 'shared-origin' && name === 'b' ? "if(!existsSync('src/a.ts'))throw new Error('Queued gate started without incoming main');" : '';
      const delayed = mode === 'slow-holder' && name === 'a' ? "process.once('SIGTERM',()=>setTimeout(()=>socket.end(),6000));" : '';
      writeFileSync(worker, `import {connect} from 'node:net';import {existsSync} from 'node:fs';${refresh}const socket=connect({host:'127.0.0.1',port:${address.port}},()=>socket.write(${JSON.stringify(name)}));socket.on('data',()=>socket.end());${delayed}`);
      writeFileSync(join(f.root, 'hooks/pre-push'), `#!/bin/sh\ncat >/dev/null\nnode '${worker}'\n[ -n "\${WS_LAND_HOOK_ACK:-}" ] && node "$ACK_SCRIPT"\n`); chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
      const child = spawn(process.execPath, [LAND, '--keep'], { cwd: wt, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
      let output = '';
      for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
        output += String(chunk);
        if (name === 'b' && output.includes('full-gate queue position 2')) verdict('queued');
        if (name === 'c' && output.includes('full-gate queue position 3')) queuedThird();
        if (name === 'c' && output.includes('full-gate queue position 2')) advancedThird();
      });
      const done = new Promise<{code: number | null; output: string}>(finish => { child.once('close', code => { finish({code,output}); }); });
      stopped.push(done.then(() => {})); return done;
    };
    try {
      const pa = start(a, wa, 'a'); await readyA;
      const pb = start(b, wb, 'b'); expect(await queuedB).toBe('queued');
      expect(sockets.has('b')).toBe(false);
      expect(b.read(b.files.receipts)).toContain('queue position 2');
      expect(b.read(b.files.receipts)).toContain('fixture-a');
      if (mode === 'changed-waiter') {
        b.commit(wb, 'src/new.ts', 'export const changed = true;', 'feat: changed');
        sockets.get('a')?.end('release'); expect((await pa).code).toBe(0);
        const result = await pb; expect(result.code).toBe(1); expect(result.output).toContain('queued worktree changed');
        expect(sockets.has('b')).toBe(false); return;
      }
      if (c !== undefined && wc !== undefined) {
        const pc = start(c, wc, 'c'); await queuedC;
        children[1]?.kill(mode === 'lost-waiter' ? 'SIGKILL' : 'SIGTERM'); expect((await pb).code).toBe(mode === 'lost-waiter' ? null : 1); await advancedC;
        expect(sockets.has('b')).toBe(false); expect(sockets.has('c')).toBe(false);
        sockets.get('a')?.end('release'); expect((await pa).code).toBe(0);
        await readyC; sockets.get('c')?.end('release'); expect((await pc).code).toBe(0);
        expect(c.remoteMain()).toBe(tc); expect(b.remoteMain()).not.toBe(tb);
      } else {
        if (mode === 'lost-holder') {
          children[0]?.kill('SIGKILL');
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([readyB, new Promise<never>((_done, reject) => { timeout = setTimeout(() => { reject(new Error('Lost owner kept its gate alive')); }, 10000); })]); }
          finally { clearTimeout(timeout); }
          expect((await pa).code).toBeNull(); expect(a.remoteMain()).not.toBe(ta);
        } else if (mode === 'cancel-holder' || mode === 'slow-holder') {
          children[0]?.kill('SIGTERM'); expect((await pa).code).toBe(1);
        } else { sockets.get('a')?.end('release'); expect((await pa).code).toBe(0); }
        await Promise.race([readyB, pb.then(result => { throw new Error(result.output); })]);
        if (mode === 'slow-holder' || mode === 'lost-holder') expect(overlapped).toBe(false);
        sockets.get('b')?.end('release'); expect((await pb).code).toBe(0);
        if (mode === 'shared-origin') {
          expect(a.git(a.remote, ['show', 'main:src/a.ts'])).toContain('a = 1');
          expect(a.git(a.remote, ['show', 'main:src/b.ts'])).toContain('b = 1');
        } else expect(b.remoteMain()).toBe(tb);
      }
      if (!['cancel-holder', 'slow-holder', 'lost-holder', 'shared-origin'].includes(mode)) expect(a.remoteMain()).toBe(ta);
    } finally {
      for (const socket of sockets.values()) socket.destroy();
      for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.all(stopped);
      await new Promise<void>(done => { server.close(() => { done(); }); });
    }
  }, 60000);

  test('FL8: a copied queue token cannot bypass machine admission', () => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local'; f.env['WS_FULL_GATE_TOKEN'] = 'copied';
    const wt = f.worktree('copied-token'); f.commit(wt, 'src/new.ts', 'export {};', 'feat: new');
    const result = f.land(wt); expect(result.status).toBe(1);
    expect(result.stdout).toContain('live machine queue ancestor'); expect(prepushLines(f)).toHaveLength(0);
  });

  test('J381: malformed reasons cannot enter landing receipts', () => {
    for (const reason of ['', '   ', 'a\nb', 'a\rb', 'a'.repeat(121)]) {
      expect(() => localGateHatch({ SKIP_CHECK: '1', WS_LAND_J381_REASON: reason })).toThrow('one nonempty line');
    }
    expect(localGateHatch({ WS_LAND_J381_REASON: 'Reason alone' })).toBeUndefined();
  });
  test('J381: an explicit reason retains the local hatch without claiming a full proof', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    f.env['SKIP_CHECK'] = '1';
    f.env['WS_LAND_J381_REASON'] = 'Owned repairs verified; unchanged timeout passes alone';
    const wt = f.worktree('j381');
    const tip = f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ncat >> "$PREPUSH_LOG"\n[ "${SKIP_CHECK:-}" = 1 ] || exit 1\n[ -z "${WS_LOCAL_LAND_DELTA:-}" ] || exit 1\nexit 0\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.read(f.files.receipts)).toContain('J381 SKIP_CHECK=1');
    expect(f.read(f.files.receipts)).toContain(f.env['WS_LAND_J381_REASON']);
    expect(result.stdout).not.toContain('local full proof');
    expect(f.read(f.files.gh)).toBe('');
  }, 60_000);

  test('J381: an inherited skip without a reason keeps the ordinary local gate', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    f.env['SKIP_CHECK'] = '1';
    const wt = f.worktree('unreasoned-skip');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ncat >> "$PREPUSH_LOG"\n[ -z "${SKIP_CHECK:-}" ] || exit 1\necho "pre-push RED actual failure" >&2\nexit 1\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const before = f.remoteMain();
    expect(f.land(wt).status).toBe(1);
    expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.receipts)).toContain('pre-push RED actual failure');
    expect(f.read(f.files.receipts)).not.toContain('J381 SKIP_CHECK=1');
  }, 60_000);

  test('J400: local mode lands without a plan push or Actions lookup', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('local');
    const tip = f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.git(f.remote, ['for-each-ref', '--format=%(refname)', 'refs/heads/plan/'])).toBe('');
    expect(f.read(f.files.gh)).toBe('');
    expect(prepushLines(f)).toHaveLength(1);
    expect(prepushLines(f)[0]).toContain(`land=local:${tip}`);
    expect(f.read(f.files.receipts)).toMatch(/; local;.*finished=\S+; \d+ s$/mu);
  }, 60_000);

  test('J400: interrupting the full gate drains its push and leaves main unchanged', async () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const ready = join(f.root, 'gate-ready');
    f.env['PREPUSH_READY'] = ready;
    const wt = f.worktree('interrupted');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const before = f.remoteMain();
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ntrap "exit 1" TERM INT\ncat >/dev/null\ntouch "$PREPUSH_READY"\nsleep 4\nexit 0\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const child = spawn(process.execPath, [LAND, '--keep'], { cwd: wt, env: f.env, stdio: 'ignore' });
    const done = new Promise<number | null>(_resolve => { child.once('close', code => { _resolve(code); }); });
    try {
      for (let tries = 0; tries < 300 && !existsSync(ready); tries++) await new Promise(doneWaiting => setTimeout(doneWaiting, 10));
      expect(existsSync(ready)).toBe(true);
      child.kill('SIGTERM');
      expect(await done).toBe(1);
      expect(f.remoteMain()).toBe(before);
      expect(f.read(f.files.receipts)).toContain('owned push stopped');
    } finally { if (child.exitCode === null) child.kill('SIGTERM'); }
  }, 20_000);

  test('J400: a red gate stays red when a peer also moves main', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('red-race');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\nrefs=$(cat)\necho "$refs" >> "$PREPUSH_LOG"\nsh "$RACE_SCRIPT"\necho "pre-push RED planted failure" >&2\nexit 1\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    const result = f.land(wt);
    expect(result.status).toBe(1);
    expect(prepushLines(f)).toHaveLength(1);
    expect(f.git(f.remote, ['ls-tree', 'main', '--', 'src/local.ts'])).toBe('');
  }, 60_000);

  test('FL5b: a red hook printing sample Git rejection text cannot retry as a green race', () => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('red-porcelain');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ncat >> "$PREPUSH_LOG"\nsh "$RACE_SCRIPT"\nprintf "To /sample.git\\n!\\tHEAD:refs/heads/main\\t[remote rejected] (sample)\\nDone\\n"\necho "pre-push RED planted failure" >&2\nexit 1\n');
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    expect(f.land(wt).status).toBe(1);
    expect(prepushLines(f)).toHaveLength(1);
    expect(f.read(f.files.receipts)).toContain('pre-push RED planted failure');
    expect(f.git(f.remote, ['ls-tree', 'main', '--', 'src/local.ts'])).toBe('');
  }, 60_000);

  test('J400: remote rejection after a green race cannot blame a passing CPU control', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('cpu-control-race');
    const head = f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(f.files.race, '');
    writeFileSync(join(f.root, 'hooks/pre-push'), PRE_PUSH.replace('exit 0\n', 'echo "Error: Inherited CPU grant is unavailable or is not an actual ancestor grant"\nexit 0\n'));
    writeFileSync(join(f.remote, 'hooks/update'), `#!/bin/sh\n[ "$3" = '${head}' ] && exit 1\nexit 0\n`);
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(prepushLines(f)).toHaveLength(2);
    expect(f.git(wt, ['show', 'HEAD:src/racer.ts'])).toContain('racer = 3');
  }, 60_000);

  test('FL10: a real hook terminal stderr wins over passing stdout controls', () => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('proof-cause'); f.commit(wt, 'src/feature.ts', 'export {};', 'feat: feature');
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ncat >/dev/null\necho "Error: Inherited CPU grant is unavailable or is not an actual ancestor grant"\necho "Error: Checked tree or runtime changed during the gate; no publication proof, rerun the exact tree" >&2\nexit 1\n');
    const before = f.remoteMain(), result = f.land(wt);
    expect(result.status).toBe(1); expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.receipts)).toContain('refused: Checked tree or runtime changed during the gate');
    expect(f.read(f.files.receipts)).not.toContain('refused: Inherited CPU grant');
  }, 60_000);

  test('FL10: actual task RED on stderr wins over sample stdout RED', () => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('red-cause'); f.commit(wt, 'src/feature.ts', 'export {};', 'feat: feature');
    writeFileSync(join(f.root, 'hooks/pre-push'), '#!/bin/sh\ncat >/dev/null\necho "lint RED in 1 s"\necho "  - vitest (full) RED in 1200 s" >&2\nexit 1\n');
    expect(f.land(wt).status).toBe(1);
    expect(f.read(f.files.receipts)).toContain('refused: vitest (full) RED in 1200 s');
  }, 60_000);

  test.each(['red', 'green'])('FL11: real J400 hook gets a test lease without a lane override (CSS %s)', mode => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local';
    for (const key of ['CI', 'GITHUB_ACTIONS', 'WS_FULL_SUITE', 'WS_HEAVY_ROOT', 'WS_HEAVY_TOKEN']) delete f.env[key];
    f.env['WS_HEAVY_SCHEDULER_ROOT'] = join(f.root, 'full-test');
    const wt = f.worktree(`live-j400-${mode}`);
    const publishingBin = join(f.repo, 'node_modules/.bin');
    f.env['PATH'] = `${publishingBin}:${f.env['PATH']}`;
    f.env['NODE_PATH'] = join(f.repo, 'node_modules');
    const cssPath = 'src/client/engine/ui/styles/quest.css';
    const cssChecker = readFileSync(resolve('scripts/check-css.mjs'), 'utf8');
    const files = {
      'package.json': '{"scripts":{"check":"fixture"}}\n',
      'scripts/push-budget.mjs': '',
      'scripts/heavy-lane.py': `import os, sys\nos.execv(sys.executable, [sys.executable, ${JSON.stringify(resolve('scripts/heavy-lane.py'))}, *sys.argv[1:]])\n`,
      'scripts/land-local-gate.mjs': `import ${JSON.stringify(resolve('scripts/land-local-gate.mjs'))};\n`,
      'scripts/check-css.mjs': cssChecker,
      '.githooks/push-checks.mjs': `import { createRequire } from 'node:module';\nimport { assertHeavyLease } from ${JSON.stringify(resolve('scripts/heavy-lane-lease.mjs'))};\nassertHeavyLease('full-test');\nif(requirePath().includes(${JSON.stringify(join(f.repo, 'node_modules'))}))throw new Error('gate can still resolve publishing checkout packages');\nif(process.env.PATH?.split(':').includes(${JSON.stringify(publishingBin)}))throw new Error('gate inherited publishing executable path');\nif(process.env.WS_LOCAL_LAND_REPORT_ROOT!==${JSON.stringify(wt)})throw new Error('gate would delete its report with the copy');\nfunction requirePath(){return createRequire(import.meta.url).resolve.paths('fixture-dep')??[];}\nconsole.error('fixture full checks ran inside lease');\n`,
    };
    for (const match of cssChecker.matchAll(/file: join\(ROOT, '([^']+)'\)/gu)) {
      const path = match[1] ?? '';
      if (path !== '') writeFixture(wt, path, path === cssPath && mode === 'red' ? '.ws-steer { opacity: 1; }\n' : '');
    }
    for (const [path, content] of Object.entries(files)) writeFixture(wt, path, content);
    f.git(wt, ['add', '.']);
    f.git(wt, ['commit', '-m', 'test: exercise live local hook']);
    const tip = f.git(wt, ['rev-parse', 'HEAD']), before = f.remoteMain();
    writeFileSync(join(f.root, 'hooks/pre-push'),
      `#!/bin/sh\nWS_PUSH_REFS=$(cat)\nexport WS_PUSH_REFS\nexec "${process.execPath}" "${resolve('.githooks/run-checks.mjs')}" push\n`);

    const result = f.land(wt);
    expect(result.stderr).toContain('heavy-lane: acquired full-test');
    if (mode === 'green') {
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toContain('fixture full checks ran inside lease');
      expect(f.remoteMain()).toBe(tip);
    } else {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`error: ${cssPath}:1: unknown class .ws-steer`);
      expect(result.stderr).not.toContain('fixture full checks ran inside lease');
      expect(f.read(f.files.receipts)).toContain('refused: check-css: RED (2 error(s)');
      expect(f.remoteMain()).toBe(before);
    }
  }, 60_000);

  test('FL9: a restarted real land discovers its completed pre-rebase gate', () => {
    const f = fixture(); f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('proof-restart');
    installProofFixture(wt);
    const tip = f.commit(wt, 'src/feature.ts', 'export const feature = 42;', 'feat: feature');
    const cache = JSON.stringify(resolve('scripts/push-proof-cache.mjs'));
    const delta = JSON.stringify(resolve('scripts/local-land-delta.mjs'));
    const marker = join(f.root, 'completed'), runner = join(f.root, 'gate.mjs');
    writeFileSync(runner, `import assert from 'node:assert/strict';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{capturePushTree,writePushProof}from${cache};import{discoverLocalDeltaPlan}from${delta};const context=capturePushTree('restart-fixture',{PATH:process.env.PATH,CI:'',GITHUB_ACTIONS:''});assert.ok(context);if(!existsSync(${JSON.stringify(marker)})){assert.match(readFileSync('src/feature.ts','utf8'),/42/);writePushProof(context,{mode:'full',files:['src/feature.ts']},.01);writeFileSync(${JSON.stringify(marker)},'full completed');}else{const plan=discoverLocalDeltaPlan(context,process.env.WS_LOCAL_LAND_BASE_MAIN);assert.equal(plan.eligible,true);assert.deepEqual(plan.selection.files,['src/incoming.ts']);console.error('authenticated prior full plus affected incoming test');}`);
    writeFileSync(join(f.root, 'hooks/pre-push'), `#!/bin/sh\ncat >/dev/null\nnode '${runner}' || exit 1\nnode "$ACK_SCRIPT"\n`);
    chmodSync(join(f.root, 'hooks/pre-push'), 0o755);
    writeFileSync(join(f.remote, 'hooks/update'), `#!/bin/sh\n[ "$3" = '${tip}' ] && exit 1\nexit 0\n`);
    expect(f.land(wt).status).toBe(1); expect(existsSync(marker)).toBe(true);
    execFileSync('sh', [f.peerScript('src/incoming.ts', null, 'export const incoming = 1;')], {env: f.env, stdio: 'pipe'});
    f.git(wt, ['fetch', '--quiet', 'origin', 'main']); f.git(wt, ['rebase', '--quiet', 'origin/main']);
    const result = f.land(wt); expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('authenticated prior full plus affected incoming test');
    expect(f.git(f.remote, ['show', 'main:src/feature.ts'])).toContain('42');
  }, 60_000);

  test('J400: a local red cannot move main and a race gates the rebased tree again', () => {
    const f = fixture();
    f.env['WS_LAND_MODE'] = 'local';
    const wt = f.worktree('local-red');
    f.commit(wt, 'src/local.ts', 'export const local = true;', 'feat: local');
    const before = f.remoteMain();
    writeFileSync(f.files.fail, '');
    expect(f.land(wt).status).toBe(1);
    expect(f.remoteMain()).toBe(before);
    rmSync(f.files.fail);
    const testedHead = f.git(wt, ['rev-parse', 'HEAD']);
    writeFileSync(f.files.raceScript, readFileSync(f.peerScript('src/racer.ts', null, 'export const racer = 3;'), 'utf8'));
    writeFileSync(f.files.race, '');
    const result = f.land(wt);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const lines = prepushLines(f);
    expect(lines).toHaveLength(3);
    expect(lines.every(line => line.includes('land=local:'))).toBe(true);
    expect(lines[1]).not.toBe(lines[2]);
    expect(f.git(wt, ['show', 'HEAD:src/racer.ts'])).toContain('racer = 3');
    expect(f.read(f.files.gh)).toBe('');
    const deltas = f.read(f.files.delta).trim().split('\n').map(line => JSON.parse(line) as { baseMain: string; testedHead: string; incomingMain: string; head: string });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({ baseMain: before, testedHead, incomingMain: f.git(f.peer, ['rev-parse', 'HEAD']), head: f.git(wt, ['rev-parse', 'HEAD']) });
  }, 60_000);
});
