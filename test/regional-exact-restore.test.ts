// oxlint-disable-next-line import/no-nodejs-modules -- Real native checkpoint contracts use the shipped Rapier bytes.
import {readFileSync} from 'node:fs';
import {beforeAll,expect,test,vi} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {compileScript} from '@wildshard/sharddev/compileScript';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {createShardfileSim,bindShardfileSim,prepareShardfileSimRestore} from '../src/server/game/plugin/simulation';
import { snapshotSimHost, onSimHostRestored, isSimHostRestoring, serializeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { prepareSimHostRestore, restoreSimHost } from '../src/server/engine/sim/restore';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {ScriptHost} from '../src/shared/engine/script/host';
import {TransferWalls} from '../src/shared/engine/physics/transferWalls';
import {installEntrySockets} from '../src/shared/engine/physics/entrySockets';
import {installGridBorders} from '../src/shared/engine/physics/gridBorders';
import {installStripCollider} from '../src/shared/engine/physics/stripColliders';
import {addBakedTerrainCollider} from '../src/shared/engine/physics/terrainTiles';
import {encodeTerrainTile} from '@wildshard/format/terrainTileBytes';
import {GridRegionDurability} from '../src/server/game/grid/durability';
import {SaveStore} from '../src/shared/engine/saves/store';
import {fnv1a32} from '../src/shared/engine/core/rng';
import * as v from 'valibot';
import {encodeMeshCollision} from '@wildshard/format/meshCollisionBytes';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const rapier=loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
let fixed:Uint8Array=new Uint8Array(),grown:Uint8Array=new Uint8Array();
beforeAll(async()=>{
  const source=(grow:boolean)=>`let counter:i32=0;
export function abi_version():i32{return 0;}
export function init(lo:i32,hi:i32):void{counter=lo;store<i32>(32768,counter);}
export function in_ptr():i32{return 16384;}export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}export function out_cap():i32{return 32;}
export function out_count():i32{return 0;}
export function on_tick():void{${grow?'if(memory.size()==1)memory.grow(1);':''}counter++;store<i32>(32768,counter);}`;
  fixed=await compileScript(source(false),{maximumPages:1});
  grown=await compileScript(source(true),{maximumPages:2});
},30000);
function fixture(bytes=fixed,mesh=false){
  const source=emptyShardfile({slug:'restore-contract',name:'Restore',author:'Test',seed:37,revision:1}),hash=hashImmutableBytes(bytes);
  source.sim.scripts=[hash];source.sim.bindings=[{module:hash,entity:1,actorId:null,kind:'server'}];source.quests.flags=['kept'];
  const assets=new Map([[hash,bytes]]);
  if(mesh){
    const data=encodeMeshCollision({vertices:new Float32Array([0,0,0,62.5,0,0,62.5,0,62.5,0,0,62.5]),indices:new Uint32Array([0,2,1,0,3,2])});
    const file=hashImmutableBytes(data);assets.set(file,data);
    source.entryways=[];source.spawn.x=5;source.spawn.z=5;
    source.meshCollision={version:1,tiles:[{x:4,z:4,file}],panels:[]};source.critical.push(file);
    source.files.push({hash:file,kind:'binary',compressed:data.length,decoded:data.length,gpu:0,triangles:2,draws:0,dependencies:[],critical:true});
  }
  return{source,assets};
}
function platform(host:ReturnType<typeof createShardfileSim>['host']){
  installStripCollider(host.physics,{origin:{x:0,z:0},positions:new Float32Array([-1,0,-1,1,0,-1,0,0,1]),indices:new Uint32Array([0,2,1])},host.scope);
  installEntrySockets(host.physics,host.scope,[{x:0,z:0}],'backstop');installGridBorders(host.physics,host.scope);
  const walls=new TransferWalls(()=>host.physics,[{x:0,z:0}],.35,'exit',host.scope);
  host.onStep('platform.transferWalls',()=>undefined,{snapshot:()=>walls.snapshot(),restore:value=>{walls.restore(value);}});
  return walls;
}

test.each([false,true])('fresh basis and single module installation are identical (mesh=%s)',async mesh=>{
  const f=fixture(fixed,mesh),R=await rapier,original=createShardfileSim(f.source,f.assets,{rapier:R,playerBody:false});
  const install=vi.spyOn(ScriptHost.prototype,'install');
  const target=prepareShardfileSimRestore(f.source,f.assets,{rapier:R,playerBody:false});
  try{
    platform(original.host);platform(target.host);
    expect(install).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(original.host.physics.snapshot(),target.host.physics.snapshot())).toBe(0);
    expect(target.keep()).toBe(target.simulation.host);expect(leadPlayer(target.host).hasMotor).toBe(false);
    expect(()=>target.keep()).toThrow('consumed');expect(()=>onSimHostRestored(target.host,()=>undefined)).toThrow('not restoring');
  }finally{install.mockRestore();original.dispose();target.host.dispose();}
});

test.each([false,true])('exact restore installs once and preserves complete state and subsequent replay (grown=%s)',async grow=>{
  const f=fixture(grow?grown:fixed),R=await rapier,original=createShardfileSim(f.source,f.assets,{rapier:R});
  for(let tick=0;tick<8;tick++)original.host.step(leadCommands(original.host, {moveX:.25,moveZ:0,yaw:.4}));
  original.host.flags.set('kept');const saved=snapshotSimHost(original.host),install=vi.spyOn(ScriptHost.prototype,'install');
  const target=prepareShardfileSimRestore(f.source,f.assets,{rapier:R}),lane=target.simulation.lane;
  try{
    if(lane===undefined)throw new Error('Missing installed lane');
    const scriptHost=lane.host,checkpoint=lane.host.checkpoint();
    expect(install).toHaveBeenCalledTimes(1);
    let checks=0;onSimHostRestored(target.host,()=>{expect(isSimHostRestoring(target.host)).toBe(true);checks++;});
    expect(target.restore(saved)).toBe(target.host);expect(checks).toBe(1);
    expect(target.simulation.lane?.host).toBe(scriptHost);expect(install).toHaveBeenCalledTimes(1);
    expect(serializeSimSnapshot(snapshotSimHost(target.host))).toBe(serializeSimSnapshot(saved));
    expect(lane.host.checkpoint().modules[0]?.memory.length).toBe(grow?131072:65536);
    expect(checkpoint.modules[0]?.memory.length).toBe(65536);
    for(let tick=0;tick<6;tick++){const command={moveX:0,moveZ:.25,yaw:1};original.host.step(leadCommands(original.host, command));target.host.step(leadCommands(target.host, command));}
    expect(serializeSimSnapshot(snapshotSimHost(target.host))).toBe(serializeSimSnapshot(snapshotSimHost(original.host)));
    expect(()=>target.restore(saved)).toThrow('consumed');
  }finally{install.mockRestore();target.host.dispose();original.dispose();}
});

test('bodyless regional target restores saved native walls and motor before detaching the temporary player',async()=>{
  const f=fixture(fixed,true),R=await rapier,original=createShardfileSim(f.source,f.assets,{rapier:R}),walls=platform(original.host);
  const saved=snapshotSimHost(original.host),target=prepareShardfileSimRestore(f.source,f.assets,{rapier:R,playerBody:false}),restoredWalls=platform(target.host);
  const constructorPhysics=target.host.physics,free=vi.spyOn(constructorPhysics,'dispose');
  try{
    target.restore(saved);expect(leadPlayer(target.host).hasMotor).toBe(true);restoredWalls.sync();
    expect(restoredWalls.snapshot()).toEqual(walls.snapshot());expect(target.host.playerMotorOptions(leadPlayer(target.host))).toEqual(leadPlayer(original.host).motor.opts);
    expect(serializeSimSnapshot(snapshotSimHost(target.host))).toBe(serializeSimSnapshot(saved));
    expect(target.simulation.colliders.get('mesh.tile.4.4')?.active()).toBe(true);
    expect(free).toHaveBeenCalledTimes(1);leadPlayer(target.host).detachMotor();expect(leadPlayer(target.host).hasMotor).toBe(false);
    expect(()=>target.host.dispose()).not.toThrow();expect(free).toHaveBeenCalledTimes(1);
  }finally{free.mockRestore();target.host.dispose();original.dispose();}
});

test.each(['metadata','registration','duplicate','mesh','final-check']as const)('failed %s restore disposes unpublished target and preserves save',async failure=>{
  const f=fixture(fixed,true),R=await rapier,original=createShardfileSim(f.source,f.assets,{rapier:R}),saved=snapshotSimHost(original.host);
  const target=prepareShardfileSimRestore(f.source,f.assets,{rapier:R}),bad=structuredClone(saved),before=serializeSimSnapshot(saved);
  if(failure==='metadata')bad.levelFingerprint^=1;
  if(failure==='registration')bad.adapters.push({id:'missing',state:null});
  if(failure==='duplicate'){const adapter=bad.adapters[0];if(adapter===undefined)throw new Error('Missing adapter');bad.adapters.push(structuredClone(adapter));}
  if(failure==='mesh'){
    const props=bad.adapters.find(row=>row.id==='props.declared');if(props===undefined)throw new Error('Missing mesh adapter');
    props.state={'mesh.tile.4.4':{handles:[123456789]}};
  }
  if(failure==='final-check')onSimHostRestored(target.host,()=>{throw new Error('late native refusal');});
  try{
    expect(()=>target.restore(bad)).toThrow();expect(target.host.scope.disposed).toBe(true);
    expect(isSimHostRestoring(target.host)).toBe(false);expect(serializeSimSnapshot(saved)).toBe(before);
    expect(()=>target.restore(saved)).toThrow('consumed');
  }finally{target.host.dispose();original.dispose();}
});

test('stepped, disposed and already-kept targets cannot restore; borrowed worlds refuse before allocation',async()=>{
  const R=await rapier,stepped=prepareSimHostRestore(SIM_LEVEL,{rapier:R}),disposed=prepareSimHostRestore(SIM_LEVEL,{rapier:R});
  try{
    const saved=snapshotSimHost(stepped.host);stepped.host.step();
    expect(()=>stepped.restore(saved)).toThrow('no longer fresh');expect(stepped.host.scope.disposed).toBe(true);
    disposed.host.dispose();expect(()=>disposed.restore(saved)).toThrow('disposed');
    expect(()=>prepareSimHostRestore(SIM_LEVEL,{rapier:R,physics:disposed.host.physics})).toThrow('own its world');
  }finally{stepped.host.dispose();disposed.host.dispose();}
});


test('retained terrain scope cannot touch the freed constructor world after replacement',async()=>{
  const R=await rapier,target=prepareSimHostRestore(SIM_LEVEL,{rapier:R,ground:false});
  const terrain=encodeTerrainTile({resolution:2,x:-16,z:-16,size:32,heights:new Float32Array(4)});
  addBakedTerrainCollider(target.host.physics,terrain,target.host.scope);
  const saved=snapshotSimHost(target.host),oldWorld=target.host.physics,remove=vi.spyOn(oldWorld.world,'removeCollider');
  try{
    target.restore(saved);const calls=remove.mock.calls.length;
    expect(()=>target.host.dispose()).not.toThrow();expect(remove).toHaveBeenCalledTimes(calls);
  }finally{remove.mockRestore();target.host.dispose();}
});

function memoryStorage(){
  const rows=new Map<string,string>();
  return{rows,get length(){return rows.size;},key:(index:number)=>[...rows.keys()][index]??null,
    getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);},clear:()=>{rows.clear();}};
}
function changeRegion(storage:ReturnType<typeof memoryStorage>,edit:(data:Record<string,unknown>)=>void){
  const pair=[...storage.rows].find(([,text])=>text.includes('platform.region'));if(pair===undefined)throw new Error('Missing saved region');
  const record=v.record(v.string(),v.unknown()),document=v.parse(record,JSON.parse(pair[1])),keys=v.parse(record,document['keys']);
  const slot=v.parse(record,keys['platform.region']),data=v.parse(record,slot['data']);edit(data);
  slot['data']=data;keys['platform.region']=slot;document['keys']=keys;storage.setItem(pair[0],JSON.stringify(document));
}
function reseal(data:Record<string,unknown>):void{
  data['integrity']=fnv1a32(JSON.stringify({revision:data['revision'],snapshot:data['snapshot'],logical:data['logical'],mode:data['mode']}));
}

test.each(['exact','revision','sealed-basis','unsealed-basis','future','corrupt']as const)('durable %s branch retains its original exact/logical/refusal contract',async mode=>{
  const f=fixture(),R=await rapier,storage=memoryStorage(),identity={id:'region-one',shard:f.source.identity.slug};
  // Portable logical continuation has no scene lane; this is the existing admitted migration boundary.
  f.source.sim.scripts=[];f.source.sim.bindings=[];
  const store=()=>new SaveStore({local:storage,session:null}),owner=new GridRegionDurability(store(),identity,f.source,[]);
  const original=createShardfileSim(f.source,f.assets,{rapier:R,quest:owner.quest});platform(original.host);
  const basis=original.host.physics.snapshot();owner.setPhysicsBasis(basis);owner.bind(original.host,original.colliders);
  original.host.flags.set('kept');original.host.step();expect(owner.checkpoint(snapshotSimHost(original.host))).toBe(true);original.dispose();
  if(mode==='unsealed-basis')changeRegion(storage,data=>{delete data['integrity'];});
  if(mode==='future')changeRegion(storage,data=>{data['revision']=f.source.identity.revision+1;reseal(data);});
  if(mode==='corrupt')changeRegion(storage,data=>{data['snapshot']='broken';reseal(data);});
  const source=mode==='revision'?{...f.source,identity:{...f.source.identity,revision:2}}:f.source;
  const reopened=new GridRegionDurability(store(),identity,source,[]),target=prepareShardfileSimRestore(source,f.assets,{rapier:R,quest:reopened.quest});platform(target.host);
  const freshBasis=target.host.physics.snapshot();
  expect(Buffer.compare(freshBasis,basis)).toBe(0);
  if(mode==='sealed-basis'||mode==='unsealed-basis')freshBasis[0]=(freshBasis[0]??0)^1;
  reopened.setPhysicsBasis(freshBasis);const before=new Map(storage.rows);
  try{
    if(mode==='unsealed-basis'||mode==='future'||mode==='corrupt'){
      expect(()=>reopened.read(true)).toThrow();
    }else{
      const prior=reopened.read(true);reopened.bind(target.host,target.simulation.colliders);
      if(mode==='exact'){expect(prior).toBeDefined();if(prior===undefined)throw new Error('Missing exact continuation');target.restore(prior);}
      else{expect(prior).toBeUndefined();target.keep();expect(reopened.restoreLogical(target.simulation)).toBe(true);}
      expect(target.host.flags.has('kept')).toBe(true);expect(target.host.state.tick).toBe(1);
      target.host.step();expect(target.host.state.tick).toBe(2);
    }
    expect(storage.rows).toEqual(before);
  }finally{reopened.unbind();target.host.dispose();}
});


test('the existing installer-based restore retains staged mesh validation and exact bytes',async()=>{
  const f=fixture(fixed,true),R=await rapier,first=createShardfileSim(f.source,f.assets,{rapier:R});
  first.host.step();const saved=snapshotSimHost(first.host);
  let installed:ReturnType<typeof createShardfileSim>|undefined;
  try{
    const restored=restoreSimHost(first.host.level,{rapier:R},saved,host=>{installed=bindShardfileSim(host,f.source,f.assets,{rapier:R,restoring:true});});
    expect(snapshotSimHost(restored)).toEqual(saved);expect(installed?.colliders.get('mesh.tile.4.4')?.active()).toBe(true);
  }finally{installed?.dispose();first.dispose();}
});
