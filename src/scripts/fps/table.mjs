#!/usr/bin/env node
// DF6 / J464. One browser at a time on the mini.
// Default: one cold three-leg route per profile. --qualify: full nightly / DF15 sampling.
// node src/scripts/fps/table.mjs --zone driftwood-isle [--qualify] [--profiles NAME,...] [--base ORIGIN]
// --device key=value,... saves device slots for every profile (an A/B arm; true/false/numbers parsed).
// --stop-on-death: a cell whose player died ends the run with exit 4 (batch.mjs PLAYER_DIED), for a caller that restarts the world.
// --dock-only --cold-only is a short diagnostic. With WS_BENCH=1, add --pass-breakdown for CPU submit by pass.
// The full matrix includes both desktop sizes and a warm repeat.
// --qualify --profiles NAME --windows 1 proves reduced sampling; its subset scope never qualifies nightly.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assembleCapture, atomicJson, cellPath, openResume, readCell, signature } from './matrix.mjs';
import { agentFetch } from '../agent-requests.mjs';
import { capFor, readCaps } from '../budgets/files.mjs';
import { fpsPlan } from './plan.mjs';
import { passBreakdownAllowed, requirePassBench } from './passes.mjs';
import { workloadCounts } from './workload.mjs';
import { PLAYER_DIED, cellError, playerDied, retryColdBoot, runBatch } from './batch.mjs';
import { lockfArgs, lockRoot } from '../memory/iphone/locks.mjs';

/** @typedef {import('./plan.mjs').ProfileSpec} ProfileSpec */
const root = resolve(import.meta.dirname, '../../..');
// MINI-DEVEX MD2: desktop censuses hold desktop-gpu.lock (then the legacy mini-measure.lock), never the phone's lock
const gpuLock = lockfArgs('desktop');
const marker = join(homedir(), '.cache/wildshard/jake-playing');
const exclusiveGPU = '^/.*(ms-playwright|[.]agent-browser/browsers)/.*(chrome-headless-shell|Chromium|Chrome for Testing|MiniBrowser|Playwright|WebKit[.]GPU[.]Development)( |$)';
const keys = Object.keys(fpsPlan().profiles);
const choices = parseArgs({ options: {
  zone: { type:'string', default:'driftwood-isle' }, profiles:{ type:'string', default:keys.join(',') },
  runs:{ type:'string' }, windows:{ type:'string' }, qualify:{ type:'boolean' }, base:{ type:'string', default:'https://staging.wildshard.io/' }, out:{ type:'string' },
  'cpu-rates':{ type:'string' }, 'dock-only':{ type:'boolean' }, 'pass-breakdown':{ type:'boolean' }, 'cold-only':{ type:'boolean' }, 'dry-run':{ type:'boolean' }, 'worker':{ type:'string' }, 'worker-batch':{ type:'string' }, device:{ type:'string' }, 'stop-on-death':{ type:'boolean' },
} }).values;
const sampling = fpsPlan({qualify:choices.qualify,runs:choices.runs,dockOnly:choices['dock-only'],coldOnly:choices['cold-only'],windows:choices.windows});
const {profiles,route,count} = sampling;

function gpuBusy() {
  try {
    return execFileSync('/usr/bin/pgrep', ['-f', exclusiveGPU], {encoding:'utf8'}).trim() !== '';
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('status' in error) || error.status !== 1) throw error;
    return false;
  }
}

function model() { return execFileSync('/usr/sbin/sysctl',['-n','hw.model'],{encoding:'utf8'}).trim(); }
const bookPath = join(root,'budgets/fps-calibration.json');
const calibration = existsSync(bookPath) ? JSON.parse(readFileSync(bookPath,'utf8')) : { hosts:{} };
const order = new Map([['pass',0],['miss',2],['incomplete',3]]);
const show = (/** @type {number|null|undefined} */ x) => x === null || x === undefined ? '—' : x.toFixed(1);

/** @param {any[]} runs */
function table(runs) {
  const heading = '| Profile | Floor | fps | p50 ms | p95 ms | max ms | >50/min | Phone GPU ms | Tris p95 | Draws p95 | Programs | Links after control | Worst segment | Verdict |';
  const rows = keys.filter(key => runs.some(run=>run.name===key)).map(name => {
    const set = runs.filter(run=>run.name===name);
    const worst = set.reduce((a,b) => (order.get(b.cold.verdict)??3) > (order.get(a.cold.verdict)??3) ||
      b.cold.verdict===a.cold.verdict && (b.cold.overall?.worst??Infinity)>(a.cold.overall?.worst??Infinity) ? b : a);
    const data = worst.cold, m = data.overall?.metrics;
    const counts = workloadCounts(set.flatMap(run => [run.cold,run.warm]));
    const calibrationStatus = worst.profile.calibrated ? '' : ' (CPU provisional)';
    return `| ${name} | ${worst.profile.floor} | ${show(m?.fps)} | ${show(m?.p50)} | ${show(m?.p95)} | ${show(m?.max)} | ${show(m?.spikesPerMinute)} | — | ${show(counts.trianglesP95)} | ${show(counts.drawsP95)} | ${show(counts.programsMax)} | ${show(counts.linksAfterControl)} | ${data.worstSegment ?? '—'} | ${data.verdict}${calibrationStatus} |`;
  });
  return [heading,'|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|',...rows].join('\n');
}

/** @typedef {import('../memory/iphone/route.mjs').RouteLeg} RouteLeg */
/** @typedef {{profile:ProfileSpec & {cpu:number, floor:number}, base:string, zone:string, build:string,
 * fingerprint:string, output:string, id:string, interval:RouteLeg, route?:RouteLeg[], approach:RouteLeg[], warm:boolean, passBreakdown?:boolean}} Job */

/** @param {Job} job */
async function worker(job) {
  if (existsSync(marker)) return 3;
  if (gpuBusy()) return 75;
  if (readCell(job.output, job.fingerprint, job.build, { ...job, floor:job.profile.floor }) !== null) return 0;
  const stop = new AbortController();
  const interrupt = () => stop.abort(new Error('measurement interrupted'));
  const playing = setInterval(() => { if (existsSync(marker)) interrupt(); },150);
  process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
  try {
    const {measureFps} = await import('./measure.mjs');
    const report = await measureFps(job.profile, {base:job.base, zone:job.zone, route:job.route ?? [job.interval],
      approach:job.approach, passBreakdown:job.passBreakdown===true, signal:AbortSignal.any([stop.signal, AbortSignal.timeout(240_000)]), warm:job.warm});
    if (stop.signal.aborted) return 3;
    atomicJson(job.output, {fingerprint:job.fingerprint, id:job.id, report});
    if (readCell(job.output, job.fingerprint, job.build, { ...job, floor:job.profile.floor }) !== null) return 0;
    console.error(cellError(report));
    return playerDied(report) ? PLAYER_DIED : 3;
  } finally { clearInterval(playing); process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt); }
}

/** @param {Job|Job[]} job @param {AbortSignal} signal */
async function measureCell(job, signal) {
  for (;;) {
    // Join the kernel queue even while another measurement owns the GPU.
    // The worker checks for unrelated GPU users after acquiring this lease.
    signal.throwIfAborted();
    const child = spawn('/usr/bin/lockf',[...gpuLock,join(root,'src/scripts/browser-lane.sh'),'--max',Array.isArray(job) ? '9' : '5',
      process.execPath,import.meta.filename,Array.isArray(job) ? '--worker-batch' : '--worker',JSON.stringify(job)],{stdio:'inherit',detached:true,
      env:{...process.env,BROWSER_LANE_WAIT_SECONDS:'30'}});
    const stop = () => {
      try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM'); }
      catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ESRCH') throw error;
      }
    };
    signal.addEventListener('abort',stop,{once:true});
    const [status] = await once(child,'exit').finally(() => signal.removeEventListener('abort',stop));
    signal.throwIfAborted();
    if (status !== 75) return status;
    await sleep(2000, undefined, {signal});
  }
}

async function main() {
  const started = Date.now();
  const zone = choices.zone;
  if (zone !== 'driftwood-isle') throw new Error('DF2 defines a route for driftwood-isle');
  const selected = choices.profiles.split(',');
  const passBreakdown = choices['pass-breakdown'] === true;
  if (passBreakdown && !passBreakdownAllowed(selected, {dockOnly:choices['dock-only'], coldOnly:choices['cold-only']})) {
    throw new Error('Pass breakdown needs desktop profiles with --dock-only --cold-only');
  }
  if (passBreakdown && !choices['dry-run']) requirePassBench(process.env.WS_BENCH);
  if (!Number.isSafeInteger(count)||count<1||new Set(selected).size!==selected.length||selected.some(p=>!keys.includes(p)))
    throw new Error('Use a positive run count and a unique list of known profiles');
  const base = new URL(choices.base).href;
  const host = choices['dry-run'] && process.platform !== 'darwin' ? 'dry-run' : model();
  const factors = calibration.hosts[host]?.factors ?? {};
  const rates = choices['cpu-rates']?.split(',').map(Number);
  if (rates && (selected.length !== 1 || new Set(rates).size !== rates.length ||
    rates.some(rate => !Number.isFinite(rate) || rate < 1 || rate > 8))) throw new Error('Use unique CPU rates from 1 to 8 for one profile');
  const caps = readCaps(root);
  /** @type {Record<string,boolean|number|string>} */
  const device = {};
  for (const pair of choices.device?.split(',').filter(Boolean) ?? []) {
    const at = pair.indexOf('='), raw = pair.slice(at + 1);
    if (at < 1) throw new Error(`Use --device key=value,...: ${pair}`);
    device[pair.slice(0, at)] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  const plan = selected.flatMap(name => profiles[name].flatMap(spec => {
    const cap = capFor(caps, `fps/${name}/${zone}`), floor = cap?.hard;
    if (cap?.kind !== 'floor' || typeof floor !== 'number') throw new Error(`Missing FPS floor for ${name}`);
    const cpu = spec.factor === null ? 1 : factors[spec.factor]?.factor ?? (spec.factor === 'desktopTypical' ? 2 : 1);
    if (!Number.isFinite(cpu) || cpu < 1) throw new Error(`Invalid CPU factor for ${name}`);
    const calibrated = spec.factor===null || spec.factor==='desktopTypical' || factors[spec.factor]?.qualified===true;
    return (rates ?? [cpu]).map(rate => ({ name, profile:{...spec,cpu:rate,floor,calibrated:rates===undefined && calibrated,
      ...(Object.keys(device).length > 0 ? {device} : {})} }));
  }));
  if (choices['dry-run']) { console.log(JSON.stringify({mode:sampling.mode,zone,base,host,count,plan,route,warm:sampling.warm},null,2)); return 0; }
  if (existsSync(marker)) throw new Error('Jake is playing');
  const version = await agentFetch(new URL('/version.json',base),{signal:AbortSignal.timeout(10_000)});
  const {build} = await version.json();
  if (!version.ok || typeof build !== 'string' || build === '') throw new Error('The served build could not be pinned');
  const source = ['fps/table.mjs','fps/plan.mjs','fps/batch.mjs','fps/matrix.mjs','fps/measure.mjs','fps/workload.mjs',...(passBreakdown?['fps/passes.mjs']:[]),'fps/verdict.mjs','memory/iphone/route.mjs']
    .map(file => readFileSync(join(root,'src/scripts',file),'utf8'));
  const config = {mode:sampling.mode,build,host,base,zone,count,plan,route,warm:sampling.warm,...(passBreakdown?{passBreakdown}:{}),method:signature(source)};
  const fingerprint = signature(config);
  let out = resolve(choices.out ?? join(root,'tmp/driftwood-fps',fingerprint.slice(0,16)));
  mkdirSync(out,{recursive:true}); mkdirSync(lockRoot(),{recursive:true});
  if (sampling.mode === 'quick' && choices.out === undefined) out = mkdtempSync(join(out,'quick-'));
  openResume(out,fingerprint,config);
  console.error(`Build ${build}, resume ${out}`);

  const stop = new AbortController();
  const interrupt = () => stop.abort(new Error('measurement interrupted or Jake is playing'));
  const timer = sampling.limitMs === null ? null : setTimeout(() => stop.abort(new Error('quick table exceeded 20 minutes')),
    Math.max(1,sampling.limitMs-(Date.now()-started)));
  const playing = setInterval(() => { if (existsSync(marker)) interrupt(); },150);
  process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
  const runs = plan.flatMap(({name,profile},i) => Array.from({length:count},(_,rep) =>
    ({name,profile,i,rep:rep+1,warm:config.warm && rep+1===count})));
  const groups = runs.map(run => (sampling.mode === 'quick' ? [route[0]] : route).map((interval,j) => {
    const id = `${run.i+1}-${run.rep}-${j+1}`;
    // Get to the same starting waypoint on foot. Sample only the assigned leg.
    const approach = route.slice(0,j).filter(leg => leg.kind === 'walk').map(({dwell:_dwell,...leg}) => leg);
    return { id, interval, route:sampling.mode === 'quick' ? route : undefined, approach, profile:run.profile, floor:run.profile.floor, warm:run.warm, passBreakdown,
      output:cellPath(out,id), build, base, zone, fingerprint };
  }));
  let resumedCells = 0, died = /** @type {string|null} */ (null);
  /** @type {{id:string, failedAttempt:string}[]} */
  const coldBootRetries = [];
  try {
    if (sampling.mode === 'quick') {
      // A short table queues once. Each worker still opens and closes its own browser.
      const pending = groups.flat().filter(job => {
        if (readCell(job.output,fingerprint,build,job) === null) return true;
        resumedCells++; return false;
      });
      // Five 95-second routes leave 65 seconds for cold boots inside one
      // nine-minute capture watchdog. Slow boots still fail within the caps.
      if (pending.length > 0) await measureCell(pending,stop.signal);
      // Retry once only if control never started and no route frames exist.
      // Preserve the failed cold boot before a fresh browser replaces its cell.
      const retry = pending.filter(job => {
        if (!existsSync(job.output) || readCell(job.output,fingerprint,build,job) !== null) return false;
        const failed = JSON.parse(readFileSync(job.output,'utf8'));
        if (!retryColdBoot(failed.report)) return false;
        const failedAttempt = `cell-${job.id}-boot-attempt-1.json`;
        atomicJson(join(out,failedAttempt),failed);
        coldBootRetries.push({id:job.id,failedAttempt});
        return true;
      });
      if (retry.length > 0) await measureCell(retry,stop.signal);
    } else {
      for (let rep=0; rep<count && died === null; rep++) {
        for (let i=rep; i<groups.length && died === null; i+=count) for (const job of groups[i]) {
          stop.signal.throwIfAborted();
          if (readCell(job.output,fingerprint,build,job) !== null) { resumedCells++; continue; }
          const status = await measureCell(job,stop.signal);
          console.error(`${job.id} ${job.interval.name}: ${status === 0 ? 'recorded' : status === PLAYER_DIED ? 'the player died' : 'incomplete'}`);
          // DF15: the world, not the build, ended this cell; the caller restarts the world and resumes from it
          if (status === PLAYER_DIED && choices['stop-on-death']) { died = job.id; break; }
        }
      }
    }
  } catch (error) {
    if (!stop.signal.aborted) throw error;
    console.error(stop.signal.reason.message);
  } finally {
    if (timer !== null) clearTimeout(timer);
    clearInterval(playing); process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt);
  }
  let completed = 0;
  const measured = runs.map(({name,profile,rep,warm},idx) => {
    const cells = groups[idx].map(job => readCell(job.output,fingerprint,build,job));
    completed += cells.filter(cell => cell !== null).length;
    return { name,profile,rep,cold:sampling.mode === 'quick' && cells[0] ? cells[0].cold : assembleCapture(cells.map(cell => cell?.cold),route,profile.floor),
      warm:warm ? assembleCapture(cells.map(cell => cell?.warm),route,profile.floor) : null };
  });
  const progress = {completed,total:groups.reduce((sum,group) => sum+group.length,0)};
  const scope = sampling.scope === 'dock' ? 'dock only' : sampling.mode === 'quick' ? 'quick: dock, beach, village' : sampling.scope === 'subset' ? 'qualification diagnostic: reduced windows' : 'qualification: full route';
  const markdown = [`## Driftwood FPS (${scope})`, '',table(measured),'',
    `Build ${build} · ${progress.completed}/${progress.total} measurement cells. ${sampling.mode === 'quick' ? 'One fresh boot per profile; consecutive dock/beach/village legs. Development sample only; use --qualify for nightly and DF15.' : 'Each leg starts from a fresh boot and an on-foot approach.'}`,
    `Pre-control cold boot retries: ${coldBootRetries.length} (failed reports preserved; wall clock unchanged).`,
    'Phone GPU estimates await DF5.'].join('\n');
  writeFileSync(join(out,'table.md'),`${markdown}\n`);
  atomicJson(join(out,'table.json'),{schema:1,mode:sampling.mode,host,base,zone,scope:sampling.scope,
    seconds:(Date.now()-started)/1000,fresh:resumedCells===0,resumedCells,coldBootRetries,progress,runs:measured});
  console.log(markdown);
  if (died !== null) { console.error(`${died}: the player died; stopping for a fresh world (--stop-on-death)`); return PLAYER_DIED; }
  if (stop.signal.aborted || measured.some(run=>run.cold.verdict==='incomplete'||run.warm?.verdict==='incomplete')) return 3;
  if (measured.some(run=>run.cold.verdict==='miss')) return 2;
  return measured.every(run=>run.profile.calibrated) ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (choices['worker-batch']) {
      let interrupted = false;
      const stop = () => { interrupted = true; };
      process.once('SIGINT',stop); process.once('SIGTERM',stop);
      try {
        process.exitCode = await runBatch(/** @type {Job[]} */ (JSON.parse(choices['worker-batch'])),worker,
          (job,status) => console.error(`${job.id} ${job.interval.name}: ${status === 0 ? 'recorded' : 'incomplete'}`),
          () => interrupted || existsSync(marker));
      } finally { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); }
    } else process.exitCode = choices.worker ? await worker(JSON.parse(choices.worker)) : await main();
  }
  catch (error) { console.error(error); process.exitCode = 3; }
}
