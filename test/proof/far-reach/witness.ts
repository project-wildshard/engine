// oxlint-disable-next-line import/no-nodejs-modules -- The witness reads the shard's admitted in-tree bytes and the native physics module.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The committed checkpoints are gzipped snapshot wires.
import { gunzipSync, gzipSync } from 'node:zlib';
import { readWitnessManifest } from '../../../scripts/witness-checkpoints.mjs';
import * as v from 'valibot';
import { productClosureFile } from '../../../src/shared/game/shardfile/shardProduct';
import { createSimHost, type SimHost } from '../../../src/server/engine/sim';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost } from '../../../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../../../src/server/engine/sim/restore';
import { loadRapier, type Rapier } from '../../../src/shared/engine/physics/rapier';
import { canonicalSimDigest, simWireV1 } from '../../fake/simState';
import { SaveStore, type SaveStorage } from '../../../src/shared/engine/saves/store';
import { Ledger, LedgerEmitter, type LedgerReceipt } from '../../../src/shared/game/ledger';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';
import { prepareNativeRuntime, type HeadlessRuntimeInstallation, type HeadlessRuntimePlan } from '../../../src/server/host/headlessRuntime';
import type { HeadlessCommand, HeadlessEffect } from '../../../src/shared/host/tickProtocol';
import { HeadlessSimulation } from '../../../src/server/host/headless';
import { DECK, STEP, VANES } from "../../../src/shards/far-reach/generators/layout";
import FLAGS from '../../../src/shards/far-reach/data/flags.json' with { type: 'json' };
import {SkyTape} from './tape';
import { ROC_STEP, ROC_ID } from '../../../src/shards/far-reach/generators/rows/rocFight';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/**
 * Sky Reach's whole-shard witness (E435 §C / SF72) on its trusted renderer-free entry, `runtime/headless.ts`, composed
 * exactly as the platform's trusted adapter composes it (`createTrustedHeadlessAdapter`: the plan's level and ports, one
 * install, the tick's commands lent to the runtime, its effects buffered per tick), and cross-checked against the shipping
 * worker (`HeadlessSimulation` + the same real `trustedRuntime` under portable math) from the gale-wall checkpoint. The player's tape is tick commands only
 * (`player` moves, fan swings and HOVER presses; `script` prompts, GUSTs and the fan's aim), chosen each tick from what a
 * player sees: from the spawn on Sunrest to the keeper, over the grove rope bridge, on the board over the hover bridges to
 * the keeper's isle and the roost, on foot to the ruin, each vane GUSTed, the roost's rays felled by the fan, on the board
 * up the updraft to the step, the winch, the raised bridge to the crown and the Storm Roc felled by War Fan play. Nothing
 * writes health, flags, positions or facts: every outcome is gameplay.
 */
export const ENTRY = 'runtime/headless.ts';
const ROOT = new URL('../../../', import.meta.url);
const product = await loadHeadlessProduct('out/far-reach'), source = product.shardfile;
const refs = [...source.files.map(file => file.hash), ...source.requires.commons.map(hash => `commons:${hash}`)];
const assets = new Map(await Promise.all(refs.map(async (ref): Promise<[string, Uint8Array]> => [ref, await productClosureFile(product, ref)])));
const identity = { instance: 'far-reach-witness', shard: source.identity.slug, revision: source.identity.revision };

class ProfileStorage implements SaveStorage {
  private readonly data = new Map<string, string>();
  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}
const profile = (local: ProfileStorage): Ledger => new Ledger(new SaveStore({ local, session: null }), [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], []);

/** One authoritative session: the host, the tick's lent commands and its committed effects. */
interface Session { host: SimHost; tape: readonly HeadlessCommand[]; effects: HeadlessEffect[]; tick: HeadlessEffect[] }
const requireValue = <T>(value: T | undefined | null, message: string): T => { if (value === undefined || value === null) throw new Error(message); return value; };
/** A continuation's hash: the snapshot in canonical form (test/fake/simState.ts: Rapier's snapshot bytes are not canonical, so the
 *  native world counts as the state it restores to, exactly) */
const digest = (host: SimHost): string => canonicalSimDigest(snapshotSimHost(host));

export function skyRapier(): Promise<Rapier> { return loadRapier(readFileSync(new URL('public/assets/physics/rapier.wasm', ROOT))); }
export function skyPlan(rapier: Rapier): Promise<HeadlessRuntimePlan> { return prepareNativeRuntime({ shard: source, assets, rapier, product }); }

function context(session: Omit<Session, 'host'>, saved?: string): HeadlessRuntimeInstallation {
  return { restoring: saved !== undefined, ...(saved === undefined ? {} : { snapshot: decodeSimSnapshot(saved) }), commands: () => session.tape, emit: effect => { session.tick.push(effect); } };
}
function boot(plan: HeadlessRuntimePlan, rapier: Rapier): Session {
  const session = { tape: [] as readonly HeadlessCommand[], effects: [] as HeadlessEffect[], tick: [] as HeadlessEffect[] };
  const host = createSimHost(plan.level, { ...plan.ports, rapier });
  plan.install(host, context(session));
  if (session.tick.length > 0) throw new Error('Installation emitted gameplay effects');
  return Object.assign(session, { host });
}
function restore(plan: HeadlessRuntimePlan, rapier: Rapier, saved: string): Session {
  const session = { tape: [] as readonly HeadlessCommand[], effects: [] as HeadlessEffect[], tick: [] as HeadlessEffect[] }, ports = { ...plan.ports, rapier };
  const host = restoreSimHost(plan.level, ports, decodeSimSnapshot(saved), fresh => { if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt); plan.install(fresh, context(session, saved)); });
  if (session.tick.length > 0) throw new Error('Restore emitted gameplay effects');
  return Object.assign(session, { host });
}
/** One tick as the trusted adapter runs it (its last `player` command steps the host); only a completed tick commits its effects. */
function step(session: Session, commands: readonly HeadlessCommand[]): HeadlessEffect[] {
  session.tape = commands; session.tick = [];
  try {
    let player: HeadlessCommand | undefined;
    for (const command of commands) if (command.kind === 'player') player = command;
    session.host.step(leadCommands(session.host, player?.kind === 'player' ? { moveX: player.moveX, moveZ: player.moveZ, yaw: player.yaw,
      ...(player.attack === undefined ? {} : { attack: player.attack }), ...(player.hover === undefined ? {} : { hover: player.hover }) } : undefined));
  } finally { session.tape = []; }
  if (![leadPlayer(session.host).position, ...[...session.host.entities.values()].map(entity => entity.position)].every(point => [point.x, point.y, point.z].every(Number.isFinite))) throw new Error('Nonfinite trusted simulation state');
  session.effects.push(...session.tick); return session.tick;
}

interface Encounter { state: string; phase: number; attempts: number }
function encounter(host: SimHost): Encounter {
  const saved = host.adapters.get(ROC_STEP)?.snapshot();
  if (typeof saved !== 'string') throw new Error('Missing Roc continuation');
  const value = JSON.parse(saved) as { boss: Encounter };
  return { state: value.boss.state, phase: value.boss.phase, attempts: value.boss.attempts };
}

/** The parent's ingestion of committed fact effects: each fact under its declared rule's provenance, one cursor per origin. */
class FactIngress {
  readonly dedupe: string[] = [];
  private readonly emitters = new Map<string, LedgerEmitter>();
  private readonly ledger: Ledger;
  private readonly now: () => number;
  constructor(ledger: Ledger, now: () => number) { this.ledger = ledger; this.now = now; }
  ingest(effects: readonly HeadlessEffect[]): LedgerReceipt[] {
    return effects.flatMap(effect => {
      if (effect.kind !== 'fact') return [];
      const rule = requireValue(source.ledger.find(row => row.fact === effect.name), `Undeclared fact ${effect.name}`), key = JSON.stringify(rule.origin);
      let emitter = this.emitters.get(key);
      if (emitter === undefined) { emitter = new LedgerEmitter(this.ledger, identity, rule.origin, this.now, this.dedupe); this.emitters.set(key, emitter); }
      return [emitter.emit(effect.name, effect.actorId)];
    });
  }
}
const coins = (effects: readonly HeadlessEffect[]): number => effects.reduce((sum, effect) => sum + (effect.kind === 'coins' ? effect.amount : 0), 0);
const facts = (effects: readonly HeadlessEffect[]): string[] => effects.flatMap(effect => effect.kind === 'fact' ? [effect.name] : []);
const LIMIT = 60_000, AFTER = 120;
/** The player never leaves the islands: below the lowest deck's 4 m margin the tape has fallen, and the witness fails. */
const FLOOR = DECK - 3 - 4;

/** Spawn to the Roc's fall: run the tape until the Roc is down, then `AFTER` more ticks. */
function play(session: Session, tape: SkyTape, until: (host: SimHost) => boolean = () => false): { victoryTick: number | null } {
  let victoryTick: number | null = null;
  for (let i = 0; i < LIMIT; i++) {
    if (until(session.host)) return { victoryTick };
    step(session, tape.next(session.host));
    if (leadPlayer(session.host).position.y < FLOOR) throw new Error(`The player fell at tick ${String(session.host.state.tick)}: ${JSON.stringify(tape.log.at(-1))}`);
    if (victoryTick === null && session.host.flags.has(FLAGS.roc)) victoryTick = session.host.state.tick;
    if (victoryTick !== null && session.host.state.tick >= victoryTick + AFTER) return { victoryTick };
  }
  throw new Error(`The tape did not finish within ${String(LIMIT)} ticks: ${JSON.stringify(tape.log.at(-1))}`);
}

/** Current gameplay-only quest witness: walk, fight, gust and ride the updraft to raise the bridge. */
export async function questProof(rapier: Rapier): Promise<{ complete: boolean; raised: boolean; ticks: number; updraftTicks: number }> {
  const session = boot(await skyPlan(rapier), rapier), tape = new SkyTape(); let updraftTicks = 0;
  try {
    play(session, tape, host => {
      if (leadPlayer(host).board.on && leadPlayer(host).impulse.y > 0) updraftTicks++;
      return host.flags.has(FLAGS.complete);
    });
    const complete = session.host.flags.has(FLAGS.complete), raised = session.host.flags.has(FLAGS.raised);
    if (!complete || !raised || updraftTicks === 0) throw new Error('Sky quest did not complete through its native movers and updraft');
    return { complete, raised, ticks: session.host.state.tick, updraftTicks };
  } finally { session.host.dispose(); }
}

export async function headlessProof(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), session = boot(plan, rapier), tape = new SkyTape();
  let boardTicks = 0, lifted = 0, peak = -Infinity;
  try {
    // observation only: the ticks ridden, the ticks the updraft's lift ran, the highest the board flew
    const { victoryTick } = play(session, tape, host => {
      if (leadPlayer(host).board.on) { boardTicks++; peak = Math.max(peak, leadPlayer(host).position.y); if (leadPlayer(host).impulse.y > 0) lifted++; }
      return false;
    }), host = session.host, done = encounter(host);
    const quest = host.quests.find(q => q.def.id === source.quests.quests[0]?.id) ?? null;
    if (victoryTick === null || done.state !== 'victory' || !tape.walked || !host.flags.has(FLAGS.complete)) throw new Error(`No gameplay victory: ${JSON.stringify({ done, quest: quest?.isComplete })}`);
    const entries = requireValue(plan.proveEntries, 'Missing entry proof')(host);
    if (entries.lanes < 1 || entries.steps < 1) throw new Error('Empty entry proof');
    return { status: 'passed', ticksExecuted: host.state.tick, hash: digest(host), victoryTick, attempts: done.attempts, questComplete: true,
      facts: facts(session.effects), coins: coins(session.effects), boardTicks, updraftTicks: lifted, boardPeak: Number(peak.toFixed(2)),
      legs: tape.log.map(row => ({ leg: row.kind, tick: row.tick, at: [row.x, row.y, row.z].map(n => Number(n.toFixed(2))) })), entries };
  } finally { session.host.dispose(); }
}

export async function replayProof(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), original = boot(plan, rapier), tape = new SkyTape();
  let restored: Session | undefined, worker: HeadlessSimulation | undefined;
  try {
    // the gale-wall checkpoint: the Roc's second phase, the fight running
    play(original, tape, host => {
      if (!tape.walked || host.state.tick % 30 !== 0) return false;
      const e = encounter(host); return e.state === 'fight' && e.phase === 1;
    });
    const mid = encounter(original.host), hp = original.host.entities.get(ROC_ID)?.hp ?? null, checkpoint = serializeSimSnapshot(snapshotSimHost(original.host)), checkpointTick = original.host.state.tick;
    const before = original.effects.length;
    restored = restore(plan, rapier, checkpoint);
    if (digest(restored.host) !== canonicalSimDigest(checkpoint)) throw new Error('Restore is not exact');
    const commands: HeadlessCommand[][] = [], WORKER = 60;
    let victoryTick: number | null = null, atWorker = '';
    for (let i = 0; i < LIMIT; i++) {
      const tick = tape.next(original.host); commands.push(tick);
      step(original, tick); step(restored, tick);
      if (i + 1 === WORKER) atWorker = digest(restored.host);
      if (victoryTick === null && original.host.flags.has(FLAGS.roc)) victoryTick = original.host.state.tick;
      if (victoryTick !== null && original.host.state.tick >= victoryTick + AFTER) break;
    }
    if (victoryTick === null) throw new Error('The suffix did not reach the Roc\'s fall');
    const hash = digest(original.host), replayHash = digest(restored.host);
    if (hash !== replayHash || JSON.stringify(original.effects.slice(before)) !== JSON.stringify(restored.effects)) throw new Error('Continuation diverged');
    // the shipping worker, started from the same checkpoint, continues to the same state
    worker = await HeadlessSimulation.create(source, assets, checkpoint, { deadline: 'advisory'});
    let commit;
    for (const tick of commands.slice(0, WORKER)) commit = await worker.step([{ source: 'witness.tape', commands: tick }]);
    if (commit === undefined || canonicalSimDigest(commit.snapshot) !== atWorker) throw new Error('The worker continuation diverged from the in-process restore');
    return { status: 'passed', checkpointCaptured: true, checkpointTick, checkpoint: { state: mid.state, phase: mid.phase, hp },
      suffixTicksExecuted: commands.length, victoryTick, hash, replayHash, workerTicks: WORKER, workerExact: true, suffixFacts: facts(restored.effects), suffixCoins: coins(restored.effects) };
  } finally { await worker?.dispose(); restored?.host.dispose(); original.host.dispose(); }
}

export async function ledgerProof(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), session = boot(plan, rapier), tape = new SkyTape(), local = new ProfileStorage(), ledger = profile(local);
  const ingress = new FactIngress(ledger, () => session.host.state.tick);
  let after: Session | undefined;
  try {
    const receipts: LedgerReceipt[] = [];
    for (let i = 0; i < LIMIT; i++) {
      receipts.push(...ingress.ingest(step(session, tape.next(session.host))));
      if (session.host.flags.has(FLAGS.roc) && session.host.flags.has(FLAGS.complete)) break;
    }
    for (let i = 0; i < AFTER; i++) receipts.push(...ingress.ingest(step(session, tape.next(session.host))));
    const durable = ledger.state(), rows = Object.values(durable.facts), achievements = Object.values(durable.achievements);
    if (rows.length !== 2 || receipts.length !== 2 || receipts.some(r => r.status !== 'granted') || achievements.some(a => !a.earned || a.count !== 1)) throw new Error('Gameplay facts did not grant once');
    // a restored session re-emits nothing; the reopened profile holds the same grants and refuses a replayed fact
    after = restore(plan, rapier, serializeSimSnapshot(snapshotSimHost(session.host)));
    for (let i = 0; i < AFTER; i++) step(after, tape.next(after.host));
    const reopened = profile(local), replayed = rows.map(row => reopened.record(row).status);
    if (after.effects.length > 0 || JSON.stringify(reopened.state()) !== JSON.stringify(durable) || replayed.some(status => status !== 'duplicate')) throw new Error('Ledger was not durable and deduplicated');
    return { status: 'passed', rules: source.ledger.length, facts: rows.map(row => ({ name: row.name, origin: `${row.origin.kind}.${row.origin.source}`, tick: row.tick, entity: row.entity })),
      achievements: achievements.map(a => ({ id: a.id, count: a.count, earned: a.earned })), durableReload: true, duplicateStable: true, restoredReemits: 0, gameplayEmissionProven: true };
  } finally { after?.host.dispose(); session.host.dispose(); }
}

// ── The CI slices (DEPLOY.md's headless budget: at most 10k ticks a test) ─────────────────────────────────────────────
// `run.mjs all` plays the whole spawn → victory tape in one run (the authoritative witness, compatibility.json); the
// vitest legs replay it in slices that resume from committed checkpoints of that same tape: spawn → step, step → the
// gale-wall phase (and its replay), the gale-wall phase → the storm phase, and the storm phase → the Roc's fall (the
// ledger). Every slice asserts outcomes only: a checkpoint is data, so x64 CI restores it exactly, but its continuation
// is not compared byte for byte across platforms. A checkpoint carries the hash of the witness's headless inputs, and
// `run.mjs fresh` refuses a stale set; `run.mjs checkpoints` regenerates them.

export type CheckpointName = 'step' | 'gale' | 'storm';
const CHECKPOINT_NAMES: readonly CheckpointName[] = ['step', 'gale', 'storm'];
const CheckpointSchema = v.object({ tick: v.number(), tape: v.object({ leg: v.number(), waypoint: v.number(), ticks: v.number(), hold: v.nullable(v.tuple([v.number(), v.number()])) }), snapshot: v.string() });
const ManifestSchema = v.object({ inputs: v.string(), ticks: v.object({ step: v.number(), gale: v.number(), storm: v.number() }) });
type Checkpoint = v.InferOutput<typeof CheckpointSchema>;
let CHECKPOINTS = new URL('test/proof/far-reach/checkpoints/', ROOT);
const checkpointFile = (name: CheckpointName): URL => new URL(`${name}.snap.gz`, CHECKPOINTS);
let MANIFEST = new URL('manifest.json', CHECKPOINTS);
/** Select the shared generator's verified outputs for native recording and replay. */
export function setCheckpointDirectory(directory: URL): void { CHECKPOINTS = directory; MANIFEST = new URL('manifest.json', directory); }
const readCheckpoint = (name: CheckpointName): Checkpoint => v.parse(CheckpointSchema, JSON.parse(gunzipSync(readFileSync(checkpointFile(name))).toString('utf8')));
/** A slice's own budget: past it the slice failed (the tape is stuck), never a long CI wait. */
const SLICE = 10_000;
/** The Roc's fight in a phase (the gale wall is phase 1, the storm phase 2), checked every 30th tick as the draft did. */
const fighting = (tape: SkyTape, phase: number) => (host: SimHost): boolean => {
  if (!tape.walked || host.state.tick % 30 !== 0) return false;
  const e = encounter(host); return e.state === 'fight' && e.phase === phase;
};
/** Run the tape until `until` holds (checked after each tick), at most `limit` ticks; the ticks it ran. */
function playUntil(session: Session, tape: SkyTape, until: (host: SimHost) => boolean, limit: number): number {
  for (let i = 0; i < limit; i++) {
    if (until(session.host)) return i;
    step(session, tape.next(session.host));
    if (leadPlayer(session.host).position.y < FLOOR) throw new Error(`The player fell at tick ${String(session.host.state.tick)}: ${JSON.stringify(tape.log.at(-1))}`);
  }
  throw new Error(`The slice did not finish within ${String(limit)} ticks: ${JSON.stringify(tape.log.at(-1))}`);
}
/** A session resumed from a committed checkpoint, its restore proven exact (canonical state), and the tape where it was. */
function resume(plan: HeadlessRuntimePlan, rapier: Rapier, name: CheckpointName): { session: Session; tape: SkyTape; checkpoint: Checkpoint } {
  const checkpoint = readCheckpoint(name), session = restore(plan, rapier, checkpoint.snapshot);
  if (digest(session.host) !== canonicalSimDigest(checkpoint.snapshot)) { session.host.dispose(); throw new Error(`The ${name} checkpoint does not restore exactly`); }
  return { session, tape: new SkyTape(checkpoint.tape), checkpoint };
}

/** `run.mjs checkpoints`: play the whole tape once and write its three checkpoints and their inputs hash. */
export async function writeCheckpoints(rapier: Rapier, inputs: string): Promise<object> {
  const plan = await skyPlan(rapier), session = boot(plan, rapier), tape = new SkyTape(), ticks: Partial<Record<CheckpointName, number>> = {};
  const at = { step: (): boolean => tape.atStep, gale: fighting(tape, 1), storm: fighting(tape, 2) };
  try {
    mkdirSync(CHECKPOINTS, { recursive: true });
    for (const name of CHECKPOINT_NAMES) {
      playUntil(session, tape, at[name], LIMIT);
      const state = tape.state, hold = state.hold === null ? null : [state.hold[0], state.hold[1]] satisfies [number, number];
      const checkpoint: Checkpoint = { tick: session.host.state.tick, tape: { ...state, hold }, snapshot: simWireV1(serializeSimSnapshot(snapshotSimHost(session.host))) };
      writeFileSync(checkpointFile(name), gzipSync(JSON.stringify(checkpoint), { level: 9 }));
      ticks[name] = checkpoint.tick;
    }
    const manifest = v.parse(ManifestSchema, { inputs, ticks });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    return { status: 'written', ...manifest };
  } finally { session.host.dispose(); }
}
/** `run.mjs fresh`: the committed checkpoints were written from these headless inputs. */
export function checkpointsFresh(inputs: string): object {
  const manifest = v.parse(ManifestSchema, readWitnessManifest(MANIFEST));
  return { status: manifest.inputs === inputs ? 'fresh' : 'stale', inputs, recorded: manifest.inputs, ticks: manifest.ticks };
}

/** Slice 1, spawn → step and on to the 10,000th tick: the quest's spoken, GUSTed, felled and ridden legs, up the updraft to the step, the winch and the raised bridge. */
export async function stepSlice(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), session = boot(plan, rapier), tape = new SkyTape();
  let boardTicks = 0, lifted = 0, peak = -Infinity;
  try {
    const ticks = playUntil(session, tape, host => {
      if (leadPlayer(host).board.on) { boardTicks++; peak = Math.max(peak, leadPlayer(host).position.y); if (leadPlayer(host).impulse.y > 0) lifted++; }
      return tape.atStep;
    }, SLICE), host = session.host, p = leadPlayer(host).position;
    const onStep = Math.hypot(p.x - STEP.x, p.z - STEP.z) < STEP.r && Math.abs(p.y - STEP.y) < 0.6, stepTick = host.state.tick;
    const flags = { vanes: VANES.every(row => host.flags.has(row.flag)), roost: host.flags.has(FLAGS.roost) };
    if (!onStep || !flags.vanes || !flags.roost) throw new Error(`Not on the step with the vanes turned and the roost quiet: ${JSON.stringify({ at: p.toArray(), flags })}`);
    // on to the platform's 10,000 headless ticks (the slice budget's cap): the winch, its quest fact and the raised bridge
    const more = playUntil(session, tape, () => host.state.tick >= SLICE, SLICE);
    if (!host.flags.has(FLAGS.raised) || !host.flags.has(FLAGS.complete)) throw new Error('The winch did not raise the bridge');
    const entries = requireValue(plan.proveEntries, 'Missing entry proof')(host);
    if (entries.lanes < 1 || entries.steps < 1) throw new Error('Empty entry proof');
    return { status: 'passed', ticksExecuted: ticks + more, stepTick, onStep, flags, raised: true, alive: leadPlayer(host).health.attributes.health > 0, boardTicks, updraftTicks: lifted, boardPeak: Number(peak.toFixed(2)),
      facts: facts(session.effects), legs: tape.log.map(row => row.kind), entries };
  } finally { session.host.dispose(); }
}

/** Slice 2, step → the gale wall: the winch, the raised bridge, the Roc's second phase; its checkpoint restored exactly (canonical state), in process and in the shipping worker. */
export async function replaySlice(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), { session: original, tape, checkpoint: from } = resume(plan, rapier, 'step');
  let restored: Session | undefined, worker: HeadlessSimulation | undefined;
  try {
    const prefixTicks = playUntil(original, tape, fighting(tape, 1), SLICE), prefixFacts = facts(original.effects);
    const mid = encounter(original.host), hp = original.host.entities.get(ROC_ID)?.hp ?? null, checkpoint = serializeSimSnapshot(snapshotSimHost(original.host)), checkpointTick = original.host.state.tick;
    const before = original.effects.length;
    restored = restore(plan, rapier, checkpoint);
    if (digest(restored.host) !== canonicalSimDigest(checkpoint)) throw new Error('Restore is not exact');
    const commands: HeadlessCommand[][] = [], WORKER = 60, SUFFIX = 1500;
    let atWorker = '';
    for (let i = 0; i < SUFFIX; i++) {
      const tick = tape.next(original.host); commands.push(tick);
      step(original, tick); step(restored, tick);
      if (i + 1 === WORKER) atWorker = digest(restored.host);
    }
    const hash = digest(original.host), replayHash = digest(restored.host);
    if (hash !== replayHash || JSON.stringify(original.effects.slice(before)) !== JSON.stringify(restored.effects)) throw new Error('Continuation diverged');
    worker = await HeadlessSimulation.create(source, assets, checkpoint, { deadline: 'advisory'});
    let commit;
    for (const tick of commands.slice(0, WORKER)) commit = await worker.step([{ source: 'witness.tape', commands: tick }]);
    if (commit === undefined || canonicalSimDigest(commit.snapshot) !== atWorker) throw new Error('The worker continuation diverged from the in-process restore');
    return { status: 'passed', resumedFrom: 'step', resumedTick: from.tick, prefixTicks, prefixFacts, checkpointCaptured: true, checkpointTick, checkpoint: { state: mid.state, phase: mid.phase, hp },
      suffixTicksExecuted: SUFFIX, hash, replayHash, workerTicks: WORKER, workerExact: true };
  } finally { await worker?.dispose(); restored?.host.dispose(); original.host.dispose(); }
}

/** Slice 3, the gale wall → the storm: the War Fan carries the Roc through its second phase. */
export async function stormSlice(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), { session, tape, checkpoint } = resume(plan, rapier, 'gale');
  try {
    const hp = (): number => requireValue(session.host.entities.get(ROC_ID), 'missing Roc').hp, start = { encounter: encounter(session.host), hp: hp() };
    const ticks = playUntil(session, tape, fighting(tape, 2), SLICE), end = { encounter: encounter(session.host), hp: hp() };
    if (end.hp >= start.hp || end.encounter.attempts !== start.encounter.attempts || leadPlayer(session.host).health.attributes.health <= 0) throw new Error(`No storm phase by fan play: ${JSON.stringify({ start, end })}`);
    return { status: 'passed', resumedFrom: 'gale', resumedTick: checkpoint.tick, ticksExecuted: ticks, from: { phase: start.encounter.phase, hp: start.hp }, to: { state: end.encounter.state, phase: end.encounter.phase, hp: end.hp }, attempts: end.encounter.attempts };
  } finally { session.host.dispose(); }
}

/** Slice 4, the ledger: the quest's fact past the winch (from the step) and the Roc's at its fall (from the storm), granted once, durably. */
export async function ledgerSlice(rapier: Rapier): Promise<object> {
  const plan = await skyPlan(rapier), local = new ProfileStorage(), ledger = profile(local), receipts: LedgerReceipt[] = [];
  const windows: { from: CheckpointName; ticks: number }[] = [];
  let after: Session | undefined, last: Session | undefined;
  try {
    // the two windows, one ingress each, into one profile (one restore a window: the quest's at the winch, the Roc's in the storm)
    for (const [from, done] of [['step', (host: SimHost) => host.flags.has(FLAGS.complete)], ['storm', (host: SimHost) => host.flags.has(FLAGS.roc)]] as const) {
      const { session, tape } = resume(plan, rapier, from), ingress = new FactIngress(ledger, () => session.host.state.tick);
      last?.host.dispose(); last = session;
      let ticks = 0;
      for (; ticks < SLICE && !done(session.host); ticks++) receipts.push(...ingress.ingest(step(session, tape.next(session.host))));
      if (from === 'storm') for (let i = 0; i < AFTER; i++, ticks++) receipts.push(...ingress.ingest(step(session, tape.next(session.host))));
      if (!done(session.host)) throw new Error(`The ${from} window did not finish within ${String(SLICE)} ticks`);
      windows.push({ from, ticks });
    }
    const durable = ledger.state(), rows = Object.values(durable.facts), achievements = Object.values(durable.achievements);
    if (rows.length !== 2 || receipts.length !== 2 || receipts.some(r => r.status !== 'granted') || achievements.some(a => !a.earned || a.count !== 1)) throw new Error('Gameplay facts did not grant once');
    // a restored session re-emits nothing; the reopened profile holds the same grants and refuses a replayed fact
    const ended = requireValue(last, 'missing storm window'), tail = new SkyTape(); // past its last leg the tape stands still
    const endpoint = { ticksExecuted: ended.host.state.tick, victoryTick: ended.host.state.tick - AFTER, hash: digest(ended.host) };
    after = restore(plan, rapier, serializeSimSnapshot(snapshotSimHost(ended.host)));
    for (let i = 0; i < AFTER; i++) step(after, tail.next(after.host));
    const reopened = profile(local), replayed = rows.map(row => reopened.record(row).status);
    if (after.effects.length > 0 || JSON.stringify(reopened.state()) !== JSON.stringify(durable) || replayed.some(status => status !== 'duplicate')) throw new Error('Ledger was not durable and deduplicated');
    return { status: 'passed', rules: source.ledger.length, windows, endpoint, facts: rows.map(row => ({ name: row.name, origin: `${row.origin.kind}.${row.origin.source}`, entity: row.entity })),
      achievements: achievements.map(a => ({ id: a.id, count: a.count, earned: a.earned })), durableReload: true, duplicateStable: true, restoredReemits: 0, gameplayEmissionProven: true };
  } finally { after?.host.dispose(); last?.host.dispose(); }
}
