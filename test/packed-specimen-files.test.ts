import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { fixtureProductFile, fixtureJsonCheck } from './fixtures/productFile';
import {zlibSync} from 'fflate';
import * as THREE from 'three';
import {afterEach,expect,test,vi} from 'vitest';
import {place} from '../src/client/engine/models/place';
import {listModel} from '../src/client/engine/models/live';
import {withOwner} from '../src/shared/engine/app/ownership';
import {Scope} from '../src/shared/engine/app/scope';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {Rng} from '../src/shared/engine/core/rng';
import * as deflate from '../src/client/engine/core/deflate';
import {modelContext} from '../src/client/engine/models/model';
import {SkyRig} from '../src/client/engine/world/skyRig';
import {WorldRegistry} from '../src/client/engine/world/registry';
import {parseExplorerCatalogue} from '@wildshard/format/explorerCatalogue';
import {emptyShardfile} from '../src/shared/host/author';
import {emitNamedBlobs,nameBlob} from '../src/sharddev/blobs';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {SceneDressing} from '../src/client/game/shardfile/sceneDressing';
import type {ShardContext} from '../src/client/game/plugin/context';
import {explorerRoster} from '../src/client/game/models/explorerCatalogue';
import {createPackedSpecimens,defineSpecimenCatalogue,prepareSpecimenCatalogue,planSpecimenCatalogue} from '../src/client/game/models/specimenCatalogue';
import {reachControl} from '../src/client/engine/boot/prefetch';

function deferred<T>():{promise:Promise<T>;resolve:(value:T)=>void}{
  let finish:(value:T)=>void=()=>{throw new Error('Missing deferred resolver');};
  const promise=new Promise<T>(resolve=>{finish=resolve;});return {promise,resolve:finish};
}
function fixture(id:string,points:readonly number[]){
  const raw=new Uint8Array(Float32Array.from(points).buffer),lanes=new Uint8Array(raw.length),words=raw.length/4;
  for(let at=0;at<raw.length;at++)lanes[(at%4)*words+Math.floor(at/4)]=raw[at]??0;
  const wire=zlibSync(lanes),file=`models/${id}.bin`;
  const geometry={attrs:[['position','f32',3,false]],count:points.length/3,index:null,indexCount:0,box:true,expand:false};
  const packed={bin:{file,bytes:wire.length},bytes:raw.length,rows:[{key:`fixture/${id} {}`,parts:[{material:'stone',geometry}]}]};
  const rows=[{key:id,model:{id:`fixture/${id}`,name:id,file:'fixture.json',category:'props',pipeline:'code',defaults:{}},source:{kind:'packed'}}];
  return {raw,wire,file,packed,rows};
}
const forge=fixture('anvil',[0,0,0,2,0,0,0,1,0]),orchard=fixture('crate',[-1,-2,-3,1,2,3,1,-2,3,0,1,0]);
const materials={stone:{id:'fixture-stone',family:'painterly' as const}};
function skyFixture():SkyRig{
  const sky:unknown=Object.create(SkyRig.prototype);
  if(!(sky instanceof SkyRig))throw new Error('Missing test sky');
  Reflect.set(sky,'csm',{lights:[]});Reflect.set(sky,'sunDir',new THREE.Vector3(0,1,0));
  vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);return sky;
}
afterEach(()=>{vi.restoreAllMocks();});

test('planned specimen sources wait for demand and share one exact decode',async()=>{
  const scope=new Scope('planned-specimen'),files=new Map<string,Uint8Array>();
  const file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire);
  const read=planSpecimenCatalogue({file,hasFile:()=>true},forge.rows,scope,[forge.packed]);
  const catalogue=defineSpecimenCatalogue<Record<string,object>>(forge.rows,forge.packed,materials,files,async()=>{
    for(const [name,bytes]of await read())files.set(name,bytes);
  });
  const model=catalogue.model('anvil'),context=modelContext(skyFixture());
  expect(file).not.toHaveBeenCalled();expect(()=>model.build(context,{},new Rng(1))).toThrow('requires preparation');
  try{
    await Promise.all([model.prepare?.(),model.prepare?.()]);expect(file).toHaveBeenCalledTimes(1);expect(files.get(forge.file)).toEqual(forge.raw);
    const first=model.build(context,{},new Rng(1)),second=model.build(context,{},new Rng(1));
    if(!(first instanceof THREE.Group)||!(second instanceof THREE.Group))throw new Error('Missing prepared groups');
    const a=first.children[0],b=second.children[0];if(!(a instanceof THREE.Mesh)||!(b instanceof THREE.Mesh))throw new Error('Missing prepared meshes');
    const x:unknown=a.geometry,y:unknown=b.geometry;if(!(x instanceof THREE.BufferGeometry)||!(y instanceof THREE.BufferGeometry))throw new Error('Missing prepared geometry');
    const position:unknown=x.getAttribute('position'),other:unknown=y.getAttribute('position');
    if(!(position instanceof THREE.BufferAttribute)||!(other instanceof THREE.BufferAttribute))throw new Error('Missing prepared positions');
    expect(new Uint8Array(position.array.buffer,position.array.byteOffset,position.array.byteLength)).toEqual(forge.raw);
    expect(position.array).not.toBe(other.array);x.dispose();y.dispose();
    scope.dispose();await expect(model.prepare?.()).rejects.toThrow('retired');
  }finally{scope.dispose();}
});

test('planned source admission refuses missing names without starting IO',()=>{
  const file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire);
  expect(()=>planSpecimenCatalogue({file,hasFile:()=>false},forge.rows,undefined,[forge.packed])).toThrow('Missing binary source');
  expect(file).not.toHaveBeenCalled();
});

test('a planned malformed bank retains its refusal without retry or URL fallback',async()=>{
  const file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire.subarray(1));
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No fallback'));
  const read=planSpecimenCatalogue({file,hasFile:()=>true},forge.rows,undefined,[forge.packed]);
  await expect(read()).rejects.toThrow('byte count');await expect(read()).rejects.toThrow('byte count');
  expect(file).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();
});

test('retirement before demand starts no planned read and replacement invalidates a ready plan',async()=>{
  const scope=new Scope('plan-retired'),file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire);
  const read=planSpecimenCatalogue({file,hasFile:()=>true},forge.rows,scope,[forge.packed]);scope.dispose();
  await expect(read()).rejects.toThrow('retired');expect(file).not.toHaveBeenCalled();
  const product={file,hasFile:()=>true},ready=planSpecimenCatalogue(product,forge.rows,undefined,[forge.packed]);await ready();
  product.file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire);
  await expect(ready()).rejects.toThrow('changed');expect(product.file).not.toHaveBeenCalled();
});

test('planned retirement drains an in-flight bank without returning its bytes',async()=>{
  const scope=new Scope('plan-drain'),reply=deferred<Uint8Array>(),read=planSpecimenCatalogue({file:()=>reply.promise,hasFile:()=>true},forge.rows,scope,[forge.packed]);
  const work=read();scope.dispose();reply.resolve(forge.wire);await expect(work).rejects.toThrow('retired');
});

test.each([false,true])('late dressing catalogue follows controlled paint; retire=%s',async retired=>{
  const scope=new Scope('dressing-late'),level=new Scope('dressing-level'),frames:FrameRequestCallback[]=[];
  vi.spyOn(scope,'raf').mockImplementation(run=>{frames.push(run);return frames.length;});
  const file=vi.fn<(_name:string)=>Promise<Uint8Array>>().mockResolvedValue(forge.wire),sky=skyFixture();
  type Runtime=NonNullable<ShardContext['game']['runtime']>;type World=NonNullable<Runtime['world']>;
  const world=legacyDouble<World>({sky,game:legacyDouble<World['game']>({levelScope:level,camera:new THREE.PerspectiveCamera()}),player:legacyDouble<World['player']>({position:new THREE.Vector3()})});
  const product=legacyDouble<ShardContext['product']>({slug:'late-dressing',shardfile:emptyShardfile({slug:'late-dressing',name:'Late',author:'Fixture',seed:1,revision:1}),file,hasFile:()=>true});
  const ctx=legacyDouble<ShardContext>({scope,root:new THREE.Group(),system:vi.fn<ShardContext['system']>(),product,
    app:legacyDouble<ShardContext['app']>({registry:new WorldRegistry()}),game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<Runtime>({world})})});
  try{
    await SceneDressing.install(ctx,{name:'late',catalogues:[{rows:forge.rows,packed:forge.packed,materials,load:'after-control'}],packs:{},geometry:{},materials:{},layers:[],statics:[],animations:[]});
    expect(file).not.toHaveBeenCalled();if(retired)scope.dispose();reachControl(level);
    if(!retired)for(let i=0;i<2;i++){const frame=frames.shift();if(frame===undefined)throw new Error('Missing control paint');frame(1);await Promise.resolve();}
    if(retired){await Promise.resolve();expect(file).not.toHaveBeenCalled();}
    else await vi.waitFor(()=>{expect(file).toHaveBeenCalledTimes(1);});
  }finally{scope.dispose();level.dispose();}
});

test('two packed file declarations preserve every word and independent catalogue geometry',async()=>{
  const sources=new Map([[forge.file,forge.wire],[orchard.file,orchard.wire]]),scope=new Scope('packed-files');
  const product={hasFile:(name:string):boolean=>sources.has(name),file:vi.fn(function readBank(this:unknown,name:string):Promise<Uint8Array>{
    expect(this).toBe(product);const bytes=sources.get(name);if(bytes===undefined)throw new Error('Missing fixture file');return Promise.resolve(bytes.slice());
  })};
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Packed files must not fetch a URL'));
  const files=await prepareSpecimenCatalogue(product,[...forge.rows,...orchard.rows],scope,[forge.packed,orchard.packed,forge.packed]);
  expect(product.file.mock.calls.map(([name])=>name)).toEqual([forge.file,orchard.file]);
  const sky=skyFixture(),context=modelContext(sky);
  try{for(const source of [forge,orchard]){
    expect(files.get(source.file)).toEqual(source.raw);
    const catalogue=defineSpecimenCatalogue<Record<string,object>>(source.rows,source.packed,materials,files);
    await catalogue.loadPacked();
    const key=source.rows[0]?.key;if(key===undefined)throw new Error('Missing model key');
    const model=catalogue.model(key),first=model.build(context,{},new Rng(1)),second=model.build(context,{},new Rng(1));
    if(!(first instanceof THREE.Group)||!(second instanceof THREE.Group))throw new Error('Missing specimen groups');
    const a=first.children[0],b=second.children[0];if(!(a instanceof THREE.Mesh)||!(b instanceof THREE.Mesh))throw new Error('Missing packed meshes');
    const firstShape:unknown=a.geometry,secondShape:unknown=b.geometry;
    if(!(firstShape instanceof THREE.BufferGeometry)||!(secondShape instanceof THREE.BufferGeometry))throw new Error('Missing packed geometry');
    const position:unknown=firstShape.getAttribute('position'),other:unknown=secondShape.getAttribute('position');
    if(!(position instanceof THREE.BufferAttribute)||!(other instanceof THREE.BufferAttribute))throw new Error('Missing packed positions');
    expect(new Uint8Array(position.array.buffer,position.array.byteOffset,position.array.byteLength)).toEqual(source.raw);
    expect(position.array).not.toBe(other.array);expect(firstShape.boundingSphere).toEqual(secondShape.boundingSphere);
    const before=Array.from(other.array);position.setXYZ(0,99,98,97);expect(Array.from(other.array)).toEqual(before);
    expect(a.material).toBe(b.material);firstShape.dispose();secondShape.dispose();
  }}finally{scope.dispose();}
  expect(fetch).not.toHaveBeenCalled();
});

test('missing or conflicting bank declarations refuse before the verified reader runs',async()=>{
  const file=vi.fn(()=>Promise.resolve(forge.wire));
  await expect(prepareSpecimenCatalogue({file,hasFile:()=>false},forge.rows,undefined,[forge.packed])).rejects.toThrow('Missing binary source');
  await expect(prepareSpecimenCatalogue({file},forge.rows,undefined,[forge.packed,{...forge.packed,bin:{file:forge.file,bytes:forge.wire.length+1}}])).rejects.toThrow('Conflicting binary source lengths');
  expect(()=>prepareSpecimenCatalogue({file},[{...forge.rows[0],source:{kind:'file',file:forge.file,geometry:forge.packed.rows[0]?.parts[0]?.geometry,material:materials.stone}}],undefined,[forge.packed])).toThrow('Conflicting specimen source encodings');
  let touched=0;const hostile=Object.defineProperty({...forge.packed},'bin',{enumerable:true,get:()=>{touched++;return forge.packed.bin;}});
  expect(()=>prepareSpecimenCatalogue({file},forge.rows,undefined,[hostile])).toThrow('plain JSON');
  const hostileList=Object.defineProperty([forge.packed],'0',{enumerable:true,get:()=>{touched++;return forge.packed;}});
  expect(()=>prepareSpecimenCatalogue({file},forge.rows,undefined,hostileList)).toThrow('plain JSON');
  expect(touched).toBe(0);expect(file).not.toHaveBeenCalled();
});

test('compressed counts, decoded counts, lane alignment and complete coverage stay strict',async()=>{
  const prepare=(bytes:Uint8Array,packed:unknown):Promise<ReadonlyMap<string,Uint8Array>>=>prepareSpecimenCatalogue({file:()=>Promise.resolve(bytes)},forge.rows,undefined,[packed]);
  await expect(prepare(forge.wire.subarray(1),forge.packed)).rejects.toThrow('byte count');
  await expect(prepare(forge.wire,{...forge.packed,bytes:forge.raw.length+4})).rejects.toThrow('Specimen byte count differs');
  await expect(prepare(forge.wire,{...forge.packed,rows:[]})).rejects.toThrow('do not cover');
  const unaligned=zlibSync(new Uint8Array(3));
  await expect(prepare(unaligned,{...forge.packed,bin:{file:forge.file,bytes:unaligned.length}})).rejects.toThrow('not whole words');
  const malformed=new Uint8Array(forge.wire.length);
  await expect(prepare(malformed,forge.packed)).rejects.toThrow();
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No URL fallback'));
  await expect(createPackedSpecimens(forge.packed).load()).rejects.toThrow('not prepared');expect(fetch).not.toHaveBeenCalled();
});

test('retired scopes and replaced readers cannot publish an in-flight bank',async()=>{
  for(const retired of [true,false]){
    const scope=new Scope('packed-owner'),reply=deferred<Uint8Array>();
    const product={file:():Promise<Uint8Array>=>reply.promise,hasFile:():boolean=>true};
    const pending=prepareSpecimenCatalogue(product,forge.rows,scope,[forge.packed]);
    if(retired)scope.dispose();else product.file=()=>Promise.resolve(forge.wire);
    reply.resolve(forge.wire);await expect(pending).rejects.toThrow(retired?'retired':'reader changed');scope.dispose();
  }
});

test('a scope retired during native decoding cannot receive prepared bytes',async()=>{
  const scope=new Scope('packed-decode'),entered=deferred<undefined>(),reply=deferred<Uint8Array>();
  vi.spyOn(deflate,'decodeLaneBytes').mockImplementation(()=>{entered.resolve(undefined);return reply.promise;});
  const pending=prepareSpecimenCatalogue({file:()=>Promise.resolve(forge.wire)},forge.rows,scope,[forge.packed]);
  await entered.promise;scope.dispose();reply.resolve(forge.raw);
  await expect(pending).rejects.toThrow('owner retired or changed');
});

test('the original URL form keeps its native decoder and strict asset-path admission',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>Promise.resolve(new Response(forge.wire.slice())));
  const packed={...forge.packed,bin:'/assets/forge/anvil.bin'},pack=createPackedSpecimens(packed);
  const files=await prepareSpecimenCatalogue({},forge.rows,undefined,[packed]);expect(files.size).toBe(0);
  await pack.load();expect(fetch).toHaveBeenCalledExactlyOnceWith('/assets/forge/anvil.bin');
  expect(()=>createPackedSpecimens({...packed,bin:'/src/anvil.bin'})).toThrow();
});

test('the existing Explorer and dressing adapters prepare admitted banks without URL fallback',async()=>{
  const book='models/cover-phone.json',declared=emitNamedBlobs([nameBlob(forge.file,'bin',forge.wire,{decoded:forge.raw.length}),
    nameBlob(book,'json',new TextEncoder().encode(JSON.stringify({rows:forge.rows,packed:forge.packed,materials})),{jsonSchema:registeredJsonSchema(book)})]);
  const product=createShardProduct({slug:'packed-file-fixture',revision:1,
    shardfile:emptyShardfile({slug:'packed-file-fixture',name:'Packed fixture',author:'Fixture',revision:1,seed:1}),
    sections:new Map([['explore/catalogue',parseExplorerCatalogue({version:1,entries:[{kind:'specimen',id:'packed-card',books:{phone:book,desktop:book},model:'anvil'}]})]]),
    files:new Map(declared.files.flatMap(row=>row.name===undefined?[]:[[row.name,fixtureProductFile(row.name,{hash:row.hash,url:row.hash})]])),
    jsonCheck:fixtureJsonCheck, read:hash=>{const bytes=declared.assets.get(hash);if(bytes===undefined)throw new Error('Missing product bytes');return Promise.resolve(bytes);},check:true});
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No specimen URL fallback'));
  const sky=skyFixture(),registry=new WorldRegistry(),scope=new Scope('packed-adapters'),root=new THREE.Group();
  try{
    const roster=await explorerRoster(product),card=roster[0];if(card===undefined)throw new Error('Missing Explorer card');
    card.list(modelContext(sky),()=>[],registry);
    const listed=registry.get('model:packed-card')?.model;if(listed===undefined)throw new Error('Missing listed specimen');
    const object=listed.object();await Promise.resolve();await Promise.resolve();
    let count=0;object.traverse(child=>{if(child instanceof THREE.Mesh){const geometry:unknown=child.geometry;if(!(geometry instanceof THREE.BufferGeometry))throw new Error('Missing specimen geometry');const position:unknown=geometry.getAttribute('position');if(!(position instanceof THREE.BufferAttribute))throw new Error('Missing specimen position');count+=position.count;geometry.dispose();}});
    expect(count).toBe(3);
    const ctx=legacyDouble<ShardContext>({scope,root,product,system:vi.fn<ShardContext['system']>(),app:legacyDouble<ShardContext['app']>({registry}),
      game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({world:legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>>({sky})})})});
    const host=await SceneDressing.install(ctx,{name:'packed-adapter',catalogues:[{rows:forge.rows,pack:'bank'}],packs:{bank:{rows:forge.packed,materials}},geometry:{},materials:{},layers:[],statics:[],animations:[]});
    expect(root.children).toContain(host.group);expect(SceneDressing.current(ctx)).toBe(host);expect(fetch).not.toHaveBeenCalled();
  }finally{scope.dispose();}
  expect(root.children).toHaveLength(0);
});

// The Explorer calls object() before ready(); listing itself must remain free of IO.
test.each([{placed:false,retired:false},{placed:false,retired:true},{placed:true,retired:false},{placed:true,retired:true}])('deferred specimen awaits sources; placed=$placed retired=$retired',async({placed,retired})=>{
  const owner=new Scope('direct-specimen'),files=new Map<string,Uint8Array>(),reply=deferred<Uint8Array>();
  let reads=0;
  const read=planSpecimenCatalogue({file:()=>{reads++;return reply.promise;},hasFile:()=>true},forge.rows,owner,[forge.packed]);
  const catalogue=defineSpecimenCatalogue<Record<string,object>>(forge.rows,forge.packed,materials,files,async()=>{
    for(const [name,bytes]of await read())files.set(name,bytes);
  });
  const model=catalogue.model('anvil'),ctx=modelContext(skyFixture()),registry=new WorldRegistry();
  try{
    withOwner(owner,()=>{
      if(placed)place(model,[{x:0,y:0,z:0}],{ctx,registry,draw:'instanced',drawnInto:{object:new THREE.Group(),boxes:new Float32Array(6),colliders:[]}});
      else listModel(model,{ctx,registry});
    });
    expect(reads).toBe(0);expect(()=>model.build(ctx,{},new Rng(1))).toThrow('requires preparation');
    const card=registry.get(placed?'fixture/anvil':'model:fixture/anvil')?.model;if(card?.ready===undefined||card.release===undefined)throw new Error('Missing prepared view contract');
    const root=card.object(),placeholder=root.children[0]?.children[0],ready=card.ready();
    expect(reads).toBe(1);expect(placeholder).toBeInstanceOf(THREE.Mesh);
    if(retired)card.release();
    reply.resolve(forge.wire);await ready;
    const positions:number[]=[];root.traverse(node=>{if(node instanceof THREE.Mesh){const geometry:unknown=node.geometry;if(!(geometry instanceof THREE.BufferGeometry))throw new Error('Missing native geometry');const position:unknown=geometry.getAttribute('position');if(!(position instanceof THREE.BufferAttribute))throw new Error('Missing exact positions');for(let i=0;i<position.count;i++)positions.push(position.getX(i),position.getY(i),position.getZ(i));}});
    expect(positions).toEqual(retired?[]:Array.from(new Float32Array(forge.raw.buffer)));
    expect(reads).toBe(1);
    card.release();expect(root.children).toHaveLength(0);
  }finally{owner.dispose();}
});

test.each([false,true])('deferred specimen failure refuses Explorer readiness; placed=%s',async placed=>{
  const owner=new Scope('failed-direct-specimen'),ctx=modelContext(skyFixture()),registry=new WorldRegistry();
  const catalogue=defineSpecimenCatalogue<Record<string,object>>(forge.rows,forge.packed,materials,new Map(),()=>Promise.reject(new Error('Exact source refused')));
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined);
  try{
    withOwner(owner,()=>{const model=catalogue.model('anvil');
      if(placed)place(model,[{x:0,y:0,z:0}],{ctx,registry,draw:'instanced',drawnInto:{object:new THREE.Group(),boxes:new Float32Array(6),colliders:[]}});
      else listModel(model,{ctx,registry});
    });
    const card=registry.get(placed?'fixture/anvil':'model:fixture/anvil')?.model;if(card?.ready===undefined)throw new Error('Missing readiness');
    const root=card.object(),holder=root.children[0],placeholder=holder?.children[0];
    await expect(card.ready()).rejects.toThrow('Exact source refused');
    expect(holder?.children).toEqual([placeholder]);expect(warn).toHaveBeenCalledOnce();
    expect(()=>catalogue.model('anvil').build(ctx,{},new Rng(1))).toThrow('requires preparation');
  }finally{owner.dispose();}
});

// Canonical product JSON may reorder object members without changing parameter values.
test.each([false,true])('packed specimens retain authored keys after product parameter reordering; nested=%s',async nested=>{
  const defaults={r:3,flue:true,palette:0,old:false,base:'lattice',pennant:true,
    ...(nested?{boards:[{text:'Camp',direction:1},{text:'Pass',direction:-1}]}:{})};
  const sorted=Object.fromEntries(Object.entries(defaults).sort(([a],[b])=>a.localeCompare(b)));
  if(nested)Object.assign(sorted,{boards:[{direction:1,text:'Camp'},{direction:-1,text:'Pass'}]});
  const authoredKey=`fixture/anvil ${JSON.stringify(defaults)}`;
  const packed={...forge.packed,rows:[{...forge.packed.rows[0],key:authoredKey},{key:'opaque named shape',parts:[]}]};
  const rows=[{...forge.rows[0],model:{...forge.rows[0]?.model,defaults:sorted}}];
  const files=await prepareSpecimenCatalogue({file:()=>Promise.resolve(forge.wire),hasFile:()=>true},rows,undefined,[packed]);
  const catalogue=defineSpecimenCatalogue<Record<string,object>>(rows,packed,materials,files);
  await catalogue.loadPacked();
  const model=catalogue.model('anvil'),made=model.build(modelContext(skyFixture()),sorted,new Rng(1));
  if(!(made instanceof THREE.Group))throw new Error('Missing parameter-order specimen');
  expect(made.children).toHaveLength(1);
  const mesh=made.children[0];if(!(mesh instanceof THREE.Mesh))throw new Error('Missing parameter-order geometry');
  const shape:unknown=mesh.geometry;if(!(shape instanceof THREE.BufferGeometry))throw new Error('Missing parameter-order shape');
  const position:unknown=shape.getAttribute('position');if(!(position instanceof THREE.BufferAttribute))throw new Error('Missing parameter-order positions');
  expect(position.count).toBe(forge.raw.length/12);
  expect(packed.rows[0]?.key).toBe(authoredKey);
  const parts=createPackedSpecimens(packed,files);await parts.load();
  expect(parts.parts('opaque named shape',modelContext(skyFixture()),materials)).toEqual([]);
  expect(parts.parts(`fixture/anvil ${JSON.stringify({...sorted,palette:1})}`,modelContext(skyFixture()),materials)).toBeNull();
  expect(parts.parts(`other/anvil ${JSON.stringify(sorted)}`,modelContext(skyFixture()),materials)).toBeNull();
  if(nested)expect(parts.parts(`fixture/anvil ${JSON.stringify({...sorted,boards:[{direction:-1,text:'Pass'},{direction:1,text:'Camp'}]})}`,modelContext(skyFixture()),materials)).toBeNull();
});
