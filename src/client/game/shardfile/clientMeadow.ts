import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import { Grass } from '@wildshard/engine/world/Grass';
import { macrotask } from '@wildshard/engine/boot/plan';
import { Particles } from '../systems/looks/particles';
import { configureGrassFieldData } from '../../../shared/game/systems/looks/grassField';

/** Client-only meadow assembly over the native population field rows. The
 * existing level grass driver and atmosphere own their rendering resources. */
export async function installPageMeadow(ctx:ShardContext,input:unknown):Promise<{grass:Grass;particles:Particles}>{
  const runtime=ctx.game.runtime,world=runtime?.world,step=runtime?.step;
  if(ctx.scope.disposed||runtime===undefined||world===null||world===undefined||step===null||step===undefined)throw new Error('Meadow requires its counted world owner');
  configureGrassFieldData(input,ctx.scope);
  const result=await step('grass',async()=>{
    const grass=new Grass(world.sky,world.forest);await grass.prepare();grass.build();await macrotask();
    const particles=new Particles(world.sky,world.forest).build();
    world.game.scene.add(grass.group,particles.group);return {grass,particles};
  });
  runtime.overhead.push(result.grass.group,result.particles.group);
  runtime.hooks.worldUpdate=dt=>{result.grass.update(dt,runtime.viewer());result.particles.update(dt,runtime.viewer(),world.game.camera);};
  return result;
}

/** The world plan selects the field; the native host publishes its real views. */
export async function installClientMeadow(ctx: ShardContext, feature: ClientFeatureRow): Promise<void> {
  if (feature.kind !== 'world.meadow') throw new Error('Invalid meadow feature');
  const result = await installPageMeadow(ctx, await ctx.product.json(feature.file)), runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Meadow requires its native runtime');
  Object.assign(runtime.objects, result);
}
