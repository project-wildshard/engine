import { folderHeadlessSections } from '../../../src/shared/host/headlessSections';
import type { ShardFolder } from '../../../src/shared/game/shardfile/shardFolder';
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the actual shard, tape and committed native checkpoints.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin the admitted product independently of the mutable out alias.
import { pathToFileURL } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Exact input/effect freshness, not a gameplay hash substitute.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep native snapshot artefacts compact.
import { gzipSync, gunzipSync } from 'node:zlib';
import * as v from 'valibot';
import { readWitnessManifest, witnessPayloadHashes } from '../../../scripts/witness-checkpoints.mjs';
import bossRows from '../../../src/shards/driftwood-isle/data/bossEncounter.json' with { type: 'json' };
import { readNativeQuestSpots } from '@wildshard/engine/game/quest/nativeComposition';
import { DRIFTWOOD_SPOTS as nativeQuestSpots } from '../../../src/shards/driftwood-isle/generators/spots';
import policy from '../../../src/shards/driftwood-isle/data/nativeQuest.json' with { type: 'json' };
import { loadRapier, type Rapier } from '../../../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost } from '../../../src/shared/engine/sim/snapshot';
import { SaveStore, type SaveStorage } from '../../../src/shared/engine/saves/store';
import { Ledger, LedgerEmitter, type LedgerReceipt } from '../../../src/shared/game/ledger';
import type { TrustedHeadlessResident } from '../../../src/server/host/headlessRuntime';
import { createNativeProofResident, prepareFolderPlan } from '../../fixtures/headless-native';
import type { TickWorkerHost } from '../../../src/server/host/tickWorkerHost';
import { createNativeProofWorker } from '../../fixtures/headless-worker';
import { TickCommandSchema, TickEffectSchema, type HeadlessCommand, type HeadlessEffect } from '../../../src/shared/host/tickProtocol';
import { canonicalSimDigest, simWireV1 } from '../../fake/simState';
import { simMismatchError } from '../../fake/simMismatch';
import { playDriftwood } from './tape';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { leadSnapshot } from '@wildshard/engine/sim/snapshot';

const { actions: DRIFTWOOD_ACT, actor: DRIFTWOOD_INTERACT, step: QUEST_STEP } = policy;

export const ENTRY = 'data/headlessAssembly.json';
const ROOT = new URL('../../../', import.meta.url);
let folderDirectory: string | undefined;
/** One immutable product for the recorder and every restored/native-worker fork. */
export function witnessFolderDirectory(): string {
  folderDirectory ??= realpathSync(new URL('out/driftwood-isle', ROOT));
  return folderDirectory;
}
let DIR = new URL('checkpoints/', import.meta.url), MANIFEST = new URL('manifest.json', DIR);
/** Select a generator-owned output directory; native recorders and replay readers share this explicit port. */
export function setCheckpointDirectory(directory: URL): void { DIR = directory; MANIFEST = new URL('manifest.json', DIR); }
// The native witness consumes the admitted product's bytes, never authoring
// geometry constructors (which legitimately depend on renderer materials).
const witnessFolder = await loadHeadlessFolder(witnessFolderDirectory());
const source = witnessFolder.shardfile;
const natural = v.pipe(v.number(), v.integer(), v.minValue(0));
const Frame = v.pipe(v.array(TickCommandSchema), v.maxLength(1024));
const Tape = v.pipe(v.array(Frame), v.maxLength(60_000));
const Effect = v.strictObject({ tick: natural, effect: TickEffectSchema });
const Checkpoint = v.strictObject({ name: v.string(), tick: natural, sha: v.string(), digest: v.string(), profile: v.array(v.tuple([v.string(), v.string()])) });
const Manifest = v.strictObject({ inputs: v.string(), tape: v.string(), ticks: natural, effects: v.array(Effect), checkpoints: v.array(Checkpoint), endDigest: v.string() });
type Recorded = v.InferOutput<typeof Manifest>;
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const digest = (session: TrustedHeadlessResident): string => canonicalSimDigest(snapshotSimHost(session.host));
const save = (session: TrustedHeadlessResident): string => simWireV1(serializeSimSnapshot(snapshotSimHost(session.host)));
const identity = { instance: 'driftwood-witness', shard: source.identity.slug, revision: source.identity.revision };

/** Every named result is scoped; the remaining page laws below keep whole-shard admission closed. */
export const OPEN = [
  'Living creature rig volumes are reproduced; rendered ragdoll bodies and their contacts remain outside this witness.',
  'Named target attacks and dialogue actions are bounded input ports; camera crosshair, hitstop and clang are not modeled.',
  'Chest contents, pack restore, the reef swim/dive/treasure/surface continuation and the real spawn-to-lookout/zipline launch, carry and landing are reproduced; completion-card world freeze/resume and every sea-glass path remain outside this witness.',
  'Ecology is bounded at 256 lifetime recipes; ship clock/contact and the page cosmetic/audio/rig work are outside this witness.',
];
export const SCOPE = 'Real Sealed Ring, reef and spawn-to-zipline journeys, earned chest pack, Captain/swim and golden-hour reward carry continuations and emitted ledger facts; not whole-shard compatibility';
export function driftwoodRapier(): Promise<Rapier> { return loadRapier(readFileSync(new URL('public/assets/physics/rapier.wasm', ROOT))); }
function nativeFiles(product: ShardFolder): NonNullable<ReturnType<typeof outputDescriptor>>['index']['files'] {
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing admitted native output');
  const required = new Set(product.shardfile.files.map(file => file.hash));
  return descriptor.index.files.filter(file => file.kind === 'wasm' || required.has(file.commons === true ? `commons:${file.hash}` : file.hash));
}
/** Fingerprint the same pinned native byte closure used by every recorder/fork. */
export function witnessFolderInputFiles(): readonly string[] {
  const root = pathToFileURL(`${witnessFolderDirectory()}/`);
  return ['shard.json', ...nativeFiles(witnessFolder).map(file => file.path)].map(path => new URL(path, root).href);
}
function readNativeAssets(product: ShardFolder): Map<string, Uint8Array> {
  const assets = new Map<string, Uint8Array>(), root = pathToFileURL(`${witnessFolderDirectory()}/`);
  for (const file of nativeFiles(product)) {
    const bytes = Uint8Array.from(readFileSync(new URL(file.path, root)));
    if (bytes.byteLength !== file.compressed || hash(bytes) !== file.hash) throw new Error(`Native witness product blob differs: ${file.path}`);
    assets.set(file.commons === true ? `commons:${file.hash}` : file.hash, bytes);
  }
  return assets;
}
// The pinned immutable product is admitted once per witness process. Every
// resident/fresh worker gets its own byte arrays, never another host's loans.
let checkedNativeAssets: ReadonlyMap<string, Uint8Array> | undefined;
function nativeAssets(): Map<string, Uint8Array> {
  checkedNativeAssets ??= readNativeAssets(witnessFolder);
  return new Map([...checkedNativeAssets].map(([name, bytes]) => [name, bytes.slice()]));
}
function boot(rapier: Rapier, snapshot?: string): Promise<TrustedHeadlessResident> {
  return createNativeProofResident({ shard: witnessFolder.shardfile, assets: nativeAssets(), rapier, product: witnessFolder }, prepareFolderPlan, snapshot);
}
function manifest(): Recorded { return v.parse(Manifest, readWitnessManifest(MANIFEST)); }
function tape(m: Recorded): HeadlessCommand[][] {
  const bytes = readFileSync(new URL('commands.json.gz', DIR));
  if (hash(bytes) !== m.tape) throw new Error('Gameplay tape bytes are stale');
  const frames = v.parse(Tape, JSON.parse(gunzipSync(bytes).toString('utf8')));
  if (frames.length !== m.ticks) throw new Error('Gameplay tape length changed');
  return frames;
}
async function resume(rapier: Rapier, checkpoint: Recorded['checkpoints'][number]): Promise<TrustedHeadlessResident> {
  const bytes = readFileSync(new URL(`${checkpoint.name}.snap.gz`, DIR));
  if (hash(bytes) !== checkpoint.sha) throw new Error(`Checkpoint ${checkpoint.name} bytes changed`);
  const wire = gunzipSync(bytes).toString('utf8');
  if (canonicalSimDigest(wire) !== checkpoint.digest) throw new Error(`Checkpoint ${checkpoint.name} canonical state changed`);
  const session = await boot(rapier, wire);
  if (session.host.state.tick !== checkpoint.tick || digest(session) !== checkpoint.digest || session.effects.length > 0) {
    session.dispose(); throw new Error(`Checkpoint ${checkpoint.name} did not restore exactly`);
  }
  return session;
}
function play(session: TrustedHeadlessResident, frames: readonly HeadlessCommand[][], until: number): { tick: number; effect: HeadlessEffect }[] {
  const from = session.host.state.tick;
  if (until - from > 10_000 || until < from || until > frames.length) throw new Error('Invalid 10k slice');
  const effects: { tick: number; effect: HeadlessEffect }[] = [];
  for (let i = from; i < until; i++) {
    const commands = frames[i]; if (commands === undefined) throw new Error('Missing recorded player tick');
    session.step(commands); effects.push(...session.effects.map(effect => ({ tick: session.host.state.tick, effect })));
    if (leadPlayer(session.host).health.attributes.health <= 0) throw new Error('Player died during recorded play');
  }
  return effects;
}
function expected(m: Recorded, from: number, until: number): Recorded['effects'] { return m.effects.filter(row => row.tick > from && row.tick <= until); }
function sameEffects(actual: Recorded['effects'], expectedEffects: Recorded['effects']): void {
  if (JSON.stringify(actual) !== JSON.stringify(expectedEffects)) throw new Error('Gameplay effects diverged from the recorded run');
}

class ProfileStorage implements SaveStorage {
  readonly data = new Map<string, string>(); refused = false;
  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.refused) throw new Error('Refused durable write'); this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}
function profile(local: ProfileStorage): Ledger { return new Ledger(new SaveStore({ local, session: null }), [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], []); }
/** One cursor per declared provenance; these accept only effects emitted by a completed native tick. */
class FactIngress {
  private readonly emitters = new Map<string, LedgerEmitter>();
  private now = 0;
  private readonly dedupe: string[] = [];
  constructor(private readonly ledger: Ledger) {}
  ingest(tick: number, effects: readonly HeadlessEffect[]): LedgerReceipt[] {
    this.now = tick;
    return effects.flatMap(effect => {
      if (effect.kind !== 'fact') return [];
      const rule = source.ledger.find(mapping => mapping.fact === effect.name);
      if (rule === undefined) throw new Error('Gameplay emitted an undeclared fact');
      const key = JSON.stringify(rule.origin); let emitter = this.emitters.get(key);
      if (emitter === undefined) { emitter = new LedgerEmitter(this.ledger, identity, rule.origin, () => this.now, this.dedupe); this.emitters.set(key, emitter); }
      return [emitter.emit(effect.name, effect.actorId)];
    });
  }
}

/** Fresh continuous spawn-to-reward play; snapshots observe gameplay and never inject a grant, position or actor state. */
export async function recordGameplay(rapier: Rapier, inputs: string): Promise<object> {
  const session = await boot(rapier), local = new ProfileStorage(), ledger = profile(local), ingress = new FactIngress(ledger), frames: HeadlessCommand[][] = [], effects: Recorded['effects'] = [], checkpoints: Recorded['checkpoints'] = [];
  session.host.events.on('player.died', () => { throw new Error('Witness player died'); }, session.host.scope);
  mkdirSync(DIR, { recursive: true });
  let fork: TrustedHeadlessResident | undefined;
  const forkEffects: Recorded['effects'] = [];
  const mark = async (name: string): Promise<void> => {
    if (name !== 'spawn' && name !== 'captain' && name !== 'lookout' && !name.startsWith('tick-')) return;
    const bytes = gzipSync(save(session), { level: 9 }); writeFileSync(new URL(`${name}.snap.gz`, DIR), bytes);
    checkpoints.push({ name, tick: session.host.state.tick, sha: hash(bytes), digest: digest(session), profile: [...local.data] });
    if (name === 'captain') {
      fork = await boot(rapier, gunzipSync(bytes).toString('utf8'));
      const actualDigest = digest(fork), expectedDigest = digest(session);
      if (actualDigest !== expectedDigest) throw simMismatchError('Continuous gameplay initial restore diverged', snapshotSimHost(session.host), snapshotSimHost(fork.host), { expected: expectedDigest, actual: actualDigest });
    }
  };
  try {
    await mark('spawn');
    await playDriftwood(session.host, commands => {
      if (frames.length >= 60_000) throw new Error('Gameplay recording exceeded its bound');
      frames.push(v.parse(Frame, commands)); session.step(commands);
      if (fork !== undefined) { const replay = fork; replay.step(commands); forkEffects.push(...replay.effects.map(effect => ({ tick: replay.host.state.tick, effect }))); }
      effects.push(...session.effects.map(effect => ({ tick: session.host.state.tick, effect })));
      ingress.ingest(session.host.state.tick, session.effects);
      if (!ledger.flush()) throw new Error('Recording profile grant was not durable');
      if (frames.length % 10_000 === 0) { const name = `tick-${String(frames.length)}`, bytes = gzipSync(save(session), { level: 9 }); writeFileSync(new URL(`${name}.snap.gz`, DIR), bytes); checkpoints.push({ name, tick: session.host.state.tick, sha: hash(bytes), digest: digest(session), profile: [...local.data] }); }
    }, mark);
    if (fork === undefined) throw new Error('Continuous gameplay has no mid-fight restore');
    const actualDigest = digest(fork), expectedDigest = digest(session);
    if (actualDigest !== expectedDigest) throw simMismatchError('Continuous gameplay / mid-fight restore diverged', snapshotSimHost(session.host), snapshotSimHost(fork.host), { expected: expectedDigest, actual: actualDigest });
    const cp = checkpoints.find(row => row.name === 'captain');
    if (cp === undefined) throw new Error('No Captain checkpoint');
    sameEffects(forkEffects, effects.filter(row => row.tick > cp.tick));
    const bytes = gzipSync(JSON.stringify(frames), { level: 9 }); writeFileSync(new URL('commands.json.gz', DIR), bytes);
    const recorded = v.parse(Manifest, { inputs, tape: hash(bytes), ticks: frames.length, effects, checkpoints, endDigest: digest(session) });
    writeFileSync(MANIFEST, `${JSON.stringify(recorded, null, 2)}\n`);
    return { status: 'written', ticks: frames.length, checkpoints: checkpoints.map(({ name, tick }) => ({ name, tick })), effects, hash: recorded.endDigest };
  } finally { fork?.dispose(); session.dispose(); }
}
export function checkpointsFresh(inputs: string): { status: string; inputs: string; recorded: string; ticks: number } {
  const m = manifest(), payloads = witnessPayloadHashes(MANIFEST);
  if (payloads === undefined) {
    tape(m);
    for (const cp of m.checkpoints) if (hash(readFileSync(new URL(`${cp.name}.snap.gz`, DIR))) !== cp.sha) throw new Error(`Stale ${cp.name} checkpoint`);
  } else {
    if (payloads['commands.json.gz'] !== m.tape) throw new Error('Stale gameplay tape hash');
    for (const cp of m.checkpoints) if (payloads[`${cp.name}.snap.gz`] !== cp.sha) throw new Error(`Stale ${cp.name} checkpoint hash`);
  }
  return { status: m.inputs === inputs ? 'fresh' : 'stale', inputs, recorded: m.inputs, ticks: m.ticks };
}

/** A separate real spawn-to-reef swim, then the SDK workers dive, take the chest and surface from its earned checkpoint. */
export async function reefProof(rapier: Rapier): Promise<object> {
  const session = await boot(rapier), local = new ProfileStorage(), ledger = profile(local), ingress = new FactIngress(ledger);
  let worker: TickWorkerHost | undefined, fork: TrustedHeadlessResident | undefined, workerTicks = 0;
  const still = { kind: 'player', moveX: 0, moveZ: 0, yaw: 0 } as const;
  const treasure = readNativeQuestSpots(nativeQuestSpots).rows.findIndex(row => row.id === 'reef-treasure'), spot = readNativeQuestSpots(nativeQuestSpots).rows[treasure];
  if (spot === undefined) { session.dispose(); throw new Error('Missing real reef treasure'); }
  let swimTicks = 0;
  const step = (commands: HeadlessCommand[]): void => {
    session.step(commands); if (leadPlayer(session.host).swim.on) swimTicks++;
    if (leadPlayer(session.host).health.attributes.health <= 0) throw new Error('Reef journey player died');
    ingress.ingest(session.host.state.tick, session.effects);
    if (!ledger.flush()) throw new Error('Reef journey ledger write refused');
  };
  const go = (x: number, z: number): void => {
    let best = Infinity, stalled = 0;
    for (let frame = 0; frame < 10_000; frame++) {
      const p = leadPlayer(session.host).position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) return;
      if (d < best - 0.01) { best = d; stalled = 0; } else stalled++;
      if (stalled > 240 || session.host.state.tick > 20_000) throw new Error(`Reef swim stuck at ${JSON.stringify(p.toArray())} toward ${String(x)},${String(z)}`);
      const k = Math.min(1, d / 0.5) / d;
      step([{ ...still, moveX: dx * k, moveZ: dz * k, yaw: Math.atan2(-dx, -dz), ...(stalled > 60 && stalled % 30 === 0 ? { jump: true } : {}) }]);
    }
    throw new Error('Reef journey exceeded its bounded waypoint');
  };
  try {
    // East of the island, outside its rocks and the wreck hull: movement inputs alone, no granted poses or facts.
    // Cross the east approach over its dry asphalt socket, avoiding the solid jetty and its shallow sandbar.
    for (const [x, z] of [[28, -200], [215, -200], [240, -12], [240, 0], [240, 12], [spot.x + 1, spot.z]] as const) go(x, z);
    for (let tick = 0; tick < 90; tick++) step([still]);
    if (!leadPlayer(session.host).swim.on || swimTicks < 1000 || session.host.flags.has('open:reef-treasure')) throw new Error('Reef checkpoint was not earned by swimming');
    const journeyTicks = session.host.state.tick;
    for (let tick = 0; tick < 45; tick++) step([{ ...still, dive: true }]);
    if (!leadPlayer(session.host).swim.diving) throw new Error('Real held DIVE never entered a dive');
    const restoreTick = session.host.state.tick, checkpoint = save(session);
    fork = await boot(rapier, checkpoint);
    const product = witnessFolder;
    worker = await createNativeProofWorker(product.shardfile, nativeAssets(), 'driftwood', checkpoint, folderHeadlessSections(product), witnessFolderDirectory());
    const initial = worker.checkpoint;
    if (digest(fork) !== digest(session) || initial === undefined || canonicalSimDigest(initial.snapshot) !== digest(session)) throw new Error('Mid-dive restore was not exact');
    const wetStep = async (commands: HeadlessCommand[]): Promise<void> => {
      step(commands);
      if (fork !== undefined) {
        fork.step(commands);
        if (!leadPlayer(fork.host).position.equals(leadPlayer(session.host).position) || JSON.stringify(leadPlayer(fork.host).swim) !== JSON.stringify(leadPlayer(session.host).swim)
          || JSON.stringify(fork.effects) !== JSON.stringify(session.effects)) throw new Error('Restored reef gameplay diverged');
      }
      // As with the Captain witness, one 60-tick SDK window covers both held controls and the actual treasure pickup.
      // The complete native original/restored continuation then carries on through surfacing, without IPC snapshots every tick.
      const active = worker;
      if (active !== undefined) {
        const commit = await active.step([{ source: 'witness.reef', commands }]); workerTicks++;
        sameEffects(commit.effects.map(effect => ({ tick: commit.tick, effect })), session.effects.map(effect => ({ tick: commit.tick, effect })));
        if (workerTicks % 30 === 0 && canonicalSimDigest(commit.snapshot) !== digest(session)) throw simMismatchError('Reef worker diverged from real native play', snapshotSimHost(session.host), commit.snapshot);
        if (workerTicks === 60) { await active.dispose(); worker = undefined; }
      }
    };
    for (let tick = 0; tick < 45; tick++) await wetStep([{ ...still, dive: true, surface: false }]);
    await wetStep([{ ...still, dive: false, surface: false }, { kind: 'script', actorId: DRIFTWOOD_INTERACT, value: DRIFTWOOD_ACT.row + treasure }]);
    if (!session.host.flags.has('open:reef-treasure') || !session.host.flags.has('found:reef-treasure')) throw new Error('Real reef dive did not reach the treasure prompt');
    const pack = v.parse(v.object({ pack: v.object({ counts: v.record(v.string(), v.number()) }) }), session.host.adapters.get(QUEST_STEP)?.snapshot()).pack;
    if (pack.counts['doubloon'] !== 8) throw new Error('Reef chest did not enter the actual pack');
    for (let tick = 0; tick < 90; tick++) await wetStep([{ ...still, dive: false, surface: true }]);
    await wetStep([{ ...still, dive: false, surface: false }]);
    const end = save(session);
    if (digest(fork) !== canonicalSimDigest(end)) throw new Error('Reef restore final native physics diverged');
    const swim = leadSnapshot(snapshotSimHost(session.host)).swim;
    if (canonicalSimDigest(end) !== digest(session) || swim?.on !== true || swim.diving || leadPlayer(session.host).position.y < -2) throw new Error('Reef worker did not surface exactly');
    const reloaded = profile(local), earned = Object.values(reloaded.state().achievements).find(row => row.id === 'treasure');
    if (earned?.count !== 1) throw new Error('Gameplay treasure fact was not durable');
    return { status: 'passed', journeyTicks, swimTicks, workerTicks, restoreTick, suffixTicks: session.host.state.tick - restoreTick, workerExact: true, pack: pack.counts,
      surfaced: true, treasureCount: earned.count, durableReload: true, hash: canonicalSimDigest(end) };
  } finally { fork?.dispose(); await worker?.dispose(); session.dispose(); }
}
/** Walk from the actual spawn through the lookout to the native launch, then earn the zipline landing and replay its carry. */
export async function ziplineProof(rapier: Rapier): Promise<object> {
  const cp = manifest().checkpoints.find(row => row.name === 'lookout');
  if (cp === undefined) throw new Error('No real spawn-to-lookout checkpoint');
  const session = await resume(rapier, cp), local = new ProfileStorage();
  for (const [key, value] of cp.profile) local.data.set(key, value);
  const ledger = profile(local), ingress = new FactIngress(ledger);
  const frames: { commands: HeadlessCommand[]; effects: Recorded['effects']; hash: string | null }[] = [];
  let fork: TrustedHeadlessResident | undefined, worker: TickWorkerHost | undefined;
  session.host.events.on('player.died', () => { throw new Error('Zipline journey player died'); }, session.host.scope);
  let checkpoint: string | undefined, launchTick = 0, restoreTick = 0;
  let launch: readonly number[] = [];
  const ride = (resident: TrustedHeadlessResident): unknown => v.parse(v.object({ zipline: v.unknown() }), resident.host.adapters.get(QUEST_STEP)?.snapshot()).zipline;
  try {
    await playDriftwood(session.host, commands => {
      if (session.host.state.tick >= 20000) throw new Error('Zipline journey exceeded its input bound');
      session.step(commands); ingress.ingest(session.host.state.tick, session.effects);
      if (!ledger.flush()) throw new Error('Zipline gameplay ledger write was refused');
      if (fork !== undefined) {
        const replay = fork; replay.step(commands);
        if (!leadPlayer(replay.host).position.equals(leadPlayer(session.host).position) || JSON.stringify(ride(replay)) !== JSON.stringify(ride(session))) throw new Error('Restored zipline carry diverged');
        sameEffects(replay.effects.map(effect => ({ tick: replay.host.state.tick, effect })), session.effects.map(effect => ({ tick: session.host.state.tick, effect })));
        if (frames.length < 60) frames.push({ commands, effects: session.effects.map(effect => ({ tick: session.host.state.tick, effect })),
          hash: (frames.length + 1) % 30 === 0 ? digest(session) : null });
      }
    }, async name => {
      if (name === 'zipline-launch') {
        launchTick = session.host.state.tick; launch = leadPlayer(session.host).position.toArray();
        const point = readNativeQuestSpots(nativeQuestSpots).zipline.prompt;
        if (Math.abs(leadPlayer(session.host).position.y + 1.68 - point.y) > 2.4 || session.host.flags.has('used:zipline')) throw new Error('Real walk did not reach the launch deck');
      } else if (name === 'zipline-mid') {
        restoreTick = session.host.state.tick; checkpoint = save(session); fork = await boot(rapier, checkpoint);
        if (digest(fork) !== digest(session) || session.host.flags.has('used:zipline')) throw new Error('Mid-ride restore or unearned feat diverged');
      }
    }, 'zipline-from-lookout');
    if (checkpoint === undefined || fork === undefined || frames.length !== 60 || !session.host.flags.has('used:zipline') || digest(fork) !== digest(session)) throw new Error('Zipline continuation did not land exactly');
    const earned = Object.values(profile(local).state().achievements).find(row => row.id === 'zipline');
    if (earned?.count !== 1) throw new Error('Real landing did not persist its single zipline fact');
    const product = witnessFolder;
    worker = await createNativeProofWorker(product.shardfile, nativeAssets(), 'driftwood', checkpoint, folderHeadlessSections(product), witnessFolderDirectory());
    if (worker.checkpoint === undefined || canonicalSimDigest(worker.checkpoint.snapshot) !== canonicalSimDigest(checkpoint)) throw new Error('SDK mid-ride restore diverged');
    for (const frame of frames) {
      const commit = await worker.step([{ source: 'witness.zipline', commands: frame.commands }]);
      sameEffects(commit.effects.map(effect => ({ tick: commit.tick, effect })), frame.effects);
      if (frame.hash !== null && canonicalSimDigest(commit.snapshot) !== frame.hash) throw new Error('SDK zipline continuation diverged');
    }
    return { status: 'passed', approachedFromSpawn: true, resumedFrom: 'lookout', prefixTicks: 0, checkpointCaptured: true, launchTick, launch, restoreTick, suffixTicks: session.host.state.tick - restoreTick,
      workerTicks: frames.length, workerExact: true, landed: true, durableReload: true, ziplineCount: earned.count, hash: digest(session), replayHash: digest(fork) };
  } finally { fork?.dispose(); await worker?.dispose(); session.dispose(); }
}
/** Fresh real runtime for exactly 10k ticks, including native navigation, then all 92 flared entry lanes. */
export async function headlessProof(rapier: Rapier): Promise<object> {
  const m = manifest(), frames = tape(m), session = await boot(rapier);
  try {
    const effects = play(session, frames, 10_000); sameEffects(effects, expected(m, 0, 10_000));
    const entries = session.proveEntries();
    if (entries.lanes !== 92 || !session.host.flags.has('shard:lookout')) throw new Error('Missing real lookout / four-entry proof');
    const pack = v.parse(v.object({ pack: v.object({ counts: v.record(v.string(), v.number()), order: v.array(v.string()) }) }), session.host.adapters.get(QUEST_STEP)?.snapshot()).pack;
    // The 10k prefix has opened Wendell's chest; the strongbox comes after the sailor fight, at tick 11,101.
    if (pack.counts['doubloon'] !== 2 || JSON.stringify(pack.order) !== '["doubloon"]') throw new Error('Missing real chest pack');
    return { status: 'passed', ticksExecuted: 10_000, hash: digest(session), entries, pack, facts: effects, nativeActors: session.host.entities.size, alive: true };
  } finally { session.dispose(); }
}
/** Each later gameplay window is bounded to 10k, resuming a committed native continuation once. */
export async function walkSlice(rapier: Rapier, name: string): Promise<object> {
  const m = manifest(), frames = tape(m), cp = m.checkpoints.find(row => row.name === name);
  if (cp === undefined) throw new Error('Unknown gameplay checkpoint');
  const until = Math.min(m.ticks, cp.tick + 10_000), session = await resume(rapier, cp);
  try {
    const effects = play(session, frames, until); sameEffects(effects, expected(m, cp.tick, until));
    if (until === m.ticks && !session.host.flags.has('quest:driftwood-done')) throw new Error('Reward not completed');
    return { status: 'passed', resumedTick: cp.tick, ticksExecuted: until - cp.tick, complete: session.host.flags.has('quest:driftwood-done'), hash: digest(session) };
  } finally { session.dispose(); }
}
/** Resume the real committed living Captain, capture it again, then compare its fight/reward and worker suffix.
 * The separate walk windows cover the prefix; replay spends its budget on the same mid-fight checkpoint only. */
export async function replayProof(rapier: Rapier, workerTicks = 60): Promise<object> {
  if (!Number.isInteger(workerTicks) || workerTicks < 1 || workerTicks > 1000) throw new RangeError('Invalid worker replay window');
  const m = manifest(), frames = tape(m), cp = m.checkpoints.find(row => row.name === 'captain');
  if (cp === undefined) throw new Error('No real Captain checkpoint');
  const original = await resume(rapier, cp); let restored: TrustedHeadlessResident | undefined, worker: TickWorkerHost | undefined;
  try {
    const captain = [...original.host.entities.values()].find(actor => actor.kind === 'captain');
    const encounter = original.host.adapters.get(bossRows.step)?.snapshot();
    if (captain === undefined || !captain.alive || captain.hp >= 200 || typeof encounter !== 'string') throw new Error('Checkpoint is not the living mid-fight Captain');
    const hp = captain.hp, checkpoint = save(original); restored = await boot(rapier, checkpoint);
    if (digest(original) !== digest(restored)) throw new Error('Mid-fight restore not exact');
    const product = witnessFolder;
    worker = await createNativeProofWorker(product.shardfile, nativeAssets(), 'driftwood', checkpoint, folderHeadlessSections(product), witnessFolderDirectory());
    const until = Math.min(m.ticks, cp.tick + 1000), a: Recorded['effects'] = [], b: Recorded['effects'] = [];
    if (until - cp.tick < workerTicks) throw new Error('Captain tape is shorter than the requested worker replay');
    if (until - cp.tick > 10_000) throw new Error('Captain replay exceeded its 10k window');
    for (let i = cp.tick; i < until; i++) {
      const commands = frames[i]; if (commands === undefined) throw new Error('Missing Captain command');
      original.step(commands); restored.step(commands);
      a.push(...original.effects.map(effect => ({ tick: original.host.state.tick, effect })));
      b.push(...restored.effects.map(effect => ({ tick: original.host.state.tick, effect })));
      if (i < cp.tick + workerTicks) {
        const commit = await worker.step([{ source: 'witness.tape', commands }]);
        if (JSON.stringify(commit.effects) !== JSON.stringify(restored.effects)) throw new Error('SDK worker effects diverged');
        if (i === cp.tick + workerTicks - 1) {
          const workerHash = canonicalSimDigest(commit.snapshot), expectedSnapshot = snapshotSimHost(restored.host), expectedHash = canonicalSimDigest(expectedSnapshot);
          if (workerHash !== expectedHash) throw simMismatchError('SDK worker continuation diverged', expectedSnapshot, commit.snapshot, { expected: expectedHash, actual: workerHash });
        }
      }
    }
    const endHash = digest(original), replayHash = digest(restored); sameEffects(a, b); sameEffects(a, expected(m, cp.tick, until));
    if (endHash !== replayHash || !original.host.flags.has('dead:captain') || !original.host.flags.has('quest:driftwood-done')) throw new Error('Captain continuation/reward diverged');
    const reward = v.parse(v.object({ reward: v.object({ elapsed: v.literal(-2), player: v.object({ pitch: v.number(), carried: v.literal(true) }) }) }), original.host.adapters.get(QUEST_STEP)?.snapshot()).reward;
    const target = readNativeQuestSpots(nativeQuestSpots).reward;
    if (!original.host.flags.has('seen:complete') || Math.hypot(leadPlayer(original.host).position.x - target.x, leadPlayer(original.host).position.y - target.y, leadPlayer(original.host).position.z - target.z) !== 0 || leadPlayer(original.host).yaw !== target.yaw || reward.player.pitch !== target.pitch || original.host.dayClock === undefined || original.host.dayClock.phase < target.phase) throw new Error('Native reward carry/pose/clock handoff diverged');
    return { status: 'passed', resumedFrom: cp.name, prefixTicks: 0, checkpointCaptured: true, checkpointTick: cp.tick, hp, encounter: JSON.parse(encounter) as unknown, suffixTicksExecuted: until - cp.tick, hash: endHash, replayHash, effects: a, workerTicks, workerExact: true, victory: true, reward };
  } finally { await worker?.dispose(); restored?.dispose(); original.dispose(); }
}

/** Real tick emissions for one bounded window, with its profile captured from the same continuous gameplay run. */
export async function ledgerProof(rapier: Rapier, name: string): Promise<object> {
  const m = manifest(), frames = tape(m), cp = m.checkpoints.find(row => row.name === name);
  if (cp === undefined) throw new Error('No gameplay ledger window');
  const session = await resume(rapier, cp), local = new ProfileStorage();
  for (const [key, value] of cp.profile) local.data.set(key, value);
  const ledger = profile(local), ingress = new FactIngress(ledger), receipts: LedgerReceipt[] = [];
  const until = Math.min(m.ticks, cp.tick + 10_000);
  try {
    const effects = play(session, frames, until); sameEffects(effects, expected(m, cp.tick, until));
    for (const row of effects) {
      if (row.effect.kind !== 'fact') continue;
      local.refused = receipts.length === 0;
      const emitted = ingress.ingest(row.tick, [row.effect]); receipts.push(...emitted);
      if (receipts.length === 1) {
        if (emitted[0]?.status !== 'pending' || ledger.flush()) throw new Error('Refused gameplay grant was credited durably');
        local.refused = false; if (!ledger.flush()) throw new Error('Gameplay grant retry failed');
      }
    }
    const state = ledger.state(), rows = Object.values(state.facts), reopened = profile(local);
    if (rows.length === 0 || receipts.length === 0 || JSON.stringify(reopened.state()) !== JSON.stringify(state) || rows.some(row => reopened.record(row).status !== 'duplicate')) throw new Error('Gameplay grants were not durable/deduplicated');
    if (until === m.ticks) for (const id of ['castaway', 'shards', 'sailor', 'quest']) {
      if (!Object.values(state.achievements).some(row => row.id === id && row.earned)) throw new Error(`Gameplay did not earn ${id}`);
    }
    return { status: 'passed', resumedTick: cp.tick, ticksExecuted: until - cp.tick, rules: source.ledger.length, facts: rows.map(row => ({ name: row.name, tick: row.tick, entity: row.entity, origin: row.origin })), achievements: Object.values(state.achievements), gameplayEmissionProven: true, refusedWriteRetried: true, durableReload: true, duplicateStable: true };
  } finally { session.dispose(); }
}
