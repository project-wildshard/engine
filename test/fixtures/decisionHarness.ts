/** CC59h: the decision-script test harness. A test writes a few lines of AssemblyScript, gets a real admitted
 * ABI-1 guest, and runs it through the real ShardDecisions host on a small shardfile, so each `Do.*` verb row can
 * have a failing test first.
 *
 * Tests load no compiler: the guest bytes are source-keyed snapshots in `sdk-built/script-guests` (scriptGuests.ts).
 * A new or changed guest source is pinned once with `WS_FREEZE_GUESTS=1 WS_SHARDDEV=<sharddev checkout>`, which runs
 * `scripts/freeze-script-guest.mjs` (sharddev's real compiler and fuel metering) and writes the snapshot to commit.
 *
 * Guest helpers, all in the guest's own memory (layout from `scriptV1Layout`):
 * - `events()`: inbox events this call; `ev(i, slot)`: slot 0..5 of event i (kind, subject, a, b, c, d).
 * - `emit(op, target, a, b, c)`: append one command (ids from `SCRIPT_V1_COMMANDS`).
 * - `state(i)` / `setState(i, value)`: script state slot i; `self()`: the binding's own actor; `tick()`.
 * - `read(op, a, b)`: `ws_read` (ids from `SCRIPT_V1_READS`; the row must list the read).
 */
// oxlint-disable-next-line import/no-nodejs-modules -- the harness reads the shipped physics bytes and pins guests locally.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- see above.
import { readFileSync } from 'node:fs';
import { scriptV1Layout } from '@wildshard/format/scriptAbiV1';
import { parseDecisionScripts, type DecisionScriptRow } from '@wildshard/format/decisionScripts';
import { parseActorMoves } from '@wildshard/format/actorMoves';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { emptyShardfile } from '../../src/shared/host/author';
import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { createShardfileSim, type ShardfileSimulation, type ShardfileSimPorts } from '../../src/server/game/plugin/simulation';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import type { ShardDecisions } from '../../src/server/game/shardfile/decisions';
import { SIM_LEVEL } from './sim-level/level';
import { frozenLegacyGuest } from './sdk-built/scriptGuests';

/** The guest's I/O base address, the one every existing ABI-1 test guest uses. */
export const GUEST_IO = 16384;
/** Actor handles and ids the default world admits: `actor.a` is 1, `actor.b` is 2, field `phase` is 89. */
export const HARNESS_IDS = { a: 1, b: 2, phase: 89 } as const;

/** AssemblyScript source of a minimal ABI-1 decision guest; `body` runs on every call. */
export function guestSource(body: string, shape: { states?: number; params?: number } = {}): string {
  const io = scriptV1Layout(shape.states ?? 1, shape.params ?? 0), scratch = GUEST_IO + 4096;
  return `@external("env","ws_read") declare function read(op:i32,a:f64,b:f64):f64;
function tick():f64{return load<f64>(${GUEST_IO});}
function self():i32{return i32(load<f64>(${GUEST_IO + 24}));}
function events():i32{return i32(load<f64>(${GUEST_IO + 32}));}
function ev(i:i32,slot:i32):f64{return load<f64>(${GUEST_IO + io.inbox * 8}+usize(i*48+slot*8));}
function state(i:i32):f64{return load<f64>(${GUEST_IO + io.state * 8}+usize(i*8));}
function setState(i:i32,value:f64):void{store<f64>(${GUEST_IO + io.state * 8}+usize(i*8),value);}
function emit(op:i32,target:f64,a:f64,b:f64,c:f64):void{const n=i32(load<f64>(${scratch}));const at=${GUEST_IO + io.outbox * 8}+usize(n*40);
store<f64>(at,f64(op));store<f64>(at+8,target);store<f64>(at+16,a);store<f64>(at+24,b);store<f64>(at+32,c);store<f64>(${scratch},f64(n+1));}
export function ws_abi():i32{return 1;} export function ws_init(lo:i32,hi:i32):void{} export function ws_io():i32{return ${GUEST_IO};}
export function ws_handle():i32{store<f64>(${scratch},0);${body}
return i32(load<f64>(${scratch}));}`;
}

/** The pinned bytes of one guest; pins it first under WS_FREEZE_GUESTS=1. */
export async function decisionGuest(body: string, shape: { states?: number; params?: number } = {}): Promise<Uint8Array> {
  return pinnedGuest(guestSource(body, shape), { abi: 1 });
}
/** Any `compileScript` guest's pinned bytes (a legacy whole-creature brain, say); pins it first under WS_FREEZE_GUESTS=1. */
export async function pinnedGuest(source: string, options: Readonly<Record<string, unknown>>): Promise<Uint8Array> {
  try { return await frozenLegacyGuest(source, options); } catch (error) {
    if (process.env['WS_FREEZE_GUESTS'] !== '1') throw new Error(`Unpinned decision guest: rerun with WS_FREEZE_GUESTS=1 WS_SHARDDEV=<sharddev> to pin it (${String(error)})`);
    execFileSync(process.execPath, ['scripts/freeze-script-guest.mjs'], { input: JSON.stringify(['compileScript', [source, options]]), stdio: ['pipe', 'pipe', 'inherit'] });
    return frozenLegacyGuest(source, options);
  }
}

export interface DecisionWorld {
  source: Shardfile;
  assets: Map<string, Uint8Array>;
  sections: Map<string, unknown>;
  script: DecisionScriptRow;
}
type ScriptInput = Partial<Omit<DecisionScriptRow, 'id' | 'abi' | 'side' | 'module' | 'source'>>;
/** Two boars (`actor.a`, `actor.b`), a 7-damage `bump` strike, a boss encounter on each and one script row. */
export function decisionWorld(wasm: Uint8Array, script: ScriptInput = {}): DecisionWorld {
  const source = emptyShardfile({ slug: 'decision-harness', name: 'Decision Harness', author: 'Test', seed: 2, revision: 1 });
  const native = SIM_LEVEL.entities[0]; if (native === undefined) throw new Error('Missing creature fixture');
  source.rows.species = [{ id: 'boar', kind: 'boar', label: 'Boar', aggressive: false, lockable: true, dims: structuredClone(native.spec.dims),
    variants: [{ id: 'boar', label: 'Boar', rarity: 'common', weight: 1, scale: [1, 1], hp: 100, mods: structuredClone(native.spec.mods) }] }];
  source.rows.strikes = [{ id: 'bump', shape: { kind: 'sphere', radius: 3 }, windup: 0.02, active: 0.05, recover: 0.02, cooldown: 0.02, range: 3, damage: 7, tags: ['dmg.melee'], weight: 1, speed: 0 }];
  source.creatures.spawns = ['actor.a', 'actor.b'].map((id, index) => ({ id, species: 'boar', variant: 'boar', brain: null, strike: null, seed: index + 1, scale: 1, at: [0, 0, 5 + index * 2], yaw: 0 }));
  source.encounters = ['actor.a', 'actor.b'].map((entity, index) => ({ id: `encounter.${index}`, entity, kind: 'boss', panel: null, name: entity, title: 'Test', retry: 'Retry',
    arena: { at: [0, 0, 6], radius: 20 }, intro: 0, introShort: 0, respawn: { at: [0, 0, 0], yaw: 0 }, phases: [{ at: 1, name: 'Fight', caption: 'Fight', speed: 0, stopDistance: 0, turnRate: 2 }] }));
  source.state.shared = [{ id: HARNESS_IDS.phase, name: 'phase', type: 'i32', privacy: 'public', default: 0, min: 0, max: 3 }];
  source.quests.flags = ['done'];
  const moves = parseActorMoves([{ id: 'approach', kind: 'stalk', speed: 1, turn: 2, ground: true, altitude: 0, standOff: 0, ready: { kind: 'band', tolerance: 0.05 } }]);
  const hash = hashImmutableBytes(wasm);
  const [row] = parseDecisionScripts([{ id: 'controller', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/controller.as', binding: { shard: true }, onFail: 'hold',
    on: ['start', 'move.done', 'strike.done', 'hit', 'death'], reads: [], commands: ['move', 'strike', 'field', 'flag'], stateVersion: 1, state: [{ name: 'calls', type: 'i32', default: 0, scope: 'binding' }], params: {},
    actors: { a: 'actor.a', b: 'actor.b' }, moves: { approach: 'approach' }, strikes: { bump: 'bump' }, fields: { phase: 'phase' }, flags: { done: 'done' }, ...script }]);
  if (row === undefined) throw new Error('Missing harness script row');
  return { source, assets: new Map([[hash, wasm]]), sections: new Map<string, unknown>([['sim/scripts', [row]], ['actors/moves', moves]]), script: row };
}

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
export interface DecisionRun {
  live: ShardfileSimulation; decisions: ShardDecisions;
  /** Fixed ticks; a decision call runs on every 6th and its commands commit on the tick after. */
  step: (ticks?: number) => void;
  /** Step through the next decision call and the tick that commits its commands. */
  decide: () => void;
  dispose: () => void;
}
/** Install the world on the real simulation host. */
export async function runDecisionWorld(world: DecisionWorld, ports: Partial<ShardfileSimPorts> = {}): Promise<DecisionRun> {
  // Re-read the row so a test can edit `world.script` after building the world.
  world.sections.set('sim/scripts', [world.script]);
  const live = createShardfileSim(world.source, world.assets, { sections: world.sections, rapier: await rapier, ...ports });
  const decisions = live.decisions; if (decisions === undefined) { live.dispose(); throw new Error('Missing decision host'); }
  const step = (ticks = 1): void => { for (let i = 0; i < ticks; i++) live.host.step(); };
  const decide = (): void => { do step(); while (live.host.state.tick % 6 !== 0); step(); };
  return { live, decisions, step, decide, dispose: () => { live.dispose(); } };
}
