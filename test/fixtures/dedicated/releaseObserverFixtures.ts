import {nativeObserverClient} from './nativeObserverClient';
import assert from 'node:assert/strict';
import {afterAll,afterEach,beforeAll,vi} from 'vitest';
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {PreparedObserver} from './releaseObserver';
import {observationInputs} from '../../../src/scripts/mmo-release-observer-inputs.mjs';
import {folderInput,roomBench,serverInput} from './roomBench';
import {GAMEPLAY_SLICE} from '../gameplaySlice';
import {ReleaseWatch} from '../../../src/server/host/dedicated/releaseFile';
import {openPglite} from '../pgliteDatabase';
import {migrate} from '../../../src/server/host/dedicated/saves/migrate';
import {PlayerStore} from '../../../src/server/host/dedicated/playerStore';
import {RoomBot} from './roomBot';
import {playerSavesOver,memoryPlayerSaves} from '../../../src/server/host/dedicated/playerSaves';
import {cellShard} from '../../../src/server/host/dedicated/gridCells';
import {catalogueDocument} from '../../../src/shared/game/grid/catalogueDocument';
import {installCatalogue} from '../../../src/shared/game/grid/catalogueSlot';

export const sourceBuild=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();

export function releaseObserverFixtures(){
 let connect:PreparedObserver['connect'],prepared:PreparedObserver;
 const catalogue=catalogueDocument();
 // J434 retired the Template product: the native durable control reads its frozen gameplay slice (TEMPLATE-E2E TR-5).
 const load=(slug:string)=>slug==='template'?folderInput(GAMEPLAY_SLICE):serverInput(slug);
 beforeAll(async()=>{
  // Keep the durable control on the Template's native world, with an actual instance/slug alias.
  const template=<T extends {instance:string;slug:string}>(row:T):T=>row.instance==='blender-template'?{...row,slug:'template'}:row;
  installCatalogue({...catalogue,placements:catalogue.placements.map(template),grid:{...catalogue.grid,cells:catalogue.grid.cells.map(template)}});
  prepared=await nativeObserverClient();connect=prepared.connect;
 });
 afterAll(async()=>{installCatalogue(catalogue);await prepared?.dispose?.();});

 const closers:(()=>Promise<void>)[]=[];
 afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});
 async function fixture(durable=false,loseProgress=false,shard=durable?'blender-template':'driftwood-isle',changeProgress=false,staleCheckpoint=false,seedProgress=true){
  const saveShard=cellShard(shard);
  let restart:()=>void=()=>{throw Error('No promotion installed');};
  const database=durable?await openPglite():null;
  if(database!==null){closers.push(database.close);await migrate(database);}
  const saves=database===null?memoryPlayerSaves():playerSavesOver(database,0,()=>{});
  if(durable&&seedProgress){
   const seed=await roomBench({saves,cells:[shard],load});
   const bots=['device:observer-probe-0','device:observer-probe-1'].map((device,index)=>new RoomBot(seed.url,'bench',device,`seed-${index}`));
   try{
    for(const [index,bot] of bots.entries()){
     assert.equal(await bot.arrived(),true);const room=seed.room(shard),body=room?.bodyOf(`device:observer-probe-${index}`);
     if(room===undefined||body===undefined)throw Error('Missing seed native body');
     room.cell.owned.of(body.id).file({grant:'coins',name:'coins',amount:17+index});
    }
    // Let the actual initial quest state settle before naming the unchanged-progress control.
    await vi.waitFor(()=>{assert.ok(bots.every(bot=>(bot.client.latest?.tick??0)>80));},{timeout:5000});
    assert.equal(await seed.world.drain(),true);
   }finally{for(const bot of bots)bot.drop();await seed.close();}
  }

  const first=await roomBench({build:sourceBuild,saves,cells:[shard],load,workers:1,graceMs:80,restart:()=>{restart();}});
  let current=first,serial=1,firstClosed=false;
  closers.push(async()=>{if(!firstClosed)await first.close();if(current!==first)await current.close();});
  const keys=generateKeyPairSync('ed25519'),bytes=Buffer.from('signed observation fixture artifact');
  const release={channel:'staging' as const,serial:1,saveEpoch:1,engineBuild:sourceBuild,shards:[{slug:shard,revision:1}],
   socket:first.url,bundle:{name:'v0.1.0/server.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')}};
  const state={signature:null as string|null,healthSerial:null as number|null,healthBuild:null as string|null,hang:false,requested:null as (()=>void)|null};
  const server=createServer((request,response)=>{
   if(state.hang){state.requested?.();return;}
   if(request.url==='/release.json'){
    const body=JSON.stringify(release);response.end(JSON.stringify({body,signature:state.signature??sign(null,Buffer.from(body),keys.privateKey).toString('hex')}));return;
   }
   if(request.url==='/health'){response.end(JSON.stringify({...current.world.health(),build:state.healthBuild??current.world.health().build,serial:state.healthSerial??serial}));return;}
   if(request.url==='/v0.1.0/server.tar.gz'){response.end(bytes);return;}
   response.writeHead(404).end();
  });
  closers.push(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>{server.close(error=>{if(error)reject(error);else resolve();});});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(address===null||typeof address==='string')throw Error('No fixture port');
  const origin=`http://127.0.0.1:${address.port}`;
  release.socket=`ws://127.0.0.1:${address.port}/`;
  server.on('upgrade',(request,socket,head)=>{current.world.upgrade(request,socket,head);});
  const inputs=observationInputs({publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('hex'),
   releaseUrl:origin+'/release.json',healthUrl:origin+'/health',bundleOrigin:origin,timeoutMs:2000});
  let disposed=false,connections=0,closed=0;let baselineReady:()=>void=()=>{};
  const playing=new Promise<void>(resolve=>{baselineReady=resolve;});
  const options={read:(signal:AbortSignal)=>inputs.read(signal),prepare:async()=>({sourceBuild,connect:(...args:Parameters<PreparedObserver['connect']>)=>{
   connections++;const bot=connect(...args);return {...bot,close:()=>{closed++;bot.close();}};
  },dispose:async()=>{disposed=true;}}),devices:['device:observer-probe-0','device:observer-probe-1'] as const,durationMs:20000,pollMs:20,
  event:(phase:string)=>{if(phase==='baseline-playing')baselineReady();}};
  let done:()=>void=()=>{},failed:(error:unknown)=>void=()=>{};
  const advanced=new Promise<void>((resolve,reject)=>{done=resolve;failed=reject;});
  restart=()=>{void (async()=>{
   assert.equal(await first.world.drain(),true);await first.close();firstClosed=true;
   if(staleCheckpoint&&database!==null)await database.query('update player_save set seq = 1');
   if(loseProgress&&database!==null){
    const saved=await saves.read('device:observer-probe-0',saveShard);
    if(saved.doc===null)throw Error('Missing durable loss control');
    const store=new PlayerStore(saved.doc.store,()=>{});store.slots.purse.write(0,saveShard);
    await database.query('update player_save set doc = $1 where player_id = $2 and epoch = 0 and shard = $3',
     [JSON.stringify({...saved.doc,store:store.documents()}),'device:observer-probe-0',saveShard]);
   }
   current=await roomBench({build:'b'.repeat(40),saves,cells:[shard],load,workers:1});serial=2;
  })().then(done,failed);};
  const watcher=new ReleaseWatch({serving:{...release},everyMs:3600000,
   read:async()=>(await inputs.read()).release,failed:error=>{throw error;},
   changed:async next=>{first.world.beginGrace(next.engineBuild);}});
  closers.push(()=>{watcher.dispose();return Promise.resolve();});
  return {release,state,options,playing,announceWithoutRestart(){Object.assign(release,{serial:2,engineBuild:'b'.repeat(40)});state.healthSerial=2;state.healthBuild='b'.repeat(40);},counts:()=>({disposed,connections,closed}),
   async advance(){
    // The signed watch starts the real grace; its expiry drains and boots a new native World.
    if(changeProgress){
     const room=first.room(shard),body=room?.bodyOf('device:observer-probe-0');
     if(!room||!body)throw Error('Missing progress control body');
     room.cell.owned.of(body.id).file({grant:'coins',name:'coins',amount:1});
    }
    Object.assign(release,{serial:2,engineBuild:'b'.repeat(40)});
    await watcher.look();
    await advanced;
   }};
 }
 return fixture;
}
