import { OBSERVATION_WARMUP_TICKS as WARMUP_TICKS, OBSERVATION_WINDOW_TICKS as WINDOW_TICKS, OBSERVATION_WINDOWS as WINDOWS, type HeadlessObservationReport } from '../../shared/host/headlessObservation';
import type {HeadlessTapePlan,HeadlessTapeReport,HeadlessTapeSegment} from '../../shared/host/headlessTape';
import type { HeadlessJourneyPlan, HeadlessJourneyReport } from '../../shared/host/headlessJourney';
import { outputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';
// oxlint-disable-next-line import/no-nodejs-modules -- Native validation reads the SDK's distributed physics binary.
import { existsSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- P4: an installed engine sits wherever the author's package manager put it.
import { createRequire } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate distributed or workspace physics bytes.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Recheck immutable admitted bytes before copying them into a worker.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Select the SDK's fixed bundled worker entry without Vite asset rewriting.
import { pathToFileURL } from 'node:url';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { offlineMemoryAdmission, prepareAssetDecoders } from '@wildshard/format/product';
import { TickWorkerHost } from './tickWorkerHost';
import { AuthorProofPlanSchema, TickCommandSchema, type HeadlessCommand, type AuthorProofPlan, type AuthorProofReport, type HeadlessCommandSource, type HeadlessTickCommit, type HeadlessTapePartReport } from '../../shared/host/tickProtocol';
import * as v from 'valibot';
import { leadSnapshot, decodeSimSnapshot } from '@wildshard/engine/sim/snapshot';
import { SCRIPT_LIMITS } from '@wildshard/format/scriptLimits';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { headlessSections } from '../../shared/host/headlessSections';

/** A plain-Node authoritative session. Failed ticks quarantine the isolate and retain the previous exact checkpoint. */
export class HeadlessSimulation {
  private readonly runner: TickWorkerHost;
  private constructor(runner: TickWorkerHost) { this.runner = runner; }
  /** Start the fixed worker with runtime deadlines by default. `product` names a built output folder: the worker then runs its native plan, server-class files included. Trusted offline validation selects advisory timing; author data cannot select this policy. */
  static async create(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, snapshot?: string, options: { deadline?: 'runtime' | 'advisory'; sections?: ReadonlyMap<string, unknown>; product?: string } = {}): Promise<HeadlessSimulation> {
    const sections = headlessSections(options.sections ?? outputDescriptor(shard)?.sections);
    const memory = offlineMemoryAdmission('refuse');
    await prepareAssetDecoders();
    validateShardfileAssets(shard, assets, bytes => createHash('sha256').update(bytes).digest('hex'), memory, undefined, scriptAdmissionRows(sections));
    for (const report of memory?.reports() ?? []) console.warn(`Headless memory report-only (G433): ${report.id}: ${report.playingBytes} playing bytes`);
    // A source checkout's root. The CLI bundle is stamped src/sdk (scripts/wildshard.mjs), two levels down; this file moves deeper.
    const checkout = [dirname(createRequire(resolve(import.meta.dirname, 'package.json')).resolve('@wildshard/engine/package.json')), resolve(import.meta.dirname, '../../..'), resolve(import.meta.dirname, '../../../..')].find(root => existsSync(resolve(root, 'scripts/sim-node-loader.mjs')));
    const binary = [resolve(import.meta.dirname, 'client/assets/physics/rapier.wasm'), ...checkout === undefined ? [] : [resolve(checkout, 'src/sharddev/dist/client/assets/physics/rapier.wasm'), resolve(checkout, 'public/assets/physics/rapier.wasm'), createRequire(resolve(checkout, 'package.json')).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')]].find(existsSync);
    if (binary === undefined) throw new Error('SDK physics binary missing; build/pack the SDK before headless validation');
    const admitted = new Map<string, Uint8Array>();
    for (const ref of [...shard.files.map(file => file.hash), ...shard.requires.commons.map(hash => `commons:${hash}`)]) {
      const bytes = assets.get(ref); if (bytes === undefined) throw new Error('Missing admitted worker bytes'); admitted.set(ref, bytes);
    }
    const bundled = resolve(import.meta.dirname, 'headlessWorker.js');
    const distributed = existsSync(bundled);
    if (!distributed && checkout === undefined) throw new Error('SDK headless worker missing; build/pack the SDK or use its complete workspace checkout');
    // Source-checkout workers need their own Node hooks; parent Vitest/Vite transforms never cross the isolate boundary.
    const execArgv = distributed ? [] : ['--experimental-transform-types', '--import', pathToFileURL(resolve(checkout ?? '', 'scripts/sim-node-loader.mjs')).href];
    const runner = new TickWorkerHost(pathToFileURL(distributed ? bundled : resolve(checkout ?? '', 'src/server/host/bake/headlessWorker.ts')), { shard, assets: admitted, binary, sections, ...(snapshot === undefined ? {} : { snapshot }), ...(options.product === undefined ? {} : { product: options.product }) }, shard.serverBudget, execArgv, options.deadline ?? 'runtime');
    try { await runner.initialized(); return new HeadlessSimulation(runner); } catch (error) { await runner.dispose(); throw error; }
  }
  /** Last committed state is detached; callers cannot change the checkpoint used after a refused or unfinished tick. */
  get checkpoint(): HeadlessTickCommit | undefined { return this.runner.checkpoint; }
  /** Quarantined sessions cannot execute again; a trusted caller may start a new worker from the retained checkpoint. */
  get quarantined(): boolean { return this.runner.quarantined; }
  /** Actual timed work, excluding detached checkpoint encoding and IPC. The first touch has a bounded 16.666 ms JIT allowance. */
  get lastTickMicros(): number { return this.runner.lastTickMicros; }
  /** Admit the aggregate command count across all sources, then atomically return state and effects from one bounded tick. */
  step(sources: readonly HeadlessCommandSource[] = []): Promise<HeadlessTickCommit> { return this.runner.step(sources); }
  /** Fixed terminal data-only offline CPU/fuel observation with full initial/final saves. */
  observe(): Promise<HeadlessObservationReport> { return this.runner.observe(); }
  /** Fixed offline observations and the complete entry proof, in one resident. */
  validate(): ReturnType<TickWorkerHost['validate']> { return this.runner.validate(); }
  /** Terminal fixed-tick verb tape; observations do not grant a continuation. */
  verbTape(plan:HeadlessTapePlan):Promise<HeadlessTapeReport>{return this.runner.verbTape(plan);}
  /** One offline tape part and checked commit. All parts share one resident and aggregate allowance; only later parts or finish may follow. */
  verbTapePart(plan:HeadlessTapePlan):Promise<HeadlessTapePartReport>{return this.runner.verbTapePart(plan);}
  /** Terminal native replay with bounded next-segment prefetch and one unchanged 30s request clock. */
  streamVerbTape(observe:readonly string[],source:AsyncIterable<HeadlessTapeSegment>):Promise<HeadlessTapeReport>{return this.runner.streamVerbTape(observe,source);}
  /** Terminal native route proof without per-tick continuation encoding. Trusted offline sessions only. */
  journey(plan:HeadlessJourneyPlan):Promise<HeadlessJourneyReport>{return this.runner.journey(plan);}
  /** Complete one offline physics leg, retaining its full checkpoint and resident for ordered later legs. */
  walkLeg(plan:HeadlessJourneyPlan):Promise<HeadlessJourneyReport>{return this.runner.walkLeg(plan);}
  /** Final validation walks every entry under a separate request deadline. Further ticks refuse; resume from the last committed checkpoint in a fresh worker. */
  finish(): Promise<{ ticks: number; lanes: number; steps: number; liftRides?: number; liftCalls?: number; portalTransfers?: number }> { return this.runner.finish(); }
  /** Terminal author proof; the worker hosts the real grid and ledger from this finite command tape. */
  prove(plan: AuthorProofPlan): Promise<AuthorProofReport> { return this.runner.authorProof(plan); }
  /** Terminate the owned worker and release its complete native world. */
  dispose(): Promise<void> { return this.runner.dispose(); }
}
/** Offline observation: 60 warm-up ticks and three 60-tick windows. CPU uses the least interrupted window p95; raw maxima and all fuel remain visible. Scripts exclude native physics, checkpoints and IPC. */
export interface SimulationObservations {
  timing: { medianMicros: number; p95Micros: number; maxMicros: number; samples: number };
  fuel: { p95: number; max: number; limit: number; samples: number };
  scripts: { p95Micros: number; maxMicros: number; samples: number };
}
function p95(values: readonly number[]): number { return values[Math.floor((values.length - 1) * 0.95)] ?? 0; }
async function observeSteps(sim: Pick<HeadlessSimulation, 'step' | 'lastTickMicros'>): Promise<SimulationObservations> {
  const measured: number[] = [], fuel: number[] = [], scripts: number[] = [], windowP95: number[] = [];
  // Cold JIT belongs to startup. Fuel remains deterministic and every warm-up tick is still budgeted.
  for (let tick = 0; tick < WARMUP_TICKS; tick++) fuel.push((await sim.step()).fuelUsed ?? 0);
  for (let window = 0; window < WINDOWS; window++) {
    const costs: number[] = [];
    for (let tick = 0; tick < WINDOW_TICKS; tick++) {
      const commit = await sim.step(), script = commit.scriptMicros ?? 0;
      measured.push(sim.lastTickMicros); fuel.push(commit.fuelUsed ?? 0); scripts.push(script); costs.push(script);
    }
    costs.sort((a, b) => a - b); windowP95.push(p95(costs));
  }
  return summarizeObservations(measured, fuel, scripts, windowP95);
}
function summarizeObservations(measured: number[], fuel: number[], scripts: number[], windowP95: number[]): SimulationObservations {
  measured.sort((a, b) => a - b); fuel.sort((a, b) => a - b); scripts.sort((a, b) => a - b);
  const middle = measured.length / 2;
  // The least interrupted window estimates hot execution; genuine persistent CPU overages fail all three.
  // Retain raw maxima and all fuel samples, so this does not conceal an expensive tick or relax its fuel cap.
  return { timing: { medianMicros: ((measured[middle - 1] ?? 0) + (measured[middle] ?? 0)) / 2, p95Micros: p95(measured), maxMicros: measured.at(-1) ?? 0, samples: measured.length },
    fuel: { p95: p95(fuel), max: fuel.at(-1) ?? 0, limit: SCRIPT_LIMITS.fuelPerTick, samples: fuel.length },
    scripts: { p95Micros: Math.min(...windowP95), maxMicros: scripts.at(-1) ?? 0, samples: scripts.length } };
}
/** Build warms up, then samples three fixed windows; it never runs the expensive entry walk reserved for validate. */
export async function measureSimulation(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, start?: (shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>) => Promise<Pick<HeadlessSimulation, 'step' | 'lastTickMicros' | 'dispose'>>, sections?: ReadonlyMap<string, unknown>): Promise<SimulationObservations> {
  const supplied = headlessSections(sections ?? outputDescriptor(shard)?.sections);
  if (start !== undefined) {
    const sim = await start(shard, assets);
    try { return await observeSteps(sim); } finally { await sim.dispose(); }
  }
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', sections: supplied });
  try {
    return summarizeReport(await sim.observe());
  } finally { await sim.dispose(); }
}
function summarizeReport(report: HeadlessObservationReport): SimulationObservations {
  const measured = report.samples.slice(WARMUP_TICKS), scripts = measured.map(row => row.scriptMicros), windowP95: number[] = [];
  for (let window = 0; window < WINDOWS; window++) windowP95.push(p95(scripts.slice(window * WINDOW_TICKS, (window + 1) * WINDOW_TICKS).sort((a, b) => a - b)));
  return summarizeObservations(measured.map(row => row.tickMicros), report.samples.map(row => row.fuelUsed), scripts, windowP95);
}
/** Offline admission proves bounded execution and entries; wall timing is advisory. The independent request watchdog still bounds a broken worker. */
export async function validateSimulation(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections?: ReadonlyMap<string, unknown>): Promise<{ ticks: number; lanes: number; steps: number; liftRides?: number; liftCalls?: number; portalTransfers?: number } & SimulationObservations> {
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', ...(sections === undefined ? {} : { sections }) });
  try { const {observation, proof} = await sim.validate(); return {...proof, ...summarizeReport(observation)}; }
  finally { await sim.dispose(); }
}

/** Prove author data in an isolated native worker; trusted runtime bindings and injected facts are refused. */
export async function proveAuthorSimulation(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, input: AuthorProofPlan): Promise<AuthorProofReport> {
  const plan = v.parse(AuthorProofPlanSchema, input);
  if (shard.runtime !== null) throw new Error('Author proof requires data-only gameplay');
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory' });
  try { return await sim.prove(plan); } finally { await sim.dispose(); }
}

/** Minimal browser port: Playwright Page satisfies this without author game or engine imports. */
export interface AuthorProofPage { evaluate: <T>(read: () => T) => Promise<T> }
const sceneEvidenceSchema: v.StrictObjectSchema<{ readonly tick: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 1, undefined>]>; readonly frames: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.IntegerAction<number, undefined>, v.MinValueAction<number, 1, undefined>]>; readonly creatures: v.ArraySchema<v.StrictObjectSchema<{ readonly id: v.StringSchema<undefined>; readonly bound: v.BooleanSchema<undefined>; readonly attached: v.BooleanSchema<undefined>; readonly visible: v.BooleanSchema<undefined>; readonly vertices: v.NumberSchema<undefined>; readonly bones: v.NumberSchema<undefined>; readonly finitePose: v.BooleanSchema<undefined>; readonly matchesNative: v.BooleanSchema<undefined>; }, undefined>, undefined>; readonly selectedInteraction: v.NullableSchema<v.StringSchema<undefined>, undefined>; }, undefined> = v.strictObject({ tick: v.pipe(v.number(), v.integer(), v.minValue(1)), frames: v.pipe(v.number(), v.integer(), v.minValue(1)),
  creatures: v.array(v.strictObject({ id: v.string(), bound: v.boolean(), attached: v.boolean(), visible: v.boolean(), vertices: v.number(), bones: v.number(), finitePose: v.boolean(), matchesNative: v.boolean() })),
  selectedInteraction: v.nullable(v.string()) });
/** Inspect actual client meshes and page prompt selection; declarations and caller-supplied evidence never count. */
export async function proveSceneClient(page: AuthorProofPage, expected: { creatures: readonly string[]; selectedInteraction: string | null }): Promise<v.InferOutput<typeof sceneEvidenceSchema>> {
  const raw = await page.evaluate(() => {
    const probe: unknown = Reflect.get(window, '__wildshard');
    if (typeof probe !== 'object' || probe === null || !('shard' in probe) || typeof probe.shard !== 'object' || probe.shard === null) throw new Error('Missing built author client');
    const data: unknown = Reflect.get(probe.shard, 'shardfile');
    if (typeof data !== 'object' || data === null || !('sceneEvidence' in data) || typeof data.sceneEvidence !== 'function') throw new Error('Enter the built author client before proving its scene');
    const provider = data as { sceneEvidence: () => unknown };
    return provider.sceneEvidence();
  });
  const evidence = v.parse(sceneEvidenceSchema, raw);
  if (new Set(expected.creatures).size !== expected.creatures.length || new Set(evidence.creatures.map(row => row.id)).size !== evidence.creatures.length) throw new Error('Duplicate creature proof identity');
  for (const id of expected.creatures) {
    const view = evidence.creatures.find(row => row.id === id);
    if (view === undefined || !view.bound || !view.attached || !view.visible || !view.finitePose || !view.matchesNative || view.vertices < 3 || view.bones < 1) throw new Error(`Missing real bound creature view: ${id}`);
  }
  if (evidence.selectedInteraction !== expected.selectedInteraction) throw new Error('Actual page prompt selection differs');
  return evidence;
}

/** Mandatory native Mesa Outpost identities: three distinct goats, one hawk and a scene-controlled boolean beacon. */
export interface MesaProofPlan { goats: readonly [string, string, string]; hawk: string; beacon: string; beaconField: string; route: HeadlessCommand[][] }
/** Observations from the SDK-owned native worker; each mandatory gate refuses instead of publishing a partial PASS. */
export interface MesaNativeReport {
  ticks: number; goats: { id: string; fleeing: true; displacement: number; distance: number }[];
  hawk: { id: string; attacking: true; hit: true; minimumAbovePlayer: number; initialHealth: number; minimumHealth: number };
  beacon: { id: string; field: string; lit: true }; replay: { checkpointTick: number; suffixTicks: 30; exact: true };
}
function authorHealth(saved: ReturnType<typeof decodeSimSnapshot>): number {
  const root = leadSnapshot(saved).health;
  if (root.kind !== 'record') throw new Error('Missing native player health');
  const attributes = root.entries.find(([name]) => name === 'attributes')?.[1];
  if (attributes?.kind !== 'record') throw new Error('Missing native health attributes');
  const health = attributes.entries.find(([name]) => name === 'health')?.[1];
  if (health?.kind !== 'value' || typeof health.value !== 'number' || !Number.isFinite(health.value)) throw new Error('Invalid native health observation');
  return health.value;
}
function beaconValue(saved: ReturnType<typeof decodeSimSnapshot>, shard: Shardfile, name: string): number {
  const index = shard.state.shared.findIndex(row => row.name === name && row.type === 'bool');
  const lane = saved.adapters.find(row => row.id === 'script.declared');
  if (index === -1 || typeof lane?.state !== 'string') throw new Error('Beacon requires a declared script-owned boolean');
  const data = v.parse(v.object({ world: v.object({ shared: v.array(v.number()) }) }), JSON.parse(lane.state));
  const value = data.world.shared[index]; if (value !== 0 && value !== 1) throw new Error('Missing native beacon state'); return value;
}
function authorStrikeHit(saved: ReturnType<typeof decodeSimSnapshot>, id: string): boolean {
  const lane = saved.adapters.find(row => row.id === `brain.${id}`);
  if (!Array.isArray(lane?.state) || typeof lane.state[1] !== 'string') throw new Error('Missing native diver continuation');
  const policy = v.parse(v.object({ strikes: v.object({ hit: v.boolean() }) }), JSON.parse(lane.state[1]));
  return policy.strikes.hit;
}
/** Execute every Mesa fauna/beacon gate with real bodies, native strikes and a gated interaction, plus an exact restored suffix.
 * This function owns its worker; no supplied snapshots, observations, facts, host modules or optional gate switches count. */
export async function proveMesaNative(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, plan: MesaProofPlan): Promise<MesaNativeReport> {
  const route = v.parse(v.pipe(v.array(v.pipe(v.array(TickCommandSchema), v.maxLength(1024))), v.maxLength(4096)), plan.route);
  const ids = [...plan.goats, plan.hawk];
  if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => typeof id !== 'string' || id.length === 0)) throw new Error('Mesa requires three distinct goats and one hawk');
  if (shard.runtime !== null || !shard.targets.interactions.some(row => row.id === plan.beacon)) throw new Error('Mesa requires a data-only scene beacon');
  for (const id of ids) {
    const spawn = shard.creatures.spawns.find(row => row.id === id), species = shard.rows.species.find(row => row.id === spawn?.species);
    if (species?.kind !== (id === plan.hawk ? 'hawk' : 'goat')) throw new Error(`Missing required Mesa species: ${id}`);
  }
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory' });
  try {
    const initial = decodeSimSnapshot((await sim.step()).snapshot), initialHealth = authorHealth(initial);
    if (beaconValue(initial, shard, plan.beaconField) !== 0) throw new Error('Beacon starts lit; no interaction proved');
    const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));
    const goats = plan.goats.map(id => {
      const body = initial.entities.find(row => row.id === id); if (body === undefined) throw new Error('Missing native goat');
      return { id, start: body.state.position, fleeing: false };
    });
    const attacks = { attacking: false, hit: false };
    let minimumAbovePlayer = Infinity, minimumHealth = initialHealth, checkpoint = '', checkpointTick = 0;
    const suffix: string[] = []; let last = initial;
    const observeMesa = (snapshot: string): void => {
      last = decodeSimSnapshot(snapshot);
      for (const goat of goats) {
        const body = last.entities.find(row => row.id === goat.id); if (body === undefined) throw new Error('Required native goat disappeared');
        goat.fleeing ||= body.state.state === 'flee' && body.state.motion.desiredSpeed > 3;
      }
      const hawk = last.entities.find(row => row.id === plan.hawk); if (hawk === undefined) throw new Error('Required native hawk disappeared');
      attacks.attacking ||= hawk.state.motion.attackT >= 0;
      attacks.hit ||= authorStrikeHit(last, plan.hawk);
      minimumAbovePlayer = Math.min(minimumAbovePlayer, (hawk.state.position[1] ?? Infinity) - (leadSnapshot(last).position[1] ?? -Infinity));
      minimumHealth = Math.min(minimumHealth, authorHealth(last));
    };
    for (const commands of route) observeMesa((await sim.step([{ source: 'mesa.route', commands }])).snapshot);
    if (beaconValue(last, shard, plan.beaconField) !== 0) throw new Error('Beacon changed before its required interaction');
    const interactionStart = sim.checkpoint?.snapshot;
    if (interactionStart === undefined) throw new Error('Missing native interaction checkpoint');
    const control = await HeadlessSimulation.create(shard, assets, interactionStart, { deadline: 'advisory' });
    try {
      for (let tick = 0; tick <= shard.sim.scriptTickDivisor; tick++) {
        if (beaconValue(decodeSimSnapshot((await control.step()).snapshot), shard, plan.beaconField) !== 0) throw new Error('Beacon lights without its required interaction');
      }
    } finally { await control.dispose(); }
    observeMesa((await sim.step([{ source: 'mesa.beacon', commands: [{ kind: 'interact', id: plan.beacon }] }])).snapshot);
    for (let tick = 0; tick < shard.sim.scriptTickDivisor; tick++) observeMesa((await sim.step()).snapshot);
    if (beaconValue(last, shard, plan.beaconField) !== 1) throw new Error('Real reachable beacon interaction did not light its declared state');
    for (let tick = 0; tick < 600; tick++) {
      const commit = await sim.step(); observeMesa(commit.snapshot);
      if (tick === 299) { checkpoint = commit.snapshot; checkpointTick = commit.tick; }
      if (tick >= 300 && tick < 330) suffix.push(commit.snapshot);
    }
    const flights = goats.map(goat => {
      const body = last.entities.find(row => row.id === goat.id); if (body === undefined) throw new Error('Missing final native goat');
      const displacement = distance(body.state.position, goat.start), away = distance(body.state.position, leadSnapshot(last).position);
      if (!goat.fleeing || displacement <= 10 || away <= 15) throw new Error(`Goat flight not proved: ${goat.id}`);
      return { id: goat.id, fleeing: true as const, displacement, distance: away };
    });
    if (!attacks.attacking || !attacks.hit || minimumAbovePlayer > 1.21 || minimumHealth >= initialHealth) throw new Error(`Hawk dive and landed native attack not proved: ${JSON.stringify({ ...attacks, minimumAbovePlayer, initialHealth, minimumHealth })}`);
    const restored = await HeadlessSimulation.create(shard, assets, checkpoint, { deadline: 'advisory' });
    try { for (const expected of suffix) if ((await restored.step()).snapshot !== expected) throw new Error('Mesa native restored suffix differs'); }
    finally { await restored.dispose(); }
    return { ticks: last.state.tick, goats: flights, hawk: { id: plan.hawk, attacking: true, hit: true, minimumAbovePlayer, initialHealth, minimumHealth },
      beacon: { id: plan.beacon, field: plan.beaconField, lit: true }, replay: { checkpointTick, suffixTicks: 30, exact: true } };
  } finally { await sim.dispose(); }
}

/** Prove the current weapon is mounted and drawing geometry from its admitted immutable asset lease, rather than a placeholder. */
export async function proveEquippedItemClient(page: AuthorProofPage, id: string, asset: string): Promise<{ id: string; asset: string; meshes: number }> {
  const raw = await page.evaluate(() => {
    const probe: unknown = Reflect.get(window, '__wildshard');
    if (typeof probe !== 'object' || probe === null || !('shard' in probe) || typeof probe.shard !== 'object' || probe.shard === null) throw new Error('Missing built author client');
    const data: unknown = Reflect.get(probe.shard, 'shardfile');
    if (typeof data !== 'object' || data === null || !('equipmentEvidence' in data) || typeof data.equipmentEvidence !== 'function') throw new Error('Missing live equipment proof owner');
    return (data as { equipmentEvidence: () => unknown }).equipmentEvidence();
  });
  const evidence = v.parse(v.strictObject({ tick: v.pipe(v.number(), v.minValue(1)), frames: v.pipe(v.number(), v.minValue(1)), id: v.string(), asset: v.nullable(v.string()),
    mounted: v.boolean(), visible: v.boolean(), meshes: v.number(), sameAsset: v.boolean() }), raw);
  if (evidence.id !== id || evidence.asset !== asset || !evidence.mounted || !evidence.visible || !evidence.sameAsset || evidence.meshes < 1) throw new Error('Required asset-backed item is not actually equipped');
  return { id, asset, meshes: evidence.meshes };
}
