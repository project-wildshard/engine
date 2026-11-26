#!/usr/bin/env node
// census.mjs, the ArrayBuffer census (ENGINE-MEMORY EM6; meta docs/plans/ENGINE-MEMORY-PLAN.md). The microscope for
// "every big buffer has an owner": one phone boot in headless Chromium (the measure.mjs phone context), with every
// main-thread ArrayBuffer of 64 KB or more recorded where it is made (the ArrayBuffer and typed-array constructors,
// ArrayBuffer and TypedArray slice, Response and Blob arrayBuffer/bytes, structuredClone, and buffers that arrive in a
// worker's message) and held by a WeakRef, never kept alive. At control, after two forced collections, it lists the
// buffers still alive by allocation site (mapped through the build's source maps) and asks the page's ledger who owns
// each (`__wildshardMemory.owner`), beside a detailed memory-infra dump's `partition_alloc/partitions/array_buffer`.
// Smaller buffers are summed, not listed. Attribution only: the wrapped constructors slow the page.
//
//   node scripts/memory/census.mjs --url=<served client> --chunk=<slug> --dist=<the served build's out dir> [--min-kb=64]
//        [--out=<file.json>]   (--min-kb: buffers of this size or more are listed by site; smaller ones are summed)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PHONE_VIEW, bootZone, dumpsInOrder, phoneContext, untilControl } from './measure.mjs';

const BIG = 65536, MB = 1e6;

/** In the page (and each worker) before its scripts: buffers of `big` bytes or more keep their stack. */
export const censusInit = (/** @type {number} */ big = BIG) => String.raw`(() => {
  const big = ${big}, rows = [], smallRefs = [], seen = new WeakSet(); let small = 0, smallBytes = 0;
  const step = () => { if (typeof document === 'undefined') return 'worker'; const r = document.querySelector('.ws-load'); return r ? (r.getAttribute('data-step') || r.querySelector('[data-step]')?.getAttribute('data-step') || 'loading') : 'page'; };
  const note = (buffer, kind, stack) => {
    if (!(buffer instanceof ArrayBuffer) && !(typeof SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer)) return;
    const bytes = buffer.byteLength; if (!(bytes > 0) || seen.has(buffer)) return; seen.add(buffer);
    if (bytes < big) { small++; smallBytes += bytes; smallRefs.push(new WeakRef(buffer)); return; }
    rows.push({ ref: new WeakRef(buffer), kind, bytes, step: step(), stack: stack ?? new Error().stack });
  };
  const bufferOf = (value) => ArrayBuffer.isView(value) ? value.buffer : value;
  const wrap = (name) => {
    const C = globalThis[name]; if (typeof C !== 'function') return;
    const proxy = new Proxy(C, { construct(target, args, newTarget) { const r = Reflect.construct(target, args, newTarget === proxy ? target : newTarget); try { note(bufferOf(r), name); } catch {} return r; } });
    globalThis[name] = proxy;
  };
  for (const name of ['ArrayBuffer','SharedArrayBuffer','Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','Float16Array']) wrap(name);
  const TA = Object.getPrototypeOf(Uint8Array.prototype);
  for (const name of ['slice','map','filter']) { const f = TA[name]; TA[name] = function (...a) { const r = f.apply(this, a); try { note(r.buffer, 'TypedArray.' + name); } catch {} return r; }; }
  const abSlice = ArrayBuffer.prototype.slice; ArrayBuffer.prototype.slice = function (...a) { const r = abSlice.apply(this, a); note(r, 'ArrayBuffer.slice'); return r; };
  for (const [owner, name, label] of [[Response.prototype, 'arrayBuffer', 'Response.arrayBuffer'], [Blob.prototype, 'arrayBuffer', 'Blob.arrayBuffer'], [Response.prototype, 'bytes', 'Response.bytes'], [Blob.prototype, 'bytes', 'Blob.bytes']]) {
    const f = owner[name]; if (typeof f !== 'function') continue;
    owner[name] = function (...a) { const stack = new Error().stack; return f.apply(this, a).then((r) => { note(bufferOf(r), label, stack); return r; }); };
  }
  if (typeof ReadableStreamDefaultReader === 'function') { const read = ReadableStreamDefaultReader.prototype.read; ReadableStreamDefaultReader.prototype.read = function (...a) { const stack = new Error().stack; return read.apply(this, a).then((r) => { if (r && ArrayBuffer.isView(r.value)) note(r.value.buffer, 'stream chunk', stack); return r; }); }; }
  if (typeof TextEncoder === 'function') { const encode = TextEncoder.prototype.encode; TextEncoder.prototype.encode = function (...a) { const r = encode.apply(this, a); note(r.buffer, 'TextEncoder.encode'); return r; }; }
  if (typeof WebSocket === 'function') { const add = WebSocket.prototype.addEventListener; WebSocket.prototype.addEventListener = function (type, fn, o) { if (type === 'message') add.call(this, 'message', (e) => { if (e.data instanceof ArrayBuffer) note(e.data, 'WebSocket message'); }); return add.call(this, type, fn, o); }; }
  // PartitionAlloc's slot for a request: four buckets per power of two up to 960 KiB, direct-mapped 16 KiB pages above
  const slot = (n) => { if (n > 983040) return Math.ceil(n / 16384) * 16384; if (n <= 16) return 16; const k = 31 - Math.clz32(n - 1), step = 2 ** Math.max(k - 2, 0); return 2 ** k + Math.ceil((n - 2 ** k) / step) * step; };
  const walk = (value, kind, stack, depth = 0, visited = new Set()) => {
    if (!value || typeof value !== 'object' || visited.has(value) || depth > 6) return; visited.add(value);
    if (value instanceof ArrayBuffer) { note(value, kind, stack); return; }
    if (ArrayBuffer.isView(value)) { note(value.buffer, kind, stack); return; }
    if (value instanceof Map) { for (const [k, v] of value) { walk(k, kind, stack, depth + 1, visited); walk(v, kind, stack, depth + 1, visited); } return; }
    for (const key in value) { try { walk(value[key], kind, stack, depth + 1, visited); } catch {} }
  };
  const sc = globalThis.structuredClone; globalThis.structuredClone = function (v, o) { const r = sc(v, o); try { walk(r, 'structuredClone', new Error().stack); } catch {} return r; };
  const W = globalThis.Worker;
  if (typeof W === 'function') globalThis.Worker = new Proxy(W, { construct(target, args, newTarget) {
    const worker = Reflect.construct(target, args, newTarget === globalThis.Worker ? target : newTarget);
    const from = 'worker ' + String(args[0] instanceof URL ? args[0].pathname : args[0]).replace(/^.*\//u, '').replace(/-[A-Za-z0-9_]{6,}(?=\.js)/u, '');
    worker.addEventListener('message', (event) => { try { walk(event.data, 'message from ' + from, from); } catch {} });
    return worker;
  } });
  // every WebAssembly.Memory this isolate makes or instantiates (EM7's wasm check: the ledger against what exists)
  const memories = [];
  const stacks = new WeakMap();
  const keepMemory = (m, stack) => { if (m instanceof WebAssembly.Memory && !memories.some((r) => r.deref() === m)) { memories.push(new WeakRef(m)); stacks.set(m, stack ?? new Error().stack); } };
  const keepExports = (instance, stack) => { for (const value of Object.values(instance?.exports ?? {})) keepMemory(value, stack); };
  const M = WebAssembly.Memory;
  WebAssembly.Memory = new Proxy(M, { construct(target, args, newTarget) { const m = Reflect.construct(target, args, newTarget === WebAssembly.Memory ? target : newTarget); keepMemory(m); return m; } });
  for (const name of ['instantiate', 'instantiateStreaming']) {
    const f = WebAssembly[name]; if (typeof f !== 'function') continue;
    WebAssembly[name] = function (...a) { const stack = new Error().stack; return f.apply(this, a).then((r) => { keepExports(r instanceof WebAssembly.Instance ? r : r.instance, stack); return r; }); };
  }
  const I = WebAssembly.Instance;
  WebAssembly.Instance = new Proxy(I, { construct(target, args, newTarget) { const r = Reflect.construct(target, args, newTarget === WebAssembly.Instance ? target : newTarget); keepExports(r); return r; } });
  globalThis.__arrayBufferCensus = () => {
    const owner = globalThis.__wildshardMemory?.owner;
    let wasm = 0; for (const ref of memories) wasm += ref.deref()?.buffer.byteLength ?? 0;
    // a typed view over a wasm memory (wasm-bindgen's cached views) names the memory's own buffer: wasm, not the partition
    const wasmBuffers = new Set(memories.map((ref) => ref.deref()?.buffer).filter(Boolean));
    const live = [];
    for (const row of rows) { const buffer = row.ref.deref(); if (buffer === undefined || buffer.byteLength === 0 || wasmBuffers.has(buffer)) continue; live.push({ kind: row.kind, bytes: buffer.byteLength, step: row.step, stack: row.stack, owner: owner ? owner(buffer) : null }); }
    let smallLive = 0, slotLive = 0; for (const ref of smallRefs) { const buffer = ref.deref(); if (buffer !== undefined && !wasmBuffers.has(buffer)) { smallLive += buffer.byteLength; slotLive += slot(buffer.byteLength); } }
    for (const row of live) slotLive += slot(row.bytes);
    return { made: rows.length, madeBytes: rows.reduce((s, r) => s + r.bytes, 0), small, smallBytes, smallLive, slotLive, live, wasm, wasmMemories: memories.map((r) => r.deref()).filter(Boolean).map((m) => ({ bytes: m.buffer.byteLength, owner: owner ? owner(m) : null, stack: stacks.get(m) ?? '' })) };
  };
})();`;

/** Map a stack's frames through the build's source maps and keep the first three in engine source.
 * @param {string} stack @param {(file: string) => any} mapFor @param {string} dist */
export function siteOf(stack, mapFor, dist, originalPositionFor) {
  if (!stack.includes('\n')) return stack; // a worker's name
  const frames = stack.split('\n').slice(1).map((line) => {
    const m = /(https?:\/\/[^\s)]+):(\d+):(\d+)/u.exec(line); if (!m) return null;
    const file = join(dist, new URL(m[1]).pathname), map = mapFor(file);
    if (map) { const o = originalPositionFor(map, { line: Number(m[2]), column: Number(m[3]) - 1 }); if (o.source) return `${o.source.replace(/^.*node_modules\//u, '').replace(/^(\.\.\/)+/u, '')}:${o.line}${o.name ? ` ${o.name}` : ''}`; }
    return `${basename(file)}:${m[2]}:${m[3]}`;
  }).filter((f) => f !== null && !f.includes('census'));
  const app = frames.filter((f) => f.startsWith('src/'));
  return app.slice(0, 3).join(' < ') || frames.slice(0, 3).join(' < ') || '?';
}

/** Live bytes by site and by owner. @param {{kind:string, bytes:number, site:string, owner:string|null}[]} live */
export function censusTable(live) {
  /** @type {Map<string, {bytes:number, count:number, owners:Set<string>}>} */
  const bySite = new Map(); /** @type {Map<string, number>} */ const byOwner = new Map();
  let owned = 0, total = 0;
  for (const row of live) {
    total += row.bytes;
    const owner = row.owner ?? 'not in the ledger';
    if (row.owner !== null && row.owner !== 'unattributed') owned += row.bytes;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + row.bytes);
    const key = `${row.kind} | ${row.site}`, at = bySite.get(key) ?? { bytes: 0, count: 0, owners: new Set() };
    at.bytes += row.bytes; at.count++; at.owners.add(owner); bySite.set(key, at);
  }
  return { total, owned, bySite: [...bySite].sort((a, b) => b[1].bytes - a[1].bytes).map(([site, v]) => ({ site, bytes: v.bytes, count: v.count, owners: [...v.owners] })), byOwner: Object.fromEntries([...byOwner].sort((a, b) => b[1] - a[1])) };
}

/** RAM kinds that are not ArrayBuffer backing stores (EM6's comparison leaves them out: decoded audio and images live in
 * their own stores, wasm memory in no memory-infra dump). */
export const NOT_ARRAY_BUFFER = new Set(['wasm', 'canvas', 'image', 'image-bitmap', 'audio-buffer']);

/** EM6 and EM7's checks from one census: the ledger's ArrayBuffer bytes (page and workers) against the partition's
 * allocated objects, the unattributed share, and the ledger's wasm against every live WebAssembly.Memory.
 * @param {{ram?: Record<string, number>, workers?: Record<string, number>} | null} ledger
 * @param {{partition:number|null, censusBytes:number, wasm:number}} seen */
export function closure(ledger, seen) {
  const ram = ledger?.ram ?? {}, workers = ledger?.workers ?? {};
  const kindOf = (/** @type {string} */ key) => key.slice(key.lastIndexOf('/') + 1);
  const arrayBuffers = Object.entries(ram).filter(([k]) => !NOT_ARRAY_BUFFER.has(k)).reduce((a, [, b]) => a + b, 0)
    + Object.entries(workers).filter(([k]) => !NOT_ARRAY_BUFFER.has(kindOf(k))).reduce((a, [, b]) => a + b, 0);
  const wasm = (ram.wasm ?? 0) + Object.entries(workers).filter(([k]) => kindOf(k) === 'wasm').reduce((a, [, b]) => a + b, 0);
  const ratio = seen.partition ? arrayBuffers / seen.partition : null;
  return { arrayBuffers, ratio, within10Pct: ratio !== null && Math.abs(1 - ratio) <= 0.1, censusRatio: seen.partition ? seen.censusBytes / seen.partition : null, wasm, wasmSeen: seen.wasm, wasmEqual: wasm === seen.wasm, workerNames: [...new Set(Object.keys(workers).map((k) => k.slice(0, k.lastIndexOf('/'))))] };
}

/** @param {string[]} argv */
async function main(argv) {
  const args = Object.fromEntries(argv.map((a) => /^--([^=]+)(?:=(.*))?$/u.exec(a)).filter((m) => m !== null).map((m) => [m[1], m[2] ?? '1']));
  if (!args.url || args.chunk === undefined || !args.dist) { console.error('usage: census.mjs --url=<served client> --chunk=<slug> --dist=<out dir> [--out=<file.json>]'); return 64; }
  const { TraceMap, originalPositionFor } = await import('@jridgewell/trace-mapping');
  const { launchMemoryBrowser } = await import('../chromium-memory-browser.mjs');
  const owned = await launchMemoryBrowser(['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--js-flags=--expose-gc']);
  let census, dump, ledger, isolates;
  try {
    const context = await owned.browser.newContext({ ...PHONE_VIEW });
    await phoneContext(context);
    const init = censusInit(Number(args['min-kb'] ?? 64) * 1024);
    await context.addInitScript(init);
    const page = await context.newPage(); page.setDefaultTimeout(240_000);
    /** @type {any[]} */ const workers = [];
    // each worker gets the census as soon as Playwright sees it: before its module script has been fetched, so in practice
    // before its first allocation (a worker that allocates first is marked `late` by its own `made` count being 0)
    page.on('worker', (worker) => { workers.push(worker); worker.evaluate(init).catch(() => undefined); });
    const failure = await (async () => { await bootZone(page, args.url, args.chunk); return untilControl(page, 240_000); })();
    if (failure) throw new Error(`boot failed: ${failure}`);
    const cdp = await context.newCDPSession(page);
    for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(1000); }
    await sleep(1000);
    census = await page.evaluate(() => Reflect.get(window, '__arrayBufferCensus')());
    isolates = [];
    for (const worker of workers) {
      const row = await worker.evaluate(async () => { const g = /** @type {any} */ (globalThis); for (let i = 0; i < 2; i++) { g.gc?.(); await new Promise((resolve) => { setTimeout(resolve, 300); }); } return { name: g.name ?? '', census: g.__arrayBufferCensus?.() ?? null }; }).catch(() => null);
      if (row) isolates.push({ url: worker.url(), ...row });
    }
    ledger = await page.evaluate(() => Reflect.get(globalThis, '__wildshardMemory')?.counters?.() ?? null);
    const tracing = await owned.browser.newBrowserCDPSession();
    /** @type {any[]} */ const events = [];
    tracing.on('Tracing.dataCollected', (event) => { events.push(...event.value); });
    await tracing.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: /** @type {any} */ ({ includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } }) });
    await tracing.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed', deterministic: true });
    const ended = new Promise((resolve) => { tracing.once('Tracing.tracingComplete', resolve); });
    await tracing.send('Tracing.end'); await ended;
    dump = dumpsInOrder(events, 4)[0]?.processes.find((p) => p.role === 'renderer') ?? null;
  } finally { await owned.close(); }
  const maps = new Map();
  const mapFor = (/** @type {string} */ file) => { if (!maps.has(file)) maps.set(file, existsSync(`${file}.map`) ? new TraceMap(readFileSync(`${file}.map`, 'utf8')) : null); return maps.get(file); };
  const live = census.live.map((/** @type {any} */ r) => ({ kind: r.kind, bytes: r.bytes, step: r.step, owner: r.owner, site: siteOf(r.stack, mapFor, args.dist, originalPositionFor) }));
  const table = censusTable(live);
  const workerRows = isolates.map((/** @type {any} */ w) => {
    const rows = (w.census?.live ?? []).map((/** @type {any} */ r) => ({ kind: r.kind, bytes: r.bytes, step: r.step, owner: r.owner, site: siteOf(r.stack, mapFor, args.dist, originalPositionFor) }));
    return { name: w.name === '' ? w.url.replace(/^.*\//u, '') : w.name, made: w.census?.made ?? null, small: w.census?.smallBytes ?? null, smallLive: w.census?.smallLive ?? 0, ...censusTable(rows) };
  });
  // allocated_objects is what the page's buffers hold; the partition's own size adds free slots and metadata
  const arrayBufferPartition = dump?.alloc['partition_alloc/allocated_objects/partitions/array_buffer'] ?? null, partitionResident = dump?.alloc['partition_alloc/partitions/array_buffer'] ?? null;
  const ledgerRam = ledger?.ram ?? {};
  const memories = [{ isolate: 'page', rows: census.wasmMemories ?? [] }, ...isolates.map((/** @type {any} */ w) => ({ isolate: w.name === '' ? 'worker' : w.name, rows: w.census?.wasmMemories ?? [] }))]
    .flatMap(({ isolate, rows }) => rows.map((/** @type {any} */ m) => ({ isolate, bytes: m.bytes, owner: m.owner, site: siteOf(m.stack, mapFor, args.dist, originalPositionFor) })));
  const censusBytes = table.total + census.smallLive + workerRows.reduce((s, w) => s + w.total + (w.smallLive ?? 0), 0);
  const wasmSeen = (census.wasm ?? 0) + isolates.reduce((s, w) => s + (w.census?.wasm ?? 0), 0);
  const check = closure(ledger, { partition: arrayBufferPartition, censusBytes, wasm: wasmSeen });
  const lines = [
    `[H] ArrayBuffer census, ${args.chunk} at control after two forced GCs (headless Chromium, phone Low)`,
    `  made during the boot: ${census.made} of 64 KB or more (${(census.madeBytes / MB).toFixed(1)} MB), ${census.small} smaller (${(census.smallBytes / MB).toFixed(1)} MB)`,
    `  live at control: ${(table.total / MB).toFixed(1)} MB in ${live.length} buffers of 64 KB or more; owned in the ledger ${(table.owned / MB).toFixed(1)} MB`,
    `  smaller buffers still live: main thread ${(census.smallLive / MB).toFixed(1)} MB, workers ${(workerRows.reduce((s, w) => s + (w.smallLive ?? 0), 0) / MB).toFixed(1)} MB`,
    `  array_buffer partition [R]: allocated objects ${arrayBufferPartition === null ? '-' : (arrayBufferPartition / MB).toFixed(1)} MB (resident ${partitionResident === null ? '-' : (partitionResident / MB).toFixed(1)}); ledger ram [L] ${Object.entries(ledgerRam).map(([k, b]) => `${k} ${(/** @type {number} */ (b) / MB).toFixed(1)}`).join(', ')}`,
    `  census in PartitionAlloc slots (four buckets an order, 16 KiB direct maps): ${((census.slotLive + isolates.reduce((t, w) => t + (w.census?.slotLive ?? 0), 0)) / MB).toFixed(1)} MB`,
    `  closure: census ${(censusBytes / MB).toFixed(1)} MB = ${check.censusRatio === null ? '-' : (check.censusRatio * 100).toFixed(0)}% of the partition; ledger ArrayBuffer kinds (page + workers) ${(check.arrayBuffers / MB).toFixed(1)} MB [L] = ${check.ratio === null ? '-' : (check.ratio * 100).toFixed(0)}% (${check.within10Pct ? 'within' : 'OUTSIDE'} 10%)`,
    `  wasm: ledger ${(check.wasm / MB).toFixed(2)} MB [L], live WebAssembly.Memory ${(wasmSeen / MB).toFixed(2)} MB in ${memories.length} memories (${check.wasmEqual ? 'equal' : 'DIFFERENT'})`,
    ...memories.filter((m) => m.owner === null).map((m) => `    not in the ledger: ${(m.bytes / MB).toFixed(2)} MB wasm memory in ${m.isolate}, made at ${m.site}`),
    `  workers the page ledger lists: ${check.workerNames.join(', ') || 'none'}; isolates seen: ${workerRows.map((w) => w.name).join(', ') || 'none'}`,
    '  live by owner:', ...Object.entries(table.byOwner).map(([o, b]) => `    ${(b / MB).toFixed(1).padStart(7)} MB  ${o}`),
    '  workers (live 64 KB or more at control; census installed when the worker appeared):', ...workerRows.map((w) => `    ${(w.total / MB).toFixed(1).padStart(7)} MB  ${w.name}${w.made === null ? ' (no census)' : ''}${w.bySite[0] ? `  largest: ${(w.bySite[0].bytes / MB).toFixed(1)} MB ${w.bySite[0].site}` : ''}`),
    '  live by site:', ...table.bySite.slice(0, 40).map((s) => `    ${(s.bytes / MB).toFixed(1).padStart(7)} MB  x${String(s.count).padEnd(4)} ${s.site}  [${s.owners.join(', ')}]`),
  ];
  for (const line of lines) console.log(line);
  if (args.out) { const out = resolvePath(args.out); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify({ protocol: 'memory-census/1', url: args.url, chunk: args.chunk, date: new Date().toISOString(), made: census.made, madeBytes: census.madeBytes, small: census.small, smallBytes: census.smallBytes, smallLive: census.smallLive, arrayBufferPartition, partitionResident, ledger, closure: check, censusBytes, wasmMemories: memories, ...table, workers: workerRows }, null, 1)}\n`); }
  return 0;
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) process.exitCode = await main(process.argv.slice(2));
