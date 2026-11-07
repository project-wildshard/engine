import {pineTape as createPineTape,kingRow,type PineTape,type TapeState} from './controller';
import { simMismatchError } from '../../fake/simMismatch';
import { installCableModes } from '../../../src/shared/engine/player/modes';
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor';
import { createNativeCombatFrame, type NativeCombatFrame } from '../../../src/server/game/plugin/nativeItems';
import { ItemCatalogue } from '../../../src/shared/game/loadout/itemCatalogue';
// oxlint-disable-next-line import/no-nodejs-modules -- The witness reads Pine's native bakes and the native physics module.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin the admitted output independently of a refreshed out alias.
import { pathToFileURL } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify every admitted native blob before the witness consumes it.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Committed gameplay checkpoints are compressed native save wires.
import { gunzipSync, gzipSync } from 'node:zlib';
import { readWitnessManifest } from '../../../scripts/witness-checkpoints.mjs';
import * as v from 'valibot';
import type { ShardProduct } from '../../../src/shared/game/shardfile/shardProduct';
import { createSimHost, type SimHost } from '../../../src/server/engine/sim';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost, type SimSnapshot } from '../../../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../../../src/server/engine/sim/restore';
import { loadRapier, type Rapier } from '../../../src/shared/engine/physics/rapier';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';
import { fillNativeCombatFrame, headlessAssemblyPorts, type HeadlessRuntimeInstallation, type HeadlessRuntimePlan } from '../../../src/server/host/headlessRuntime';
import type { HeadlessCommand, HeadlessEffect } from '../../../src/shared/host/tickProtocol';
import PINE_TERRAIN from '../../../src/shards/pine-hollow/data/terrainBindings.json' with { type: 'json' };
import { prepareProductRuntimePlan } from '../../../src/server/game/shardfile/nativePlan';
import { QUEST_STEP } from '../../../src/shards/pine-hollow/generators/questPrompts';
import { nativeInventorySchema } from '../../../src/shared/game/inventoryLaw';
import wardens from '../../../src/shards/pine-hollow/data/wardensHollow.json' with { type: 'json' };
import bossRows from '../../../src/shards/pine-hollow/data/bossEncounter.json' with { type: 'json' };
import { canonicalSimDigest, simWireV1 } from '../../fake/simState';
import { SaveStore, type SaveStorage } from '../../../src/shared/engine/saves/store';
import { Ledger, LedgerEmitter, type LedgerReceipt } from '../../../src/shared/game/ledger';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';


/**
 * Pine Hollow's whole-shard witness (E435 §C / SF72), on its trusted renderer-free entry, the product's `server/native-assembly.json`, composed as
 * the platform's trusted adapter composes it (the plan's level and ports, one install, the tick's commands lent to the
 * runtime, its effects buffered per tick). The player's tape is tick commands only (`player` moves and `script` prompt
 * presses, `pine.interact`), chosen each tick from where the player stands: from the spawn on the south road to Hale on
 * the cabin's porch, the beaver dam's two logs and its glass, the pond's lantern, up the lookout's five flights to the
 * fire finder's flint, down to the ridge lantern, up again to the launch, the zipline to the Hollow and on to the den's
 * lantern. Nothing writes health, flags or positions: every outcome is gameplay. The night (the stag's walk, the Antler
 * King and dawn) are walked on the same tape, with the remaining systems listed in OPEN.
 */
export const ENTRY = 'server/native-assembly.json';
const ROOT = new URL('../../../', import.meta.url);
let productDirectory: string | undefined;
/** One pinned actual product for record, restored sessions and replay. */
export function witnessProductDirectory(): string {
  productDirectory ??= realpathSync(new URL('out/pine-hollow', ROOT));
  return productDirectory;
}
const witnessProduct = await loadHeadlessProduct(witnessProductDirectory());
const source = witnessProduct.shardfile;
const assets = new Map([PINE_TERRAIN.terrain, PINE_TERRAIN.navmesh].map(path => [path, new Uint8Array(readFileSync(new URL(path, ROOT)))] as const));

/** One authoritative session: the host, the tick's lent commands and its committed effects. */
interface Session { combat: NativeCombatFrame; host: SimHost; tape: readonly HeadlessCommand[]; effects: HeadlessEffect[]; tick: HeadlessEffect[] }
const requireValue = <T>(value: T | undefined | null, message: string): T => { if (value === undefined || value === null) throw new Error(message); return value; };
/** A continuation's hash: the snapshot in canonical form (test/fake/simState.ts). */
const digest = (host: SimHost): string => canonicalSimDigest(snapshotSimHost(host));

export function pineRapier(): Promise<Rapier> { return loadRapier(readFileSync(new URL('public/assets/physics/rapier.wasm', ROOT))); }
function nativeFiles(product: ShardProduct): NonNullable<ReturnType<typeof outputDescriptor>>['index']['files'] {
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing admitted native output');
  const required = new Set(product.shardfile.files.map(file => file.hash));
  return descriptor.index.files.filter(file => file.kind === 'wasm' || required.has(file.commons === true ? `commons:${file.hash}` : file.hash));
}
/** Fingerprint the same native header and byte closure the recorder/replay use. */
export function witnessProductInputFiles(): readonly string[] {
  const root = pathToFileURL(`${witnessProductDirectory()}/`);
  return ['shard.json', ...nativeFiles(witnessProduct).map(file => file.path)].map(path => new URL(path, root).href);
}
function nativeAssets(product: ShardProduct): Map<string, Uint8Array> {
  const result = new Map(assets), root = pathToFileURL(`${witnessProductDirectory()}/`);
  for (const file of nativeFiles(product)) {
    const bytes = Uint8Array.from(readFileSync(new URL(file.path, root)));
    if (bytes.byteLength !== file.compressed || createHash('sha256').update(bytes).digest('hex') !== file.hash) throw new Error(`Native witness product blob differs: ${file.path}`);
    result.set(file.commons === true ? `commons:${file.hash}` : file.hash, bytes);
  }
  return result;
}
export async function pinePlan(rapier: Rapier): Promise<HeadlessRuntimePlan> {
  const product = await loadHeadlessProduct(witnessProductDirectory());
  const plan: HeadlessRuntimePlan = await prepareProductRuntimePlan(product, nativeAssets(product), headlessAssemblyPorts(rapier));
  return { ...plan, install: (host, installation) => {
    installCableModes(host.scope, product.shardfile.modes?.traverse ?? [], host.flags).bindNative(host);
    plan.install(host, installation);
  } };
}

function context(session: Omit<Session, 'host'>, saved?: SimSnapshot): HeadlessRuntimeInstallation {
  return { combat: session.combat, restoring: saved !== undefined, ...(saved === undefined ? {} : { snapshot: saved }), commands: () => session.tape, emit: effect => { session.tick.push(effect); } };
}
function boot(plan: HeadlessRuntimePlan, rapier: Rapier): Session {
  const session = { combat: createNativeCombatFrame(), tape: [] as readonly HeadlessCommand[], effects: [] as HeadlessEffect[], tick: [] as HeadlessEffect[] };
  const host = createSimHost(plan.level, { ...plan.ports, rapier });
  plan.install(host, context(session));
  if (session.tick.length > 0) throw new Error('Installation emitted gameplay effects');
  return Object.assign(session, { host });
}
/** A session restored from a snapshot wire (the replay leg). */
export function restore(plan: HeadlessRuntimePlan, rapier: Rapier, saved: SimSnapshot): Session {
  const session = { combat: createNativeCombatFrame(), tape: [] as readonly HeadlessCommand[], effects: [] as HeadlessEffect[], tick: [] as HeadlessEffect[] }, ports = { ...plan.ports, rapier };
  const host = restoreSimHost(plan.level, ports, saved, fresh => { if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt); plan.install(fresh, context(session, saved)); });
  if (session.tick.length > 0) throw new Error('Restore emitted gameplay effects');
  return Object.assign(session, { host });
}
/** One tick as the trusted adapter runs it (its last `player` command steps the host); only a completed tick commits its effects. */
function step(session: Session, commands: readonly HeadlessCommand[]): HeadlessEffect[] {
  fillNativeCombatFrame(session.combat, commands); session.tape = commands; session.tick = [];
  try {
    let player: HeadlessCommand | undefined;
    for (const command of commands) if (command.kind === 'player') player = command;
    session.host.step(leadCommands(session.host, player?.kind === 'player' ? { moveX: player.moveX, moveZ: player.moveZ, yaw: player.yaw, ...(player.attack === undefined ? {} : { attack: player.attack }),
      ...(player.hover === undefined ? {} : { hover: player.hover }), ...(player.jump === undefined ? {} : { jump: player.jump }), ...(player.dodge === undefined ? {} : { dodge: player.dodge }) } : undefined));
  } finally { session.tape = []; }
  if (![leadPlayer(session.host).position, ...[...session.host.entities.values()].map(entity => entity.position)].every(point => [point.x, point.y, point.z].every(Number.isFinite))) throw new Error('Nonfinite trusted simulation state');
  session.effects.push(...session.tick); return session.tick;
}

/** The legacy proof keeps its native asset owner; the controller reads only
 * the supplied navmesh and current plan, without loading a second product. */
export function pineTape(plan:HeadlessRuntimePlan,from?:TapeState):PineTape {
  return createPineTape(plan,requireValue(assets.get(PINE_TERRAIN.navmesh),'navmesh'),from);
}

const facts = (effects: readonly HeadlessEffect[]): string[] => effects.flatMap(effect => effect.kind === 'fact' ? [`${effect.name}/${effect.actorId}`] : []);

/** Bound a failed fight separately from the whole walk. The current tape wins in 1,919 fight ticks. */
const KING_PROBE = 5000;
/**
 * The tape from the spawn: the day's legs to the den's lantern, Hale's watch till dark, the Ghost Stag's walk into the
 * stones, the Antler King's fight by weapon play, and dawn. `KING_PROBE` bounds a failed fight. `at-king`: the tape reached his fight and the player stands; `walked`: every leg,
 * the dawn included.
 */
export async function tapeProof(rapier: Rapier, limit = 60_000): Promise<object> {
  const plan = await pinePlan(rapier), session = boot(plan, rapier), tape = pineTape(plan);
  try {
    let fought = 0;
    for (let i = 0; i < limit && !tape.walked && fought < KING_PROBE; i++) {
      step(session, tape.next(session.host));
      if (tape.current === 'king' && kingRow(session.host).boss.state === 'fight') fought++;
    }
    const host = session.host, quest = host.quests.find(q => q.def.id === 'wardens-hollow'), row = kingRow(host);
    const body = row.fight.king === null ? undefined : host.entities.get(row.fight.king);
    const alive = leadPlayer(host).health.attributes.health > 0, status = tape.walked ? 'walked' : fought >= KING_PROBE && alive ? 'at-king' : 'failed';
    return { status, at: leadPlayer(host).position.toArray().map(n => Number(n.toFixed(2))), tape: tape.state, ticksExecuted: host.state.tick, step: quest?.current?.id ?? null, hash: digest(host),
      king: { state: row.boss.state, phase: row.boss.phase, attempts: row.boss.attempts, hp: body?.hp ?? null, maxHp: body?.maxHp ?? null, foughtTicks: fought },
      facts: facts(session.effects), legs: tape.log.map(entry => ({ leg: entry.kind, tick: entry.tick, at: [entry.x, entry.y, entry.z].map(n => Number(n.toFixed(2))) })) };
  } finally { session.host.dispose(); }
}


// ── Committed gameplay checkpoints and bounded CI continuations ──
export const CHECKPOINT_NAMES = ['dam', 'ridge', 'night', 'king', 'fallen'] as const;
export type CheckpointName = typeof CHECKPOINT_NAMES[number];
let CHECKPOINTS = new URL('test/proof/pine-hollow/checkpoints/', ROOT);
let MANIFEST = new URL('manifest.json', CHECKPOINTS);
const CheckpointSchema = v.strictObject({ tick: v.number(), tape: v.strictObject({ leg: v.number(), waypoint: v.number(), ticks: v.number(), best: v.number(), stall: v.number() }), snapshot: v.string() });
const ManifestSchema = v.strictObject({ inputs: v.string(), ticks: v.record(v.string(), v.number()), hashes: v.record(v.string(), v.string()) });
const checkpointFile = (name: CheckpointName): URL => new URL(`${name}.snap.gz`, CHECKPOINTS);
let BASIS = new URL('basis.snap.gz', CHECKPOINTS);
/** Select the shared generator's verified outputs for native recording and replay. */
export function setCheckpointDirectory(directory: URL): void { CHECKPOINTS = directory; MANIFEST = new URL('manifest.json', directory); BASIS = new URL('basis.snap.gz', directory); }
const readCheckpoint = (name: CheckpointName): { tick: number; tape: TapeState; snapshot: SimSnapshot } => {
  const row = v.parse(CheckpointSchema, JSON.parse(gunzipSync(readFileSync(checkpointFile(name))).toString('utf8')));
  return { ...row, snapshot: decodeSimSnapshot(row.snapshot, gunzipSync(readFileSync(BASIS))) };
};
const SLICE = 10_000;
const atCheckpoint = (name: CheckpointName, host: SimHost): boolean => {
  switch (name) {
    case 'dam': return host.state.tick >= 8000;
    case 'ridge': return host.state.tick >= 16000;
    case 'night': return host.state.tick >= 24000;
    case 'king': { const row = kingRow(host); return row.boss.state === 'fight' && row.boss.phase === 1; }
    case 'fallen': return host.flags.has(bossRows.record.defeated);
    default: throw new Error('Unknown checkpoint');
  }
};
function playUntil(session: Session, tape: PineTape, until: (host: SimHost) => boolean, limit: number): number {
  for (let i = 0; i < limit; i++) {
    if (until(session.host)) return i;
    step(session, tape.next(session.host));
    if (leadPlayer(session.host).health.attributes.health <= 0) throw new Error(`The witness player died at ${String(session.host.state.tick)}`);
  }
  throw new Error(`Pine tape exceeded ${String(limit)} ticks at ${JSON.stringify(tape.state)}`);
}
function resume(plan: HeadlessRuntimePlan, rapier: Rapier, name: CheckpointName): { session: Session; tape: PineTape; tick: number; snapshot: SimSnapshot } {
  const checkpoint = readCheckpoint(name), session = restore(plan, rapier, checkpoint.snapshot);
  if (digest(session.host) !== canonicalSimDigest(checkpoint.snapshot)) {
    const error = simMismatchError(`Inexact ${name} restore`, checkpoint.snapshot, snapshotSimHost(session.host));
    session.host.dispose(); throw error;
  }
  return { session, tape: pineTape(plan, checkpoint.tape), tick: checkpoint.tick, snapshot: checkpoint.snapshot };
}
/** Bake outputs of one uninterrupted gameplay tape, with the exact loaded-module and native-asset inputs hash. */
export async function writeCheckpoints(rapier: Rapier, inputs: string): Promise<object> {
  const plan = await pinePlan(rapier), session = boot(plan, rapier), tape = pineTape(plan), ticks: Record<string, number> = {}, hashes: Record<string, string> = {};
  try {
    mkdirSync(CHECKPOINTS, { recursive: true });
    const basis = session.host.physics.snapshot();
    writeFileSync(BASIS, gzipSync(basis, { level: 9 }));
    for (const name of CHECKPOINT_NAMES) {
      playUntil(session, tape, host => atCheckpoint(name, host), 60_000);
      const state = snapshotSimHost(session.host);
      const checkpoint = { tick: session.host.state.tick, tape: tape.state, snapshot: simWireV1(serializeSimSnapshot(state, basis)) };
      hashes[name] = canonicalSimDigest(state);
      writeFileSync(checkpointFile(name), gzipSync(JSON.stringify(checkpoint), { level: 9 })); ticks[name] = checkpoint.tick;
    }
    playUntil(session, tape, host => host.flags.has(wardens.QUEST_DONE), SLICE);
    hashes['dawn'] = digest(session.host);
    writeFileSync(MANIFEST, `${JSON.stringify({ inputs, ticks, hashes }, null, 2)}\n`);
    return { status: 'written', inputs, ticks, hashes };
  } finally { session.host.dispose(); }
}
export function checkpointsFresh(inputs: string): object {
  const manifest = v.parse(ManifestSchema, readWitnessManifest(MANIFEST));
  if (Object.keys(manifest.ticks).join(',') !== CHECKPOINT_NAMES.join(',')) throw new Error('Incomplete Pine checkpoint set');
  if (Object.keys(manifest.hashes).join(',') !== [...CHECKPOINT_NAMES, 'dawn'].join(',')) throw new Error('Incomplete Pine canonical digests');
  return { status: manifest.inputs === inputs ? 'fresh' : 'stale', inputs, recorded: manifest.inputs, ticks: manifest.ticks };
}
/** One <=10k-tick leg of the same gameplay tape; no test fixture moves or damages a body. */
export async function walkSlice(rapier: Rapier, to: CheckpointName | 'dawn'): Promise<object> {
  const plan = await pinePlan(rapier), i = CHECKPOINT_NAMES.indexOf(to === 'dawn' ? 'fallen' : to);
  const from = to === 'dawn' ? 'fallen' : i > 0 ? CHECKPOINT_NAMES[i - 1] : undefined;
  const start = from === undefined ? { session: boot(plan, rapier), tape: pineTape(plan), tick: 0 } : resume(plan, rapier, from);
  try {
    const ticks = playUntil(start.session, start.tape, host => to === 'dawn' ? host.flags.has(wardens.QUEST_DONE) : atCheckpoint(to, host), SLICE);
    const host = start.session.host, hash = digest(host);
    const manifest = v.parse(ManifestSchema, readWitnessManifest(MANIFEST));
    if (hash !== manifest.hashes[to]) throw new Error(`Inexact ${to} gameplay continuation`);
    return { status: 'passed', resumedFrom: from ?? 'spawn', resumedTick: start.tick, ticksExecuted: ticks, to, tick: host.state.tick,
      alive: leadPlayer(host).health.attributes.health > 0, flags: host.flags.all, facts: facts(start.session.effects), king: kingRow(host).boss, hash };
  } finally { start.session.host.dispose(); }
}
/** Exact continuation of the King's phase-II checkpoint, with the identical player commands in both worlds. */
export async function replayProof(rapier: Rapier): Promise<object> {
  const plan = await pinePlan(rapier), original = resume(plan, rapier, 'king');
  let replay: Session | undefined;
  try {
    const saved = original.snapshot, before = digest(original.session.host);
    replay = restore(plan, rapier, saved);
    if (digest(replay.host) !== before) throw new Error('King checkpoint changed on restore');
    const SUFFIX = 1200;
    for (let i = 0; i < SUFFIX; i++) { const commands = original.tape.next(original.session.host); step(original.session, commands); step(replay, commands); }
    const hash = digest(original.session.host), replayHash = digest(replay.host);
    if (hash !== replayHash || JSON.stringify(original.session.effects) !== JSON.stringify(replay.effects)) throw new Error('King replay diverged');
    return { status: 'passed', checkpointCaptured: true, checkpointTick: original.tick, suffixTicksExecuted: SUFFIX, hash, replayHash,
      checkpoint: { state: 'fight', phase: 1 }, facts: facts(replay.effects), restoredReemits: 0 };
  } finally { replay?.host.dispose(); original.session.host.dispose(); }
}

const identity = { instance: 'pine-hollow-witness', shard: source.identity.slug, revision: source.identity.revision };
class ProfileStorage implements SaveStorage {
  private readonly data = new Map<string, string>();
  refuse = false;
  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.refuse) throw new Error('Witness quota refusal'); this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}
const profile = (local: ProfileStorage): Ledger => new Ledger(new SaveStore({ local, session: null }), [{ id: identity.instance, shard: identity.shard }], [{ shard: identity.shard, revision: identity.revision, rules: source.ledger }], []);
/** Ingest only effects committed by gameplay, under the declared origin and the gameplay tick. */
class FactIngress {
  private readonly emitters = new Map<string, LedgerEmitter>();
  private readonly dedupe: string[] = [];
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
/** Entire tape once, including actual fact ingress, quota refusal/retry and a reopened durable profile. */
async function collectGameplayProof(rapier: Rapier, from?: 'night') {
  const plan = await pinePlan(rapier), start = from === undefined ? { session: boot(plan, rapier), tape: pineTape(plan), tick: 0 } : resume(plan, rapier, from);
  const { session, tape } = start, local = new ProfileStorage(), ledger = profile(local);
  const ingress = new FactIngress(ledger, () => session.host.state.tick), receipts: LedgerReceipt[] = [];
  let refused = false;
  try {
    for (let i = 0; i < (from === undefined ? 60_000 : SLICE) && !tape.walked; i++) {
      const effects = step(session, tape.next(session.host));
      if (!refused && effects.some(effect => effect.kind === 'fact')) {
        local.refuse = true; receipts.push(...ingress.ingest(effects));
        if (ledger.flush() || Object.keys(profile(local).state().facts).length > 0) throw new Error('Refused fact became durable');
        local.refuse = false; if (!ledger.flush()) throw new Error('Fact retry failed'); refused = true;
      } else receipts.push(...ingress.ingest(effects));
      if (leadPlayer(session.host).health.attributes.health <= 0) throw new Error('Player died');
    }
    if (!tape.walked || !session.host.flags.has(wardens.QUEST_DONE) || !session.host.flags.has(bossRows.record.defeated)) throw new Error('King/dawn tape unfinished');
    const durable = ledger.state(), rows = Object.values(durable.facts), reopened = profile(local);
    if (JSON.stringify(reopened.state()) !== JSON.stringify(durable) || rows.some(row => reopened.record(row).status !== 'duplicate')) throw new Error('Gameplay ledger not durable/deduplicated');
    const pack = v.parse(v.object({ pack: nativeInventorySchema(new ItemCatalogue(source.items).inventory) }), session.host.adapters.get(QUEST_STEP)?.snapshot()).pack;
    return { status: 'passed', resumedFrom: from ?? 'spawn', ticksExecuted: session.host.state.tick - start.tick, tick: session.host.state.tick, alive: true, kingDefeated: true, dawn: session.host.flags.has('seen:dawn'),
      hash: digest(session.host), pack, resinCount: session.host.flags.count('resin:'), facts: rows.map(row => ({ name: row.name, entity: row.entity, tick: row.tick, origin: row.origin })),
      achievements: Object.values(durable.achievements), rules: source.ledger.length, gameplayEmissionProven: true, refusedWriteRetried: refused,
      durableReload: true, duplicateStable: true, receipts: receipts.map(row => row.status), legs: tape.log };
  } finally { session.host.dispose(); }
}

/** Run gameplay once; its ledger receipt comes from those same committed effects. */
export function gameplayProof(rapier: Rapier, from?: 'night'): ReturnType<typeof collectGameplayProof> {
  return collectGameplayProof(rapier, from);
}

/** These omissions can change damage, inventory, quest/ledger outcomes or persistence relative to the browser. */
export const OUTCOME_DIFFERENCES = [
  'Native projectile gusts, rainy bolt flight, moving spread, longbow recovery and special-ammunition stacks/launch kinds are hosted; variable page-frame clocks and aimed/mounted input remain unproved. Stopped crossbow bolts are visual-only on the page.',
  'All three NPC readings, completion flags, Brandt\'s once-only thanks, lodge rewards/streak and Mott\'s pack/ammunition/finish trades are hosted; named prompt commands still omit nearest/line-of-sight selection.',
  'Resin walk-in takes, the eight carved tokens, lookout bench and seven-kind pack are hosted; hollow-log/islet secrets and journal discovery remain unhosted, so their ledger outcomes are absent.',
  'Night-roaming thralls and the millrace combat/errand completion are hosted on the shared population law; page Math.random placement and variable-frame scheduling are not matched native inputs. Mill wheel/hinged-door access remains absent.',
  'King victories pay three resin through the real pack; the first bow waits at the shared settled orb until in-range visible USE. Cross-prompt nearest selection and browser boss-save interoperability remain unproved.',
  'Rain shelter goals use captured page crown cover and restored native continuation; variable page-frame weather/brain scheduling is not yet matched.',
  'The page King record uses pine.bosses instead of host flags; browser-save interoperability for refights is not proved.',
];
/** Missing recorded paths alone do not establish a difference in the already-hosted rule. */
export const COVERAGE_GAPS = [
  'Alternate routes, other elite encounters and repeat fights lack their own uninterrupted recorded tapes.',
  'Mott swaps and special-ammunition cycling/flight have native rule and restore fixtures, but no dedicated uninterrupted quest tape.',
  'The recorded tape is standalone; grid entry walls are removed in a separate native entry proof, not a recorded grid quest tape.',
];
export const OPEN = [...OUTCOME_DIFFERENCES, ...COVERAGE_GAPS];
