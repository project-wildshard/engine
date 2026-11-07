// A phone link in virtual time (E525). Models Chromium's DevTools network
// emulation, which is what scripts/phone-loading measures: every request waits
// `latencyMs` before its first byte, then all active responses share
// `downBps` equally (processor sharing). An optional connection cap models
// HTTP/1.1 (6 per origin); HTTP/2 and HTTP/3 multiplex (no cap).
//
// Time is virtual: a transfer resolves when the simulated clock reaches its
// end, and the clock only moves when the JS event loop is idle. So the real
// boot code (src/client/game/boot/spawnDownload.ts) runs against it in milliseconds
// and its download time is exact for the model, with no wall-clock noise.

/**
 * @typedef {{ downBps: number, latencyMs: number, maxConns?: number, serverMs?: number }} LinkOptions
 * @typedef {{ id: number, bytes: number, readyAt: number, remaining: number, resolve: (at: number) => void, label: string }} Transfer
 */

export const PRESETS = {
  // scripts/phone-loading/model.ts `phone`: 10 Mb/s down, 100 ms latency
  phone: { downBps: 1_250_000, latencyMs: 100 },
  // Jake's real phone on decent LTE / 5G: indicative only
  lte: { downBps: 5_000_000, latencyMs: 50 },
  fast5g: { downBps: 12_500_000, latencyMs: 30 },
};

/** @param {LinkOptions} options */
export function createLink(options) {
  const downBps = options.downBps, latency = options.latencyMs + (options.serverMs ?? 0);
  const maxConns = options.maxConns ?? Infinity;
  let now = 0, nextId = 0, bytesDone = 0, requests = 0;
  /** @type {Transfer[]} */ const waiting = []; // queued for a connection
  /** @type {Transfer[]} */ const latent = []; // in their latency window
  /** @type {Transfer[]} */ const active = []; // sharing the pipe
  /** @type {{ t: number, fn: () => void }[]} */ const timers = [];
  const inFlight = () => latent.length + active.length;
  const admit = () => {
    while (waiting.length > 0 && inFlight() < maxConns) {
      const t = /** @type {Transfer} */ (waiting.shift());
      t.readyAt = now + latency; latent.push(t);
    }
  };
  /** Advance to the next event; false when nothing is scheduled. */
  const step = () => {
    let next = Infinity;
    for (const t of latent) next = Math.min(next, t.readyAt);
    const share = active.length > 0 ? downBps / active.length / 1000 : 0; // bytes per ms each
    for (const t of active) next = Math.min(next, now + t.remaining / share);
    for (const timer of timers) next = Math.min(next, timer.t);
    if (next === Infinity) return false;
    const dt = Math.max(0, next - now);
    // the transfer(s) that define `next` finish exactly (float time can swallow a tiny dt at large `now`)
    for (const t of active) t.remaining = now + t.remaining / share <= next ? 0 : t.remaining - dt * share;
    now = next;
    for (let i = timers.length - 1; i >= 0; i--) {
      const timer = timers[i];
      if (timer !== undefined && timer.t <= now + 1e-9) { timers.splice(i, 1); timer.fn(); }
    }
    for (let i = latent.length - 1; i >= 0; i--) {
      const t = latent[i];
      if (t !== undefined && t.readyAt <= now + 1e-9) { latent.splice(i, 1); active.push(t); }
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const t = active[i];
      if (t !== undefined && t.remaining <= 1e-6) { active.splice(i, 1); bytesDone += t.bytes; t.resolve(now); }
    }
    admit();
    return true;
  };
  return {
    get now() { return now; },
    get stats() { return { bytes: bytesDone, requests }; },
    /** A transfer of `bytes` wire bytes; resolves with its virtual end time. */
    transfer(/** @type {number} */ bytes, label = '') {
      requests++;
      return new Promise(resolve => {
        // a zero-byte answer still pays its latency; it never holds the pipe
        waiting.push({ id: nextId++, bytes, readyAt: 0, remaining: Math.max(bytes, 1e-3), resolve, label });
        admit();
      });
    },
    /** Virtual CPU or think time: resolves after `ms` of simulated time. */
    delay(/** @type {number} */ ms) { return new Promise(resolve => { timers.push({ t: now + Math.max(0, ms), fn: () => resolve(now) }); }); },
    /** Run `work` to completion, moving the clock whenever the event loop is idle. */
    async run(/** @type {() => Promise<unknown>} */ work) {
      const state = { settled: false, failed: false, failure: /** @type {unknown} */ (undefined), value: /** @type {unknown} */ (undefined) };
      const done = work().then(v => { state.value = v; state.settled = true; return v; })
        .catch((/** @type {unknown} */ e) => { state.failure = e; state.failed = true; state.settled = true; return undefined; });
      let idleTicks = 0;
      for (;;) {
        // drain microtasks and I/O callbacks (a dynamic import is real I/O)
        await new Promise(resolve => { setImmediate(resolve); });
        if (state.settled) break;
        if (step()) { idleTicks = 0; continue; }
        if (++idleTicks > 20000) throw new Error('virtual link: work is stuck with nothing scheduled');
        await new Promise(resolve => { setTimeout(resolve, 1); });
      }
      await done;
      if (state.failed) throw state.failure instanceof Error ? state.failure : new Error(String(state.failure));
      return { value: state.value, ms: now };
    },
  };
}
