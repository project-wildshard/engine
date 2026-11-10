// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../src/shared/engine/core/portableMathFirst';
import {createTrustedHeadlessTape} from '../../src/shared/host/headlessTape';
import { installNativeWalkBounds } from './headless/nativeBounds';
import { installWalkRopeBodies } from './headless/ropeBodies';
import { runHeadlessJourney } from '../../src/shared/host/headlessJourney';
import { fillNativeCombatFrame, headlessAssemblyPorts, validateHeadlessCommandOwners, type HeadlessRuntimeInput, type HeadlessRuntimeInstallation, type HeadlessRuntimePreparation, type HeadlessRuntimePlan, type PrepareHeadlessRuntime, type TrustedHeadlessResident } from '../../src/server/host/headlessRuntime';
import { prepareAssetDecoders } from '@wildshard/format/product';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { prepareProductRuntimePlan } from '../../src/server/game/shardfile/nativePlan';
import { MoverScriptDriver, type MoverRuntime } from '../../src/server/game/plugin/mover';
import { installCableModes } from '../../src/shared/engine/player/modes';
import { createNativeCombatFrame } from '../../src/server/game/plugin/nativeItems';
import { createSimHost, type SimHost , type SimCommand } from '../../src/server/engine/sim';
import { createSimSnapshotSerializer, admitSimSnapshotBytes, decodeSimSnapshotBytes, snapshotSimHostBytes, type SimSnapshot, type SimSnapshotBytes } from '../../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../../src/server/engine/sim/restore';
import { simPlayerCommand, type HeadlessCommand, type HeadlessEffect } from '../../src/shared/host/tickProtocol';
import type { TickWorkerAdapter } from '../../src/server/host/tickWorkerLoop';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The world a product's own native plan builds: what the tick worker runs, for proofs that wrap or drive it. */
export const prepareProductPlan: PrepareHeadlessRuntime = ({ product, assets, rapier }) => prepareProductRuntimePlan(product, assets, headlessAssemblyPorts(rapier));

/** Direct typed proof composition; no module URL, dynamic code lookup or authored factory selection. */
export async function prepareNativeProof(provided: HeadlessRuntimeInput, prepare: PrepareHeadlessRuntime): Promise<HeadlessRuntimePlan> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(provided.shard.identity.slug)) throw new Error('Invalid native product identity');
  await prepareAssetDecoders();
  const product=provided.product ?? await loadHeadlessProduct(`out/${provided.shard.identity.slug}`);
  if(product.slug!==provided.shard.identity.slug || product.revision!==provided.shard.identity.revision) throw new Error('Native product and trusted identity differ');
  const preparation: HeadlessRuntimePreparation={...provided,product};
  const source=product.shardfile,plan=await prepare(preparation);
  const identity = { id: source.identity.slug, seed: source.identity.seed };
  if (plan.level.id !== identity.id || plan.level.seed !== identity.seed) throw new Error('Trusted runtime simulation identity mismatch');
  return { ...plan, install: (host, context) => {
    installCableModes(host.scope, source.modes?.traverse ?? [], host.flags).bindNative(host);
    const carried = source.runtime?.binds?.includes('movers') === true || hasDeclaredClientPage(source)
      ? source.movers.filter(row => row.carry !== undefined) : [];
    if (carried.length > 0) {
      let motion: MoverRuntime | null = null;
      host.onStep('movers.commands', () => {
        if (motion === null) throw new Error('Missing installed mover owner');
        for (const command of context.commands()) if (command.kind === 'script' && carried.some(row => row.id === command.actorId)) {
          if (command.value !== 1 && command.value !== 2) throw new Error('Invalid mover ride command');
          motion.command(command.actorId, command.value);
        }
      });
      motion = new MoverScriptDriver(carried, host).install(host, { content: { identity: source.identity,
        sim: { ...source.sim, bindings: [] }, state: source.state }, assets: new Map(),
        rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } },
      { id: 'movers.carried', restoring: context.restoring, restoreFlags: new Set(host.flags.all), drive: true });
    }
    plan.install(host, context);
  } };
}

/** Keep the native transaction, restore and tick fences in the direct gameplay proof. */
export async function createNativeProofResident(preparation: HeadlessRuntimeInput, prepare: PrepareHeadlessRuntime, snapshot?: string | Readonly<SimSnapshot | SimSnapshotBytes>): Promise<TrustedHeadlessResident> {
  const plan = await prepareNativeProof(preparation, prepare);
  let commands: readonly HeadlessCommand[] = [], effects: HeadlessEffect[] = [];
  const saved = snapshot === undefined ? undefined : typeof snapshot === 'string' ? decodeSimSnapshotBytes(snapshot) : admitSimSnapshotBytes(snapshot);
  const combat = createNativeCombatFrame();
  const context: HeadlessRuntimeInstallation = { combat, restoring: saved !== undefined, ...(saved === undefined ? {} : { snapshot: saved }), commands: () => commands, emit: effect => { effects.push(effect); } };
  const ports = { ...plan.ports, rapier: preparation.rapier };
  let installing: SimHost | undefined;
  let host: SimHost;
  try {
    if (saved === undefined) { installing = createSimHost(plan.level, ports); plan.install(installing, context); host = installing; }
    else host = restoreSimHost(plan.level, ports, saved, fresh => {
      installing = fresh; if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt); plan.install(fresh, context);
    });
    if (effects.length > 0) throw new Error('Trusted runtime emitted gameplay effects during installation');
  } catch (error) { installing?.dispose(); throw error; }
  const lend = (input: readonly HeadlessCommand[]): void => {
    validateHeadlessCommandOwners(host,input);
    fillNativeCombatFrame(combat, input); commands = input; effects = []; };
  return {
    host, lend,
    // A recorder holds no room, and a fact is a room's.
    fact: () => undefined,
    get effects() { return effects; },
    step: input => {
      lend(input);
      let player: SimCommand | undefined;
      for (const command of input) if (command.kind === 'player') player = simPlayerCommand(command);
      host.step(leadCommands(host, player));
      if (![leadPlayer(host).position, ...[...host.entities.values()].map(entity => entity.position)].every(point => [point.x, point.y, point.z].every(Number.isFinite))) throw new Error('Nonfinite trusted simulation state');
    },
    proveEntries: () => {
      if (plan.proveEntries === undefined) throw new Error('Trusted runtime has no entry proof');
      return plan.proveEntries(host);
    },
    dispose: () => { host.dispose(); },
  };
}
/** Worker-side composition only: owns one trusted resident (its real SimHost, native continuation and scoped installers). */
export async function createNativeProofAdapter(preparation: HeadlessRuntimeInput, prepare: PrepareHeadlessRuntime, snapshot?: string): Promise<TickWorkerAdapter> {
  const resident = await createNativeProofResident(preparation, prepare, snapshot), { host } = resident;
  const serializer=createSimSnapshotSerializer();
  const tape=createTrustedHeadlessTape(host,input=>resident.step(input),()=>resident.effects);
  let retireWalkBodies=()=>{/* No temporary walk bodies exist before preparation. */},walkPrepared=false;
  const prepareWalk=():void=>{
    if(walkPrepared)return;
    retireWalkBodies=installWalkRopeBodies(host,preparation.product);installNativeWalkBounds(host);walkPrepared=true;
  };
  return {
    step: input => { resident.step(input); },
    verbTape:plan=>{if(plan.segments.some(segment=>segment.route!==undefined||segment.frames!==undefined))prepareWalk();return tape(plan);},
    journey: plan => { if(plan.start!==undefined)prepareWalk();return runHeadlessJourney(host,input=>resident.step(input),plan); },
    commit: () => ({ tick: host.state.tick, snapshot: serializer.serialize(snapshotSimHostBytes(host)), effects: [...resident.effects] }),
    finish: () => ({ ticks: host.state.tick, lanes: 0, steps: 0 }),
    dispose: () => { try { retireWalkBodies();resident.dispose(); } finally { serializer.dispose(); } },
  };
}
