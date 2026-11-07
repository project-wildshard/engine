// Frozen before-control: clientScripts.ts at 0476888744.
import { ClientScriptLane, type ClientScriptObservation } from '@wildshard/engine/script/client';
import type { DeclaredScriptWorld } from '@wildshard/engine/script/state';
import { clientScriptRules, parseClientScripts, type ClientScriptContent, type ClientScriptTarget } from '@wildshard/format/clientScripts';

/** Trusted input ports; the actor comes from the page, and observation never exposes a simulation object to bytecode. */
export interface ShardfileClientScriptPorts { actorId: string; state?: Pick<DeclaredScriptWorld, 'viewField'>; observe: (target: ClientScriptTarget) => { position: readonly [number, number, number]; frozen: boolean }; memoryBytes?: number }
/** Construct one isolated presentation lane and copy only the selected public/owner values on each presentation tick. */
export function createShardfileClientScripts(source: ClientScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileClientScriptPorts): {
  lane: ClientScriptLane; targets: readonly { entity: number; target: ClientScriptTarget }[]; step: (tick: number) => void; dispose: () => void;
} {
  const declaration = parseClientScripts(source.clientScripts), problems = clientScriptRules({ ...source, clientScripts: declaration });
  if (problems.length > 0) throw new Error(problems.join('; '));
  const fieldNames = declaration.bindings.map((binding) => binding.reads.map((read) => {
    const field = source.state[read.scope].find((row) => row.id === read.id); if (!field) throw new Error('Unknown client state field');
    return { scope: read.scope, name: field.name };
  }));
  const modules = [...new Set(declaration.bindings.map((binding) => binding.module))].map((moduleRef) => {
    const bytes = assets.get(moduleRef); if (!bytes) throw new Error('Missing admitted client module');
    return { name: moduleRef, bytes, seedLo: source.identity.seed % 4294967296, seedHi: Math.floor(source.identity.seed / 4294967296) };
  });
  if (declaration.bindings.some((b) => b.reads.length > 0) && ports.state === undefined) throw new Error('Declared client reads require an owned state view');
  const lane = new ClientScriptLane({ modules, divisor: declaration.divisor, ...(ports.memoryBytes === undefined ? {} : { memoryBytes: ports.memoryBytes }),
    bindings: declaration.bindings.map((b) => ({ module: b.module, entity: b.entity, name: b.name, readCount: b.reads.length, parameters: b.parameters, pose: b.pose, maxOffset: b.maxOffset, minScale: b.minScale, maxScale: b.maxScale,
      emitters: b.emitters.map((e) => ({ id: e.id, perTick: e.perTick, live: e.live, lifetimeTicks: e.lifetimeTicks })) })) });
  return { lane, targets: declaration.bindings.map((b) => ({ entity: b.entity, target: structuredClone(b.target) })), dispose: () => lane.dispose(), step: (tick) => {
    const state = declaration.bindings.some((b) => b.reads.length > 0) ? ports.state : undefined, observations = new Map<number, ClientScriptObservation>();
    declaration.bindings.forEach((binding, index) => {
      const observed = ports.observe(binding.target), reads = fieldNames[index]; if (!reads) throw new Error('Missing client read contract');
      const values = reads.map((read) => { const value = state?.viewField(ports.actorId, read.scope, read.name); if (value === undefined) throw new Error('Private or missing client state field'); return value; });
      observations.set(binding.entity, { position: [...observed.position], frozen: observed.frozen, values });
    });
    lane.step(tick, observations);
  } };
}
