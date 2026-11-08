import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishOwned, sayFightView } from '@wildshard/engine/sim/shardRows';
import { hasNativeInventory, nativeInventoryKeeps, creditNativeInventory } from '../../../shared/game/inventoryLaw';
import { harvestDrops } from '../../../shared/game/harvest';

const finite = v.pipe(v.number(), v.finite());
const corpse = v.strictObject({ id: v.string(), kind: v.string(), variant: v.string(), x: finite, y: finite, z: finite });
/** Dead server bodies are claimed once, in reach, through the native pack's own law.
 * Pending carcasses survive a world save; consumed claims are absent from it. */
export function installNativeHarvest(host: SimHost): void {
  if(!hasNativeInventory(host,'pack'))return;
  publishOwned(host,'harvest',(_player,out)=>{out.set('harvest.enabled',1);});
  const pending = new Map<string, v.InferOutput<typeof corpse>>(), routes = actRoutes(host);
  const bind = (row: v.InferOutput<typeof corpse>): void => {
    pending.set(row.id, row);
    const id = `harvest.${row.id}`;
    routes.claims.set(id, player => {
      const feet = host.players.get(player)?.position;
      if (!pending.has(row.id) || feet === undefined || Math.hypot(feet.x-row.x, feet.z-row.z)>4 || Math.abs(feet.y-row.y)>6) return;
      const granted: number[] = [];
      for (const [index, item] of harvestDrops(row.kind, row.variant).entries())
        if (nativeInventoryKeeps(host, 'pack', item) && creditNativeInventory(host, 'pack', {item,count:1})) granted.push(index);
      pending.delete(row.id); routes.claims.delete(id);
      sayFightView(host, id, granted);
    });
  };
  host.events.on('actor.died', ({ actor }) => {
    const body=host.entities.get(actor.id);if(body===undefined||pending.has(body.entityId))return;
    const {x,y,z}=body.position;
    if(harvestDrops(body.kind,body.variant).some(item=>nativeInventoryKeeps(host,'pack',item)))bind({id:body.entityId,kind:body.kind,variant:body.variant,x,y,z});
  },host.scope);
  host.onStep('owned.harvest',()=>undefined,{
    joined:true,
    snapshot:()=>[...pending.values()].map(row=>({id:row.id,kind:row.kind,variant:row.variant,x:row.x,y:row.y,z:row.z})),
    restore: input=>{
      const rows=v.parse(v.array(corpse),input);
      for(const id of pending.keys())routes.claims.delete(`harvest.${id}`);pending.clear();
      for(const row of rows)bind(row);
    },
  });
}
