import { parse } from 'valibot';
import { CreaturePerchBodiesSchema, creaturePerchRules, creaturePerchAdmissionRows, type CreaturePerchBody } from '@wildshard/format/creaturePerch';
import { CreatureHomeSchema } from '@wildshard/format/creatures';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { SCRIPT_LIMITS } from '@wildshard/format/scriptLimits';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { serverReturnRows } from './nativeRuntimeLoans';

interface PerchPreparationPorts {
  readonly scope?: Scope;
  readonly sections?: ReadonlyMap<string, unknown> | undefined;
}
/** Use the same metadata and instance limit as full file admission. */
function preflightInstanceCap(shard: Shardfile, bodies: readonly CreaturePerchBody[], sections?: ReadonlyMap<string, unknown>): void {
  const existing = scriptAdmissionRows(sections);
  const rows = [...existing, ...creaturePerchAdmissionRows(bodies, existing)];
  const modules = new Set(rows.filter(row => row.side === 'sim').map(row => row.module));
  if (shard.sim.scripts.length + modules.size > SCRIPT_LIMITS.instances) throw new Error('Exceeded perch whole-host instance cap');
}
/** A child loan must cover its entire selected closure, or it would hide a
 * valid ancestor loan. Unrelated lazy return modules never enter this loan. */
function lendPerchClosure(owner: Scope, assets: ReadonlyMap<string, Uint8Array>, bodies: readonly CreaturePerchBody[]): void {
  const raw = bodies.filter(body => body.program.bytes === '' || body.program.v2?.bytes === '');
  if (raw.length === 0) return;
  const rows = serverReturnRows(creaturePerchAdmissionRows(raw));
  const hashes = new Set(rows.map(row => row.module.slice('blobs/wasm/'.length, -'.wasm'.length)));
  for (const body of raw) {
    if (body.program.bytes === '') hashes.add(body.program.script.module.slice('blobs/wasm/'.length, -'.wasm'.length));
  }
  if ([...hashes].every(hash => assets.get(hash) instanceof Uint8Array)) ReturnProgram.lendModules(owner, assets, rows);
}
/** Resolve actual plain authority before host construction, callbacks or random draws.
 * The original return owner verifies hash, ABI and identity within the perch set;
 * full file admission and this preparation both apply the whole-host limit. */
export function preflightPlainPerches(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: PerchPreparationPorts = {}): ReadonlyMap<string, CreaturePerchBody> {
  const catalogue = parse(CreaturePerchBodiesSchema, shard.creatures.perchBodies ?? []);
  const errors = creaturePerchRules({ ...shard.creatures, perchBodies: catalogue });
  if (errors.length > 0) throw new Error(`Invalid plain perch authority: ${errors.join('; ')}`);
  const result = new Map(catalogue.map(row => [row.id, row]));
  if (result.size === 0) return result;
  const strikes = new Set(shard.rows.strikes.map(row => row.id));
  const sections = ports.sections ?? outputDescriptor(shard)?.sections;
  preflightInstanceCap(shard, catalogue, sections);
  const owner = new Scope('plain-perch.preflight', ports.scope);
  try {
    lendPerchClosure(owner, assets, catalogue);
    for (const spawn of shard.creatures.spawns) {
      if (spawn.perchBody !== undefined) parse(CreatureHomeSchema, spawn.home);
    }
    for (const body of catalogue) {
      if (!strikes.has(body.policy.strike) || !strikes.has(body.projectile.strike)) throw new Error('Missing declared perch strike');
      try { ReturnProgram.preflight(body.program, owner); }
      catch (error) { throw new Error(`Invalid perch return ${body.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      const { script } = ReturnProgram.projectionBindings(body.program);
      const signals = new Set(Object.values(script.signals)), channels = new Set(Object.values(script.channels));
      if (!signals.has(body.policy.score) || !signals.has(body.policy.height) || !channels.has(body.policy.heightChannel))
        throw new Error('Missing declared perch return signal or channel');
    }
    return result;
  } finally { owner.dispose(); }
}
