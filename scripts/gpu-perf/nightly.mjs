// E357 launchd poller. No GitHub-supplied command or shared-checkout mutation.
import { shardFolders } from '../shard-folders.mjs';
import { sourceBuildId } from '../app-build/buildIdentity.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { desktopProjections, flakedFields, selectMemoryReference, MEMORY_PROTOCOL } from './report.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = '') => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const plant = flag('plant'), memoryOnly = args.includes('--memory-only'), requested = flag('sha');
if (args.some((arg) => !/^(--plant=[a-z0-9-]+|--memory-only|--sha=[a-f0-9]{40})$/.test(arg)) || (memoryOnly && !requested) || (!memoryOnly && requested) || (plant && memoryOnly)) throw new Error('usage: nightly.sh [--plant=<id>] [--memory-only --sha=<40-hex>]');
const desktopReference = JSON.parse(readFileSync(new URL('../../budgets/desktop-reference.json', import.meta.url), 'utf8'));
const desktopFrames = [];
const reports = process.env.GPU_PERF_DIR ?? join(homedir(), '.wildshard/gpu-perf');
const cache = join(homedir(), '.cache/wildshard-gpu-perf'), mirror = join(cache, 'repo.git');
const node = process.env.GPU_PERF_NODE ?? process.execPath, pnpm = process.env.GPU_PERF_PNPM ?? 'pnpm', gh = process.env.GPU_PERF_GH ?? 'gh';
const apiRepo = 'repos/project-wildshard/engine';
mkdirSync(reports, { recursive: true });
if (!existsSync(mirror)) throw new Error('run scripts/gpu-perf/install.sh first');
const lock = join(cache, 'nightly.lock');
try { const fd = openSync(lock, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); }
catch { const pid = Number(readFileSync(lock, 'utf8')); let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* stale pid */ } if (alive) throw new Error('gpu-perf already running'); rmSync(lock); const fd = openSync(lock, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); }
const started = Date.now(), deadline = started + (memoryOnly ? 40 : 240) * 60_000;
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
let tree = '', port = '', sha = '', harnessSha = '', active = null;
let measuredShards = [];
let flakeWindow = '';
let memoryProtocol = '';
/** @type {import('./report.mjs').MemoryReference} */
let previousMemory = { path: '', sha: null, rejected: [] };
const control = { abort: false };
const steps = [], memory = [], measurements = [], artifacts = [], flakes = {};
/** E388: the M5 ruler budget is derived, never typed in: budgets/ceiling-sources.json's gpuM5Ms for the shard and tier
 * (E357 S1.6, src/client/engine/render/budgets.ts: 1000 / fps / variability − the CPU share, ÷ the phone : M5 ratio of
 * budgets/calibration.json; docs/design/engine-fit-v2/budget-design.md §2 and §6.1). A missing entry fails the run. */
const RULER_FORMULA = 'budgets/ceiling-sources.json derived.<shard>.<tier>.gpuM5Ms (1000 / fps / variability − cpuMs, ÷ the phone : M5 ratio)';
const rulerBudget = (root, shard, tier) => {
  const ms = JSON.parse(readFileSync(join(root, 'budgets/ceiling-sources.json'), 'utf8')).derived?.[shard]?.[tier]?.gpuM5Ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) throw new Error(`no derived GPU ruler budget for ${shard}/${tier} in budgets/ceiling-sources.json`);
  return ms;
};
const killGroup = (child) => { if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ } } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { control.abort = true; killGroup(active); });
const run = async (command, argv, options = {}) => {
  const { cwd = cache, max = 10, log = '', env = {}, cleanup = false } = options;
  if (!cleanup && (control.abort || Date.now() >= deadline)) throw new Error('nightly interrupted or exceeded 240 minutes');
  const fd = log ? openSync(log, 'w') : null;
  const child = spawn(command, argv, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  active = child;
  let stdout = '', stderr = '';
  const timing = { timedOut: false };
  child.stdout.on('data', (chunk) => { stdout += chunk; if (fd !== null) writeFileSync(fd, chunk); });
  child.stderr.on('data', (chunk) => { stderr += chunk; if (fd !== null) writeFileSync(fd, chunk); });
  const timeout = cleanup ? max * 60_000 : Math.min(max * 60_000, deadline - Date.now());
  const timer = setTimeout(() => { timing.timedOut = true; killGroup(child); }, timeout);
  const onTimeout = setTimeout(() => { if (timing.timedOut && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } } }, timeout + 5000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    return { code: timing.timedOut || control.abort ? 124 : code ?? 1, stdout, stderr };
  } finally { clearTimeout(timer); clearTimeout(onTimeout); if (fd !== null) closeSync(fd); active = null; }
};
const git = (...argv) => execFileSync('git', [`--git-dir=${mirror}`, ...argv], { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: Math.max(1, Math.min(10 * 60_000, deadline - Date.now())) }).trim();
const jsonAt = (revision, path, fallback) => { try { return JSON.parse(git('show', `${revision}:${path}`)); } catch { return fallback; } };
const status = async (context, state, description) => {
  if (plant) return;
  const posted = await run(gh, ['api', `${apiRepo}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description.slice(0, 140)}`], { max: 2, cleanup: true });
  if (posted.code !== 0) throw new Error(`posting ${context}: ${posted.stderr}`);
};
const step = async (name, command, argv, max) => {
  console.log(`gpu-perf: ${name}`);
  const result = await run(command, argv, { cwd: tree, max, log: join(reports, `${stamp}-${sha.slice(0, 7)}-${name}.log`), env: { WS_BUILD_ID: sourceBuildId(sha), SERVE_BUILD_DIR: join(cache, `preview-${sha.slice(0, 7)}`), SERVE_MAX_HOURS: '5' } });
  steps.push({ name, code: result.code, verdict: result.code === 0 ? 'success' : 'failure' });
  return result;
};

try {
  const fetched = await run('git', [`--git-dir=${mirror}`, 'fetch', 'origin', 'main:refs/heads/main'], { max: 10 });
  if (fetched.code !== 0) throw new Error(`mirror fetch: ${fetched.stderr}`);
  harnessSha = git('rev-parse', 'refs/heads/main');
  if (memoryOnly) { git('cat-file', '-e', `${requested}^{commit}`); sha = git('rev-parse', requested); }
  else {
    for (const candidate of git('rev-list', 'refs/heads/main', '-n', '30').split('\n')) {
      const result = await run(gh, ['api', `${apiRepo}/commits/${candidate}/status`], { max: 2 });
      if (result.code !== 0) throw new Error(`reading gpu-gate: ${result.stderr}`);
      if (JSON.parse(result.stdout).statuses?.find((row) => row.context === 'gpu-gate')?.state === 'success') { sha = candidate; break; }
    }
    if (!sha) { console.log('No gpu-gate green SHA in the last 30 commits'); process.exitCode = 0; }
    else if (!plant && readdirSync(reports).some((file) => /^\d.*\.json$/.test(file) && file.endsWith(`-${sha.slice(0, 7)}.json`))) { console.log(`Already reported ${sha}`); sha = ''; }
  }
  if (sha) {
    const candidateTree = join(cache, `tree-${sha.slice(0, 7)}`);
    if (existsSync(candidateTree)) throw new Error(`stale export ${candidateTree}; inspect it before retrying`);
    mkdirSync(candidateTree); tree = candidateTree;
    // Archive build inputs plus target parity, not the multi-GB art/progress history.
    const excluded = ['art/', 'progress/', 'sources/', 'docs/', 'ios/', 'android/', 'dist/', 'dist-native/', '.native-build/'];
    const paths = git('ls-tree', '--name-only', '-r', sha).split('\n').filter((path) => !excluded.some((prefix) => path.startsWith(prefix)));
    const archive = join(cache, `${stamp}.tar`);
    execFileSync('git', [`--git-dir=${mirror}`, 'archive', '-o', archive, sha, '--', ...paths], { maxBuffer: 16 * 1024 ** 2 });
    execFileSync('tar', ['-xf', archive, '-C', tree]); rmSync(archive);
    const pending = jsonAt(sha, 'project/archive/game-normalization/reviews/pending.json', []);
    writeFileSync(join(tree, 'memory-pending.json'), JSON.stringify(pending));
    let shards = shardFolders(tree);
    if (shards.length === 0) throw new Error('empty shard registry');
    if (plant) {
      const entry = jsonAt(sha, 'test/parity/plants/index.json', []).find((row) => row.id === plant);
      if (!entry) throw new Error(`unknown plant ${plant}`);
      shards = entry.shards === 'all' || entry.shards?.includes('all') ? shards : entry.shards;
      if (!Array.isArray(shards) || shards.length === 0) throw new Error('plant has no shards');
      if (entry.kind === 'patch' || entry.kind === 'nightly') {
        const patch = join(tree, 'test/parity/plants', entry.patch ?? `${plant}.patch`);
        const applied = await run('git', ['apply', patch], { cwd: tree });
        if (applied.code !== 0) throw new Error(`plant apply: ${applied.stderr}`);
      } else throw new Error(`nightly supports patch/nightly plants only: ${plant}`);
    }
    // Harness code comes from main's committed head; runtime and baselines remain the selected SHA's.
    const harnessPaths = ['scripts/parity.mjs', 'scripts/parity', 'scripts/gpu-perf', 'scripts/types', 'scripts/sim-memory.mjs', 'scripts/sim-lane.sh', 'scripts/gen-shards.mjs', 'scripts/gen-shards.d.mts'];
    const carried = harnessPaths.filter((path) => { try { git('cat-file', '-e', `${harnessSha}:${path}`); return true; } catch { return false; } });
    execFileSync('git', [`--git-dir=${mirror}`, 'archive', '-o', archive, harnessSha, '--', ...carried]);
    execFileSync('tar', ['-xf', archive, '-C', tree]); rmSync(archive);
    mkdirSync(join(tree, '.git')); // legacy Nine Dragon ruler's private slot files, never the shared git index
    if ((await step('install', pnpm, ['install', '--frozen-lockfile', '--prefer-offline', '--config.enable-global-virtual-store=false'], 15)).code !== 0) throw new Error('dependency install failed');
    const served = await step('serve', 'bash', [join(tree, 'scripts/serve-build.sh'), '--hours', '5', '--name', 'gpu-perf'], 10);
    const url = served.stdout.trim().split('\n').findLast((line) => line.startsWith('http://'));
    if (served.code !== 0 || !url) throw new Error('serve-build failed');
    port = new URL(url).port;
    measuredShards = shards;
    const priorFiles = readdirSync(reports).filter((file) => /^(memory-)?\d.*\.json$/.test(file));
    const candidates = priorFiles.flatMap((file) => {
      try { return [{ path: join(reports, file), report: JSON.parse(readFileSync(join(reports, file), 'utf8')) }]; }
      catch { console.warn(`Ignoring unreadable memory reference ${file}`); return []; }
    });
    previousMemory = selectMemoryReference(candidates, shards, new Date(started).toISOString());
    const previousPath = previousMemory.path;
    console.log(`gpu-perf: memory reference ${previousPath || 'none (first complete settled reading)'}`);
    if (!memoryOnly) {
      // scorecard's established baseline is a deliberate exception to excluded progress history.
      const baselinePaths = git('ls-tree', '--name-only', '-r', sha, '--', 'progress/scorecard/baseline.json', 'progress/scorecard/baseline').split('\n').filter(Boolean);
      if (baselinePaths.length > 0) { execFileSync('git', [`--git-dir=${mirror}`, 'archive', '-o', archive, sha, '--', ...baselinePaths]); execFileSync('tar', ['-xf', archive, '-C', tree]); rmSync(archive); }
      const common = [`--url=${url}`, '--lane=m5', `--shards=${shards.join(',')}`];
      // Parity owns a slot per browser; an outer lease can deadlock a full lane.
      await step('parity', node, [join(tree, 'scripts/parity.mjs'), ...common, '--tiers=phone,desktop', '--full', '--ms', `--out=${join(reports, `${stamp}-parity`)}`], 75);
      await step('offline', node, [join(tree, 'scripts/parity.mjs'), ...common, '--offline', '--tiers=phone'], 15);
      // One <=30 minute machine-wide model lock for all timing work.
      const timing = await step('rulers-scorecard', 'lockf', ['-k', join(homedir(), 'projects/localai/.model.lock'), 'bash', join(tree, 'scripts/gpu-perf/timing.sh'), url, `${stamp}-${sha.slice(0, 7)}`, node], 30);
      artifacts.push({ name: 'rulers-scorecard', text: timing.stdout });
      if (/\b[1-9]\d* of \d+ poses over/.test(timing.stdout)) steps.push({ name: 'Nine Dragon ruler over budget', code: 1, verdict: 'failure' });
      const ndBudget = rulerBudget(tree, 'nine-dragon-stack', 'phone');
      for (const match of timing.stdout.matchAll(/([^\n]+): GPU ([\d.]+) ms\/frame/g)) measurements.push({ pose: match[1].trim(), gpuMs: Number(match[2]), budgetMs: ndBudget, verdict: Number(match[2]) <= ndBudget ? 'success' : 'failure', formula: RULER_FORMULA });
      if (measurements.length === 0) steps.push({ name: 'GPU ruler readings missing', verdict: 'failure', code: 1 });
      for (const [dir, pattern] of [[join(tree, 'progress'), /-gpu-.*\.json$/], [join(tree, 'progress/scorecard'), /^nightly-.*\.(json|md)$/], [join(reports, `${stamp}-parity`), /\.(json|md)$/]]) {
        if (existsSync(dir)) for (const file of readdirSync(dir).filter((name) => pattern.test(name))) {
          const text = readFileSync(join(dir, file), 'utf8'); artifacts.push({ name: file, text });
          if (file.endsWith('.desktop.json')) desktopFrames.push(...desktopProjections(JSON.parse(text), desktopReference));
          if (file.endsWith('.json') && file.includes('-gpu-')) {
            // the ruler's own shard (pine-hollow-gpu-<tag>.json → pine-hollow, driftwood-gpu-<tag>.json → driftwood-isle) and tier
            const prefix = file.slice(0, file.indexOf('-gpu-')), shard = shards.find((slug) => slug === prefix || slug.startsWith(`${prefix}-`)) ?? prefix;
            const data = JSON.parse(text), budget = rulerBudget(tree, shard, data.tier ?? 'phone');
            if (data.rows?.some((row) => row.gpu > budget) || data.errors?.length > 0) steps.push({ name: `${file} ruler over its ${budget.toFixed(3)} ms budget/error`, code: 1, verdict: 'failure' });
          }
        }
      }
      // Gate artifacts are read as data only. E388: the tally covers every gpu-gate run since the previous full nightly
      // (no invented window), and every flaked field is listed with its count (a flake is a band narrower than its noise).
      const previousNightly = Math.max(0, ...readdirSync(reports).filter((file) => /^\d.*-[0-9a-f]{7}\.json$/.test(file)).flatMap((file) => {
        try { const at = Date.parse(JSON.parse(readFileSync(join(reports, file), 'utf8')).started); return Number.isFinite(at) && at < started ? [at] : []; } catch { return []; }
      }));
      flakeWindow = previousNightly > 0 ? new Date(previousNightly).toISOString() : '';
      const listed = previousNightly > 0 ? await run(gh, ['run', 'list', '-w', 'gpu-gate.yml', '--limit', '1000', '--json', 'databaseId,createdAt,status'], { max: 2 }) : { code: 0, stdout: '[]', stderr: '' };
      if (listed.code !== 0) steps.push({ name: 'flake tally unavailable', code: listed.code, verdict: 'failure' });
      else for (const gateRun of JSON.parse(listed.stdout).filter((row) => row.status === 'completed' && Date.parse(row.createdAt) >= previousNightly)) {
        const dir = join(reports, `${stamp}-gate-${gateRun.databaseId}`); mkdirSync(dir);
        const downloaded = await run(gh, ['run', 'download', String(gateRun.databaseId), '-p', 'parity-*', '-D', dir], { max: 2 });
        if (downloaded.code !== 0) { steps.push({ name: `flake artifact ${gateRun.databaseId} unavailable`, code: downloaded.code, verdict: 'failure' }); continue; }
        for (const file of readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.json'))) {
          const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
          for (const id of flakedFields(data)) flakes[id] = (flakes[id] ?? 0) + 1;
        }
      }
    }
    const simOut = join(reports, `${stamp}-sim-${sha.slice(0, 7)}`);
    await step('memory', 'bash', [join(tree, 'scripts/sim-lane.sh'), 'run', '--max', '40', 'wildshard-iphone', node, join(tree, 'scripts/sim-memory.mjs'), `--url=${url}`, `--shards=${shards.join(',')}`, '--runs=1', '--play=60', '--fly=60', `--out=${simOut}`, `--pending=${join(tree, 'memory-pending.json')}`, ...(previousPath ? [`--previous=${previousPath}`] : [])], 41);
    if (existsSync(join(simOut, 'report.json'))) {
      const reading = JSON.parse(readFileSync(join(simOut, 'report.json'), 'utf8'));
      memory.push(...reading.memory); memoryProtocol = reading.memoryProtocol ?? '';
    }
  }
} catch (error) { steps.push({ name: String(error), code: 1, verdict: 'failure' }); console.error(error); }
finally {
  if (port && tree) { try { await run('bash', [join(tree, 'scripts/serve-build.sh'), 'stop', port], { cwd: tree, max: 1, cleanup: true }); } catch (error) { console.error(error); } }
  // serve-build creates a registered scratch export; stop moves it to *.stopped-epoch.
  if (tree) rmSync(tree, { recursive: true, force: true });
  if (sha) rmSync(join(cache, `preview-${sha.slice(0, 7)}`), { recursive: true, force: true });
  rmSync(lock, { force: true });
}
if (sha) {
  const memoryComplete = memoryProtocol === MEMORY_PROTOCOL && steps.find((row) => row.name === 'memory')?.code === 0 && memory.length === measuredShards.length * 3 && measuredShards.length > 0;
  const memoryState = memoryComplete && memory.every((row) => row.verdict === 'success') ? 'success' : !memoryComplete || memory.some((row) => row.verdict === 'failure') ? 'failure' : 'pending';
  const verdict = steps.every((row) => row.verdict === 'success') && measurements.every((row) => row.verdict === 'success') && memoryState === 'success' ? 'success' : 'failure';
  const description = `M5 ${verdict} · memory ${memoryState}`;
  const name = plant ? `plant-${plant}-${stamp}` : `${memoryOnly ? 'memory-' : ''}${stamp}-${sha.slice(0, 7)}`;
  const report = { sha, harnessSha, shards: measuredShards, memoryProtocol, previousMemory, started: new Date(started).toISOString(), verdict, memoryState, memory, measurements, desktopFrames, flakes, artifacts, steps };
  writeFileSync(join(reports, `${name}.json`), JSON.stringify(report, null, 2));
  const lines = [description, '', `SHA ${sha}; harness ${harnessSha}`, `Memory reference: ${previousMemory.path || 'none (first complete settled reading)'}; SHA ${previousMemory.sha ?? 'none'}`, ...previousMemory.rejected.map((row) => `Rejected reference ${row.path}: ${row.reason}`), '', '| shard | phase | native median GB | native peak GB | spread GB (min–max) | inspector GB | previous GB | limit GB | verdict | reason |', '|---|---|---:|---:|---|---:|---:|---:|---:|---|---|'];
  for (const row of memory) lines.push(`| ${row.shard} | ${row.phase} | ${row.nativeGB ?? 'missing'} | ${row.nativePeakGB ?? 'missing'} | ${row.settling ? `${row.settling.minGB.toFixed(3)}–${row.settling.maxGB.toFixed(3)} (${row.settling.spreadPercent.toFixed(1)}%)` : 'legacy peak'} | ${row.inspectorGB ?? 'missing'} | ${row.previousGB ?? 'first'} | ${row.limitGB} | ${row.verdict} | ${row.reason} |`);
  lines.push('', 'Memory: the median of three one-second samples after each phase\'s work, their spread beside it; growth against the previous reading is reported, not gated (E388). The only red is the device limit: loading 1.8 / play 1.0 / explorer 1.0 decimal GB.');
  lines.push('', `GPU ruler budget: ${RULER_FORMULA}.`, ...measurements.map((row) => `${row.pose}: ${row.gpuMs} ms / ${row.budgetMs}: ${row.verdict}`), '', ...steps.map((row) => `${row.name}: ${row.verdict} (exit ${row.code})`));
  lines.push('', 'Desktop: projected RTX 3060 drawn-frame interval (informational; includes capture pacing):', ...desktopFrames.map((row) => `${row.shard}/${row.pose}: M5 ${row.m5FrameMs ?? 'missing'} ms / ${desktopReference.k3060} = ${row.projected3060FrameMs ?? 'missing'} ms vs ${row.targetFrameMs.toFixed(2)} ms · ${row.verdict}`), desktopReference.source, desktopReference.assumption);
  const textArtifacts = artifacts.filter((entry) => { if (entry.name === 'rulers-scorecard') return true; return entry.name.endsWith('.md'); });
  lines.push('', flakeWindow ? `Flaked fields in the gpu-gate runs since the previous full nightly (${flakeWindow}); each is a band narrower than its noise, for the lead to repair or quarantine:` : 'Flake tally: no previous full nightly, so it starts with the next one.', ...Object.entries(flakes).map(([id, count]) => `${id}: ${count}`), '', ...textArtifacts.map((entry) => `${entry.name}\n\n${entry.text}`));
  writeFileSync(join(reports, `${name}.md`), `${lines.join('\n')}\n`);
  if (!plant) { if (!memoryOnly) await status('gpu-perf', verdict, description); await status('gpu-perf/memory', memoryState, `Simulator memory ${memoryState}`); }
  console.log(`${description}\n${join(reports, `${name}.md`)}`);
  process.exitCode = verdict === 'success' ? 0 : 1;
}
