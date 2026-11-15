// Standalone integration checks of the sender against a controlled GitHub API.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepare, runRing3, shardRepos, type Api} from './ring3.ts';

const candidate = 'a'.repeat(40), shard = 'b'.repeat(40);
interface Call {method: string; path: string; body?: unknown}
function fixture(options: {red?: string; malformed?: boolean; pending?: boolean; wrongRun?: boolean; denied?: string; existing?: boolean} = {}): {api: Api; calls: Call[]} {
  const calls: Call[] = [];
  const api: Api = async (method, path, body) => {
    calls.push({method, path, body});
    const repo = path.split('/')[2];
    if (repo === undefined || !shardRepos.includes(repo as typeof shardRepos[number])) throw new Error(`Unexpected repository: ${path}`);
    const id = shardRepos.indexOf(repo as typeof shardRepos[number]) + 100;
    if (method === 'POST' && path.endsWith('/dispatches')) {
      if (repo === options.denied) throw new Error('HTTP 403');
      assert.deepEqual(body, {ref: 'main', inputs: {engine: candidate}, return_run_details: true});
      return options.malformed ? {} : {workflow_run_id: id};
    }
    if (method === 'GET' && path.endsWith(`/actions/runs/${id}`)) return {id: options.wrongRun ? id + 1 : id, event: 'workflow_dispatch', path: '.github/workflows/ci.yml', head_sha: shard, run_attempt: 1,
      status: options.pending ? 'queued' : 'completed', conclusion: repo === options.red ? 'failure' : 'success'};
    if (method === 'GET' && path.includes('/issues?')) return options.existing ? [{title: `[Ring 3] engine ${candidate}`, html_url: 'existing-issue'}] : [];
    if (method === 'POST' && path.endsWith('/issues')) return {html_url: `https://github.com/project-wildshard/${repo}/issues/1`};
    throw new Error(`Unexpected API call: ${method} ${path}`);
  };
  return {api, calls};
}

await test('all seven exact candidate dispatches must complete green on their returned run IDs', async () => {
  const {api, calls} = fixture(), report = await runRing3(prepare(candidate, 'sender'), {api});
  assert.equal(report.ok, true);
  assert.deepEqual(report.rows.map(row => row.repo), shardRepos);
  assert.equal(report.rows.every(row => row.shardSha === shard && row.status === 'success'), true);
  assert.equal(calls.filter(call => call.method === 'POST').length, 7);
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
  const {api} = fixture({pending: true}), report = await runRing3(prepare(candidate, 'sender'), {api, now: () => now, sleep: async ms => {now += ms;}, deadlineMs: 100, pollMs: 20});
  assert.equal(now, 100);
  assert.equal(report.ok, false);
  assert.equal(report.rows.every(row => row.status === 'timeout' && row.runUrl !== undefined), true);
});
await test('moving refs and shell text refuse before a dispatch can be prepared', () => {
  for (const ref of ['main', 'a'.repeat(39), '$(echo injected)', 'A'.repeat(40)]) assert.throws(() => prepare(ref, 'sender'), /full engine commit/u);
});
