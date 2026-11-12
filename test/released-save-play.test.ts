// EG-31: actual durable saves made by tagged v0.1.1, resumed by this engine.
// Assert continuation and movement, never the private serialized field shape.
// oxlint-disable-next-line import/no-nodejs-modules -- Read immutable release fixtures and pinned physics.
import {readFileSync,readdirSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Check immutable public fixture bytes against their pin.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Large public fixture pins are prepared before tests, outside git blobs.
import {homedir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the normal immutable pin cache.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep real released saves small without changing their bytes.
import {brotliDecompressSync} from 'node:zlib';
import {expect,test} from 'vitest';
import {HeadlessSimulation} from '../src/server/host/headless';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime';
import {loadHeadlessProduct} from '../src/server/host/headlessProduct';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {decodeSimSnapshot,leadSnapshot} from '../src/shared/engine/sim/snapshot';
import {leadPlayer} from '../src/shared/engine/sim/leadPlayer';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';
import {builtProduct,runtimeAssets} from './fixtures/engine-lift/product';
import {SaveStore,type SaveStorage,type SchemaFailure} from '../src/shared/engine/saves/store';
import {admitDoc} from '../src/server/host/dedicated/playerDoc';
import {definitions} from './fixtures/saveDefinitions';

// `shardfile` is where the save was made; `pin`, when present, is the later shard pin it is proven to resume on (D5-4).
// `refused`, instead, is a later pin whose level changed: the world snapshot is refused whole, by its level fingerprint, and the
// standalone grid opens a fresh world and carries the player's progress (cellWorld `adopt`). The fixture proves the refusal is
// that clean one and stays as provenance; moving the pin again makes a lane decide afresh (ENG-17, Mossgate v3).
interface ReleasedSave {release:string;saveEpoch:number;slug:string;shardfile:string;pin?:string;refused?:string;tick:number;position:[number,number,number];file:string;sha256:string;bytes:number;remote?:boolean}
const fixtures=readdirSync('test/pins/saves').filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(`test/pins/saves/${name}`,'utf8')) as ReleasedSave);
const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')) as {shards:{slug:string;hash:string}[]};
const epoch=JSON.parse(readFileSync('save-epoch.json','utf8')) as {saveEpoch:number};
for(const fixture of fixtures)test(`released ${fixture.slug} save ${fixture.refused===undefined?'resumes in place and keeps walking':'is refused whole on its changed level'}`,async()=>{
  const {slug}=fixture;
  expect(fixture.refused??fixture.pin??fixture.shardfile).toBe(pins.shards.find(row=>row.slug===slug)?.hash);
  expect(fixture.saveEpoch).toBe(epoch.saveEpoch);
  const bytes=readFileSync(fixture.remote===true?join(process.env['WILDSHARD_PIN_CACHE']??join(homedir(),'.cache/wildshard/pins'),fixture.file):`test/pins/saves/${fixture.file}`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
  const saved=brotliDecompressSync(bytes).toString('utf8');
  const directory=builtProduct(slug==='template'?'_template':slug),product=await loadHeadlessProduct(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);if(descriptor===undefined)throw new Error('No admitted product');
  const declared=shard.runtime===null&&!product.has('sim/runtime-plan');
  const distance=(x:number,z:number):number=>Math.hypot(x-fixture.position[0],z-fixture.position[2]);
  const walk:HeadlessCommand={kind:'player',moveX:.2,moveZ:-1,yaw:0};
  if(fixture.refused!==undefined) {
    const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,readFileSync(`${directory}/${file.path}`)]));
    const resume=declared?HeadlessSimulation.create(shard,assets,saved,{deadline:'advisory'}).then(sim=>sim.dispose())
      :Promise.resolve().then(async()=>{(await createTrustedHeadlessResident({shard,product,assets:runtimeAssets(product,directory),rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},saved)).dispose();});
    await expect(resume).rejects.toThrow('Incompatible simulation snapshot');
    return;
  }
  if(declared) {
    const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,readFileSync(`${directory}/${file.path}`)]));
    const sim=await HeadlessSimulation.create(shard,assets,saved,{deadline:'advisory'});
    try {
      let result=await sim.step([{source:'released-save',commands:[{kind:'player',moveX:0,moveZ:0,yaw:0}]}]);
      const first=leadSnapshot(decodeSimSnapshot(result.snapshot)).position;
      expect(result.tick).toBe(fixture.tick+1);expect(distance(first[0]??Infinity,first[2]??Infinity)).toBeLessThan(.5);
      for(let tick=0;tick<12;tick++)result=await sim.step([{source:'released-save',commands:[walk]}]);
      const last=leadSnapshot(decodeSimSnapshot(result.snapshot)).position;
      expect(result.tick).toBe(fixture.tick+13);expect(distance(last[0]??Infinity,last[2]??Infinity)).toBeGreaterThan(.25);
    } finally {await sim.dispose();}
  } else {
    const live=await createTrustedHeadlessResident({shard,product,assets:runtimeAssets(product,directory),rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},saved);
    try {
      const player=leadPlayer(live.host);expect(distance(player.position.x,player.position.z)).toBeLessThan(.001);
      expect(live.host.state.tick).toBe(fixture.tick);
      for(let tick=0;tick<12;tick++)live.step([walk]);
      expect(live.host.state.tick).toBe(fixture.tick+12);expect(distance(player.position.x,player.position.z)).toBeGreaterThan(.25);
    } finally {live.dispose();}
  }
},10_000);

// WIRE-STABILITY WR7: released whole save documents, every local key's document and a server PlayerDoc, load with no `.corrupt`
// key and no schema report. The epoch check above makes the epoch-2 cut (WR8) recapture them: test/save-whole-documents.test.ts.
interface DocumentPin {release:string;saveEpoch:number;shard:string;docs:Record<string,unknown>;player:{saveVersion:number;doc:unknown}}
const documentPins=readdirSync('test/pins/saves/documents').filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(`test/pins/saves/documents/${name}`,'utf8')) as DocumentPin);
for(const pin of documentPins)test(`released ${pin.release} whole save documents load with no .corrupt key`,()=>{
  expect(pin.saveEpoch).toBe(epoch.saveEpoch);
  const values=new Map<string,string>(),local:SaveStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:name=>values.get(name)??null,setItem:(name,value)=>{values.set(name,value);},removeItem:name=>{values.delete(name);}};
  const failures:SchemaFailure[]=[],store=new SaveStore({local,session:local,report:failure=>{failures.push(failure);}}),defs=[...definitions().values()];
  const probe=defs.find(definition=>definition.scope==='global');if(probe===undefined)throw new Error('No global key');
  store.define(probe).write(probe.initial());const prefix=([...values.keys()][0]??'').slice(0,-'global'.length);values.clear();
  for(const [scope,doc] of Object.entries(pin.docs))values.set(prefix+scope,JSON.stringify(doc));
  let pinned=0;
  for(const definition of defs){
    const namespace=definition.scope==='shard'?pin.shard:undefined,slot=store.define(definition),status=slot.status?.(namespace);
    const doc=pin.docs[namespace??definition.scope] as {keys?:Record<string,unknown>}|undefined;
    // Every entry the pin holds is valid; a key the pin never wrote reads as absent.
    if(doc?.keys?.[definition.key]!==undefined){pinned++;expect(status,`${definition.scope}/${definition.key}`).toBe('valid');}
    else expect(status,`${definition.scope}/${definition.key}`).toBe('absent');
    slot.read(namespace);
  }
  expect(pinned).toBe(Object.values(pin.docs).reduce<number>((sum,doc)=>sum+Object.keys((doc as {keys:object}).keys).length,0));
  expect([...values.keys()].filter(name=>name.includes('.corrupt.'))).toEqual([]);
  for(const raw of values.values())expect(Object.keys((JSON.parse(raw) as {keys:object}).keys).filter(key=>key.includes('.corrupt.'))).toEqual([]);
  expect(failures).toEqual([]);
  expect(admitDoc(pin.player.doc,pin.player.saveVersion,pin.shard)).not.toBeNull();
});
