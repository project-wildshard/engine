// oxlint-disable-next-line import/no-nodejs-modules -- Parse the actual native bootstrap without browser or network.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Evaluate only the actual workflow's concurrency-key expressions.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise only owned archive staging across a simulated checkout cleanup.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the controller copy and isolated runner directories.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { watchPhoneEntry } from '../scripts/parity/phone-route-page.mjs';
import { phoneBootstrap } from '../scripts/parity/phone-route-browser.mjs';
import { completeReadySource, deadlineRecoverySource, readySource, recoverySource, stageReadyArchive, waveSource } from '../scripts/deploy-pin.mjs';
import deploy from '../.github/workflows/deploy.yml?raw';

const stagedController=readFileSync(process.env['STAGED_HELPER'] ?? 'scripts/staged-deployment.py','utf8');

const sha = 'a'.repeat(40);
const jobs = ['prepare','typecheck-lint','behaviour','native-escape','journeys','boot-verdict'];
const needs = Object.fromEntries(jobs.map(name => [name,{result:'success'}]));
const current = {mode:'newest-ci-green',event:'push',ref:'refs/heads/main',repository:'project-wildshard/engine',
  sha,run:'123',head:sha,needs};

test('the current main wave ships its own exact producer without waiting for its ship aggregate', () => {
  expect(waveSource(current)).toEqual({skip:false,sha,run:'123'});
  for (const name of jobs) for (const result of ['failure','cancelled','skipped','in_progress'])
    expect(() => waveSource({...current,needs:{...needs,[name]:{result}}})).toThrow('Wave prerequisite');
  const {prepare:_prepare,...missing}=needs;
  expect(() => waveSource({...current,needs:missing})).toThrow('inventory');
  expect(() => waveSource({...current,needs:{...needs,foreign:{result:'success'}}})).toThrow('inventory');
  for (const invalid of [null,[],true]) expect(() => waveSource({...current,needs:invalid})).toThrow('verdicts');
});

test('merged shipping requires every underlying gate and its actual successful boot publisher step', () => {
  const { 'boot-verdict': _boot, ...gates } = needs;
  expect(waveSource({ ...current, needs: gates, bootOutcome: 'success' })).toEqual({ skip: false, sha, run: '123' });
  expect(() => waveSource({ ...current, needs: gates })).toThrow('inventory');
  expect(() => waveSource({ ...current, bootOutcome: 'success' })).toThrow('inventory');
  for (const bootOutcome of ['', 'failure', 'cancelled', 'skipped', 'in_progress'])
    expect(() => waveSource({ ...current, needs: gates, bootOutcome })).toThrow('boot publisher');
  for (const name of Object.keys(gates)) for (const result of ['failure', 'cancelled', 'skipped', 'in_progress'])
    expect(() => waveSource({ ...current, needs: { ...gates, [name]: { result } }, bootOutcome: 'success' })).toThrow('Wave prerequisite');
});

test('the actual merged job keeps red status publication outside the production lock and gates every deployment step', () => {
  const ship = deploy.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
  if (ship === undefined) throw new Error('Missing merged release');
  const group = /^ {6}group: \$\{\{ (.+) \}\}$/mu.exec(ship)?.[1];
  const release = /^ {6}RELEASE_ALLOWED: \$\{\{ (.+) \}\}$/mu.exec(ship)?.[1];
  if (group === undefined || release === undefined) throw new Error('Missing actual release policy');
  const { 'boot-verdict': _boot, ...gates } = needs;
  const evaluate = (expression: string, event: string, id: string, verdicts: typeof gates,
    cancelled = false, successful = true, allowed = true): unknown =>
    // GitHub permits hyphens in property names; JavaScript needs brackets.
    runInNewContext(expression.replaceAll(/needs\.([a-z][a-z0-9-]*)\.result/gu,
      (_match: string, name: string) => `needs[${JSON.stringify(name)}].result`),
    { github: { event_name: event, run_id: id }, needs: verdicts,
      env: { RELEASE_ALLOWED: allowed ? 'true' : 'false' }, success: () => successful,
      cancelled: () => cancelled, format: (pattern: string, value: string) => pattern.replace('{0}', value) });
  for (const event of ['push', 'workflow_dispatch']) {
    expect(evaluate(group, event, '123', gates)).toBe('production-release');
    expect(evaluate(release, event, '123', gates)).toBe(true);
  }
  for (const name of Object.keys(gates)) for (const result of ['failure', 'cancelled', 'skipped', 'pending']) {
    const failed = { ...gates, [name]: { result } };
    expect(evaluate(group, 'push', '123', failed)).toBe('boot-verdict-123');
    expect(evaluate(group, 'push', '124', failed)).toBe('boot-verdict-124');
    expect(evaluate(release, 'push', '123', failed)).toBe(false);
    expect(evaluate(group, 'workflow_dispatch', '123', failed)).toBe('production-release');
  }
  expect(evaluate(group, 'pull_request', '123', gates)).toBe('boot-verdict-123');
  expect(evaluate(release, 'pull_request', '123', gates)).toBe(false);
  expect(ship).toContain('if: ${{ always()');
  const steps = ship.split('\n      - ').slice(1);
  expect(steps[0]).toContain('name: Publish exact-SHA proof outcome');
  expect(steps[0]).toContain("if: always() && github.event_name == 'push'");
  expect(steps[1]).toContain('continue-on-error: true');
  for (const step of steps.slice(2)) {
    expect(step).toContain("env.RELEASE_ALLOWED == 'true'");
    const condition = /^ {8}if: \$\{\{ (.+) \}\}$/mu.exec(step)?.[1];
    if (condition === undefined) throw new Error('Missing actual step condition');
    expect(condition).toContain('!cancelled()');
    if (condition.includes('always()') || condition.includes('failure()')) continue;
    expect(condition).toContain('success()');
    // An explicit status function disables Actions' implicit success() check.
    // These actual conditions must still stop after publisher/pin failure.
    expect(evaluate(condition, 'push', '123', gates, false, false)).toBe(false);
    expect(evaluate(condition, 'push', '123', gates, true)).toBe(false);
    expect(evaluate(condition, 'push', '123', gates, false, true, false)).toBe(false);
  }
});

test('the merged first step publishes the original exact-SHA SIX verdict before any checkout or release work', () => {
  const first = deploy.split('\n  build-and-deploy:\n')[1]?.split('\n      - ')[1];
  const shell = /^ {8}run: \|\n((?: {10}[^\n]*\n)+)/mu.exec(first ?? '')?.[1];
  const body = shell?.split('\n').map(line => line.slice(10)).join('\n');
  if (body === undefined) throw new Error('Missing actual boot publisher');
  for (const build of ['success', 'failure', 'cancelled', 'skipped']) for (const legs of ['success', 'failure', 'cancelled', 'skipped']) {
    const result = spawnSync('bash', ['-e', '-c', `gh() { printf '%s\\n' "$@"; };\n${body}`], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, BUILD: build, LEGS: legs, TESTED_SHA: sha,
        GITHUB_REPOSITORY: 'project-wildshard/engine', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '123' },
    });
    expect(result.status, result.stderr).toBe(0);
    const state = build === 'success' && legs === 'success' ? 'success'
      : build === 'cancelled' || legs === 'cancelled' ? 'error' : 'failure';
    expect(result.stdout).toContain(`state=${state}\n`);
    expect(result.stdout).toContain(`repos/project-wildshard/engine/statuses/${sha}\n`);
    expect(result.stdout).toContain('target_url=https://github.com/project-wildshard/engine/actions/runs/123\n');
  }
});

test('foreign, stale, pull-request and malformed producer identities cannot deploy', () => {
  for (const change of [{event:'pull_request'},{ref:'refs/heads/other'},{repository:'foreign/repo'},
    {sha:'short'},{head:'b'.repeat(40)},{run:'foreign'},{run:'0'}])
    expect(() => waveSource({...current,...change})).toThrow('exact main push');
  for (const mode of ['pinned','newest-green']) expect(waveSource({...current,mode}).skip).toBe(true);
});

test('one push wave keeps all six browser guards and serialized exact-artifact shipping', () => {
  const ship=deploy.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
  const journeys=deploy.split('\n  journeys:\n')[1]?.split('\n  boot-verdict:\n')[0];
  if(ship===undefined||journeys===undefined)throw new Error('Missing push-wave proof or ship');
  expect(ship).toContain('needs: [prepare, typecheck-lint, behaviour, native-escape, journeys, stage-prebuilt]');
  expect(deploy).not.toContain('\n  boot-verdict:\n');
  expect(ship).toContain('MERGED_BOOT_PROOF:');
  expect(ship).toContain(`CI_WAVE_BOOT_OUTCOME: \${{ steps.boot.outcome }}`);
  expect(ship).toContain("needs.native-escape.result == 'success'");
  expect(ship).toContain('CI_WAVE_NEEDS:');expect(ship).toContain('read-wave');
  expect(ship).toContain("'production-release'");expect(ship).toContain('check-live-floor');
  expect(ship).toContain('vercel deploy --prebuilt');
  const restore=ship.split('- name: Restore the exact successful push artifact')[1]?.split('# Explicit recovery')[0];
  const recovery=ship.split('- name: Build proven recovery source')[1]?.split('# Hidden maps')[0];
  if(restore===undefined||recovery===undefined)throw new Error('Missing shipping branches');
  expect(restore).toContain("steps.pin.outputs.recovery != 'true'");
  expect(restore).not.toContain('vercel build');
  expect(recovery).toContain("steps.pin.outputs.recovery == 'true'");
  expect(recovery).toContain('vercel build --prod');
  expect(recovery).toContain('check-live-floor');
  expect(recovery).toContain(`VERCEL_GIT_COMMIT_SHA: \${{ steps.pin.outputs.sha }}`);
  expect(ship).toContain('run: pnpm install --frozen-lockfile');
  expect(ship).toContain('read-recovery "$RECOVERY_SOURCE_RUN"');
  expect(ship).toContain(`production-source-maps-\${{ steps.pin.outputs.sha }}`);
  expect(deploy).not.toContain('dispatch-boot-smoke:');expect(deploy).not.toContain('gh workflow run boot-smoke');
  expect(journeys).toContain('needs: prepare');expect(journeys).toContain('fail-fast: false');
  expect(journeys).toContain('max-parallel: 4');
  const parts=/part: \[([^\]]+)\]/u.exec(journeys)?.[1]?.split(',').map(part=>part.trim());
  const core=['explorer','boot-public','developer-webkit','grid-chromium'];
  expect(parts).toHaveLength(core.length);expect(new Set(parts)).toEqual(new Set(core));
  expect(journeys).not.toContain('run watch');expect(journeys).not.toContain('vercel build');
});

test('a verdict names every commit since the last finished run',()=>{
  const ship=deploy.split('\n  build-and-deploy:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0]??'';
  expect(ship).toContain('- name: Name the commits this verdict covers');
  expect(ship).toContain(String.raw`.conclusion != \"cancelled\" and .id != $GITHUB_RUN_ID`);
  expect(ship).toContain('compare/$previous...$GITHUB_SHA');
  expect(ship).toContain('::error title=Red run covers $range::');
});

test('pushes keep one run plus the newest pending while releases keep their key',()=>{
  const top=deploy.split('\njobs:\n')[0]??'';
  const section=(name:string)=>deploy.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0]??'';
  const group=(source:string,github:{event_name:string;run_id:string;sha:string;ref:string})=>{
    const template=/^\s+group: (.+)$/mu.exec(source)?.[1];
    if(template===undefined)throw new Error('Missing real concurrency key');
    return template.replaceAll(/\$\{\{(.*?)\}\}/gu,(_match:string,expression:string)=>{
      const value:unknown=runInNewContext(expression,{github,format:(pattern:string,argument:string)=>pattern.replace('{0}',argument)});
      if(typeof value!=='string')throw new Error('Invalid concurrency key expression');
      return value;
    });
  };
  const old={event_name:'push',run_id:'1',sha:'a'.repeat(40),ref:'refs/heads/main'};
  const next={...old,run_id:'2',sha:'b'.repeat(40)};
  expect(group(top,old)).toBe(group(top,next));
  expect(group(top,old)).not.toBe(group(top,{...next,ref:'refs/heads/other'}));
  expect(top).toContain(String.raw`cancel-in-progress: $\{{ github.event_name == 'pull_request' }}`.replace('\\',''));
  const pull={...old,event_name:'pull_request'};
  expect(group(top,pull)).not.toBe(group(top,{...pull,sha:next.sha}));
  expect(group(top,pull)).not.toBe(group(top,old));
  expect(section('prepare')).not.toContain('concurrency:');
  const manual={...old,event_name:'workflow_dispatch'};
  expect(group(top,manual)).toBe(group(top,{...manual,run_id:'2'}));
  expect(group(top,manual)).not.toBe(group(top,old));
  expect(section('build-and-deploy')).toContain("'production-release'");
  expect(section('build-and-deploy')).toContain('cancel-in-progress: false');
  expect(deploy).not.toContain('\n  phone-route:\n');
  expect(deploy).toContain("PHONE_PROOF: 'retired-g989'");
  for(const name of ['behaviour','native-escape','journeys'])expect(section(name)).not.toContain('concurrency:');
});

function recoveryFixture(native=false,splitPhone=false,shards=12) {
  const repo='project-wildshard/engine',runId='123';
  const run={id:123,run_attempt:1,workflow_id:456,event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'failure',
    path:'.github/workflows/deploy.yml',head_repository:{full_name:repo}};
  const rows=['prepare','typecheck-lint','boot-verdict',
    ...Array.from({length:shards},(_,i)=>`behaviour (${i+1})`),
    ...['boot-public','boot-developer','boot-grid','hover-chromium','hover-webkit','explorer'].map(name=>`journeys (${name})`),
    ...(native?['native-escape']:[])].map(name=>[name,'completed','success']);
  rows.push(['build-and-deploy','completed','failure'],[splitPhone?'phone-route':'journeys (phone-route)','completed','failure']);
  const ancestry={base_commit:{sha},status:'ahead'};
  const topology = `
  prepare:
    steps:
      - run: node scripts/vitest-plan.ts --shards ${shards} --workers 2
  behaviour:
    strategy:
      matrix:
        shard: [${Array.from({length:shards},(_,i)=>i+1).join(', ')}]
    steps:
      - run: pnpm exec vitest run --config scripts/vitest-ci.config.ts --shard=\${{ matrix.shard }}/${shards} --bail=0
`;
  const fixture={run,rows,ancestry,source:`${topology}${splitPhone?'\n  phone-route:\n    continue-on-error: true\n':`continue-on-error: \${{ matrix.part == 'phone-route' }}`}${native?'\n  native-escape:\n':''}`,
    green:[] as typeof run[],
    boot:`success\thttps://github.com/${repo}/actions/runs/${runId}`,
    query:(args:string[]):string=>{
      const path=args[0]??'';
      if(path.endsWith('/actions/runs/123'))return JSON.stringify(fixture.run);
      if(path.includes('/actions/workflows?'))return '.github/workflows/deploy.yml\t456';
      if(path.includes('/actions/workflows/456/runs?'))return JSON.stringify({workflow_runs:fixture.green});
      if(path.includes('/compare/'))return JSON.stringify(fixture.ancestry);
      if(path.includes('/contents/'))return fixture.source;
      if(path.includes('/jobs?'))return fixture.rows.map(row=>row.join('\t')).join('\n');
      if(path.endsWith('/status'))return fixture.boot;
      throw new Error(`Unexpected recovery query: ${path}`);
    }};
  return fixture;
}

test('explicit recovery accepts original complete source proofs on both sides of native-job separation',()=>{
  for(const native of [false,true]) for(const splitPhone of [false,true]) {
    const f=recoveryFixture(native,splitPhone);
    expect(recoverySource('123',f.query)).toEqual({sha,run:'123'});
    for(const name of f.rows.map(row=>row[0]).filter(gateName=>!['build-and-deploy','journeys (phone-route)','phone-route'].includes(gateName??'')))
      for(const state of ['failure','skipped','cancelled','in_progress']) {
        const broken=recoveryFixture(native,splitPhone),row=broken.rows.find(candidate=>candidate[0]===name);
        if(row===undefined)throw new Error('Missing source gate');
        row[2]=state;
        expect(()=>recoverySource('123',broken.query)).toThrow('source gate');
      }
  }
});

test('recovery keeps historical twelve and current twenty-four source jobs exhaustive',()=>{
  for(const count of [12,24]) {
    const f=recoveryFixture(true,true,count);
    expect(recoverySource('123',f.query)).toEqual({sha,run:'123'});
    f.rows=f.rows.filter(row=>row[0]!==`behaviour (${count})`);
    expect(()=>recoverySource('123',f.query)).toThrow();
  }
  for(const mutate of [
    (f:ReturnType<typeof recoveryFixture>)=>{f.source=f.source.replace('--shards 24','--shards 12');},
    (f:ReturnType<typeof recoveryFixture>)=>{f.source=f.source.replace('/24 --bail=0','/12 --bail=0');},
    (f:ReturnType<typeof recoveryFixture>)=>{f.source=f.source.replace('shard: [1, 2,','shard: [1, 1,');},
  ]) {
    const f=recoveryFixture(true,true,24);mutate(f);
    expect(()=>recoverySource('123',f.query)).toThrow('topology');
  }
  expect(()=>recoverySource('123',recoveryFixture(true,true,1).query)).toThrow('topology');
});

function splitNativeRecoveryFixture(groups: readonly string[] = ['escape-titan', 'stories-qara']) {
  const fixture=recoveryFixture(true,true,24);
  fixture.source=fixture.source.replace('\n  native-escape:\n',
    `\n  native-escape:\n    strategy:\n      matrix:\n        group: [${groups.join(', ')}]\n`);
  fixture.rows=fixture.rows.filter(row=>row[0]!=='native-escape');
  fixture.rows.push(...groups.map(group=>[`native-escape (${group})`,'completed','success']));
  return fixture;
}

const readyNow=Date.parse('2026-10-30T22:00:00Z'),liveBuild=`${'b'.repeat(7)}-live`;
interface ReadyJob {
  name: string; status: string; conclusion: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
  run_id?: number; run_attempt?: number; head_sha?: string;
  steps?: PublisherStep[];
}
function readyFixture(runId='123') {
  const base=splitNativeRecoveryFixture();
  const state={
    run:{...base.run,id:Number(runId),status:'in_progress',conclusion:null as string|null},
    details:base.rows.map(([name='',status='',conclusion='']):ReadyJob=>({name,status,conclusion:conclusion as string|null,
      created_at:new Date(readyNow-30*60*1000).toISOString(),started_at:null,completed_at:null})),
    source:base.source,boot:`success\thttps://github.com/project-wildshard/engine/actions/runs/${runId}`,
    liveSha:'b'.repeat(40),floorStatus:'ahead',released:false,
    runs:[{id:Number(runId),status:'in_progress'}],
    query:(args:string[]):string=>{
      const path=args[0]??'';
      if(path.endsWith(`/actions/runs/${runId}`))return JSON.stringify(state.run);
      if(path.includes('/actions/workflows/456/runs?'))return JSON.stringify({workflow_runs:state.runs});
      if(path.includes(`/runs/${runId}/jobs?`) || path.includes(`/runs/${runId}/attempts/1/jobs?`))return JSON.stringify(state.details);
      if(path.includes('/contents/'))return state.source;
      if(path.endsWith('/status'))return args.includes('[.statuses[] | select(.context == "production-live")][0].state // ""')
        ?state.released?'success':'':state.boot;
      if(path.includes('/compare/bbbbbbb~0...'))return JSON.stringify({status:state.floorStatus,base_commit:{sha:state.liveSha}});
      if(path.includes(`/compare/${state.run.head_sha}...main`))return JSON.stringify({status:'ahead',base_commit:{sha:state.run.head_sha}});
      return base.query(args);
    },
  };
  const ship=state.details.find(job=>job.name==='build-and-deploy');
  if(ship===undefined)throw new Error('Missing shipping fixture');
  ship.status='queued';ship.conclusion=null;
  return {state,ship};
}

interface PublisherStep { name: string; status: string; conclusion: string | null; number: number }
function mergedReadyFixture() {
  const base = readyFixture();
  const details = base.state.details.filter(row => row.name !== 'boot-verdict').map(row => {
    const steps: PublisherStep[] = [];
    return { name: row.name, status: row.status, conclusion: row.conclusion,
      created_at: row.created_at, started_at: row.started_at,
      run_id: 123, run_attempt: 1, head_sha: sha, steps,
      completed_at: row.name === 'build-and-deploy' ? null : '2026-10-30T21:29:00Z' };
  });
  base.state.details = details;
  base.state.boot = '';
  const publication = { description: 'Real built-dist title and gameplay proof', created_at: '2026-10-30T21:31:00Z' };
  const query = base.state.query;
  base.state.query = args => {
    if (args[0]?.endsWith('/status') && args.some(arg => arg.includes('{state,target_url,description,created_at}'))) {
      if (base.state.boot === '') return 'null';
      const [state, target_url] = base.state.boot.split('\t');
      return JSON.stringify({ state, target_url, ...publication });
    }
    return query(args);
  };
  base.state.source += `
  build-and-deploy:
    needs: [prepare, typecheck-lint, behaviour, native-escape, journeys]
    concurrency:
${/^ {6}group: .+$/mu.exec(deploy.split('\n  build-and-deploy:\n')[1] ?? '')?.[0] ?? ''}
      cancel-in-progress: false
    env:
      MERGED_BOOT_PROOF: 'v1'
    steps:
      - name: Publish exact-SHA proof outcome
        id: boot
      - name: Read the deploy pin
        env:
          CI_WAVE_BOOT_OUTCOME: \${{ steps.boot.outcome }}
`;
  const ship = details.find(row => row.name === 'build-and-deploy');
  if (ship === undefined) throw new Error('Missing merged shipping fixture');
  return { state: base.state, ship, details, publication };
}

const manualDescription = 'Manual merged-v1 SIX: source 123/1; through 2026-10-30T21:29:00.000Z';
const manualStatus = { state: 'success', target_url: 'https://github.com/project-wildshard/engine/actions/runs/123',
  description: manualDescription, created_at: '2026-10-30T21:31:00Z' };

test('the real gh subprocess keeps paginated jobs and newest statuses without incompatible flags', () => {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/deploy-pagination-'));
  try {
    const gh = resolve(directory, 'gh');
    writeFileSync(gh, String.raw`#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(5);
fs.appendFileSync(process.env.GH_TEST_CALLS, JSON.stringify(args) + '\n');
if (args.includes('--slurp') && args.includes('--jq')) throw new Error('incompatible gh flags');
const replies = JSON.parse(fs.readFileSync(process.env.GH_TEST_REPLIES, 'utf8'));
const key = JSON.stringify(args);
if (!Object.hasOwn(replies, key)) throw new Error('Unexpected API subprocess: ' + key);
process.stdout.write(replies[key]);
`);
    chmodSync(gh, 0o755);
    for (const merged of [false, true]) {
      const fixture = merged ? mergedReadyFixture() : readyFixture();
      const { state, ship } = fixture;
      if (merged && 'steps' in ship && Array.isArray(ship.steps)) {
        ship.status = 'completed'; ship.conclusion = 'failure';
        ship.steps.push({ name: 'Publish exact-SHA proof outcome', number: 2, status: 'completed', conclusion: 'success' });
        state.boot = `success\thttps://github.com/project-wildshard/engine/actions/runs/123`;
      }
      const replies: Record<string, string> = {};
      readySource('123', liveBuild, args => {
        const output = state.query(args);
        replies[JSON.stringify(args)] = output;
        if (args.includes('--slurp')) {
          const jqAt = args.indexOf('--jq');
          const rawArgs = args.filter((_arg, index) => index !== jqAt && index !== jqAt + 1);
          replies[JSON.stringify(rawArgs)] = args[0]?.includes('/jobs?')
            ? JSON.stringify([{ jobs: state.details.slice(0, 10) }, { jobs: state.details.slice(10) }])
            : JSON.stringify([{ statuses: [{ context: 'unrelated', state: 'failure' }] },
              { statuses: [{ context: 'boot-smoke', ...JSON.parse(output) }] }]);
        }
        return output;
      }, readyNow);
      const jobKey = Object.keys(replies).find(key => key.includes('/jobs?') && !key.includes('--jq'));
      const statusKey = Object.keys(replies).find(key => key.includes('/status') && !key.includes('--jq'));
      if (jobKey === undefined || (merged && statusKey === undefined)) throw new Error('Missing paginated subprocess fixture');
      const run = () => {
        writeFileSync(resolve(directory, 'replies.json'), JSON.stringify(replies));
        return spawnSync(process.execPath, ['--input-type=module', '-e',
          `import { readySource } from './scripts/deploy-pin.mjs';
           console.log(JSON.stringify(readySource('123', ${JSON.stringify(liveBuild)}, undefined, ${readyNow})));`],
        { encoding: 'utf8', timeout: 5000, env: { ...process.env,
          PATH: `${directory}:${process.env['PATH'] ?? ''}`,
          GH_TEST_REPLIES: resolve(directory, 'replies.json'), GH_TEST_CALLS: resolve(directory, 'calls.json') } });
      };
      const accepted = run();
      expect(accepted.stderr).toBe('');
      expect(accepted.error).toBeUndefined();
      expect(accepted.status).toBe(0);
      const acceptedProof: unknown = JSON.parse(accepted.stdout);
      expect(acceptedProof).toEqual(expect.objectContaining({ sha }));
      const fullJobs = replies[jobKey];
      replies[jobKey] = JSON.stringify([{ jobs: state.details.slice(0, 10) }]);
      const incomplete = run();
      expect(incomplete.error).toBeUndefined();
      expect(incomplete.status).toBe(1);
      expect(incomplete.stderr).toContain('inventory');
      if (fullJobs === undefined) throw new Error('Missing full jobs');
      replies[jobKey] = fullJobs;
      if (statusKey !== undefined) for (const verdict of ['failure', 'pending']) {
        replies[statusKey] = JSON.stringify([{ statuses: [{ ...manualStatus, context: 'boot-smoke', state: verdict }] },
          { statuses: [{ ...manualStatus, context: 'boot-smoke' }] }]);
        const refused = run();
        expect(refused.error).toBeUndefined();
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain('boot');
      }
    }
    const calls = readFileSync(resolve(directory, 'calls.json'), 'utf8').trim().split('\n')
      .map((line): string[] => {
        const parsed: unknown = JSON.parse(line);
        if (!Array.isArray(parsed)) throw new Error('Unreadable subprocess arguments');
        return parsed.map((arg: unknown) => {
          if (typeof arg !== 'string') throw new Error('Non-string subprocess argument');
          return arg;
        });
      });
    expect(calls.some(args => args.includes('--paginate') && args.includes('--slurp'))).toBe(true);
    expect(calls.every(args => !args.includes('--slurp') || !args.includes('--jq'))).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('merged queued selection is read-only and retains every actual source gate before staging its missing publisher', () => {
  const { state } = mergedReadyFixture(), calls: string[][] = [];
  const query = (args: string[]) => { calls.push(args); return state.query(args); };
  const proof = readySource('123', liveBuild, query, readyNow);
  expect(proof).toMatchObject({ bootPublishRequired: true, runAttempt: 1, reason: 'queued-30m' });
  expect(proof.jobs.filter(row => !['build-and-deploy', 'phone-route'].includes(row.name))).toHaveLength(35);
  expect(proof).not.toHaveProperty('ciGreen');
  expect(calls.some(args => args.includes('POST'))).toBe(false);
  expect(calls.some(args => args[0]?.includes('/runs/123/attempts/1/jobs?'))).toBe(true);
  for (const name of proof.jobs.filter(row => !['build-and-deploy', 'phone-route'].includes(row.name)).map(row => row.name)) {
    const altered = mergedReadyFixture(), row = altered.details.find(candidate => candidate.name === name);
    if (row === undefined) throw new Error('Missing merged source gate');
    row.conclusion = 'failure';
    expect(() => readySource('123', liveBuild, altered.state.query, readyNow)).toThrow();
  }
});

test('a lock-evicted unstarted source retains its thirty-minute bound and exact attempt while executed failures need real publication', () => {
  const { state, ship } = mergedReadyFixture();
  expect(() => readySource('123', liveBuild, state.query, readyNow - 1)).toThrow('30 minutes');
  ship.status = 'completed'; ship.conclusion = 'cancelled';
  state.run.status = 'completed'; state.run.conclusion = 'cancelled';
  expect(readySource('123', liveBuild, state.query, readyNow).reason).toBe('cancelled-before-start-30m');
  expect(() => readySource('123', liveBuild, state.query, readyNow - 1)).toThrow('30 minutes');
  ship.steps.push({ name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' });
  expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow('publisher');
  ship.steps.push({ name: 'Publish exact-SHA proof outcome', number: 2, status: 'completed', conclusion: 'success' });
  state.boot = `success\thttps://github.com/project-wildshard/engine/actions/runs/123`;
  expect(readySource('123', liveBuild, state.query, readyNow).bootPublishRequired).toBe(false);
  ship.status = 'in_progress'; ship.conclusion = null;
  expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow('30 minutes');
});

test('merged source refuses foreign jobs, a changed attempt, ambiguous steps and any existing nonmatching boot status', () => {
  for (const boot of ['pending\turl', 'failure\turl', 'success\thttps://github.com/foreign/actions/runs/123']) {
    const { state } = mergedReadyFixture(); state.boot = boot;
    expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow();
  }
  for (const mutate of [
    (row: ReturnType<typeof mergedReadyFixture>['ship']) => { row.run_attempt = 2; },
    (row: ReturnType<typeof mergedReadyFixture>['ship']) => { row.run_id = 124; },
    (row: ReturnType<typeof mergedReadyFixture>['ship']) => { row.head_sha = 'c'.repeat(40); },
  ]) {
    const { state, ship } = mergedReadyFixture(); mutate(ship);
    expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow('identity');
  }
  const wrongTopology = mergedReadyFixture();
  wrongTopology.state.source = wrongTopology.state.source.replace("'production-release'", "'foreign'");
  expect(() => readySource('123', liveBuild, wrongTopology.state.query, readyNow)).toThrow('topology');
});

test('manual merged completion restores and re-admits exact bytes before publishing and reading back the real source status', () => {
  const { state, ship } = mergedReadyFixture(), events: string[] = [];
  const proof = readySource('123', liveBuild, state.query, readyNow);
  const result = completeReadySource(proof, candidate => {
    events.push('restore'); expect(candidate.sha).toBe(sha); expect(candidate.run).toBe('123');
    // The manual job's production group can evict this never-started source.
    ship.status = 'completed'; ship.conclusion = 'cancelled';
    state.run.status = 'completed'; state.run.conclusion = 'cancelled';
    return '/runner-temp/verified-archive';
  }, () => {
    events.push('recheck'); return readySource('123', liveBuild, state.query, readyNow);
  }, args => {
    if (args.includes('POST')) {
      events.push('post'); expect(args[0]).toBe(`repos/project-wildshard/engine/statuses/${sha}`);
      expect(args).toContain('target_url=https://github.com/project-wildshard/engine/actions/runs/123');
      expect(args).toContain(`description=${manualDescription}`);
      return '';
    }
    events.push('readback'); return JSON.stringify(manualStatus);
  });
  expect(events).toEqual(['restore', 'recheck', 'post', 'readback']);
  expect(result).toMatchObject({ prebuiltArchive: '/runner-temp/verified-archive', bootPublished: true, reason: 'cancelled-before-start-30m' });
});

test('archive failures, changed proofs, POST failures and readback races produce no deployment result', () => {
  for (const fault of ['archive', 'recheck', 'attempt', 'six', 'post', 'readback', 'foreign-readback']) {
    const { state } = mergedReadyFixture(), proof = readySource('123', liveBuild, state.query, readyNow);
    let output: ReturnType<typeof completeReadySource> | undefined;
    expect(() => {
      output = completeReadySource(proof, () => { if (fault === 'archive') throw new Error('Archive refused'); return '/runner-temp/verified-archive'; }, () => {
        if (fault === 'recheck') throw new Error('Source gate changed');
        return fault === 'attempt' ? { ...proof, runAttempt: 2 }
          : fault === 'six' ? { ...proof, sixCompletedAt: '2026-10-30T21:30:00Z' } : proof;
      }, args => {
        if (args.includes('POST')) { if (fault === 'post') throw new Error('POST refused'); return ''; }
        return JSON.stringify({ ...manualStatus, ...(fault === 'foreign-readback'
          ? { target_url: 'https://github.com/foreign/actions/runs/123' } : { state: 'failure' }) });
      });
    }).toThrow();
    expect(output).toBeUndefined();
  }
  const legacy = readyFixture(), proof = readySource('123', liveBuild, legacy.state.query, readyNow);
  const forbidden = () => { throw new Error('Historical proof must not enter the new publisher'); };
  expect(completeReadySource(proof, forbidden, forbidden, forbidden)).toMatchObject({ prebuiltArchive: null, bootPublished: false });
});

test('a successful manual POST with failed readback resumes idempotently only with unchanged SIX and attempt evidence', () => {
  const { state, publication, details } = mergedReadyFixture();
  const proof = readySource('123', liveBuild, state.query, readyNow);
  expect(() => completeReadySource(proof, () => '/runner-temp/verified-archive', () => proof, args => {
    if (args.includes('POST')) {
      state.boot = `success\t${manualStatus.target_url}`;
      publication.description = manualDescription;
      return '';
    }
    throw new Error('Readback unavailable after successful POST');
  })).toThrow('Readback unavailable');
  const resumed = readySource('123', liveBuild, state.query, readyNow);
  expect(resumed.bootAlreadyPublished).toBe(true);
  const completed = completeReadySource(resumed, () => '/runner-temp/verified-archive', () => resumed, args => {
    expect(args).not.toContain('POST'); return JSON.stringify(manualStatus);
  });
  expect(completed).toMatchObject({ bootPublished: false, prebuiltArchive: '/runner-temp/verified-archive' });
  const six = details.find(row => row.name === 'journeys (explorer)');
  if (six === undefined) throw new Error('Missing actual SIX proof');
  six.completed_at = '2026-10-30T21:30:00Z';
  expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow();
  six.completed_at = '2026-10-30T21:29:00Z';
  publication.created_at = '2026-10-30T21:28:00Z';
  expect(() => readySource('123', liveBuild, state.query, readyNow)).toThrow();
});

test('a lost manual POST response executes once rather than retrying over a newer status', () => {
  const owned = resolve(mkdtempSync('tmp/ready-post-'));
  try {
    const bin = resolve(owned, 'bin'), calls = resolve(owned, 'calls'); mkdirSync(bin);
    writeFileSync(resolve(bin, 'gh'), '#!/bin/sh\nprintf "called\\n" >> "$READY_POST_CALLS"\nprintf "HTTP 500: response lost\\n" >&2\nexit 1\n', { mode: 0o755 });
    const { state } = mergedReadyFixture(), proof = readySource('123', liveBuild, state.query, readyNow);
    const command = `import{readFileSync}from'node:fs';import{completeReadySource}from'./scripts/deploy-pin.mjs';const proof=JSON.parse(readFileSync(0,'utf8'));completeReadySource(proof,()=>'/verified/archive',()=>proof);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', command], {
      encoding: 'utf8', timeout: 5000, input: JSON.stringify(proof),
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, READY_POST_CALLS: calls },
    });
    expect(result.status).not.toBe(0); expect(result.error).toBeUndefined();
    expect(readFileSync(calls, 'utf8')).toBe('called\n');
  } finally { rmSync(owned, { recursive: true, force: true }); }
});

test('trusted archive staging survives checkout cleanup and the later restore always validates its cached bytes again', () => {
  const owned = resolve(mkdtempSync('tmp/ready-archive-'));
  try {
    const runner = resolve(owned, 'runner'), workspace = resolve(owned, 'workspace');
    mkdirSync(runner); mkdirSync(workspace);
    const packet = resolve(owned, 'packet');
    const made = spawnSync('python3', ['-c', `import importlib.util,shutil,sys
spec=importlib.util.spec_from_file_location('prebuilt_tests','scripts/test_prebuilt_output.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
case=module.PrebuiltTests();case.setUp()
try: shutil.copytree(case.packet,sys.argv[1])
finally: case.tearDown()
`, packet], { encoding: 'utf8', timeout: 5000 });
    expect(made.status, made.stderr).toBe(0);
    const commands: { command: string; args: string[] }[] = [];
    const archive = stageReadyArchive({ sha, run: '123' }, runner, (command, args) => {
      commands.push({ command, args });
      if (command === 'gh') {
        const destination = args[args.indexOf('--dir') + 1];
        if (destination === undefined) throw new Error('Missing archive destination');
        cpSync(packet, destination, { recursive: true });
      } else {
        expect(args[0]).toBe(resolve('scripts/prebuilt-output.py'));
        expect(args).toContain(sha); expect(args).toContain('123');
        const restored = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 });
        expect(restored.status, restored.stderr).toBe(0);
      }
    });
    expect(commands.map(row => row.command)).toEqual(['gh', 'python3']);
    rmSync(workspace, { recursive: true }); mkdirSync(workspace);
    expect(existsSync(resolve(archive, 'proof.json'))).toBe(true);
    expect(existsSync(resolve(archive, '../verified-root'))).toBe(false);
    const trusted = resolve('scripts/prebuilt-output.py');
    const restored = spawnSync('python3', [trusted, 'restore', '--directory', archive, '--root', workspace,
      '--sha', sha, '--run', '123'], { encoding: 'utf8', timeout: 5000 });
    expect(restored.status, restored.stderr).toBe(0);
    expect(existsSync(resolve(workspace, '.vercel/output/functions/api/inbox.func/index.cjs'))).toBe(true);
    const receipt: { run: string } = JSON.parse(readFileSync(resolve(archive, 'proof.json'), 'utf8'));
    receipt.run = '124'; writeFileSync(resolve(archive, 'proof.json'), JSON.stringify(receipt));
    const corrupt = spawnSync('python3', [trusted, 'restore', '--directory', archive, '--root', workspace,
      '--sha', sha, '--run', '123'], { encoding: 'utf8', timeout: 5000 });
    expect(corrupt.status).not.toBe(0); expect(corrupt.stderr).toContain('source SHA/run differs');
    const restore = deploy.split('- name: Restore the exact successful push artifact')[1]?.split('# Explicit recovery')[0];
    expect(restore).toContain('PREBUILT_ARCHIVE:');
    expect(restore).toContain('staged-deployment.py" restore-install --sha "$DEPLOY_SHA" --run "$SOURCE_RUN"');
    expect(stagedController).toContain("directory = os.environ.get('PREBUILT_ARCHIVE', '')");
    expect(stagedController).toContain('if not directory:');
    const afterDownload = stagedController.split('env = dict(os.environ, PREBUILT_DOWNLOAD_MODE=mode,')[1];
    expect(afterDownload).toContain("'restore',");
    expect(afterDownload).toContain("'--sha', args.sha, '--run', args.run, '--directory', directory, '--timings'");
    expect(afterDownload).toContain("['npm', 'install', '--global', 'vercel@59.11.2']");
  } finally { rmSync(owned, { recursive: true, force: true }); }
});

test('manual prebuilt backstop retains actual aggregate and requires thirty queued minutes or terminal shipping',()=>{
  const {state,ship}=readyFixture();
  const proof=readySource('123',liveBuild,state.query,readyNow);
  expect(proof).toMatchObject({sha,run:'123',authority:'ready-source',reason:'queued-30m',aggregate:{status:'in_progress',conclusion:null}});
  expect(proof.jobs).toContainEqual({name:'build-and-deploy',status:'queued',conclusion:''});
  expect(proof).not.toHaveProperty('ciGreen');
  for(const status of ['queued','pending']) {
    state.run.status=status;
    expect(readySource('123',liveBuild,state.query,readyNow).aggregate).toEqual({status,conclusion:null});
  }
  expect(()=>readySource('123',liveBuild,state.query,readyNow-1)).toThrow('30 minutes');
  for(const conclusion of ['failure','cancelled']) {
    ship.status='completed';ship.conclusion=conclusion;state.run.status='completed';state.run.conclusion=conclusion;
    expect(readySource('123',liveBuild,state.query,readyNow).reason).toBe('terminal-ship');
  }
  for(const status of ['queued','in_progress','completed']) {
    ship.status=status;ship.conclusion=status==='completed'?'success':null;
    ship.created_at=new Date(readyNow+1).toISOString();
    expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('30 minutes');
  }
});

test('ready source keeps every source gate, native group, SIX and latest same-run boot mandatory',()=>{
  const original=readyFixture();
  for(const job of original.state.details.filter(row=>!['build-and-deploy','phone-route'].includes(row.name))) {
    for(const failure of ['failure','cancelled','skipped','pending']) {
      const {state}=readyFixture(),row=state.details.find(candidate=>candidate.name===job.name);
      if(row===undefined)throw new Error('Missing original source gate');
      row.status=failure==='pending'?'in_progress':'completed';row.conclusion=failure==='pending'?null:failure;
      expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow();
    }
  }
  for(const boot of ['pending\turl','failure\turl','success\thttps://github.com/foreign/actions/runs/123']) {
    const {state}=readyFixture();state.boot=boot;
    expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('same-run boot');
  }
  const missing=readyFixture();missing.state.details.pop();
  expect(()=>readySource('123',liveBuild,missing.state.query,readyNow)).toThrow('inventory');
  const duplicate=readyFixture();duplicate.state.details.push({...duplicate.state.details[0],name:'prepare',status:'completed',conclusion:'success',created_at:'',started_at:null,completed_at:null});
  expect(()=>readySource('123',liveBuild,duplicate.state.query,readyNow)).toThrow('inventory');
});

test('ready source preserves optional fixture fallback only when the selected ship permits it',()=>{
  const {state}=readyFixture();
  state.source+='\n  build-and-deploy:\n    needs: [prepare, behaviour]\n  fixtures:\n';
  state.details.push({name:'fixtures',status:'completed',conclusion:'failure',created_at:'',started_at:null,completed_at:null});
  expect(readySource('123',liveBuild,state.query,readyNow).failures).toContainEqual({name:'fixtures',status:'completed',conclusion:'failure'});
  state.source=state.source.replace('needs: [prepare, behaviour]','needs: [prepare, behaviour, fixtures]');
  expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('source gate');
});

test('only a source-declared report-only draw job may fail without replacing source proof',()=>{
  const {state}=readyFixture();
  state.source+='\n  draw-budget:\n    continue-on-error: true\n';
  state.details.push({name:'draw-budget',status:'completed',conclusion:'failure',created_at:'',started_at:null,completed_at:null});
  expect(readySource('123',liveBuild,state.query,readyNow).failures).toContainEqual({name:'draw-budget',status:'completed',conclusion:'failure'});
  const row=state.details.find(job=>job.name==='draw-budget');
  if(row===undefined)throw new Error('Missing diagnostic fixture');
  row.status='queued';row.conclusion=null;
  expect(readySource('123',liveBuild,state.query,readyNow).sha).toBe(sha);
  state.source=state.source.replace('draw-budget:\n    continue-on-error: true','draw-budget:\n    continue-on-error: false');
  expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('draw-budget');
});

test('reviewed diagnostic inventory remains exhaustive and duplicated or undeclared readers refuse',()=>{
  const {state}=readyFixture();
  state.source+='\n  draw-budget:\n    continue-on-error: true\n';
  expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('inventory');
  state.details.push({name:'draw-budget',status:'completed',conclusion:'failure',created_at:'',started_at:null,completed_at:null});
  state.details.push({name:'draw-budget',status:'completed',conclusion:'success',created_at:'',started_at:null,completed_at:null});
  expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow('inventory');
  const undeclared=recoveryFixture(true,true);
  undeclared.rows.push(['draw-budget','completed','success']);
  expect(()=>recoverySource('123',undeclared.query)).toThrow('inventory');
});

test('an explicitly report-only draw job can remain queued in recovery while every source gate stays mandatory',()=>{
  for(const status of ['queued','in_progress']) {
    const fixture=recoveryFixture(true,true);
    fixture.source+='\n  draw-budget:\n    continue-on-error: true\n';
    fixture.rows.push(['draw-budget',status,'']);
    expect(recoverySource('123',fixture.query)).toEqual({sha,run:'123'});
    const evidence=deadlineRecoverySource('123',fixture.query,Date.parse('2026-10-30T22:00:00Z'));
    expect(evidence.jobs).toContainEqual({name:'draw-budget',status,conclusion:''});
    const native=fixture.rows.find(row=>row[0]==='native-escape');
    if(native===undefined)throw new Error('Missing required native gate');
    native[1]='in_progress';native[2]='';
    expect(()=>recoverySource('123',fixture.query)).toThrow('completed verdict');
  }
});

test('ready source refuses duplicate releases, a regressing floor, and unreadable or newer proven waves',()=>{
  for(const kind of ['already-live','released','behind']) {
    const {state}=readyFixture();
    if(kind==='already-live')state.liveSha=sha;
    if(kind==='released')state.released=true;
    if(kind==='behind')state.floorStatus='behind';
    expect(()=>readySource('123',liveBuild,state.query,readyNow)).toThrow();
  }
  const {state}=readyFixture(),newer=readyFixture('124');
  newer.state.run.head_sha='c'.repeat(40);
  state.runs.unshift({id:124,status:'in_progress'});
  const query=(args:string[]):string=>(args[0]?.includes('/runs/124')||args[0]?.includes('c'.repeat(40))?newer.state.query:state.query)(args);
  expect(()=>readySource('123',liveBuild,query,readyNow)).toThrow('newer proven');
  newer.state.run.status='queued';state.runs[0]={id:124,status:'queued'};
  expect(()=>readySource('123',liveBuild,query,readyNow)).toThrow('newer proven');
  const gate=newer.state.details.find(job=>job.name==='prepare');
  if(gate===undefined)throw new Error('Missing newer gate');
  gate.status='in_progress';gate.conclusion=null;
  expect(readySource('123',liveBuild,query,readyNow).sha).toBe(sha);
  const unavailable=(args:string[]):string=>{
    if(args[0]?.includes('/runs/124'))throw new Error('API unavailable');
    return state.query(args);
  };
  expect(()=>readySource('123',liveBuild,unavailable,readyNow)).toThrow('API unavailable');
});

test('manual ready input selects the existing prebuilt branch without replacing automatic or emergency authorities',()=>{
  const ship=deploy.split('\n  build-and-deploy:\n')[1]?.split('\n  typecheck-lint:\n')[0];
  if(ship===undefined)throw new Error('Missing release job');
  expect(deploy).toContain('ready_source_run:');
  expect(ship).toContain('read-ready-source "$READY_SOURCE_RUN"');
  expect(ship).toContain('if [ "$authorities" -gt 1 ]');
  expect(ship).toContain('name: ready-source');
  expect(ship).toContain('read-wave');expect(ship).toContain('read-recovery');
  expect(ship).toContain("steps.pin.outputs.recovery != 'true'");
});

test('ready-source CLI refuses nonmanual, foreign and nonmain callers before any proof or live request',()=>{
  for(const change of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/other'},{GITHUB_REPOSITORY:'foreign/repo'}]) {
    const result=spawnSync(process.execPath,['scripts/deploy-pin.mjs','read-ready-source','123'],{encoding:'utf8',timeout:5000,
      env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'project-wildshard/engine',...change}});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Ready source requires an explicit main dispatch');
  }
});

test('recovery requires both exact-source native groups and preserves historical singleton proof',()=>{
  const original=recoveryFixture(true,true);
  expect(recoverySource('123',original.query)).toEqual({sha,run:'123'});
  const split=splitNativeRecoveryFixture();
  expect(recoverySource('123',split.query)).toEqual({sha,run:'123'});
  for(const name of ['native-escape (escape-titan)','native-escape (stories-qara)']) {
    for(const result of ['failure','skipped','cancelled','timed_out']) {
      const broken=splitNativeRecoveryFixture(),row=broken.rows.find(candidate=>candidate[0]===name);
      if(row===undefined)throw new Error('Missing native group fixture');
      row[2]=result;expect(()=>recoverySource('123',broken.query)).toThrow();
    }
    const missing=splitNativeRecoveryFixture();missing.rows=missing.rows.filter(row=>row[0]!==name);
    expect(()=>recoverySource('123',missing.query)).toThrow();
  }
  const duplicate=splitNativeRecoveryFixture();duplicate.rows.push(['native-escape (escape-titan)','completed','success']);
  expect(()=>recoverySource('123',duplicate.query)).toThrow();
  for(const matrix of ['escape-titan','escape-titan, escape-titan','escape-titan, foreign']) {
    const malformed=splitNativeRecoveryFixture();malformed.source=malformed.source.replace('escape-titan, stories-qara',matrix);
    expect(()=>recoverySource('123',malformed.query)).toThrow('native topology');
  }
});

test('chapter and independent routes require every reviewed native group exactly once',()=>{
 for(const groups of [
  ['escape-titan','stories-qara','chapter-one'],
  ['escape-titan','stories-qara','chapter-one','native-routes'],
 ]){
  const fixture=splitNativeRecoveryFixture(groups);
  if(groups.length===4)expect(()=>recoverySource('123',fixture.query)).toThrow('merged topology');
  else expect(recoverySource('123',fixture.query)).toEqual({sha,run:'123'});
  for(const group of groups){
    const name=`native-escape (${group})`;
    for(const verdict of ['failure','cancelled','skipped','timed_out']){
      const broken=splitNativeRecoveryFixture(groups),row=broken.rows.find(candidate=>candidate[0]===name);
      if(row===undefined)throw new Error('Missing native group fixture');
      row[2]=verdict;expect(()=>recoverySource('123',broken.query)).toThrow();
    }
    const missing=splitNativeRecoveryFixture(groups);missing.rows=missing.rows.filter(row=>row[0]!==name);
    expect(()=>recoverySource('123',missing.query)).toThrow();
    const pending=splitNativeRecoveryFixture(groups),row=pending.rows.find(candidate=>candidate[0]===name);
    if(row===undefined)throw new Error('Missing pending native group fixture');
    row[1]='in_progress';row[2]='';expect(()=>recoverySource('123',pending.query)).toThrow();
    const duplicate=splitNativeRecoveryFixture(groups);duplicate.rows.push([name,'completed','success']);
    expect(()=>recoverySource('123',duplicate.query)).toThrow();
  }
  for(const matrix of [['escape-titan','chapter-one'],['escape-titan','stories-qara','stories-qara'],['escape-titan','stories-qara','foreign'],
    ['escape-titan','stories-qara','chapter-one','foreign'],['escape-titan','stories-qara','native-routes','native-routes']]){
    const malformed=splitNativeRecoveryFixture(matrix);
    expect(()=>recoverySource('123',malformed.query)).toThrow('native topology');
  }
  const makeReady=()=>{
    const ready=mergedReadyFixture();
    ready.state.source=ready.state.source.replace('group: [escape-titan, stories-qara]',`group: [${groups.join(', ')}]`);
    const model=ready.details.find(row=>row.name==='native-escape (stories-qara)');
    if(model===undefined)throw new Error('Missing ready native fixture');
    for(const group of groups.slice(2))ready.details.push({...model,name:`native-escape (${group})`,steps:[]});
    return ready;
  };
  const ready=makeReady(),proof=readySource('123',liveBuild,ready.state.query,readyNow);
  expect(proof.bootPublishRequired).toBe(true);
  expect(proof.jobs.filter(row=>!['build-and-deploy','phone-route'].includes(row.name))).toHaveLength(33+groups.length);
  const completed=makeReady();
  completed.state.run.status='completed';completed.state.run.conclusion='success';
  completed.ship.status='completed';completed.ship.conclusion='success';
  completed.ship.completed_at='2026-10-30T21:31:00Z';
  completed.ship.steps.push({name:'Publish exact-SHA proof outcome',status:'completed',conclusion:'success',number:2});
  completed.state.boot='success\thttps://github.com/project-wildshard/engine/actions/runs/123';
  expect(recoverySource('123',completed.state.query)).toEqual({sha,run:'123'});
  for(const group of groups){
    const name=`native-escape (${group})`;
    for(const verdict of ['failure','cancelled','skipped','timed_out',null]){
      const broken=makeReady(),row=broken.details.find(candidate=>candidate.name===name);
      if(row===undefined)throw new Error('Missing ready route group');
      row.status=verdict===null?'in_progress':'completed';row.conclusion=verdict;
      expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
    }
    const missing=makeReady();missing.state.details=missing.details.filter(row=>row.name!==name);
    expect(()=>readySource('123',liveBuild,missing.state.query,readyNow)).toThrow('inventory');
    const duplicate=makeReady(),row=duplicate.details.find(candidate=>candidate.name===name);
    if(row===undefined)throw new Error('Missing duplicate route group');
    duplicate.details.push({...row});
    expect(()=>readySource('123',liveBuild,duplicate.state.query,readyNow)).toThrow('inventory');
  }
 }
});

test('recovery refuses partial, duplicated, foreign, divergent and stale proofs',()=>{
  for(const change of [{head_sha:'short'},{event:'workflow_dispatch'},{head_branch:'other'},{workflow_id:999},
    {status:'in_progress'},{conclusion:'cancelled'},{path:'.github/workflows/other.yml'},
    {id:456},{head_repository:{full_name:'foreign/repo'}}]) {
    const f=recoveryFixture();Object.assign(f.run,change);
    expect(()=>recoverySource('123',f.query)).toThrow('completed exact main push');
  }
  for(const status of ['behind','diverged']) {
    const f=recoveryFixture();f.ancestry.status=status;
    expect(()=>recoverySource('123',f.query)).toThrow('ancestry');
  }
  for(const alter of [(f:ReturnType<typeof recoveryFixture>)=>{f.rows.pop();},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows.push(['prepare','completed','success']);},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows.push(['foreign','completed','success']);},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows=f.rows.filter(row=>row[0]!=='native-escape');},
    (f:ReturnType<typeof recoveryFixture>)=>{f.source='no report-only exception';}]) {
    const f=recoveryFixture(true);alter(f);expect(()=>recoverySource('123',f.query)).toThrow();
  }
  for(const boot of ['pending\turl','failure\turl',`success\thttps://github.com/project-wildshard/engine/actions/runs/999`]) {
    const f=recoveryFixture();f.boot=boot;expect(()=>recoverySource('123',f.query)).toThrow('same-run boot');
  }
  expect(()=>recoverySource('123\ninjected',recoveryFixture().query)).toThrow('numeric');
});

test('recovery CLI refuses non-manual or non-main contexts before reading proofs',()=>{
  for(const command of ['read-recovery','read-deadline-recovery']) for(const change of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/other'},{GITHUB_REPOSITORY:'foreign/repo'}]) {
    const result=spawnSync(process.execPath,['scripts/deploy-pin.mjs',command,'123'],{encoding:'utf8',timeout:5000,
      env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'project-wildshard/engine',...change}});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Recovery requires an explicit main dispatch');
  }
});

const deadline = Date.parse('2026-10-30T10:30:00Z');
test('G917 cannot run early and retains actual reds without manufacturing CI green',()=>{
  const f=recoveryFixture(true,true);
  const behaviour=f.rows.find(row=>row[0]==='behaviour (4)'),ship=f.rows.find(row=>row[0]==='build-and-deploy');
  if(behaviour===undefined||ship===undefined)throw new Error('Missing deadline proof fixture');
  behaviour[2]='failure';ship[2]='skipped';
  expect(()=>deadlineRecoverySource('123',()=>{throw new Error('Must not query early');},deadline-1)).toThrow('unavailable before');
  const selected=deadlineRecoverySource('123',f.query,deadline);
  expect(selected.sha).toBe(sha);expect(selected.run).toBe('123');
  expect(selected.jobs).toHaveLength(f.rows.length);
  expect(selected.failures).toContainEqual({name:'behaviour (4)',status:'completed',conclusion:'failure'});
  expect(selected.jobs).toContainEqual({name:'build-and-deploy',status:'completed',conclusion:'skipped'});
  expect(()=>recoverySource('123',f.query)).toThrow();
});

test('G917 keeps prepare, every SIX leg, latest boot and exhaustive terminal inventory mandatory',()=>{
  const essential=['prepare','boot-verdict',...['boot-public','boot-developer','boot-grid','hover-chromium','hover-webkit','explorer'].map(name=>`journeys (${name})`)];
  for(const name of essential)for(const verdict of ['failure','skipped','cancelled','timed_out']){
    const f=recoveryFixture(true,true),row=f.rows.find(candidate=>candidate[0]===name);
    if(row===undefined)throw new Error('Missing essential deadline gate');
    row[2]=verdict;expect(()=>deadlineRecoverySource('123',f.query,deadline)).toThrow();
  }
  for(const mutate of [(f:ReturnType<typeof recoveryFixture>)=>{f.rows.pop();},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows.push(['prepare','completed','success']);},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows.push(['foreign','completed','success']);},
    (f:ReturnType<typeof recoveryFixture>)=>{f.rows[1]=['typecheck-lint','in_progress','failure'];},
    (f:ReturnType<typeof recoveryFixture>)=>{f.boot='failure\turl';},
    (f:ReturnType<typeof recoveryFixture>)=>{f.run.event='workflow_dispatch';},
    (f:ReturnType<typeof recoveryFixture>)=>{f.ancestry.status='diverged';}]){
    const f=recoveryFixture(true,true);mutate(f);expect(()=>deadlineRecoverySource('123',f.query,deadline)).toThrow();
  }
  const newer=recoveryFixture(true,true);
  newer.green.push({...newer.run,id:124,conclusion:'success'});
  expect(()=>deadlineRecoverySource('123',newer.query,deadline)).toThrow('newer fully green');
});

test('deadline recovery remains explicit and uses the exact tested prebuilt release path',()=>{
  expect(deploy).toContain('deadline_recovery_source_run:');
  expect(deploy).toContain('read-deadline-recovery "$DEADLINE_RECOVERY_SOURCE_RUN"');
  expect(deploy).toContain('Select exactly one explicit recovery authority');
  expect(deploy).toContain('name: deadline-recovery-source');
  expect(deploy).toContain('staged-deployment.py" restore-install --sha "$DEPLOY_SHA" --run "$SOURCE_RUN"');
  expect(deploy).toContain('read-wave');
});

test('recovery projects ancestry before the bounded GitHub stdout boundary',()=>{
  const f=recoveryFixture();let compared=false;
  const query=(args:string[]):string=>{
    if(args[0]?.includes('/compare/')) {
      compared=true;
      const option=args.indexOf('--jq'),projection=option===-1?undefined:args[option+1];
      if(projection===undefined)throw new Error('Unbounded comparison includes every changed file');
      // The consumer needs neither the file list nor commit bodies. The API
      // projection occurs in gh, before execFileSync's original stdout bound.
      expect(projection).toBe('{status,base_commit:{sha:.base_commit.sha}}');
    }
    return f.query(args);
  };
  expect(recoverySource('123',query)).toEqual({sha,run:'123'});expect(compared).toBe(true);
});

test('the exact native save/harness/paint bootstrap parses as separate source statements',()=>{
  const source=phoneBootstrap('window.__paint=true');
  const parse=(input:string)=>spawnSync(process.execPath,['--check','--input-type=module'],{input,encoding:'utf8',timeout:5000});
  expect(parse(source).status).toBe(0);
  const oldMissingSeparator=source.replace(';\nwindow.__wildshardHarness','window.__wildshardHarness');
  expect(parse(oldMissingSeparator).status).toBe(1);
  expect(parse(oldMissingSeparator).stderr).toContain('Unexpected identifier');
});


test('first-entry observation never takes the maintained driver slot or rewrites late tiles as on-time',()=>{
  const script=`const callbacks=[];globalThis.requestAnimationFrame=fn=>callbacks.push(fn);let inside=null,reads=0;const cell={instance:'market',slug:'open-plot-night-market',cell:[-1,1],shows:'loading',drawn:{far:true,near:false,l0:0,l1:0}};const game={frameCount:0,watchFrames(){throw new Error('occupied maintained driver slot')}};globalThis.window={__wildshard:{world:{game},requireWorld(){return this.world},shard:{grid:{travelState:()=>({inside}),state:()=>{reads++;return{inside,live:{live:{current:inside,gameplayReady:true}},cells:[cell],frame:{chain:{fx:{grain:0}}}}}}}}};(${watchPhoneEntry.toString()})('market');game.frameCount=1;callbacks.shift()();callbacks.shift()();if(reads!==0)throw new Error('Full census before entry');inside='market';game.frameCount=2;callbacks.shift()();cell.drawn.far=false;cell.drawn.l0=15;if(window.__phoneRouteEntry.entry.cell.drawn.far!==true||window.__phoneRouteEntry.entry.cell.drawn.l0!==0)throw new Error('Late tiles rewrote first-entry evidence');callbacks.shift()();if(reads!==1||callbacks.length!==0)throw new Error('Observer not retired');console.log('first-entry retained');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:5000});
  expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toContain('first-entry retained');
});

test('staged shipping keeps every original green aggregate and only ignores a terminal optional stage verdict',()=>{
  const {'boot-verdict':_boot,...gates}=needs;
  for(const result of ['success','failure','cancelled','skipped']){
    const staged={...current,needs:{...gates,'stage-prebuilt':{result}},bootOutcome:'success',staged:true};
    expect(waveSource(staged)).toEqual({skip:false,sha,run:'123'});
    for(const name of Object.keys(gates))for(const red of ['failure','cancelled','skipped','in_progress'])
      expect(()=>waveSource({...staged,needs:{...staged.needs,[name]:{result:red}}})).toThrow('Wave prerequisite');
    expect(()=>waveSource({...staged,staged:false})).toThrow('inventory');
  }
  expect(()=>waveSource({...current,needs:gates,bootOutcome:'success',staged:true})).toThrow('stage');
  expect(()=>waveSource({...current,needs:{...gates,'stage-prebuilt':{result:'in_progress'}},bootOutcome:'success',staged:true})).toThrow('stage');
});

function stagedReadyFixture(){
  const f=mergedReadyFixture();
  const stage=/\n {2}stage-prebuilt:\n[\s\S]*?(?=\n {2}build-and-deploy:\n)/u.exec(deploy)?.[0];
  if(stage===undefined)throw new Error('Missing reviewed stage job');
  f.state.source=f.state.source.replace('needs: [prepare, typecheck-lint, behaviour, native-escape, journeys]',
    'needs: [prepare, typecheck-lint, behaviour, native-escape, journeys, stage-prebuilt]')
    .replace("      MERGED_BOOT_PROOF: 'v1'","      MERGED_BOOT_PROOF: 'v1'\n      STAGED_RELEASE_PROOF: 'v1'")
    .replace('          CI_WAVE_BOOT_OUTCOME:', '          CI_WAVE_STAGE: v1\n          CI_WAVE_BOOT_OUTCOME:');
  f.state.source=stage+f.state.source;
  f.state.source=f.state.source.replace('group: [escape-titan, stories-qara]',
    'group: [escape-titan, stories-qara, chapter-one, native-routes]');
  const model=f.details.find(row=>row.name==='native-escape (stories-qara)');
  if(model===undefined)throw new Error('Missing reviewed native model');
  for(const group of ['chapter-one','native-routes'])f.details.push({...model,name:`native-escape (${group})`,steps:[]});
  const stageRow={...model,name:'stage-prebuilt',steps:[],conclusion:'failure' as string|null};
  f.details.push(stageRow);
  return{...f,stageRow};
}

test('four-native recovery keeps source37 and a terminal optional stage, preserving all historical rosters',()=>{
  for(const verdict of ['success','failure','cancelled','timed_out','skipped']){
    const f=stagedReadyFixture();f.stageRow.conclusion=verdict;
    const proof=readySource('123',liveBuild,f.state.query,readyNow);
    expect(proof.jobs.find(row=>row.name==='stage-prebuilt')?.conclusion).toBe(verdict);
    expect(proof.jobs.filter(row=>row.name.startsWith('native-escape ('))).toHaveLength(4);
    for(const group of ['escape-titan','stories-qara','chapter-one','native-routes']){
      const broken=stagedReadyFixture(),row=broken.details.find(item=>item.name===`native-escape (${group})`);
      if(row===undefined)throw new Error('Missing original required native group');
      row.conclusion='failure';
      expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
    }
  }
  const pending=stagedReadyFixture();pending.stageRow.status='in_progress';pending.stageRow.conclusion=null;
  expect(()=>readySource('123',liveBuild,pending.state.query,readyNow)).toThrow('terminal');
  const missing=stagedReadyFixture();missing.state.details=missing.details.filter(row=>row.name!=='stage-prebuilt');
  expect(()=>readySource('123',liveBuild,missing.state.query,readyNow)).toThrow('inventory');
  const duplicate=stagedReadyFixture();duplicate.details.push({...duplicate.stageRow});
  expect(()=>readySource('123',liveBuild,duplicate.state.query,readyNow)).toThrow('inventory');
  const wrong=stagedReadyFixture();wrong.state.source=wrong.state.source.replace('    needs: prepare','    needs: foreign');
  expect(()=>readySource('123',liveBuild,wrong.state.query,readyNow)).toThrow('stage topology');
});

test('completed historical35 and36 stay valid while completed36 plus staging is refused',()=>{
  const complete=(f:ReturnType<typeof stagedReadyFixture>)=>{
    f.state.run.status='completed';f.state.run.conclusion='success';
    f.ship.status='completed';f.ship.conclusion='success';f.ship.completed_at='2026-10-30T21:31:00Z';
    f.ship.steps.push({name:'Publish exact-SHA proof outcome',status:'completed',conclusion:'success',number:2});
    f.state.boot='success\thttps://github.com/project-wildshard/engine/actions/runs/123';
  };
  const all='escape-titan, stories-qara, chapter-one, native-routes';
  for(const groups of [['escape-titan','stories-qara'],['escape-titan','stories-qara','chapter-one']]){
    const f=stagedReadyFixture();complete(f);
    f.state.source=f.state.source.replace(`group: [${all}]`,`group: [${groups.join(', ')}]`)
      .replace(/\n {2}stage-prebuilt:\n[\s\S]*?(?=\n {2}(?:prepare|behaviour|phone-route):\n)/u,'')
      .replace(", stage-prebuilt]",']')
      .replace("      STAGED_RELEASE_PROOF: 'v1'\n",'')
      .replace('          CI_WAVE_STAGE: v1\n','');
    f.state.details=f.details.filter(row=>row.name!=='stage-prebuilt'&&(!row.name.startsWith('native-escape (')
      ||groups.some(group=>row.name===`native-escape (${group})`)));
    expect(recoverySource('123',f.state.query)).toEqual({sha,run:'123'});
  }
  const hybrid=stagedReadyFixture();complete(hybrid);
  hybrid.state.source=hybrid.state.source.replace(`group: [${all}]`,'group: [escape-titan, stories-qara, chapter-one]');
  hybrid.state.details=hybrid.details.filter(row=>row.name!=='native-escape (native-routes)');
  expect(()=>recoverySource('123',hybrid.state.query)).toThrow('stage topology');
  const twelve=stagedReadyFixture();complete(twelve);
  twelve.state.source=twelve.state.source.replace('vitest-plan.ts --shards 24','vitest-plan.ts --shards 12');
  expect(()=>recoverySource('123',twelve.state.query)).toThrow('stage topology');
});


function splitExplorerReadyFixture(){
  const f=stagedReadyFixture();
  // Freeze the old reviewed shape: today's four-job workflow cannot supply
  // the historical seven-job source proof used by these recovery controls.
  const journeys=`
  journeys:
    needs: prepare
    strategy:
      fail-fast: false
      max-parallel: 5
      matrix:
        part: [explorer-a, explorer-b, boot-public, boot-developer, hover-webkit, boot-grid, hover-chromium]
    runs-on: macos-15
    timeout-minutes: 20
    steps:
      - name: Unpack and verify the tested dist
        env:
          SMOKE_PART: \${{ (matrix.part == 'explorer-a' || matrix.part == 'explorer-b') && 'explorer' || matrix.part }}
      - name: Every primary Model Explorer draws its actual catalogue
        if: matrix.part == 'explorer-a' || matrix.part == 'explorer-b'
        run: node scripts/parity/explorer-smoke.mjs --case-group=\${{ matrix.part }}
`;
  f.state.source=f.state.source.replace("      MERGED_BOOT_PROOF: 'v1'", "      MERGED_BOOT_PROOF: 'v1'\n      EXPLORER_PROOF: 'split-v1'")+journeys;
  const explorer=f.details.find(row=>row.name==='journeys (explorer)');
  if(explorer===undefined)throw new Error('Missing original Explorer fixture');
  explorer.name='journeys (explorer-a)';
  f.details.push({...explorer,name:'journeys (explorer-b)',steps:[]});
  return f;
}

function retiredPhoneReadyFixture(){
    const f=splitExplorerReadyFixture();
    f.state.source=f.state.source.replace("      MERGED_BOOT_PROOF: 'v1'",
      "      MERGED_BOOT_PROOF: 'v1'\n      PHONE_PROOF: 'retired-g989'")
      .replace(/\n {2}phone-route:\n[\s\S]*?(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u,'');
    f.state.details=f.details.filter(row=>row.name!=='phone-route');
    return f;
}

test('G989 retires only the optional phone job and keeps every required exact-source verdict',()=>{
  const fixture=retiredPhoneReadyFixture;
  const f=fixture(),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.some(row=>row.name==='phone-route')).toBe(false);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(38);
  for(const job of f.state.details.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))){
    const broken=fixture(),row=broken.state.details.find(candidate=>candidate.name===job.name);
    if(row===undefined)throw new Error('Missing required source gate');
    row.conclusion='failure';expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
  }
  const unmarked=fixture();unmarked.state.source=unmarked.state.source.replace("      PHONE_PROOF: 'retired-g989'\n",'');
  expect(()=>readySource('123',liveBuild,unmarked.state.query,readyNow)).toThrow('phone policy');
  const unexpected=fixture(),phone=unexpected.details.find(row=>row.name==='phone-route');
  if(phone===undefined)throw new Error('Missing historical phone fixture');
  unexpected.state.details.push(phone);
  expect(()=>readySource('123',liveBuild,unexpected.state.query,readyNow)).toThrow('inventory');
  const hybrid=fixture();hybrid.state.source+='\n  phone-route:\n    continue-on-error: true\n';
  expect(()=>readySource('123',liveBuild,hybrid.state.query,readyNow)).toThrow('phone policy');
});

function twelveBehaviourReadyFixture(){
  const f=retiredPhoneReadyFixture();
  f.state.source=f.state.source.replace("      PHONE_PROOF: 'retired-g989'",
    "      PHONE_PROOF: 'retired-g989'\n      BEHAVIOUR_PROOF: 'twelve-g989'")
    .replace('vitest-plan.ts --shards 24','vitest-plan.ts --shards 12')
    .replace(`--shard=\${{ matrix.shard }}/24`,`--shard=\${{ matrix.shard }}/12`)
    .replace(`shard: [${Array.from({length:24},(_,i)=>i+1).join(', ')}]`,
      `shard: [${Array.from({length:12},(_,i)=>i+1).join(', ')}]`);
  f.state.details=f.state.details.filter(row=>!row.name.startsWith('behaviour (')||Number(/\((\d+)\)/u.exec(row.name)?.[1])<=12);
  return f;
}

const packedCases=[
  ['boot-public','Every public shard reaches real page-ready'],
  ['developer-webkit','Experimental shards reach real page-ready'],
  ['grid-chromium','Grid home and Signal road entry reach real page-ready'],
  ['grid-chromium','Chromium touch HOVER mounts in the template and on the grid road'],
  ['developer-webkit','WebKit touch HOVER mounts in the template and on the grid road'],
  ['developer-webkit','WebKit world and held-item rendering'],
  ['explorer','Every primary Model Explorer draws its actual catalogue'],
] as const;

function fourJourneyReadyFixture(){
  const f=twelveBehaviourReadyFixture(),journeys=deploy.split('\n  journeys:\n')[1];
  if(journeys===undefined)throw new Error('Missing current four-job source');
  f.state.source=f.state.source.replace("      EXPLORER_PROOF: 'split-v1'","      JOURNEYS_PROOF: 'four-g989'")
    .replace(/\n {2}journeys:\n[\s\S]*$/u,`\n  journeys:\n${journeys}`);
  const model=f.state.details.find(row=>row.name==='journeys (explorer-a)');
  if(model===undefined)throw new Error('Missing journey fixture');
  f.state.details=f.state.details.filter(row=>!row.name.startsWith('journeys ('));
  for(const group of ['explorer','boot-public','developer-webkit','grid-chromium'])f.state.details.push({...model,
    name:`journeys (${group})`,steps:packedCases.filter(([owner])=>owner===group).map(([,name],index)=>({
      name,status:'completed',conclusion:'success',number:index+1,
    }))});
  return f;
}

test('four packed jobs keep every logical SIX case and reject skipped or red steps behind a green job',()=>{
  const f=fourJourneyReadyFixture(),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.filter(row=>row.name.startsWith('journeys ('))).toHaveLength(4);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(23);
  for(const [group,name]of packedCases)for(const verdict of ['failure','skipped','cancelled',null]){
    const broken=fourJourneyReadyFixture(),step=broken.state.details.find(row=>row.name===`journeys (${group})`)?.steps?.find(row=>row.name===name);
    if(step===undefined)throw new Error('Missing original logical check');
    step.conclusion=verdict;
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow('Packed journey case');
  }
  for(const [before,after]of [["JOURNEYS_PROOF: 'four-g989'","JOURNEYS_PROOF: 'foreign'"],
    ['max-parallel: 4','max-parallel: 5'],['timeout-minutes: 20','timeout-minutes: 21'],
    ['--case-group=all','--case-group=explorer-a'],["steps.inputs.outcome == 'success'","steps.inputs.outcome == 'failure'"]] as const){
    const broken=fourJourneyReadyFixture();
    const at=broken.state.source.lastIndexOf(before);
    if(at===-1)throw new Error('Missing real source guard');
    broken.state.source=broken.state.source.slice(0,at)+after+broken.state.source.slice(at+before.length);
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
  }
});

test('the PR-only draw source preserves the exact required23 and refuses a push diagnostic crossover',()=>{
  const fixture=()=>{
    const f=fourJourneyReadyFixture();
    const draw=/\n {2}draw-budget:\n[\s\S]*?(?=\n {2}journeys:\n)/u.exec(deploy)?.[0];
    if(draw===undefined)throw new Error('Missing reviewed PR diagnostic');
    f.state.source=f.state.source.replace("      JOURNEYS_PROOF: 'four-g989'",
      "      JOURNEYS_PROOF: 'four-g989'\n      DRAW_PROOF: 'pr-only-g989'")+draw;
    const model=f.state.details[0];if(model===undefined)throw new Error('Missing exact-run model');
    f.state.details.push({...model,name:'draw-budget',status:'completed',conclusion:'skipped',steps:[]});
    return f;
  };
  const f=fixture(),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.find(row=>row.name==='draw-budget')?.conclusion).toBe('skipped');
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy','draw-budget'].includes(row.name))).toHaveLength(23);
  const changed=fixture();changed.state.source=changed.state.source.replace("github.event_name == 'pull_request' }}",
    "(github.event_name == 'push' || github.event_name == 'pull_request') }}");
  expect(()=>readySource('123',liveBuild,changed.state.query,readyNow)).toThrow('draw policy');
  const foreign=fixture();foreign.state.source=foreign.state.source.replace("DRAW_PROOF: 'pr-only-g989'","DRAW_PROOF: 'foreign'");
  expect(()=>readySource('123',liveBuild,foreign.state.query,readyNow)).toThrow('draw policy');
});

test('G989 twelve-shard source requires all twelve exact verdicts and never relaxes historical24',()=>{
  const f=twelveBehaviourReadyFixture(),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.filter(row=>row.name.startsWith('behaviour ('))).toHaveLength(12);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(26);
  for(let index=1;index<=12;index++){
    const broken=twelveBehaviourReadyFixture(),row=broken.state.details.find(job=>job.name===`behaviour (${index})`);
    if(row===undefined)throw new Error('Missing behaviour shard');
    row.conclusion='failure';expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
  }
  for(const marker of ["      BEHAVIOUR_PROOF: 'twelve-g989'\n","      PHONE_PROOF: 'retired-g989'\n"]){
    const unmarked=twelveBehaviourReadyFixture();unmarked.state.source=unmarked.state.source.replace(marker,'');
    expect(()=>readySource('123',liveBuild,unmarked.state.query,readyNow)).toThrow();
  }
  const partial=twelveBehaviourReadyFixture();partial.state.details=partial.state.details.filter(row=>row.name!=='behaviour (12)');
  expect(()=>readySource('123',liveBuild,partial.state.query,readyNow)).toThrow('inventory');
  const old=retiredPhoneReadyFixture();old.state.details=old.state.details.filter(row=>row.name!=='behaviour (24)');
  expect(()=>readySource('123',liveBuild,old.state.query,readyNow)).toThrow('inventory');
});

test('reviewed split Explorer requires both exact jobs in the 38-gate source',()=>{
  const f=splitExplorerReadyFixture();
  const proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.filter(row=>row.name.startsWith('journeys ('))).toHaveLength(7);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','phone-route','build-and-deploy'].includes(row.name))).toHaveLength(38);
  for(const group of ['explorer-a','explorer-b']){
    for(const verdict of ['failure','cancelled','skipped','timed_out',null]){
      const broken=splitExplorerReadyFixture(),row=broken.details.find(item=>item.name===`journeys (${group})`);
      if(row===undefined)throw new Error('Missing actual Explorer model');
      row.conclusion=verdict;
      expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
    }
    for(const status of ['queued','in_progress']){
      const pending=splitExplorerReadyFixture(),row=pending.details.find(item=>item.name===`journeys (${group})`);
      if(row===undefined)throw new Error('Missing actual Explorer model');
      row.status=status;row.conclusion=null;
      expect(()=>readySource('123',liveBuild,pending.state.query,readyNow)).toThrow();
    }
    const missing=splitExplorerReadyFixture();missing.state.details=missing.details.filter(row=>row.name!==`journeys (${group})`);
    expect(()=>readySource('123',liveBuild,missing.state.query,readyNow)).toThrow('inventory');
  }
  const duplicate=splitExplorerReadyFixture(),model=duplicate.details.find(row=>row.name==='journeys (explorer-a)');
  if(model===undefined)throw new Error('Missing actual Explorer model');
  duplicate.details.push({...model});expect(()=>readySource('123',liveBuild,duplicate.state.query,readyNow)).toThrow('inventory');
  const old=stagedReadyFixture(),oldModel=old.details.find(row=>row.name==='journeys (explorer)');
  if(oldModel===undefined)throw new Error('Missing historical Explorer model');
  old.details.push({...oldModel,name:'journeys (explorer-b)'});
  expect(()=>readySource('123',liveBuild,old.state.query,readyNow)).toThrow('inventory');
});

test('split Explorer refuses foreign, hybrid and changed-guard source topologies',()=>{
  for(const [before,after]of [
    ["      EXPLORER_PROOF: 'split-v1'\n",''],["EXPLORER_PROOF: 'split-v1'","EXPLORER_PROOF: 'foreign'"],
    ['part: [explorer-a, explorer-b,','part: [explorer-a, explorer-a,'],
    ['part: [explorer-a, explorer-b,','part: [explorer-a, explorer,'],
    ['part: [explorer-a, explorer-b,','part: [explorer-a, foreign,'],
    ['max-parallel: 5','max-parallel: 6'],['timeout-minutes: 20','timeout-minutes: 21'],
    [`--case-group=\${{ matrix.part }}`,'--case-group=explorer-a'],
    ['group: [escape-titan, stories-qara, chapter-one, native-routes]','group: [escape-titan, stories-qara, chapter-one]'],
  ] as const){
    const f=splitExplorerReadyFixture();expect(f.state.source).toContain(before);
    const index=f.state.source.lastIndexOf(before);
    f.state.source=f.state.source.slice(0,index)+after+f.state.source.slice(index+before.length);
    expect(()=>readySource('123',liveBuild,f.state.query,readyNow),`Source mutation: ${before}`).toThrow();
  }
  const f=splitExplorerReadyFixture();f.state.run.status='completed';f.state.run.conclusion='success';
  f.ship.status='completed';f.ship.conclusion='success';f.ship.completed_at='2026-10-30T21:31:00Z';
  f.ship.steps.push({name:'Publish exact-SHA proof outcome',status:'completed',conclusion:'success',number:2});
  f.state.boot='success\thttps://github.com/project-wildshard/engine/actions/runs/123';
  expect(recoverySource('123',f.state.query)).toEqual({sha,run:'123'});
});


function nativeFixtureReadyFixture(version:'v1'|'v2'|'v3'|'v4'='v1'){
  const f=fourJourneyReadyFixture();
  const source=version==='v4'?deploy:readFileSync(`test/fixtures/ci-native-cache-${version}.yml`,'utf8');
  for(const name of ['native-escape','fixtures',...(version!=='v1'?['behaviour']:[])]){
    const pattern=new RegExp(`\\n {2}${name}:\\n[\\s\\S]*?(?=\\n {2}[a-z][a-z0-9-]*:\\n|$)`,'u');
    const block=pattern.exec(source)?.[0];if(block===undefined)throw new Error('Missing current native input publisher');
    f.state.source=pattern.test(f.state.source)?f.state.source.replace(pattern,block):f.state.source+block;
  }
  const model=f.state.details[0];if(model===undefined)throw new Error('Missing exact-run source model');
  f.state.details.push({...model,name:'fixtures',status:'completed',conclusion:'success',steps:[{name:'Publish source-host native constructor inputs',status:'completed',conclusion:'success',number:1}]});
  for(const row of f.state.details)if(row.name.startsWith('native-escape ('))row.steps=[{name:'Restore source-host native constructor inputs',status:'completed',conclusion:'success',number:1}];
  if(version!=='v1')for(const row of f.state.details)if(row.name.startsWith('behaviour ('))row.steps=[{name:'Restore source-host native constructor inputs',status:'completed',conclusion:'success',number:1}];
  for(const name of ['native-escape','fixtures',...(version!=='v1'?['behaviour']:[])]){
    const pattern=new RegExp(`\\n {2}${name}:\\n([\\s\\S]*?)(?=\\n {2}[a-z][a-z0-9-]*:\\n|$)`,'u');
    const expected=pattern.exec(source)?.[1],actual=pattern.exec(f.state.source)?.[1];
    if(expected!==actual){
      let at=0;while(expected?.[at]===actual?.[at]&&at<Math.max(expected?.length??0,actual?.length??0))at++;
      throw new Error(`Rendered ${version} ${name} differs at ${at}: ${JSON.stringify({expected:expected?.slice(at,at+120),actual:actual?.slice(at,at+120)})}`);
    }
  }
  return f;
}

test('required native constructor publication adds one qualifying input gate and preserves the historical23',()=>{
  const f=nativeFixtureReadyFixture(),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(24);
  for(const verdict of ['failure','cancelled','skipped','in_progress']){
    const broken=nativeFixtureReadyFixture(),publisher=broken.state.details.find(row=>row.name==='fixtures');
    if(publisher===undefined)throw new Error('Missing required input publisher');
    publisher.status=verdict==='in_progress'?'in_progress':'completed';publisher.conclusion=verdict==='in_progress'?null:verdict;
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow(verdict==='in_progress'?'completed verdict':'source gate');
  }
  for(const [before,after]of [['needs: [prepare, fixtures]','needs: prepare'],['NATIVE_INPUT_PROOF: \'cache-v1\'','NATIVE_INPUT_PROOF: \'foreign\''],
    ['scripts/ci-native-fixtures.mjs restore','scripts/ci-native-fixtures.mjs build'],['timeout-minutes: 20','timeout-minutes: 21']] as const){
    const broken=nativeFixtureReadyFixture();
    const pattern=/\n {2}native-escape:\n[\s\S]*?(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u;
    const block=pattern.exec(broken.state.source)?.[0];if(block===undefined)throw new Error('Missing native block');
    const changed=block.replace(before,after);expect(changed).not.toBe(block);broken.state.source=broken.state.source.replace(pattern,changed);
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow();
  }
  const old=fourJourneyReadyFixture();expect(readySource('123',liveBuild,old.state.query,readyNow).jobs
    .filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(23);
});


test('native fixture authority requires observed successful publication and restore steps on the exact attempt',()=>{
  for(const name of ['fixtures','native-escape (escape-titan)','native-escape (stories-qara)','native-escape (chapter-one)','native-escape (native-routes)']){
    for(const defect of ['missing','duplicate','skipped','failed','run','attempt','sha']){
      const f=nativeFixtureReadyFixture(),row=f.state.details.find(job=>job.name===name);
      if(row===undefined)throw new Error('Missing exact input job');
      const steps=row.steps;
      if(steps===undefined)throw new Error('Missing original input steps');
      if(defect==='missing')row.steps=[];
      else if(defect==='duplicate')row.steps=[...steps,...steps];
      else if(defect==='skipped'||defect==='failed'){
        const step=steps[0];if(step===undefined)throw new Error('Missing input step');
        step.conclusion=defect==='failed'?'failure':'skipped';
      }else if(defect==='run')row.run_id=124;
      else if(defect==='attempt')row.run_attempt=2;
      else row.head_sha='b'.repeat(40);
      expect(()=>readySource('123',liveBuild,f.state.query,readyNow)).toThrow('Native fixture input');
    }
  }
});

test('v2 through v4 require verified input restore in all twelve behaviour jobs and keep v1 separate',()=>{
 for(const version of ['v2','v3','v4'] as const){
  const f=nativeFixtureReadyFixture(version),proof=readySource('123',liveBuild,f.state.query,readyNow);
  expect(proof.jobs.filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(24);
  for(let index=1;index<=12;index++)for(const defect of ['missing','duplicate','skipped','failed','run','attempt','sha']){
    const broken=nativeFixtureReadyFixture(version),row=broken.state.details.find(job=>job.name===`behaviour (${index})`);
    const steps=row?.steps;if(row===undefined||steps===undefined)throw new Error('Missing original behaviour steps');
    if(defect==='missing')row.steps=[];
    else if(defect==='duplicate')row.steps=[...steps,...steps];
    else if(defect==='skipped'||defect==='failed'){
      const step=steps[0];if(step===undefined)throw new Error('Missing restore step');step.conclusion=defect==='failed'?'failure':'skipped';
    }else if(defect==='run')row.run_id=124;
    else if(defect==='attempt')row.run_attempt=2;
    else row.head_sha='b'.repeat(40);
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow('Native fixture input');
  }
  for(const [before,after]of [["needs.fixtures.result == 'success' && ",''],
    ['scripts/ci-native-fixtures.mjs restore','scripts/ci-native-fixtures.mjs build'],
    ['WS_NALATI_NATIVE_CACHE:','WILDSHARD_GENERATE_CACHE:']] as const){
    const broken=nativeFixtureReadyFixture(version),pattern=/\n {2}behaviour:\n[\s\S]*?(?=\n {2}[a-z][a-z0-9-]*:\n|$)/u;
    const block=pattern.exec(broken.state.source)?.[0];if(block===undefined)throw new Error('Missing behaviour source');
    const changed=block.replace(before,after);expect(changed).not.toBe(block);broken.state.source=broken.state.source.replace(pattern,changed);
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow('publisher topology');
  }
  expect(readySource('123',liveBuild,nativeFixtureReadyFixture('v1').state.query,readyNow).jobs
    .filter(row=>!['stage-prebuilt','build-and-deploy'].includes(row.name))).toHaveLength(24);
 }
});

test('v3 and v4 pin the producer and all sixteen consumers to the same exact Node patch',()=>{
 for(const authority of ['v3','v4'] as const){
  for(const name of ['native-escape','fixtures','behaviour']){
    for(const version of ['24','24.22.0','24.22.1','24.22.3']){
      const f=nativeFixtureReadyFixture(authority);
      const pattern=new RegExp(`\\n {2}${name}:\\n[\\s\\S]*?(?=\\n {2}[a-z][a-z0-9-]*:\\n|$)`,'u');
      const block=pattern.exec(f.state.source)?.[0];if(block===undefined)throw new Error('Missing input job');
      expect(block.match(/node-version:/gu)).toHaveLength(1);
      expect(block).toContain("node-version: '24.22.2'");
      f.state.source=f.state.source.replace(pattern,block.replace("node-version: '24.22.2'",`node-version: '${version}'`));
      expect(()=>readySource('123',liveBuild,f.state.query,readyNow)).toThrow('publisher topology');
    }
  }
 }
});


test('v4 requires the exact dedicated Pine cache without widening Nalati or global caches',()=>{
  const f=nativeFixtureReadyFixture('v4');
  expect(readySource('123',liveBuild,f.state.query,readyNow).jobs).toHaveLength(26);
  for(const name of ['native-escape','behaviour'])for(const replacement of ['',`      WILDSHARD_GENERATE_CACHE: \${{ github.workspace }}/.cache/native-fixtures\n`]){
    const broken=nativeFixtureReadyFixture('v4'),pattern=new RegExp(`\\n {2}${name}:\\n[\\s\\S]*?(?=\\n {2}[a-z][a-z0-9-]*:\\n|$)`,'u');
    const block=pattern.exec(broken.state.source)?.[0];if(block===undefined)throw new Error('Missing cache owner');
    const changed=block.replace(`      WS_PINE_NATIVE_CACHE: \${{ github.workspace }}/.cache/native-fixtures\n`,replacement);
    expect(changed).not.toBe(block);broken.state.source=broken.state.source.replace(pattern,changed);
    expect(()=>readySource('123',liveBuild,broken.state.query,readyNow)).toThrow('publisher topology');
  }
});

test('a deploy cooks the catalogue before it takes traffic, and only where the store is configured', () => {
  const steps = deploy.split('\n      - name: ');
  const at = steps.findIndex(step => step.startsWith('Cook the catalogue\'s heads for this build')), next = steps[at + 1] ?? '';
  expect(next.startsWith('Deploy prebuilt output')).toBe(true);
  expect(steps[at]).toContain("vars.WILDSHARD_API_URL != ''");
  expect(steps[at]).toContain('cook-worker.mjs recook');
  expect(steps[at]).toContain('cook-worker.mjs bake ../.vercel/output/static');
});
