// meta DRIFTWOOD-FPS DF8 / IPHONE13-DRIFTWOOD DW3 (mini-driftwood13n, 2026-11-20): was a long phone frame waiting on the GPU
// or on the collector? On the iPhone 13 the dock's long frames after the reveal hold the main thread with no page callback
// ("held"), Safari's Heap agent stamps every collection with one time (iOS 18.6.2), and an xctrace of every process takes
// longer to save than a 10-minute phone hold. So the page answers both itself, cheaply:
// - a WebGL2 fence after each renderer.render, polled at the next animation frames (a fence's status changes only between
//   tasks): how many frames the GPU took to finish that frame's commands, and how long the status call itself took (it is a
//   synchronous call into Safari's GPU process, so a backed-up GPU process makes it slow);
// - a full-collection sentinel: an object held strongly for 3 s (it outlives many eden collections, so it is old), then only
//   behind a WeakRef. Eden collections never take an old object, so the WeakRef emptying means a full collection ran between
//   two frames.
// route-bench.mjs --gpu-fence evaluates GPU_FENCE_START beside the frame log and prints, for each frame over 50 ms, the
// fence waits and full collections in it (fenceFrames).

/** In the page (a WebDriver body): start the fences and the sentinel. */
export const GPU_FENCE_START = `
const g = window.__wildshard?.world?.game, r = g?.renderer;
if (r === undefined) return 'no game';
const gl = r.getContext();
if (typeof gl.fenceSync !== 'function') return 'no WebGL2';
const log = (window.__wsGpuFence = { fences: [], full: [], arms: 0 });
const pending = [];
const render = r.render;
r.render = function (...args) { const out = render.apply(this, args);
  try { if (pending.length < 16) { const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); if (sync) pending.push([performance.now(), sync, 0, 0]); } } catch {}
  return out; };
const aging = []; let armed = null, last = performance.now();
const tick = (now) => { if (window.__wsGpuFence !== log) { for (const p of pending) try { gl.deleteSync(p[1]); } catch {} return; }
  for (let i = 0; i < pending.length; i++) { const p = pending[i], t = performance.now();
    let status; try { status = gl.getSyncParameter(p[1], gl.SYNC_STATUS); } catch { status = gl.SIGNALED; }
    const ms = performance.now() - t; if (ms > p[3]) p[3] = ms; p[2]++;
    if (status === gl.SIGNALED) { if (log.fences.length < 6000) log.fences.push([Math.round(p[0]), Math.round(now), p[2], Math.round(p[3] * 10) / 10]);
      try { gl.deleteSync(p[1]); } catch {} pending.splice(i, 1); i--; } }
  if (aging.length === 0 || now - aging[aging.length - 1][0] >= 500) aging.push([now, { sentinel: [now] }]);
  while (aging.length > 0 && now - aging[0][0] >= 3000) { const a = aging.shift(); if (armed === null) { armed = new WeakRef(a[1]); log.arms++; } }
  if (armed !== null && armed.deref() === undefined) { if (log.full.length < 2000) log.full.push([Math.round(last), Math.round(now)]); armed = null; }
  last = now; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
return 'fencing';
`;

/** In the page: GPU_FENCE_START's log ({ fences: [issued page ms, seen signaled page ms, frames waited, slowest status call
 * ms], full: [frame before, frame after] for each full collection, arms }), and stop. */
export const GPU_FENCE_READ = `
const log = window.__wsGpuFence ?? null; window.__wsGpuFence = undefined; return log;
`;

/**
 * For each long frame ({ at, ms } on the page clock, nameLongFrames' rows): the fences issued in it or in the 40 ms before
 * it (the frame before's render), their frames waited and slowest status call, and the full collections overlapping it.
 * `gpu` is true when such a fence waited 3 frames or more (the first poll can fall in the frame that issued it, whose
 * status cannot change yet) or a status call took 8 ms or more. Pure.
 * @param {{ at: number, ms: number }[]} named
 * @param {{ fences?: [number, number, number, number][], full?: [number, number][] } | null} log
 * @returns {{ at: number, fences: [number, number, number][], full: number, gpu: boolean }[]}
 */
export function fenceFrames(named, log) {
  return named.map((n) => {
    const start = n.at - n.ms, end = n.at;
    /** @type {[number, number, number][]} */
    const fences = [];
    for (const [issued, seen, waited, call] of log?.fences ?? []) if (issued >= start - 40 && issued < end) fences.push([Math.round(seen - issued), waited, call]);
    const full = (log?.full ?? []).filter(([a, b]) => a < end && b > start).length;
    return { at: n.at, fences, full, gpu: fences.some(([, waited, call]) => waited >= 3 || call >= 8) };
  });
}

/** Every fence's frames waited, as { waited: count }, the baseline a long frame's fences are read against. Pure.
 * @param {{ fences?: [number, number, number, number][] } | null} log @returns {Record<string, number>} */
export function fenceWaits(log) {
  /** @type {Record<string, number>} */ const out = {};
  for (const fence of log?.fences ?? []) { const waited = String(fence[2]); out[waited] = (out[waited] ?? 0) + 1; }
  return out;
}
