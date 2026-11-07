import type { Scope } from '@wildshard/engine/app/scope';
import type { Placed } from '@wildshard/engine/models/place';
import { placeSet,placedWithin } from '@wildshard/engine/models/sets';
import type { RegisteredSet } from '@wildshard/engine/world/registry';
import { buildYield } from '@wildshard/engine/core/workSlice';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';

const ended=(scope:Scope):boolean=>scope.disposed||scope.disposing;

interface PlaceSets { readonly rows:Extract<ClientFeatureRow,{kind:'world.sets'}>['rows']; readonly owned:RegisteredSet[]; bound:boolean; completed:boolean }
const owners=new WeakMap<Scope,WeakMap<ShardProduct,PlaceSets>>();
/** Z1 admits named-place membership before native model bindings arrive. */
export function installClientPlaceSets(ctx:ShardContext,row:ClientFeatureRow):void{
  if(row.kind!=='world.sets'||ended(ctx.scope))throw new Error('Invalid named-place feature');
  const scope=ctx.scope,product=ctx.product,registry=ctx.app.registry;
  let products=owners.get(ctx.scope);if(products===undefined){products=new WeakMap();owners.set(ctx.scope,products);}
  if(products.has(ctx.product))throw new Error('Named places are already installed');
  const book:PlaceSets={rows:row.rows,owned:[],bound:false,completed:false};products.set(ctx.product,book);const installed=products;
  scope.onDispose(()=>{installed.delete(product);for(const set of book.owned){const index=registry.sets.indexOf(set);if(index!==-1)registry.sets.splice(index,1);}});
}
/** Bind actual model placements; admitted rows select whole groups and spatial copy views (by copy centre, or by copy
 * bounds for a `bounds` row) without adding collision. Users: Nalati, Driftwood. */
export async function bindClientPlaceSets(ctx:ShardContext,groups:ReadonlyMap<string,readonly Placed[]>,nearby:readonly Placed[]):Promise<void>{
  await bindPlaceSets(ctx,groups,nearby,()=>{if(ended(ctx.scope))throw new Error('Named-place owner ended during binding');});
}

/** The finite entered binding borrows original placement arrays. Quest-owned
 * zipline and kit placements follow the world arrays in their shipping order. */
export interface EnteredPlaceBindingRows {
  readonly placed:readonly string[];
  readonly groups:readonly {readonly id:string;readonly placed:readonly string[]}[];
  readonly quest?:string;
}
export async function bindEnteredClientPlaceSets(ctx:ShardContext,rows:EnteredPlaceBindingRows):Promise<void>{
  if(new Set(rows.groups.map(row=>row.id)).size!==rows.groups.length)throw new Error('Repeated named-place group');
  const loans=new Map([...rows.placed,...rows.groups.flatMap(row=>row.placed)].map(id=>[id,entryOwner(ctx.scope,'placed',id)]));
  const questId=rows.quest,quest=questId===undefined?undefined:entryOwner(ctx.scope,'quest',questId);
  const placed=(ids:readonly string[]):Placed[]=>ids.flatMap(id=>{const value=loans.get(id);if(value===undefined)throw new Error('Missing named-place placement');return value;});
  const live=():void=>{
    if(ended(ctx.scope))throw new Error('Named-place owner ended during binding');
    for(const [id,value] of loans)if(entryOwner(ctx.scope,'placed',id)!==value)throw new Error('Named-place placement owner changed');
    if(questId!==undefined&&entryOwner(ctx.scope,'quest',questId)!==quest)throw new Error('Named-place quest owner changed');
  };
  live();
  const nearby=placed(rows.placed);
  if(quest!==undefined){if(quest.zipline!==null)nearby.push(quest.zipline.placed);nearby.push(...quest.kit.placed);}
  await bindPlaceSets(ctx,new Map(rows.groups.map(row=>[row.id,placed(row.placed)])),nearby,live);
}

async function bindPlaceSets(ctx:ShardContext,groups:ReadonlyMap<string,readonly Placed[]>,nearby:readonly Placed[],live:()=>void):Promise<void>{
  const scope=ctx.scope,product=ctx.product,app=ctx.app,registry=app.registry,game=ctx.game,runtime=game.runtime,world=runtime?.world;
  const check=():void=>{live();if(ended(scope)||ctx.scope!==scope||ctx.product!==product||ctx.app!==app||app.registry!==registry||ctx.game!==game||game.runtime!==runtime||runtime?.world!==world)throw new Error('Named-place native owners changed');};
  check();
  const book=owners.get(ctx.scope)?.get(ctx.product);if(book===undefined||book.bound)throw new Error('Named-place binding requires an unbound entered feature');book.bound=true;
  const claimed=new Set(book.rows.flatMap(row=>row.pois)),grouped=new Set([...groups.values()].flat()),loose=[...groups].filter(([name])=>!claimed.has(name)).flatMap(([,placed])=>placed),spatial=[...loose,...nearby.filter(placed=>!grouped.has(placed))];
  for(const row of book.rows){
    check();
    const members=[...row.pois.flatMap(name=>groups.get(name)??[]),...spatial.flatMap(placed=>{const view=placedWithin(placed,row.x,row.z,row.r,row.mode??'centre');return view===null?[]:[view];})];
    if(members.length>0)book.owned.push(placeSet({...row,members,registry:ctx.app.registry}));
    await buildYield(ctx.scope);
    check();
  }
  book.completed=true;
}

/** Require completion of the actual placement bind, including every sliced
 * registration. Merely installing world.sets or starting its bind is not ready. */
export function requireClientPlaceSetsBound(ctx:Pick<ShardContext,'scope'|'product'>):void {
  if(ctx.scope.disposed||ctx.scope.disposing||owners.get(ctx.scope)?.get(ctx.product)?.completed!==true)
    throw new Error('Named places have not finished binding');
}
