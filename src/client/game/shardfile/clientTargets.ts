import * as v from 'valibot';
import {isJsonData} from '@wildshard/format/json';
import { CombatTargetRowsSchema, DeclaredCombatTargetsSchema } from '@wildshard/format/targets';
import type { RayTargets } from '@wildshard/engine/combat/targets';
import type { ArenaRoomEncounter } from '../boss/arenaRoom';
import type { TimedEncounters } from '../boss/timedEncounters';
import type { CrowdWeaponTarget, ForagerTargets } from '../../../shared/game/shardfile/crowdRuntime';
import type { ShardContext } from '../plugin/context';
import type {PageWildlifeView} from '../population/wildlifeFeature';
import {clientWildlifeState} from '../../../shared/game/population/wildlifeOwner';
import {entryOwner} from '../../../shared/game/shardfile/entryOwners';
import { installEnteredLevelService } from '../shard/retainedHooks';
import { filterCombatAimTargets } from '../../../shared/game/shardfile/aimTargetFilter';

/** Borrow original native projections; rows never provide a callback or factory. */
export type CombatTargetOwner = Pick<CrowdWeaponTarget<ForagerTargets>, 'raycast'>
  | Pick<TimedEncounters, 'target'> | Pick<ArenaRoomEncounter, 'target' | 'lockTarget'>;

/** Register ordered native target refinements in the original entered lifetime.
 * All ids and methods resolve before registration. Every query checks the whole
 * borrowed bank before any target call, and again between native calls. */
export function installCombatTargets(ctx: Pick<ShardContext, 'scope'> & { readonly app: Pick<ShardContext['app'], 'events'> }, input: unknown,
  sources: ReadonlyMap<string, CombatTargetOwner> | Readonly<v.InferOutput<typeof DeclaredCombatTargetsSchema>['bindings']>, population?: { readonly wildlife: PageWildlifeView | null }): void {
  const rows = v.parse(CombatTargetRowsSchema, input), scope = ctx.scope, events = ctx.app.events;
  let populationOwner=population;
  const owners = 'get' in sources ? sources : (() => {
    const metadata = {kind:'combat.targets', rows:input, bindings:sources};
    if(!isJsonData(metadata))throw new Error('Declared targets require plain JSON data');
    const declared = v.parse(DeclaredCombatTargetsSchema,metadata), resolved = new Map<string,CombatTargetOwner>();
    for(const binding of declared.bindings)resolved.set(binding.id,binding.kind==='arena-room'?entryOwner(scope,'arena-room',binding.owner):entryOwner(scope,'timed-encounters',binding.owner));
    if(rows.ray?.requires!==undefined)populationOwner??=clientWildlifeState(ctx);
    return resolved;
  })();
  const resolve = (id: string) => {
    const owner = owners.get(id);
    if (owner === undefined) throw new Error(`Missing combat target owner: ${id}`);
    const ray = 'raycast' in owner ? owner.raycast : owner.target;
    const lock = 'lockTarget' in owner ? owner.lockTarget : undefined;
    if (typeof ray !== 'function' || lock !== undefined && typeof lock !== 'function') throw new Error('Invalid combat target methods');
    return { id, owner, ray, lock, current: (): boolean => owners.get(id) === owner
      && ('raycast' in owner ? owner.raycast : owner.target) === ray && ('lockTarget' in owner ? owner.lockTarget : undefined) === lock };
  };
  const rays = rows.ray?.sources.map(resolve) ?? [], locks = rows.aim?.append.map(resolve) ?? [];
  if (rows.ray?.requires !== undefined && populationOwner === undefined) throw new Error('Combat targets require the native population loan');
  if (locks.some(source => source.lock === undefined)) throw new Error('Combat aim owner has no lock target');
  const validate = (): void => {
    if (scope.disposed || scope.disposing || ctx.scope !== scope || ctx.app.events !== events
      || [...rays, ...locks].some(source => !source.current())) throw new Error('Combat target owner left or changed');
  };
  validate();
  installEnteredLevelService(ctx, entered => {
    validate();
    if (rows.ray !== undefined) {
      const row = rows.ray;
      events.answer('combat.targets.ray', (request: RayTargets): RayTargets => {
        validate();
        const result = row.result === 'copy' ? { ...request } : request;
        if (row.requires === 'population.wildlife' && populationOwner?.wildlife === null) return result;
        for (const source of rays) { validate(); result.hit = source.ray.call(source.owner, result.origin, result.dir, result.maxDist, result.hit); }
        return result;
      }, entered);
    }
    if (rows.aim !== undefined) {
      const row = rows.aim;
      events.answer('combat.aimTargets', list => {
        validate();
        const result = filterCombatAimTargets(list, row.exclude);
        for (const source of locks) { validate(); const target = source.lock?.call(source.owner); if (target !== null && target !== undefined) result.push(target); }
        return result;
      }, entered);
    }
  });
}
