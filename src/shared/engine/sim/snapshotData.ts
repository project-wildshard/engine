import { unpackSnapshotBase64 as unpack } from './snapshotBase64';
import * as v from 'valibot';
import { deflateSync, inflateSync } from 'fflate';
import { MAX_PHYSICS_BYTES, MAX_REFERENCE_BYTES, byteArray, encodePhysicsReferences, decodePhysicsReferences, validatePhysicsReferences } from './snapshotPhysics';
import type { SimValue } from '../../../server/engine/sim';
import type { SimSnapshot, SimSnapshotBytes } from './snapshot';
import { DAY_CLOCK_PHASES } from './dayClock';
import { ANIMAL_STATES } from '../entities/animalStates';

const finite = v.pipe(v.number(), v.finite());
// Reserved only in the snapshot transport. Logical clocks/memory can use infinity; native poses and physics stay finite.
const NUMBER_TAG = '$sim.number';
const taggedNumber = v.pipe(v.strictObject({ [NUMBER_TAG]: v.picklist(['infinity', '-infinity']) }),
  v.transform(value => value[NUMBER_TAG] === 'infinity' ? Infinity : -Infinity));
const scalar = v.union([v.pipe(v.number(), v.check(value => !Number.isNaN(value), 'NaN is not a snapshot number')), taggedNumber]);
const nonnegative = v.pipe(finite, v.minValue(0));
const integer = v.pipe(nonnegative, v.safeInteger());
const uint32 = v.pipe(integer, v.maxValue(0xffffffff));
const id = v.pipe(v.string(), v.minLength(1));
const version = v.literal(1);
const quest = v.strictObject({ version, id, started: v.boolean(), currentId: v.nullable(id) });
// A regional continuation is bounded independently of compressed input size. Each block
// decodes into a fixed buffer plus one overflow byte; no inflater can grow the allocation.
const maxPhysicsBytes = MAX_PHYSICS_BYTES, physicsBlockBytes = 65_536;
const maxBase64Length = Math.ceil(maxPhysicsBytes / 3) * 4;
const vector = v.tuple([finite, finite, finite]);
const point = v.strictObject({ x: finite, y: finite, z: finite });
const nullableNumber = v.nullable(finite);
const motor = v.strictObject({
  version, colliderHandle: nonnegative, filter: uint32, ghost: v.string(), enabled: v.boolean(), yaw: finite,
  anchor: point, anchorBodyHandle: v.nullable(nonnegative), climbAngle: finite, slideAngle: finite,
  result: v.strictObject({ grounded: v.boolean(), groundNormalY: finite, downhillX: finite, downhillZ: finite,
    horizontalFreedom: finite, groundColliderHandle: v.nullable(nonnegative) }),
});
// Keep recursive traversal lazy, while building its value-independent rules once.
const simValue: v.GenericSchema<SimValue> = v.union([
  v.null(), v.boolean(), scalar, v.string(), v.array(v.lazy(() => simValue)), v.record(v.string(), v.lazy(() => simValue)),
]);
type EventValue = SimSnapshot['players'][number]['health'];
const eventValue: v.GenericSchema<EventValue> = v.variant('kind', [
  v.strictObject({ kind: v.literal('value'), value: v.union([v.null(), v.boolean(), finite, v.string()]) }),
  v.strictObject({ kind: v.literal('undefined') }),
  v.strictObject({ kind: v.literal('number'), value: v.picklist(['infinity', '-infinity', 'nan']) }),
  v.strictObject({ kind: v.literal('vector'), value: vector }),
  v.strictObject({ kind: v.literal('actor'), id }), v.strictObject({ kind: v.literal('entity'), id }),
  v.strictObject({ kind: v.literal('position'), id }), v.strictObject({ kind: v.literal('player'), id: v.optional(id) }),
  v.strictObject({ kind: v.literal('array'), items: v.array(v.lazy(() => eventValue)) }),
  v.strictObject({ kind: v.literal('record'), entries: v.pipe(v.array(v.tuple([v.string(), v.lazy(() => eventValue)])),
    v.check((entries) => new Set(entries.map(([key]) => key)).size === entries.length, 'Duplicate payload key')) }),
]);
const animal = v.strictObject({
  version, id,
  motion: v.strictObject({ hp: finite, maxHp: finite, yaw: finite, speed: finite, herd: finite, desiredYaw: finite,
    desiredSpeed: finite, turnRate: finite, lookWeight: finite, seed: finite, scale: finite, strafe: finite,
    desiredStrafe: finite, yOffset: finite, attackT: finite, attackDur: finite, flinch: finite, flinchRoll: finite,
    flinchPitch: finite, stunT: finite, pushT: finite, pushDist: finite, brace: finite, deathT: finite,
    deathSide: finite, groundY: finite, tiltRollT: finite, elapsed: finite, fallVelocity: finite }),
  flags: v.strictObject({ alive: v.boolean(), harnessHold: v.boolean(), aggressive: v.boolean(), driven: v.boolean(),
    levelGround: v.boolean(), scripted: v.boolean(), falling: v.boolean() }),
  kind: v.string(), variant: v.string(), rarity: v.picklist(['common', 'uncommon', 'rare', 'legendary']), label: v.string(),
  state: v.picklist(ANIMAL_STATES),
  mods: v.strictObject({ speed: finite, chargeDist: finite, damageTaken: finite, chargeDamage: finite, relentless: v.boolean() }),
  mem: v.record(v.string(), scalar), position: vector, lookTarget: vector, pushDir: vector, impulse: vector,
  lastHitT: nullableNumber, attackTurnCap: nullableNumber,
  flight: v.nullable(v.strictObject({ version, altitude: finite, sampleIn: finite, floor: nullableNumber, smoothFloor: nullableNumber })),
});
const strike = v.strictObject({ version, phase: v.picklist(['idle', 'windup', 'active', 'recover', 'cooldown']),
  currentId: v.nullable(id), hit: v.boolean(), elapsed: nonnegative, speedMul: v.pipe(finite, v.check((value) => value > 0)),
  clock: nonnegative, deadlines: v.array(v.strictObject({ id, at: finite })), scores: v.array(v.strictObject({ id, score: finite })),
  x0: finite, z0: finite, x1: finite, z1: finite, yaw: finite, length: finite });
const rng = v.strictObject({ version, state: uint32, initial: uint32, scrambledFork: v.boolean() });
const frameIndex = v.pipe(v.number(), v.integer(), v.minValue(-1));
const bandClock = v.strictObject({ elapsed: nonnegative, credit: nonnegative, frame: frameIndex, dt: nonnegative, last: finite, due: v.boolean(), tickFrame: frameIndex });
/** A version 1 or 2 save's player: a velocity for each mode. */
const playerStateV2 = v.strictObject({ id, position: vector, yaw: finite, health: eventValue, motor, impulse: v.optional(vector),
  traversals: v.optional(v.pipe(v.array(v.picklist(['ride', 'grapple', 'glide', 'climb', 'drive'])), v.minLength(1), v.maxLength(5))),
  walk: v.optional(v.strictObject({ x: finite, z: finite })),
  moveScale: v.optional(v.pipe(nonnegative, v.check(value => value !== 1, 'Default move scale must stay omitted'))),
  fall: v.optional(v.strictObject({ vy: finite, grounded: v.boolean() })), shove: v.optional(v.strictObject({ t: finite, vx: finite, vz: finite })),
  board: v.optional(v.strictObject({ velocity: vector, air: v.boolean(), bob: finite, ground: v.boolean() })),
  swim: v.optional(v.strictObject({ on: v.boolean(), velocity: vector, diving: v.boolean(), climbTo: v.nullable(finite), climbCooldown: nonnegative, stroke: nonnegative, stood: v.boolean() })),
  jump: v.optional(v.strictObject({ ago: v.nullable(nonnegative), left: v.picklist([0, 1]) })),
  dash: v.optional(v.strictObject({ t: finite, vx: finite, vz: finite })), dodge: v.optional(v.strictObject({ cd: nonnegative, t: nonnegative })) });
const playerState = v.strictObject({ id, position: vector, yaw: finite, health: eventValue, motor, impulse: v.optional(vector),
  traversals: v.optional(v.pipe(v.array(v.picklist(['ride', 'grapple', 'glide', 'climb', 'drive'])), v.minLength(1), v.maxLength(5))),
  // `walking` was written for one day (A1, A2): every walker has run one law since
  velocity: v.optional(vector), walking: v.optional(v.literal(true)), airborne: v.optional(v.literal(true)), carried: v.optional(v.literal(true)),
  moveScale: v.optional(v.pipe(nonnegative, v.check(value => value !== 1, 'Default move scale must stay omitted'))),
  shove: v.optional(v.strictObject({ t: finite, vx: finite, vz: finite })),
  board: v.optional(v.strictObject({ air: v.boolean(), bob: finite })),
  swim: v.optional(v.strictObject({ on: v.boolean(), diving: v.boolean(), climbTo: v.nullable(finite), climbCooldown: nonnegative, stroke: nonnegative, stood: v.boolean() })),
  footing: v.optional(v.strictObject({ water: v.nullable(finite), depth: nonnegative, wading: v.boolean(), onPlatform: v.boolean(), sliding: v.boolean() })),
  lock: v.optional(v.strictObject({ target: id, r0: nonnegative })),
  jump: v.optional(v.strictObject({ ago: v.nullable(nonnegative), left: v.picklist([0, 1]) })),
  dash: v.optional(v.strictObject({ t: finite, vx: finite, vz: finite })), dodge: v.optional(v.strictObject({ cd: nonnegative, t: nonnegative })) });
const entries = {
  version: v.literal(3), apiVersion: integer, levelId: id, levelFingerprint: uint32,
  state: v.strictObject({ tick: integer, accumulator: v.pipe(finite, v.minValue(-Number.EPSILON)), timers: v.record(v.string(), nonnegative) }),
  clock: v.strictObject({ version, elapsed: nonnegative, wall: nonnegative, frames: integer,
    captureFps: v.nullable(v.pipe(finite, v.check((value) => value > 0))), paused: v.boolean(), scale: nonnegative }),
  rng: v.strictObject({ version, seed: uint32, streams: v.array(v.strictObject({
    name: v.picklist(['gameplay', 'ai', 'spawn', 'cosmetic']), state: rng })) }),
  entities: v.array(v.strictObject({ id, state: animal, motor: v.nullable(motor) })),
  players: v.pipe(v.array(playerState), v.minLength(1)),
  strikes: v.array(v.strictObject({ id, state: strike })), targets: v.array(v.tuple([id, id])),
  events: v.strictObject({ version, queue: v.array(v.strictObject({
    name: v.custom<SimSnapshot['events']['queue'][number]['name']>((input) => typeof input === 'string' && input.length > 0), payload: eventValue })),
    frameCount: v.pipe(integer, v.maxValue(1000)), frameBound: v.boolean() }),
  colliderTags: v.array(v.strictObject({ handle: nonnegative,
    material: v.picklist(['sand', 'wetSand', 'grass', 'rock', 'planks', 'stone', 'water', 'wood', 'metal', 'flesh', 'shell', 'ground', 'edge', 'felt', 'earth']), owner: eventValue })),
  flags: v.array(id), quests: v.array(quest),
  books: v.exactOptional(v.array(v.strictObject({ player: id, flags: v.array(id), quests: v.array(quest), parts: v.record(v.string(), v.string()) }))),
  slots: v.strictObject({ scriptMemory: v.record(v.string(), simValue), scriptGlobals: v.record(v.string(), simValue),
    questState: v.record(v.string(), simValue), ledgerDedupe: v.array(v.string()) }),
  adapters: v.array(v.strictObject({ id, state: simValue })),
  damage: v.optional(v.array(v.tuple([v.string(), v.array(v.tuple([v.string(), finite]))]))),
  focus: v.optional(id),
  respawn: v.optional(v.array(v.tuple([id, v.strictObject({ inside: v.nullable(v.string()), pending: v.nullable(v.string()),
    stand: v.nullable(v.strictObject({ id: v.string(), label: v.string(), x: finite, y: finite, z: finite, yaw: finite })) }), nonnegative, nonnegative]))),
  bands: v.optional(v.strictObject({ rates: uint32, time: nonnegative, frame: integer, frameDt: nonnegative,
    rows: v.array(v.strictObject({ id, rate: id, brain: bandClock, body: bandClock })) })),
  day: v.optional(v.strictObject({ value: finite, paused: v.boolean(), scale: finite, cycle: v.pipe(finite, v.minValue(Number.MIN_VALUE)),
    held: v.nullable(v.strictObject({ value: finite, paused: v.boolean() })), last: v.picklist(DAY_CLOCK_PHASES) })),
  boardColliders: v.optional(v.pipe(v.array(nonnegative), v.minLength(1))), // Rapier handles, as colliderTags'
};
const snapshot: v.GenericSchema<unknown, SimSnapshot> = v.strictObject({ ...entries,
  physics: v.pipe(v.array(v.pipe(integer, v.maxValue(255))), v.minLength(1), v.maxLength(maxPhysicsBytes)) });
const packedPhysicsSchema = v.variant('encoding', [
    v.strictObject({ encoding: v.literal('base64'), data: v.pipe(v.string(), v.minLength(4), v.maxLength(maxBase64Length)), checksum: uint32 }),
    v.strictObject({ encoding: v.literal('deflate-lz-base64-v1'), length: v.pipe(integer, v.minValue(1), v.maxValue(maxPhysicsBytes)),
      packedLength: v.pipe(integer, v.minValue(1), v.maxValue(MAX_REFERENCE_BYTES)),
      basis: v.optional(v.strictObject({ length: v.pipe(integer, v.minValue(1), v.maxValue(maxPhysicsBytes)), checksum: uint32 })),
      chunks: v.pipe(v.array(v.pipe(v.string(), v.minLength(4), v.maxLength(Math.ceil((physicsBlockBytes + 64) / 3) * 4))), v.minLength(1), v.maxLength(Math.ceil(MAX_REFERENCE_BYTES / physicsBlockBytes))), checksum: uint32 }),
]);
const packedSnapshot = v.strictObject({ ...entries, physics: packedPhysicsSchema });
// P1-E5.3-A1: a version 2 save, as the old writer left it: a velocity for each mode.
const { players: _players, ...sharedEntries } = entries;
const packedSnapshotV2 = v.strictObject({ ...sharedEntries, version: v.literal(2), players: v.pipe(v.array(playerStateV2), v.minLength(1)), physics: packedPhysicsSchema });
// P1-E5.2a: a version 1 save, as the old writer left it: one `player`, from an engine with a level API of 1.
const packedSnapshotV1 = v.strictObject({ ...sharedEntries, version, apiVersion: version, player: playerStateV2, physics: packedPhysicsSchema });
const wire = v.variant('version', [v.strictObject({ format: v.literal('sim.snapshot'), version: v.literal(3), snapshot: packedSnapshot }),
  v.strictObject({ format: v.literal('sim.snapshot'), version: v.literal(2), snapshot: packedSnapshotV2 }),
  v.strictObject({ format: v.literal('sim.snapshot'), version, snapshot: packedSnapshotV1 })]);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// A JSON-tree fence also rejects cycles/accessors/classes before lazy recursive schemas run.
function jsonTree(input: unknown, parents = new Set<object>(), depth = 0, nativeNumbers = false): void {
  if (depth > 64) throw new RangeError('Snapshot nesting exceeds 64');
  if (input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && (Number.isFinite(input) || (nativeNumbers && !Number.isNaN(input))))) return;
  if (typeof input !== 'object' || parents.has(input)) throw new TypeError('Snapshot must contain finite, acyclic JSON data');
  if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new TypeError('Snapshot must contain plain JSON objects');
  if (Object.hasOwn(input, NUMBER_TAG)) {
    if (nativeNumbers) throw new TypeError('Snapshot contains a reserved number tag');
    const tag = Object.getOwnPropertyDescriptor(input, NUMBER_TAG);
    if (Reflect.ownKeys(input).length !== 1 || tag === undefined || !('value' in tag) || !tag.enumerable
      || (tag.value !== 'infinity' && tag.value !== '-infinity')) throw new TypeError('Invalid snapshot number tag');
  }
  parents.add(input);
  for (const key of Reflect.ownKeys(input)) {
    if (Array.isArray(input) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Snapshot contains a non-JSON property');
    jsonTree(descriptor.value, parents, depth + 1, nativeNumbers);
  }
  parents.delete(input);
}
function checksum(bytes: ArrayLike<number>): number {
  let value = 2166136261;
  for (let index = 0; index < bytes.length; index++) value = Math.imul(value ^ (bytes[index] ?? 0), 16777619);
  return value >>> 0;
}
// A physics basis is immutable admitted world data: its checksum is computed once per buffer, not per autosave.
const basisChecksums = new WeakMap<Uint8Array, number>();
function basisChecksum(basis: Uint8Array): number {
  const known = basisChecksums.get(basis);
  if (known !== undefined) return known;
  const value = checksum(basis); basisChecksums.set(basis, value); return value;
}
/** One flat pass over the native byte array: a per-element schema pipe and JSON-tree walk cost ~100 ms an autosave (rt3-freeze). */
function physicsArray(input: unknown): Uint8Array {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw new TypeError('Snapshot physics must be a plain byte array');
  if (input.length === 0 || input.length > maxPhysicsBytes) throw new RangeError('Snapshot physics exceeds byte bounds');
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++) {
    const byte: unknown = input[index];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('Snapshot physics contains a non-byte value');
    bytes[index] = byte;
  }
  return bytes;
}
function pack(bytes: ArrayLike<number>): string {
  const chunks: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    chunk += alphabet[a >>> 2] ?? '';
    chunk += alphabet[((a & 3) << 4) | (b >>> 4)] ?? '';
    chunk += index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >>> 6)] ?? '' : '=';
    chunk += index + 2 < bytes.length ? alphabet[c & 63] ?? '' : '=';
    if (chunk.length >= 8192) { chunks.push(chunk); chunk = ''; }
  }
  chunks.push(chunk);
  return chunks.join('');
}
function* packedPhysics(raw: Uint8Array, basis?: Uint8Array): Generator<undefined, v.InferOutput<typeof packedSnapshot>['physics']> {
  const references = encodePhysicsReferences(raw, basis), chunks: string[] = [];
  yield;
  for (let offset = 0; offset < references.length; offset += physicsBlockBytes) chunks.push(pack(deflateSync(references.subarray(offset, offset + physicsBlockBytes), { level: 6 })));
  const hash = checksum(raw);
  // Tiny or incompressible continuations retain the original canonical encoding.
  if (chunks.reduce((size, chunk) => size + chunk.length + 3, 64) >= Math.ceil(raw.length / 3) * 4) return { encoding: 'base64', data: pack(raw), checksum: hash };
  return { encoding: 'deflate-lz-base64-v1', length: raw.length, packedLength: references.length, chunks, checksum: hash,
    ...(basis === undefined ? {} : { basis: { length: basis.length, checksum: basisChecksum(basis) } }) };
}
function physicsBytes(packed: v.InferOutput<typeof packedSnapshot>['physics'], basis: Uint8Array | undefined, mismatch: () => Error): number[] | Uint8Array {
  if (packed.encoding === 'base64') {
    const bytes = unpack(packed.data);
    if (bytes.length > maxPhysicsBytes || checksum(bytes) !== packed.checksum) throw new RangeError('Snapshot physics checksum or length mismatch');
    return bytes;
  }
  if (packed.basis !== undefined && basis === undefined) throw new RangeError('Snapshot physics basis mismatch');
  if (packed.chunks.length !== Math.ceil(packed.packedLength / physicsBlockBytes)) throw new RangeError('Invalid snapshot physics block count');
  const references = new Uint8Array(packed.packedLength);
  for (const [index, chunk] of packed.chunks.entries()) {
    const offset = index * physicsBlockBytes, length = Math.min(physicsBlockBytes, references.length - offset);
    const compressed = Uint8Array.from(unpack(chunk));
    if (compressed.length > length + 64) throw new RangeError('Invalid snapshot physics block size');
    const decoded = inflateSync(compressed, { out: new Uint8Array(length + 1) });
    if (decoded.length !== length) throw new RangeError('Snapshot physics block length mismatch');
    references.set(decoded, offset);
  }
  validatePhysicsReferences(references, packed.length, packed.basis?.length);
  if (packed.basis !== undefined && basis !== undefined && (basis.length !== packed.basis.length || basisChecksum(basis) !== packed.basis.checksum)) throw mismatch();
  const bytes = decodePhysicsReferences(references, packed.length, packed.basis === undefined ? undefined : basis);
  if (checksum(bytes) !== packed.checksum) throw new RangeError('Snapshot physics checksum mismatch');
  return bytes;
}
const health = v.strictObject({ version, attributes: v.pipe(v.record(v.string(), v.union([v.number(), v.undefined()])),
  v.check((attributes) => Number.isFinite(attributes['health']) && Number.isFinite(attributes['maxHealth']))),
  effectTags: v.array(v.string()), lastHurt: finite,
  cause: v.nullable(v.strictObject({ kind: v.string(), label: v.string(), text: v.optional(v.string()) })),
  previousMode: v.picklist(['foot', 'board', 'swim', 'ride']) });
function healthData(value: EventValue): unknown {
  switch (value.kind) {
    case 'value': return value.value;
    case 'undefined': return undefined;
    case 'number': return value.value === 'nan' ? Number.NaN : value.value === 'infinity' ? Infinity : -Infinity;
    case 'array': return value.items.map(healthData);
    case 'record': return Object.fromEntries(value.entries.map(([key, entry]) => [key, healthData(entry)]));
    case 'actor': case 'entity': case 'player': case 'position': case 'vector':
      throw new RangeError('Health continuation contains a live reference');
    default: throw new RangeError('Invalid health continuation');
  }
}

function identities(saved: SimSnapshot, apiVersion: number): SimSnapshot {
  for (const player of saved.players) v.parse(health, healthData(player.health));
  if (saved.apiVersion !== apiVersion) throw new RangeError('Incompatible simulation engine version');
  const unique = (ids: readonly (string | number)[]) => new Set(ids).size === ids.length;
  if (!unique(saved.entities.map((entity) => entity.id)) || !unique(saved.strikes.map((entry) => entry.id))
    || !unique(saved.adapters.map((entry) => entry.id)) || !unique(saved.quests.map((entry) => entry.id))
    || !unique(saved.rng.streams.map((entry) => entry.name)) || !unique(saved.colliderTags.map((entry) => entry.handle))
    || !unique(saved.targets.map(([source]) => source)) || !unique(saved.flags) || !unique(saved.players.map((player) => player.id))
    || saved.entities.some((entity) => entity.id !== entity.state.id || saved.players.some((player) => player.id === entity.id))) throw new RangeError('Invalid snapshot identities');
  return saved;
}
// JSON.parse preserves the valid numeric literal -0; JSON.stringify normally loses its sign.
function stringify(value: unknown): string {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (value === Infinity) return '{"$sim.number":"infinity"}';
  if (value === -Infinity) return '{"$sim.number":"-infinity"}';
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item: unknown) => stringify(item)).join(',')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${stringify(item)}`).join(',')}}`;
  throw new TypeError('Snapshot contains a non-JSON value');
}

/** Count the same UTF-16 wire characters without allocating parent JSON strings. */
function stringifiedLength(value: unknown): number {
  if (value === null || typeof value !== 'object') return stringify(value).length;
  let chars = 2;
  if (Array.isArray(value)) {
    chars += Math.max(0, value.length - 1);
    for (let index = 0; index < value.length; index++) if (index in value) chars += stringifiedLength(value[index]);
  } else {
    let separator = 0;
    for (const [key, item] of Object.entries(value)) {
      chars += separator + JSON.stringify(key).length + 1 + stringifiedLength(item); separator = 1;
    }
  }
  return chars;
}

/** Run a staged job to completion in one call (the synchronous form of every `*Steps` writer). */
export function finishSteps<T>(steps: Generator<undefined, T>): T {
  for (;;) { const step = steps.next(); if (step.done === true) return step.value; }
}
function prepareSnapshot(input: SimSnapshot | SimSnapshotBytes, apiVersion: number): { raw: Uint8Array; saved: SimSnapshot } {
  if ((!Array.isArray(input.physics) && !(input.physics instanceof Uint8Array)) || input.physics.length > maxPhysicsBytes) throw new RangeError('Snapshot physics exceeds 32 MB');
  const raw = input.physics instanceof Uint8Array ? input.physics.slice() : physicsArray(input.physics), metadata = { ...input, physics: [0] };
  jsonTree(metadata, new Set(), 0, true);
  return { raw, saved: identities(v.parse(snapshot, metadata), apiVersion) };
}
// packedPhysics selects compressed chunks only when sum(chunk.length + 3) + 64
// is smaller than base64(raw). Its remaining ASCII header is bounded by these
// maximum integer widths. This bound needs no assumptions about compressibility.
const physicsHeaderChars = Math.max(
  stringify({ encoding: 'base64', data: '', checksum: 0xffffffff }).length,
  stringify({ encoding: 'deflate-lz-base64-v1', length: maxPhysicsBytes, packedLength: MAX_REFERENCE_BYTES, chunks: [], checksum: 0xffffffff }).length,
);
/** Apply the writer's complete input checks and an exact accept/refuse wire-size
 * fence without encoding an unconsumed continuation. If the proven upper bound
 * cannot establish a fit, run the original encoder and check its actual length. */
export function checkSnapshotDataWire(input: SimSnapshot | SimSnapshotBytes, apiVersion: number, maximumChars: number): void {
  if (!Number.isSafeInteger(maximumChars) || maximumChars < 0) throw new RangeError('Invalid snapshot character bound');
  const { raw, saved } = prepareSnapshot(input, apiVersion);
  if (raw.length === 0) throw new RangeError('Snapshot physics exceeds byte bounds');
  const metadataChars = stringifiedLength({ format: 'sim.snapshot', version: saved.version, snapshot: { ...saved, physics: 0 } }) - 1;
  if (metadataChars + Math.ceil(raw.length / 3) * 4 + physicsHeaderChars <= maximumChars) return;
  const physics = finishSteps(packedPhysics(raw));
  if (stringify({ format: 'sim.snapshot', version: saved.version, snapshot: { ...saved, physics } }).length > maximumChars) throw new RangeError('Snapshot wire exceeds character bound');
}
/** Internal packed wire writer, in stages a caller may spread over frames (rt3-freeze: one regional autosave was a
 *  1–2.7 s main-thread task). Each `yield` is a safe pause: the input is read in the first stage only, so later stages
 *  touch nothing the live simulation can change. */
export function* serializeSnapshotDataSteps(input: SimSnapshot | SimSnapshotBytes, apiVersion: number, physicsBasis?: Uint8Array): Generator<undefined, string> {
  // The byte array is checked in one flat pass; every other field keeps the strict JSON-tree and schema validation.
  // Freeze the caller's typed input as bytes, just as physicsArray freezes legacy arrays. No boxed number[] is
  // created; cancellation and interleaved jobs own only their transient byte buffers, with no retained workspace.
  const { raw, saved } = prepareSnapshot(input, apiVersion);
  yield;
  const physics = yield* packedPhysics(raw, physicsBasis);
  yield;
  return stringify({ format: 'sim.snapshot', version: saved.version, snapshot: { ...saved, physics } });
}
/** Internal packed wire writer; the defining public entry supplies its current engine version. */
export function serializeSnapshotData(input: SimSnapshot | SimSnapshotBytes, apiVersion: number, physicsBasis?: Uint8Array): string {
  return finishSteps(serializeSnapshotDataSteps(input, apiVersion, physicsBasis));
}
/** Internal strict wire parser; unknown static fields are refused at every nesting level. */
export function decodeSnapshotData(input: unknown, apiVersion: number, physicsBasis?: Uint8Array, mismatch?: (levelId: string, tick: number) => Error): SimSnapshot {
  const saved = readSnapshotData(input, apiVersion, physicsBasis, mismatch);
  return { ...saved, physics: saved.physics instanceof Uint8Array ? byteArray(saved.physics) : saved.physics };
}
/** The same strict decoder with detached native bytes, avoiding a boxed per-byte transport round trip. */
export function decodeSnapshotDataBytes(input: unknown, apiVersion: number, physicsBasis?: Uint8Array, mismatch?: (levelId: string, tick: number) => Error): SimSnapshotBytes {
  const saved = readSnapshotData(input, apiVersion, physicsBasis, mismatch);
  return { ...saved, physics: saved.physics instanceof Uint8Array ? saved.physics : Uint8Array.from(saved.physics) };
}
/** A version 2 player's one velocity is the one its mode ran: the board's, the swim's, or the walk's over the fall's. */
function migratePlayerV2({ walk, fall, board, swim, ...rest }: v.InferOutput<typeof playerStateV2>): v.InferOutput<typeof playerState> {
  const velocity = board?.velocity ?? (swim?.on === true ? swim.velocity : [walk?.x ?? 0, fall?.vy ?? 0, walk?.z ?? 0]);
  return { ...rest, ...(velocity.every(axis => axis === 0) ? {} : { velocity }),
    ...(board === undefined ? fall?.grounded === false : !board.ground) ? { airborne: true as const } : {}, ...(board === undefined ? {} : { board: { air: board.air, bob: board.bob } }),
    ...(swim === undefined ? {} : { swim: { on: swim.on, diving: swim.diving, climbTo: swim.climbTo, climbCooldown: swim.climbCooldown, stroke: swim.stroke, stood: swim.stood } }) };
}
/** A version 2 save is a version 3 save with one velocity on each player. Nothing else about the continuation moved. */
function migrateV2({ players, ...rest }: v.InferOutput<typeof packedSnapshotV2>, apiVersion: number): v.InferOutput<typeof packedSnapshot> {
  return { ...rest, version: 3, apiVersion, players: players.map(migratePlayerV2) };
}
/** A version 1 save is a version 2 save with its one player as the list. Nothing else about the continuation moved. */
function migrateV1({ player, ...rest }: v.InferOutput<typeof packedSnapshotV1>, apiVersion: number): v.InferOutput<typeof packedSnapshot> {
  return migrateV2({ ...rest, version: 2, apiVersion, players: [player] }, apiVersion);
}
function readSnapshotData(input: unknown, apiVersion: number, physicsBasis: Uint8Array | undefined, mismatch: ((levelId: string, tick: number) => Error) | undefined): Omit<SimSnapshot, 'physics'> & { physics: number[] | Uint8Array } {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  jsonTree(parsed);
  const envelope = v.parse(wire, parsed);
  const saved = envelope.version === 1 ? migrateV1(envelope.snapshot, apiVersion) : envelope.version === 2 ? migrateV2(envelope.snapshot, apiVersion) : envelope.snapshot;
  // Validate metadata/engine/identities before reporting a recoverable basis change. The placeholder is never returned:
  // the checksummed bytes replace it, as the writer does (a schema walk of Pine's 8.4M bytes was ~2 of a 2.3 s decode).
  const metadata = identities(v.parse(snapshot, { ...saved, physics: [0] }), apiVersion);
  const physics = physicsBytes(saved.physics, physicsBasis, () => mismatch?.(saved.levelId, saved.state.tick) ?? new RangeError('Snapshot physics basis mismatch'));
  if (physics.length === 0 || physics.length > maxPhysicsBytes) throw new RangeError('Snapshot physics exceeds byte bounds');
  return { ...metadata, physics };
}
