import {expect,test} from 'vitest';
import {unzlibSync} from 'fflate';
import {base64Bytes} from '../src/client/engine/core/deflate';
import {dressingScene,dressingSceneBlobs} from './fixtures/nalati-dressing-scene';
import {nalatiSpecimens} from './fixtures/nalati-specimens';
import {nalatiBalbal} from './fixtures/nalati-balbal';
import {nalatiRuntime} from './fixtures/nalati-runtime';
import {nalatiDecorative} from './fixtures/nalati-decorative';
import {SceneDressingSchema} from '@wildshard/format/sceneDressing';
import * as v from 'valibot';

test('both shipping dressing tiers lend every packed hull through exact named compressed bytes',()=>{
  const blobs=dressingSceneBlobs(nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens),used=new Set<string>();
  let cases=0,rawBytes=0,encodedCharacters=0;
  for(const tier of ['phone','desktop']as const){
    const before=dressingScene(tier,nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens);
    const blob=blobs.find(row=>row.file.name===`world/dressing-${tier}.json`);if(blob===undefined)throw new Error('Missing tier');
    const after=v.parse(SceneDressingSchema,JSON.parse(new TextDecoder().decode(blob.bytes)));
    const contacts=(rows:typeof before)=>[...rows.layers.map(row=>row.contacts),...rows.statics.flatMap(row=>row.members.map(member=>member.contacts))];
    const originals=contacts(before),actual=contacts(after);expect(actual).toHaveLength(originals.length);
    for(const [index,old]of originals.entries()){
      const current=actual[index];if(Array.isArray(old)||!('data'in old)){expect(current).toEqual(old);continue;}
      if(current===undefined||Array.isArray(current)||!('file'in current))throw new Error('Packed hull requires a named file');
      const {data,...metadata}=old,{file,...remaining}=current;expect(remaining).toEqual(metadata);
      const payload=blobs.find(row=>row.file.name===file);if(payload===undefined)throw new Error('Missing named contact payload');
      const original=base64Bytes(data);expect(payload.bytes).toEqual(original);
      const raw=unzlibSync(payload.bytes);expect(raw).toEqual(unzlibSync(original));
      expect(payload.file.decoded).toBe(raw.byteLength);expect(raw.byteLength).toBe(old.origins.reduce((sum,row)=>sum+row[3]*4,0));
      used.add(file);cases++;rawBytes+=raw.byteLength;encodedCharacters+=data.length;
    }
  }
  expect(cases).toBeGreaterThan(0);
  expect(blobs.filter(row=>row.file.name?.startsWith('world/dressing-contacts/')).map(row=>row.file.name).sort((a,b)=>(a??'').localeCompare(b??''))).toEqual([...used].sort((a,b)=>a.localeCompare(b)));
  process.stdout.write(`contact publication ${JSON.stringify({cases,files:used.size,rawBytes,encodedCharacters,wireBytes:blobs.filter(row=>used.has(row.file.name??'')).reduce((sum,row)=>sum+row.bytes.byteLength,0)})}\n`);
});
