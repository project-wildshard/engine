// Standalone integration checks of the sender against a controlled GitHub API.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {BOOT_STAMPS} from './boot-stamps.mjs';
import {prepare, preparedRepos, runRing3, shardRepos, type Api} from './ring3.ts';
import {missingGenerated, packCommit, untracked} from './ring3-pack.ts';

const candidate = 'a'.repeat(40), shard = 'b'.repeat(40);
interface Call {method: string; path: string; body?: unknown}
function fixture(options: {install?: string; prepareRed?: string; red?: string; malformed?: boolean; pending?: boolean; wrongRun?: boolean; denied?: string; existing?: boolean} = {}): {api: Api; calls: Call[]} {
  const calls: Call[] = [];
  const api: Api = (method, path, body) => Promise.resolve().then(() => {
    calls.push({method, path, body});
    const repo = path.split('/')[2];
    if (repo === undefined || !shardRepos.includes(repo as typeof shardRepos[number])) throw new Error(`Unexpected repository: ${path}`);
    const id = shardRepos.indexOf(repo as typeof shardRepos[number]) + 100;
    if (method === 'POST' && path.endsWith('/ring-2-prepare.yml/dispatches')) {
      assert.equal(preparedRepos.includes(repo), true, `${repo} restores no preparation`);
      assert.deepEqual(body, {ref: 'main', inputs: {engine: options.install ?? candidate}, return_run_details: true});
      return {workflow_run_id: id + 1000};
    }
    if (method === 'GET' && path.endsWith(`/actions/runs/${String(id + 1000)}`)) return {id: id + 1000, event: 'workflow_dispatch', path: '.github/workflows/ring-2-prepare.yml',
      head_sha: shard, run_attempt: 1, status: 'completed', conclusion: repo === options.prepareRed ? 'failure' : 'success'};
    if (method === 'POST' && path.endsWith('/dispatches')) {
      if (repo === options.denied) throw new Error('HTTP 403');
      assert.deepEqual(body, {ref: 'main', inputs: {engine: options.install ?? candidate}, return_run_details: true});
      return options.malformed ? {} : {workflow_run_id: id};
    }
    if (method === 'GET' && path.endsWith(`/actions/runs/${id}`)) return {id: options.wrongRun ? id + 1 : id, event: 'workflow_dispatch', path: '.github/workflows/ci.yml', head_sha: shard, run_attempt: 1,
      status: options.pending ? 'queued' : 'completed', conclusion: repo === options.red ? 'failure' : 'success'};
    if (method === 'GET' && path.includes('/issues?')) return options.existing ? [{title: `[Ring 3] engine ${candidate}`, html_url: 'existing-issue'}] : [];
    if (method === 'POST' && path.endsWith('/issues')) return {html_url: `https://github.com/project-wildshard/${repo}/issues/1`};
    throw new Error(`Unexpected API call: ${method} ${path}`);
  });
  return {api, calls};
}

await test('all seven exact candidate dispatches must complete green on their returned run IDs', async () => {
  const {api, calls} = fixture(), report = await runRing3(prepare(candidate, 'sender'), {api});
  assert.equal(report.ok, true);
  assert.deepEqual(report.rows.map(row => row.repo), shardRepos);
  assert.equal(report.rows.every(row => row.shardSha === shard && row.status === 'success'), true);
  assert.equal(calls.filter(call => call.method === 'POST').length, 7 + preparedRepos.length, 'seven receivers and their exact-install preparations');
  assert.equal(calls.some(call => call.path.includes('/runs?')), false, 'Never substitutes another candidate run');
});
await test('one red receiver holds the aggregate and files only that shard issue', async () => {
  const {api, calls} = fixture({red: 'shard-dunes'}), report = await runRing3(prepare(candidate, 'sender'), {api});
  assert.equal(report.ok, false);
  assert.equal(report.rows.filter(row => row.status === 'success').length, 6);
  assert.equal(report.rows[0].issue, 'https://github.com/project-wildshard/shard-dunes/issues/1');
  assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/issues')).length, 1);
});
await test('a repeat red candidate reuses its existing issue', async () => {
  const {api, calls} = fixture({red: 'shard-dunes', existing: true}), report = await runRing3(prepare(candidate, 'sender'), {api});
  assert.equal(report.rows[0].issue, 'existing-issue');
  assert.equal(calls.filter(call => call.method === 'POST' && call.path.endsWith('/issues')).length, 0);
});
await test('a refused shard dispatch cannot prevent the other six receivers from running', async () => {
  const {api} = fixture({denied: 'shard-dunes'}), report = await runRing3(prepare(candidate, 'sender'), {api});
  assert.equal(report.ok, false);
  assert.equal(report.rows[0].status, 'error');
  assert.equal(report.rows.filter(row => row.status === 'success').length, 6);
});
await test('missing IDs and unrelated green runs can never qualify the candidate', async () => {
  for (const option of [{malformed: true}, {wrongRun: true}]) {
    const {api} = fixture(option), report = await runRing3(prepare(candidate, 'sender'), {api});
    assert.equal(report.ok, false);
    assert.equal(report.rows.every(row => row.status === 'error'), true);
  }
});
await test('queued receivers hit a bounded deadline and remain red with their run links', async () => {
  let now = 0;
  const {api} = fixture({pending: true}), report = await runRing3(prepare(candidate, 'sender'), {api, now: () => now, sleep: ms => {now += ms; return Promise.resolve();}, deadlineMs: 100, pollMs: 20});
  assert.equal(now, 100);
  assert.equal(report.ok, false);
  assert.equal(report.rows.every(row => row.status === 'timeout' && row.runUrl !== undefined), true);
});
await test('moving refs and shell text refuse before a dispatch can be prepared', () => {
  for (const ref of ['main', 'a'.repeat(39), '$(echo injected)', 'A'.repeat(40)]) assert.throws(() => prepare(ref, 'sender'), /full engine commit/u);
});

// QA-FEEDBACK-2026-11-23-b row 40 (J505): the receivers install the packed commit, which carries every generated file npm ships.
const packed = 'c'.repeat(40);
await test('the receivers install the packed commit; the verdict still names the candidate', async () => {
  const {api} = fixture({install: packed}), report = await runRing3(prepare(candidate, 'sender'), {api, packed});
  assert.equal(report.ok, true);
  assert.equal(report.engine, candidate);
  assert.equal(report.packed, packed);
  await assert.rejects(runRing3(prepare(candidate, 'sender'), {api, packed: 'main'}), /full packed commit/u);
});
await test('the guard names each generated file the npm archive has and the Ring 3 tree lacks', () => {
  const archive = ['package/package.json', 'package/src/a.ts', ...BOOT_STAMPS.map(path => `package/${path}`), 'package/node_modules/@wildshard/format/x.generated.js'];
  assert.deepEqual(missingGenerated(archive, new Set(['package.json', 'src/a.ts'])), [...BOOT_STAMPS], 'a raw Git archive lacks the boot stamps');
  assert.deepEqual(missingGenerated(archive, new Set(['src/a.ts', ...BOOT_STAMPS])), []);
  assert.deepEqual(untracked(archive, new Set(['package.json', 'src/a.ts'])), [...BOOT_STAMPS], 'the bundled format and package.json are not added');
});
await test('packCommit commits the ignored build outputs onto the candidate and passes the guard', () => {
  const root = process.cwd(), dir = mkdtempSync(join(root, 'tmp', 'ring3-pack-'));
  const sh = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {cwd: join(dir, 'repo'), encoding: 'utf8'}).trim();
  try {
    mkdirSync(join(dir, 'repo', 'src'), {recursive: true});
    writeFileSync(join(dir, 'repo', '.gitignore'), '*.generated.ts\n');
    writeFileSync(join(dir, 'repo', 'src', 'a.ts'), 'export {};\n');
    sh('init', '-q'); sh('add', '.'); sh('commit', '-qm', 'candidate');
    const engine = sh('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'repo', 'src', 'audio.generated.ts'), 'export {};\n');
    mkdirSync(join(dir, 'pkg', 'package', 'src'), {recursive: true});
    for (const file of ['src/a.ts', 'src/audio.generated.ts']) writeFileSync(join(dir, 'pkg', 'package', file), 'export {};\n');
    execFileSync('tar', ['-czf', join(dir, 'engine.tgz'), '-C', join(dir, 'pkg'), 'package']);
    process.chdir(join(dir, 'repo'));
    const commit = packCommit(engine, join(dir, 'engine.tgz'));
    assert.match(sh('ls-tree', '-r', '--name-only', commit), /src\/audio\.generated\.ts/u);
    assert.equal(sh('rev-parse', `${commit}^`), engine, 'one commit on top of the candidate');
  } finally { process.chdir(root); rmSync(dir, {recursive: true, force: true}); }
});
await test('a prepared receiver runs only after its exact-install ring-2-prepare is green (QA 11-23-b row 41)', async () => {
  const {api, calls} = fixture({install: packed, prepareRed: 'shard-open-plots'}), report = await runRing3(prepare(candidate, 'sender'), {api, packed});
  const order = calls.filter(call => call.method === 'POST' && call.path.includes('shard-sky-reach')).map(call => call.path.split('/').at(-2));
  assert.deepEqual(order, ['ring-2-prepare.yml', 'ci.yml'], 'the preparation first, then the receiver');
  const plots = report.rows.find(row => row.repo === 'shard-open-plots');
  assert.equal(plots?.status, 'failure');
  assert.equal(plots?.runId, undefined, 'a red preparation dispatches no receiver');
  assert.match(plots?.error ?? '', /ring-2-prepare/u);
  assert.equal(report.rows.filter(row => row.status === 'success').length, 6);
});
