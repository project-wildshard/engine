// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
import {createTrustedHeadlessTape} from '../../../shared/host/headlessTape';
import { runHeadlessJourney } from '../../../shared/host/headlessJourney';
import { proveShardfileEntries } from '@wildshard/engine/game/bake/entryways';
import { openWorldAdapter } from '../openWorld';
import { createTrustedHeadlessAdapter } from '../headlessRuntime';
import { diagnosticNow } from '@wildshard/engine/core/clock';
// oxlint-disable-next-line import/no-nodejs-modules -- Only the platform-selected physics binary is read inside the isolated worker.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Recheck admitted bytes inside the isolate, as the host does.
import { createHash } from 'node:crypto';
import * as v from 'valibot';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { proveAuthoredGrid, createShardfileSim, bindShardfileSim, type ShardfileSimulation } from '@wildshard/engine/game/plugin/simulation';
import { createSimSnapshotSerializer, snapshotSimHostBytes, decodeSimSnapshot, checkSimSnapshotWire } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';

import type { SimCommand } from '@wildshard/engine/sim';
import { parseShardfile } from '@wildshard/format/shardSchema';
import { runTickWorker } from '../tickWorkerLoop';
import { simPlayerCommand, MAX_TICK_SNAPSHOT_CHARS, type HeadlessEffect, type HeadlessCommand } from '../../../shared/host/tickProtocol';
import { headlessSections } from '../../../shared/host/headlessSections';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { offlineMemoryAdmission, prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

await runTickWorker(async raw => {
  const payload = v.parse(v.strictObject({ shard: v.unknown(), assets: v.map(v.string(), v.instance(Uint8Array)), binary: v.string(), snapshot: v.optional(v.string()), sections: v.exactOptional(v.map(v.string(), v.unknown())), product: v.exactOptional(v.string()) }), raw);
  const shard = parseShardfile(payload.shard), rapier = await loadRapier(readFileSync(payload.binary));
  const sections = headlessSections(payload.sections);
  await prepareAssetDecoders();
  validateShardfileAssets(shard, payload.assets, bytes => createHash('sha256').update(bytes).digest('hex'), offlineMemoryAdmission('refuse'), undefined, scriptAdmissionRows(sections));
  if (payload.product !== undefined) {
    // A native assembly's server-class files live only in the built product, never in the client's sections or assets.
    const { loadHeadlessFolder } = await import('../headlessFolder');
    return openWorldAdapter({ shard, assets: payload.assets, rapier, product: await loadHeadlessFolder(payload.product) }, payload.snapshot);
  }
  // SERVER-PARITY HS1 left: a runtime plan carried as sections, with no product, still ticks the bare resident. Far Reach's and
  // Dunes' proof witnesses build their checkpoints that way; moving it to `openWorldAdapter` re-records them.
  // oxlint-disable-next-line typescript/no-deprecated -- HS1 left, above
  if (sections.has('sim/runtime-plan')) return createTrustedHeadlessAdapter({ shard, assets: payload.assets, rapier, sections }, payload.snapshot);
  let commands: ReadonlyMap<string, number> = new Map();
  let effects: HeadlessEffect[] = [];
  const ports = { rapier, sections, commands: () => commands, quest: {
    fact: (name: string, actorId: string) => { effects.push({ kind: 'fact', name, actorId }); },
    coins: (amount: number, actorId: string) => { effects.push({ kind: 'coins', amount, actorId }); },
  } };
  let sim = createShardfileSim(shard, payload.assets, ports);
  if (payload.snapshot !== undefined) {
    const level = sim.host.level; sim.dispose();
    let installed: ShardfileSimulation | undefined;
    const host = restoreSimHost(level, { rapier }, decodeSimSnapshot(payload.snapshot), fresh => { installed = bindShardfileSim(fresh, shard, payload.assets, { ...ports, restoring: true }); });
    if (installed === undefined) { host.dispose(); throw new Error('Missing restored headless adapters'); }
    sim = installed;
  }
  effects = [];
  let scriptMicros = 0, decisionFuel = 0;
  if (sim.decisions !== undefined) {
    const host = sim.decisions.host, step = host.step.bind(host);
    host.step = (...args: Parameters<typeof step>): ReturnType<typeof step> => {
      const before = host.metrics().reduce((sum, row) => sum + row.fuel, 0), started = diagnosticNow();
      try { step(...args); } finally {
        scriptMicros += (diagnosticNow() - started) * 1000;
        decisionFuel += host.metrics().reduce((sum, row) => sum + row.fuel, 0) - before;
      }
    };
  }
  if (sim.lane !== undefined) {
    const host = sim.lane.host, call = host.call.bind(host);
    // Offline-only instrumentation; neither author code nor the production frame loop chooses this wrapper.
    host.call = (...args: Parameters<typeof call>): ReturnType<typeof call> => {
      const started = diagnosticNow();
      try { return call(...args); } finally { scriptMicros += (diagnosticNow() - started) * 1000; }
    };
  }
  const step=(input:readonly HeadlessCommand[]):void => {
      scriptMicros = 0; decisionFuel = 0; effects = []; const numeric = new Map<string, number>(); let player: SimCommand | undefined;
      for (const command of input) {
        if (command.kind === 'player') player = simPlayerCommand(command);
        else if(command.kind==='launcher')throw new Error('Launcher input requires a native bolt owner');
        else if (command.kind === 'interact') sim.interact(command.id);
        else if (command.kind === 'script') {
          if (!sim.actors.has(command.actorId)) throw new Error('Unknown command actor'); numeric.set(command.actorId, command.value);
        } else { if (sim.lane === undefined) throw new Error('Event requires a script lane'); sim.lane.enqueue({ type: command.type, target: command.target, value: command.value }); }
      }
      commands = numeric; sim.host.step(leadCommands(sim.host, player));
      if (![leadPlayer(sim.host).position, ...[...sim.host.entities.values()].map(entity => entity.position)].every(point => [point.x, point.y, point.z].every(Number.isFinite))) throw new Error('Nonfinite headless simulation state');
      const script=sim.lane?.host.checkpoint();
      if(script?.modules.some(module=>module.failures>0||module.disabled))throw new Error('Headless script call failed');
      if(sim.decisions?.host.metrics().some(row=>row.refusals>0||row.disabled))throw new Error('Headless decision call failed');
  };
  const serializer=createSimSnapshotSerializer();
  const tape=createTrustedHeadlessTape(sim.host,step,()=>effects);
  return {
    step,
    observe: () => {
      const script = sim.lane?.host.checkpoint();
      if (script?.modules.some(module => module.failures > 0 || module.disabled)) throw new Error('Headless script call failed');
      if (sim.decisions?.host.metrics().some(row => row.refusals > 0 || row.disabled)) throw new Error('Headless decision call failed');
      checkSimSnapshotWire(snapshotSimHostBytes(sim.host), MAX_TICK_SNAPSHOT_CHARS);
      const fuelUsed = script?.tick === sim.host.state.tick ? script.used.fuel : 0;
      return { tick: sim.host.state.tick, effects, fuelUsed: fuelUsed + decisionFuel, scriptMicros,
        ...(sim.decisions === undefined ? {} : { decisions: sim.decisions.publication() }) };
    },
    verbTape:tape,
    journey: plan=>runHeadlessJourney(sim.host,step,plan),
    commit: () => {
      const script = sim.lane?.host.checkpoint();
      if (script?.modules.some(module => module.failures > 0 || module.disabled)) throw new Error('Headless script call failed');
      if (sim.decisions?.host.metrics().some(row => row.refusals > 0 || row.disabled)) throw new Error('Headless decision call failed');
      // A sleeping lane retains its last counters; report only fuel consumed by this completed global tick.
      const fuelUsed = script?.tick === sim.host.state.tick ? script.used.fuel : 0;
      return { tick: sim.host.state.tick, snapshot: serializer.serialize(snapshotSimHostBytes(sim.host)), effects, fuelUsed: fuelUsed + decisionFuel, scriptMicros, ...(sim.decisions === undefined ? {} : { decisions: sim.decisions.publication() }) };
    },
    authorProof: plan => proveAuthoredGrid(shard, payload.assets, ports,
      { ticks: plan.tape.length, checkpointTick: plan.checkpointTick, requiredFacts: plan.requiredFacts },
      (tick, resident) => {
        const input = plan.tape[tick]; if (input === undefined) throw new Error('Missing author tape tick');
        const numeric = new Map<string, number>(); let player: SimCommand | undefined;
        for (const command of input) {
          if (command.kind === 'player') { if (player !== undefined) throw new Error('Multiple player commands'); player = simPlayerCommand(command); }
          else if(command.kind==='launcher')throw new Error('Launcher input requires a native bolt owner');
        else if (command.kind === 'interact') resident.interact(command.id);
          else if (command.kind === 'script') { if (!resident.actors.has(command.actorId)) throw new Error('Unknown command actor'); numeric.set(command.actorId, command.value); }
          else { if (resident.lane === undefined) throw new Error('Event requires a script lane'); resident.lane.enqueue({ type: command.type, target: command.target, value: command.value }); }
        }
        const script = resident.lane?.host.checkpoint();
        if (script?.modules.some(module => module.failures > 0 || module.disabled)) throw new Error('Author script failed');
        commands = numeric; return player;
      }),
    finish: () => ({ ticks: sim.host.state.tick, ...proveShardfileEntries(shard, sim, payload.assets, ports) }),
    dispose: () => { try { sim.dispose(); } finally { serializer.dispose(); } },
  };
});
