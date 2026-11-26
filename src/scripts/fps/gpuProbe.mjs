// meta DRIFTWOOD-FPS DF5 (J489, mini-dwfps 2026-11-23): a GPU time the phone's frame cadence cannot clamp.
// The iPhone 13 has no WebGL timer queries and draws Low at a 30 fps cap, so its frame intervals only say "under 33 ms"
// (the cadence audit: 14 of 15 segment p95s were the 34 - 1000/30 ms floor). This fences one real frame in `every`:
// a 1-pixel readPixels drains the GPU first, then the frame's draw runs, then a second readPixels waits for it. ANGLE's
// Metal backend (Safari's GPU process and Chromium's alike) only completes a readPixels once every queued command has run,
// so the second wait is that frame's GPU work left after its CPU submit. Both sides run the same probe, so the phone/Mac
// ratio compares like with like. The phone clock is whole milliseconds, so the summary is a 10% trimmed mean (a floored
// interval's mean is the true mean), with the median beside it.

/**
 * In the page: fence every `every`th frame of `game.frameDrawRanges.draw`. Returns stop(), which restores the draw and
 * returns the summary. Serialized into pages, so it keeps to its own scope.
 * @param {{frameDrawRanges:{draw:(...args:unknown[])=>unknown}, renderer:{getContext:()=>WebGL2RenderingContext}}} game
 * @param {number} every
 */
export function observeFencedGpu(game, every) {
  const ranges = game.frameDrawRanges, gl = game.renderer.getContext();
  const own = Object.hasOwn(ranges, 'draw'), original = ranges.draw;
  /** @type {number[]} */ const cpu = [];
  /** @type {number[]} */ const tail = [];
  /** @type {number[]} */ const drain = [];
  let frame = 0, refused = 0;
  const bytes = new ArrayBuffer(64);
  const fence = () => {
    const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE), format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
    const view = type === gl.FLOAT ? new Float32Array(bytes, 0, 4) : type === gl.HALF_FLOAT ? new Uint16Array(bytes, 0, 4) :
      type === gl.UNSIGNED_INT ? new Uint32Array(bytes, 0, 4) : type === gl.INT ? new Int32Array(bytes, 0, 4) : new Uint8Array(bytes, 0, 4);
    gl.readPixels(0, 0, 1, 1, format, type, view);
    return gl.getError() === gl.NO_ERROR;
  };
  /** @this {unknown} @param {unknown[]} args */
  const draw = function draw(...args) {
    if (++frame % every !== 0) return original.apply(this, args);
    const t0 = performance.now(), drained = fence(), t1 = performance.now();
    try { return original.apply(this, args); }
    finally {
      const t2 = performance.now(), done = fence(), t3 = performance.now();
      if (drained && done) { drain.push(t1 - t0); cpu.push(t2 - t1); tail.push(t3 - t2); } else refused++;
    }
  };
  ranges.draw = draw;
  return () => {
    if (own) ranges.draw = original; else Reflect.deleteProperty(ranges, 'draw');
    const sorted = (/** @type {number[]} */ v) => [...v].sort((a, b) => a - b);
    const round = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
    const median = (/** @type {number[]} */ v) => v.length === 0 ? null : round(sorted(v)[Math.floor((v.length - 1) / 2)]);
    const p95 = (/** @type {number[]} */ v) => v.length === 0 ? null : round(sorted(v)[Math.floor((v.length - 1) * 0.95)]);
    const trimmed = (/** @type {number[]} */ v) => {
      const s = sorted(v), cut = Math.floor(s.length * 0.1), kept = s.slice(cut, s.length - cut);
      return kept.length === 0 ? null : round(kept.reduce((a, b) => a + b, 0) / kept.length);
    };
    return { every, frames: tail.length, refused, tailMeanMs: trimmed(tail), tailP50Ms: median(tail), tailP95Ms: p95(tail),
      cpuMeanMs: trimmed(cpu), drainMeanMs: trimmed(drain) };
  };
}
