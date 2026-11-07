// oxlint-disable-next-line import/no-nodejs-modules -- CI7: an exact-run fixture snapshot is one file in the test job.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Snapshot files live under the job's explicit directory.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The writer proves the clone with Node's prototype-checking equality.
import { isDeepStrictEqual } from 'node:util';
// oxlint-disable-next-line import/no-nodejs-modules -- Structured clone keeps Maps, bytes, signed zero and shared references.
import { deserialize, serialize } from 'node:v8';

const SHA = /^[a-f0-9]{40}$/u;
const CLONED = new Set<unknown>([Object.prototype, Array.prototype, Map.prototype, Set.prototype]);
/** The views a structured clone returns with their own type, each with a constructor over a fresh buffer. */
const VIEWS: readonly (readonly [object, (buffer: ArrayBuffer) => ArrayBufferView])[] = [
  [Uint8Array.prototype, buffer => new Uint8Array(buffer)], [Uint8ClampedArray.prototype, buffer => new Uint8ClampedArray(buffer)],
  [Int8Array.prototype, buffer => new Int8Array(buffer)], [Uint16Array.prototype, buffer => new Uint16Array(buffer)],
  [Int16Array.prototype, buffer => new Int16Array(buffer)], [Uint32Array.prototype, buffer => new Uint32Array(buffer)],
  [Int32Array.prototype, buffer => new Int32Array(buffer)], [Float32Array.prototype, buffer => new Float32Array(buffer)],
  [Float64Array.prototype, buffer => new Float64Array(buffer)], [BigInt64Array.prototype, buffer => new BigInt64Array(buffer)],
  [BigUint64Array.prototype, buffer => new BigUint64Array(buffer)],
];
const viewType = (view: ArrayBufferView): ((buffer: ArrayBuffer) => ArrayBufferView) | undefined => VIEWS.find(([prototype]) => Object.getPrototypeOf(view) === prototype)?.[1];

/** Every object once, in a fixed order a structured clone repeats; `visit` sees each object with its own keys. */
function walk(value: unknown, visit: (object: object) => void): void {
  const seen = new Set<object>(), stack: unknown[] = [value];
  for (let next = stack.pop(); next !== undefined || stack.length > 0; next = stack.pop()) {
    if (next === null || typeof next !== 'object' || seen.has(next)) continue;
    seen.add(next); visit(next);
    if (ArrayBuffer.isView(next)) continue;
    const children: unknown[] = [];
    if (next instanceof Map) for (const [key, entry] of next) children.push(key, entry);
    else if (next instanceof Set) for (const entry of next) children.push(entry);
    else for (const key of Object.keys(next)) children.push(Reflect.get(next, key));
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

/** Refuse what a structured clone would drop: prototypes, accessors, hidden or symbol keys, partial seals and views that
 *  share a buffer (Node writes each view's own bytes). */
function cloneLosses(value: unknown): string[] {
  const losses: string[] = [], buffers = new Set<ArrayBufferLike>();
  walk(value, object => {
    if (ArrayBuffer.isView(object)) {
      if (object.byteOffset !== 0 || object.byteLength !== object.buffer.byteLength || buffers.has(object.buffer)) losses.push('a view sharing its buffer');
      if (viewType(object) === undefined) losses.push('a view of another type');
      buffers.add(object.buffer);
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(object);
    if (!CLONED.has(prototype)) losses.push(prototype === null ? 'a null-prototype object' : `a ${typeof prototype === 'object' && typeof prototype.constructor === 'function' ? prototype.constructor.name : 'foreign'} instance`);
    if (!Object.isFrozen(object) && (Object.isSealed(object) || !Object.isExtensible(object))) losses.push('a sealed object');
    if (Object.getOwnPropertySymbols(object).length > 0) losses.push('a symbol key');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
      if (descriptor.get !== undefined || descriptor.set !== undefined) losses.push(`accessor ${key}`);
      else if (descriptor.enumerable !== true && !(Array.isArray(object) && key === 'length')) losses.push(`hidden key ${key}`);
    }
  });
  return [...new Set(losses)];
}

/** Indices, in walk order, of the objects the original froze; a clone thaws them. */
function frozenIndices(value: unknown): number[] {
  const frozen: number[] = []; let index = 0;
  walk(value, object => { if (!ArrayBuffer.isView(object) && Object.isFrozen(object)) frozen.push(index); index++; });
  return frozen;
}

function refreeze(value: unknown, frozen: readonly number[]): void {
  const wanted = new Set(frozen); let index = 0;
  walk(value, object => { if (wanted.has(index)) Object.freeze(object); index++; });
}

/** Node's deserializer hands views into its one input buffer at any offset; the writer only admitted views that own
 *  their whole buffer, so each becomes one again (aligned readers such as glTF's Uint32Array header need it). */
function ownBuffers(value: unknown): unknown {
  const copies = new Map<ArrayBufferView, ArrayBufferView>();
  const own = (entry: unknown): unknown => {
    if (!ArrayBuffer.isView(entry)) return entry;
    const known = copies.get(entry); if (known !== undefined) return known;
    const type = viewType(entry);
    if (type === undefined) throw new Error('Fixture snapshot holds a view of another type');
    const buffer = new ArrayBuffer(entry.byteLength);
    new Uint8Array(buffer).set(new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength));
    const copy = type(buffer);
    copies.set(entry, copy); return copy;
  };
  walk(value, object => {
    if (ArrayBuffer.isView(object)) return;
    // Rebuilt in their own order: consumers iterate these tables.
    if (object instanceof Map) {
      const entries = [...object].map(([key, entry]) => [own(key), own(entry)] as const);
      object.clear(); for (const [key, entry] of entries) object.set(key, entry);
    } else if (object instanceof Set) {
      const entries = [...object].map(own);
      object.clear(); for (const entry of entries) object.add(entry);
    } else for (const key of Object.keys(object)) Reflect.set(object, key, own(Reflect.get(object, key)));
  });
  return own(value);
}

interface Snapshot { readonly name: string; readonly sha: string; readonly frozen: readonly number[]; readonly value: unknown }

function writeSnapshot(file: string, name: string, sha: string, value: unknown): void {
  const losses = cloneLosses(value);
  if (losses.length > 0) throw new Error(`Fixture snapshot ${name} would not clone exactly: ${losses.slice(0, 5).join(', ')}`);
  const frozen = frozenIndices(value), bytes = serialize({ name, sha, frozen, value } satisfies Snapshot);
  const back = readValue(bytes, name, sha);
  if (!isDeepStrictEqual(back, value) || !isDeepStrictEqual(frozenIndices(back), frozen)) throw new Error(`Fixture snapshot ${name} differs after a clone`);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(`${file}.partial`, bytes); renameSync(`${file}.partial`, file);
}

function readValue(bytes: Uint8Array, name: string, sha: string): unknown {
  const snapshot: unknown = deserialize(bytes);
  if (snapshot === null || typeof snapshot !== 'object') throw new Error(`Fixture snapshot ${name} is not a snapshot`);
  const frozen: unknown = Reflect.get(snapshot, 'frozen');
  if (Reflect.get(snapshot, 'name') !== name || Reflect.get(snapshot, 'sha') !== sha) throw new Error(`Fixture snapshot ${name} belongs to another fixture or commit`);
  if (!Array.isArray(frozen) || !frozen.every(index => Number.isSafeInteger(index))) throw new Error(`Fixture snapshot ${name} has no freeze list`);
  const value = ownBuffers(Reflect.get(snapshot, 'value'));
  refreeze(value, frozen.filter((index): index is number => typeof index === 'number'));
  return value;
}

/**
 * CI7: an expensive program fixture computed once per CI run instead of once per importing file. The fixtures CI job sets
 * `WS_FIXTURE_SNAPSHOT_WRITE` and writes `<name>.v8` after refusing any value a structured clone would not return
 * exactly (class instances, accessors, hidden or symbol keys, shared buffers; frozen objects are frozen again on read).
 * Test shards of the same commit (`WS_TEST_PRODUCTS_SHA`, set only after the exact-run artifacts verify) read it from
 * `WS_FIXTURE_SNAPSHOTS`. Everywhere else, and in DOM suites whose realm can differ, `compute` runs as before.
 */
export async function runSnapshot<T>(name: string, compute: () => Promise<T>): Promise<T> {
  const { WS_FIXTURE_SNAPSHOTS: read = '', WS_FIXTURE_SNAPSHOT_WRITE: write = '', WS_TEST_PRODUCTS_SHA: sha = '' } = process.env;
  if (!SHA.test(sha) || 'document' in globalThis || !/^[a-z0-9-]+$/u.test(name)) return compute();
  if (write !== '') {
    const value = await compute();
    writeSnapshot(resolve(write, `${name}.v8`), name, sha, value);
    return value;
  }
  const file = resolve(read, `${name}.v8`);
  if (read === '' || !existsSync(file)) return compute();
  // The same commit's `compute` wrote this value and the writer proved its clone equal, so it is that T.
  return readValue(readFileSync(file), name, sha) as T;
}

/** Compiler envelopes are primitive text: unlike objects and views, they have
 * no realm-specific prototype. Their consumers still parse and admit them in
 * their own realm. Keep the general object snapshot's DOM refusal unchanged. */
export async function runTextSnapshot(name: string, compute: () => Promise<string>): Promise<string> {
  const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new Error(`Fixture snapshot ${name} is not primitive text`);
    return value;
  };
  const { WS_FIXTURE_SNAPSHOTS: read = '', WS_FIXTURE_SNAPSHOT_WRITE: write = '', WS_TEST_PRODUCTS_SHA: sha = '' } = process.env;
  if (!SHA.test(sha) || !/^[a-z0-9-]+$/u.test(name)) return text(await compute());
  if (write !== '') {
    const value = text(await compute());
    writeSnapshot(resolve(write, `${name}.v8`), name, sha, value);
    return value;
  }
  const file = resolve(read, `${name}.v8`);
  if (read === '' || !existsSync(file)) return text(await compute());
  return text(readValue(readFileSync(file), name, sha));
}
