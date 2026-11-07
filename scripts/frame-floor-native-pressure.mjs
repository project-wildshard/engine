// Capture-side request counters only. No argument/result is retained, no timer,
// watcher, buffer inspection, GC request or application service is installed.
export function observeNativePressure() {
  const rows = [], support = [], buckets = new Map();
  const state = { origin: performance.timeOrigin, installedAt: performance.now(), rows, buckets, dropped: 0, observerErrors: 0 };
  let active = null;
  const record = (bank, api, at, failed) => {
    try {
      const second = Math.floor(at / 1000), key = `${api}:${second}`;
      let row = bank.buckets.get(key);
      if (row === undefined) {
        if (bank.rows.length >= 2048) { bank.dropped++; return; }
        row = { api, second, firstMs: at, lastMs: at, calls: 0, failed: 0, stack: new Error('Native request site').stack ?? '' };
        bank.buckets.set(key, row); bank.rows.push(row);
      }
      row.calls++; row.failed += failed ? 1 : 0; row.lastMs = at;
    } catch { bank.observerErrors++; }
  };
  const note = (api, at, failed) => {
    record(state, api, at, failed);
    if (active !== null) record(active, api, at, failed);
  };
  const wrap = (owner, key, api, construct = false, largeBuffer = false) => {
    if (owner === undefined || owner === null) { support.push({ api, available: false, wrapped: false }); return; }
    const target = Reflect.get(owner, key), descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (typeof target !== 'function' || descriptor === undefined) { support.push({ api, available: false, wrapped: false }); return; }
    // oxlint-disable-next-line typescript/unbound-method -- native getter is invoked only with Reflect.apply and the returned buffer as receiver
    const getter = largeBuffer ? Object.getOwnPropertyDescriptor(target.prototype, 'byteLength')?.get : undefined;
    if (largeBuffer && typeof getter !== 'function') { support.push({ api, available: true, wrapped: false }); return; }
    const proxy = new Proxy(target, construct ? { construct(native, args, newTarget) {
      const at = performance.now();
      let result;
      try { result = Reflect.construct(native, args, newTarget); }
      catch (error) {
        if (!largeBuffer || typeof args[0] === 'number' && args[0] >= 1048576) note(api, at, true);
        throw error;
      }
      if (largeBuffer) {
        try { if (Reflect.apply(getter, result, []) < 1048576) return result; }
        catch { state.observerErrors++; return result; }
      }
      note(api, at, false); return result;
    } } : { apply(native, receiver, args) {
      const at = performance.now();
      let failed = true;
      try { const result = Reflect.apply(native, receiver, args); failed = false; return result; }
      finally { note(api, at, failed); }
    } });
    const wrapped = Reflect.defineProperty(owner, key, { ...descriptor, value: proxy });
    support.push({ api, available: true, wrapped });
  };
  for (const key of ['Memory', 'Module', 'Instance']) wrap(WebAssembly, key, `WebAssembly.${key}`, true);
  for (const key of ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming']) wrap(WebAssembly, key, `WebAssembly.${key}`);
  wrap(WebAssembly.Memory.prototype, 'grow', 'WebAssembly.Memory.grow');
  for (const key of ['ArrayBuffer', 'SharedArrayBuffer']) wrap(globalThis, key, `${key}>=1MiB`, true, true);
  for (const key of ['OffscreenCanvas', 'ImageBitmap']) wrap(globalThis, key, key, true);
  wrap(globalThis, 'createImageBitmap', 'createImageBitmap');
  wrap(globalThis.OffscreenCanvas?.prototype, 'transferToImageBitmap', 'OffscreenCanvas.transferToImageBitmap');
  wrap(globalThis.HTMLCanvasElement?.prototype, 'transferControlToOffscreen', 'HTMLCanvasElement.transferControlToOffscreen');
  const copy = bank => ({ rows: bank.rows.map(row => ({ api: row.api, second: row.second, firstMs: row.firstMs, lastMs: row.lastMs, calls: row.calls, failed: row.failed, stack: row.stack })), dropped: bank.dropped, observerErrors: bank.observerErrors });
  window.__frameFloorNativePressure = {
    begin: () => {
      if (active !== null) throw new Error('Native pressure window already active');
      active = { rows: [], buckets: new Map(), dropped: 0, observerErrors: 0 };
    },
    read: () => ({ origin: state.origin, installedAt: state.installedAt,
      support: support.map(row => ({ api: row.api, available: row.available, wrapped: row.wrapped })), ...copy(state) }),
    take: () => {
      if (active === null) throw new Error('Native pressure window not active');
      const bank = active; active = null;
      return { origin: state.origin, installedAt: state.installedAt, support: support.map(row => ({ api: row.api, available: row.available, wrapped: row.wrapped })),
        ...copy(bank), cumulative: copy(state) };
    },
  };
}

/** Install before app modules, exclusively in the opted-in diagnostic helper. */
export const NATIVE_PRESSURE_SCRIPT = `(${observeNativePressure.toString()})();`;
