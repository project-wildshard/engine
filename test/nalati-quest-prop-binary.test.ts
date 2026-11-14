// oxlint-disable-next-line import/no-nodejs-modules -- Pin the exact former inline geometry from the registered producer.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {carriedQuestRows} from './fixtures/nalati-carried-quest';
import {prepareSpecimenCatalogue} from '../src/client/game/models/specimenCatalogue';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {nameBlob} from '../src/sharddev/blobs';
import {Scope} from '../src/shared/engine/app/scope';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {emptyShardfile} from '../src/shared/host/author';

test('the carried specimen prepares the exact original geometry through its named product file',async()=>{
  const source={name:'models/specimens/quest-prop.bin'};
  const bytes=Uint8Array.from(readFileSync('test/fixtures/nalati-quest-prop-original.bin')),scope=new Scope('quest-prop.raw');
  const hash=hashImmutableBytes(bytes);
  const product=createShardFolder({slug:'raw-delivery',revision:1,shardfile:emptyShardfile({slug:'raw-delivery',name:'Delivery',author:'Fixture',revision:1,seed:1}),
    sections:new Map(),files:new Map([[source.name,{hash,url:source.name}]]),read:()=>Promise.resolve(bytes)});
  try{
    const files=await prepareSpecimenCatalogue(product,carriedQuestRows.model,scope);
    expect(files.size).toBe(1);expect(files.get(source.name)).toBe(bytes);
    expect(carriedQuestRows.model[0]?.source).toMatchObject({kind:'file',file:source.name});
    const blob=nameBlob(source.name,'bin',bytes);
    expect(blob.bytes).toEqual(bytes);expect(blob.file.hash).toBe(hash);expect(blob.file.decoded).toBe(bytes.byteLength);
  }finally{scope.dispose();}
});
