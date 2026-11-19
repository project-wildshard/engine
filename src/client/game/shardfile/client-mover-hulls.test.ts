import { expect, test } from 'vitest';
import { Group } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { installClientMoverOwners } from './clientMoverOwners';
import { bindResidentWorldScope } from './runtimePagePresentation';
import { publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import type { ShardContext } from '../plugin/context';
import type { installFollowedMovers } from '../plugin/followedMovers';

// SHARD-SOURCE SS-GP5 (opus-ss4): on staging v0.1.44 a walker crossed Mirror Salt's parked land-sail. A scene shard's movers
// enter through its client plan's `world.movers` owners, which installed the followed movers without the vehicle's hull, so
// a steer vehicle there had no body on the page. Mirror Salt's sail and its inactive hull row, as its build writes them.
const SAIL = {
  id: 'salt.land-sail', entity: 9101, kind: 'channel', enabled: true, execution: 'native', at: { x: 0.955, y: -0.09, z: 146.5218 },
  euler: { x: 0, y: -0.05, z: 0 }, boxes: [], driver: { kind: 'steer', speed: 9, turn: 1, boost: 1.6, accel: 4, ground: true },
};
const HULL = { id: 'salt.land-sail', initialActive: false, panel: 'salt.land-sail',
  shapes: [{ kind: 'box', x: 1, y: 0.7, z: 147, hx: 0.6, hy: 0.125, hz: 1.8, yaw: -0.05 }] };

test('a client plan\'s steer vehicle enters with its hull', async () => {
  const scope = new Scope('entered'), resident = new Scope('resident');
  bindResidentWorldScope(scope, resident);
  publishEntryOwner(scope, 'object', 'sail', new Group());
  const ctx = { scope, game: { runtime: { world: {} } },
    product: { has: () => false, section: () => ({ movers: [SAIL] }), shardfile: { look: { materials: {} }, movers: [SAIL], props: { colliders: [HULL] } } } } as unknown as ShardContext;
  let options: Parameters<typeof installFollowedMovers>[2] | undefined;
  const install = ((_ctx, _world, given) => { options = given; return {} as ReturnType<typeof installFollowedMovers>; }) as typeof installFollowedMovers;
  await installClientMoverOwners(ctx, { system: 'salt', bindings: [{ id: SAIL.id, kind: 'object', owner: 'sail' }] }, install);
  const hull = options?.hulls?.get(SAIL.id);
  expect(hull).toHaveLength(1);
  expect(hull?.[0]?.hy).toBe(0.125);
  expect(hull?.[0]?.y).toBeCloseTo(0.79, 5);
  scope.dispose(); resident.dispose();
});
