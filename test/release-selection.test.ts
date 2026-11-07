import { expect, test } from 'vitest';
import deployWorkflow from '../.github/workflows/deploy.yml?raw';
import { ciSourceRun, ciGreen, ciRunGreen, newestCiGreen, newestCiGreenAfterBoot, PendingBootSmokeError, productionFloor, releaseReady, workflowRunsPath } from '../scripts/deploy-pin.mjs';

const newer = 'a'.repeat(40), proven = 'b'.repeat(40), oldest = 'c'.repeat(40);
const completed = '2026-10-21T14:00:00Z', now = Date.parse('2026-10-21T14:01:00Z');
const success = `boot-smoke\tsuccess\tExact built dist passed\t${completed}`;
const pending = `boot-smoke\tpending\tExact proof running\t${completed}`;
const workflows = '.github/workflows/deploy.yml\t123\n.github/workflows/boot-smoke.yml\t456';

test('the live floor permits only an identical or descendant automatic release', () => {
  for (const candidate of [newer, proven]) {
    const status = candidate === proven ? 'identical' : 'ahead';
    const query = (args: string[]): string => {
      expect(args[0]).toBe(`repos/project-wildshard/engine/compare/${proven.slice(0, 9)}~0...${candidate}`);
      expect(args.slice(1)).toEqual(['--jq', '{status,base_commit:{sha:.base_commit.sha}}']);
      return JSON.stringify({ status, base_commit: { sha: proven } });
    };
    expect(productionFloor(`${proven.slice(0, 9)}-build`, candidate, query)).toBe(proven);
  }
  for (const status of ['behind', 'diverged', undefined]) {
    expect(() => productionFloor(`${proven.slice(0, 9)}-build`, oldest,
      () => JSON.stringify({ status, base_commit: { sha: proven } }))).toThrow('does not advance production');
  }
});

test('the live prefix resolves as a commit despite a colliding tree, without guessing between commits', () => {
  const live = '0fefa8bf2d1243b5f2dbc29af0f6f37caf6b54e8';
  const tree = '0fefa8b06bf66f81a99e6b770d4b805e7d2e38b3', paths: string[] = [];
  const query = (args: string[]): string => {
    const path = args[0] ?? ''; paths.push(path);
    if (path.includes('/compare/0fefa8b...')) throw new Error('GitHub HTTP 404: ambiguous object');
    expect(path).toBe(`repos/project-wildshard/engine/compare/0fefa8b~0...${newer}`);
    return JSON.stringify({ status: 'ahead', base_commit: { sha: live } });
  };
  expect(productionFloor('0fefa8b-live', newer, query)).toBe(live);
  expect(paths).toHaveLength(1);
  expect(() => productionFloor('0fefa8b-live', newer, () => { throw new Error('GitHub HTTP 404: ambiguous commit'); }))
    .toThrow('ambiguous commit');
  expect(() => productionFloor('0fefa8b-live', newer, () => JSON.stringify({ status: 'ahead', base_commit: { sha: tree.slice(0, 9) } })))
    .toThrow('Unreadable production floor');
});

test('automatic releases check the live floor immediately before stripping and uploading', () => {
  const workflow = deployWorkflow;
  const deploy = workflow.slice(workflow.indexOf('- name: Deploy prebuilt output'), workflow.indexOf('- name: Verify production'));
  expect(deploy).toMatch(/DEPLOY_MODE:\s*\$\{\{ steps\.pin\.outputs\.mode \}\}/u);
  expect(deploy).toContain('if [ "$DEPLOY_MODE" != pinned ]; then node "$RUNNER_TEMP/deploy-pin.mjs" check-live-floor "$DEPLOY_SHA"; fi');
  expect(deploy.indexOf('check-live-floor')).toBeLessThan(deploy.indexOf('deploy-source-maps.mjs'));
  expect(deploy.indexOf('check-live-floor')).toBeLessThan(deploy.indexOf('url=$(vercel deploy'));
});

test('missing, foreign or unavailable live ancestry cannot authorize a release', () => {
  for (const base of [undefined, { sha: oldest }, { sha: proven.slice(0, 8) }]) {
    expect(() => productionFloor(`${proven.slice(0, 9)}-build`, newer,
      () => JSON.stringify({ status: 'ahead', base_commit: base }))).toThrow('Unreadable production floor');
  }
  expect(() => productionFloor('unreadable', newer, () => { throw new Error('must not query'); })).toThrow('Invalid production floor');
  expect(() => productionFloor(`${proven.slice(0, 9)}-build`, newer, () => { throw new Error('GitHub unavailable'); })).toThrow('GitHub unavailable');
});

function queryFor(candidates: readonly string[], proofs: Readonly<Record<string, string>>): (args: string[]) => string {
  return args => {
    const path = args[0] ?? '';
    if (path.endsWith('/actions/workflows?per_page=100&page=1')) return workflows;
    if (path.includes('/actions/workflows/123/runs?branch=main&event=push&status=success')) {
      return candidates.map(sha => `${sha}\t${completed}`).join('\n');
    }
    const sha = /\/commits\/([a-f0-9]{40})\/status$/u.exec(path)?.[1];
    if (sha === undefined || !Object.hasOwn(proofs, sha)) throw new Error(`Unexpected proof request: ${path}`);
    return proofs[sha] ?? '';
  };
}

test('a newer pending smoke cannot block a just-proven release', async () => {
  const query = queryFor([newer, proven, oldest], { [newer]: pending, [proven]: success, [oldest]: success });
  expect(newestCiGreen(query, () => undefined, now)).toBe(proven);
  expect(releaseReady(query, () => undefined, now)).toEqual({ ready: true, sha: proven });
  await expect(newestCiGreenAfterBoot(query, () => undefined, {
    now: () => now,
    wait: () => Promise.reject(new Error('A proven release must not wait')),
  })).resolves.toBe(proven);
});

test('a fresh CI success without a smoke status cannot block an older exact proof', () => {
  const query = queryFor([newer, proven], { [newer]: '', [proven]: success });
  expect(releaseReady(query, () => undefined, now)).toEqual({ ready: true, sha: proven });
});

test('continuous newer pending candidates never reset eligibility', () => {
  for (const candidates of [[newer, proven], [newer, oldest, proven], [oldest, newer, proven]]) {
    const query = queryFor(candidates, { [newer]: pending, [oldest]: pending, [proven]: success });
    expect(newestCiGreen(query, () => undefined, now)).toBe(proven);
  }
});

test('the newest fully proven candidate wins over older proven commits', () => {
  expect(newestCiGreen(queryFor([newer, proven], { [newer]: success, [proven]: success }), () => undefined, now)).toBe(newer);
});

test('a newer exact-SHA failure overrides its previous success', () => {
  const failed = `boot-smoke\tfailure\tLatest failed\t${completed}\n${success}`;
  expect(newestCiGreen(queryFor([newer, proven], { [newer]: failed, [proven]: success }), () => undefined, now)).toBe(proven);
});

test('pending smoke still defers when no exact proven candidate exists', () => {
  const query = queryFor([newer], { [newer]: pending });
  expect(() => newestCiGreen(query, () => undefined, now)).toThrow(PendingBootSmokeError);
  expect(releaseReady(query, () => undefined, now)).toEqual({ ready: false, sha: newer });
});

test('a release with no proof waits only within its existing bound', async () => {
  let clock = now;
  const query = queryFor([newer], { [newer]: pending });
  await expect(newestCiGreenAfterBoot(query, () => undefined, {
    now: () => clock, maxWaitMs: 30,
    wait: ms => { clock += ms; return Promise.resolve(); },
  })).rejects.toThrow('exact-SHA boot-smoke still unresolved');
});

test('terminal failures and unreadable proof queries never supply a release', () => {
  const query = queryFor([newer], { [newer]: `boot-smoke\tfailure\tFailed\t${completed}` });
  expect(() => releaseReady(query, () => undefined, now)).toThrow('no successful push CI');
  expect(() => releaseReady(() => { throw new Error('GitHub unavailable'); }, () => undefined, now)).toThrow('GitHub unavailable');
});



test('resolves both workflow paths once and selects numeric runs with exact proofs', () => {
  const inventory = { workflows: [
    { path: '.github/workflows/unrelated.yml', id: 777 },
    { path: '.github/workflows/deploy.yml', id: 901 },
    { path: '.github/workflows/boot-smoke.yml', id: 902 },
  ] };
  const runs = { workflow_runs: [{ head_sha: proven, updated_at: completed }] };
  const requests: string[] = [];
  const query = (args: string[]): string => {
    const path = args[0] ?? '';
    requests.push(path);
    if (path.endsWith('/actions/workflows?per_page=100&page=1')) {
      expect(args).toContain('--paginate');
      return inventory.workflows.map(row => `${row.path}\t${row.id}`).join('\n');
    }
    if (path.includes('/actions/workflows/deploy.yml/runs')) return '';
    if (path.endsWith('/actions/workflows/901/runs?branch=main&event=push&status=success&per_page=100&page=1')) {
      return runs.workflow_runs.map(row => `${row.head_sha}\t${row.updated_at}`).join('\n');
    }
    if (path.endsWith(`/actions/workflows/901/runs?branch=main&event=push&status=success&head_sha=${proven}&per_page=1&page=1`)) return proven;
    if (path.endsWith(`/commits/${proven}/status`)) return success;
    throw new Error(`Unexpected API request: ${path}`);
  };
  expect(releaseReady(query, () => undefined, now)).toEqual({ ready: true, sha: proven });
  expect(ciGreen(proven, query)).toBe(true);
  expect(workflowRunsPath('boot-smoke.yml', query)).toMatch(/\/902\/runs$/u);
  expect(requests.filter(path => path.endsWith('/actions/workflows?per_page=100&page=1'))).toHaveLength(1);
});

test('missing or ambiguous workflow identities refuse release selection', () => {
  expect(() => releaseReady(() => '.github/workflows/boot-smoke.yml\t456', () => undefined, now)).toThrow('Missing workflow: deploy.yml');
  expect(() => releaseReady(() => `${workflows}\n.github/workflows/deploy.yml\t789`, () => undefined, now)).toThrow('Invalid workflow identity');
});

const explicitRun = {
  id: 789, workflow_id: 123, event: 'push', head_branch: 'main', head_sha: proven,
  path: '.github/workflows/deploy.yml', status: 'in_progress', conclusion: null,
  head_repository: { full_name: 'project-wildshard/engine' },
};
const completeJobs = ['products', 'build-and-deploy',
  ...Array.from({ length: 4 }, (_, i) => `typecheck-lint (${i + 1})`),
  ...Array.from({ length: 10 }, (_, i) => `behaviour (${i + 1})`)]
  .map(name => `${name}\tcompleted\tsuccess`);

function explicitQuery(run: object, jobs: readonly string[]): (args: string[]) => string {
  return args => {
    const path = args[0] ?? '';
    if (path.endsWith('/actions/workflows?per_page=100&page=1')) return workflows;
    if (path.endsWith('/actions/runs/789')) return JSON.stringify(run);
    if (path.endsWith('/actions/runs/789/jobs?per_page=100')) {
      expect(args).toContain('--paginate');
      return jobs.join('\n');
    }
    throw new Error(`Unexpected explicit proof request: ${path}`);
  };
}

test('an explicit stuck aggregate requires every one of the 16 exact-run jobs to succeed', () => {
  expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, completeJobs))).toBe(true);
  for (const state of ['failure', 'cancelled', 'skipped', 'timed_out']) {
    const jobs = completeJobs.map(row => row.startsWith('products\t') ? `products\tcompleted\t${state}` : row);
    expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, jobs))).toBe(false);
  }
  expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, completeJobs.slice(1)))).toBe(false);
  expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, [...completeJobs, 'extra\tcompleted\tsuccess']))).toBe(false);
  expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, [...completeJobs.slice(1), 'products\tin_progress\t']))).toBe(false);
  expect(ciRunGreen(proven, '789', explicitQuery(explicitRun, [...completeJobs.slice(1), 'behaviour (1)\tcompleted\tsuccess']))).toBe(false);
});

test('explicit job success cannot substitute a neighbour, fork, PR or different workflow', () => {
  for (const delta of [
    { id: 111 }, { head_sha: newer }, { workflow_id: 456 }, { path: '.github/workflows/boot-smoke.yml' },
    { event: 'pull_request' }, { head_branch: 'feature' }, { head_repository: { full_name: 'other/fork' } },
    { status: 'completed', conclusion: 'failure' }, { status: 'queued' },
  ]) {
    expect(ciRunGreen(proven, '789', explicitQuery({ ...explicitRun, ...delta }, completeJobs))).toBe(false);
  }
  expect(() => ciRunGreen('short', '789', explicitQuery(explicitRun, completeJobs))).toThrow('exact SHA');
  expect(() => ciRunGreen(proven, 'not-a-run', explicitQuery(explicitRun, completeJobs))).toThrow('numeric run');
});


test('prebuilt release binds only a successful exact main push producer', () => {
  const row = {id:12345,head_sha:proven,event:'push',head_branch:'main',status:'completed',conclusion:'success',
    path:'.github/workflows/deploy.yml',head_repository:{full_name:'project-wildshard/engine'}};
  const producerQuery = (value: object) => (args: string[]): string => args[0]?.includes('/actions/workflows?')
    ? workflows : JSON.stringify({workflow_runs:[value]});
  expect(ciSourceRun(proven, producerQuery(row))).toBe('12345');
  for (const bad of [{...row,head_sha:newer},{...row,event:'workflow_dispatch'}, {...row,status:'in_progress'},
    {...row,conclusion:'failure'},{...row,head_repository:{full_name:'foreign/repository'}}]) {
    expect(() => ciSourceRun(proven, producerQuery(bad))).toThrow('No exact successful prebuilt producer');
  }
});
