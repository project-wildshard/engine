import { expect, test } from 'vitest';
import { isJsonData, isJsonDataSteps, jsonDataHeapBytes } from '@wildshard/format/json';
import { assertCellBounds, assertCellBoundsSteps } from '@wildshard/format/cellBounds';
import { preflightShardfile, preflightShardfileSteps } from '@wildshard/format/preflight';
import { productResidentBytes, productResidentBytesSteps } from '../src/client/game/shardfile/productCost';
import { emptyShardfile } from '../src/shared/host/author';

// T10: product admission's walks run in steps between drawn frames; each must give exactly its one-shot original's verdict,
// refusal message and bytes, and must actually pause on a large value.
function drain<T>(steps: Generator<void, T>): { value: T; pauses: number } {
  let pauses = 0, step = steps.next();
  while (step.done !== true) { pauses++; step = steps.next(); }
  return { value: step.value, pauses };
}
const outcome = (run: () => unknown): string => { try { return `ok ${JSON.stringify(run())}`; } catch (error) { return `refused ${error instanceof Error ? error.message : String(error)}`; } };

function cases(): unknown[] {
  const cycle: Record<string, unknown> = { a: 1 }; cycle['self'] = cycle;
  const deep: Record<string, unknown> = {}; let at = deep; for (let i = 0; i < 70; i++) { const next = {}; at['n'] = next; at = next; }
  const holes: unknown[] = [1, 2]; holes[4] = 3;
  const extra: unknown[] = [1, 2]; Reflect.set(extra, 'name', 'x');
  const accessor = {}; Object.defineProperty(accessor, 'x', { enumerable: true, get: () => 1 });
  const hidden = {}; Object.defineProperty(hidden, 'x', { enumerable: false, value: 1 });
  const symbol = { [Symbol('s')]: 1 };
  const shared = { leaf: 1 };
  return [null, 1, 'text', true, { a: [1, 'b', { c: null }] }, Object.assign(Object.create(null) as object, { a: 1 }), { a: shared, b: shared },
    Number.NaN, -0, { a: Infinity }, cycle, deep, holes, extra, accessor, hidden, symbol, new Map(), [new Date()], { f: () => 1 },
    Array.from({ length: 120_000 }, () => 0), { rows: Array.from({ length: 40_000 }, (_, i) => ({ i, s: `x${i}` })) }];
}

test('the stepped plain-JSON fence matches isJsonData on every case and pauses on large values', () => {
  for (const value of cases()) expect(drain(isJsonDataSteps(value, 64)).value).toBe(isJsonData(value));
  const large = { rows: Array.from({ length: 5000 }, (_, i) => ({ i })) };
  expect(drain(isJsonDataSteps(large, 1000)).pauses).toBeGreaterThan(5);
});

test('the stepped bounds walk refuses the same node with the same path', () => {
  const rows = [
    { list: [{ a: 1 }, { place: { min: [0, 0, 0], max: [251, 1, 1] } }], later: { min: [0, 0, 0], max: [999, 1, 1] } },
    { zones: [{ zone: { x0: 2, x1: 1, z0: 0, z1: 1 } }, { zone: { x0: -999, x1: 1, z0: 0, z1: 1 } }] },
    { fine: { x0: 0, x1: 1, z0: 0, z1: '1' }, box: { min: [0, 0, 0], max: [1, 1, 1] } },
    { bad: Number.NaN },
  ];
  for (const value of rows) expect(outcome(() => { drain(assertCellBoundsSteps(value, 'scene', 2)); })).toBe(outcome(() => { assertCellBounds(value, 'scene'); }));
});

test('stepped preflight gives the same verdict and message as preflightShardfile', () => {
  const source = (): Record<string, unknown> => ({ ...structuredClone(emptyShardfile({ slug: 'steps', name: 'Steps', author: 'T', revision: 1, seed: 1 })) });
  const variants: ((s: Record<string, unknown>) => void)[] = [
    () => undefined,
    s => { s['extra'] = { id: 'x'.repeat(129) }; },
    s => { s['extra'] = { text: 'y'.repeat(4097), id: 'z'.repeat(200) }; },
    s => { s['extra'] = [{ name: 'é'.repeat(64) }, { ['k'.repeat(129)]: 1 }]; },
    s => { s['pad'] = Array.from({ length: 600 }, () => 'p'.repeat(4000)); },
    s => { s['files'] = [{ hash: 'a'.repeat(64), compressed: 1 }, { hash: 'a'.repeat(64), compressed: 2 }]; },
    s => { s['files'] = [{ hash: 'nothex', compressed: 1 }]; },
    s => { s['bounds'] = { min: [0, 0, 0], max: [300, 1, 1] }; },
    s => { s['bad'] = -0; },
    // A long ordinary value can enter the length memo before the same text
    // appears as an identifier. Its stricter limit must still refuse it.
    s => { const text = 'é🐟'.repeat(50); s['extra'] = { text, id: text }; },
    s => { s['extra'] = Array.from({ length: 600 }, () => 'é🐟\\\"\n'.repeat(400)); },
  ];
  for (const vary of variants) {
    const one = source(), two = source(); vary(one); vary(two);
    expect(outcome(() => { drain(preflightShardfileSteps(two, 16)); })).toBe(outcome(() => { preflightShardfile(one); }));
  }
});

test('preflight string lengths stay local and count repeated escaped values', () => {
  const source = { ...emptyShardfile({ slug: 'steps', name: 'Steps', author: 'T', revision: 1, seed: 1 }),
    extra: { value: 'é🐟\\\"\n', rows: Array.from({ length: 20 }, () => 'é🐟\\\"\n') } };
  expect(() => preflightShardfile(source)).not.toThrow();
  expect(() => drain(preflightShardfileSteps(source, 1))).not.toThrow();
  source.extra.rows = Array.from({ length: 600 }, () => 'x'.repeat(4000));
  expect(() => preflightShardfile(source)).toThrow('source exceeds admission cap');
  expect(() => drain(preflightShardfileSteps(source, 16))).toThrow('source exceeds admission cap');
  source.extra.rows = ['é🐟\\\"\n'];
  expect(() => preflightShardfile(source)).not.toThrow();
  expect(() => drain(preflightShardfileSteps(source, 1))).not.toThrow();
  const text = 'é🐟'.repeat(50);
  Reflect.set(source, 'extra', { text, id: text });
  expect(() => preflightShardfile(source)).toThrow('string exceeds admission cap');
  expect(() => drain(preflightShardfileSteps(source, 1))).toThrow('string exceeds admission cap');
});

test('repeated escaped text spends the exact serialized UTF-8 source cap', () => {
  const source = { files: [], requires: { commons: [] }, rows: [] as string[] };
  const encoded = (): number => new TextEncoder().encode(JSON.stringify(source)).length;
  const cap = 2_000_000, text = 'é🐟"\\\n\uD800'.repeat(100);
  const width = new TextEncoder().encode(JSON.stringify(text)).length + 1;
  source.rows = Array.from({ length: Math.floor((cap - encoded() - 3) / width) }, () => text);
  source.rows.push('');
  const remaining = cap - encoded();
  expect(remaining).toBeLessThanOrEqual(4096);
  source.rows[source.rows.length - 1] = 'x'.repeat(remaining);
  expect(encoded()).toBe(cap);
  expect(() => preflightShardfile(source)).not.toThrow();
  expect(() => drain(preflightShardfileSteps(source, 64))).not.toThrow();
  source.rows[source.rows.length - 1] += 'é';
  expect(encoded()).toBe(cap + 2);
  expect(() => preflightShardfile(source)).toThrow('source exceeds admission cap');
  expect(() => drain(preflightShardfileSteps(source, 64))).toThrow('source exceeds admission cap');
});

test('stepped residency bytes equal productResidentBytes', () => {
  const source = emptyShardfile({ slug: 'steps', name: 'Steps', author: 'T', revision: 1, seed: 1 });
  Reflect.set(source, 'rows', Array.from({ length: 3000 }, (_, i) => ({ id: `row-${i}`, x: i * 0.5, tags: ['a', 'é'] })));
  const stepped = drain(productResidentBytesSteps(source, 500));
  expect(stepped.value).toBe(productResidentBytes(source));
  const heap = jsonDataHeapBytes(source);
  if (heap === undefined) throw new Error('Invalid accounting fixture');
  expect(stepped.value).toBe(heap * 2 + 1024);
  expect(stepped.pauses).toBeGreaterThan(5);
});

test('preflight accounts every source occurrence without a second heap walk', () => {
  const shared = { leaf: 'é🐟' };
  const source = { first: shared, second: shared, list: [null, true, false, 1.5, '"\\\n'],
    plain: Object.assign(Object.create(null) as object, { nested: [shared, [], {}] }) };
  const expected = jsonDataHeapBytes(source), sync = { heapBytes: -1 }, stepped = { heapBytes: -1 };
  preflightShardfile(source, sync);
  expect(drain(preflightShardfileSteps(source, 2, stepped)).pauses).toBeGreaterThan(0);
  expect(sync.heapBytes).toBe(expected); expect(stepped.heapBytes).toBe(expected);
  const repeated = { first: { leaf: 1 }, second: { leaf: 1 } }, accounting = { heapBytes: 0 };
  preflightShardfile(repeated, accounting); expect(accounting.heapBytes).toBe(406);
});

test('refused or unfinished preflight cannot publish residency accounting', () => {
  const source = emptyShardfile({ slug: 'steps', name: 'Steps', author: 'T', revision: 1, seed: 1 });
  const accounting = { heapBytes: -1 }, steps = preflightShardfileSteps(source, 1, accounting);
  expect(steps.next().done).toBe(false); expect(accounting.heapBytes).toBe(-1); steps.return();
  for (const invalid of [{ bad: -0 }, { zone: { x0: 2, x1: 1, z0: 0, z1: 1 } },
    { files: [{ hash: 'a'.repeat(64), compressed: 1 }, { hash: 'a'.repeat(64), compressed: 2 }] }]) {
    expect(() => preflightShardfile(invalid, accounting)).toThrow();
    expect(() => drain(preflightShardfileSteps(invalid, 1, accounting))).toThrow();
    expect(accounting.heapBytes).toBe(-1);
  }
});
