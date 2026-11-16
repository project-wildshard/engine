import type { Scope } from '@wildshard/engine/app/scope';
import { CosmeticFinishLocker, CosmeticFinishPainter, paintBoundFinishes } from '../loadout/cosmeticFinishes';
import { pageRidingMount } from '../riding/client';
import { isBowStyle } from '../../../shared/game/weapons/starterBowProfile';
import { entryOwner, presentEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { enteredAdventurePersistence } from '../../../shared/game/quest/chapterBindings';
import type { ShardContext } from '../plugin/context';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

interface ClientCosmeticFinishes { readonly locker: CosmeticFinishLocker; readonly painter: CosmeticFinishPainter;
  /** one frame of the declared bound targets (`bind`), from `owner`'s loans; nothing until its claims have a live kit */
  readonly frame: (owner: ShardContext) => void }
const owners=new WeakMap<Scope,WeakMap<ShardFolder,ClientCosmeticFinishes>>();
/** The kit phase binds declared finish rows to the existing entered saved owner. */
export function installClientCosmeticFinishes(ctx:ShardContext):void{
  if(ctx.scope.disposed)throw new Error('Cosmetic finishes require a living owner');
  let products=owners.get(ctx.scope);if(products===undefined){products=new WeakMap();owners.set(ctx.scope,products);}
  if(products.has(ctx.product))throw new Error('Cosmetic finishes are already installed');
  const persistence=enteredAdventurePersistence(ctx.scope),rows=ctx.product.section('held/finishes').cosmetics;
  if(rows===undefined)throw new Error('Cosmetic feature requires declared finishes');
  const locker=new CosmeticFinishLocker(ctx.product.slug,rows,persistence.cosmetics),painter=new CosmeticFinishPainter(locker),bind=rows.bind;
  const book={locker,painter,frame:(owner:ShardContext):void=>{
    if(bind===undefined)throw new Error('Cosmetic finishes declare no bound targets');
    const kit=entryOwner(owner.scope,'claims',bind.claims).pageKit(owner);if(kit===null)return;
    const ridden=bind.mounts===undefined?null:pageRidingMount(owner).horse,companion=bind.mounts===undefined?null:presentEntryOwner(owner.scope,'taming',bind.mounts.taming)?.companion??null;
    paintBoundFinishes(painter,bind,{kit,mounts:[...new Set([...ridden===null?[]:[ridden.mesh],...companion?.alive===true&&!companion.hidden?[companion.mesh]:[]])],
      applied:(kind,id)=>presentEntryOwner(owner.scope,kind,id)?.power?.applied===true,
      restyle:(slot,next)=>{const bow=kit.bow(slot),worn:string=bow.style;if(!isBowStyle(next))throw new Error(`Unknown bound bow style ${next}`);if(worn!==next)bow.setStyle(next);}});
  }};
  if(rows.menu!==undefined){const runtime=ctx.game.runtime;if(runtime===undefined)throw new Error('Finish menu requires its native page');runtime.menu={...runtime.menu,skins:()=>locker.cardRows(locker.finishes.cards),onWearSkin:id=>{locker.toggle(id);},skinsTitle:rows.menu.title};}
  products.set(ctx.product,book);const installed=products;
  ctx.scope.onDispose(()=>{painter.dispose();installed.delete(ctx.product);});
}
/** Native objects bind to the installed feature; they never construct another locker or painter. */
export function clientCosmeticFinishes(ctx:ShardContext):ClientCosmeticFinishes{
  const value=owners.get(ctx.scope)?.get(ctx.product);if(value===undefined||ctx.scope.disposed)throw new Error('Cosmetic finishes are not installed');return value;
}
