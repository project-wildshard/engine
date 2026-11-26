/** Harness-only rAF driver: one 30 Hz timestamp per callback batch, scheduled by GPU/task throughput.
 * Native rAF remains the idle scheduler; the driver never changes the game's capture dt or input steps.
 * @param {{accelerated:boolean,timerHz?:number}} opts */
export function installFrameDriver(opts) {
  if (!opts.accelerated) return;
  const w = /** @type {Window} */ (window);
  const control = window.__parity, nativeRAF = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
  const channel = new MessageChannel(), callbacks = new Map(), observers = new Set();
  let ready = false, nextId = -1, timestamp = performance.now(), nativeId = 0, posted = false, waiting = 0;
  const realNow = performance.now.bind(performance), timeout = window.setTimeout.bind(window), interval = window.setInterval.bind(window);
  const clearTimeout = window.clearTimeout.bind(window), clearInterval = window.clearInterval.bind(window);
  /** @type {Map<number,{run:()=>void,due:number,repeat:number,native:number}>} */ const timers = new Map();
  let nextTimer = -1, virtualNow = realNow();
  const timerStep = 1000 / (opts.timerHz ?? 30);
  control.now = realNow;
  /** @param {TimerHandler} handler @param {number|undefined} delay @param {unknown[]} args @param {boolean} repeat */
  const scheduleTimer = (handler, delay, args, repeat) => {
    if (typeof handler !== 'function' || !(Number(delay) > 0)) return repeat ? interval(handler, delay, ...args) : timeout(handler, delay, ...args);
    const id = nextTimer--, duration = Number(delay), run = () => { const current = timers.get(id); if (!repeat) timers.delete(id); else if (!ready && current) current.due = realNow() + duration; Reflect.apply(handler, window, args); };
    const entry = { run, due: (ready ? virtualNow : realNow()) + duration, repeat: repeat ? duration : 0, native: 0 };
    timers.set(id, entry);
    if (!ready) entry.native = repeat ? interval(run, duration) : timeout(run, duration);
    return id;
  };
  w.setTimeout = (handler, delay, ...args) => scheduleTimer(handler, delay, args, false);
  w.setInterval = (handler, delay, ...args) => scheduleTimer(handler, delay, args, true);
  /** @param {number} id */
  const cancelTimer = (id) => { const entry = timers.get(id); if (entry) { clearTimeout(entry.native); clearInterval(entry.native); timers.delete(id); } else { clearTimeout(id); clearInterval(id); } };
  w.clearTimeout = (id) => { if (id !== undefined) cancelTimer(id); };
  w.clearInterval = (id) => { if (id !== undefined) cancelTimer(id); };
  /** @type {(() => void)|undefined} */ let finish;
  const active = () => ready && (control.free || control.remaining > 0 || waiting > 0);
  const wake = () => {
    if (callbacks.size === 0) return;
    if (active()) {
      if (nativeId) { nativeCancel(nativeId); nativeId = 0; }
      if (!posted) { posted = true; channel.port2.postMessage(null); }
    } else if (!nativeId && !posted) nativeId = nativeRAF(tick);
  };
  function tick() {
    posted = false; nativeId = 0;
    if (active()) virtualNow += timerStep;
    timestamp = Math.max(timestamp + 1000 / 30, realNow());
    // Unload clears the live world before the engine-scope census RAFs finish.
    // Observe availability without requiring or retaining the retired level.
    const drawn=()=>{if(!ready)return 0;const world=window.__wildshard.world;return world?Number(Reflect.get(world.game,'frameNo')):0;}, before=drawn();
    const batch = [...callbacks]; callbacks.clear();
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- rAF callbacks are the browser API being driven, not promise continuations.
    for (const [, callback] of batch) { const start=realNow(); callback(timestamp); if(control.on)control.cpu+=realNow()-start; }
    // Timers advance with the same 30 Hz capture trajectory; zero-delay task/network barriers stay native.
    for (const [id, timer] of timers) if (timer.due <= virtualNow && timers.has(id)) {
      if (timer.repeat) timer.due += timer.repeat;
      timer.run();
    }
    if(drawn()!==before)for (const observer of observers) observer();
    if (waiting > 0 && --waiting === 0) { finish?.(); finish = undefined; }
    wake();
  }
  channel.port1.onmessage = tick;
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the browser rAF API while scheduling fixed capture frames.
  window.requestAnimationFrame = (callback) => { const id = nextId--; callbacks.set(id, callback); wake(); return id; };
  window.cancelAnimationFrame = (id) => { if (id < 0) callbacks.delete(id); else nativeCancel(id); };
  control.observe = (fn) => { observers.add(fn); return () => { observers.delete(fn); }; };
  control.wait = async (frames) => {
    if (!Number.isInteger(frames) || frames < 0 || waiting > 0) throw new Error('invalid concurrent frame wait');
    if (frames === 0) return;
    waiting = frames; await new Promise((resolve) => { finish = () => resolve(undefined); wake(); });
  };
  const onReady = () => {
    if (window.__wildshard?.world === undefined) return;
    document.removeEventListener('ws:ready', onReady);
    ready = true;
    virtualNow = realNow();
    for (const timer of timers.values()) { clearTimeout(timer.native); clearInterval(timer.native); timer.native = 0; }
    performance.now = () => virtualNow;
    control.advance = async (frames) => {
      if (!Number.isInteger(frames) || frames < 0 || control.remaining > 0 || control.free) throw new Error('invalid concurrent frame advance');
      if (frames === 0) return;
      const game = window.__wildshard.requireWorld().game, end = game.frameCount + frames;
      control.remaining = frames;
      await new Promise((resolve) => {
        const check = () => { if (game.frameCount >= end) { observers.delete(check); resolve(undefined); } };
        observers.add(check); wake();
      });
    };
    wake();
  };
  document.addEventListener('ws:ready', onReady);
}
