// Production entry: no query parameters or configuration controls. Caps come from the build's shared cost model.
import { runRig } from './core.js';
import { API_ORIGIN, BUILD, CFG } from './config.js';

const status = document.getElementById('status'), back = document.getElementById('return');
const series = crypto.randomUUID();
let iteration = 1, install = series;
try {
  install = localStorage.getItem('crossroads.install') ?? series;
  localStorage.setItem('crossroads.install', install);
} catch { /* A storage-restricted browser still sends this anonymous run. */ }
const context = { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  origin: location.protocol === 'https:' && location.hostname !== 'localhost' ? 'hosted' : 'local' };
const base = { kind: 'crossroads', rigVersion: 1, build: BUILD, install, series, context, config: CFG };
async function send(stage, stats, summary) {
  const run = stage === 'summary' ? `${series}/summary` : `${series}/${iteration}`;
  const body = JSON.stringify({ ...base, run, iteration: stage === 'summary' ? 0 : iteration, stage, stats, summary });
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${API_ORIGIN}/api/telemetry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
      if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`);
      const receipt = await response.json();
      window.__crossroadsReceipt = { stage, run, ...receipt };
      return true;
    } catch (failure) { error = String(failure); await new Promise((resolve) => { setTimeout(resolve, 1000); }); }
  }
  window.__crossroadsPostError = error;
  if (stage !== 'started') try {
    const prior = JSON.parse(localStorage.getItem('crossroads.pending') ?? '[]');
    const pending = Array.isArray(prior) ? prior.slice(-5) : [];
    pending.push(JSON.parse(body)); localStorage.setItem('crossroads.pending', JSON.stringify(pending));
  } catch { /* The visible result still reports a failed save. */ }
  return false;
}
window.addEventListener('pagehide', () => {
  if (!window.__crossroadsDone) navigator.sendBeacon(`${API_ORIGIN}/api/telemetry`, new Blob([JSON.stringify({ ...base, run: `${series}/${iteration}`, iteration, stage: 'interrupted', stats: null })], { type: 'application/json' }));
});
async function main() {
  let saved = true, failed = false;
  window.__crossroadsResults = [];
  for (iteration = 1; iteration <= 3; iteration++) {
    if (status) status.textContent = `Checking memory ${iteration} of 3. The results save automatically.`;
    void send('started');
    const result = await runRig(CFG), stats = result.record;
    const stage = stats.contextLost ? 'context-loss' : stats.error ? 'error' : 'complete';
    const posted = await send(stage, stats);
    saved = posted && saved;
    const overCap = Object.values(stats.accounted).some((row) => row.overCap > 0);
    window.__crossroadsResults.push({ iteration, stage, overCap, posted, receipt: posted ? window.__crossroadsReceipt : null });
    result.dispose();
    if (stage !== 'complete') { failed = true; break; }
  }
  const results = window.__crossroadsResults;
  saved = await send('summary', null, { runs: results.length, completed: results.filter((r) => r.stage === 'complete').length,
    contextLosses: results.filter((r) => r.stage === 'context-loss').length, errors: results.filter((r) => r.stage === 'error').length,
    posted: results.filter((r) => r.posted).length, overCapRuns: results.filter((r) => r.overCap).length }) && saved;
  window.__crossroadsDone = true;
  if (status) status.textContent = saved ? (failed ? 'The check stopped. Its result was saved.' : 'Memory check complete. Results saved.') : 'The result will send automatically when you return to the game.';
  if (back) back.hidden = false;
}
async function start() { try { await main(); } catch (error) {
  await send('error', { error: String(error) });
  const results = window.__crossroadsResults ?? [];
  await send('summary', null, { runs: results.length + 1, completed: results.filter((r) => r.stage === 'complete').length,
    contextLosses: results.filter((r) => r.stage === 'context-loss').length, errors: 1,
    posted: results.filter((r) => r.posted).length, overCapRuns: results.filter((r) => r.overCap).length });
  window.__crossroadsDone = true;
  if (status) status.textContent = 'The check stopped. Return to the game.';
  if (back) back.hidden = false;
  window.__crossroadsPostError = String(error);
} }
void start();
