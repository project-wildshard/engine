// Preboot definition only: A/B retain native functions. Install wrappers only
// when C starts; discard counters before output cloning and restore afterward.
export function defineBufferPressure() {
  const typed = Object.getPrototypeOf(Uint8Array), proto = typed.prototype;
  // oxlint-disable-next-line typescript/unbound-method -- captured native getters are only called through Reflect.apply with their actual receiver
  const getter = (owner, name) => Object.getOwnPropertyDescriptor(owner, name)?.get;
  const typedBuffer = getter(proto, 'buffer'), typedBytes = getter(proto, 'byteLength');
  const dataBuffer = getter(DataView.prototype, 'buffer'), dataBytes = getter(DataView.prototype, 'byteLength');
  const arrayBytes = getter(ArrayBuffer.prototype, 'byteLength');
  const sharedBytes = globalThis.SharedArrayBuffer === undefined ? undefined : getter(SharedArrayBuffer.prototype, 'byteLength');
  const originals = [], support = [], buckets = new Map(), sites = new Map();
  const seen = new WeakSet();
  let active = false, recording = false, errors = 0, dropped = 0, startMs = 0;
  const bufferSize = buffer => {
    try { return Reflect.apply(arrayBytes, buffer, []); }
    catch { return sharedBytes === undefined ? null : (() => { try { return Reflect.apply(sharedBytes, buffer, []); } catch { return null; } })(); }
  };
  const view = value => {
    try { return { buffer: Reflect.apply(typedBuffer, value, []), bytes: Reflect.apply(typedBytes, value, []) }; }
    catch { return { buffer: Reflect.apply(dataBuffer, value, []), bytes: Reflect.apply(dataBytes, value, []) }; }
  };
  const note = (api, result, source, kind) => {
    if (recording || seen.has(result)) return;
    recording = true;
    try {
      seen.add(result);
      const at = performance.now(), second = Math.floor((at - startMs) / 1000);
      const isBuffer = kind === 'buffer', size = isBuffer ? bufferSize(result) : view(result).bytes;
      if (size === null) throw new Error('Buffer result has no native size');
      const backing = isBuffer ? result : view(result).buffer;
      const existing = !isBuffer && (kind === 'construct' ? bufferSize(source) !== null : kind === 'method' && source !== null && backing === view(source).buffer);
      const bytes = existing ? 0 : bufferSize(backing);
      if (bytes === null) throw new Error('View backing has no native size');
      const stack = new Error('Buffer creation site').stack ?? '', key = `${api}:${second}`;
      let row = buckets.get(key), site = sites.get(stack);
      if (row === undefined) {
        if (buckets.size >= 2048) { dropped++; return; }
        row = { api, second, calls: 0, newBackingBytes: 0, existingViews: 0, viewBytes: 0 };
        buckets.set(key, row);
      }
      if (site === undefined) {
        if (sites.size >= 4096) { dropped++; return; }
        site = { api, stack, calls: 0, newBackingBytes: 0, existingViews: 0, viewBytes: 0 };
        sites.set(stack, site);
      }
      for (const entry of [row, site]) {
        entry.calls++; entry.newBackingBytes += bytes; entry.existingViews += existing ? 1 : 0;
        entry.viewBytes += isBuffer ? 0 : size;
      }
    } catch { errors++; }
    finally { recording = false; }
  };
  const wrap = (owner, key, api, kind) => {
    const descriptor = owner === undefined ? undefined : Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor === undefined || typeof descriptor.value !== 'function') { support.push({api, available: false, wrapped: false}); return; }
    const handler = kind === 'construct' || kind === 'bufferConstruct' ? {construct(target, args, newTarget) {
      const result = Reflect.construct(target, args, newTarget);
      if (active) note(api, result, args[0], kind === 'bufferConstruct' ? 'buffer' : 'construct');
      return result;
    }} : {apply(target, receiver, args) {
      const result = Reflect.apply(target, receiver, args);
      if (active) note(api, result, kind === 'static' ? null : receiver, kind === 'bufferMethod' ? 'buffer' : kind === 'static' ? 'static' : 'method');
      return result;
    }};
    const wrapped = Reflect.defineProperty(owner, key, {...descriptor, value: new Proxy(descriptor.value, handler)});
    if (wrapped) originals.push({owner, key, descriptor});
    support.push({api, available: true, wrapped});
  };
  window.__frameFloorBufferPressure = {
    begin() {
      if (active || originals.length > 0) throw new Error('Buffer probe already started');
      startMs = performance.now();
      for (const key of ['ArrayBuffer', 'SharedArrayBuffer']) wrap(globalThis, key, key, 'bufferConstruct');
      for (const key of ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'DataView']) wrap(globalThis, key, key, 'construct');
      for (const key of ['slice', 'subarray', 'map', 'filter']) wrap(proto, key, `TypedArray.${key}`, 'method');
      for (const key of ['from', 'of']) wrap(typed, key, `TypedArray.${key}`, 'static');
      wrap(ArrayBuffer.prototype, 'slice', 'ArrayBuffer.slice', 'bufferMethod');
      active = true;
    },
    take() {
      if (!active) throw new Error('Buffer probe not active');
      active = false;
      const endMs = performance.now();
      for (let i = originals.length - 1; i >= 0; i--) { const row = originals[i]; if (!Reflect.defineProperty(row.owner, row.key, row.descriptor)) errors++; }
      originals.length = 0;
      return { startMs, endMs, rows: Array.from(buckets.values()), stacks: Array.from(sites.values()), support, errors, dropped,
        limitations: 'Page realm only; native internal/worker/Wasm allocations unobserved. Nested wrapped species results deduplicated by weak identity; independent callback allocations retained. View bytes are not new backing bytes.' };
    },
  };
}
export const BUFFER_PRESSURE_SCRIPT = `(${defineBufferPressure.toString()})();`;
