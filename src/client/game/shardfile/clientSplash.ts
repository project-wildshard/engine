/**
 * A shard's pools splash on the page (meta SHARD-SOURCE SS6): every pool a scene authored (a `Water`, so a pool with a
 * `surface`) throws droplets and rings when the player walks in, wades or walks out, through one `WaterSplash` for all
 * of them (two draws). Pools without a surface (a habitat's water, a page's own native pond) are left to their owners.
 *
 *   installClientSplash(source.water, { root, scope, phone, movers, frame });
 */
import type { Object3D } from 'three';
import type { ShardWater } from '@wildshard/format/water';
import type { Scope } from '@wildshard/engine/app/scope';
import { WaterSplash, type SplashMover, type SplashPool } from '@wildshard/engine/world/waterSplash';

/** A scene pool's outline: its polygon, or its circle as 24 points. */
export function splashPools(water: ShardWater): SplashPool[] {
  return water.flatMap((body): SplashPool[] => {
    if (body.kind !== 'pool' || body.surface === undefined) return [];
    const { shape } = body;
    const outline: (readonly [number, number])[] = shape.kind === 'polygon' ? shape.points.map(([x, z]): [number, number] => [x, z])
      : Array.from({ length: 24 }, (_, i): [number, number] => [shape.x + Math.cos((i / 24) * Math.PI * 2) * shape.radius, shape.z + Math.sin((i / 24) * Math.PI * 2) * shape.radius]);
    return [{ id: body.id, level: body.level, outline }];
  });
}

/** Install the pools' splash; null when the shard authored no pool. */
export function installClientSplash(water: ShardWater, ports: { root: Object3D; scope: Scope; phone: boolean; movers: () => Iterable<SplashMover>; frame: (run: (dt: number) => void) => void }): WaterSplash | null {
  const pools = splashPools(water);
  if (pools.length === 0) return null;
  const splash = new WaterSplash(pools, { phone: ports.phone });
  ports.root.add(splash.drops, splash.rings);
  ports.scope.onDispose(() => { splash.drops.removeFromParent(); splash.rings.removeFromParent(); splash.dispose(); });
  ports.frame((dt) => { splash.update(dt, ports.movers()); });
  return splash;
}
