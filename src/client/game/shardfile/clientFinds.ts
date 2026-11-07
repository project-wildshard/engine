import { parseFindsCatalogue } from '@wildshard/format/findsCatalogue';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { createFindsCatalogue } from '../../../shared/game/bag/findsCatalogue';
import { renderFinds } from '../bag/bag';
import { boundQuestState } from '../../../shared/game/quest/boundState';
import { isOwnedId } from '../../../shared/game/loot/Owned';
import type { ShardContext } from '../plugin/context';

/** Client-only Bag projection from admitted sticker rows and the actual quest
 * flag owner. Content supplies ids and metadata, never a render/read callback. */
export async function installClientFinds(ctx:ShardContext,input:ClientFeatureRow):Promise<void>{
  if(input.kind!=='bag.finds')throw new Error('Invalid finds feature');
  const rows=parseFindsCatalogue(await ctx.product.json<unknown>(input.file)),flags=boundQuestState(ctx.scope,input.quest).flags;
  const runtime=ctx.game.runtime,play=runtime?.play;if(runtime===undefined||play===null||play===undefined||ctx.scope.disposed)throw new Error('Finds require their entered page');
  const owned=(id:string):boolean=>{if(!isOwnedId(id))throw new Error('Unknown finds ownership');return play.owned.has(id);};
  for(const section of rows.sections)for(const item of section.items)if('owned' in item)owned(item.owned);
  const catalogue=createFindsCatalogue(rows);
  ctx.bag.fragment('finds',{id:input.id,render:panel=>{renderFinds(panel,catalogue({flags,owned:{has:owned}}),ctx.scope);}});
  runtime.hooks.questFlags=()=>flags.all.slice().sort();
}
