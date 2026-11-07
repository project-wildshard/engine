import {expect,test} from 'vitest';
import * as v from 'valibot';
import {unzlibSync} from 'fflate';
import {base64Bytes,decodeLaneBytes} from '../src/client/engine/core/deflate';
import {SceneDressingSchema} from '@wildshard/format/sceneDressing';
import {dressingScene,dressingSceneBlobs} from './fixtures/nalati-dressing-scene';
import {readBakedGeometry} from '../src/client/game/plugin/geometry';
import {nalatiSpecimens} from './fixtures/nalati-specimens';
import {nalatiBalbal} from './fixtures/nalati-balbal';
import {nalatiRuntime} from './fixtures/nalati-runtime';
import {nalatiDecorative} from './fixtures/nalati-decorative';

test('both cloth tiers borrow one compressed file with every original geometry byte and declaration',async()=>{
  const blobs=dressingSceneBlobs(nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens),used=new Set<string>();
  let encodedCharacters=0,rawBytes=0;
  for(const tier of ['phone','desktop']as const){
    const before=dressingScene(tier,nalatiDecorative,nalatiRuntime,nalatiBalbal,nalatiSpecimens).geometry['cloth'];
    if(before?.kind!=='inline')throw new Error('Missing original cloth wire');
    const scene=blobs.find(row=>row.file.name===`world/dressing-${tier}.json`);if(scene===undefined)throw new Error('Missing tier');
    const rows=v.parse(SceneDressingSchema,JSON.parse(new TextDecoder().decode(scene.bytes))),after=rows.geometry['cloth'];
    if(after?.kind!=='baked-file')throw new Error('Cloth requires named compressed bytes');
    const {kind:_oldKind,data,...original}=before,{kind:_kind,file,address,...actual}=after;expect(actual).toEqual(original);
    const loan=blobs.find(row=>row.file.name===file),raw=unzlibSync(base64Bytes(data));if(loan===undefined)throw new Error('Missing cloth bytes');
    const decoded=await decodeLaneBytes(loan.bytes);expect(Buffer.compare(decoded,raw)).toBe(0);expect(loan.file.decoded).toBe(raw.byteLength);
    const offsets=blobs.find(row=>row.file.name===address.file)?.bytes;if(offsets===undefined)throw new Error('Missing cloth address');
    expect(new DataView(offsets.buffer,offsets.byteOffset,offsets.byteLength).getUint32(address.word*4,true)).toBe(0);
    expect(address.word*4).toBe(offsets.byteLength-4);
    const geometry=readBakedGeometry(decoded,0,after.row);
    expect(geometry.getAttribute('aClothA').count).toBeGreaterThan(1000);
    expect(geometry.getAttribute('normal').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.getAttribute('aClothF').itemSize).toBe(2);geometry.dispose();
    used.add(file);rawBytes=raw.byteLength;encodedCharacters+=data.length;
  }
  expect(used.size).toBe(1);
  expect(blobs.filter(row=>row.file.name?.startsWith('world/dressing-cloth/')).map(row=>row.file.name)).toEqual([...used]);
  process.stdout.write(`cloth publication ${JSON.stringify({rawBytes,encodedCharacters,files:used.size,wireBytes:blobs.filter(row=>used.has(row.file.name??'')).reduce((sum,row)=>sum+row.bytes.length,0)})}\n`);
});
