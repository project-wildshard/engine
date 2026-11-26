// ENGINE-MEMORY EM25 (design rule 4, "transfer, never clone"): a browser-side recorder of worker messages that clone big
// buffers. Installed as an init script (`context.addInitScript(recordClones)`), it wraps `Worker.prototype.postMessage`
// and `MessagePort.prototype.postMessage` on the page and logs, to `globalThis.__cloneLog`, every message whose
// ArrayBuffers outside its transfer list add up to CLONE_LIMIT_BYTES or more (a clone copies them: two copies live
// until one is collected). SharedArrayBuffers are shared, not copied, and are not counted. Init scripts do not run
// inside workers: src/e2e/t1/clones.ts installs the same function in each worker through the debugger.

/** A message cloning this many buffer bytes or more fails the check (EM25). */
export const CLONE_LIMIT_BYTES = 64 * 1024;

/** Browser-side: install the recorder. Self-contained (serialized by Playwright). */
export function recordClones() {
  const limit = 64 * 1024;
  /** @type {{target: string, bytes: number, buffers: number, stack: string}[]} */
  const log = [];
  Reflect.set(globalThis, '__cloneLog', log);
  const seen = { messages: 0, bytes: 0 };
  Reflect.set(globalThis, '__cloneSeen', seen);
  /** @param {unknown} value @param {Set<unknown>} moved @param {Set<unknown>} visited @param {Set<ArrayBuffer>} found @param {number} depth */
  const scan = (value, moved, visited, found, depth) => {
    if (value === null || typeof value !== 'object' || depth > 8 || visited.has(value)) return;
    visited.add(value);
    if (value instanceof ArrayBuffer) { if (!moved.has(value)) found.add(value); return; }
    if (ArrayBuffer.isView(value)) { const buffer = value.buffer; if (buffer instanceof ArrayBuffer && !moved.has(buffer)) found.add(buffer); return; }
    if (value instanceof Map) { for (const [key, entry] of value) { scan(key, moved, visited, found, depth + 1); scan(entry, moved, visited, found, depth + 1); } return; }
    if (value instanceof Set) { for (const entry of value) scan(entry, moved, visited, found, depth + 1); return; }
    if (Array.isArray(value)) { for (let i = 0; i < value.length && i < 100000; i++) scan(value[i], moved, visited, found, depth + 1); return; }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return;
    for (const key of Object.keys(value)) scan(Reflect.get(value, key), moved, visited, found, depth + 1);
  };
  /** @param {{postMessage: (...args: unknown[]) => unknown}} proto @param {string} target */
  const wrap = (proto, target) => {
    const original = proto.postMessage;
    proto.postMessage = function postMessage(/** @type {unknown[]} */ ...args) {
      try {
        const options = args[1], list = Array.isArray(options) ? options
          : options !== null && typeof options === 'object' && Array.isArray(Reflect.get(options, 'transfer')) ? Reflect.get(options, 'transfer') : [];
        /** @type {Set<ArrayBuffer>} */
        const found = new Set();
        scan(args[0], new Set(list), new Set(), found, 0);
        let bytes = 0;
        for (const buffer of found) bytes += buffer.byteLength;
        seen.messages++; seen.bytes += bytes;
        if (bytes >= limit) log.push({ target, bytes, buffers: found.size, stack: (new Error('clone').stack ?? '').split('\n').slice(2, 8).map(line => line.trim()).join(' | ') });
      } catch { /* the recorder never changes the message */ }
      return Reflect.apply(original, this, args);
    };
  };
  // On the page: messages to workers and ports. Inside a worker (installed through the debugger before its script runs):
  // its replies to the page.
  if (typeof Worker === 'function') wrap(/** @type {never} */ (Worker.prototype), 'Worker');
  const scope = Reflect.get(globalThis, 'DedicatedWorkerGlobalScope');
  if (typeof scope === 'function') wrap(/** @type {never} */ (scope.prototype), `worker:${String(Reflect.get(globalThis, 'name') ?? '')}`);
  wrap(/** @type {never} */ (MessagePort.prototype), 'MessagePort');
}
