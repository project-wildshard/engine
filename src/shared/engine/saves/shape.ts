// WIRE-STABILITY WR7: a persisted save keeps fields this build does not know. A read parses only the fields its schema
// names (`known`), so a newer build's addition never resets a key, and a write puts the stored document's other fields
// back (`keepUnknown`), so a read-modify-write through an older build keeps a newer build's data. `saveShape` is the
// canonical shape that `saves.lock.json` fingerprints.
import * as v from 'valibot';

type Node = Readonly<Record<string, unknown>> & { readonly type: string };
type Schema = v.GenericSchema<unknown, unknown>;
const node = (schema: unknown): Node => schema as Node;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const OBJECTS: ReadonlySet<string> = new Set(['object', 'loose_object', 'strict_object', 'object_with_rest']);
const WRAPPERS: ReadonlySet<string> = new Set(['nullable', 'optional', 'nullish', 'exact_optional', 'undefinedable', 'non_nullable', 'non_optional', 'non_nullish']);
const entriesOf = (schema: Node): Readonly<Record<string, Schema>> => schema['entries'] as Record<string, Schema>;
const optionsOf = (schema: Node): readonly Schema[] => schema['options'] as Schema[];
const lazy = (schema: Node, input: unknown): Schema => (schema['getter'] as (input: unknown) => Schema)(input);
/** A lazy getter that cannot answer without its input: whatever it reaches is unknown. */
const OPAQUE: Node = { type: 'opaque' };
/** The schemas directly inside `schema`. A lazy one's is its getter's answer with no input. */
function children(s: Node): unknown[] {
  const out: unknown[] = [];
  for (const key of ['wrapped', 'item', 'value', 'rest']) if (record(s[key])) out.push(s[key]);
  if (record(s['entries'])) out.push(...Object.values(s['entries']));
  for (const key of ['items', 'options']) if (Array.isArray(s[key])) out.push(...(s[key] as unknown[]).filter(record));
  if (s.type === 'lazy') { try { out.push(lazy(s, undefined)); } catch { return [OPAQUE]; } }
  return out.filter(child => child === OPAQUE || (record(child) && child['kind'] === 'schema'));
}
/** Which object types a schema reaches, once per schema: `strict` for `known`, `objects` for `keepUnknown`. Most save
 *  values (numbers, strings, the JSON slots) reach none, and are returned as they are. */
const reached = new WeakMap<object, { readonly strict: boolean; readonly objects: boolean }>();
function reaches(schema: Schema): { readonly strict: boolean; readonly objects: boolean } {
  const cached = reached.get(schema);
  if (cached !== undefined) return cached;
  let strict = false, objects = false;
  const seen = new Set<unknown>(), stack: unknown[] = [schema];
  while (stack.length > 0 && !(strict && objects)) {
    const s = node(stack.pop()); if (seen.has(s)) continue; seen.add(s);
    if (s.type === 'strict_object' || s === OPAQUE) strict = true;
    if (OBJECTS.has(s.type) || s === OPAQUE) objects = true;
    if (seen.size < 4096) stack.push(...children(s)); else { strict = true; objects = true; }
  }
  const result = { strict, objects };
  reached.set(schema, result); return result;
}

/** The option of a union or variant that `value` is, after its unknown fields are set aside. */
function optionOf(schema: Node, value: unknown): Schema | undefined {
  if (schema.type === 'variant') {
    const key = schema['key'] as string;
    if (!record(value)) return undefined;
    return optionsOf(schema).find(option => { const tag = entriesOf(node(option))[key]; return tag !== undefined && v.is(tag, value[key]); });
  }
  return optionsOf(schema).find(option => v.is(option, known(option, value)));
}

/** `value` without the fields a strict object of `schema` does not name, at every level the schema reaches. A loose or
 *  plain object keeps them: valibot already passes or drops them. */
export function known(schema: Schema, value: unknown): unknown {
  if (!reaches(schema).strict) return value;
  const s = node(schema);
  if (WRAPPERS.has(s.type)) return value === null || value === undefined ? value : known(s['wrapped'] as Schema, value);
  if (s.type === 'lazy') return known(lazy(s, value), value);
  if (OBJECTS.has(s.type) && record(value)) {
    const entries = entriesOf(s), out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      const sub = Object.hasOwn(entries, key) ? entries[key] : undefined;
      if (sub !== undefined) out[key] = known(sub, field);
      else if (s.type !== 'strict_object') out[key] = field;
    }
    return out;
  }
  if (s.type === 'record' && record(value)) return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, known(s['value'] as Schema, field)]));
  if (s.type === 'array' && Array.isArray(value)) return value.map(item => known(s['item'] as Schema, item));
  if ((s.type === 'tuple' || s.type === 'strict_tuple' || s.type === 'loose_tuple') && Array.isArray(value)) {
    const items = s['items'] as Schema[];
    return value.map((item: unknown, index) => { const sub = items[index]; return sub === undefined ? item : known(sub, item); });
  }
  if (s.type === 'union' || s.type === 'variant') { const option = optionOf(s, value); return option === undefined ? value : known(option, value); }
  return value;
}

/** Array items keep their unknown fields by `id` when every item has a string one, or by place when the length is the same. */
function pairs(prior: readonly unknown[], next: readonly unknown[]): (unknown)[] {
  const id = (item: unknown): string | undefined => record(item) && typeof item['id'] === 'string' ? item['id'] : undefined;
  if (prior.every(item => id(item) !== undefined) && next.every(item => id(item) !== undefined)) {
    const byId = new Map(prior.map(item => [id(item), item]));
    return next.map(item => byId.get(id(item)));
  }
  return prior.length === next.length ? [...prior] : next.map(() => undefined);
}

/** `next`, with each field of `prior` that `schema` does not name and `next` does not set put back. Known fields are
 *  always `next`'s: a writer may still clear one. */
export function keepUnknown(schema: Schema, prior: unknown, next: unknown): unknown {
  if (prior === undefined || prior === null || next === undefined || next === null || !reaches(schema).objects) return next;
  const s = node(schema);
  if (WRAPPERS.has(s.type)) return keepUnknown(s['wrapped'] as Schema, prior, next);
  if (s.type === 'lazy') return keepUnknown(lazy(s, next), prior, next);
  if (OBJECTS.has(s.type) && record(prior) && record(next)) {
    const entries = entriesOf(s), out: Record<string, unknown> = { ...next };
    for (const [key, field] of Object.entries(prior)) {
      const sub = Object.hasOwn(entries, key) ? entries[key] : undefined;
      if (sub === undefined) { if (!Object.hasOwn(next, key)) out[key] = field; }
      else if (Object.hasOwn(next, key)) out[key] = keepUnknown(sub, field, next[key]);
    }
    return out;
  }
  if (s.type === 'record' && record(prior) && record(next)) {
    return Object.fromEntries(Object.entries(next).map(([key, field]) => [key, Object.hasOwn(prior, key) ? keepUnknown(s['value'] as Schema, prior[key], field) : field]));
  }
  if (s.type === 'array' && Array.isArray(prior) && Array.isArray(next)) {
    const matched = pairs(prior, next);
    return next.map((item, index) => keepUnknown(s['item'] as Schema, matched[index], item));
  }
  if ((s.type === 'tuple' || s.type === 'strict_tuple' || s.type === 'loose_tuple') && Array.isArray(prior) && Array.isArray(next)) {
    const items = s['items'] as Schema[];
    return next.map((item: unknown, index) => { const sub = items[index]; return sub === undefined ? item : keepUnknown(sub, prior[index] as unknown, item); });
  }
  if (s.type === 'union' || s.type === 'variant') {
    const option = optionOf(s, next);
    // Only within one option: a variant that changed its tag keeps none of the old arm's fields.
    return option !== undefined && optionOf(s, prior) === option ? keepUnknown(option, prior, next) : next;
  }
  return next;
}

/** A schema's canonical shape: types, fields, bounds and literals, never a function's source. */
export function saveShape(schema: Schema, depth = 0): unknown {
  const s = node(schema);
  if (depth > 32) return { type: s.type };
  const out: Record<string, unknown> = { type: s.type };
  const sub = (child: unknown): unknown => saveShape(child as Schema, depth + 1);
  const plain = (value: unknown): unknown => typeof value === 'function' ? 'fn' : value instanceof RegExp ? String(value) : value;
  if (record(s['entries'])) out['entries'] = Object.fromEntries(Object.keys(s['entries']).sort().map(key => [key, sub((s['entries'] as Record<string, unknown>)[key])]));
  for (const key of ['wrapped', 'item', 'key', 'value', 'rest']) if (record(s[key]) && (s[key] as Node)['kind'] === 'schema') out[key] = sub(s[key]);
  if (s.type === 'variant') out['key'] = s['key'];
  if (Array.isArray(s['items'])) out['items'] = (s['items'] as unknown[]).map(sub);
  if (Array.isArray(s['options'])) out['options'] = (s['options'] as unknown[]).map(option => record(option) && option['kind'] === 'schema' ? sub(option) : plain(option));
  if ('literal' in s) out['literal'] = s['literal'];
  if ('default' in s && s['default'] !== undefined) out['default'] = typeof s['default'] === 'function' ? 'fn' : s['default'];
  const action = (step: Node): unknown => {
    if (step['kind'] === 'schema') return sub(step);
    const shape: Record<string, unknown> = { type: step.type };
    if ('requirement' in step) shape['requirement'] = plain(step['requirement']);
    return shape;
  };
  if (Array.isArray(s['pipe'])) out['pipe'] = (s['pipe'] as Node[]).slice(1).map(action);
  return out;
}
