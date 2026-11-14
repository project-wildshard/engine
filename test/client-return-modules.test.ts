// @vitest-environment happy-dom
import {weatherRaw,weatherWitness,weatherModuleBytes,nightParameters} from './fixtures/weatherInlineWitness';
import {parseReturnProjectionV2} from '@wildshard/format/returnProjectionV2';
import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {prepareClientReturnModules} from '../src/client/game/shardfile/clientReturnModules';
import {clientNativeBook} from '../src/client/game/shardfile/clientNativeBook';
import * as descriptors from '../src/shared/game/shardfile/outputDescriptor';
import type {OutputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {emptyShardfile} from '../src/shared/host/author';
import type {ShardContext} from '../src/client/game/plugin/context';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {titanPrograms as programs} from './fixtures/titanInlineWitness';

test('page preparation lends the same verified book to sibling construction and actual level scopes',async()=>{
  const root=new Scope('page'),scope=root.child('construction'),level=root.child('entered');
  const row=structuredClone(programs.attack),artifact=parseReturnProjectionV2(row.v2).artifact;
  const bytes=Uint8Array.from(atob(row.v2.bytes),value=>value.codePointAt(0)??0);row.v2.bytes='';
  const witness=Uint8Array.from(atob(row.bytes),value=>value.codePointAt(0)??0),witnessHash=row.script.module.slice('blobs/wasm/'.length,-'.wasm'.length);row.bytes='';
  const name='behaviour/fixture.wasm',witnessName='behaviour/fixture-witness.bin';
  const returns=[{id:'fixture.projection',module:`blobs/wasm/${artifact.hash}.wasm`,side:'sim' as const,abi:2 as const,lane:'project' as const,
    pages:artifact.pages,ioBytes:artifact.ioBytes,compilerRevision:artifact.compilerRevision,admissionRevision:artifact.admissionRevision}];
  const source=emptyShardfile({slug:'fixture-place',name:'Place',author:'Fixture',revision:1,seed:7});
  const read=vi.fn((hash:string)=>Promise.resolve(hash===artifact.hash?bytes:witness));
  const product=createShardProduct({slug:'fixture-place',revision:1,shardfile:source,
    sections:new Map([['actors/return-scripts',returns]]),files:new Map([[name,{hash:artifact.hash,url:'fixture.wasm'}],[witnessName,{hash:witnessHash,url:'witness.bin'}]]),read});
  const ctx=legacyDouble<ShardContext>({scope,product,game:legacyDouble<ShardContext['game']>({
    runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({world:legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>>({
      game:legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['game']>({levelScope:level})})})})});
  const descriptor=vi.spyOn(descriptors,'outputDescriptor').mockReturnValue(legacyDouble<OutputDescriptor>({
    index:legacyDouble<OutputDescriptor['index']>({files:[legacyDouble<OutputDescriptor['index']['files'][number]>({kind:'wasm',hash:artifact.hash,name,dependencies:[witnessHash]}),legacyDouble<OutputDescriptor['index']['files'][number]>({kind:'bin',hash:witnessHash,name:witnessName,dependencies:[]})]})}));
  const lend=vi.spyOn(ReturnProgram,'lendModules');
  try{
    await prepareClientReturnModules(ctx);await prepareClientReturnModules(ctx);
    const assets=clientNativeBook(ctx).decisionAssets;
    expect(assets.get(artifact.hash)).toBe(bytes);expect(assets.get(witnessHash)).toBe(witness);expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.map(call=>call[0])).toEqual([artifact.hash,witnessHash]);
    expect(lend).toHaveBeenCalledWith(scope,assets,returns);expect(lend).toHaveBeenCalledWith(level,assets,returns);
    expect(ReturnProgram.page(row,level).project('bossClamp',{fullHp:100,share:.3})).toEqual({hp:30});
    expect(ReturnProgram.page(row,scope).project('bossClamp',{fullHp:100,share:.3})).toEqual({hp:30});
  }finally{lend.mockRestore();descriptor.mockRestore();root.dispose();}
});

test('preparation reads ABI1 named modules into the original map',async()=>{
  const scope=new Scope('weather.preparation'),assets=new Map<string,Uint8Array>();
  const hash=weatherRaw.script.module.slice('blobs/wasm/'.length,-'.wasm'.length),name='behaviour/nalati.weather.wasm';
  const source=emptyShardfile({slug:'weather-place',name:'Weather',author:'Fixture',revision:1,seed:7});
  const read=vi.fn(()=>Promise.resolve(weatherModuleBytes));
  const product=createShardProduct({slug:'weather-place',revision:1,shardfile:source,
    sections:new Map(),files:new Map([[name,{hash,url:'weather.wasm'}]]),read});
  const descriptor=vi.spyOn(descriptors,'outputDescriptor').mockReturnValue(legacyDouble<OutputDescriptor>({
    index:legacyDouble<OutputDescriptor['index']>({files:[legacyDouble<OutputDescriptor['index']['files'][number]>({kind:'wasm',hash,name,dependencies:[]})]})}));
  try{
    await ReturnProgram.prepareModules(product,assets,[weatherRaw.script]);
    expect(assets.get(hash)).toBe(weatherModuleBytes);expect(read).toHaveBeenCalledTimes(1);
    await ReturnProgram.prepareModules(product,assets,[weatherRaw.script]);
    expect(read).toHaveBeenCalledTimes(1);
    ReturnProgram.lendModules(scope,assets,[weatherRaw.script]);
    expect(ReturnProgram.page({script:weatherRaw.script,bytes:weatherRaw.bytes},scope).project('lineSlot',{...nightParameters,s:0,slot:0})).toEqual(
      ReturnProgram.page({script:weatherWitness.script,bytes:weatherWitness.bytes}).project('lineSlot',{...nightParameters,s:0,slot:0}));
  }finally{descriptor.mockRestore();scope.dispose();}
});
