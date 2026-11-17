import { parse } from 'valibot';
import { CreaturePerchBodiesSchema, creaturePerchRules, type CreaturePerchBody } from '@wildshard/format/creaturePerch';
import { CreatureHomeSchema } from '@wildshard/format/creatures';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { serverReturnRows } from './nativeRuntimeLoans';

interface PerchPreparationPorts {
  readonly scope?: Scope;
  readonly sections?: ReadonlyMap<string, unknown> | undefined;
}
/** Resolve actual plain authority before host construction, callbacks or random draws.
 * The original return owner verifies hash, ABI, shared identity and native limits. */
export function preflightPlainPerches(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: PerchPreparationPorts = {}): ReadonlyMap<string, CreaturePerchBody> {
  const catalogue = parse(CreaturePerchBodiesSchema, shard.creatures.perchBodies ?? []);
  const errors = creaturePerchRules({ ...shard.creatures, perchBodies: catalogue });
  if (errors.length > 0) throw new Error(`Invalid plain perch authority: ${errors.join('; ')}`);
  const result = new Map(catalogue.map(row => [row.id, row]));
  if (result.size === 0) return result;
  const strikes = new Set(shard.rows.strikes.map(row => row.id));
  const sections = ports.sections ?? outputDescriptor(shard)?.sections;
  const returns = serverReturnRows(sections?.get('actors/return-scripts') ?? []);
  const owner = new Scope('plain-perch.preflight', ports.scope);
  try {
    if (returns.length > 0) ReturnProgram.lendModules(owner, assets, returns);
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
