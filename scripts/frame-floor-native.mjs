// Native memory is opt-in and separate from the timing floor. No GL observer,
// heap collection, Inspector profiler or guessed RAM costs supply these reads.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const floorNativeExpression = `(() => {
  const api = window.__wildshard, read = api && Object.getOwnPropertyDescriptor(api, 'memory')?.value;
  if (typeof read !== 'function') return null;
  const memory = read.call(api), grid = api.shard?.grid?.state(), live = grid?.live?.live;
  return { at: Date.now(), origin: performance.timeOrigin,
    memory: { totals: memory.totals, unattributed: memory.unattributed, allocations: memory.allocations.filter(row => row.domain === 'gpu') },
    phase: grid === undefined
      ? api.world?.hud.entered && !api.world.hud.paused && api.world.game.frameGate() ? 'playing' : 'loading'
      : live?.gameplayReady && live.pending.length === 0 && grid.live.crossing.phase === 'settled' ? 'playing' : 'loading',
    current: live?.current ?? null, residents: [...(live?.residents ?? [])],
    pending: [...(live?.pending ?? [])] };
})()`;

/** Collect the existing scalar GPU ledger alongside native kernel interval highs.
 * Phase peaks use native maximum + GPU maximum (a conservative upper envelope,
 * not a claim those two maxima occurred simultaneously). Raw logs stay scratch.
 */
export function startFloorNative(root, directory, device, read, interrupt, quiet = false) {
  const phase = join(directory, 'native.phase'), file = join(directory, 'native.jsonl');
  writeFileSync(phase, 'measure', { flag: 'wx' });
  const sampler = spawn('python3', [join(root, 'scripts/sim-mem-phases.py'), '--device', device,
    '--phase-file', phase, '--out', file, '--max', '590', '--sample-interval-high', '--process-identities'], { stdio: 'ignore' });
  const done = new Promise((resolve, reject) => { sampler.once('error', reject); sampler.once('close', code => { resolve(code); }); });
  const controller = new AbortController();
  const gpu = [], errors = [];
  let peakGpu = -1;
  const accept = row => {
    if (controller.signal.aborted || row === null || row === undefined) return;
    if (row.memory.totals.gpu <= peakGpu) row.memory.allocations = [];
    else peakGpu = row.memory.totals.gpu;
    gpu.push(row);
  };
  let interrupted;
  const abort = reason => { interrupted = reason; controller.abort(); interrupt(); };
  const expires = setTimeout(() => { abort('Native memory window exhausted'); }, 570_000);
  const terminate = () => { abort('Native sample terminated'); sampler.kill('SIGTERM'); process.exitCode = 143; };
  process.once('SIGTERM', terminate);
  const observing = (async () => {
    while (!controller.signal.aborted) {
      try { accept(await read(floorNativeExpression)); }
      catch (error) { errors.push({ at: Date.now(), error: String(error) }); }
      await sleep(500);
    }
  })();
  return async () => {
    controller.abort(); clearTimeout(expires);
    writeFileSync(phase, 'done');
    const code = await done;
    await observing;
    process.removeListener('SIGTERM', terminate);
    // Read completed scalar spans only after sampling; no profiler or scene walk.
    let preparation = [], preparationError;
    try { preparation = await read(`performance.getEntriesByType('measure').filter(row => row.name.startsWith('wildshard.prepare:')).map(({name,startTime,duration}) => ({name,startTime,duration}))`); }
    catch (error) { preparationError = String(error); }
    writeFileSync(join(directory, 'gpu.json'), JSON.stringify({ gpu, errors, preparation, preparationError }));
    const native = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    if (interrupted !== undefined) throw new Error(interrupted);
    return gradeFloorNative(native, gpu, errors, code, quiet);
  };
}

/** Refuse missing phases/processes; keep native highs separate from GPU allocation capacity.
 * @param {Array<{type:string,phase:string,t:string,interval:number,pids:Record<string,number[]>}>} native
 * @param {Array<{at:number,phase:'loading'|'playing',memory:{totals:{gpu:number},unattributed:{gpu:number},allocations:Array<{domain:string,owner:string,asset:string,bytes:number}>}}>} gpu
 * @param {Array<{at:number,error:string}>} errors
 * @param {number|null} code
 * @param {boolean} quiet
 */
export function gradeFloorNative(native, gpu, errors = [], code = 0, quiet = false) {
    const samples = native.filter(row => row.type === 'sample' && row.phase === 'measure');
    if (code !== 0 || samples.length === 0 || gpu.length === 0) throw new Error('Missing native/GPU samples');
    // The game is the largest WebContent process at the final playing witness.
    // All process overlap remains conservatively charged while loading.
    const playing = gpu.filter(row => row.phase === 'playing');
    if (playing.length === 0) throw new Error('No playing GPU witness');
    const playingAt = playing[0].at;
    const last = samples.at(-1), pids = Object.entries(last.pids).sort((a, b) => b[1][0] - a[1][0]);
    const gamePid = pids.at(0)?.[0];
    if (gamePid === undefined) throw new Error('No native game WebContent PID');
    const gpuPeak = gpu.reduce((best, row) => row.memory.totals.gpu > (best?.memory.totals.gpu ?? -1) ? row : best, null);
    if (!(gpuPeak.memory.totals.gpu > 0)) throw new Error('Missing GPU allocations');
    const peaks = { playing: 0, loading: 0 }, counts = { playing: 0, loading: 0 };
    for (const row of samples) {
      const at = Date.parse(row.t);
      // Like the continuous soak, travel/preparation after first readiness is
      // playing. A blocked Inspector must not move a playing peak to loading.
      const phaseName = at < playingAt ? 'loading' : 'playing';
      const bytes = phaseName === 'loading' ? row.interval : Math.max(...(row.pids[gamePid] ?? [0]));
      if (!(bytes > 0)) throw new Error('Game WebContent disappeared during playing');
      peaks[phaseName] = Math.max(peaks[phaseName], bytes); counts[phaseName]++;
    }
    if (counts.playing < 3 || counts.loading < 3) throw new Error('Incomplete native phase coverage');
    const labelled = gpuPeak.memory.allocations.filter(row => row.domain === 'gpu');
    return { measurement: 'native-footprint+gpu', quiet, timingCredit: false, samples: samples.length, gamePid: Number(gamePid),
      playingPeakBytes: peaks.playing + gpuPeak.memory.totals.gpu,
      loadingPeakBytes: peaks.loading + gpuPeak.memory.totals.gpu,
      nativePeakBytes: peaks, phaseSamples: counts, gpuPeakBytes: gpuPeak.memory.totals.gpu,
      gpuUnattributedBytes: gpuPeak.memory.unattributed.gpu,
      gpuPeakAllocations: labelled, gpuSamples: gpu.length, inspectorErrors: errors,
      policy: 'Memory only; quiet records the caller window. Conservative phase native interval maximum plus global GPU ledger maximum; GPU process footprint excluded. Playing includes all travel/preparation after first ready witness, even during Inspector gaps. Simulator regression evidence, not physical-phone clearance.' };
}
