import { expect, test } from 'vitest';
import { parseWorldScenePlacementPage } from '@wildshard/format/worldScenePlacement';
import { parseWorldScenePlacementPageText, plainPlacementPage } from './placementPageText';

// MG10 / EM17: the text path never admits a page the pinned format's schema refuses, and what it admits equals that
// schema's output. A seeded fuzz of valid pages and their mutations, checked against the schema itself (shard-format
// carries the same fuzz for its copy).

type Random = () => number;
type Bag = Record<string, unknown>;
const NEG0 = '@@neg0@@', INF = '@@inf@@', PROTO = '@@proto@@';
/** JSON text with what JSON.stringify cannot write: -0, an overflowing literal, an own `__proto__` key. */
const text = (value: unknown): string => JSON.stringify(value).replaceAll(`"${NEG0}"`, '-0').replaceAll(`"${INF}"`, '1e999').replaceAll(`"${PROTO}"`, '"__proto__"');
function seeded(seed: number): Random {
  let state = seed;
  return () => { state = (state * 48_271) % 2_147_483_647; return state / 2_147_483_647; };
}
const pick = <T>(random: Random, list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
const chance = (random: Random, odds: number): boolean => random() < odds;
const num = (random: Random, low = -1000, high = 1000): number => Math.round((low + random() * (high - low)) * 1000) / 1000 || 0;
const count = (random: Random, most: number): number => Math.floor(random() * most);
const many = <T>(length: number, make: (unused: unknown, index: number) => T): T[] => Array.from({ length }, make);
const LEAVES: readonly unknown[] = ['a', '', '福德祠', true, false, null];
function json(random: Random, depth: number): unknown {
  const kind = random();
  if (depth > 2 || kind < 0.5) return chance(random, 0.5) ? num(random) : pick(random, LEAVES);
  if (kind < 0.75) return many(count(random, 4), () => json(random, depth + 1));
  return Object.fromEntries(many(count(random, 4), () => [`k${String(random())}`, json(random, depth + 1)]));
}
const set = (bag: Bag, random: Random, odds: number) => (entries: Bag): Bag => {
  for (const [key, value] of Object.entries(entries)) if (chance(random, odds)) bag[key] = value;
  return bag;
};
function pose(random: Random): Bag {
  const out = set({ x: num(random), y: num(random), z: num(random) }, random, 0.3)({ variant: pick(random, ['plaque', 'a']),
    color: [num(random, 0, 1), num(random, 0, 1), num(random, 0, 1)], params: { style: 'plaque', size: num(random, 0, 1), nested: json(random, 1) } });
  if (chance(random, 0.5)) { out['matrix'] = many(16, () => num(random, -2, 2)); return out; }
  out['yxz'] = set({ yaw: num(random, -3, 3), scale: num(random, 0.1, 3) }, random, 0.3)({ yawAtan2: [num(random, -1, 1), num(random, -1, 1)], pitch: num(random, -1, 1), roll: num(random, -1, 1) });
  return out;
}
const tierNumber = (random: Random): unknown => chance(random, 0.5) ? num(random, 0, 500) : { phone: num(random, 0, 300), desktop: num(random, 0, 600) };
const cull = (random: Random): Bag => set({}, random, 0.4)({ far: tierNumber(random), keepNear: num(random), minAngular: tierNumber(random), view: 'forest',
  flat: true, from: 'bounds', lodBy: 'set', bounds: 'box', frustum: false, radiusBias: num(random), step: 2 });
const floor = (random: Random): Bag => set({ x: num(random), z: num(random), hw: num(random, 0, 9), hd: num(random, 0, 9), y: num(random) }, random, 0.3)({
  rot: num(random, -3, 3), slope: num(random, -1, 1), tilt: num(random, -1, 1), profile: [[0, 1, 0], [1, 2, 0.5], [3, 0, 1]] });
const piece = (random: Random): Bag => set({ id: 'piece-a' }, random, 0.4)({ follows: 'copy', solidFloor: true, floorPolicy: pick(random, ['first', 'highest']),
  floors: many(1 + count(random, 2), () => floor(random)), name: 'p', split: 1 + count(random, 2047) });
const row = (random: Random, index: number): Bag => set({ id: `row-${String(index)}`, model: 'wall', draw: pick(random, ['single', 'instanced', 'batched', 'merged']),
  poses: many(count(random, 6), () => pose(random)) }, random, 0.3)({ tier: pick(random, ['phone', 'desktop']), batch: 'batch-a', name: 'drawn',
  drawnInto: { part: 'slab', boxes: many(6 * count(random, 3), () => num(random)) }, cull: cull(random), sortObjects: chance(random, 0.5),
  colliders: many(count(random, 3), () => json(random, 1)), piece: piece(random) });
const page = (random: Random): Bag => ({ version: 1, rows: many(chance(random, 0.4) ? 1 : 1 + count(random, 4), (_, index) => row(random, index)) });

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);
function holders(value: unknown, out: (Bag | unknown[])[] = []): (Bag | unknown[])[] {
  if (Array.isArray(value) || isBag(value)) { out.push(value); for (const child of Object.values(value)) holders(child, out); }
  return out;
}
const deep = (depth: number): unknown => depth === 0 ? 1 : { deeper: deep(depth - 1) };
const REPLACEMENTS: readonly (() => unknown)[] = [() => NEG0, () => INF, () => 1e7, () => -1, () => 0.5, () => 3000, () => '', () => 'x'.repeat(257),
  () => 'forest', () => 'phone', () => true, () => null, () => [], () => ({}), () => [1, 2, 3], () => [1, 2, 3, 4], () => many(16, () => 0), () => deep(70),
  () => ({ phone: 1 }), () => ({ phone: 1, desktop: 2 }), () => [[0, 0, 0], [0, 0, 0]], () => ({ yaw: 0, scale: 1 })];
const replacement = (random: Random): unknown => pick(random, REPLACEMENTS)?.();
const KEYS = ['zz', PROTO, 'constructor', 'matrix', 'yxz', 'rows', 'id'];
function mutate(value: Bag, random: Random): void {
  const holder = pick(random, holders(value)) ?? value, choice = random();
  if (Array.isArray(holder)) {
    if (choice < 0.25) holder.push(holder.length > 0 ? structuredClone(holder[0]) : 0);
    else if (choice < 0.4) holder.pop();
    else if (holder.length > 0) holder[count(random, holder.length)] = replacement(random);
    return;
  }
  const key = pick(random, Object.keys(holder)), rows = value['rows'];
  const [first, second]: readonly unknown[] = Array.isArray(rows) ? rows : [];
  if (choice < 0.1) { if (isBag(first) && isBag(second)) second['id'] = first['id']; }
  else if (choice < 0.3 || key === undefined) holder[pick(random, KEYS) ?? 'zz'] = replacement(random);
  else if (choice < 0.5) Reflect.deleteProperty(holder, key);
  else holder[key] = choice < 0.6 ? [holder[key]] : replacement(random);
}
function schema(source: string): { ok: boolean; page?: unknown } {
  try { return { ok: true, page: parseWorldScenePlacementPage(JSON.parse(source)) }; } catch { return { ok: false }; }
}
/** The text path agrees with the schema on `source`; true when it took the plain path. */
function agrees(source: string): boolean {
  const expected = schema(source), fast = plainPlacementPage(JSON.parse(source));
  if (fast) { expect(expected.ok, source).toBe(true); expect(JSON.parse(source)).toEqual(expected.page); }
  if (expected.ok) expect(parseWorldScenePlacementPageText(source)).toEqual(expected.page);
  else expect(() => parseWorldScenePlacementPageText(source), source).toThrow();
  return fast;
}

test('every generated valid page is used as it stands, equal to the pinned schema output', () => {
  const random = seeded(410);
  for (let round = 0; round < 300; round++) expect(agrees(text(page(random)))).toBe(true);
});

test('the text path never admits what the pinned schema refuses (a seeded fuzz of mutations)', () => {
  const random = seeded(1017), tally = { fast: 0, refused: 0 }, rounds = 4000;
  for (let round = 0; round < rounds; round++) {
    const value = page(random);
    mutate(value, random);
    if (chance(random, 0.3)) mutate(value, random);
    const source = text(value);
    tally.fast += agrees(source) ? 1 : 0; tally.refused += schema(source).ok ? 0 : 1;
  }
  expect(tally.refused).toBeGreaterThan(rounds / 3);
  expect(tally.fast).toBeGreaterThan(rounds / 20);
}, 120_000);

test('the guard keeps its bounds: many rows over 100,000 values refuse, one row counts per pose; -0 and overflow refuse', () => {
  const poses = many(6000, () => ({ x: 0, y: 0, z: 0, matrix: many(16, () => 0) })), one = { id: 'a', model: 'm', draw: 'instanced', poses };
  expect(agrees(text({ version: 1, rows: [one] }))).toBe(true);
  const two = text({ version: 1, rows: [one, { id: 'b', model: 'm', draw: 'single', poses: [] }] });
  expect(schema(two).ok).toBe(false);
  expect(agrees(two)).toBe(false);
  for (const bad of [NEG0, INF]) expect(agrees(text({ version: 1, rows: [{ id: 'a', model: 'm', draw: 'single', poses: [{ x: bad, y: 0, z: 0, yxz: { yaw: 0, scale: 1 } }] }] }))).toBe(false);
});
