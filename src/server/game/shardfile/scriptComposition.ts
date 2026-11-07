import { ScriptComposition, type ScriptRole, type ScriptSchedule } from '@wildshard/engine/script/composition';
import { ScriptDriver, type ScriptLanePort } from '@wildshard/engine/script/lane';
import { ScriptBrainDriver, type ScriptBrainOptions } from '@wildshard/engine/ai/scriptBrain';
import { parseScriptBrain, type ShardScriptBrain } from '@wildshard/format/brains';
import type { NativeMoverMotion } from '@wildshard/engine/sim/moverMotion';
import { prepareShardfileScriptOptions, type ShardScriptContent, type ShardScriptPorts } from './scripts';

/** Session-owned alias handles keep brain motion fields separate from the same actor's numeric declared fields. */
export interface DeclaredScriptBrainActor { actorId: string; entity: number; brain: ShardScriptBrain }
/** The loader supplies actor identities, observations, physics queries and authoritative strike execution. */
export interface DeclaredScriptBrainPorts extends Pick<ScriptBrainOptions, 'actors' | 'query' | 'ports'> { bindings: readonly DeclaredScriptBrainActor[] }
/** Serializable role grants. Actor provenance is supplied separately by the session. */
export interface DeclaredScriptRole extends Omit<ShardScriptContent, 'identity'> { id: string; rules: ShardScriptPorts['rules']; events: ScriptRole['events'] }
/** Bind a declared role to host-owned entities without creating another host or clock. */
export interface DeclaredScriptRoleBinding { row: DeclaredScriptRole; entities: ShardScriptPorts['entities']; actors: ShardScriptPorts['actors'] }
/** One authoritative module union and allowance set for numeric state, items, directors and custom creature decisions. */
export function createShardfileComposedLane(content: ShardScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardScriptPorts, brains?: DeclaredScriptBrainPorts,
  extra?: { roles: readonly ScriptRole[]; schedules: readonly ScriptSchedule[]; transientModules?: readonly string[]; nativeMotions?: readonly NativeMoverMotion[]; declarations?: readonly DeclaredScriptRoleBinding[] }): ScriptLanePort {
  const options = prepareShardfileScriptOptions(content, assets, ports);
  const rows = brains?.bindings.map(row => ({ ...row, brain: parseScriptBrain(row.brain) })) ?? [];
  if (rows.some(row => !content.sim.scripts.includes(row.brain.module))) throw new Error('Brain module must be declared in sim.scripts');
  const declared = extra?.declarations ?? [];
  if (declared.length > 128 || !Number.isSafeInteger(content.identity.seed) || content.identity.seed < 0) throw new Error('Invalid declared script roles');
  const seatWorlds = [options.world];
  const roles = declared.map(({ row, entities, actors }) => {
    if (row.sim.scripts.some(name => !content.sim.scripts.includes(name)) || row.sim.bindings.length > 0
      || !['consume', 'deliver'].includes(row.events)) throw new Error('Invalid declared role modules or event policy');
    const driver = new ScriptDriver(prepareShardfileScriptOptions({ ...row, identity: content.identity }, assets, {
      rules: row.rules, entities, actors, query: () => { throw new Error('Declared action roles have no query grants'); },
    }));
    seatWorlds.push(driver.world);
    return Object.assign(driver.role(row.id), { events: row.events });
  });
  const numeric = new ScriptDriver(options);
  const brain = brains === undefined ? undefined : new ScriptBrainDriver({ ...brains, modules: options.modules, divisor: 1,
    bindings: rows.map(({ actorId, entity, brain: spec }) => ({ actorId, entity, module: spec.module,
      maxSpeed: spec.maxSpeed, maxStrafe: spec.maxStrafe, maxTurnRate: spec.maxTurnRate, parameters: spec.parameters, strikes: spec.strikes })),
  }, new Map(rows.map(row => [row.entity, row.brain.thinkDivisor])));
  let commands: ReadonlyMap<string, number> = new Map();
  const composition = new ScriptComposition({ modules: options.modules,
    roles: [numeric.role('numeric'), ...(brain === undefined ? [] : [brain.role('brain')]), ...(extra?.roles ?? []), ...roles],
    schedules: [numeric.schedule('numeric', 'numeric', () => commands), ...(brain === undefined ? [] : [brain.schedule('brain', 'brain')]), ...(extra?.schedules ?? [])],
    maxEntities: ports.rules.maxEntities,
    ...(extra?.nativeMotions === undefined ? {} : { nativeMotions: extra.nativeMotions }),
    ...(extra?.transientModules === undefined ? {} : { transientModules: extra.transientModules }),
    ...(ports.limits === undefined ? {} : { limits: ports.limits }),
    ...(ports.development === undefined ? {} : { development: ports.development }),
    ...(ports.toast === undefined ? {} : { toast: ports.toast }),
    ...(ports.onDisabled === undefined ? {} : { onDisabled: ports.onDisabled }),
  });
  return { host: composition.host, world: numeric.world, divisor: numeric.divisor,
    step: (tick, input = new Map()) => { commands = input; return composition.step(tick); },
    enqueue: event => { composition.enqueue(event); }, snapshot: () => composition.snapshot(), restore: text => { composition.restore(text); },
    seat: (world, actorId, entities, handles) => { world.seat(actorId, entities, handles); composition.seatsChanged(); },
    unseat: (world, actorId) => { composition.seatsChanged(world.unseat(actorId)); }, seatWorlds: () => seatWorlds,
  };
}
