/* oxlint-disable import/no-nodejs-modules -- A local receiver executes actual good and broken candidate bytes. */
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {checkShards} from '../src/scripts/shard-check.ts';
import {prepare, type Api} from '../src/scripts/ring3.ts';

const candidate = 'a'.repeat(40), baseline = 'b'.repeat(40), shard = 'c'.repeat(40);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function receiver(options: {broken?: boolean; moved?: boolean; pending?: boolean; reused?: boolean} = {}) {
  mkdirSync('tmp/codex-pins-ll6-tests', {recursive: true});
  const root = mkdtempSync(resolve('tmp/codex-pins-ll6-tests/receiver-')); roots.push(root);
  const dispatched = new Map<number, string>(), requests: string[] = [];
  const api: Api = (method, path, body) => {
    requests.push(`${method} ${path}`);
    if (path.includes('/issues')) throw new Error('A local check must never send an issue or comment');
    if (method === 'POST') {
      const input = body as {ref: string; inputs: {engine: string}; return_run_details: boolean};
      expect(input.ref).toBe('main'); expect(input.return_run_details).toBe(true);
      const id = options.reused === true ? 100 : dispatched.size + 100;
      dispatched.set(id, input.inputs.engine);
      return Promise.resolve({workflow_run_id: id});
    }
    const id = Number(path.split('/').at(-1)), engine = dispatched.get(id);
    const file = join(root, `${engine}.mjs`);
    writeFileSync(file, options.broken === true && engine === candidate ? 'throw new Error("planted candidate break");' : 'if (2 + 2 !== 4) throw new Error("baseline broke");');
    const result = spawnSync(process.execPath, [file]);
    return Promise.resolve({id, event: 'workflow_dispatch', path: '.github/workflows/ci.yml', head_sha: options.moved === true && engine === candidate ? 'd'.repeat(40) : shard,
      status: options.pending === true ? 'in_progress' : 'completed', conclusion: result.status === 0 ? 'success' : 'failure', run_attempt: 1});
  };
  return {api, requests, dispatched};
}

test('a real planted candidate break refuses with baseline green and names the shard and exact run URLs', async () => {
  const local = receiver({broken: true});
  const report = await checkShards(candidate, baseline, ['shard-dunes'], {api: local.api});
  expect(report.verdict).toBe('regression');
  expect(report.rows).toEqual([{repo: 'shard-dunes', verdict: 'regression', reason: expect.stringContaining('fix forward')}]);
  expect(report.baseline.rows[0]).toMatchObject({status: 'success', shardSha: shard, runId: 100});
  expect(report.candidate.rows[0]).toMatchObject({status: 'failure', shardSha: shard, runId: 101, runUrl: expect.stringContaining('/actions/runs/101')});
  expect(local.requests.some(path => path.includes('/issues'))).toBe(false);
});

test('all selected receivers passing qualifies the exact candidate', async () => {
  const local = receiver();
  const report = await checkShards(candidate, baseline, ['shard-dunes', 'shard-pine-hollow'], {api: local.api});
  expect(report.verdict).toBe('pass');
  expect(report.candidate.ok).toBe(true); expect(report.baseline.ok).toBe(true);
  expect(local.dispatched.size).toBe(4);
  expect(prepare(candidate, 'default').rows).toHaveLength(7);
});

test.each([{moved: true}, {reused: true}])('different shard heads and reused run IDs are inconclusive: %j', async options => {
  const local = receiver(options);
  expect((await checkShards(candidate, baseline, ['shard-dunes'], {api: local.api})).verdict).toBe('inconclusive');
});

test('a bounded timeout never qualifies an incomplete receiver', async () => {
  const local = receiver({pending: true}); let clock = 0;
  const report = await checkShards(candidate, baseline, ['shard-dunes'], {api: local.api, now: () => clock,
    sleep: ms => { clock += ms; return Promise.resolve(); }, deadlineMs: 100, pollMs: 100});
  expect(report.verdict).toBe('inconclusive');
  expect(report.candidate.ok).toBe(false);
  expect(clock).toBeLessThanOrEqual(200);
});

test('unknown and duplicate shards, same commits and an expanded deadline refuse before dispatch', async () => {
  const local = receiver();
  for (const repos of [[], ['shard-dunes', 'shard-dunes'], ['shard-imaginary']]) {
    await expect(checkShards(candidate, baseline, repos, {api: local.api})).rejects.toThrow('distinct known');
  }
  await expect(checkShards(candidate, candidate, ['shard-dunes'], {api: local.api})).rejects.toThrow('different exact');
  await expect(checkShards(candidate, baseline, ['shard-dunes'], {api: local.api, deadlineMs: 21 * 60_000})).rejects.toThrow('twenty minutes');
  expect(local.requests).toEqual([]);
});
