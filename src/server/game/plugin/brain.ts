import { sha256 } from '../../../shared/game/plugin/moduleHash';
import { emitFault } from '@wildshard/engine/core/faults';
import { BorrowedDecisionSchema, type BorrowedDecision } from '@wildshard/format/decisionScripts';
import type { CombatTag } from '@wildshard/engine/combat/pipeline';
import { CreatureBrain } from '@wildshard/engine/ai/CreatureBrain';
import { StalkerBrain } from "@wildshard/engine/ai/stalker";
import { HURT_ARC, type HuntBody, type HuntGround, type HuntNav, type HuntConfig, type HuntSpecies } from "@wildshard/engine/ai/hunt";
import { bindPlayerImpulse } from '../../../shared/game/shardfile/dataCreaturePorts';
import type { AnimalSimSpec, AnimalSim } from "@wildshard/engine/entities/AnimalSim";
import type { SimStrike, SimValue, SimHost } from "@wildshard/engine/sim";
import { type StrikeSpec, StrikeRunner, type StrikeContext } from "@wildshard/engine/ai/strikes";
import type { ShardRows } from "@wildshard/format/rows";
import { parseScriptSpecies, type ScriptSpeciesSchema, type ScriptSpeciesData } from "@wildshard/format/speciesScripts";
import { parseEliteScript, type EliteScriptData } from "@wildshard/format/eliteScripts";
import * as v from "valibot";
import { ScriptHost, type ScriptSnapshot } from "@wildshard/engine/script/host";
import { SCRIPT_PARAMETER_QUERY } from '@wildshard/format/scriptAbi';
import { ScriptWorld, SCRIPT_OP, type EffectTransaction, type ScriptEffect } from "@wildshard/engine/script/effects";
import { readStrikeState } from "@wildshard/engine/ai/strikeState";
import { Vector3 } from "three";
import type { SpeciesRow } from "@wildshard/engine/ai/species";
import type { Animal } from "@wildshard/engine/entities/AnimalView";
import type { ThinkCtx } from "@wildshard/engine/entities/species/registry";
import { SkirmisherBrain, type SkirmisherPorts } from "@wildshard/engine/ai/skirmisher";
import { GuardianBrain, type GuardianPorts } from "@wildshard/engine/ai/guardian";
import { PerchHunterBrain } from "@wildshard/engine/ai/perchHunter";
import { strikeFromData, type StrikeData } from "@wildshard/engine/ai/strikeRows";
import { RamGrazerBrain } from "@wildshard/engine/ai/ramGrazer";
import { OrbitDiverBrain } from "@wildshard/engine/ai/orbitDiver";
import { BurstFlyerBrain } from "@wildshard/engine/ai/burstFlyer";
import { ChallengeGrazerBrain } from "@wildshard/engine/ai/challengeGrazer";
import { PatrolDiverBrain } from "@wildshard/engine/ai/patrolDiver";
import { CreatureBodyRecipeSchema, CreatureHomeSchema, CreatureStrikeSchema, type CreatureBodyRecipe, type CreatureMemoryActions } from "@wildshard/format/creatures";
import { canReach } from "@wildshard/engine/ai/reach";
import type { SimSnapshot } from "@wildshard/engine/sim/snapshot";
import { parseGrazer, grazerPreset, type GrazerSchema, parseChallengeGrazer, type ChallengeGrazerSchema, type ShardChallengeGrazer, type ShardRamGrazer } from "@wildshard/format/grazers";
import { parseDiver, diverPreset, type DiverSchema, parsePatrolDiver, type PatrolDiverSchema, type ShardPatrolDiver, type ShardOrbitDiver, type ShardBurstFlyer } from "@wildshard/format/flyers";
import { creatureFloor, installHomeKeeper, type HomeKeeperSpec, type KeptBossBody, type KeptHome, type KeptPolicy } from "../shardfile/homeKeeper";
import { type StalkerSchema, parseStalker, stalkerPreset, type GuardianPatternsSchema, guardianPreset, parseGuardianPattern, parseSkirmisher, parseGuardian, parsePerchHunter, type SkirmisherSchema, type GuardianSchema, type PerchHunterSchema, type ShardSkirmisher, type ShardGuardian, type ShardPerchHunter } from "@wildshard/format/brains";

type Rng = ReturnType<SimHost['rng']['stream']>;

/** Plain actor-memory gates for ordered body-step effects; clocks and saved fields remain actor-owned. */
export interface MemoryActionRows {
  readonly stateKey: string; readonly states: readonly string[];
  readonly cadence?: 'body' | 'decision';
  readonly actions: readonly {
    readonly state: number; readonly phase: number; readonly effect: string;
    readonly once: { readonly key: string; readonly value: number; readonly test: 'falsy' | 'not-value' };
    readonly when?: { readonly key: string; readonly test: 'truthy' | 'falsy' };
  }[];
}

/**
 * Bind an existing decision to inspectable states and preflighted, ordered memory-action gates.
 * A due action claims its existing once field before the borrowed effect, including misses and throws.
 * This owns no clock, random stream, contact solver or save envelope; act may run before the first think.
 */
export function createMemoryActionBrain<A extends AnimalSim, C>(actor: A, rows: MemoryActionRows, ports: {
  readonly decide: (actor: A, context: C) => void;
  readonly effects: ReadonlyMap<string, (actor: A, context: C) => void>;
  readonly beforeAct?: (actor: A, context: C) => void;
  readonly threshold?: (actor: A, context: C, phase: number) => number;
}): CreatureBrain<string, A, C> & { snapshot: () => boolean; restore: (value: unknown) => void } {
  const validKey = (key: string): boolean => /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/u.test(key)
    && key !== 'constructor' && key !== 'prototype' && key !== '__proto__';
  if (!validKey(rows.stateKey) || rows.states.length === 0 || rows.states.length > 32
    || new Set(rows.states).size !== rows.states.length || rows.states.some(state => !validKey(state)) || rows.actions.length > 16
    || (rows.cadence !== undefined && !['body', 'decision'].includes(rows.cadence))) throw new Error('Invalid memory-action states');
  const states = [...rows.states], stateKey = rows.stateKey, decisionStep = rows.cadence === 'decision';
  const actions = rows.actions.map(row => {
    const run = ports.effects.get(row.effect);
    if (!Number.isInteger(row.state) || row.state < 0 || row.state >= states.length || !Number.isFinite(row.phase) || row.phase < 0 || row.phase > 1
      || !validKey(row.once.key) || !Number.isFinite(row.once.value) || !['falsy', 'not-value'].includes(row.once.test)
      || (row.when !== undefined && (!validKey(row.when.key) || !['truthy', 'falsy'].includes(row.when.test))) || run === undefined) throw new Error('Invalid or unbound memory action');
    return { ...row, once: { ...row.once }, when: row.when === undefined ? undefined : { ...row.when }, run };
  });
  class BoundMemoryBrain extends CreatureBrain<string, A, C> {
    private pending = false;
    private badThresholds: Set<(typeof actions)[number]> | undefined;
    override think(context: C): void {
      ports.decide(actor, context);
      this.pending = decisionStep;
      const state = states[actor.mem[stateKey] ?? 0];
      if (state !== undefined) this.transition(state);
    }
    override act(context: C): void {
      ports.beforeAct?.(actor, context);
      if (decisionStep) { if (!this.pending) return; this.pending = false; }
      const phase = actor.attackPhase;
      if (phase < 0) return;
      for (const action of actions) {
        if (actor.mem[stateKey] !== action.state) continue;
        const threshold = ports.threshold?.(actor, context, action.phase) ?? action.phase;
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
          const reported = this.badThresholds ??= new Set();
          if (!reported.has(action)) {
            reported.add(action);
            emitFault({system: 'ai.memory-action', error: new Error(`Invalid memory-action threshold: ${action.effect}`), verdict: 'retry'});
          }
          continue;
        }
        if (!(phase >= threshold)) continue;
        if (action.when !== undefined && Boolean(actor.mem[action.when.key]) !== (action.when.test === 'truthy')) continue;
        const once = actor.mem[action.once.key];
        if (action.once.test === 'falsy' ? Boolean(once) : once === action.once.value) continue;
        actor.mem[action.once.key] = action.once.value;
        action.run(actor, context);
      }
    }
    snapshot(): boolean { return this.pending; }
    restore(value: unknown): void { if (typeof value !== 'boolean') throw new Error('Invalid memory-action continuation'); this.pending = value; }
  }
  return new BoundMemoryBrain(actor, states);
}

/** An authored creature pose, without behaviour, RNG or a save owner. */
export interface CreatureSpawnRow {
  readonly kind: string; readonly x: number; readonly z: number; readonly yaw: number;
  readonly variant?: string | null;
}
/** Ordered manager-owned creature materialization and retirement. */
export interface CreatureSpawner<A> {
  spawn: (kind: string, x: number, z: number, yaw: number, variant?: string) => A;
  group: <R extends CreatureSpawnRow>(kind: string, at: { readonly x: number; readonly z: number }, rows: readonly R[], joined?: (actor: A, row: R) => void) => A[];
  place: <R extends CreatureSpawnRow & { readonly herd: number }>(centres: readonly { readonly x: number; readonly z: number }[], kinds: readonly string[], rows: readonly R[],
    joined?: (actor: A, row: R) => void, grouped?: (kind: string, index: number) => void) => void;
  dispose: () => void;
  /** G598: `dispose` one retired actor a step (a sliced retirement); `dispose` drains it */
  retireSteps: () => Generator<undefined, void>;
}

/**
 * Materialize authored creature groups in order through the caller's actual manager.
 * Owns only spawned actor retirement and herd membership; placement RNG, effects and saves stay borrowed.
 * Group batches preflight all centres and row membership before their first spawn.
 */
export function createCreatureSpawner<A extends { herd: number }>(ports: {
  spawn: (kind: string, x: number, z: number, yaw: number, variant?: string) => A;
  retire: (actor: A) => void;
  addHerd: (kind: string, x: number, z: number) => number;
  readonly herds: readonly { readonly members: A[] }[];
}): CreatureSpawner<A> {
  interface Point { readonly x: number; readonly z: number }
  const owned = new Set<A>(); let disposed = false;
  const validPoint = (at: Point): boolean => Number.isFinite(at.x) && Number.isFinite(at.z);
  const validRow = (row: CreatureSpawnRow): boolean => row.kind.length > 0 && validPoint(row) && Number.isFinite(row.yaw);
  const spawn = (kind: string, x: number, z: number, yaw: number, variant?: string): A => {
    if (disposed) throw new Error('Creature spawner is disposed');
    const actor = ports.spawn(kind, x, z, yaw, variant); owned.add(actor); return actor;
  };
  const group = <R extends CreatureSpawnRow>(kind: string, at: Point, rows: readonly R[], joined?: (actor: A, row: R) => void): A[] => {
    if (disposed || kind.length === 0 || !validPoint(at) || rows.length > 1024 || rows.some(row => row.kind !== kind || !validRow(row))) throw new Error('Invalid creature group');
    const herd = ports.addHerd(kind, at.x, at.z), members = ports.herds[herd]?.members;
    if (!Number.isSafeInteger(herd) || herd < 0 || members === undefined) throw new Error('Unbound creature herd');
    const actors: A[] = [];
    for (const row of rows) {
      const actor = spawn(row.kind, row.x, row.z, row.yaw, row.variant ?? undefined);
      actor.herd = herd; members.push(actor); actors.push(actor); joined?.(actor, row);
    }
    return actors;
  };
  const place = <R extends CreatureSpawnRow & { readonly herd: number }>(centres: readonly Point[], kinds: readonly string[], rows: readonly R[],
    joined?: (actor: A, row: R) => void, grouped?: (kind: string, index: number) => void): void => {
    if (disposed || centres.length > 1024 || rows.length > 1024 || centres.length !== kinds.length
      || centres.some((at, i) => !validPoint(at) || !kinds[i])
      || rows.some(row => !validRow(row) || !Number.isSafeInteger(row.herd) || row.herd < -1 || row.herd >= centres.length
        || (row.herd >= 0 && row.kind !== kinds[row.herd]))) throw new Error('Invalid creature placement');
    for (const [index, at] of centres.entries()) {
      const kind = kinds[index]; if (kind === undefined) throw new Error('Missing creature herd kind');
      group(kind, at, rows.filter(row => row.herd === index), joined); grouped?.(kind, index);
    }
  };
  function* retireSteps(): Generator<undefined, void> {
    if (disposed) return;
    disposed = true;
    for (const actor of owned) { owned.delete(actor); ports.retire(actor); yield; }
  }
  const dispose = (): void => { const steps = retireSteps(); while (steps.next().done !== true) { /* every actor at once */ } };
  return { spawn, group, place, dispose, retireSteps };
}

/** Bounded radial or indexed creature placement over an existing stream and ground owner. A radial source draws a math
 * angle (x = cos, z = sin) or a compass bearing (x = sin, z = cos), scaled per axis for an elliptical region. */
export interface CreatureGroupSpec<K extends string = string> {
  readonly kind: K; readonly count: number; readonly herd: number; readonly variant: string | null;
  readonly firstVariant?: string | null; readonly variants?: readonly (string | null)[];
  /** a fixed yaw, or a point every sample faces; omitted, each yaw is a draw after its point */
  readonly yaw?: number; readonly face?: { readonly x: number; readonly z: number };
  readonly source: { readonly kind: 'indexed'; readonly points: readonly { readonly x: number; readonly z: number }[] }
    | { readonly kind: 'radial'; readonly centre: { readonly x: number; readonly z: number }; readonly radius: readonly [number, number];
      readonly axes?: readonly [number, number]; readonly bearing?: 'math' | 'compass';
      readonly firstAtCentre?: boolean; readonly radiusLaw?: 'linear' | 'area'; readonly attempts?: number; readonly fallback?: 'skip' | 'centre' };
  /** Data rejection of a candidate: outside a distance band to a point, inside a clear circle, past a square bound
   *  (|x| or |z|), or ground below `minHeight` (read through the ground owner). */
  readonly accept?: {
    readonly band?: { readonly x: number; readonly z: number; readonly min: number; readonly max: number };
    readonly clear?: readonly { readonly x: number; readonly z: number; readonly r: number }[];
    readonly bound?: number; readonly minHeight?: number;
  };
}
/** Generated pose rows retain their authored kind, variant and herd; materialization remains borrowed. */
export interface CreatureGroupSample<K extends string = string> { readonly kind: K; readonly variant: string | null; readonly herd: number; readonly x: number; readonly z: number; readonly yaw: number }
/** The engine services a group samples through: the caller's random stream and its ground (what `accept.minHeight` reads). */
export type CreatureGroupStream = Pick<Rng, 'next'>;
export type CreatureGroupGround = Pick<HuntGround, 'heightAt'>;
/** Sample in order from the caller's stream; rejection precedes yaw. */
export function sampleCreatureGroup<K extends string>(row: CreatureGroupSpec<K>, rng: CreatureGroupStream, ground?: CreatureGroupGround): CreatureGroupSample<K>[] {
  const point = (p: { readonly x: number; readonly z: number }): boolean => Number.isFinite(p.x) && Number.isFinite(p.z);
  const variant = (value: string | null): boolean => value === null || value.length > 0 && value.length <= 128;
  const gate = row.accept, band = gate?.band, clear = gate?.clear ?? [], bound = gate?.bound, minHeight = gate?.minHeight;
  if (!row.kind || row.kind.length > 128 || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 16 || !Number.isSafeInteger(row.herd) || row.herd < -1
    || !variant(row.variant) || row.firstVariant !== undefined && !variant(row.firstVariant) || row.yaw !== undefined && !Number.isFinite(row.yaw)
    || row.face !== undefined && (row.yaw !== undefined || !point(row.face))
    || row.variants !== undefined && (row.variants.length !== row.count || row.variants.some(value => !variant(value)))
    || band !== undefined && (!point(band) || !Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min < 0 || band.max < band.min)
    || clear.length > 16 || clear.some(c => !point(c) || !Number.isFinite(c.r) || c.r < 0)
    || bound !== undefined && !(bound > 0) || minHeight !== undefined && (!Number.isFinite(minHeight) || ground === undefined)) throw new Error('Invalid creature sampling group');
  const source = row.source;
  let attempts = 1, ax = 1, az = 1, compass = false;
  switch (source.kind) {
    case 'indexed':
      if (source.points.length > 1024 || source.points.length < row.count || source.points.some(p => !point(p))) throw new Error('Invalid indexed creature group');
      break;
    case 'radial':
      attempts = source.attempts ?? 1; [ax, az] = source.axes ?? [1, 1]; compass = source.bearing === 'compass';
      if (!point(source.centre) || !Number.isFinite(source.radius[0]) || !Number.isFinite(source.radius[1]) || source.radius[0] < 0 || source.radius[1] < source.radius[0]
        || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 40 || !['linear', 'area'].includes(source.radiusLaw ?? 'linear')
        || !['skip', 'centre'].includes(source.fallback ?? 'skip') || source.radiusLaw === 'area' && source.radius[0] !== 0
        || !['math', 'compass'].includes(source.bearing ?? 'math') || !Number.isFinite(ax) || !Number.isFinite(az) || !(ax > 0) || !(az > 0)) throw new Error('Invalid radial creature group');
      break;
    default: throw new Error('Unknown creature sampling source');
  }
  const accepts = (x: number, z: number): boolean => {
    if (band !== undefined) { const d = Math.hypot(x - band.x, z - band.z); if (d < band.min || d > band.max) return false; }
    for (const c of clear) if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
    if (bound !== undefined && (Math.abs(x) > bound || Math.abs(z) > bound)) return false;
    return minHeight === undefined || ground === undefined || !(ground.heightAt(x, z) < minHeight);
  };
  const samples: CreatureGroupSample<K>[] = [];
  for (let index = 0; index < 16; index++) {
    if (index >= row.count) break;
    let x = 0, z = 0, accepted = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (attempt >= attempts) break;
      if (source.kind === 'indexed') {
        const p = source.points[index]; if (p === undefined) throw new Error('Missing indexed creature point'); x = p.x; z = p.z;
      } else {
        const [r0, r1] = source.radius, angle = Math.PI * 2 * rng.next();
        const radius = source.firstAtCentre === true && index === 0 && attempt === 0 ? 0 : source.radiusLaw === 'area' ? Math.sqrt(rng.next()) * r1 : r0 + (r1 - r0) * rng.next();
        x = source.centre.x + (compass ? Math.sin(angle) : Math.cos(angle)) * ax * radius;
        z = source.centre.z + (compass ? Math.cos(angle) : Math.sin(angle)) * az * radius;
      }
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Invalid sampled creature point');
      if (accepts(x, z)) { accepted = true; break; }
    }
    if (!accepted) { if (source.kind !== 'radial' || source.fallback !== 'centre') continue; x = source.centre.x; z = source.centre.z; }
    const yaw = row.face !== undefined ? Math.atan2(row.face.x - x, row.face.z - z) : row.yaw ?? Math.PI * 2 * rng.next();
    if (!Number.isFinite(yaw)) throw new Error('Invalid sampled creature yaw');
    samples.push({ kind: row.kind, variant: row.variants === undefined ? index === 0 && row.firstVariant !== undefined ? row.firstVariant : row.variant : row.variants[index] ?? null, x, z, yaw, herd: row.herd });
  }
  return samples;
}

/**
 * Rank at most 1024 borrowed sites, keeping source order on tied scores. Range admission precedes the caller's
 * score callback; greedy spacing follows ranking. Null rejects a site. No random stream or actor is owned here.
 */
export function selectCreatureSites<T extends { readonly x: number; readonly z: number } | { readonly position: { readonly x: number; readonly z: number } }>(sites: readonly T[],
  options: { readonly count: number; readonly origin?: { readonly x: number; readonly z: number }; readonly minDistance?: number; readonly maxDistance?: number; readonly separation?: number },
  score: (site: T, index: number, distance: number) => number | null): { readonly site: T; readonly index: number }[] {
  const point = (site: T): { readonly x: number; readonly z: number } => 'position' in site ? site.position : site;
  const min = options.minDistance ?? 0, max = options.maxDistance ?? Infinity, gap = options.separation ?? 0, origin = options.origin;
  if (sites.length > 1024 || !Number.isSafeInteger(options.count) || options.count < 0 || options.count > 16
    || !Number.isFinite(min) || min < 0 || (options.maxDistance !== undefined && !Number.isFinite(max)) || max < min || !Number.isFinite(gap) || gap < 0
    || (origin === undefined && (options.minDistance !== undefined || options.maxDistance !== undefined))
    || (origin !== undefined && (!Number.isFinite(origin.x) || !Number.isFinite(origin.z)))
    || sites.some(site => { const p = point(site); return !Number.isFinite(p.x) || !Number.isFinite(p.z); })) throw new RangeError('Invalid creature site selection');
  const ranked: { site: T; index: number; score: number }[] = [];
  for (let i = 0; i < 1024; i++) {
    const site = sites[i]; if (site === undefined) break;
    const p = point(site), distance = origin === undefined ? 0 : Math.hypot(p.x - origin.x, p.z - origin.z);
    if (distance < min || distance > max) continue;
    const value = score(site, i, distance);
    if (value === null) continue;
    if (!Number.isFinite(value)) throw new RangeError('Invalid creature site score');
    ranked.push({ site, index: i, score: value });
  }
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: { site: T; index: number }[] = [];
  for (let i = 0; i < 1024 && selected.length < options.count; i++) {
    const row = ranked[i]; if (row === undefined) break;
    const p = point(row.site);
    if (selected.some(other => { const q = point(other.site); return Math.hypot(q.x - p.x, q.z - p.z) < gap; })) continue;
    selected.push({ site: row.site, index: row.index });
  }
  return selected;
}

/** Resolve both species and variant, preserving authored health and gameplay multipliers. */
export function speciesResolver(rows: ShardRows): (speciesId: string, variantId: string) => AnimalSimSpec {
  const catalogue = new Map(rows.species.map((row) => [row.id, row]));
  return (speciesId, variantId) => {
    const row = catalogue.get(speciesId), selected = row?.variants.find((variantRow) => variantRow.id === variantId);
    if (row === undefined || selected === undefined) throw new Error('Unresolved declared species/variant');
    return { kind: row.kind, species: row.id, label: selected.label, variant: selected.id, rarity: selected.rarity, hp: selected.hp, aggressive: row.aggressive, lockable: row.lockable,
      dims: { ...row.dims, feet: row.dims.feet.map(([x, z]) => [x, z]) }, mods: { ...selected.mods }, ...(row.flight === undefined ? {} : { flight: { ...row.flight } }) };
  };
}
/** Numeric strike rows feed the authoritative sim without a score callback. */
export function simStrikes(rows: ShardRows): ReadonlyMap<string, SimStrike> {
  return new Map(rows.strikes.map(({ weight: _weight, speed, ...row }) => [row.id, { ...row, motion: { speed } }]));
}

/**
 * Admitted AssemblyScript species brains (SHARD-PLATFORM SF27): a species row's `brain: { archetype: 'script', data }`
 * names a module the game admits on its own ScriptHost under the unchanged ABI-v0 fuel, memory, event, query and failure
 * ceilings (as the shard directors and the weapon hooks). Each decision is a pure call: the module's memory and globals
 * return to their admitted state after it, and the creature's state lives in the host as declared numeric slots, so a
 * policy's continuation is its slots and its strike clock, never module memory.
 *
 * The call's input slots (f64): 0 the call's tick, 1 dt, 2 the phase (1 think, 2 act), 3 the module's entity, 4 alive,
 * 5 calm, 6 the clock, 7 the horizontal distance to the player, 8 the yaw toward the player, 9-10 the player's x z,
 * 11-12 the actor's x z, 13 its yaw, 14 its seed hash (`seedHash`), 15 its strike phase (0 idle, 1 windup, 2 active,
 * 3 recover, 4 cooldown), 16 strike busy, 17… its `slots` in order, then its declared `memory` fields' values. The
 * answer is field records on the entity — 1… the new slots, 21… new memory values, 31-33 a steer (yaw, speed, turn rate,
 * speed and turn within the declared bounds) — and at most one declared strike event (trigonometry goes through the math
 * query, `SPECIES_MATH_QUERY`, so it matches the host's Math exactly): the host then asks reach, then an
 * attack token, then picks the strike from the declared catalogue (the trusted StrikeRunner owns windup, contact, damage
 * and cooldown). A trap, a fuel overrun or an undeclared record refuses the call (the body stands still that step).
 */

/**
 * The math query (kind 1): `[op, kx, x, ky, y, 0, 0, 0]` answers `[f(kx * 8192 + x, ky * 8192 + y)]` with the host's own
 * Math (op 1 sin, 2 cos, 3 atan2), so a module's trigonometry is bit-identical to the TypeScript policies' in every
 * client; a large argument is split into an exact multiple of 8192 and a remainder, inside the query's ±10,000 inputs.
 */
export const SPECIES_MATH_QUERY = 1;
/** The math query's answer for one request (`SPECIES_MATH_QUERY`). */
export function speciesMath(request: readonly number[]): number {
  const [op, kx = 0, x = 0, ky = 0, y = 0] = request, a = kx * 8192 + x, b = ky * 8192 + y;
  if (op === 1) return Math.sin(a);
  if (op === 2) return Math.cos(a);
  if (op === 3) return Math.atan2(a, b);
  throw new Error('Unknown species math operation');
}
/** The phase selector in input slot 2. */
export const SPECIES_SCRIPT_PHASE: Readonly<{ think: 1; act: 2; }> = Object.freeze({ think: 1, act: 2 });
const speciesScriptsENTITY = 1, speciesScriptsSLOT = 1, MEMORY = 21, STEER = 31, INPUT_SLOTS = 17;
const PHASES = ['idle', 'windup', 'active', 'recover', 'cooldown'] as const;

/** A module's bytes from the base64 its bake wrote (a trusted runtime imports them as data, so admission stays synchronous). */
export function moduleBytes(base64: string): Uint8Array { return Uint8Array.from(atob(base64), char => char.codePointAt(0) ?? 0); }
/** A stable per-actor hash of its seed (an integer below 43,759): `seedHash(seed) % n` is its slot of n. */
export function seedHash(seed: number): number { return Math.floor(Math.abs(Math.sin(seed * 12.9898 + 1.7) * 43758.5)); }

class SpeciesScriptWorld extends ScriptWorld {
  private readonly data: ScriptSpeciesData;
  constructor(data: ScriptSpeciesData) {
    const fields: Record<number, readonly [number, number]> = { [STEER]: [-1000, 1000], [STEER + 1]: [0, data.maxSpeed], [STEER + 2]: [0, data.maxTurnRate] };
    data.slots.forEach((_, i) => { fields[speciesScriptsSLOT + i] = [-1e9, 1e9]; });
    data.memory.forEach((_, i) => { fields[MEMORY + i] = [-1e6, 1e6]; });
    super({ fields, archetypes: [], events: data.strikes.map(s => s.event), maxEntities: 1 },
      [{ id: speciesScriptsENTITY, name: data.id, position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]);
    this.data = data;
  }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    if (self !== speciesScriptsENTITY || effects.filter(e => e.op === SCRIPT_OP.event).length > 1
      || effects.some(e => (e.op !== SCRIPT_OP.field && e.op !== SCRIPT_OP.event) || (e.op === SCRIPT_OP.event && !this.data.strikes.some(s => s.event === e.a)))) throw new Error('Invalid species script answer');
    return super.prepare(effects, self, spawns, events);
  }
}

/** One call's decoded answer. */
export interface SpeciesScriptAnswer { readonly slots: ReadonlyMap<number, number>; readonly memory: ReadonlyMap<number, number>; readonly steer: readonly [number, number, number] | null; readonly strike: string | null }

/** One admitted species module: `decide(phase, observations)` answers one pure call. */
export class SpeciesScriptLane {
  readonly data: ScriptSpeciesData;
  private readonly host: ScriptHost;
  private readonly admitted: ScriptSnapshot;
  private tick = 0;
  constructor(data: ScriptSpeciesData, bytes: Uint8Array) {
    this.data = parseScriptSpecies(data);
    if (sha256(bytes) !== this.data.module) throw new Error('Species script module hash mismatch');
    this.host = new ScriptHost({ world: new SpeciesScriptWorld(this.data), query: (kind, request, self) => {
      if (self !== speciesScriptsENTITY || request.length !== 8) throw new Error('Species scripts query as their entity');
      if (kind === SPECIES_MATH_QUERY) return [speciesMath(request)];
      if (kind !== SCRIPT_PARAMETER_QUERY || request.some(value => value !== 0)) throw new Error('Species scripts query only their parameters and the math query');
      return [...this.data.parameters];
    } });
    this.host.install(this.data.module, Uint8Array.from(bytes));
    this.admitted = this.host.snapshot(this.data.module);
  }
  /** Calls made so far (each is its own script tick). */
  get calls(): number { return this.tick; }
  /** One pure call; null when the module refused it (a trap, fuel, an undeclared record). */
  decide(phase: number, observations: readonly number[]): SpeciesScriptAnswer | null {
    this.host.beginTick(++this.tick);
    const call = this.host.call(this.data.module, speciesScriptsENTITY, [this.tick, ...observations.slice(1)]);
    if (call.ok) this.host.rewind(this.data.module, this.admitted);
    else { if (!call.disabled) this.host.resume(this.data.module, speciesScriptsENTITY); return null; }
    const slots = new Map<number, number>(), memory = new Map<number, number>(), steer: number[] = [];
    let strike: string | null = null;
    for (const effect of call.effects) {
      if (effect.op === SCRIPT_OP.event) { strike = this.data.strikes.find(s => s.event === effect.a)?.strike ?? null; continue; }
      if (effect.a >= STEER) steer[effect.a - STEER] = effect.b;
      else if (effect.a >= MEMORY) memory.set(effect.a - MEMORY, effect.b);
      else slots.set(effect.a - speciesScriptsSLOT, effect.b);
    }
    const [yaw, speed, turn] = steer;
    if (phase !== SPECIES_SCRIPT_PHASE.think && phase !== SPECIES_SCRIPT_PHASE.act) throw new Error('Unknown species script phase');
    return { slots, memory, strike, steer: yaw === undefined || speed === undefined || turn === undefined ? null : [yaw, speed, turn] };
  }
}

/** What a script species policy observes (the browser's ThinkCtx and the headless HomeObservation both satisfy it). */
export interface ScriptSpeciesPorts<A extends AnimalSim> {
  dt: number; t: number; player: A['position']; calm: boolean;
  reach: (actor: A) => boolean; claim: (actor: A) => boolean; hurt: (damage: number) => void;
  steer: (actor: A, yaw: number, speed: number, turn: number) => void;
}

const speciesScriptsSaved = v.strictObject({ version: v.literal(1), actor: v.string(), slots: v.array(v.pipe(v.number(), v.finite())), strikes: v.unknown() });

/** Existing player contact authority; no callback is authored by a species row. */
export interface SpeciesContactPorts<A extends AnimalSim> {
  readonly player: A['position']; reach: (actor: A) => boolean; hurt: (damage: number) => void;
}
/** Cached actual-body contact packet shared by script and memory-action policies. */
class SpeciesContact<A extends AnimalSim> {
  private ports: SpeciesContactPorts<A> | null = null;
  private readonly packet: { actor: A; target: A['position']; canReach: () => boolean; hit: (spec: StrikeSpec) => void };
  constructor(actor: A) {
    this.packet = { actor, target: actor.position, canReach: () => this.ports?.reach(actor) === true,
      hit: spec => { this.ports?.hurt(spec.damage); } };
  }
  context(ports: SpeciesContactPorts<A>): StrikeContext {
    this.ports = ports; this.packet.target = ports.player; return this.packet;
  }
}

/** One body's script policy: its slots, its strike clock and the shared admitted lane. */
export class ScriptSpeciesPolicy<A extends AnimalSim> {
  private readonly actor: A;
  private readonly lane: SpeciesScriptLane;
  private readonly catalogue: readonly StrikeSpec[];
  private readonly strikes = new StrikeRunner();
  private readonly slots: number[];
  private readonly input: number[];
  private readonly contact: SpeciesContact<A>;
  constructor(actor: A, lane: SpeciesScriptLane, catalogue: readonly StrikeSpec[]) {
    this.actor = actor; this.lane = lane; this.catalogue = catalogue;
    this.slots = [...lane.data.slots]; this.input = Array.from({ length: INPUT_SLOTS + this.slots.length + lane.data.memory.length }, () => 0);
    for (const row of lane.data.memory) actor.mem[row.field] = row.initial;
    this.contact = new SpeciesContact(actor);
  }
  /** The policy's current slot values (a witness; the continuation is `snapshot`). */
  get state(): readonly number[] { return this.slots; }
  private context(ports: ScriptSpeciesPorts<A>): StrikeContext { return this.contact.context(ports); }
  private call(phase: number, ports: ScriptSpeciesPorts<A>): void {
    const a = this.actor, input = this.input, dx = ports.player.x - a.position.x, dz = ports.player.z - a.position.z;
    input[1] = ports.dt; input[2] = phase; input[4] = a.alive ? 1 : 0; input[5] = ports.calm ? 1 : 0; input[6] = ports.t;
    input[7] = Math.hypot(dx, dz); input[8] = Math.atan2(dx, dz); input[9] = ports.player.x; input[10] = ports.player.z;
    input[11] = a.position.x; input[12] = a.position.z; input[13] = a.yaw; input[14] = seedHash(a.seed);
    input[15] = PHASES.indexOf(this.strikes.state); input[16] = this.strikes.busy ? 1 : 0;
    this.slots.forEach((value, i) => { input[INPUT_SLOTS + i] = value; });
    this.lane.data.memory.forEach((row, i) => { input[INPUT_SLOTS + this.slots.length + i] = a.mem[row.field] ?? 0; });
    const answer = this.lane.decide(phase, input);
    if (answer === null) { ports.steer(a, a.yaw, 0, 0); return; }
    answer.slots.forEach((value, i) => { if (i < this.slots.length) this.slots[i] = value; });
    answer.memory.forEach((value, i) => { const row = this.lane.data.memory[i]; if (row !== undefined) a.mem[row.field] = value; });
    if (answer.steer !== null) ports.steer(a, answer.steer[0], answer.steer[1], answer.steer[2]);
    if (answer.strike !== null && !this.strikes.busy && ports.reach(a) && ports.claim(a)) {
      const pick = this.strikes.pick(this.catalogue, this.context(ports)); if (pick) this.strikes.start(pick, a, ports.player);
    }
  }
  /** A decision (the module's think phase). */
  think(ports: ScriptSpeciesPorts<A>): void { this.call(SPECIES_SCRIPT_PHASE.think, ports); }
  /** A movement step: the strike clock advances while alive, then the module's act phase. */
  act(ports: ScriptSpeciesPorts<A>): void {
    if (this.actor.alive) this.strikes.update(ports.dt, this.context(ports));
    this.call(SPECIES_SCRIPT_PHASE.act, ports);
  }
  /** Complete continuation: the slots and the strike clock; no decision, motion or strike runs on restore. */
  snapshot(): SimValue { return JSON.stringify({ version: 1, actor: this.actor.entityId, slots: this.slots, strikes: this.strikes.snapshot() }); }
  restore(input: SimValue): void {
    if (typeof input !== 'string') throw new Error('Invalid script species continuation');
    const parsed: unknown = JSON.parse(input), value = v.parse(speciesScriptsSaved, parsed);
    if (value.actor !== this.actor.entityId || value.slots.length !== this.slots.length) throw new Error('Incompatible script species continuation');
    this.strikes.restore(readStrikeState(value.strikes, this.catalogue), this.catalogue);
    value.slots.forEach((slot, i) => { this.slots[i] = slot; });
  }
}


/**
 * Admitted AssemblyScript elite fight scripts (SHARD-PLATFORM SF27): a named elite's fight — the moves it picks, its clocks
 * and its tells — is a module the game admits on its own ScriptHost under the unchanged ABI-v0 ceilings (as the species
 * scripts, the directors and the weapon hooks). The game's elite rules (lair, aware / engaged / leash, phase 2, respawn) and
 * the trusted strike runners stay the host's; each engaged step is one pure call (the module returns to its admitted memory
 * after it) whose state lives in the host as declared numeric `slots`, so the elite's continuation is its slots.
 *
 * The call's inputs (f64): 0 the call's tick, 1 dt, 2 the clock, 3 the module's entity, 4 the elite's mode (its index in
 * `modes`), 5 the mode's seconds, 6 phase 2, 7 the horizontal distance and 8 the yaw to the player, 9-10 the player's x z,
 * 11-12 the body's x z, 13 its seed, 14 its last hit time (never under -1e9), 15 god mode, 16-18 lane 0's state (0 none,
 * 1 tell, 2 run, 3 skid), clock and busy, 19-20 two shard-defined host values, 21… the slots in order. Before the call, the
 * ring tell's clock moves to the frame's, then a lane whose `lanes` row names the current mode steps on the body clock (its
 * hit hurts the player, then shakes by `trauma`).
 *
 * The answer is an ordered command stream: field records 1… are the new slots, 41-42 two argument registers, and each
 * event is one verb applied in order with its value and the registers (`ELITE_VERB`). Trigonometry and hypot go through
 * the math query (kind 1: op 1 sin, 2 cos, 3 atan2, 4 hypot on the host's Math), so a module matches the TypeScript goal
 * it replaces bit for bit; kind 2 draws the elite's own seeded stream. A trap, a fuel overrun or an undeclared record
 * refuses the call (the body stands still that step).
 */

/** The verbs an elite script's events name (event id → verb). */
export const ELITE_VERB: Readonly<{
/** value: the new mode's index (its clock restarts) */
mode: 1;
/** value: yaw; registers: speed, turn rate (inside the declared bounds) */
steer: 2;
/** value: look weight; registers: the target's height over the player, 1 to aim at the player (0 keeps the target) */
look: 3;
/** value: the voice's index */
voice: 4;
/** the elite's signature flash */
signature: 5;
/** value: the lane; registers: tell seconds, speed multiplier (aimed through the player) */
lane: 6;
/** value: the contact's index */
contact: 7;
/** value: the shake */
trauma: 8;
/** value: the body's attack seconds */
attack: 9;
/** value: the ring tell's radius round the body; register: its opacity */
ring: 10;
/** the ring tell off */
ringHide: 11;
/** value: the shard action's index */
action: 12; }> = Object.freeze({
  /** value: the new mode's index (its clock restarts) */
  mode: 1,
  /** value: yaw; registers: speed, turn rate (inside the declared bounds) */
  steer: 2,
  /** value: look weight; registers: the target's height over the player, 1 to aim at the player (0 keeps the target) */
  look: 3,
  /** value: the voice's index */
  voice: 4,
  /** the elite's signature flash */
  signature: 5,
  /** value: the lane; registers: tell seconds, speed multiplier (aimed through the player) */
  lane: 6,
  /** value: the contact's index */
  contact: 7,
  /** value: the shake */
  trauma: 8,
  /** value: the body's attack seconds */
  attack: 9,
  /** value: the ring tell's radius round the body; register: its opacity */
  ring: 10,
  /** the ring tell off */
  ringHide: 11,
  /** value: the shard action's index */
  action: 12,
});
const VERBS: readonly number[] = Object.values(ELITE_VERB);
/** The random query (kind 2): one draw of the elite's own seeded stream. */
export const ELITE_RANDOM_QUERY = 2;
const eliteScriptsENTITY = 1, eliteScriptsSLOT = 1, ARG = 41, SLOTS_AT = 21;
const HYPOT = 4;

/** The math query's answer: the species math ops plus 4, hypot (`Math.hypot(a, b)`). */
export function eliteMath(request: readonly number[]): number {
  const [op, kx = 0, x = 0, ky = 0, y = 0] = request;
  return op === HYPOT ? Math.hypot(kx * 8192 + x, ky * 8192 + y) : speciesMath(request);
}

class EliteScriptWorld extends ScriptWorld {
  private readonly slotCount: number;
  constructor(data: EliteScriptData) {
    const fields: Record<number, readonly [number, number]> = { [ARG]: [-1e9, 1e9], [ARG + 1]: [-1e9, 1e9] };
    data.slots.forEach((_, i) => { fields[eliteScriptsSLOT + i] = [-1e9, 1e9]; });
    super({ fields, archetypes: [], events: [...VERBS], maxEntities: 1 },
      [{ id: eliteScriptsENTITY, name: data.id, position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]);
    this.slotCount = data.slots.length;
  }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    if (self !== eliteScriptsENTITY || effects.some(e => (e.op !== SCRIPT_OP.field && e.op !== SCRIPT_OP.event)
      || (e.op === SCRIPT_OP.field && e.a > this.slotCount && e.a !== ARG && e.a !== ARG + 1))) throw new Error('Invalid elite script answer');
    return super.prepare(effects, self, spawns, events);
  }
}

/** One verb of an answer, with its value and the argument registers as they stood. */
export interface EliteCommand { readonly verb: number; readonly value: number; readonly args: readonly [number, number] }

/** One admitted elite module over one elite's slots and seeded stream: `decide(inputs)` answers one pure call. */
export class EliteScriptLane {
  readonly data: EliteScriptData;
  private readonly host: ScriptHost;
  private readonly admitted: ScriptSnapshot;
  private readonly values: number[];
  private tick = 0;
  constructor(data: EliteScriptData, bytes: Uint8Array, random: () => number) {
    this.data = parseEliteScript(data);
    if (sha256(bytes) !== this.data.module) throw new Error('Elite script module hash mismatch');
    this.values = this.data.slots.map(s => s.initial);
    this.host = new ScriptHost({ world: new EliteScriptWorld(this.data), query: (kind, request, self) => {
      if (self !== eliteScriptsENTITY || request.length !== 8) throw new Error('Elite scripts query as their entity');
      if (kind === SPECIES_MATH_QUERY) return [eliteMath(request)];
      if (kind === ELITE_RANDOM_QUERY && request.every(value => value === 0)) return [random()];
      if (kind !== SCRIPT_PARAMETER_QUERY || request.some(value => value !== 0)) throw new Error('Elite scripts query only their parameters, the math and their stream');
      return [...this.data.parameters];
    } });
    this.host.install(this.data.module, Uint8Array.from(bytes));
    this.admitted = this.host.snapshot(this.data.module);
  }
  /** A slot's value by its declared field. */
  slot(field: string): number {
    const i = this.data.slots.findIndex(s => s.field === field), value = this.values[i];
    if (value === undefined) throw new Error(`Elite script ${this.data.id} has no slot ${field}`);
    return value;
  }
  /** Set a slot (a restore, a dev move). */
  setSlot(field: string, value: number): void {
    const i = this.data.slots.findIndex(s => s.field === field);
    if (i === -1 || !Number.isFinite(value)) throw new Error(`Elite script ${this.data.id} cannot set ${field}`);
    this.values[i] = value;
  }
  /** One pure call over inputs 1-20 (`observations[0]` and [3] are the host's); null when the module refused it. */
  decide(observations: readonly number[]): readonly EliteCommand[] | null {
    this.host.beginTick(++this.tick);
    const input = observations.slice(0, SLOTS_AT);
    input[0] = this.tick; input.push(...this.values);
    const call = this.host.call(this.data.module, eliteScriptsENTITY, input);
    if (call.ok) this.host.rewind(this.data.module, this.admitted);
    else { if (!call.disabled) this.host.resume(this.data.module, eliteScriptsENTITY); return null; }
    const out: EliteCommand[] = [], args: [number, number] = [0, 0];
    for (const effect of call.effects) {
      if (effect.op === SCRIPT_OP.event) { out.push({ verb: effect.a, value: effect.c, args: [args[0], args[1]] }); continue; }
      if (effect.a === ARG) args[0] = effect.b;
      else if (effect.a === ARG + 1) args[1] = effect.b;
      else this.values[effect.a - eliteScriptsSLOT] = effect.b;
    }
    return out;
  }
}



/**
 * A species row's declared brain (SHARD-PLATFORM SF27): a platform archetype and its data, resolved the same way by the
 * browser client (`SpeciesBrains.bind`) and the headless host (`installSpeciesHomes`). A challenge grazer's circling
 * phase is the actor seed's slot in `[0, phaseSlots)` (`seedSlot`), so a pack spreads round its home. A `decision` brain lends its body
 * to an admitted guest while the existing encounter owns its memory marks.
 */
export type SpeciesBrain =
  | { readonly archetype: 'grazer'; readonly data: Extract<v.InferInput<typeof GrazerSchema>, { pattern: 'wander-ram' }> }
  | { readonly archetype: 'grazer'; readonly data: Extract<v.InferInput<typeof GrazerSchema>, { pattern: 'circle-challenge' }>; readonly phaseSlots: number }
  | { readonly archetype: 'diver'; readonly data: v.InferInput<typeof DiverSchema> }
  | { readonly archetype: 'decision'; readonly data: BorrowedDecision }
  | { readonly archetype: 'challenge-grazer'; readonly data: v.InferInput<typeof ChallengeGrazerSchema>; readonly phaseSlots: number }
  | { readonly archetype: 'patrol-diver'; readonly data: v.InferInput<typeof PatrolDiverSchema> }
  | { readonly archetype: 'script'; readonly data: v.InferInput<typeof ScriptSpeciesSchema> }
  | { readonly archetype: 'stalker'; readonly data: v.InferInput<typeof StalkerSchema> }
  | { readonly archetype: 'skirmisher'; readonly data: v.InferInput<typeof SkirmisherSchema> }
  | { readonly archetype: 'guardian'; readonly data: v.InferInput<typeof GuardianSchema> | v.InferInput<typeof GuardianPatternsSchema> }
  | { readonly archetype: 'perch-hunter'; readonly data: v.InferInput<typeof PerchHunterSchema> };
/** A species' gameplay data with an optional declared brain; a row without one keeps its runtime's own policy. */
export type BrainedSpecies = Omit<SpeciesRow, 'parent' | 'think' | 'act'> & { readonly brain?: SpeciesBrain; readonly body?: CreatureBodyRecipe };

/** Existing grounded observations lent by the page or native species owner. */
export type SpeciesActionPorts<A extends AnimalSim> = SkirmisherPorts<A> & GuardianPorts<A> & SpeciesContactPorts<A>;
const actionContact = new StrikeRunner();
function speciesActions<A extends AnimalSim>(actor: A, brain: Admitted, rows: CreatureMemoryActions,
  strikes: ReadonlyMap<string, StrikeSpec>, existing?: SkirmisherBrain<A> | GuardianBrain<A>): SpeciesPolicy<SpeciesActionPorts<A>> {
  const policy = existing ?? (brain.archetype === 'skirmisher' ? new SkirmisherBrain(actor, brain.data)
    : brain.archetype === 'guardian' ? new GuardianBrain(actor, brain.data) : null);
  if (policy === null) throw new Error('Memory actions require a grounded declared policy');
  const contact = new SpeciesContact(actor);
  const actions = rows.actions.map((row, index) => ({ ...row, effect: String(index) }));
  const effects = new Map(actions.map(row => {
    const base = strikeOf(strikes, row.strike, actor.kind), spec = { ...base, shape: { ...base.shape } };
    return [row.effect, (_body: A, ports: SpeciesActionPorts<A>): void => {
      if (row.damage === 'charge') spec.damage = actor.mods.chargeDamage;
      if (row.radiusScale !== undefined && spec.shape.kind === 'point' && base.shape.kind === 'point')
        spec.shape.radius = base.shape.radius * Math.max(row.radiusScale.minimum, actor.scale * row.radiusScale.factor);
      if (actionContact.contact(spec, contact.context(ports)) && row.sound !== undefined) ports.sound(row.sound);
    }] as const;
  }));
  const bound = createMemoryActionBrain<A, SpeciesActionPorts<A>>(actor, { stateKey: rows.stateKey, states: rows.states, actions },
    { decide: (_body, ports) => { policy.think(ports); }, effects });
  return { think: ports => { bound.think(ports); }, act: ports => { bound.act(ports); },
    snapshot: () => policy.snapshot(), restore: saved => { policy.restore(saved); } };
}

/** A finite circular home supplied by the actual owning body before its policy initializes. */
export interface SpeciesBodyHome { readonly x: number; readonly z: number; readonly r: number; readonly y: number }
/** Resolve each browser body's existing home; this callback never allocates a body or draws random numbers. */
export type SpeciesBodyHomes = (actor: Animal) => SpeciesBodyHome;

/** Native policies require explicit live home/RNG (ram), attack permission/flight (orbit), or flight/player shove (burst), plus reach/claim/hurt. */
export type SpeciesDecision<A extends AnimalSim> =
  | { readonly archetype: 'ram-grazer'; readonly policy: RamGrazerBrain<A> }
  | { readonly archetype: 'orbit-diver'; readonly policy: OrbitDiverBrain<A> }
  | { readonly archetype: 'burst-flyer'; readonly policy: BurstFlyerBrain<A> }
  | { readonly archetype: 'skirmisher'; readonly policy: SkirmisherBrain<A> }
  | { readonly archetype: 'guardian'; readonly policy: GuardianBrain<A> }
  | { readonly archetype: 'perch-hunter'; readonly policy: PerchHunterBrain<A> };
/** A trusted browser body adapter, constructed once at the first think/act without advancing policy or RNG.
 * The optional third argument lends that first callback context; subsequent callbacks keep their own live context. */
export type SpeciesNativeFactory = (actor: Animal, decision: SpeciesDecision<Animal>, firstContext?: ThinkCtx) => {
  think: (context: ThinkCtx) => void; act: (context: ThinkCtx) => void;
};

/** One policy's continuation-bearing surface: decisions, movement, and its exact snapshot / restore. */
export interface SpeciesPolicy<P> { think: (ports: P) => void; act: (ports: P) => void; snapshot: () => SimValue; restore: (value: SimValue) => void }

/**
 * What one home body's policy observes in the headless host, allocated once at its spawn and refreshed each call: the
 * union of every archetype's ports (and a runtime's own policies'), the host's player, attack tokens, reach and contact.
 */
export interface HomeObservation {
  dt: number; t: number; player: Vector3; calm: boolean; phaseOffset: number;
  reach: (actor: AnimalSim) => boolean; claim: (actor: AnimalSim) => boolean; hurt: (damage: number) => void;
  steer: (actor: AnimalSim, yaw: number, speed: number, turn: number) => void;
  flight: { steer: (actor: AnimalSim, yaw: number, speed: number, altitude: number, turn: number) => void };
}

type Admitted =
  | { readonly archetype: 'ram-grazer'; readonly data: ShardRamGrazer; readonly strike: StrikeSpec }
  | { readonly archetype: 'orbit-diver'; readonly data: ShardOrbitDiver; readonly strike: StrikeSpec }
  | { readonly archetype: 'burst-flyer'; readonly data: ShardBurstFlyer; readonly strike: StrikeSpec }
  | { readonly archetype: 'challenge-grazer'; readonly data: ShardChallengeGrazer; readonly phaseSlots: number; readonly charge: StrikeSpec; readonly close: StrikeSpec }
  | { readonly archetype: 'patrol-diver'; readonly data: ShardPatrolDiver; readonly strike: StrikeSpec }
  | { readonly archetype: 'decision'; readonly data: BorrowedDecision }
  | { readonly archetype: 'script'; readonly data: ScriptSpeciesData; readonly lane: SpeciesScriptLane; readonly catalogue: readonly StrikeSpec[] }
  | { readonly archetype: 'skirmisher'; readonly data: ShardSkirmisher }
  | { readonly archetype: 'guardian'; readonly data: ShardGuardian }
  | { readonly archetype: 'perch-hunter'; readonly data: ShardPerchHunter };

/** A stable small integer per actor (its seed hashed) in `[0, n)`: the slot a pack member takes round a ring. */
export function seedSlot(seed: number, n: number): number { return Math.floor(Math.abs(Math.sin(seed * 12.9898 + 1.7) * 43758.5)) % n; }

/** Ordered browser metadata bindings; held preparation uses the same admitted binding and actual body. */
export interface SpeciesPageCatalogue {
  readonly rows: readonly SpeciesRow[];
  prepareHeld: (kind: string, actor: Animal) => HeldSpeciesControl | null;
}
/** Browser catalogue authority, lent by its existing owner. Actual body homes supersede these fallbacks. */
export interface SpeciesCataloguePorts { readonly homes?: Readonly<Record<string, SpeciesBodyHome>>; readonly held?: SpeciesHeldPorts; readonly decisions?: SpeciesDecisionAuthority }

/** The admitted brains of a species catalogue, by kind: the browser rows, the live witness and the headless policies. */
export interface SpeciesBrains {
  /** The kinds that run a declared brain. */
  readonly kinds: ReadonlySet<string>;
  /**
   * The browser callbacks of a declared kind: `think` / `act` bound to one policy per animal, spread onto its species
   * row (`{ ...ROW, ...brains.bind(kind) }`). Each call binds a fresh policy table; a kind without a brain refuses.
   */
  bind: (kind: string, native?: SpeciesNativeFactory, homes?: SpeciesBodyHomes, held?: SpeciesHeldPorts, decisions?: SpeciesDecisionAuthority) => SpeciesBinding;
  /** Bind original metadata in authored order without constructing a body or advancing its policy. */
  catalogue: (rows: readonly SpeciesRow[], ports?: SpeciesCataloguePorts) => SpeciesPageCatalogue;
  /** Lend a browser body's actual finite home before its first decision; no policy or random draw is created. */
  home: (kind: string, actor: Animal, at: SpeciesBodyHome) => void;
  /** The controller prepared by this catalogue's body binding; lookup never advances perception, movement or RNG. */
  held: (kind: string, actor: AnimalSim) => HeldSpeciesControl | null;
  /** Interpret declared body action rows on the actor's existing grounded observations. */
  actions: <A extends AnimalSim>(kind: string, actor: A) => SpeciesPolicy<SpeciesActionPorts<A>> | null;
  /** Construct a decision-only family for a trusted native body adapter; refuses self-contained policy kinds. */
  decision: <A extends AnimalSim>(kind: string, actor: A, home?: SpeciesBodyHome) => SpeciesDecision<A>;
  /** The archetype a live browser animal runs (null when it runs none of these rows' brains). */
  witness: (actor: Animal) => string | null;
  /** A fresh headless policy for one body of a declared kind, or null when the kind declares no brain. */
  policy: (kind: string, actor: AnimalSim) => SpeciesPolicy<HomeObservation> | null;
  /** Bind a declared native recipe to an already-owned body, refusing missing motor, home or attack authority. */
  body: (kind: string, actor: AnimalSim, ports: SpeciesBodyPorts) => KeptPolicy | null;
  /** The headless phase offset of one body (its challenge grazer's seed slot, else 0). */
  phase: (kind: string, actor: AnimalSim) => number;
}

/** Trusted held-body authority supplies player impulses; rows select only admitted numeric recipes. */
export interface SpeciesHeldPorts { readonly shove: (yaw: number, speed: number, lift: number) => void }
/** A held encounter drives its existing body, with read-only strike observations for presentation. */
export interface HeldSpeciesControl {
  phase: number; fighting: boolean; restart: () => void;
  readonly current: StrikeSpec | null; readonly windup: number; readonly aim: number;
  snapshot: () => SimValue; restore: (saved: SimValue) => void;

}
/** Existing contact observations refreshed by the body's actual page/native owner. */
export type SpeciesDecisionObservation = Pick<SpeciesBodyObservation, 'calm' | 'reach' | 'claim' | 'hurt'> & Partial<Pick<SpeciesBodyObservation, 'shove'>>;
export interface BorrowedSpeciesControl extends HeldSpeciesControl { observe: (ports: SpeciesDecisionObservation) => void }
/** Internal game authority; authored rows carry only the admitted selection and numeric recipes. */
export interface SpeciesDecisionAuthority { bind: (actor: AnimalSim, row: BorrowedDecision, body?: CreatureBodyRecipe) => BorrowedSpeciesControl }
/** Preparing a held controller constructs it once without advancing perception, movement or a clock. */
export interface SpeciesBinding extends Required<Pick<SpeciesRow, 'think' | 'act'>> { control?: (actor: Animal) => HeldSpeciesControl }

function strikeOf(strikes: ReadonlyMap<string, StrikeSpec>, id: string, kind: string): StrikeSpec {
  const strike = strikes.get(id); if (strike === undefined) throw new Error(`Species ${kind}'s brain names an undeclared strike ${id}`); return strike;
}
function admit(brain: SpeciesBrain, kind: string, strikes: ReadonlyMap<string, StrikeSpec>, modules: ReadonlyMap<string, Uint8Array>): Admitted {
  switch (brain.archetype) {
    case 'grazer': {
      const data = grazerPreset(parseGrazer(brain.data));
      if (data.kind === 'ram-grazer') return { archetype: data.kind, data, strike: strikeOf(strikes, data.strike, kind) };
      if (!('phaseSlots' in brain)) throw new Error(`Species ${kind}'s challenge grazer requires phase slots`);
      return admit({ archetype: 'challenge-grazer', data, phaseSlots: brain.phaseSlots }, kind, strikes, modules);
    }
    case 'diver': {
      const data = diverPreset(parseDiver(brain.data));
      if (data.kind === 'orbit-diver') return { archetype: data.kind, data, strike: strikeOf(strikes, data.strike, kind) };
      if (data.kind === 'burst-flyer') return { archetype: data.kind, data, strike: strikeOf(strikes, data.strike, kind) };
      return admit({ archetype: 'patrol-diver', data }, kind, strikes, modules);
    }
    case 'stalker': return { archetype: 'skirmisher', data: stalkerPreset(parseStalker(brain.data)) };
    case 'skirmisher': return { archetype: brain.archetype, data: parseSkirmisher(brain.data) };
    case 'guardian': {
      const data = 'pattern' in brain.data ? guardianPreset(parseGuardianPattern(brain.data)) : parseGuardian(brain.data);
      return data.kind === 'guardian' ? { archetype: 'guardian', data } : { archetype: 'perch-hunter', data };
    }
    case 'perch-hunter': return { archetype: brain.archetype, data: parsePerchHunter(brain.data) };
    case 'challenge-grazer': {
      const data = parseChallengeGrazer(brain.data);
      if (!Number.isInteger(brain.phaseSlots) || brain.phaseSlots < 1 || brain.phaseSlots > 64) throw new Error(`Species ${kind}'s phase slots must be an integer in 1..64`);
      return { archetype: brain.archetype, data, phaseSlots: brain.phaseSlots, charge: strikeOf(strikes, data.charge, kind), close: strikeOf(strikes, data.close, kind) };
    }
    case 'patrol-diver': { const data = parsePatrolDiver(brain.data); return { archetype: brain.archetype, data, strike: strikeOf(strikes, data.strike, kind) }; }
    case 'decision': return { archetype: 'decision', data: v.parse(BorrowedDecisionSchema, brain.data) };
    case 'script': {
      const data = parseScriptSpecies(brain.data), bytes = modules.get(data.module);
      if (bytes === undefined) throw new Error(`Species ${kind}'s brain module ${data.module} was not supplied`);
      return { archetype: brain.archetype, data, lane: new SpeciesScriptLane(data, bytes), catalogue: data.strikes.map(row => strikeOf(strikes, row.strike, kind)) };
    }
    default: throw new Error(`Species ${kind} declares an unknown brain archetype`);
  }
}
type Callbacks = SpeciesBinding;

/** Lazily bind one real species policy on its first callback, retaining live context and inspection ownership. */
export function bindCreatureBrain(create: (actor: Animal, context: ThinkCtx) => ReturnType<SpeciesNativeFactory>): {
  readonly callbacks: Pick<SpeciesBinding, 'think' | 'act'>; readonly live: (actor: Animal) => boolean;
} {
  const live = new WeakMap<Animal, ReturnType<SpeciesNativeFactory>>();
  const of = (actor: Animal, context: ThinkCtx): ReturnType<SpeciesNativeFactory> => {
    let value = live.get(actor);
    if (value === undefined) { value = create(actor, context); live.set(actor, value); }
    return value;
  };
  return { live: actor => live.has(actor), callbacks: { think: (actor, context) => { of(actor, context).think(context); },
    act: (actor, context) => { of(actor, context).act(context); } } };
}
/** Browser callbacks bound to one policy per animal (built at its first decision); `live` answers the witness. */
function browserCallbacks(brain: Admitted, native?: SpeciesNativeFactory, homes?: SpeciesBodyHomes,
  held?: Partial<SpeciesHeldPorts> & { register: (actor: AnimalSim, controller: HeldSpeciesControl) => void; occupied: (actor: AnimalSim) => boolean; kind: string }, decisions?: SpeciesDecisionAuthority, body?: CreatureBodyRecipe): { callbacks: Callbacks; live: (actor: Animal) => boolean } {
  switch (brain.archetype) {
    case 'decision': {
      if (held === undefined || decisions === undefined) throw new Error('Decision species requires its existing body authority');
      const live = new WeakMap<Animal, BorrowedSpeciesControl>();
      const of = (actor: Animal): BorrowedSpeciesControl => {
        if (actor.kind !== held.kind) throw new Error('Decision species requires its declared live body');
        let value = live.get(actor);
        if (value === undefined) { value = decisions.bind(actor, brain.data, body); held.register(actor, value); live.set(actor, value); }
        return value;
      };
      const observe = (actor: Animal, context: ThinkCtx): void => { of(actor).observe({ calm: context.calm, reach: () => context.reach(actor), claim: () => context.claim(actor), hurt: context.hurt, ...(held.shove === undefined ? {} : { shove: held.shove }) }); };
      return { live: actor => live.has(actor), callbacks: { think: observe, act: observe, control: of } };
    }
    case 'ram-grazer': case 'orbit-diver': case 'burst-flyer': case 'skirmisher': case 'guardian': case 'perch-hunter': {
      let adapter = native;
      if (adapter === undefined && (brain.archetype === 'ram-grazer' || brain.archetype === 'orbit-diver' || brain.archetype === 'burst-flyer')) {
        if (homes === undefined || (brain.archetype === 'burst-flyer' && held?.shove === undefined)) throw new Error('Species requires its trusted home and body authority');
        adapter = (actor, decision) => {
          if (actor.kind !== held?.kind && held !== undefined) throw new Error('Species requires its declared live body');
          if (decision.archetype === 'ram-grazer') return {
            think: context => { decision.policy.think({ ...context, home: homes(actor) }); },
            act: context => { decision.policy.act({ ...context, home: homes(actor) }); },
          };
          if (decision.archetype === 'orbit-diver') return {
            think: context => { decision.policy.think(context); }, act: context => { decision.policy.act(context); },
          };
          if (decision.archetype === 'burst-flyer' && held?.shove !== undefined) {
            const shove = held.shove;
            return { think: context => { decision.policy.think({ ...context, shove }); },
              act: context => { decision.policy.act({ ...context, shove }); } };
          }
          throw new Error('Species requires its matching declared body policy');
        };
      }
      if (adapter === undefined) throw new Error(`Species ${brain.archetype} requires a trusted native body adapter`);
      if ((brain.archetype === 'orbit-diver' || brain.archetype === 'burst-flyer') && homes === undefined) throw new Error(`Species ${brain.archetype} requires its native body home`);
      return bindCreatureBrain((actor, context) => adapter(actor, decisionOf(brain, actor, homes?.(actor)), context));
    }
    case 'challenge-grazer': {
      const live = new WeakMap<Animal, ChallengeGrazerBrain<Animal>>(), slots = brain.phaseSlots;
      const of = (a: Animal): ChallengeGrazerBrain<Animal> => { let value = live.get(a); if (value === undefined) { value = new ChallengeGrazerBrain(a, brain.data, brain.charge, brain.close); live.set(a, value); } return value; };
      return { live: a => live.has(a), callbacks: {
        think: (a, c) => { of(a).think({ ...c, phaseOffset: seedSlot(a.seed, slots) }); }, act: (a, c) => { of(a).act({ ...c, phaseOffset: seedSlot(a.seed, slots) }); } } };
    }
    case 'patrol-diver': {
      return bindCreatureBrain(actor => new PatrolDiverBrain(actor, brain.data, brain.data.home, brain.strike));
    }
    case 'script': {
      const live = new WeakMap<Animal, ScriptSpeciesPolicy<Animal>>();
      const of = (a: Animal): ScriptSpeciesPolicy<Animal> => { let value = live.get(a); if (value === undefined) { value = new ScriptSpeciesPolicy(a, brain.lane, brain.catalogue); live.set(a, value); } return value; };
      return { live: a => live.has(a), callbacks: { think: (a, c) => { of(a).think(c); }, act: (a, c) => { of(a).act(c); } } };
    }
    default: throw new Error('Unknown admitted brain archetype');
  }
}

function decisionOf<A extends AnimalSim>(brain: Admitted, actor: A, home?: SpeciesBodyHome): SpeciesDecision<A> {
  switch (brain.archetype) {
    case 'ram-grazer': return { archetype: brain.archetype, policy: new RamGrazerBrain(actor, brain.data, brain.strike) };
    case 'orbit-diver': {
      if (home === undefined) throw new Error('Species orbit-diver requires its native body home');
      const data = { ...brain.data, home };
      return { archetype: brain.archetype, policy: new OrbitDiverBrain(actor, data, home, brain.strike) };
    }
    case 'burst-flyer': {
      if (home === undefined) throw new Error('Species burst-flyer requires its native body home');
      const data = { ...brain.data, home };
      return { archetype: brain.archetype, policy: new BurstFlyerBrain(actor, data, home, brain.strike) };
    }
    case 'skirmisher': return { archetype: brain.archetype, policy: new SkirmisherBrain(actor, brain.data) };
    case 'guardian': return { archetype: brain.archetype, policy: new GuardianBrain(actor, brain.data) };
    case 'perch-hunter': return { archetype: brain.archetype, policy: new PerchHunterBrain(actor, brain.data) };
    case 'challenge-grazer': case 'patrol-diver': case 'decision': case 'script':
      throw new Error(`Species ${brain.archetype} is not a native decision family`);
    default: throw new Error('Unknown admitted brain archetype');
  }
}

/** The actual owning host, creature stream and attack authority; a recipe never manufactures any of them. */
export interface SpeciesBodyPorts {
  readonly host: SimHost; readonly stream: Rng; readonly home?: SpeciesBodyHome; readonly decisions?: SpeciesDecisionAuthority;
  readonly attacks: { readonly kind: 'keeper'; readonly claim: (actor: AnimalSim) => boolean }
    | { readonly kind: 'unlimited'; readonly limit: number };
}
/** Once-allocated observations shared by the existing ground, flight and scripted policies. */
export interface SpeciesBodyObservation extends HomeObservation {
  /** Native flight may omit its turn override, retaining the motor's default as the browser does. */
  flight: { steer: (actor: AnimalSim, yaw: number, speed: number, altitude: number, turn?: number) => void };
  readonly rng: Rng; readonly mayAttack: (actor: AnimalSim) => boolean;
  readonly shove: (yaw: number, speed: number, lift: number) => void;
}
/** Bind an admitted body recipe to its existing policy; no roster, clock, RNG draw or continuation is added. */
export function bindSpeciesBody(actor: AnimalSim, input: CreatureBodyRecipe, shared: SpeciesBodyPorts,
  create: (ports: SpeciesBodyObservation) => SpeciesPolicy<SpeciesBodyObservation>, phaseOffset = 0): KeptPolicy {
  const recipe = v.parse(CreatureBodyRecipeSchema, input), { host, attacks } = shared;
  if (host.entities.get(actor.entityId) !== actor || (recipe.motion === 'flight') !== actor.flying)
    throw new Error('Species body requires its actual host and declared motor');
  if (recipe.attack !== attacks.kind || attacks.kind === 'unlimited' && attacks.limit !== Infinity)
    throw new Error('Species body requires its actual attack authority');
  const player = host.playerFocus, point = new Vector3(), dir = new Vector3(), from = new Vector3();
  const impulse = bindPlayerImpulse(velocity => { host.nearestPlayer(actor.position).addImpulse(velocity); });
  const tags: readonly `${string}.${string}`[] = [`creature.${actor.kind}`, 'feel.blow', 'cover.checked'];
  const reach = (body: AnimalSim): boolean => canReach(body, player, host.physics);
  const claim = attacks.kind === 'keeper' ? attacks.claim : (): boolean => true;
  const hurt = (damage: number): void => {
    let rel = Math.atan2(player.x - actor.position.x, player.z - actor.position.z) - actor.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (Math.abs(rel) > recipe.contact.halfArc || !reach(actor)) return;
    if (recipe.contact.kind === 'environment') {
      host.combat.hit({ source: 'env', sourceTags: tags, target: host.nearestPlayer(actor.position).health, amount: damage,
        point: actor.position.clone(), dir: new Vector3(), cause: { kind: actor.kind, label: actor.label } });
    } else {
      point.copy(actor.position); dir.subVectors(player, actor.position).normalize(); from.copy(actor.position);
      host.combat.hit({ source: actor.combatActor(), sourceTags: tags, target: host.nearestPlayer(actor.position).health, amount: damage,
        point, dir, from, moveId: recipe.contact.move });
    }
  };
  const ports: SpeciesBodyObservation = { dt: 0, t: 0, player, calm: false, phaseOffset, rng: shared.stream, reach, claim, mayAttack: claim, hurt,
    steer: (body, yaw, speed, turn) => { body.setMotion(yaw, speed, turn); },
    flight: { steer: (body, yaw, speed, altitude, turn) => { body.fly(yaw, speed, altitude, turn); } },
    shove: impulse.directed };
  const brain = create(ports), observe = (dt: number): void => { ports.dt = dt; ports.t = host.clock.now; };
  return {
    decide: dt => {
      if (recipe.stunned === 'look-hold' && actor.stunned) {
        actor.setMotion(actor.yaw, 0, 1); actor.lookTarget.copy(player); actor.lookWeight = 1; return;
      }
      observe(dt); brain.think(ports);
    },
    move: dt => { observe(dt); brain.act(ports); },
    snapshot: () => brain.snapshot(), restore: value => { brain.restore(value); },
  };
}
function bodyPolicy<P>(policy: SpeciesPolicy<P>, ports: P): SpeciesPolicy<SpeciesBodyObservation> {
  return { think: () => { policy.think(ports); }, act: () => { policy.act(ports); },
    snapshot: () => policy.snapshot(), restore: value => { policy.restore(value); } };
}
function homePolicy(brain: Admitted, actor: AnimalSim): SpeciesPolicy<HomeObservation> {
  switch (brain.archetype) {
    case 'challenge-grazer': return new ChallengeGrazerBrain(actor, brain.data, brain.charge, brain.close);
    case 'patrol-diver': return new PatrolDiverBrain(actor, brain.data, brain.data.home, brain.strike);
    case 'script': return new ScriptSpeciesPolicy(actor, brain.lane, brain.catalogue);
    case 'ram-grazer': case 'orbit-diver': case 'burst-flyer': case 'decision': case 'skirmisher': case 'guardian': case 'perch-hunter':
      throw new Error(`Species ${actor.kind} requires a trusted native body adapter`);
    default: throw new Error('Unknown admitted brain archetype');
  }
}

/**
 * Admit a species catalogue's declared brains (SF27) against its strike rows: every brain's data passes its archetype's
 * strict schema and every strike it names resolves, before any row, policy or actor exists; a script brain's module
 * (`modules`, by hash) is checked against its hash and admitted on its own ScriptHost. Duplicate kinds refuse.
 */
export function admitSpeciesBrains(species: readonly BrainedSpecies[], strikeRows: readonly StrikeData[], modules: ReadonlyMap<string, Uint8Array> = new Map()): SpeciesBrains {
  const strikes = new Map(strikeRows.map(row => [row.id, strikeFromData(row)] as const));
  if (strikes.size !== strikeRows.length || new Set(species.map(row => row.kind)).size !== species.length) throw new Error('Duplicate species kind or strike id');
  const admitted = new Map(species.flatMap(row => row.brain === undefined ? [] : [[row.kind, admit(row.brain, row.kind, strikes, modules)] as const]));
  const bodies = new Map(species.flatMap(row => row.body === undefined ? [] : [[row.kind, v.parse(CreatureBodyRecipeSchema, row.body)] as const]));
  for (const [kind, body] of bodies) {
    const brain = admitted.get(kind);
    if (brain === undefined || brain.archetype === 'perch-hunter'
      || ((brain.archetype === 'skirmisher' || brain.archetype === 'guardian') && bodies.get(kind)?.actions === undefined))
      throw new Error(`Species ${kind} has no admitted native body protocol`);
    if (body.offset !== undefined && brain.archetype !== 'decision') throw new Error('Body offset requires its declared decision owner');
  }
  for (const [kind, body] of bodies) if (body.actions !== undefined) {
    const brain = admitted.get(kind), rows = body.actions;
    if (brain?.archetype !== 'skirmisher' && brain?.archetype !== 'guardian' && brain?.archetype !== 'decision') throw new Error('Unsupported memory-action policy');
    if (brain.archetype === 'decision' && rows.actions.length > 0) throw new Error('Decision body states cannot own a second strike clock');
    if ((brain.archetype !== 'decision' && new Set(rows.states).size !== rows.states.length) || rows.actions.some(row => row.state >= rows.states.length)) throw new Error('Invalid memory-action state');
    for (const row of rows.actions) {
      const strike = strikeOf(strikes, row.strike, kind);
      if (row.radiusScale !== undefined && strike.shape.kind !== 'point') throw new Error('Scaled contact requires a point strike');
    }
  }
  const witnesses: { archetype: string; live: (actor: Animal) => boolean }[] = [];
  const bodyHomes = new WeakMap<Animal, SpeciesBodyHome>();
  const heldControls = new WeakMap<AnimalSim, { kind: string; controller: HeldSpeciesControl }>();
  const registerHeld = (kind: string, actor: AnimalSim, controller: HeldSpeciesControl): void => {
    if (actor.kind !== kind || heldControls.has(actor)) throw new Error('Held species already has an owning controller');
    heldControls.set(actor, { kind, controller });
  };
  const bind: SpeciesBrains['bind'] = (kind, native, homes, held, decisions) => {
      const brain = admitted.get(kind);
      if (brain === undefined) throw new Error(`Species ${kind} declares no brain`);
      const resolveHome = homes === undefined ? undefined : (actor: Animal): SpeciesBodyHome => bodyHomes.get(actor) ?? homes(actor);
      const actions = bodies.get(kind)?.actions;
      const adapter: SpeciesNativeFactory | undefined = native ?? (actions === undefined || brain.archetype === 'decision' ? undefined : (actor, decision) => {
        if (decision.archetype !== 'skirmisher' && decision.archetype !== 'guardian') throw new Error('Memory actions require their grounded policy');
        return speciesActions(actor, brain, actions, strikes, decision.policy);
      });
      const bound = browserCallbacks(brain, adapter, resolveHome, { ...held, kind,
        occupied: actor => heldControls.has(actor),
        register: (actor, controller) => { registerHeld(kind, actor, controller); } }, decisions, bodies.get(kind));
      witnesses.push({ archetype: brain.archetype, live: bound.live }); return bound.callbacks;
  };
  return {
    kinds: new Set(admitted.keys()), bind,
    catalogue: (rows, ports = {}) => {
      if (rows.length > 1024 || new Set(rows.map(row => row.kind)).size !== rows.length) throw new Error('Invalid species catalogue order');
      for (const row of rows) {
        const brain = admitted.get(row.kind), home = ports.homes?.[row.kind];
        if (brain === undefined) throw new Error(`Species ${row.kind} declares no brain`);
        if (home !== undefined) v.parse(CreatureHomeSchema, home);
        if (brain.archetype === 'decision' && ports.decisions === undefined) throw new Error('Held species requires its trusted body authority');
        if ((brain.archetype === 'ram-grazer' || brain.archetype === 'orbit-diver' || brain.archetype === 'burst-flyer')
          && (home === undefined || (brain.archetype === 'burst-flyer' && ports.held === undefined))) throw new Error('Species requires its trusted home and body authority');
        if ((brain.archetype === 'skirmisher' || brain.archetype === 'guardian' || brain.archetype === 'perch-hunter') && bodies.get(row.kind)?.actions === undefined) throw new Error('Species catalogue requires declared body authority');
      }
      const bindings = new Map<string, SpeciesBinding>();
      const bound = rows.map(row => {
        const home = ports.homes?.[row.kind], binding = bind(row.kind, undefined, home === undefined ? undefined : () => home, ports.held, ports.decisions);
        bindings.set(row.kind, binding); return { ...row, ...binding };
      });
      return { rows: bound, prepareHeld: (kind, actor) => {
        const binding = bindings.get(kind);
        if (binding === undefined || actor.kind !== kind) throw new Error('Held species requires its declared live body');
        return binding.control?.(actor) ?? null;
      } };
    },
    home: (kind, actor, at) => {
      if (!admitted.has(kind) || actor.kind !== kind || ![at.x, at.y, at.z, at.r].every(Number.isFinite) || at.r <= 0)
        throw new Error('Species requires its declared finite body home');
      bodyHomes.set(actor, at);
    },
    held: (kind, actor) => {
      if (actor.kind !== kind) throw new Error('Held species requires its declared live body');
      const registered = heldControls.get(actor); return registered?.kind === kind ? registered.controller : null;
    },
    actions: (kind, actor) => {
      const rows = bodies.get(kind)?.actions, brain = admitted.get(kind);
      if (rows === undefined) return null;
      if (brain === undefined || actor.kind !== kind) throw new Error('Memory actions require their actual declared body');
      return speciesActions(actor, brain, rows, strikes);
    },
    decision: (kind, actor, home) => {
      const brain = admitted.get(kind);
      if (brain === undefined) throw new Error(`Species ${kind} declares no brain`);
      return decisionOf(brain, actor, home);
    },
    witness: actor => witnesses.find(entry => entry.live(actor))?.archetype ?? null,
    policy: (kind, actor) => {
      const brain = admitted.get(kind);
      if (brain === undefined) return null;
      return homePolicy(brain, actor);
    },
    body: (kind, actor, shared) => {
      const recipe = bodies.get(kind), brain = admitted.get(kind);
      if (recipe === undefined) return null;
      if (brain === undefined || actor.kind !== kind) throw new Error(`Species ${kind} requires its declared live body`);
      if (shared.home !== undefined) v.parse(CreatureHomeSchema, shared.home);
      const home = shared.home;
      if ((brain.archetype === 'ram-grazer' || brain.archetype === 'orbit-diver' || brain.archetype === 'burst-flyer') && home === undefined)
        throw new Error(`Species ${kind} requires its actual body home`);
      return bindSpeciesBody(actor, recipe, shared, ports => {
        if (brain.archetype === 'decision') {
          if (shared.decisions === undefined) throw new Error('Missing native decision authority');
          const controller = shared.decisions.bind(actor, brain.data, recipe); registerHeld(kind, actor, controller);
          controller.observe(ports);
          return { think: observation => { controller.observe(observation); }, act: observation => { controller.observe(observation); }, snapshot: controller.snapshot, restore: controller.restore };
        }
        if (brain.archetype === 'ram-grazer') {
          if (home === undefined) throw new Error('Missing admitted ram home');
          return bodyPolicy(new RamGrazerBrain(actor, brain.data, brain.strike), Object.assign(ports, { home }));
        }
        if (brain.archetype === 'orbit-diver') {
          if (home === undefined) throw new Error('Missing admitted orbit home');
          const data = { ...brain.data, home }; return new OrbitDiverBrain(actor, data, home, brain.strike);
        }
        if (brain.archetype === 'burst-flyer') {
          if (home === undefined) throw new Error('Missing admitted burst home');
          const data = { ...brain.data, home }; return new BurstFlyerBrain(actor, data, home, brain.strike);
        }
        return homePolicy(brain, actor);
      }, brain.archetype === 'challenge-grazer' ? seedSlot(actor.seed, brain.phaseSlots) : 0);
    },
    phase: (kind, actor) => { const brain = admitted.get(kind); return brain?.archetype === 'challenge-grazer' ? seedSlot(actor.seed, brain.phaseSlots) : 0; },
  };
}

/** A declared catalogue's homes on the platform's renderer-free keeper (`installHomeKeeper`), each body bound to its row. */
export interface SpeciesHomesSpec extends Omit<HomeKeeperSpec, 'scales' | 'policy'> {
  /** The catalogue's rows (each kind's scale range is its first variant's). */
  readonly species: readonly BrainedSpecies[];
  /** The catalogue's admitted brains (`admitSpeciesBrains` over the same rows). */
  readonly brains: SpeciesBrains;
  /** Each body's actual home by its declared id (an island or a flying circle), for the home-bound archetypes. */
  readonly home?: (id: string) => SpeciesBodyHome;
  /** Actual body homes and world-floor ray starts; selects the existing floor query without a private placement callback. */
  readonly placement?: { readonly fallback: number; readonly rows: readonly { readonly id: string; readonly fromY: number; readonly home: SpeciesBodyHome }[] };
  /** Memory holds run in authored order at the keeper's original beforeStep phase. */
  readonly holds?: readonly { readonly home: number; readonly field: string; readonly until: string }[];
  /** The runtime's own body for a kind its rows bind no body recipe (a unique boss), on the same shared ports. */
  readonly decisions?: SpeciesDecisionAuthority;
  readonly custom?: (kind: string, actor: AnimalSim, shared: SpeciesBodyPorts) => KeptPolicy;
}

/** Each species' scale range by kind: its first variant's, the creature manager's first draw (a species without one refuses). */
export function speciesScales(species: readonly { readonly kind: string; readonly variants: readonly { readonly scale: readonly [number, number] }[] }[]): ReadonlyMap<string, readonly [number, number]> {
  return new Map(species.map(row => {
    const variant = row.variants[0]; if (variant === undefined) throw new Error(`Species ${row.kind} has no variant`);
    return [row.kind, variant.scale] as const;
  }));
}
/**
 * Declared homes whose policies come from their species rows (SF27): the keeper's stream, tokens, respawn clocks and
 * exact restore (`installHomeKeeper`), each body bound to its row's native recipe (`SpeciesBrains.body`) on the keeper's
 * own stream, its home and the keeper's attack authority (its tokens; an uncapped keeper grants every attack).
 */
export function installSpeciesHomes(host: SimHost, spec: SpeciesHomesSpec, saved?: Readonly<Omit<SimSnapshot, 'physics'>>): { settle: () => void; homes: () => readonly KeptHome[]; boss: KeptBossBody | null } {
  const { species, brains, home, custom, placement, holds, decisions, ...keeper } = spec;
  const declared = new Map<string, { readonly at: readonly [number, number] }>(spec.homes.map(row => [row.id, row]));
  if (spec.boss !== undefined) declared.set(spec.boss.id, spec.boss);
  const placed = new Map<string, { readonly fromY: number; readonly home: SpeciesBodyHome }>();
  if (placement !== undefined) {
    if (home !== undefined || spec.place !== undefined || spec.adopt !== undefined || !Number.isFinite(placement.fallback)
      || placement.rows.length !== declared.size) throw new Error('Species placement requires one declared floor authority');
    for (const row of placement.rows) {
      if (!declared.has(row.id) || placed.has(row.id) || !Number.isFinite(row.fromY)) throw new Error('Invalid declared species placement');
      v.parse(CreatureHomeSchema, row.home);
      // Preserve authored property order: native continuation records serialize the original home.
      placed.set(row.id, { fromY: row.fromY, home: row.home });
    }
  }
  if (holds !== undefined && (holds.length > 1024 || holds.some(row => !Number.isInteger(row.home) || row.home < 0 || row.home >= spec.homes.length
    || row.field.length === 0 || row.until.length === 0))) throw new Error('Invalid declared species hold');
  const floor = placement === undefined ? undefined : creatureFloor(host, () => placement.fallback);
  const prepared = floor === undefined ? keeper : { ...keeper,
    place: (id: string) => {
      const row = declared.get(id), at = placed.get(id);
      if (row === undefined || at === undefined) throw new Error('Missing declared species placement');
      return floor(row.at[0], row.at[1], at.fromY);
    },
    adopt: (actor: AnimalSim) => { actor.groundHeight = (x, z, fromY) => floor(x, z, fromY).y; },
  };
  return installHomeKeeper(host, { ...prepared, ...(holds === undefined ? {} : { beforeStep: (kept: readonly KeptHome[]) => {
    for (const row of holds) { const actor = kept[row.home]?.actor; if (actor !== null && actor !== undefined) actor.mem[row.field] = host.flags.has(row.until) ? 0 : 1; }
    keeper.beforeStep?.(kept);
  } }), scales: speciesScales(species), policy: (kind, actor, claim, stream) => {
    const at = placed.get(actor.entityId)?.home ?? home?.(actor.entityId);
    const shared: SpeciesBodyPorts = { host, stream, ...(decisions === undefined ? {} : { decisions }), ...(at === undefined ? {} : { home: at }),
      attacks: spec.attackers === Infinity ? { kind: 'unlimited', limit: Infinity } : { kind: 'keeper', claim } };
    const body = brains.body(kind, actor, shared);
    if (body !== null) return body;
    if (custom === undefined) throw new Error(`Species ${kind} has no declared body policy`);
    return custom(kind, actor, shared);
  } }, saved);
}

const bakedFinite = v.pipe(v.number(), v.finite());
/** One baked native simulation spec, strictly: an unknown or missing field refuses the bake rather than defaulting. */
const BakedSpec = v.strictObject({ kind: v.string(), label: v.string(), variant: v.string(), rarity: v.picklist(['common', 'uncommon', 'rare', 'legendary']),
  hp: bakedFinite, aggressive: v.boolean(), lockable: v.optional(v.boolean()),
  dims: v.strictObject({ bodyY: bakedFinite, bodyHalfLen: bakedFinite, bodyRadius: bakedFinite, headRadius: bakedFinite, legLen: bakedFinite, feet: v.array(v.tuple([bakedFinite, bakedFinite])), halfWidth: bakedFinite }),
  mods: v.strictObject({ speed: bakedFinite, chargeDist: bakedFinite, damageTaken: bakedFinite, chargeDamage: bakedFinite, relentless: v.boolean() }),
  flight: v.optional(v.strictObject({ altitude: bakedFinite, above: v.optional(v.picklist(['ground', 'world'])), climbRate: bakedFinite, diveRate: bakedFinite, lockRange: v.optional(bakedFinite), bank: v.optional(bakedFinite) })) });

/** One baked native spec (a shard's physics bake writes it), admitted strictly; an absent optional stays absent. */
export function bakedSpec(input: unknown): AnimalSimSpec {
  const { flight, lockable, ...rest } = v.parse(BakedSpec, input);
  return { ...rest, ...(lockable === undefined ? {} : { lockable }),
    ...(flight === undefined ? {} : { flight: { altitude: flight.altitude, climbRate: flight.climbRate, diveRate: flight.diveRate,
      ...(flight.above === undefined ? {} : { above: flight.above }), ...(flight.lockRange === undefined ? {} : { lockRange: flight.lockRange }),
      ...(flight.bank === undefined ? {} : { bank: flight.bank }) } }) };
}

/**
 * A physics bake's actors as native specs by kind (SHARD-PLATFORM SF72, the headless runtimes' recipes): every body of a
 * kind shares one recipe, so a divergent one refuses, as does a row whose declared `kind` differs from its spec's.
 */
export function bakedSpecs(actors: readonly { readonly kind?: string; readonly spec: unknown }[]): ReadonlyMap<string, AnimalSimSpec> {
  const specs = new Map<string, AnimalSimSpec>();
  for (const actor of actors) {
    const spec = bakedSpec(actor.spec), kind = actor.kind ?? spec.kind, known = specs.get(kind);
    if (spec.kind !== kind || (known !== undefined && JSON.stringify(known) !== JSON.stringify(spec))) throw new Error(`Divergent native spec ${kind}`);
    specs.set(kind, spec);
  }
  return specs;
}

/** A population's authored catalogue and verified script modules; admission creates no actor or tick. */
export interface SpeciesProgramRows {
  readonly species: readonly BrainedSpecies[];
  readonly strikes: readonly unknown[];
  readonly modules?: Readonly<Record<string, string>>;
}
/** Admit the same strict strike, brain and module rows for browser and native populations. */
export function admitSpeciesProgram(rows: SpeciesProgramRows): SpeciesBrains {
  return admitSpeciesBrains(rows.species, rows.strikes.map(row => v.parse(CreatureStrikeSchema, row)),
    new Map(Object.entries(rows.modules ?? {}).map(([hash, base64]) => [hash, moduleBytes(base64)] as const)));
}

/** Authored native hunting setup on the existing sim and stalker owners. */
export interface NativeHuntRow {
  readonly limit: number;
  readonly fight: HuntConfig['fight']; readonly tuning?: ReturnType<HuntConfig['faunaTuning']>;
  readonly player: 'host' | 'origin';
  /** Null retains an already installed built-in body scheduler. */
  readonly bands: { readonly states: readonly string[]; readonly scripted?: boolean; readonly legacyKinds: readonly string[] } | null;
  readonly hit: { readonly namespace: string; readonly tags: readonly CombatTag[] };
}
/** Keep the native manager's existing clocks, charge source, navigation and terrain cadence. */
export function createNativeHunt(host: SimHost, row: NativeHuntRow, ports: {
  readonly rng: Rng; readonly ground: HuntGround; readonly nav: HuntNav | null;
  /** Each kind's species row, as data: a kind missing from the table refuses at its first read. */
  readonly species: ReadonlyMap<string, HuntSpecies>;
  readonly wanderGoal?: (herd: number) => { x: number; z: number; r: number } | null;
  readonly present?: (actor: AnimalSim) => boolean;
}): { readonly hunt: StalkerBrain<HuntBody>; readonly reach: (actor: HuntBody, point: Vector3) => boolean } {
  if (!Number.isInteger(row.limit) || row.limit < 1 || row.limit > 1024 || (row.bands !== null && (row.bands.states.length > 32 || row.bands.legacyKinds.length > 32))) throw new Error('Invalid native hunt bound');
  const bands = row.bands;
  if (bands !== null) host.useBodyBands({ rate: body => body.driven || (bands.scripted === true && body.scripted) || bands.states.includes(body.state) ? 'always'
    : bands.legacyKinds.includes(body.kind) ? 'legacy' : 'ai', ...(ports.present === undefined ? {} : { present: ports.present }) });
  const reach = (actor: HuntBody, point: Vector3): boolean => canReach(actor, point, host.physics);
  const hunt = new StalkerBrain<HuntBody>({ pattern: 'hunt', config: { rng: ports.rng, fight: row.fight, faunaTuning: () => row.tuning, species: kind => {
      const known = ports.species.get(kind); if (known === undefined) throw new Error(`Native hunt has no species row '${kind}'`); return known; } },
    ports: { ground: ports.ground, nav: () => ports.nav, reach, wanderGoal: actor => ports.wanderGoal?.(actor.herd) ?? null, unaware: () => false,
      now: () => host.clock.now * 1000, sound: () => undefined,
      charge: (actor, damage) => { host.combat.hit({ source: 'env', sourceTags: [`${row.hit.namespace}.${actor.kind}`, ...row.hit.tags], target: host.nearestPlayer(actor.position).health,
        amount: damage, point: actor.position.clone(), dir: new Vector3(), cause: { kind: actor.kind, label: actor.label } }); } },
    player: row.player === 'host' ? host.playerFocus : new Vector3(), sampleTerrain: actor => { actor.sampleTerrain(); } });
  return { hunt, reach };
}
/** Native species observations over an existing body and hunt owner. Policy and continuation remain caller-owned.
 * The context allocates once per body; each policy call refreshes only its dt and the actual host clock. */
export function createNativeSpeciesContext<W, A extends HuntBody = HuntBody>(shared: {
  readonly host: SimHost; readonly hunt: StalkerBrain<A>; readonly rng: Rng;
  readonly world: W; readonly heightAt: (x: number, z: number) => number; readonly waterLevel: number;
}, actor: A, herd: readonly A[] | null, label: string = actor.label): {
  observation: {
    dt: number; t: number; player: Vector3; playerSpeed: number; calm: boolean; rng: Rng;
    herd: readonly A[] | null; world: W; heightAt: (x: number, z: number) => number; waterLevel: () => number;
    attackRandom: { range: (min: number, max: number) => number };
    hurt: (damage: number) => void; sound: (name: string) => void;
    steer: (body: A, yaw: number, speed: number, turn: number) => void;
    confine: (body: A) => void; reach: (body: A) => boolean;
    claim: (body: A) => boolean; mayAttack: (body: A) => boolean;
  };
  bind: <P extends { dt: number; t: number }>(observation: P,
    brain: { think: (ports: P) => void; act: (ports: P) => void },
    policy: { snapshot: () => SimValue; restore: (value: SimValue) => void }) => KeptPolicy;
} {
  const { host, hunt } = shared;
  if (host.entities.get(actor.entityId) !== actor) throw new Error('Native species context requires its actual host body');
  const player = host.playerFocus, dir = new Vector3(), attackRandom = host.rng.stream('ai');
  const tags: readonly CombatTag[] = [`creature.${actor.kind}`, 'feel.blow', 'cover.checked'], cause = { kind: actor.kind, label };
  const reach = (body: A): boolean => canReach(body, player, host.physics);
  const observation = {
    dt: 0, t: 0, player, playerSpeed: 0, calm: false, rng: shared.rng, herd, world: shared.world,
    heightAt: shared.heightAt, waterLevel: (): number => shared.waterLevel,
    attackRandom: { range: (min: number, max: number): number => attackRandom.range(min, max) },
    hurt: (damage: number): void => {
      if (!hunt.facing(actor, player, HURT_ARC) || !reach(actor)) return;
      host.combat.hit({ source: 'env', sourceTags: tags, target: host.nearestPlayer(actor.position).health, amount: damage,
        point: actor.position.clone(), dir, cause });
    },
    sound: (_name: string): void => undefined,
    steer: (body: A, yaw: number, speed: number, turn: number): void => { hunt.steerAny(body, yaw, speed, turn); },
    confine: (body: A): void => { hunt.confine(body); }, reach,
    claim: (body: A): boolean => hunt.tokens.take(body), mayAttack: (body: A): boolean => hunt.tokens.free(body),
  };
  return { observation, bind: (ports, brain, policy) => ({
    decide: dt => { ports.dt = dt; ports.t = host.clock.now; brain.think(ports); },
    move: dt => { ports.dt = dt; ports.t = host.clock.now; brain.act(ports); },
    snapshot: () => policy.snapshot(), restore: value => { policy.restore(value); },
  }) };
}
