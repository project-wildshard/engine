// oxlint-disable-next-line import/no-nodejs-modules -- The sim's sources and their digest.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The sim's sources are files.
import { globSync, readFileSync } from 'node:fs';
import { parseSync } from 'vite';
import { expect, test } from 'vitest';
import { portableMath as authored } from '../src/commons/bake/portableMath';
import { installPortableMath, portableMath, portableMathInstalled } from '../src/shared/engine/core/portableMath';

// Why a tape comes out the same on an iPhone, a Mac and a Linux server: the sim's Math is pure JS over + - * / and sqrt. These
// are what would quietly undo that. docs/process/DEPLOY.md has the measurement.

/** mulberry32, so the grid never leans on a platform's generator. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COUNT = 100_000, rng = seeded(0x5EED), xs = Float64Array.from({ length: COUNT }, () => (rng() - .5) * 40), ys = Float64Array.from({ length: COUNT }, () => (rng() - .5) * 20);
const digest = (fn: (x: number, y: number) => number): string => createHash('sha256').update(new Uint8Array(xs.map((x, at) => fn(x, ys[at] ?? 0)).buffer)).digest('hex').slice(0, 16);

const { sin, cos, tan, exp, log, atan, atan2, asin, acos, pow, hypot } = portableMath;
const table = (math: typeof authored): Record<string, string> => ({ sin: digest(math.sin), cos: digest(math.cos), tan: digest(math.tan), exp: digest(x => math.exp(x / 2)),
  log: digest(x => math.log(Math.abs(x) + 1e-3)), atan: digest(math.atan), atan2: digest(math.atan2), asin: digest(x => math.asin(x / 21)), acos: digest(x => math.acos(x / 21)),
  pow: digest((x, y) => math.pow(Math.abs(x), y)), powInt: digest((x, y) => math.pow(x, Math.round(y))) });

test('the functions hold their bits on every platform', () => {
  expect(table({ sin, cos, tan, exp, log, atan, atan2, asin, acos, pow })).toEqual({
    sin: '427e004e98a8f70f', cos: 'd3a9d88489818941', tan: '2431411d86846a5c', exp: '318c635172effeee', log: 'a97924ef7a01bf7b', atan: 'efe358ba0915db63',
    atan2: '35d9dd66856576ba', asin: '5d04a6e2f8d2011b', acos: 'acf7613ff54ddd91', pow: '526803b6bc82b783', powInt: 'f3af5dd321427fcb',
  });
});

test('hypot is V8\'s, so V8 keeps its bits and JavaScriptCore takes them', () => {
  for (let at = 0; at < 20_000; at++) {
    const x = xs[at] ?? 0, y = ys[at] ?? 0, z = xs[at + 1] ?? 0;
    expect(hypot(x, y)).toBe(Math.hypot(x, y));
    expect(hypot(x, y, z)).toBe(Math.hypot(x, y, z));
  }
  expect([hypot(), hypot(0, 0), hypot(Infinity, Number.NaN), hypot(Number.NaN, 1), hypot(-3, 4), hypot(1e308, 1e308)]).toEqual([0, 0, Infinity, Number.NaN, 5, Math.hypot(1e308, 1e308)]);
  expect(digest(hypot)).toBe('5926569909fd1e95');
});

test('the sim\'s table and the authors\' are one table', () => {
  expect(table(portableMath)).toEqual(table(authored));
  const body = (file: string, end: string): string => { const text = readFileSync(file, 'utf8'); return text.slice(text.indexOf('// captured before any install'), text.indexOf(end)); };
  expect(body('src/shared/engine/core/portableMath.ts', 'const SIM_MATH')).toBe(body('src/commons/bake/portableMath.ts', '/** Install the platform-stable'));
});

test('installing is the whole of it, and idempotent', () => {
  const saved = Object.keys(portableMath).map(name => [name, Reflect.get(Math, name)] as const);
  try {
    installPortableMath(); installPortableMath();
    expect(portableMathInstalled()).toBe(true);
    // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
    expect(Math.pow(2.5, 1.5)).toBe(pow(2.5, 1.5));
  } finally { for (const [name, fn] of saved) Reflect.set(Math, name, fn); }
});

test('the exponents a sim file may keep round as multiplication does', () => {
  for (const x of xs) expect(x ** 2).toBe(x * x);
  for (let n = 0; n < 64; n++) { let out = 1; for (let at = 0; at < n; at++) out *= 2; expect(2 ** n).toBe(out); }
});

interface Found { readonly file: string; readonly line: number; readonly text: string }
/** Every `**` that isn't a square or a power of two, and every Math function nothing replaces. */
function unportable(file: string): Found[] {
  const source = readFileSync(file, 'utf8'), found: Found[] = [], text = (node: { start: number; end: number }): string => source.slice(node.start, node.end);
  if (!/\*\*|Math\.(?:sinh|cosh|tanh|asinh|acosh|atanh|expm1|log1p|log10|cbrt)\b/u.test(source)) return found;
  const report = (node: { start: number; end: number }): void => { found.push({ file, line: source.slice(0, node.start).split('\n').length, text: text(node).slice(0, 60) }); };
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object' || node === null) return;
    const row = node as { type?: string; operator?: string; left?: { start: number; end: number }; right?: { start: number; end: number }; object?: { start: number; end: number }; property?: { start: number; end: number }; start: number; end: number };
    if ((row.operator === '**' || row.operator === '**=') && row.left !== undefined && row.right !== undefined && text(row.right) !== '2' && text(row.left) !== '2') report(row);
    if (row.type === 'MemberExpression' && row.object !== undefined && row.property !== undefined && text(row.object) === 'Math' && /^(?:sinh|cosh|tanh|asinh|acosh|atanh|expm1|log1p|log10|cbrt)$/u.test(text(row.property))) report(row);
    Object.values(row).forEach(walk);
  };
  walk(parseSync(file, source).program);
  return found;
}

test('no sim source goes round the table', () => {
  // seam colours are a bake's error measure, and an audio voice never reaches the state
  const beside = /^src\/engine\/shared\/(?:sim\/seam(?:Error|Lattice)\.ts|audio\/)/u;
  const files = ['src/shared/engine', 'src/server/engine', 'src/shared/game', 'src/server/game'].flatMap(root => globSync(`${root}/**/*.ts`))
    .filter(file => !file.endsWith('.test.ts') && !file.endsWith('.generated.ts') && !beside.test(file));
  expect(files.length).toBeGreaterThan(500);
  expect(files.flatMap(unportable)).toEqual([]);
});

test.each(['src/client/app/entry.ts', 'src/server/host/standalone/serverWorker.ts', 'src/server/host/bake/headlessWorker.ts', 'test/fixtures/headless/worker.ts', 'test/fixtures/headless/folderSession.ts',
  'test/fixtures/headless-native.ts', 'test/fixtures/headless-worker.ts', ...globSync('test/fixtures/headless/*-run.{ts,mjs}')])('%s puts the Math in first', file => {
  const first = /^(?:\s*(?:\/\/.*)?\n)*\s*import ['"]([^'"]+)['"]/u.exec(readFileSync(file, 'utf8'));
  expect(first?.[1]).toMatch(/portableMathFirst(?:\.ts)?$/u);
});
