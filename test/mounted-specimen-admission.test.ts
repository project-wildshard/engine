import {expect,test} from 'vitest';
import {registeredJsonSchema} from '@wildshard/engine/host/formatJsonSchema';
import {nameBlob} from '@wildshard/sharddev/blobs';
import {emptyShardfile} from '@wildshard/engine/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {MOUNTED_FIGURE as source} from './fixtures/nalati-poi-paint-original';

const encode=(input:unknown):Uint8Array=>new TextEncoder().encode(JSON.stringify(input));
test('the actual mounted figure keeps every clip and rejects invalid seats before native construction',async()=>{
  const schema=registeredJsonSchema('riding/mounted-figure.json'),blob=nameBlob('riding/mounted-figure.json','json',encode(source),{jsonSchema:schema});
  const identity={slug:'seat-admission',name:'Seat admission',author:'Wildshard',revision:1,seed:1};
  const product=(input:unknown)=>createShardFolder({slug:identity.slug,revision:1,shardfile:emptyShardfile(identity),sections:new Map(),
    files:new Map([['riding/mounted-figure.json',{...blob.file,url:'https://example.test/seat'}]]),read:()=>Promise.resolve(encode(input))});
  expect(await product(source).json('riding/mounted-figure.json')).toEqual(source);
  for(const input of [{...source,mount:''},{...source,material:{...source.material,rim:'bright'}},
    {...source,gestures:[{cue:'crack',clock:'crackT',duration:0}]},{...source,gestures:Array.from({length:17},()=>({cue:'crack',clock:'crackT',duration:.2}))}]){
    expect(()=>nameBlob('riding/mounted-figure.json','json',encode(input),{jsonSchema:schema})).toThrow();
    await expect(product(input).json('riding/mounted-figure.json')).rejects.toThrow('refuses its schema');
  }
});
