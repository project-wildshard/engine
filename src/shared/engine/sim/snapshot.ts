import { Vector3 } from 'three';
import { createSnapshotDataSerializer, serializeSnapshotData, serializeSnapshotDataSteps, decodeSnapshotData, decodeSnapshotDataBytes, admitSnapshotDataBytes, finishSteps, checkSnapshotDataWire } from './snapshotData';
import { byteArray } from './snapshotPhysics';
import type { QuestBookSaved } from '../quest/players';
import type { SimHost, SimLevel, SimSlots, SimValue } from '../../../server/engine/sim';
import { SIM_API_VERSION } from './apiVersion';
import { leadPlayer } from './leadPlayer';
import type { PlayerSim } from '../../../server/engine/sim/playerSim';
import { SHOVE_TIME } from '../player/shove';
import type { DrivenMode } from '../player/modes';
import type { MotionFooting } from '../player/motion';
import type { AnimalSim } from '../entities/AnimalSim';
import type { StrikeRunner } from '../ai/strikes';
import type { PlayerHealth } from '../combat/health';
import type { GameClockState } from '../core/clock';
import { fnv1a32, type RngStreamsState } from '../core/rng';
import type { QuestState } from '../quest/core';
import type { EventMap } from '../../../client/engine/events/maps';
import { Physics } from '../physics/Physics';
import { CharacterMotor } from '../physics/CharacterMotor';
import type { Rapier } from '../physics/rapier';
import { tagCollider, tagOf, type Material } from '../physics/surface';
import type { BandsState } from './bands';
import type { DamageRows } from '../../../server/engine/combat/damageBook';
import type { RespawnRow } from '../../../server/engine/sim/respawn';
import type { DayClockState } from './dayClock';

/** Same-engine snapshot format; live callbacks and authored content are installed by the fresh host. */
export const SIM_SNAPSHOT_VERSION = 3;
/** Durable per-region ceiling in stored characters; the grid caller uses a logical checkpoint if exact encoding exceeds it. */
export const SIM_REGION_SNAPSHOT_CHAR_BUDGET: number = 512 * 1024;
/**
 * A supplied immutable basis differs after strict metadata and packed framing validation. This does not authenticate
 * old native bytes: logical fallback additionally requires the durable owner's integrity seal and portable checkpoint.
 * Missing basis, malformed chunks/references and incompatible engine versions never produce this error.
 */
export class SnapshotBasisMismatchError extends RangeError {
  readonly levelId: string;
  readonly tick: number;
  constructor(levelId: string, tick: number) { super('Snapshot physics basis mismatch'); this.name = 'SnapshotBasisMismatchError'; this.levelId = levelId; this.tick = tick; }
}
type EventValue =
  | { kind: 'value'; value: null | boolean | number | string }
  | { kind: 'undefined' }
  | { kind: 'number'; value: 'infinity' | '-infinity' | 'nan' }
  | { kind: 'vector'; value: number[] }
  | { kind: 'actor'; id: string }
  | { kind: 'entity'; id: string }
  | { kind: 'position'; id: string }
  /** A player object; `id` is left out for the lead player, which is all a version 1 save ever held. */
  | { kind: 'player'; id?: string | undefined }
  | { kind: 'array'; items: EventValue[] }
  | { kind: 'record'; entries: [string, EventValue][] };
type MotorState = ReturnType<CharacterMotor['snapshot']>;
/** One player's continuation. */
export interface SimPlayerSnapshot { id: string; position: number[]; yaw: number; health: EventValue; motor: MotorState; impulse?: number[] | undefined;
    /** Active traversal identities only; absent on hosts whose traversal has never claimed a tick. */
    traversals?: DrivenMode[] | undefined;
    /** The one world velocity through every mode (P1-E5.3-A1); absent = still. */
    velocity?: number[] | undefined;
    /** SimHost.playerMoveScale while it is not 1 (an input lock or a slowing room); absent = 1. */
    moveScale?: number | undefined;
    /** The feet left the ground; absent = they stand on it. */
    airborne?: true | undefined;
    /** A cable's seat holds the position, as the host's `carried`: the owner's seat alone puts it back on its next tick, so without this a restore takes one free step. Absent = it does not. */
    carried?: true | undefined;
    shove?: { t: number; vx: number; vz: number } | undefined;
    /** SF72: the riding hoverboard (SimHost.playerBoard); absent on foot, so a host that never boards keeps its bytes. */
    board?: { air: boolean; bob: number } | undefined;
    /** SF34: the swim (SimHost.playerSwim) while swimming or its haul-out cooldown runs; absent otherwise, so a host without
     *  water keeps its bytes. */
    swim?: { on: boolean; diving: boolean; climbTo: number | null; climbCooldown: number; stroke: number; stood: boolean } | undefined;
    /** The feet's last resolve (P1-E5.3-A3), which the next step reads; absent = dry, firm ground. */
    footing?: MotionFooting | undefined;
    /** SF72: the on-foot jump clocks (SimHost.playerJump; `ago` null = never grounded since: no coyote), absent on a fresh
     *  player; the running dash (playerDash) and the dodge clocks (playerDodge) only while they run. */
    jump?: { ago: number | null; left: 0 | 1 } | undefined; dash?: { t: number; vx: number; vz: number } | undefined;
    dodge?: { cd: number; t: number } | undefined;
    /** J116: the lock this player's orbit holds, only while it holds one. */
    lock?: { target: string; r0: number } | undefined }
/** The lead player's continuation, first in the list. */
export function leadSnapshot(saved: Pick<SimSnapshot, 'players'>): SimPlayerSnapshot {
  const lead = saved.players[0];
  if (lead === undefined) throw new RangeError('Snapshot has no player');
  return lead;
}
/** Engine continuations plus typed F1 slots. Rapier bytes and event actor references survive JSON round trips. */
export interface SimSnapshot {
  version: number; apiVersion: number; levelId: string; levelFingerprint: number;
  state: { tick: number; accumulator: number; timers: Record<string, number> };
  clock: GameClockState; rng: RngStreamsState;
  entities: { id: string; state: ReturnType<AnimalSim['snapshot']>; motor: MotorState | null }[];
  /** Every player, lead first (P1-E5.2a). A version 1 save held one, as `player`, and decodes to a list of one. */
  players: SimPlayerSnapshot[];
  strikes: { id: string; state: ReturnType<StrikeRunner['snapshot']> }[];
  targets: readonly (readonly [string, string])[];
  events: { version: number; queue: { name: keyof EventMap; payload: EventValue }[]; frameCount: number; frameBound: boolean };
  physics: number[]; colliderTags: { handle: number; material: Material; owner: EventValue }[];
  flags: string[]; quests: ReturnType<QuestState['snapshot']>[];
  /** P1-E3.3: every player's quest book but the lead's, whose are `flags` and `quests`. A one-player save holds none. */
  books?: QuestBookSaved[];
  slots: SimSlots; adapters: { id: string; state: SimValue }[];
  /** SF72 body band clocks (SimHost.useBodyBands); absent for a host without bands, so its bytes are unchanged. */
  bands?: BandsState | undefined;
  /** J105: who hurt which body, while a room has company; absent alone, so a one-player save keeps its bytes. */
  damage?: DamageRows | undefined;
  /** J107: each room player's last place and fall count; absent until a room has one, so a one-player save keeps its bytes. */
  respawn?: readonly RespawnRow[] | undefined;
  /** Who `playerFocus` follows, when it is not the first player: a restore must read the same player the next body would. */
  focus?: string | undefined;
  /** SF72 day clock (SimHost.useDayClock); absent for a host without one, so its bytes are unchanged. */
  day?: DayClockState | undefined;
  /** SF72 board-only collider handles (SimHost.boardColliders); absent when none are registered. */
  boardColliders?: number[] | undefined;
}

/** Detached native physics bytes for capture, decoding and restore, without a boxed array per Rapier byte.
 *  The legacy decoded array and packed wire stay unchanged; staged serialization freezes bytes before pausing. */
export type SimSnapshotBytes = Omit<SimSnapshot, 'physics'> & { physics: Uint8Array };

/** Admit a logical continuation with the writer's complete metadata, identity and byte checks.
 * Returns independently owned metadata/native bytes; a stored wire still uses the strict decoder. */
export function admitSimSnapshotBytes(saved: SimSnapshot | SimSnapshotBytes): SimSnapshotBytes {
  return admitSnapshotDataBytes(saved, SIM_API_VERSION);
}

/** One headless world's disposable compression context. Existing stateless
 * and page writers remain unchanged; no context is shared between worlds. */
export const createSimSnapshotSerializer = (): ReturnType<typeof createSnapshotDataSerializer> => createSnapshotDataSerializer(SIM_API_VERSION);

/** Serialize exact physics (≤32 MB) in bounded lossless blocks; optional immutable fresh-world bytes serve as a checked basis. */
export function serializeSimSnapshot(saved: SimSnapshot | SimSnapshotBytes, physicsBasis?: Uint8Array): string {
  return serializeSnapshotData(saved, SIM_API_VERSION, physicsBasis);
}
/** The same metadata/native-byte and wire-length refusal as a complete unbased
 * continuation, for terminal observations that do not publish intermediate saves. */
export function checkSimSnapshotWire(saved: SimSnapshot | SimSnapshotBytes, maximumChars: number): void {
  checkSnapshotDataWire(saved, SIM_API_VERSION, maximumChars);
}
/** The same wire in stages: each `yield` is a pause a caller may spread across frames (a periodic autosave), and
 *  {@link finishSimSteps} runs it whole. The snapshot is read only before the first pause. */
export function serializeSimSnapshotSteps(saved: SimSnapshot | SimSnapshotBytes, physicsBasis?: Uint8Array): Generator<undefined, string> {
  return serializeSnapshotDataSteps(saved, SIM_API_VERSION, physicsBasis);
}
/** Run a staged snapshot job to completion now. */
export function finishSimSteps<T>(steps: Generator<undefined, T>): T { return finishSteps(steps); }
/** Decode compressed/legacy JSON; a basis-referencing wire requires its exact checked basis. Never drops native geometry/state. */
export function decodeSimSnapshot(input: unknown, physicsBasis?: Uint8Array): SimSnapshot {
  return decodeSnapshotData(input, SIM_API_VERSION, physicsBasis, (levelId, tick) => new SnapshotBasisMismatchError(levelId, tick));
}
/** Decode the same strict wire directly to detached native bytes. Restore still copies caller-owned bytes before
 *  constructing replacement physics; metadata, framing, basis and checksum refusals match {@link decodeSimSnapshot}. */
export function decodeSimSnapshotBytes(input: unknown, physicsBasis?: Uint8Array): SimSnapshotBytes {
  return decodeSnapshotDataBytes(input, SIM_API_VERSION, physicsBasis, (levelId, tick) => new SnapshotBasisMismatchError(levelId, tick));
}

function encode(value: unknown, host: SimHost, parents = new Set<object>()): EventValue {
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { kind: 'number', value: Number.isNaN(value) ? 'nan' : value > 0 ? 'infinity' : '-infinity' };
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return { kind: 'value', value };
  if (typeof value !== 'object') throw new TypeError('Snapshot payload contains a callback or unsupported value');
  for (const player of host.players.values()) {
    if (value === player || player.isExternalObject(value)) return player === leadPlayer(host) ? { kind: 'player' } : { kind: 'player', id: player.id };
    if (value === player.position) return { kind: 'position', id: player.id };
    if (value === player.health) return { kind: 'actor', id: player.id };
  }
  if (value === host.playerFocus) return { kind: 'position', id: host.focusedPlayer.id };
  for (const entity of host.entities.values()) {
    if (value === entity) return { kind: 'entity', id: entity.entityId };
    if (value === entity.position) return { kind: 'position', id: entity.entityId };
    if (value === entity.combatActor()) return { kind: 'actor', id: entity.entityId };
  }
  if (value instanceof Vector3) return { kind: 'vector', value: value.toArray() };
  if (parents.has(value)) throw new TypeError('Snapshot payload contains an unregistered cycle');
  const next = new Set(parents); next.add(value);
  if (Array.isArray(value)) return { kind: 'array', items: value.map((item: unknown) => encode(item, host, next)) };
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Snapshot payload contains an unsupported instance');
  return { kind: 'record', entries: Object.entries(value).map(([key, item]) => [key, encode(item, host, next)]) };
}
function decode(value: EventValue, host: SimHost): unknown {
  switch (value.kind) {
    case 'value': return value.value;
    case 'undefined': return undefined;
    case 'player': { const player = value.id === undefined ? leadPlayer(host) : host.players.get(value.id); if (player === undefined) throw new RangeError(`Unknown snapshot player: ${value.id ?? ''}`); return player; }
    case 'number': return value.value === 'nan' ? Number.NaN : value.value === 'infinity' ? Infinity : -Infinity;
    case 'vector': {
      if (value.value.length !== 3 || !value.value.every(Number.isFinite)) throw new RangeError('Invalid event vector');
      return new Vector3().fromArray(value.value);
    }
    case 'actor': {
      const actor = host.players.get(value.id)?.health ?? host.entities.get(value.id)?.combatActor();
      if (actor === undefined) throw new RangeError(`Unknown snapshot actor: ${value.id}`);
      return actor;
    }
    case 'entity': {
      const entity = host.entities.get(value.id);
      if (entity === undefined) throw new RangeError(`Unknown snapshot entity: ${value.id}`);
      return entity;
    }
    case 'position': {
      const position = host.players.get(value.id)?.position ?? host.entities.get(value.id)?.position;
      if (position === undefined) throw new RangeError(`Unknown snapshot position: ${value.id}`);
      return position;
    }
    case 'array': return value.items.map((item) => decode(item, host));
    case 'record': return Object.fromEntries(value.entries.map(([key, item]) => [key, decode(item, host)]));
    default: throw new RangeError('Invalid snapshot payload');
  }
}
function cloneValue(value: SimValue): SimValue {
  // Logical clocks use +/-Infinity sentinels; the transport tags them reversibly. NaN is never a continuation.
  if (typeof value === 'number' && Number.isNaN(value)) throw new RangeError('Simulation slots refuse NaN');
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}
function cloneSlots(slots: SimSlots): SimSlots {
  const record = (values: Record<string, SimValue>): Record<string, SimValue> => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cloneValue(value)]));
  return { scriptMemory: record(slots.scriptMemory), scriptGlobals: record(slots.scriptGlobals), questState: record(slots.questState), ledgerDedupe: [...slots.ledgerDedupe] };
}
function entityMotor(entity: AnimalSim): CharacterMotor | null {
  if (entity.motor === null) return null;
  if (!(entity.motor instanceof CharacterMotor)) throw new TypeError(`Entity ${entity.entityId} requires a registered motor snapshot adapter`);
  return entity.motor;
}

/** Canonical logical continuation for a local authored region, without the profile-owned traveler or opaque world bytes. */
export function regionalContinuation(host: SimHost): string {
  const motorState = (motor: CharacterMotor | null) => {
    if (motor === null) return null;
    const state = motor.snapshot();
    const body = state.anchorBodyHandle === null ? null : host.physics.world.getRigidBody(state.anchorBodyHandle);
    return { filter: state.filter, ghost: state.ghost, enabled: state.enabled, yaw: state.yaw, anchor: state.anchor,
      anchorBody: body === null ? null : { position: body.translation(), rotation: body.rotation() }, climb: state.climbAngle, slide: state.slideAngle,
      result: { grounded: state.result.grounded, groundNormalY: state.result.groundNormalY, downhillX: state.result.downhillX, downhillZ: state.result.downhillZ, horizontalFreedom: state.result.horizontalFreedom } };
  };
  return JSON.stringify({ level: host.level, state: host.state, clock: host.clock.snapshot(), rng: host.rng.snapshot(),
    entities: [...host.entities].sort(([a], [b]) => a.localeCompare(b)).map(([id, entity]) => [id, entity.snapshot(), motorState(entityMotor(entity))]),
    strikes: [...host.strikes].filter(([id]) => !host.players.has(id)).sort(([a], [b]) => a.localeCompare(b)).map(([id, runner]) => [id, runner.snapshot()]),
    targets: host.attackTargets().filter(([id]) => !host.players.has(id)), flags: host.flags.all.sort((a, b) => a.localeCompare(b)), quests: host.quests.map((quest) => quest.snapshot()), ...savedBooks(host), slots: cloneSlots(host.slots),
    events: host.events.snapshot((value) => encode(value, host)),
    adapters: [...host.adapters].sort(([a], [b]) => a.localeCompare(b)).map(([id, adapter]) => [id, cloneValue(adapter.snapshot())]),
    ...bandsField(host), ...dayField(host), ...damageField(host), ...respawnField(host), ...focusField(host) });
}
/** The body band clocks, omitted for a host without bands (its continuation bytes stay as they were). */
/** The focus, saved only off the first player. */
function focusField(host: SimHost): { focus?: string } {
  return host.focusedPlayer === host.players.values().next().value ? {} : { focus: host.focusedPlayer.id };
}
/** The respawn book, saved once it holds a row. */
function respawnField(host: SimHost): { respawn?: readonly RespawnRow[] } {
  const respawn = host.respawn.rows();
  return respawn.length === 0 ? {} : { respawn };
}
/** The damage book, saved only with company: alone every drop is the page's. */
function damageField(host: SimHost): { damage?: DamageRows } {
  const damage = host.damage.rows();
  return host.players.size < 2 || damage.length === 0 ? {} : { damage };
}
function bandsField(host: SimHost): { bands?: BandsState } {
  const bands = host.bodyBandState();
  return bands === undefined ? {} : { bands };
}
/** The day clock, omitted for a host without one (its continuation bytes stay as they were). */
function dayField(host: SimHost): { day?: DayClockState } {
  const day = host.dayClockState();
  return day === undefined ? {} : { day };
}

/** Capture at a fixed-step boundary; pending events are preserved without flushing them. */
export function snapshotSimHost(host: SimHost): SimSnapshot { return captureSimHost(host, byteArray); }
/** Capture the same fixed-boundary state with owned native bytes, ready for the packed writer without number[]. */
export function snapshotSimHostBytes(host: SimHost): SimSnapshotBytes { return captureSimHost(host, bytes => bytes); }
function captureSimHost<Bytes extends number[] | Uint8Array>(host: SimHost, physics: (bytes: Uint8Array) => Bytes): Omit<SimSnapshot, 'physics'> & { physics: Bytes } {
  if (host.embedded) throw new Error('Borrowed simulation snapshots belong to the client world owner');
  if (host.scope.disposed) throw new Error('Cannot snapshot a disposed host');
  const colliderTags: SimSnapshot['colliderTags'] = [];
  host.physics.world.forEachCollider((collider) => { const tag = tagOf(collider); if (tag !== undefined) colliderTags.push({ handle: collider.handle, material: tag.material, owner: encode(tag.owner, host) }); });
  return { version: SIM_SNAPSHOT_VERSION, apiVersion: SIM_API_VERSION, levelId: host.level.id, levelFingerprint: levelFingerprint(host.level),
    state: { tick: host.state.tick, accumulator: host.state.accumulator, timers: { ...host.state.timers } }, clock: host.clock.snapshot(), rng: host.rng.snapshot(),
    entities: [...host.entities].map(([id, entity]) => ({ id, state: entity.snapshot(), motor: entityMotor(entity)?.snapshot() ?? null })),
    players: [...host.players.values()].map(player => playerSnapshot(host, player)),
    strikes: [...host.strikes].map(([id, runner]) => ({ id, state: runner.snapshot() })), targets: host.attackTargets(),
    events: host.events.snapshot((value) => encode(value, host)), physics: physics(host.physics.snapshot()), colliderTags,
    flags: host.flags.all, quests: host.quests.map((quest) => quest.snapshot()), ...savedBooks(host), slots: cloneSlots(host.slots),
    adapters: [...host.adapters].map(([id, adapter]) => ({ id, state: cloneValue(adapter.snapshot()) })), ...bandsField(host),
    ...(host.boardColliderHandles().length > 0 ? { boardColliders: [...host.boardColliderHandles()] } : {}), ...dayField(host), ...damageField(host), ...respawnField(host), ...focusField(host) };
}

/** One player, with everything at rest left out, so a player that never used a law keeps its exact bytes. */
function playerSnapshot(host: SimHost, player: PlayerSim): SimPlayerSnapshot {
  return { id: player.id, position: player.position.toArray(), yaw: player.yaw, health: encode(player.health.snapshot(), host), motor: player.motor.snapshot(),
    ...(player.velocity.lengthSq() > 0 ? { velocity: player.velocity.toArray() } : {}),
    ...(player.moveScale === 1 ? {} : { moveScale: player.moveScale }),
    // a resting impulse is omitted (canonical: absent = zero), so a host that was never shoved keeps its exact bytes
    ...(player.impulse.lengthSq() > 0 ? { impulse: player.impulse.toArray() } : {}),
    ...(player.fall.grounded ? {} : { airborne: true as const }),
    ...(player.carried ? { carried: true as const } : {}),
    ...(player.shove.t > 0 ? { shove: { ...player.shove } } : {}),
    ...(player.board.on ? { board: { air: player.board.hoverAir, bob: player.board.hoverBob } } : {}),
    ...swimField(player), ...footingField(player), ...(player.lockHeld === null ? {} : { lock: { target: player.lockHeld, r0: player.lock.r0 } }),
    ...jumpFields(player), ...traversalField(player) };
}
/** The swim (SF34) while it runs or its haul-out cooldown does, else omitted. */
function swimField(player: PlayerSim): Pick<SimPlayerSnapshot, 'swim'> {
  const { swim } = player;
  return swim.on || swim.stood || swim.climbCooldown > 0 ? { swim: { on: swim.on, diving: swim.diving, climbTo: swim.climbTo, climbCooldown: swim.climbCooldown, stroke: swim.strokeTime, stood: swim.stood } } : {};
}
/** The feet's last resolve, omitted on dry, firm ground. */
function footingField({ footing }: PlayerSim): Pick<SimPlayerSnapshot, 'footing'> {
  return footing.water === null && footing.depth === 0 && !footing.wading && !footing.onPlatform && !footing.sliding ? {} : { footing: { ...footing } };
}
/** Omit inactive traversal state so ordinary hosts retain their existing snapshot bytes. */
function traversalField(player: PlayerSim): Pick<SimPlayerSnapshot, 'traversals'> {
  const traversals = player.modes.snapshotTraversals();
  return traversals.length === 0 ? {} : { traversals };
}
/** The jump, dash and dodge state (SF72), each omitted while unused or at rest, so a host that never jumps or dodges keeps its bytes. */
function jumpFields(player: PlayerSim): Pick<SimPlayerSnapshot, 'jump' | 'dash' | 'dodge'> {
  const { jump, dash, dodge } = player;
  if (jump.left !== 0 && jump.left !== 1) throw new Error('Invalid player jump state');
  return { ...(jump.ago === Infinity && jump.left === 0 ? {} : { jump: { ago: Number.isFinite(jump.ago) ? jump.ago : null, left: jump.left === 0 ? 0 : 1 } }),
    ...(dash.t > 0 ? { dash: { ...dash } } : {}), ...(dodge.cd > 0 || dodge.t > 0 ? { dodge: { ...dodge } } : {}) };
}

function invalidPlayer(saved: SimPlayerSnapshot): boolean {
  return saved.position.length !== 3 || !saved.position.every(Number.isFinite) || !Number.isFinite(saved.yaw)
    || (saved.impulse !== undefined && (saved.impulse.length !== 3 || !saved.impulse.every(Number.isFinite) || saved.impulse.every(value => value === 0)))
    || (saved.velocity !== undefined && (saved.velocity.length !== 3 || !saved.velocity.every(Number.isFinite)))
    || (saved.moveScale !== undefined && !(Number.isFinite(saved.moveScale) && saved.moveScale >= 0 && saved.moveScale !== 1))
    || (saved.shove !== undefined && (![saved.shove.t, saved.shove.vx, saved.shove.vz].every(Number.isFinite) || saved.shove.t <= 0 || saved.shove.t > SHOVE_TIME))
    || (saved.board !== undefined && !Number.isFinite(saved.board.bob))
    || (saved.dash !== undefined && (![saved.dash.t, saved.dash.vx, saved.dash.vz].every(Number.isFinite) || saved.dash.t <= 0))
    || (saved.dodge !== undefined && (!(saved.dodge.cd >= 0 && saved.dodge.t >= 0) || saved.dodge.cd + saved.dodge.t === 0))
    || (saved.jump !== undefined && ((saved.jump.ago !== null && !(saved.jump.ago >= 0)) || ![0, 1].includes(saved.jump.left)));
}
function savedPlayer(host: SimHost, saved: SimPlayerSnapshot): PlayerSim {
  const player = host.players.get(saved.id);
  if (player === undefined) throw new RangeError('Snapshot instance registrations do not match');
  return player;
}
/** One player's state back into its live objects; motors follow with the world. */
function restorePlayer(host: SimHost, saved: SimPlayerSnapshot): void {
  const player = savedPlayer(host, saved);
  player.position.fromArray(saved.position); player.yaw = saved.yaw;
  if (saved.impulse === undefined) player.impulse.set(0, 0, 0); else player.impulse.fromArray(saved.impulse);
  player.velocity.set(0, 0, 0); if (saved.velocity !== undefined) player.velocity.fromArray(saved.velocity);
  player.moveScale = saved.moveScale ?? 1;
  Object.assign(player.shove, saved.shove ?? { t: 0, vx: 0, vz: 0 });
  const { board } = saved;
  Object.assign(player.board, board === undefined ? { on: false, hoverAir: false, hoverBob: 0 } : { on: true, hoverAir: board.air, hoverBob: board.bob });
  player.fall.grounded = saved.airborne !== true;
  player.carried = saved.carried === true;
  const { swim } = saved;
  if (swim?.on === true && (board !== undefined || !host.hasWater)) throw new RangeError('Snapshot swim does not match');
  Object.assign(player.swim, swim === undefined ? { on: false, diving: false, climbTo: null, climbCooldown: 0, strokeTime: 0, stood: false }
    : { on: swim.on, diving: swim.diving, climbTo: swim.climbTo, climbCooldown: swim.climbCooldown, strokeTime: swim.stroke, stood: swim.stood });
  const { jump } = saved;
  player.jump.ago = jump?.ago ?? Infinity; player.jump.left = jump?.left ?? 0;
  Object.assign(player.dash, saved.dash ?? { t: 0, vx: 0, vz: 0 });
  Object.assign(player.dodge, saved.dodge ?? { cd: 0, t: 0 });
  player.restoreLock(saved.lock);
  player.health.restore(decode(saved.health, host) as ReturnType<PlayerHealth['snapshot']>);
  player.restoreFooting(saved.footing);
  if (saved.traversals?.length === 0) throw new Error('Invalid empty traversal mode continuation');
  player.modes.restoreTraversals(saved.traversals ?? []);
}
function sameIds(actual: readonly string[], expected: Iterable<string>): boolean {
  const wanted = new Set(expected);
  return wanted.size === actual.length && new Set(actual).size === actual.length && actual.every((id) => wanted.has(id));
}

const restoreChecks = new WeakMap<SimHost, (() => void)[]>();
/** Open a fresh host's restore checks; `sim/restore` closes them when the host is kept or consumed. */
export function openRestoreChecks(host: SimHost): (() => void)[] { const checks: (() => void)[] = []; restoreChecks.set(host, checks); return checks; }
export function closeRestoreChecks(host: SimHost): void { restoreChecks.delete(host); }
/** Reinstalled services may require native state that does not exist until the
 * restore transaction replaces physics and reconnects its tags and adapters.
 * Checks run once before the restored host escapes; ordinary hosts refuse. */
export function onSimHostRestored(host: SimHost, check: () => void): void {
  const checks = restoreChecks.get(host);
  if (checks === undefined) throw new Error('Simulation host is not restoring');
  checks.push(check);
}

const restoringHosts = new WeakSet<SimHost>();
/** True only during the unpublished native replacement transaction. */
export function isSimHostRestoring(host: SimHost): boolean { return restoringHosts.has(host); }
function savedBooks(host: SimHost): { books?: QuestBookSaved[] } {
  const books = host.questStore?.save();
  return books === undefined ? {} : { books };
}
/** A level's identity in a save. The version is left out: every level version has held this content, so a new engine
 *  version does not orphan a save, and `apiVersion` already says which engine wrote it. */
function levelFingerprint(level: SimLevel): number { return fnv1a32(JSON.stringify({ ...level, version: 1 })); }
export function validateSnapshot(level: SimLevel, saved: SimSnapshot | SimSnapshotBytes): void {
  if (saved.version !== SIM_SNAPSHOT_VERSION || saved.apiVersion !== SIM_API_VERSION || saved.levelId !== level.id
    || saved.levelFingerprint !== levelFingerprint(level) || !Number.isSafeInteger(saved.state.tick) || saved.state.tick < 0
    || !Number.isFinite(saved.state.accumulator) || saved.state.accumulator < -Number.EPSILON
    || !Object.values(saved.state.timers).every((value) => Number.isFinite(value) && value >= 0)
    || saved.physics.length === 0 || (!(saved.physics instanceof Uint8Array && ArrayBuffer.isView(saved.physics)) && saved.physics.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new RangeError('Incompatible simulation snapshot');
}
/** The restore transaction on a fresh host, which `sim/restore` boots. */
export function restoreInstalledHost(host: SimHost, ports: { rapier: Rapier }, saved: SimSnapshot | SimSnapshotBytes, checks: (() => void)[], install?: (host: SimHost) => void): SimHost {
  restoringHosts.add(host);
  let replacement: Physics | null = null;
  try {
    install?.(host);
    // The installers ran for the lead player; everyone else rejoins here, before their state lands.
    for (const entry of saved.players.slice(1)) if (!host.players.has(entry.id)) host.addPlayer(entry.id);
    if (saved.players[0]?.id !== leadPlayer(host).id || !sameIds(saved.players.map((entry) => entry.id), host.players.keys()) || !sameIds(saved.entities.map((entry) => entry.id), host.entities.keys())
      || !sameIds(saved.strikes.map((entry) => entry.id), host.strikes.keys()) || !sameIds(saved.adapters.map((entry) => entry.id), [...host.adapters].filter(([id, adapter]) => adapter.joined !== true || saved.adapters.some(entry => entry.id === id)).map(([id]) => id))
      || !sameIds(saved.quests.map((entry) => entry.id), host.quests.map((quest) => quest.def.id))
      || saved.players.some(invalidPlayer) || saved.boardColliders?.length === 0) throw new RangeError('Snapshot instance registrations do not match');
    for (const entry of saved.entities) host.entities.get(entry.id)?.restore(entry.state);
    for (const entry of saved.players) restorePlayer(host, entry);
    for (const entry of saved.strikes) host.strikes.get(entry.id)?.restore(entry.state, host.strikeSpecifications(entry.id));
    host.flags.restore(saved.flags);
    for (const quest of host.quests) { const state = saved.quests.find((entry) => entry.id === quest.def.id); if (state !== undefined) quest.restore(state); }
    host.questStore?.restore(saved.books);
    host.rng.restore(saved.rng); host.clock.restore(saved.clock);
    host.state.tick = saved.state.tick; host.state.accumulator = saved.state.accumulator;
    for (const key of Object.keys(host.state.timers)) delete host.state.timers[key];
    Object.assign(host.state.timers, saved.state.timers);
    const slots = cloneSlots(saved.slots);
    for (const key of ['scriptMemory', 'scriptGlobals', 'questState'] as const) {
      for (const name of Object.keys(host.slots[key])) delete host.slots[key][name];
      Object.assign(host.slots[key], slots[key]);
    }
    host.slots.ledgerDedupe.splice(0, host.slots.ledgerDedupe.length, ...slots.ledgerDedupe);
    // Deferred actors may be reinstalled before a controller that originally registered before their spawn.
    // Preserve the saved continuation order without changing the independently registered step callbacks.
    const adapters = saved.adapters.map(entry => {
      const adapter = host.adapters.get(entry.id);
      if (adapter === undefined) throw new RangeError('Snapshot adapter registration disappeared');
      return [entry.id, adapter] as const;
    });
    const joined = [...host.adapters].filter(([id, adapter]) => adapter.joined === true && !saved.adapters.some(entry => entry.id === id));
    host.adapters.clear();
    for (const [id, adapter] of [...adapters, ...joined]) host.adapters.set(id, adapter);
    for (const entry of saved.adapters) host.adapters.get(entry.id)?.restore(cloneValue(entry.state));
    host.restoreBodyBands(saved.bands);
    host.restoreDayClock(saved.day);
    host.damage.load(saved.damage ?? []);
    host.respawn.load(saved.respawn ?? []);
    host.restoreFocus(saved.focus);
    const actors = new Set([...host.players.keys(), ...host.entities.keys()]);
    // Native creature windups retain their focused target without a StrikeRunner.
    if (new Set(saved.targets.map(([id]) => id)).size !== saved.targets.length
      || saved.targets.some(([id, target]) => (!host.strikes.has(id) && !host.entities.has(id)) || !actors.has(target))) throw new RangeError('Snapshot strike target does not exist');
    host.restoreAttackTargets(saved.targets);
    host.events.restore(saved.events, (value) => decode(value, host));
    const world = new Physics(ports.rapier, new Uint8Array(saved.physics)); replacement = world;
    const playerMotors = saved.players.map(entry => { const player = savedPlayer(host, entry); return [player, new CharacterMotor(world, host.playerMotorOptions(player), entry.motor)] as const; });
    const motors = new Map<string, CharacterMotor>();
    // under the physics body LOD the saved bodies hold motors by distance: each saved one reconnects in the page's capsule
    const lod = host.bodyBands?.physics === true;
    for (const entry of saved.entities) {
      const entity = host.entities.get(entry.id), motor = entity === undefined ? null : entityMotor(entity);
      if (lod) { if (entity !== undefined && entry.motor !== null) motors.set(entry.id, new CharacterMotor(replacement, host.creatureMotorOptions(entity), entry.motor)); continue; }
      if ((entry.motor === null) !== (motor === null)) throw new RangeError('Snapshot motor registrations do not match');
      if (motor !== null && entry.motor !== null) motors.set(entry.id, new CharacterMotor(replacement, motor.opts, entry.motor));
    }
    for (const player of host.players.values()) if (player.hasMotor) player.motor.dispose();
    for (const entity of host.entities.values()) entity.motor?.dispose();
    host.physics.dispose();
    host.physics = world; replacement = null;
    for (const [player, motor] of playerMotors) player.motor = motor;
    if (lod) for (const [id, entity] of host.entities) entity.motor = motors.get(id) ?? null;
    else for (const [id, motor] of motors) { const entity = host.entities.get(id); if (entity !== undefined) entity.motor = motor; }
    for (const tag of saved.colliderTags) {
      if (!host.physics.world.colliders.contains(tag.handle)) throw new RangeError('Snapshot collider tag does not exist');
      tagCollider(host.physics.world.getCollider(tag.handle), tag.material, decode(tag.owner, host));
    }
    host.restoreBoardColliders(saved.boardColliders ?? []);
    for (const adapter of host.adapters.values()) adapter.physicsRestored?.();
    restoreChecks.delete(host);
    for (const check of checks) check();
    return host;
  } catch (error) { replacement?.dispose(); host.dispose(); throw error; }
  finally { restoringHosts.delete(host); restoreChecks.delete(host); checks.length = 0; }
}
