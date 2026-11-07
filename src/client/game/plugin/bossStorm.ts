import { Color, Mesh, SphereGeometry, type Scene, type Vector3 } from 'three';
import { weatherFog, type WeatherFog } from '@wildshard/engine/world/Atmosphere';
import type { MarkedBossPresentation } from '@wildshard/format/bossProfiles';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { prepareClientWorld } from '../shardfile/runtimeProduct';
import type { ShardContext } from './context';

/**
 * A spawned boss fight's storm (SHARD-PLATFORM SF27; ENGINE §"Phased flyers and marked boss fights"), presented from its
 * marked boss presentation row's `storm`: the level's weather fog (`dist` per metre in `color`, eased in and out with the
 * fight's storm strength; the level opts in with `atmosphere.weather: true`, otherwise the storm blows without fog) and
 * one sphere shell per `shells` row (`[radius m, share, look]`, outer first) riding round `player`, 1.6 m up and drawn
 * from inside after the scene (render order 10), shown while the strength is above 0.01. Each shell wears its shard's
 * `look.materials[look]` graph, compiled on the world's renderer through `prepareClientWorld`; the graph reads the
 * strength as the host field `shared.storm`. A host with no world stage has no shells; one whose shells fail to compile
 * logs it and keeps the fog. `RowBossView` makes it over the play scene and runs it every frame with the strength.
 */
export function bossStorm(ctx: ShardContext, source: Shardfile, player: Vector3, storm: MarkedBossPresentation['storm']): (scene: Scene) => (dt: number, strength: number) => void {
  return (scene) => {
    // The fog is made on the first update, once the level's atmosphere is installed; the level's own fog is never written.
    let strength = 0, tick: ((dt: number) => void) | null = null, fog: WeatherFog | null = null, fogTried = false;
    const shells: Mesh[] = [], looks = storm.shells.map(shell => shell[2]);
    if (ctx.game.runtime?.world && looks.length > 0) void (async () => {
      const prepared = await prepareClientWorld(ctx, source, { materials: looks, requiredMaterials: looks }); if (ctx.scope.disposed) return;
      prepared.graphs.bind({ state: (part, name) => (part === 'shared' && name === 'storm' ? strength : undefined) });
      for (const row of storm.shells) {
        const shell = new Mesh(ctx.scope.own(new SphereGeometry(row[0], 24, 12)), prepared.material(row[2]));
        shell.renderOrder = 10; shell.frustumCulled = false; shell.visible = false; scene.add(shell); shells.push(shell);
        ctx.scope.onDispose(() => { shell.removeFromParent(); });
      }
      tick = prepared.tick;
    })().catch((e: unknown) => { console.error('[boss storm] the storm shells did not compile; the storm blows without them:', e); });
    return (dt, next) => {
      if (!fogTried) { fogTried = true; try { fog = weatherFog(ctx.scope, { dist: storm.dist, color: new Color(storm.color) }); } catch { fog = null; } }
      fog?.set(next * next * (3 - 2 * next));
      strength = next; tick?.(dt);
      for (const shell of shells) { shell.visible = next > 0.01; shell.position.set(player.x, player.y + 1.6, player.z); }
    };
  };
}
