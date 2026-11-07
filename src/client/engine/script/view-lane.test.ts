import { expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { fixedMemoryCensus } from '../../../shared/engine/script/fixedMemory';
import { ViewLane, type ViewLaneRows } from '../../../shared/engine/script/viewLane';

// A hand-built SCRIPT-ABI v2 view module (no v2 compiler yet): IO at 1024; ws_view writes one changed transform (the
// identity, translated by `alpha` on x) into the kind-17 region the host's directory names, traps when dt > 1, and
// returns fuel - 1.
const IO = 1024, DIR = IO + 128, T17 = DIR + 16 * 24;
const leb = (value: number): number[] => { const out: number[] = []; let n = value; do { const low = n & 0x7f; n >>>= 7; out.push(n === 0 ? low : low | 0x80); } while (n !== 0); return out; };
const sleb = (value: number): number[] => { const out: number[] = []; let v = value | 0; for (;;) { const low = v & 0x7f; v >>= 7; if ((v === 0 && (low & 0x40) === 0) || (v === -1 && (low & 0x40) !== 0)) { out.push(low); return out; } out.push(low | 0x80); } };
const vec = (items: readonly (readonly number[])[]): number[] => [...leb(items.length), ...items.flat()];
const section = (id: number, body: readonly number[]): number[] => [id, ...leb(body.length), ...body];
const text = (name: string): number[] => { const b = [...new TextEncoder().encode(name)]; return [...leb(b.length), ...b]; };
const i32 = (n: number): number[] => [0x41, ...sleb(n)];
const f32 = (x: number): number[] => [0x43, ...new Uint8Array(Float32Array.of(x).buffer)];
const f64 = (x: number): number[] => [0x44, ...new Uint8Array(Float64Array.of(x).buffer)];
const store32 = (addr: number[], value: number[]): number[] => [...addr, ...value, 0x36, 0x02, 0x00];
const storeF = (addr: number[], value: number[]): number[] => [...addr, ...value, 0x38, 0x02, 0x00];
function viewModule(channel = false): Uint8Array {
  const base = [0x20, 3], at = (k: number): number[] => [...base, ...i32(k), 0x6a];
  const view = [
    0x20, 0, ...f64(1), 0x64, 0x04, 0x40, 0x00, 0x0b, // dt > 1: trap
    ...i32(T17 + 4), 0x28, 0x02, 0x00, ...i32(IO), 0x6a, 0x21, 3, // base = directory[17].offset + io
    ...store32(i32(T17 + 16), i32(1)), ...store32(at(12), i32(1)),
    ...[0, 5, 10, 15].flatMap(k => storeF(at(16 + k * 4), f32(1))), ...storeF(at(16 + 12 * 4), [0x20, 1, 0xb6]),
    ...store32(i32(IO + 72), i32(1)),
    ...(channel ? [...i32(DIR + 17 * 24 + 4), 0x28, 0x02, 0x00, ...i32(IO), 0x6a, 0x20, 1, 0x39, 0x03, 0x00,
      ...store32(i32(DIR + 17 * 24 + 16), i32(1)), ...store32(i32(IO + 76), i32(1))] : []),
    0x20, 2, ...i32(1), 0x6b, 0x0b];
  const types = [[0x60, 0, 1, 0x7f], [0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f], [0x60, 3, 0x7c, 0x7c, 0x7f, 1, 0x7f]];
  const funcs: [number, number[][], number[], string][] = [[0, [], [...i32(2), 0x0b], 'ws_abi'], [0, [], [...i32(IO), 0x0b], 'ws_io'],
    [1, [], [0x20, 2, 0x0b], 'ws_init'], [2, [[1, 0x7f]], view, 'ws_view']];
  const imports = [[...text('env'), ...text('memory'), 2, 0x01, 1, 1]];
  const exports = funcs.map((row, i) => [...text(row[3]), 0, i]);
  const code = funcs.map(([, locals, body]) => { const b = [...vec(locals), ...body]; return [...leb(b.length), ...b]; });
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, vec(types)), ...section(2, vec(imports)),
    ...section(3, vec(funcs.map(([t]) => [t]))), ...section(7, vec(exports)), ...section(10, vec(code))]);
}
const rows: ViewLaneRows = { bindings: [{ handle: 7, columns: 2 }], transforms: [{ binding: 0, output: 0, element: 0 }], channels: 0,
  bounds: { translation: 10, scale: [0.5, 2], shear: 0.1 }, targetMs: 1, fuel: 1000 };
function lane(over: Partial<ViewLaneRows> = {}): { lane: ViewLane; written: number[][]; uploads: number[] } {
  const written: number[][] = [], uploads: number[] = [];
  const view = new ViewLane(viewModule(), 1, { ...rows, ...over }, { write: (position, m) => { written.push([position, ...m]); }, channels: () => undefined, upload: () => { uploads.push(1); } });
  return { lane: view, written, uploads };
}
const sample = { previousTick: 10, currentTick: 16, values: [0, 1, 2, 3] };
const clock = (step: number): () => number => { let t = 0; return () => (t += step); };

test('a scheduled frame lands its validated transform and uploads once', () => {
  const { lane: view, written, uploads } = lane();
  expect(view.frame(1 / 60, 0.25, 20, [sample], 60, clock(0.1))).toBe(true);
  expect(written).toHaveLength(1);
  expect(written[0]?.[0]).toBe(0); expect(written[0]?.[13]).toBeCloseTo(0.25); expect(written[0]?.[1]).toBe(1);
  expect(uploads).toEqual([1]);
});

test('private view banks survive host buffer replacement without changing frame or refusal effects', () => {
  const delivered: Float64Array[] = [], values: number[] = [], transforms: number[][] = [];
  const view = new ViewLane(viewModule(true), 1, { ...rows, channels: 1 }, {
    write: (_position, matrix) => { transforms.push([...matrix]); },
    channels: bank => { delivered.push(bank); values.push(bank[0] ?? Number.NaN); }, upload: () => undefined,
  });
  const other = lane();
  for (const alpha of [-0, .25]) {
    expect(view.frame(1 / 60, alpha, 20, [sample], 60, clock(.1))).toBe(true);
    other.lane.frame(1 / 60, alpha, 20, [sample], 60, clock(.1));
  }
  expect(values).toEqual([-0, .25]); expect(delivered[0]).toBe(delivered[1]);
  expect(transforms).toEqual(other.written.map(row => row.slice(1)));
  const detached = view.memory.buffer; view.memory.grow(0);
  expect(detached.byteLength).toBe(0);
  expect(view.frame(1 / 60, .5, 21, [{ ...sample, values: [4, 5, 6, 7] }], 60, clock(.1))).toBe(true);
  expect(values).toEqual([-0, .25, .5]); expect(delivered[2] === delivered[1]).toBe(false);
  const wire = new DataView(view.memory.buffer), samples = IO + wire.getUint32(DIR + 15 * 24 + 4, true);
  expect(Array.from({ length: 4 }, (_, i) => wire.getFloat64(samples + i * 8, true))).toEqual([4, 5, 6, 7]);
  expect(view.frame(2, 1, 22, [sample], 60, clock(.1))).toBe(true);
  expect(values).toHaveLength(3); expect(transforms).toHaveLength(3); expect(view.isFrozen).toBe(true);
  expect(other.lane.isFrozen).toBe(false);
});

test('lent arrays retain scalar getter order, f32 words and freshness after buffer replacement', () => {
  const { lane: view, uploads } = lane({ arrays: [4, 2, 0] });
  const reads: number[] = [];
  let shift = 0;
  const values = { length: 3,
    get 0(): number { reads.push(0); return -0; },
    get 1(): number { reads.push(1); return 1 / 3 + shift; },
    get 2(): number { reads.push(2); return 1e-40; } };
  for (let frame = 0; frame < 3; frame++) {
    shift = frame;
    if (frame === 1) view.memory.grow(0);
    expect(view.frame(1 / 60, .25, 20 + frame, [sample], 60, clock(.1), [values, [7 + frame]])).toBe(true);
    const wire = new DataView(view.memory.buffer), base = IO + wire.getUint32(DIR + 22 * 24 + 4, true);
    const expected = Float32Array.of(-0, 1 / 3 + frame, 1e-40, 0, 7 + frame, 0);
    expect(new Uint32Array(view.memory.buffer, base, 6)).toEqual(new Uint32Array(expected.buffer));
  }
  expect(reads).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  expect(uploads).toEqual([1, 1, 1]);
  expect(view.isFrozen).toBe(false);
});

test('three overruns halve the rate down to the 15 Hz floor; healthy calls recover one level', () => {
  const { lane: view } = lane();
  const slow = clock(5);
  for (let i = 0; i < 3; i++) view.frame(1 / 60, 0.5, 20, [sample], 60, slow);
  expect(view.interval).toBe(2);
  for (let i = 0; i < 6; i++) view.frame(1 / 60, 0.5, 20, [sample], 60, slow);
  expect(view.interval).toBe(4);
  for (let i = 0; i < 24; i++) view.frame(1 / 60, 0.5, 20, [sample], 60, slow);
  expect(view.interval).toBe(4); // 60 Hz / 4 = 15 Hz: never below the floor
  const fast = clock(0.1);
  for (let i = 0; i < 4 * 120; i++) view.frame(1 / 60, 0.5, 20, [sample], 60, fast);
  expect(view.interval).toBe(2);
});

test('a trap or an out-of-bounds matrix uploads nothing and freezes the module', () => {
  const trapped = lane();
  expect(trapped.lane.frame(2, 0.5, 20, [sample], 60, clock(0.1))).toBe(true);
  expect(trapped.uploads).toEqual([]); expect(trapped.lane.isFrozen).toBe(true);
  expect(trapped.lane.frame(1 / 60, 0.5, 20, [sample], 60, clock(0.1))).toBe(false);
  const far = lane({ bounds: { translation: 0.1, scale: [0.5, 2], shear: 0.1 } });
  far.lane.frame(1 / 60, 0.5, 20, [sample], 60, clock(0.1));
  expect(far.written).toEqual([]); expect(far.uploads).toEqual([]); expect(far.lane.isFrozen).toBe(true);
});

test('a module importing anything but memory is refused', () => {
  const bytes = viewModule(), bad = Uint8Array.from(bytes);
  const at = bad.findIndex((_, i) => bad[i] === 6 && bad[i + 1] === 0x6d && bad[i + 2] === 0x65); // "memory" → "memorx"
  bad[at + 6] = 0x78;
  expect(() => new ViewLane(bad, 1, rows, { write: () => undefined, channels: () => undefined, upload: () => undefined })).toThrow();
});

test('owned view retirement clears cached banks and starts a reused memory with the exact fresh frame', () => {
  const firstScope = new Scope('view.first'), nextScope = new Scope('view.next');
  const NativeInstance = WebAssembly.Instance, memories: WebAssembly.Memory[] = [];
  const capture = vi.spyOn(WebAssembly, 'Instance').mockImplementation(class extends NativeInstance {
    constructor(module: WebAssembly.Module, imports?: WebAssembly.Imports) {
      super(module, imports); const memory = imports?.['env']?.['memory'];
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('Missing view memory'); memories.push(memory);
    }
  });
  const writes: number[][] = [], targets = { write: (_index: number, matrix: Float32Array): void => { writes.push([...matrix]); }, channels: () => undefined, upload: () => undefined };
  try {
    const first = new ViewLane(viewModule(), 1, rows, targets, [0, 0], undefined, firstScope);
    first.frame(1 / 60, .75, 20, [sample], 60, clock(.1));
    const original = memories[0]; if (original === undefined) throw new Error('Missing original view memory');
    new Uint8Array(original.buffer)[65535] = 83;
    firstScope.dispose(); expect(first.isFrozen).toBe(true);
    expect(first.frame(1 / 60, .5, 21, [sample], 60, clock(.1))).toBe(false);
    const next = new ViewLane(viewModule(), 1, rows, targets, [0, 0], undefined, nextScope);
    expect(memories[1]).toBe(original); expect(new Uint8Array(original.buffer)[65535]).toBe(0);
    next.frame(1 / 60, .25, 20, [sample], 60, clock(.1));
    expect(writes[1]?.[12]).toBe(.25);
    const direct = lane(); direct.lane.frame(1 / 60, .25, 20, [sample], 60, clock(.1));
    expect(writes[1]).toEqual(direct.written[0]?.slice(1));
    expect(first.frame(1 / 60, 1, 22, [sample], 60, clock(.1))).toBe(false);
  } finally { capture.mockRestore(); firstScope.dispose(); nextScope.dispose(); }
});

test('view disposal in a target cannot recycle while that frame still borrows its banks', () => {
  const owner = new Scope('view.busy'); let before = fixedMemoryCensus().returned;
  const view = new ViewLane(viewModule(), 1, rows, {
    write: () => {
      before = fixedMemoryCensus().returned; owner.dispose();
      expect(fixedMemoryCensus().returned).toBe(before);
      expect(() => view.frame(1 / 60, 0, 20, [sample], 60, clock(.1))).not.toThrow();
    }, channels: () => undefined, upload: () => { expect(fixedMemoryCensus().returned).toBe(before); },
  }, [0, 0], undefined, owner);
  expect(view.frame(1 / 60, .25, 20, [sample], 60, clock(.1))).toBe(true);
  expect(fixedMemoryCensus().returned).toBe(before + 1); expect(view.isFrozen).toBe(true);
});
