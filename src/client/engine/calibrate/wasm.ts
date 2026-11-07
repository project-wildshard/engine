/**
 * WASM-HOST H0: the Wasm boundary prices a v2 script host is designed on, measured on this device. A synthetic module
 * (built here from bytes, no toolchain) times a JS → Wasm entry, a direct Wasm call against a Wasm → JS import, fuel kept
 * in an internal global, an exported global or charged through an import (today's), and an inline finite check against
 * the `finite64` import; JS times the whole-image reset; the physics boundary times Rapier ray queries and kinematic
 * pose syncs; and each shipped decision module runs its real tick call under counting imports. Every timing is a JIT
 * warm-up, then adaptive batches (each ≥ 5 ms) repeated until ≥ 50 ms elapse, reported as ns per operation.
 */
import { admitScript } from '@wildshard/format/scriptAdmission';
import { scriptV1Layout } from '@wildshard/format/scriptAbiV1';
import { calibrationQueries } from '../physics/calibration';
import { diagnosticNow } from '../../../shared/engine/core/clock';

/** One shipped decision module and the IO dimensions of a script that binds it (handed in by the page, as data). */
export interface CalibrationScript { readonly product: string; readonly script: string; readonly module: string; readonly bytes: Uint8Array; readonly states: number; readonly params: number;
  /** why the page could not hand in this product's modules (the row is reported, not measured) */
  readonly error?: string }
export interface ScriptCalibration {
  product: string; script: string; module: string; bytes: number; pages: number; callNs: number; resetNs: number;
  /** imports per call, by kind, and the charge the module pays per function entry / loop iteration */
  imports: Record<'enter' | 'leave' | 'fuel' | 'finite' | 'read', number>; fuel: number; charge: number;
  /** the share of a call spent crossing imports (imports × the measured import round trip) and rewinding the image */
  importShare: number; resetShare: number; error: string | null;
}
export interface WasmCalibration {
  timing: string; moduleHash: string; entryNs: number;
  loopNs: Record<'plain' | 'direct' | 'imported' | 'fuelInternal' | 'fuelExported' | 'fuelImport' | 'floatPlain' | 'floatImport' | 'floatInline', number>;
  directCallNs: number; importCallNs: number; importToDirect: number; importCheap: boolean;
  fuelOverheadPct: Record<'internal' | 'exported' | 'import', number>; coarserFuel: boolean; finiteImportNs: number; finiteInlineNs: number;
  resetNs: Record<'64KiB' | '256KiB', number>; globalRestoreNs: number; rapier: { rayNs: number; syncNs: number }; scripts: ScriptCalibration[];
}

/** ns per operation: warm up, grow the batch to ≥ 5 ms, then repeat batches until ≥ 50 ms (`ops` operations per unit). */
function nsPerOp(run: (n: number) => unknown, ops = 1): number {
  for (let i = 0; i < 8; i++) run(64);
  let n = 64;
  for (;;) { const t = diagnosticNow(); run(n); if (diagnosticNow() - t >= 5 || n >= 1 << 26) break; n *= 2; }
  let count = 0; const start = diagnosticNow();
  while (diagnosticNow() - start < 50) { run(n); count += n; }
  return (diagnosticNow() - start) * 1e6 / (count * ops);
}

const leb = (value: number): number[] => { const out: number[] = []; let n = value; do { const low = n & 0x7f; n >>>= 7; out.push(n === 0 ? low : low | 0x80); } while (n !== 0); return out; };
const sleb = (n: number): number[] => {
  const out: number[] = []; let v = n | 0;
  for (;;) { const low = v & 0x7f; v >>= 7; if ((v === 0 && (low & 0x40) === 0) || (v === -1 && (low & 0x40) !== 0)) { out.push(low); return out; } out.push(low | 0x80); }
};
const vec = (items: readonly (readonly number[])[]): number[] => [...leb(items.length), ...items.flat()];
const section = (id: number, body: readonly number[]): number[] => [id, ...leb(body.length), ...body];
const text = (name: string): number[] => { const b = [...new TextEncoder().encode(name)]; return [...leb(b.length), ...b]; };
const f64 = (x: number): number[] => [0x44, ...new Uint8Array(Float64Array.of(x).buffer)];
const I32 = 0x7f, F64 = 0x7c, MAX = 0x7fffffff;

/** The synthetic module: imports env.nop / env.fuel / env.finite, two fuel globals (one exported) and one i32 loop
 *  (locals: 1 counter, 2 accumulator) or f64 loop (local 2 the value) per variant. */
function benchModule(): Uint8Array {
  const loop = (work: readonly number[], prelude: readonly number[] = []): number[] => [...prelude, 0x02, 0x40, 0x03, 0x40,
    0x20, 1, 0x20, 0, 0x4e, 0x0d, 1, ...work, 0x20, 1, 0x41, 1, 0x6a, 0x21, 1, 0x0c, 0, 0x0b, 0x0b, 0x20, 2, 0x0b];
  const add = [0x20, 2, 0x20, 1, 0x6a, 0x21, 2];
  const fuel = (g: number): number[] => [...add, 0x23, g, 0x41, 7, 0x6b, 0x24, g, 0x23, g, 0x41, 0, 0x48, 0x04, 0x40, 0x00, 0x0b];
  const refill = (g: number): number[] => [0x41, ...sleb(MAX), 0x24, g];
  const finite = [0x99, ...f64(Number.POSITIVE_INFINITY), 0x63, 0x45, 0x04, 0x40, 0x00, 0x0b]; // |x| < ∞ or trap (a NaN fails it)
  const mul = [0x20, 2, ...f64(1.0000001), 0xa2], plus = [...f64(0.5), 0xa0];
  const ints = [1, 2].map(() => [1, I32]), floats = [[1, I32], [1, F64]];
  // [type index, locals, body, export]
  const funcs: [number, number[][], number[], string | null][] = [
    [0, [], [0x0b], null], [0, [], [0x0b], 'entry'],
    [2, ints, loop(add), 'plain'], [2, ints, loop([...add, 0x10, 3]), 'direct'], [2, ints, loop([...add, 0x10, 0]), 'imported'],
    [2, ints, loop(fuel(0), refill(0)), 'fuelInternal'], [2, ints, loop(fuel(1), refill(1)), 'fuelExported'], [2, ints, loop([...add, 0x41, 7, 0x10, 1]), 'fuelImport'],
    [4, floats, loop([...mul, ...plus, 0x21, 2]), 'floatPlain'], [4, floats, loop([...mul, 0x10, 2, ...plus, 0x10, 2, 0x21, 2]), 'floatImport'],
    [4, floats, loop([...mul, 0x22, 2, 0x20, 2, ...finite, 0x20, 2, ...plus, 0x22, 2, 0x20, 2, ...finite]), 'floatInline'],
  ];
  const types = [[0x60, 0, 0], [0x60, 1, I32, 0], [0x60, 1, I32, 1, I32], [0x60, 1, F64, 1, F64], [0x60, 1, I32, 1, F64]];
  const imports = [[...text('env'), ...text('nop'), 0, 0], [...text('env'), ...text('fuel'), 0, 1], [...text('env'), ...text('finite'), 0, 3]];
  const global = [I32, 1, 0x41, ...sleb(MAX), 0x0b], globals = [global, global];
  const exports = [[...text('memory'), 2, 0], [...text('fuel'), 3, 1], ...funcs.flatMap((row, i) => row[3] === null ? [] : [[...text(row[3]), 0, i + imports.length]])];
  const code = funcs.map(([, locals, body]) => { const b = [...vec(locals), ...body]; return [...leb(b.length), ...b]; });
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, vec(types)), ...section(2, vec(imports)), ...section(3, vec(funcs.map(([t]) => [t]))),
    ...section(5, vec([[0x01, 4, 4]])), ...section(6, vec(globals)), ...section(7, vec(exports)), ...section(10, vec(code))]);
}

type Loop = (n: number) => number;
type Export = (a?: number, b?: number) => unknown;
const exported = (exports: WebAssembly.Exports, name: string): Export => {
  const value = exports[name]; if (typeof value !== 'function') throw new Error(`Calibration export missing: ${name}`);
  return value as Export;
};
const fn = (exports: WebAssembly.Exports, name: string): Loop => { const call = exported(exports, name); return (n: number) => { const result = call(n); return typeof result === 'number' ? result : 0; }; };
async function hash(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A shipped module's real tick call under counting imports (the DecisionHost.call shape: rewind, IO, one tick event). */
function scriptRow(row: CalibrationScript, importNs: number): ScriptCalibration {
  const imports = { enter: 0, leave: 0, fuel: 0, finite: 0, read: 0 };
  const out: ScriptCalibration = { product: row.product, script: row.script, module: row.module, bytes: row.bytes.length, pages: 0, callNs: 0, resetNs: 0, imports, fuel: 0, charge: 0, importShare: 0, resetShare: 0, error: null };
  if (row.error !== undefined) { out.error = row.error; return out; }
  try {
    const admission = admitScript(row.bytes, 1), memory = new WebAssembly.Memory({ initial: admission.initialPages, maximum: admission.maximumPages });
    out.pages = admission.initialPages;
    let counting = false;
    const tally = (kind: keyof typeof imports, cost = 0): void => { if (counting) { imports[kind]++; out.fuel += cost; } };
    const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(row.bytes)), { env: { memory,
      enter: () => { tally('enter', 1); }, leave: () => { tally('leave'); },
      fuel: (cost: number) => { tally('fuel', cost); if (cost > out.charge) out.charge = cost; },
      finite32: (value: number) => { tally('finite', 1); return value; }, finite64: (value: number) => { tally('finite', 1); return value; },
      abort: () => { throw new Error('Calibration script abort'); },
      ws_read: () => { tally('read', 256); return 0; }, ws_list: () => { tally('read', 256); return 0; } } });
    const call = (name: string, a?: number, b?: number): number => {
      const value = exported(instance.exports, name), result = a === undefined ? value() : value(a, b); return typeof result === 'number' ? result : 0;
    };
    if (typeof instance.exports['__start'] === 'function') call('__start');
    call('ws_init', 0, 0);
    const layout = scriptV1Layout(row.states, row.params), bytes = new Uint8Array(memory.buffer), image = bytes.slice();
    const io = new Float64Array(memory.buffer, call('ws_io'), layout.bytes / 8);
    const globals = admission.globals.flatMap(name => { const g = instance.exports[name]; if (!(g instanceof WebAssembly.Global)) return []; const value: unknown = g.value; return [{ g, value }]; });
    const rewind = (): void => { bytes.set(image); for (const { g, value } of globals) g.value = value; };
    const tick = (): void => { rewind(); io.fill(0); io[0] = 6; io[1] = 0.1; io[4] = 1; io[layout.inbox] = 2; call('ws_handle'); };
    counting = true; tick(); counting = false;
    out.callNs = nsPerOp(n => { for (let i = 0; i < n; i++) tick(); });
    out.resetNs = nsPerOp(n => { for (let i = 0; i < n; i++) rewind(); });
    const crossings = imports.enter + imports.leave + imports.fuel + imports.finite + imports.read;
    out.importShare = crossings * importNs / out.callNs; out.resetShare = out.resetNs / out.callNs;
  } catch (error) { out.error = error instanceof Error ? error.message : String(error); }
  return out;
}

export async function measureWasm(scripts: readonly CalibrationScript[], progress: (s: string) => void): Promise<WasmCalibration> {
  progress('Wasm · boundary'); const bytes = benchModule();
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(bytes)), { env: { nop: () => undefined, fuel: () => undefined, finite: (x: number) => x } });
  const entry = exported(instance.exports, 'entry');
  const entryNs = nsPerOp(n => { for (let i = 0; i < n; i++) entry(); });
  const time = (name: string): number => nsPerOp(fn(instance.exports, name));
  const loopNs = { plain: time('plain'), direct: time('direct'), imported: time('imported'), fuelInternal: time('fuelInternal'), fuelExported: time('fuelExported'),
    fuelImport: time('fuelImport'), floatPlain: time('floatPlain'), floatImport: time('floatImport'), floatInline: time('floatInline') };
  const directCallNs = Math.max(1e-3, loopNs.direct - loopNs.plain), importCallNs = Math.max(1e-3, loopNs.imported - loopNs.plain);
  const overhead = (ns: number): number => (ns - loopNs.plain) / loopNs.plain * 100;
  const fuelOverheadPct = { internal: overhead(loopNs.fuelInternal), exported: overhead(loopNs.fuelExported), import: overhead(loopNs.fuelImport) };
  progress('Wasm · reset');
  const reset = (size: number): number => { const memory = new Uint8Array(size), image = new Uint8Array(size).fill(7); return nsPerOp(n => { for (let i = 0; i < n; i++) memory.set(image); }); };
  const globals = Array.from({ length: 8 }, (_, i) => new WebAssembly.Global({ value: 'i32', mutable: true }, i));
  const globalRestoreNs = nsPerOp(n => { for (let i = 0; i < n; i++) for (const [k, g] of globals.entries()) g.value = k; }, globals.length);
  progress('Wasm · Rapier'); const queries = await calibrationQueries();
  let rapier: WasmCalibration['rapier'];
  try { rapier = { rayNs: nsPerOp(queries.rays), syncNs: nsPerOp(queries.sync) }; } finally { queries.dispose(); }
  const result: WasmCalibration = {
    timing: 'JIT warm-up (8 runs), batch grown to >= 5 ms, batches repeated until >= 50 ms; ns/op = elapsed / operations',
    moduleHash: await hash(bytes), entryNs, loopNs, directCallNs, importCallNs, importToDirect: importCallNs / directCallNs, importCheap: importCallNs <= 2 * directCallNs,
    fuelOverheadPct, coarserFuel: fuelOverheadPct.internal > 15, finiteImportNs: (loopNs.floatImport - loopNs.floatPlain) / 2, finiteInlineNs: (loopNs.floatInline - loopNs.floatPlain) / 2,
    resetNs: { '64KiB': reset(65536), '256KiB': reset(262144) }, globalRestoreNs, rapier, scripts: [],
  };
  for (const row of scripts) { progress(`Wasm · ${row.product} · ${row.script}`); result.scripts.push(scriptRow(row, importCallNs)); }
  return result;
}
