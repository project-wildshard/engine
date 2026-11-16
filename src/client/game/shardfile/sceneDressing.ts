import { waitFor } from '@wildshard/engine/boot/waits';
import { SceneScatterPages } from './sceneScatterPages';
import {prepareBinarySources,binarySourceBytes} from '../models/binarySource';
import { decodeLaneBytes, inflateBytes } from '@wildshard/engine/core/deflate';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { clientPreparationBatch, timeClientPreparation } from './preparationTiming';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { SceneInstanceFields } from './sceneInstances';
import * as THREE from 'three';
import * as v from 'valibot';
import { SceneDressingSchema, SceneFloorSchema, readSceneScatterPose, type SceneDressingRows } from '@wildshard/format/sceneDressing';
import { FrameCamera } from '@wildshard/engine/world/frameCamera';
import { modelContext, defineModel, type ModelDef } from '@wildshard/engine/models/model';
import { place, type Placed } from '@wildshard/engine/models/place';
import { withOwner } from '@wildshard/engine/app/ownership';
import { painterlyMaterial, painterlyUniforms } from '@wildshard/engine/world/painterly';
import { wind } from '@wildshard/engine/world/steppeWind';
import { Rng } from '@wildshard/engine/core/rng';
import { buildYield, workSlice } from '@wildshard/engine/core/workSlice';
import { scatterLayer, instanceBoxes, type ScatterLayer, type ScatterPose } from '@wildshard/engine/render/scatterInstances';
import { instancedQuad } from '@wildshard/engine/render/instancedGeometry';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import { gpuOnlyAttributes } from '@wildshard/engine/core/gpuOnly';
import { mergeStaticSiblingsSliced } from '@wildshard/engine/models/staticSets';
import { createPackedSpecimens, defineSpecimenCatalogue, prepareSpecimenCatalogue, planSpecimenCatalogue, loadBoundSpecimen, loadSpecimenTexture, specimenMaterial, specimenMaterialReady } from '../models/specimenCatalogue';
import { ControlRefinement } from './controlRefinement';
import { fetchLaneBake, readBakedGeometry, bakedGeometryBytes } from '../plugin/geometry';
import { createClientScene } from '../plugin/scene';
import { AmbientWingField } from '../ambient/wingField';
import { EncounterSites } from '../boss/encounterView';
import { letteringMaterial } from '../looks/lettering';
import { hasLentLook, lendLooks, lentLook, lentMappedLook, setLentParam, setLentTexture } from './lentLooks';
import { runtimeLookMaterials } from './runtimeFolder';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import { anchorOf } from './worldScenePlacement';
import { colliderTileKeys, type TileContent } from './tileContent';
import { followResidentTiles, noteTileBytes, folderTileRing, residentTiles } from './tileDriver';
import { StreamingCamera } from './streamingView';
import type { ShardContext } from '../plugin/context';

/** N2: a tile's dressing colliders register this many a task (Rapier hulls: ~1 ms each on the phone) */
const COLLIDERS_PER_TASK=48;

const books = new WeakMap<Scope,WeakMap<ShardContext['product'],SceneDressing>>();
const contacts = (input: readonly unknown[]) => readColliderRows(input, {kinds:['box','treads','hull','capsule','ball','trimesh'],surfaces:['sand','wetSand','grass','rock','planks','stone','water','wood','metal','flesh','shell','ground','edge','felt','earth']});

/** Prepared local floor tables retain their original highest-surface policy. */
/** DL17: a dressing's declared textures, awaited before it resolves, owned by its scope: retiring the scope ends the wait (a
 *  read that never settles cannot hold a retired dressing) and refuses it; the loading footer names the wait meanwhile. */
export async function awaitDressingTextures(scope:Pick<Scope,'capture'|'disposed'|'disposing'>,textures:readonly Promise<unknown>[]):Promise<void>{
  let release=():void=>undefined;
  const retired=new Promise<void>(resolve=>{release=scope.capture('disposers',resolve);});
  try{await waitFor('Dressing textures',Promise.race([Promise.all(textures),retired]),'work');}finally{release();}
  if(scope.disposed||scope.disposing)throw new Error('Dressing retired while its textures loaded');
}
export function readSceneFloors(input:unknown,files:ReadonlyMap<string,Uint8Array>=new Map()):((x:number,z:number)=>number|undefined)[]{
  return v.parse(v.array(SceneFloorSchema),input).map(row=>{
    if('rects'in row)return(x,z)=>floorAtRects(row.rects,x,z,'highest');
    const raw=binarySourceBytes('file'in row?{file:row.file}:{data:row.data},files);
    if(raw.byteLength!==row.res*row.res*4)throw new Error('Floor sample byte count differs');
    const aligned=raw.byteOffset%4===0?raw:raw.slice();
    const heights=new Float32Array(aligned.buffer,aligned.byteOffset,aligned.byteLength/4);
    const sample=bakedSamplers({res:row.res,size:row.size,heights,splat:new Uint8Array(0),undergrowth:null,seed:0,landscapeHash:0}).heightAt;
    return(x,z)=>{const height=sample(x-row.x,z-row.z);return Number.isFinite(height)?height:undefined;};
  });
}

/** Numeric table decoder for dense scatter poses, preserving authored float64 values. */
export function readSceneNumericTable(bytes: Uint8Array): Record<string, number>[] {
  return [...sceneNumericRows(bytes)];
}
function sceneNumericHeader(bytes: Uint8Array): {view:DataView;count:number;width:number;offset:number;keys:string[]} {
  const invalid = new Error('Invalid scene numeric table');
  if (bytes.byteLength < 16) throw invalid;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0,true) !== 0x3150444e) throw invalid;
  const count=view.getUint32(4,true),width=view.getUint32(8,true),header=view.getUint32(12,true);
  if(count>100000||width<1||width>32||header>2048||header<1||bytes.length!==16+header+count*width*8)throw invalid;
  const keys=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(16,16+header)).split('\0');
  if(keys.length!==width||new Set(keys).size!==width||keys.some(key=>!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/u.test(key)))throw invalid;
  return {view,count,width,offset:16+header,keys};
}
function* sceneNumericRows(bytes: Uint8Array): IterableIterator<Record<string, number>> {
  const {view,count,width,offset,keys}=sceneNumericHeader(bytes);
  for(let row=0;row<count;row++){
    const pose:Record<string,number>={};
    for(let column=0;column<width;column++){
      const key=keys[column],value=view.getFloat64(offset+(row*width+column)*8,true);
      if(key===undefined||!Number.isFinite(value))throw new Error('Invalid scene numeric table');pose[key]=value;
    }
    yield pose;
  }
}

/** Decode dense scatter rows directly into their final canonical pose. Header indices and the bounded numeric scratch
 *  are shared by rows; every column is still checked before pose validation, including rows excluded by selection. */
export function* readSceneScatterTable(bytes:Uint8Array):IterableIterator<ScatterPose>{
  const {view,count,width,offset,keys}=sceneNumericHeader(bytes),values=new Float64Array(width);
  const columns=['x','y','z','yaw','sx','sy','sz','far','r','g','b','tiltX','tiltZ','solid'].map(key=>keys.indexOf(key));
  const field=(at:number,key:string):number=>{
    const column=columns[at],value=column===undefined||column<0?undefined:values[column];
    if(value===undefined)throw new Error(`Missing scene scatter pose ${key}`);
    return value;
  };
  const optional=(at:number):number|undefined=>{const column=columns[at];return column===undefined||column<0?undefined:values[column];};
  const known=columns.reduce((total,column)=>total+Number(column>=0),0);
  for(let row=0;row<count;row++){
    for(let column=0;column<width;column++){
      const value=view.getFloat64(offset+(row*width+column)*8,true);
      if(!Number.isFinite(value))throw new Error('Invalid scene numeric table');
      values[column]=value;
    }
    const pose:ScatterPose={x:field(0,'x'),y:field(1,'y'),z:field(2,'z'),yaw:field(3,'yaw'),
      sx:field(4,'sx'),sy:field(5,'sy'),sz:field(6,'sz'),far:field(7,'far'),r:field(8,'r'),g:field(9,'g'),b:field(10,'b')};
    const tiltX=optional(11),tiltZ=optional(12),solid=optional(13);
    if(tiltX!==undefined)pose.tiltX=tiltX;
    if(tiltZ!==undefined)pose.tiltZ=tiltZ;
    if(solid!==undefined){if(solid!==1)throw new Error('Invalid scene scatter pose solid');pose.solid=true;}
    if(known!==width)throw new Error('Unknown scene scatter pose key');
    yield pose;
  }
}
// Only the final draw poses survive a decode slice; raw records and validation
// scratch never accumulate into a second full numeric table.
/** G782: Developer phase totals inside a dressing step (`wildshard.prepare:<slug>:<step>.<phase>`, the awaited time of each
 *  kind of wait); public pages time nothing. */
function dressingPhases<P extends string>(slug:string,step:string,names:readonly P[]):{run:<T>(phase:P,work:()=>Promise<T>)=>Promise<T>;sync:<T>(phase:P,work:()=>T)=>T;finish:()=>void}{
  const batch=clientPreparationBatch(slug,step,names);
  return {run:(phase,work)=>batch===undefined?work():batch.run(phase,work),sync:(phase,work)=>batch===undefined?work():batch.sync(phase,work),finish:()=>{batch?.finish();}};
}
async function sceneScatterPoses(ctx:ShardContext,row:SceneDressingRows['layers'][number],pause:()=>Promise<void>,pages:SceneScatterPages|undefined):Promise<ScatterPose[]>{
  const poses:ScatterPose[]=[],selection=row.select;let at=0;
  if(row.binary){
    for(const pose of readSceneScatterTable(await ctx.product.file(row.file))){
      if(selection===undefined||(at%selection.modulo===selection.remainder)===selection.equal)poses.push(pose);
      if(++at%256===0)await pause();
    }
    return poses;
  }
  if(row.member!==undefined){
    if(pages===undefined)throw new Error('Missing scene scatter page owner');
    // The complete owned page already passed the same finite/strict pose
    // grammar. Keep every selection, copy and pause at its original cursor.
    for(const {solid,...pose} of await pages.poses(row.file,row.member)){
      if(selection===undefined||(at%selection.modulo===selection.remainder)===selection.equal)poses.push(solid===undefined?pose:{...pose,solid:true});
      if(++at%256===0)await pause();
    }
    return poses;
  }
  const data=await ctx.product.json<unknown>(row.file);if(!Array.isArray(data))throw new Error('Scene scatter rows must be an array');
  const source:Iterable<unknown>=data;
  for(const input of source){
    const {solid,...pose}=readSceneScatterPose(input);
    if(selection===undefined||(at%selection.modulo===selection.remainder)===selection.equal)poses.push(solid===undefined?pose:{...pose,solid:true});
    if(++at%256===0)await pause();
  }
  return poses;
}

/** Dense little-endian source addresses keep byte offsets out of bounded JSON rows. */
export function readSceneGeometryAddress(bytes:Uint8Array,word:number):number{
  if(!Number.isSafeInteger(word)||word<0||bytes.byteLength%4!==0||word>=bytes.byteLength/4)throw new Error('Invalid scene geometry address');
  return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(word*4,true);
}

/** Client-only Z2 projection over baked geometry, immutable scatter rows and the existing ambient host. */
export class SceneDressing {
  readonly group: THREE.Group = new THREE.Group();
  readonly layers: ScatterLayer[] = [];
  readonly placed: Placed[] = [];
  readonly pieces: Map<string, { name: string; object: THREE.Object3D; tris: number; placed: Placed[]; anchors: SceneDressingRows["statics"][number]["anchors"]; }>=new Map<string,{name:string;object:THREE.Object3D;tris:number;placed:Placed[];anchors:SceneDressingRows['statics'][number]['anchors']}>();
  /** the encounter sites by name, with what each placed */
  readonly sites: Map<string, { sites: EncounterSites; placed: Placed; }>=new Map<string,{sites:EncounterSites;placed:Placed}>();
  readonly props: THREE.Mesh[] = [];
  propTris = 0;
  private readonly frame = new FrameCamera(this.group);
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly lastPosition = new THREE.Vector3(1e9,0,0);
  private readonly lastDirection = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly drift: [number,number] = [0,0];
  private time = 0;
  private instances:SceneInstanceFields|undefined;
  private wings: AmbientWingField | undefined;
  /** N2: each placement's colliders by every tile they reach, registered on the collider ring (`colliderTiles`) while its
   *  draws stay whole */
  private readonly colliderGroups: { readonly key: string; readonly model: ModelDef<object>; readonly byTile: Map<number, ColliderDesc[]> }[] = [];
  private follow: (() => void) | null = null;
  private readonly animations:SceneDressingRows['animations'];
  private readonly motes:SceneDressingRows['motes'];
  private readonly emitters:SceneDressingRows['emitters'];
  private constructor(private readonly ctx: ShardContext, rows: SceneDressingRows, private readonly catalogueReads:ReadonlyMap<number,()=>Promise<void>>) { this.group.name=rows.name;this.animations=rows.animations;this.motes=rows.motes;this.emitters=rows.emitters; }

  static async install(ctx: ShardContext, input: unknown): Promise<SceneDressing> {
    const rows=v.parse(SceneDressingSchema,input);
    if(Object.values(rows.geometry).some(source=>source.kind==='inline'))throw new Error('Scene geometry requires named files');
    const contactRows=[...rows.layers.map(row=>row.contacts),...rows.statics.flatMap(row=>row.members.map(member=>member.contacts))];
    if(contactRows.some(row=>!Array.isArray(row)&&'data'in row))throw new Error('Scene contacts require named files');
    let products=books.get(ctx.scope);if(products===undefined){products=new WeakMap();books.set(ctx.scope,products);}
    if(products.has(ctx.product)||ctx.scope.disposed||ctx.scope.disposing)throw new Error('Scene dressing requires an unbound entered owner');
    const files=new Map<string,Uint8Array>(),names=new Set(contactRows.flatMap(row=>!Array.isArray(row)&&'file'in row?[row.file]:[]));
    const scope=ctx.scope,product=ctx.product,read=product.file,hasFile=product.hasFile,game=ctx.game,runtime=game.runtime,preparedWorld=runtime?.world;
    const live=():void=>{
      if(scope.disposed||scope.disposing||ctx.scope!==scope||ctx.product!==product||product.file!==read||product.hasFile!==hasFile
        ||ctx.game!==game||game.runtime!==runtime||runtime?.world!==preparedWorld)throw new Error('Scene contact file owner changed or retired');
    };
    const catalogueReads=new Map<number,()=>Promise<void>>();
    for(const [index,source]of rows.catalogues.entries())if(source.load==='after-control'){
      const packed='pack'in source?rows.packs[source.pack]?.rows:source.packed;
      const prepare=planSpecimenCatalogue(product,source.rows,scope,packed===undefined?[]:[packed]);
      catalogueReads.set(index,async()=>{live();const prepared=await prepare();live();for(const [name,bytes]of prepared)files.set(name,bytes);});
    }
    live();for(const file of names)if(!hasFile.call(product,file))throw new Error(`Missing scene contact file ${file}`);
    for(const file of names){live();const bytes=await read.call(product,file);live();files.set(file,bytes);}
    const raw=await prepareBinarySources(product,[...Object.values(rows.geometry).flatMap(row=>row.kind==='file'?[{source:{file:row.file},bytes:bakedGeometryBytes(row.row)}]:[]),
      ...Object.values(rows.materials).flatMap(row=>row.kind==='lettering-file'?[{source:{file:row.file},bytes:row.width*row.height*4}]:[]),
      ...rows.statics.flatMap(row=>row.members.flatMap(member=>member.floors.flatMap(floor=>'file'in floor?[{source:{file:floor.file},bytes:floor.res*floor.res*4}]:[])))],scope);
    live();for(const [name,bytes] of raw)files.set(name,bytes);
    const eagerCatalogues=rows.catalogues.filter(source=>source.load!=='after-control');
    const specimens=await prepareSpecimenCatalogue(product,eagerCatalogues.flatMap(source=>source.rows),scope,
      [...Object.values(rows.packs).map(source=>source.rows),...eagerCatalogues.flatMap(source=>'pack'in source||source.packed===undefined?[]:[source.packed])],
      [...Object.values(rows.geometry).flatMap(source=>source.kind==='asset'?[source.row]:[]),...Object.values(rows.materials).flatMap(source=>source.kind==='asset'?[source.row]:[]),...rows.sites.map(source=>source.rows.generated)]);live();for(const [name,bytes]of specimens)files.set(name,bytes);
    const owner=new SceneDressing(ctx,rows,catalogueReads);
    await owner.build(rows,files);
    // Floor/picking closures can retain the build context. Decoded contacts and
    // geometry own their copies; only catalogue rebuilds still read this map.
    // Floor/atlas views retain their required backing independently of the map.
    for(const name of files.keys())if(!specimens.has(name))files.delete(name);
    products.set(ctx.product,owner);const installed=products;
    // N2: the tiled colliders follow the player by tile (spawn and entries before controls), as an assembled world's do
    if(owner.colliderGroups.length>0){
      const tiles=ctx.scope.child('scene.dressing.tiles'),shard=ctx.product.shardfile,world=ctx.game.runtime?.world;
      // T5: this driver is the entered readout the Developer minimap labels, so it carries the shard's declared tile bytes too
      noteTileBytes(tiles,shard.tiles);await residentTiles(tiles,[owner.colliderTiles(rows.name)],shard.spawn,shard.entryways,folderTileRing(shard)); // NT1: the product's ring (colliders keep min(r, 1))
      if(world!==undefined&&world!==null){const camera=new StreamingCamera(ctx.root,()=>world.game.camera);owner.follow=followResidentTiles(tiles,()=>world.player.position,undefined,()=>camera.read());}
    }
    ctx.scope.onDispose(()=>{if(installed.get(ctx.product)===owner)installed.delete(ctx.product);owner.instances?.dispose();for(const piece of owner.pieces.values())piece.object.removeFromParent();owner.group.removeFromParent();});
    ctx.system({id:'client.scene.dressing',phase:'update',after:['main.world'],before:['engine.creatures.update'],run:dt=>owner.update(dt)});
    if(catalogueReads.size>0){
      const world=runtime?.world,origin=product.shardfile.spawn;
      const camera=(world===undefined||world===null)?undefined:new StreamingCamera(ctx.root,()=>world.game.camera);
      const queue=new ControlRefinement(scope,world?.game.levelScope,()=>world?.player.position??origin,()=>buildYield(scope),camera===undefined?undefined:()=>camera.read());
      const pending=[...catalogueReads].map(([index,prepare])=>queue.add(`catalogue:${String(index)}`,origin,prepare));
      const warm=async():Promise<void>=>{try{await Promise.all(pending);}catch(error:unknown){if(!scope.disposed&&!scope.disposing)console.error('[scene] deferred catalogue preparation failed',error);}};
      void warm();
    }
    return owner;
  }
  static current(ctx: ShardContext): SceneDressing { const value=books.get(ctx.scope)?.get(ctx.product);if(value===undefined||ctx.scope.disposed)throw new Error('Scene dressing is not installed');return value; }
  /** every static's and site's placements by name (the named places' groups) */
  placedGroups(): Map<string,readonly Placed[]> { return new Map<string,readonly Placed[]>([...[...this.pieces].map(([name,piece])=>[name,piece.placed] as const),...[...this.sites].map(([name,row])=>[name,[row.placed]] as const)]); }

  private async build(rows:SceneDressingRows,files:ReadonlyMap<string,Uint8Array>): Promise<void> {
    const {ctx}=this,world=ctx.game.runtime?.world;
    if(world===undefined||world===null)throw new Error('Scene dressing needs a world');
    for(const source of Object.values(rows.geometry))if(source.kind==='baked'||source.kind==='baked-file'){
      if(!ctx.product.hasFile(source.address.file))throw new Error('Missing scene geometry address file');
      if(source.kind==='baked-file'&&!ctx.product.hasFile(source.file))throw new Error('Missing scene geometry bake file');
    }
    for(const row of rows.layers){
      if(!ctx.product.hasFile(row.file))throw new Error('Missing scene scatter file');
      if(row.binary&&row.member!==undefined)throw new Error('Numeric scatter tables cannot select JSON page members');
    }
    const pageNames=rows.layers.flatMap(row=>row.member===undefined?[]:[row.file]);
    const pages=pageNames.length===0?undefined:new SceneScatterPages(ctx,pageNames);
    try {
    const looks=[...Object.values(rows.materials).flatMap(row=>row.kind==='look'||row.kind==='mapped'?[row.look]:[]),...(rows.motes===undefined?[]:[rows.motes.look])];
    const missing=looks.filter(id=>!hasLentLook(id));if(missing.length>0)lendLooks(ctx.scope,await runtimeLookMaterials({scope:ctx.scope,game:ctx.game},ctx.product.shardfile,true,missing));
    const sky=world.sky, models=modelContext(sky), pause=()=>buildYield(ctx.scope);
    const definitions=new Map<string,ModelDef<object>>();
    for(const [index,source]of rows.catalogues.entries()){
      const pack='pack'in source?rows.packs[source.pack]:{rows:source.packed,materials:source.materials};if(pack===undefined)throw new Error('Missing catalogue pack');
      const catalogue=defineSpecimenCatalogue<Record<string,object>>(source.rows,pack.rows,pack.materials,files,this.catalogueReads.get(index));
      for(const row of source.rows)definitions.set(row.model.id,catalogue.model(row.key));
    }
    const packs=new Map(Object.entries(rows.packs).map(([key,source])=>[key,createPackedSpecimens(source.rows,files)]));
    await timeClientPreparation(ctx.product.slug,'dressing.packs',()=>Promise.all([...packs.values()].map(pack=>pack.load())));
    const bytes=new Map<string,Promise<Uint8Array>>(),addresses=new Map<string,Promise<Uint8Array>>(),geometry=new Map<string,THREE.BufferGeometry>(),materials=new Map<string,THREE.Material>();
    await timeClientPreparation(ctx.product.slug,'dressing.geometry',async()=>{
    const at=dressingPhases(ctx.product.slug,'dressing.geometry',['asset','read','address','decode','pause']);
    for(const [key,source]of Object.entries(rows.geometry)){
      let shape:THREE.BufferGeometry;
      if(source.kind==='asset'){shape=(await at.run('asset',()=>loadBoundSpecimen(sky,source.row,files))).geometry.clone();}
      else if(source.kind==='packed'){
        const sourceRows=rows.packs[source.source],part=sourceRows===undefined?undefined:packs.get(source.source)?.parts(source.key,models,sourceRows.materials)?.[0];
        if(part===undefined)throw new Error('Missing scene packed shape');shape=part.geometry;
      }else{
        let raw:Uint8Array;
        if(source.kind==='file')raw=binarySourceBytes({file:source.file},files);
        else if(source.kind==='inline')throw new Error('Scene geometry requires named files');
        else if(source.kind==='baked-file'){let pending=bytes.get(source.file);if(pending===undefined){pending=ctx.product.file(source.file).then(decodeLaneBytes);bytes.set(source.file,pending);}const read=pending;raw=await at.run('read',()=>read);}
        else{let pending=bytes.get(source.url);if(pending===undefined){pending=fetchLaneBake(source.url);bytes.set(source.url,pending);}const read=pending;raw=await at.run('read',()=>read);}
        let offset=0;if(source.kind==='baked'||source.kind==='baked-file'){let pending=addresses.get(source.address.file);if(pending===undefined){pending=ctx.product.file(source.address.file);addresses.set(source.address.file,pending);}const read=pending;offset=readSceneGeometryAddress(await at.run('address',()=>read),source.address.word);}
        if(offset+bakedGeometryBytes(source.row)>raw.byteLength)throw new Error('Scene geometry address exceeds its source');
        const decoded=at.sync('decode',()=>readBakedGeometry(raw,offset,source.row));
        // G782: a welded row (`expand`) draws through its own index: each corner's attributes are the original's exact bits, so
        // its triangles rasterize as the expanded copy did (Nalati's cold crossing spent a 458 ms expand span copying them out)
        shape=decoded;
      }
      if((source.kind==='file'||source.kind==='baked-file')&&source.sphere!==undefined)shape.boundingSphere=new THREE.Sphere(new THREE.Vector3(...source.sphere.slice(0,3)),source.sphere[3]);
      geometry.set(key,shape);ctx.scope.own(shape);await at.run('pause',pause);
    }
    at.finish();
    });
    // Shapes now own their arrays; retire inflated bake and pack scratch before material/contact preparation.
    bytes.clear();addresses.clear();packs.clear();
    await timeClientPreparation(ctx.product.slug,'dressing.materials',async()=>{
    // DL17: the dressing's surfaces are complete at control: every declared texture is on its material (or refused, its
    // fallback kept) before the dressing resolves, not swapped in after the player can move
    const textures:Promise<unknown>[]=[];
    for(const [key,source]of Object.entries(rows.materials).sort((a,b)=>Number(a[1].kind==='mapped')-Number(b[1].kind==='mapped'))){
      const material=source.kind==='specimen'?specimenMaterial(sky,source.row):source.kind==='asset'?(await loadBoundSpecimen(sky,source.row,files)).material
        :source.kind==='look'?lentLook(source.look):source.kind==='mapped'?lentMappedLook(source.look,requiredMaterial(materials,source.over)):source.kind==='lettering'||source.kind==='lettering-file'?letteringMaterial(sky,source,files):painterlyMaterial(sky,source);
      if(source.kind==='look'){
        for(const [name,value]of Object.entries(source.params??{}))setLentParam(source.look,name,value);
        for(const [name,row]of Object.entries(source.textures??{}))textures.push(loadSpecimenTexture(row).then(texture=>{if(!ctx.scope.disposed)setLentTexture(source.look,name,texture);return null;}).catch((error:unknown)=>{console.warn(`[dressing] ${key}.${name}: texture failed, its fallback stays`,error);return null;}));
      }
      if(source.kind==='specimen')textures.push(specimenMaterialReady(material));
      materials.set(key,material);await pause();
    }
    await awaitDressingTextures(ctx.scope,textures);
    });
    const needGeometry=(id:string):THREE.BufferGeometry=>{const value=geometry.get(id);if(value===undefined)throw new Error(`Missing scene shape ${id}`);return value;};
    const needMaterial=(id:string):THREE.Material=>{const value=materials.get(id);if(value===undefined)throw new Error(`Missing scene paint ${id}`);return value;};
    const needModel=(id:string):ModelDef<object>=>{const value=definitions.get(id);if(value===undefined)throw new Error(`Missing scene model ${id}`);return value;};
    for(const row of rows.staticModels){const shape=needGeometry(row.geometry),material=needMaterial(row.material);
      const {surface,seed,variants,specimenYaw,...metadata}=row.model;
      definitions.set(row.model.id,defineModel<object>({...metadata,...(surface===undefined?{}:{surface}),...(seed===undefined?{}:{seed}),...(variants===undefined?{}:{variants}),...(specimenYaw===undefined?{}:{specimenYaw}),build:()=>[{geometry:shape.clone(),material,castShadow:false,receiveShadow:true}]}));}
    await timeClientPreparation(ctx.product.slug,'dressing.layers',async()=>{
    const at=dressingPhases(ctx.product.slug,'dressing.layers',['poses','place','registered','pause']);
    for(const row of rows.layers){
      await timeClientPreparation(ctx.product.slug,`dressing.layer.${row.id}`,async()=>{
      const poses=await at.run('poses',()=>timeClientPreparation(ctx.product.slug,`dressing.poses.${row.id}`,()=>sceneScatterPoses(ctx,row,pause,pages)));
      if(poses.length===0)return;
      const colliderRows=Array.isArray(row.contacts)?contacts(row.contacts):await unpackHulls(row.contacts,files);
      const layer=scatterLayer(row.id,needGeometry(row.geometry),needMaterial(row.material),poses,row.far,row.castShadow,row.keepNear);this.layers.push(layer);this.group.add(layer.mesh);
      const registered=at.sync('place',()=>withOwner(ctx.scope,()=>place(needModel(row.model),poses.map(it=>({x:it.x,y:it.y,z:it.z})),{
        ctx:models,draw:'instanced',registry:ctx.app.registry,drawnInto:{object:layer.mesh,boxes:instanceBoxes(layer.mesh.geometry,poses),colliders:colliderRows},piece:{solidFloor:true,collide:false,split:{every:150,yieldTask:pause}},
      })));await at.run('registered',()=>registered.registered);this.placed.push(registered);this.byTile(row.id,needModel(row.model),registered.colliders);
      });await at.run('pause',pause);
    }
    at.finish();
    });
    await timeClientPreparation(ctx.product.slug,'dressing.statics',async()=>{
    for(const row of rows.statics){
      const made=createClientScene(row.recipe,{geometry:new Map(Object.entries(row.geometry).map(([key,id])=>[key,needGeometry(id)])),materials:new Map(Object.entries(row.materials).map(([key,id])=>[key,needMaterial(id)]))});
      const piece={name:row.name,object:made.root,tris:row.tris,placed:[] as Placed[],anchors:row.anchors};this.pieces.set(row.name,piece);
      this.group.add(made.root);this.propTris+=row.tris;
      for(const member of row.members){
        const colliders=Array.isArray(member.contacts)?contacts(member.contacts):await unpackHulls(member.contacts,files);
        const floors=readSceneFloors(member.floors,files),floor=(x:number,z:number):number|undefined=>{let top:number|undefined;for(const sample of floors){const height=sample(x,z);if(height!==undefined&&(top===undefined||height>top))top=height;}return top;};
        const registered=withOwner(ctx.scope,()=>place(needModel(member.model),member.placements.map(({matrix,heading,...pose})=>({...pose,...(heading===undefined?{}:{yaw:Math.atan2(...heading)}),...(matrix===undefined?{}:{matrix:new THREE.Matrix4().fromArray(matrix)})})),{
          ctx:models,draw:member.draw,registry:ctx.app.registry,drawnInto:{object:made.root,boxes:Float32Array.from(member.boxes),colliders},piece:{solidFloor:true,...(floors.length===0?{}:{floor}),collide:false,split:{every:150,yieldTask:pause}},
        }));await registered.registered;this.placed.push(registered);piece.placed.push(registered);
        this.byTile(`${row.name}.${String(row.members.indexOf(member))}`,needModel(member.model),registered.colliders);await pause();
      }
      // G639 frame floor (DR7, G669: always on): the piece's sibling meshes on one material draw as one
      for(const merged of (await mergeStaticSiblingsSliced(made.root,workSlice(undefined,ctx.scope))).geometries){ctx.scope.own(merged);gpuOnlyAttributes(merged,'scene.dressing');}
      this.props.push(...made.root.children.filter(meshObject));
    }
    });
    for(const row of rows.sites){
      const model=needModel(row.model);
      if(model.prepare!==undefined){await model.prepare();if(ctx.scope.disposed||ctx.scope.disposing)throw new Error('Scene specimen demand owner retired');}
      const sites=new EncounterSites(row.rows),placed=withOwner(ctx.scope,()=>sites.place(model,models,ctx.app.registry,sky,files));
      this.group.add(sites.object);withOwner(ctx.scope,()=>{sites.register(ctx.app.registry);});this.sites.set(row.name,{sites,placed});await pause();
    }
    for(const row of rows.emitters){
      const shape=instancedQuad(new THREE.PlaneGeometry(1,1),Object.fromEntries(Object.entries(row.attributes).map(([name,attribute])=>[name,new THREE.InstancedBufferAttribute(Float32Array.from(attribute.values),attribute.width)])));
      shape.boundingSphere=new THREE.Sphere(new THREE.Vector3(...row.centre),row.radius);ctx.scope.own(shape);
      const mesh=new THREE.Mesh(shape,lentLook(row.look));mesh.name=row.name;mesh.renderOrder=row.renderOrder;this.group.add(mesh);
    }
    this.instances=await timeClientPreparation(ctx.product.slug,'dressing.instances',()=>new SceneInstanceFields(rows.instances,geometry,materials,new Map([...this.pieces].map(([key,piece])=>[key,piece.object]))));
    if(rows.wings!==undefined){this.wings=new AmbientWingField(rows.wings,new Map(rows.wings.layers.map(row=>[row.id,needGeometry(row.geometry)])),new Map(rows.wings.layers.map(row=>[row.id,needMaterial(row.material)])));this.group.add(this.wings.group);}
    if(rows.motes!==undefined){const row=rows.motes,rng=new Rng(row.seed),seeds=Float32Array.from({length:row.count*4},()=>rng.next()),shape=new THREE.BufferGeometry();
      shape.setAttribute('position',new THREE.BufferAttribute(new Float32Array(row.count*3),3));shape.setAttribute('aSeed',new THREE.BufferAttribute(seeds,4));ctx.scope.own(shape);
      const points=new THREE.Points(shape,lentLook(row.look));points.name=row.name;points.frustumCulled=false;points.renderOrder=2;this.group.add(points);}
    // Later Explorer builds may clone model templates. All other owned shapes
    // have finished their CPU readers; picking retains their positions/index.
    const templates=new Set(rows.staticModels.map(row=>row.geometry));
    for(const [key,shape]of geometry)if(!templates.has(key)&&Object.keys(shape.morphAttributes).length===0)gpuOnlyAttributes(shape,'scene.dressing');
    ctx.root.add(this.group);
    } finally { await pages?.close(); }
  }
  /** N2: a placement's world-space colliders by every tile their footprint reaches (none missing at a ring edge) */
  private byTile(key:string,model:ModelDef<object>,colliders:readonly ColliderDesc[]):void{
    const byTile=new Map<number,ColliderDesc[]>();
    for(const shape of colliders)for(const tile of colliderTileKeys(shape)){const list=byTile.get(tile);if(list===undefined)byTile.set(tile,[shape]);else list.push(shape);}
    if(byTile.size>0)this.colliderGroups.push({key,model,byTile});
  }
  /** N2: the dressing as tiled content: no draws by tile (they stay whole), each tile's colliders on a piece per placement
   *  under the tile's collider scope, a paced task per `COLLIDERS_PER_TASK` (the phone's per-task collider budget) */
  private colliderTiles(name:string):TileContent{
    const registry=this.ctx.app.registry,tiles=new Set(this.colliderGroups.flatMap(group=>[...group.byTile.keys()]));
    return{id:`${name}.colliders`,tiles:()=>tiles,attach:()=>Promise.resolve(),attachColliders:async(tile,scope)=>{
      const left=():boolean=>scope.disposed;   // read live: the tile may leave across each await
      for(const group of this.colliderGroups){
        const rows=group.byTile.get(tile)??[],model=group.model;
        for(let at=0;at<rows.length;at+=COLLIDERS_PER_TASK){
          if(left())return;
          const part=rows.slice(at,at+COLLIDERS_PER_TASK),id=`${model.id}.${group.key}.c${String(tile)}${at===0?'':`-${String(at/COLLIDERS_PER_TASK)}`}`;
          withOwner(scope,()=>registry.add({id,name:model.name,category:model.category,file:model.file,anchor:anchorOf(part),colliders:part,solidFloor:true,
            ...(model.surface===undefined?{}:{surface:model.surface})}));
          try{await buildYield(scope);}catch(error:unknown){if(left())return;throw error;}   // a tile that left mid-way: done, not failed
        }
      }
    }};
  }
  update(dt:number):void{
    const world=this.ctx.game.runtime?.world;if(world===null||world===undefined)return;
    const camera=this.frame.of(world.game.camera);camera.getWorldPosition(this.position);camera.getWorldDirection(this.direction);
    if(this.position.distanceToSquared(this.lastPosition)>1||this.direction.dot(this.lastDirection)<.9994){
      this.lastPosition.copy(this.position);this.lastDirection.copy(this.direction);camera.updateMatrixWorld();this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
      for(const layer of this.layers)layer.cull(this.frustum,this.position);
    }
    this.follow?.();
    this.time+=dt;
    for(const row of this.animations){const w=painterlyUniforms.uPWind.value;setLentParam(row.look,row.timeParam,this.time);setLentParam(row.look,row.windParam,[w.x,w.y,Math.min(row.windMax,w.z*row.windScale)]);}
    for(const row of this.emitters){
      const w=painterlyUniforms.uPWind.value,shade=painterlyUniforms.uPShade.value,sun=world.sky.sunColor,c=row.params.windClamp,clamp=(value:number):number=>Math.min(c,Math.max(-c,value));
      setLentParam(row.look,row.params.wind,[clamp(w.x),clamp(w.y),clamp(w.z)]);setLentParam(row.look,row.params.shade,[shade.r,shade.g,shade.b]);setLentParam(row.look,row.params.sun,[sun.r,sun.g,sun.b]);
    }
    this.instances?.update(dt,world.player.position,painterlyUniforms.uPTime.value);
    this.wings?.update(dt,world.player.position);
    const row=this.motes;
    if(row!==undefined){this.drift[0]+=wind.dirX*wind.speed*row.drift*dt;this.drift[1]+=wind.dirZ*wind.speed*row.drift*dt;
      world.game.renderer.getDrawingBufferSize(this.size);setLentParam(row.look,row.driftParam,this.drift);setLentParam(row.look,row.pixelParam,this.size.y/(2*Math.tan(world.game.camera.fov*Math.PI/360)));}
  }
  stats():{layers:Record<string,{total:number;visible:number;tris:number}>;propTris:number}{return{layers:Object.fromEntries(this.layers.map(row=>[row.name,{total:row.count,visible:row.visible,tris:row.tris}])),propTris:this.propTris};}
}
function meshObject(value:THREE.Object3D):value is THREE.Mesh{return value instanceof THREE.Mesh;}

/** T10: the hull file inflates in the platform's paced stream decoder (fflate's script inflate was 40 ms of a Nalati
 *  entry's dressing at phone 4x); the bytes are the same. */
async function unpackHulls(row:Exclude<SceneDressingRows['layers'][number]['contacts'],readonly unknown[]>,files:ReadonlyMap<string,Uint8Array>):Promise<ReturnType<typeof contacts>>{
  if('data'in row)throw new Error('Scene contacts require named files');
  const packed=files.get(row.file);
  if(packed===undefined)throw new Error('Missing scene contact bytes');
  const bytes=await inflateBytes(packed),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  // G782: each hull reads its packed float32 lane straight into its own owned points, finite-checked as the collider
  // grammar does; its origin and surface were admitted with the dressing rows (no temporary number lane, no second copy).
  const owned:ReturnType<typeof contacts>=[];
  for(const [x,y,z,count] of row.origins){
    if((at+count)*4>bytes.length)throw new Error('Packed scene contacts differ from their origins');
    const points=new Float32Array(count);
    for(let i=0;i<count;i++){const value=view.getFloat32((at+i)*4,true);if(!Number.isFinite(value))throw new Error('Collider values must be finite');points[i]=value;}
    at+=count;owned.push({kind:'hull',x,y,z,surface:row.surface,points});
  }
  if(at*4!==bytes.length)throw new Error('Packed scene contacts differ from their origins');return owned;
}

function requiredMaterial(rows:ReadonlyMap<string,THREE.Material>,key:string):THREE.Material{const value=rows.get(key);if(value===undefined)throw new Error('Missing mapped scene material');return value;}
