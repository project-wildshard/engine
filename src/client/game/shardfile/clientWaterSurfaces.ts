import type { Scope } from '@wildshard/engine/app/scope';
import { buildTier } from '@wildshard/engine/core/tier';
import { gpuOnlyTrees } from '@wildshard/engine/core/gpuOnly';
import { createOwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import type { BakedSource } from '@wildshard/format/bakedTiles';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { WaterSurface,waterSurfaceLook } from '../systems/looks/waterSurface';
import type { ShardContext } from '../plugin/context';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { hasLentLook,lendLooks,lentLooksOf } from './lentLooks';
import { runtimeLookMaterials } from './runtimeFolder';
import { toonLookState } from '../looks/toonLook';
import { readContent } from '@wildshard/engine/boot/contentRead';

type WaterRow = Extract<ClientFeatureRow,{kind:'world.water'}>['rows'][number];
/** A declared draw's file: a product file, or an immutable public asset fetched once into the page cache. */
function bytesOf(product:ShardFolder,source:BakedSource):Promise<Uint8Array>{
  if('file' in source)return product.file(source.file);
  return readContent(source.url,25_000_000,{fetch:(url,init)=>fetch(url,{cache:'force-cache',...init})});
}
interface WaterInputs { readonly key:string; readonly bytes:Uint8Array; readonly floorBytes:Uint8Array|null }
const inputKey=(water:WaterRow):string=>JSON.stringify('geometry' in water?['geometry',water.geometry]:['draw',water.draw.grid[buildTier()],water.draw.floor??null]);
/** Bytes only: the first row may read during look preparation, but never creates
 * geometry, a material or a published surface before its original cursor. */
async function readInputs(product:ShardFolder,water:WaterRow):Promise<WaterInputs>{
  const key=inputKey(water);
  if('geometry' in water)return {key,bytes:await product.file(water.geometry),floorBytes:null};
  const draw=water.draw;
  const pending=[bytesOf(product,draw.grid[buildTier()]),draw.floor===undefined?Promise.resolve(null):bytesOf(product,draw.floor)] as const;
  try{const [bytes,floorBytes]=await Promise.all(pending);return {key,bytes,floorBytes};}
  catch(error){await Promise.allSettled(pending);throw error;}
}
/** A row's surface: its product geometry as drawn, or (O7) its own draw: the tier's grid, level, baked floor, dry
 *  rectangles and toon-lent params, foam stamped round its boxes, CPU copies dropped once uploaded. */
async function drawRow(ctx:ShardContext,water:WaterRow,check:()=>void,prepared?:Promise<WaterInputs>):Promise<WaterSurface>{
  const surface=new WaterSurface(water.surface,waterSurfaceLook(lentLooksOf(water.surface.look),water.surface.look));
  if('geometry' in water){
    const intake=createOwnedGeometry(water.geometry),inputs=await (prepared??readInputs(ctx.product,water));check();
    if(inputs.key!==inputKey(water))throw new Error('Water input declaration changed');
    await intake.load(inputs.bytes);check();
    const shape=intake.take();ctx.scope.own(shape);return surface.draw(shape);
  }
  const draw=water.draw,grid=draw.grid[buildTier()],intake=createOwnedGeometry('url' in grid?grid.url:grid.file,draw.attributes);
  const inputs=await (prepared??readInputs(ctx.product,water));check();
  if(inputs.key!==inputKey(water))throw new Error('Water input declaration changed');
  const {bytes,floorBytes}=inputs;
  await intake.load(bytes);check();const shape=intake.take();ctx.scope.own(shape);
  // half-float heights, copied out of the file's buffer so they are aligned
  const floor=floorBytes===null?undefined:new Uint16Array(floorBytes.slice().buffer);
  const toon=Object.keys(draw.lent).length>0||draw.toonSeaLevel?toonLookState(ctx.product).dayLight:null;
  if(toon!==null&&draw.toonSeaLevel)toon.uSeaLevel.value=draw.level;
  const lent=toon===null?{}:Object.fromEntries(Object.entries(draw.lent).map(([param,uniform])=>[param,toon[uniform]]));
  surface.draw(shape,{level:draw.level,...(floor===undefined?{}:{floor}),dry:draw.dry,lent});
  if(draw.foam.length>0)surface.foamAround(draw.foam);
  gpuOnlyTrees([surface.group],`client.water.${water.id}`,['position']);
  return surface;
}
const owners=new WeakMap<Scope,WeakMap<ShardFolder,ReadonlyMap<string,WaterSurface>>>();
/** Z1 binds the existing water-surface host to declared product geometry and graph looks. */
export async function installClientWaterSurfaces(ctx:ShardContext,row:ClientFeatureRow):Promise<void>{
  if(row.kind!=='world.water')throw new Error('Invalid water feature');
  const scope=ctx.scope,product=ctx.product,read=product.file,root=ctx.root,game=ctx.game;
  const check=():void=>{if(scope.disposed||scope.disposing||ctx.scope!==scope||ctx.product!==product||product.file!==read||ctx.root!==root||ctx.game!==game)throw new Error('Water construction owner left or changed');};
  check();
  let products=owners.get(scope);if(products===undefined){products=new WeakMap();owners.set(scope,products);}
  if(products.has(product))throw new Error('Water surfaces are already installed');
  const first=row.rows[0],prepared=first===undefined?undefined:readInputs(product,first);
  void prepared?.catch(()=>undefined);
  try{
    const missing=[...new Set(row.rows.map(water=>water.surface.look))].filter(id=>!hasLentLook(id));
    if(missing.length>0){const looks=await runtimeLookMaterials({scope,game},product.shardfile,true,missing);check();lendLooks(scope,looks);}
    // O7: drawn rows need graph params even if an earlier lend holds family fallbacks.
    const drawn=[...new Set(row.rows.flatMap(water=>'draw' in water?[water.surface.look]:[]))];
    if(drawn.length>0){const looks=await runtimeLookMaterials({scope,game},product.shardfile,true,drawn);check();lendLooks(scope,looks);}
    const surfaces=new Map<string,WaterSurface>();
    for(const water of row.rows){
      check();const surface=await drawRow(ctx,water,check,water===first?prepared:undefined);check();
      surfaces.set(water.id,surface);root.add(surface.group);scope.onDispose(()=>{surface.group.removeFromParent();});
    }
    products.set(product,surfaces);const installed=products;
    scope.onDispose(()=>{installed.delete(product);});
    ctx.system({id:'client.water.surfaces',phase:'update',after:['main.world'],before:['engine.creatures.update'],run:dt=>{for(const surface of surfaces.values())surface.update(dt);}});
  }catch(error){if(prepared!==undefined)await Promise.allSettled([prepared]);throw error;}
}
/** Typed native bindings borrow the admitted water bodies. */
export function clientWaterSurfaces(ctx:ShardContext):ReadonlyMap<string,WaterSurface>{
  const surfaces=owners.get(ctx.scope)?.get(ctx.product);if(surfaces===undefined||ctx.scope.disposed)throw new Error('Water surfaces are not installed');return surfaces;
}
