import {expect,test,vi} from 'vitest';
import {SkinnedMesh} from 'three';
import {charge,chargeModule,chargeModuleSize} from './fixtures/nalati-charge';
import {SpawnScript,readSpawnScript} from '../src/server/game/population/spawnScript';
import {Scope} from '../src/shared/engine/app/scope';
import type {AnimalManager} from '../src/server/engine/entities/AnimalManager';
import type {Animal} from '../src/client/engine/entities/AnimalView';
import {CharacterMotor} from '../src/shared/engine/physics/CharacterMotor';
import {createSimHost} from '../src/server/engine/sim';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import {fixtureBytes} from '@wildshard/engine/test/nativeBytes';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {sha256} from '../src/shared/game/plugin/moduleHash';
import {emptyShardfile} from '../src/shared/host/author';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import {parseShardfile} from '@wildshard/format/shardSchema';
import {resolveOutputDescriptor,carryOutputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import {shardProductData} from '../src/shared/game/shardfile/productData';

const hash=sha256(chargeModule);
const inline={...charge,bytes:btoa(String.fromCodePoint(...chargeModule))};
async function product() {
  const source=emptyShardfile({slug:'charge-fixture',name:'Charge',author:'Fixture',revision:1,seed:1}),wires=new Map<string,Uint8Array>();
  const file={hash,kind:'wasm' as const,compressed:chargeModule.length,decoded:chargeModule.length,gpu:0,triangles:0,draws:0,dependencies:[],critical:true};
  source.files.push(file);source.critical.push(hash);
  const sections=[...outputSectionPayloads(source),['actors/spawn-scripts',[charge]] as const].map(([name,value])=>{
    const bytes=new TextEncoder().encode(JSON.stringify(value)),path=`sections/${name}.json`;wires.set(path,bytes);
    return {name,path,schema:`wildshard:${name}@1`,hash:sha256(bytes),bytes:bytes.length};
  });
  const index=parseOutputIndex({format:'wildshard.shardfile',formatVersion:2,sdk:'0.2',version:source.version,identity:source.identity,
    build:{sourceHash:sha256(new TextEncoder().encode(JSON.stringify(source))),validator:'test'},requires:source.requires,
    admission:{budgets:source.budgets,serverBudget:source.serverBudget,authorCaps:source.authorCaps,critical:source.critical,library:source.library},
    sections,schemas:[],files:[{...file,path:charge.script.module,name:'behaviour/charge.wasm'}],runtime:null});
  const assembled=await resolveOutputDescriptor(index,{offline:false,hash:bytes=>Promise.resolve(sha256(bytes)),read:path=>{
    const bytes=wires.get(path);if(bytes===undefined)throw new Error('Missing fixture section');return Promise.resolve(bytes);
  }});
  const parsed=parseShardfile(assembled);carryOutputDescriptor(assembled,parsed);
  return shardProductData(parsed,'https://charge.test/',()=>Promise.resolve(chargeModule));
}
test('the named spawn module stays raw in the original asset map and default readers retain inline bytes',async()=>{
  expect(chargeModule.byteLength).toBe(chargeModuleSize);
  const source=await product(),assets=new Map<string,Uint8Array>(),sentinel=new Uint8Array([7]);assets.set('other',sentinel);
  const raw=await readSpawnScript(source,charge.step,assets);
  expect(raw).toEqual(charge);expect(raw.bytes).toBe('');expect(assets.get(hash)).toBe(chargeModule);expect(assets.get('other')).toBe(sentinel);
  expect(await readSpawnScript(source,charge.step)).toEqual(inline);
});
test('raw scope, hash and mixed-input refusals precede programme instantiation',()=>{
  const scope=new Scope('charge.raw'),animals=legacyDouble<AnimalManager>({animals:[]}),instantiate=vi.spyOn(WebAssembly,'instantiate');
  try{
    expect(()=>SpawnScript.page(animals,charge,undefined,{scope,module:new Uint8Array([1])})).toThrow('Invalid raw spawn');
    expect(()=>SpawnScript.page(animals,inline,undefined,{scope,module:chargeModule})).toThrow('Invalid raw spawn');
    scope.disposeSteps().next();expect(()=>SpawnScript.page(animals,charge,undefined,{scope,module:chargeModule})).toThrow('Retired');
    expect(instantiate).not.toHaveBeenCalled();
  }finally{instantiate.mockRestore();scope.dispose();}
});
test('raw and inline captain execution retain original body, staged effects and byte-exact continuation',async()=>{
  const rapier=await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const sample=SIM_LEVEL.entities[0];if(sample===undefined)throw new Error('Missing body');
  const hosts=[false,true].map(raw=>{
    const host=createSimHost({...SIM_LEVEL,quests:[],entities:[{...sample,spec:{...sample.spec,kind:'ghost-rider',variant:'captain'}}]},{rapier}),actor=host.entities.get(sample.id);
    if(actor===undefined)throw new Error('Missing actual actor');
    const motor=actor.motor;if(motor!==null&&!(motor instanceof CharacterMotor))throw new Error('Expected original native motor');
    const body=legacyDouble<Animal>(Object.assign(actor,{motor,mesh:new SkinnedMesh()})),animals=legacyDouble<AnimalManager>({animals:[body]});
    const runner=SpawnScript.page(animals,raw?charge:inline,host.physics,raw?{scope:host.scope,module:chargeModule}:undefined);
    runner.adopt('main',body.entityId);return {host,body,runner};
  });
  const old=hosts[0],raw=hosts[1];if(old===undefined||raw===undefined)throw new Error('Missing comparison');
  try{
    for(let tick=0;tick<360;tick++){
      for(const f of hosts){f.runner.frame({x:20,y:0,z:20},0,{engaged:1,leashing:tick>300?1:0,phase2:1,clock:tick/60});f.runner.advanceFrame(1/60);}
      expect(raw.runner.snapshot()).toBe(old.runner.snapshot());expect(raw.runner.drainEffects()).toEqual(old.runner.drainEffects());
      expect(raw.body.position).toEqual(old.body.position);expect(raw.body.yaw).toBe(old.body.yaw);expect(raw.body.speed).toBe(old.body.speed);
    }
    expect(raw.runner.failure).toBeNull();expect(raw.runner.body('main')).toBe(raw.body);expect(raw.host.rng.snapshot()).toEqual(old.host.rng.snapshot());
    const saved=old.runner.snapshot();raw.runner.restore(saved);expect(raw.runner.snapshot()).toBe(saved);
    raw.host.scope.disposeSteps().next();expect(()=>raw.runner.advanceFrame(1/60)).toThrow('Retired');
  }finally{for(const f of hosts)f.host.dispose();}
});
