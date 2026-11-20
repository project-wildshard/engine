import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishOwned, sayFightView } from '@wildshard/engine/sim/shardRows';
import { hasNativeInventory, nativeInventoryKeeps, creditNativeInventory } from '../../../shared/game/inventoryLaw';
import { declaredHarvestDrops } from '../../../shared/game/harvest';
import type { SpeciesRow } from '@wildshard/engine/ai/species';
import { registerInstalled } from '../shardfile/installedSides';

const finite = v.pipe(v.number(), v.finite());
const corpse = v.strictObject({ id: v.string(), kind: v.string(), variant: v.string(), x: finite, y: finite, z: finite,
  drops: v.exactOptional(v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(128))), v.maxLength(64))) });
/** Dead server bodies are claimed once, in reach, through the native pack's own law.
 * Pending carcasses survive a world save; consumed claims are absent from it. */
export function installNativeHarvest(host: SimHost, species: readonly Pick<SpeciesRow, 'kind' | 'harvest'>[] = []): void {
  if(!hasNativeInventory(host,'pack'))return;
  registerInstalled(host, 'harvest'); // SS3: the page's ambient life drops carcasses the server pays out
  publishOwned(host,'harvest',(_player,out)=>{out.set('harvest.enabled',1);});
  const declarations = new Map<string, NonNullable<SpeciesRow['harvest']>[]>(), undeclared = new Set<string>();
  for (const row of species) {
    if (row.harvest === undefined) { undeclared.add(row.kind); continue; }
    const rows = declarations.get(row.kind) ?? []; rows.push(row.harvest); declarations.set(row.kind, rows);
  }
  const restoreDrops = (row: v.InferOutput<typeof corpse>): v.InferOutput<typeof corpse> => {
    if (row.drops !== undefined) return row;
    let drops: string[] | undefined;
    for (const declaration of declarations.get(row.kind) ?? []) {
      const next = declaredHarvestDrops(declaration, row.variant);
      if (drops !== undefined && (drops.length !== next.length || drops.some((item, index) => item !== next[index])))
        throw new Error('Ambiguous admitted harvest for pending corpse');
      drops = next;
    }
    if (drops !== undefined && undeclared.has(row.kind)) throw new Error('Ambiguous admitted harvest for pending corpse');
    return drops === undefined ? row : { ...row, drops };
  };
  const pending = new Map<string, v.InferOutput<typeof corpse>>(), routes = actRoutes(host);
  const bind = (row: v.InferOutput<typeof corpse>): void => {
    pending.set(row.id, row);
    const id = `harvest.${row.id}`;
    routes.claims.set(id, player => {
      const feet = host.players.get(player)?.position;
      if (!pending.has(row.id) || feet === undefined || Math.hypot(feet.x-row.x, feet.z-row.z)>4 || Math.abs(feet.y-row.y)>6) return;
      const granted: number[] = [];
      for (const [index, item] of (row.drops ?? []).entries())
        if (nativeInventoryKeeps(host, 'pack', item) && creditNativeInventory(host, 'pack', {item,count:1})) granted.push(index);
      pending.delete(row.id); routes.claims.delete(id);
      sayFightView(host, id, granted);
    });
  };
  host.events.on('actor.died', ({ actor }) => {
    const body=host.entities.get(actor.id);if(body===undefined||pending.has(body.entityId))return;
    const {x,y,z}=body.position;
    const drops = declaredHarvestDrops(body.harvest ?? [], body.variant);
    if(drops.some(item=>nativeInventoryKeeps(host,'pack',item)))
      bind({id:body.entityId,kind:body.kind,variant:body.variant,x,y,z,drops});
  },host.scope);
  host.onStep('owned.harvest',()=>undefined,{
    joined:true,
    snapshot:()=>[...pending.values()].map(row=>{
      const saved = {id:row.id,kind:row.kind,variant:row.variant,x:row.x,y:row.y,z:row.z};
      return row.drops === undefined ? saved : Object.assign(saved, { drops: [...row.drops] });
    }),
    restore: input=>{
      const rows=v.parse(v.array(corpse),input).map(restoreDrops);
      for(const id of pending.keys())routes.claims.delete(`harvest.${id}`);pending.clear();
      for(const row of rows)bind(row);
    },
  });
}
