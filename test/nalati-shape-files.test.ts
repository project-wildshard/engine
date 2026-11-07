import {readBakedGeometry,expandBakedGeometry} from '../src/client/game/plugin/geometry';
// oxlint-disable-next-line import/no-nodejs-modules -- Native captured rows and binary byte witnesses.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The reference stores only original raw-byte hashes.
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {expect,test} from 'vitest';
import {BufferAttribute} from 'three';
import {nameBlob} from '../src/sharddev/blobs';
import {originalPoiPaintFiles} from './fixtures/nalati-poi-paint-original';
import {FixedDrawRowsSchema} from '@wildshard/format/fixedDraws';
import {SceneBakedGeometrySchema} from '@wildshard/format/sceneDressing';
import {productFixedDraws} from '../src/client/game/models/fixedDraws';
import source from './fixtures/nalati-shape-book-original.json' with {type:'json'};
import original from './fixtures/nalati-shape-blocks.json' with {type:'json'};

const hash=(bytes:Uint8Array|string):string=>createHash('sha256').update(bytes).digest('hex');
const rows=v.parse(FixedDrawRowsSchema,source.draws).filter(row=>'file'in row);
const paint=v.parse(v.object({rows:v.array(v.object({key:v.string(),name:v.string(),geometry:SceneBakedGeometrySchema}))}),
  JSON.parse(readFileSync('test/fixtures/nalati-poi-paint-original.json','utf8')));
const originals=originalPoiPaintFiles();
const blobs=source.sources.map(row=>{const bytes=originals.get(row.source);if(bytes===undefined)throw new Error(`Missing original shape ${row.source}`);return nameBlob(row.name,'bin',bytes);});

test('all named shape blocks preserve the original raw bytes and geometry metadata',()=>{
  expect(blobs).toHaveLength(original.length);expect(rows).toHaveLength(original.length);
  for(const before of original){
    const row=rows.find(entry=>entry.slot===before.slot);
    if(row===undefined||!('file'in row))throw new Error(`Missing binary shape ${before.slot}`);
    const blob=blobs.find(entry=>entry.file.name===row.file);
    if(blob===undefined)throw new Error(`Missing admitted shape ${row.file}`);
    expect(blob.bytes.length).toBe(before.length);expect(hash(blob.bytes)).toBe(before.hash);
    expect(hash(JSON.stringify(row.baked))).toBe(before.geometry);
  }
});

test('the product owner restores every original painted shape through file intake',async()=>{
  const product={slug:'nalati-shape-proof',json:()=>Promise.resolve(rows),file:(name:string)=>{
    const blob=blobs.find(entry=>entry.file.name===name);if(blob===undefined)throw new Error(`Missing named shape ${name}`);return Promise.resolve(blob.bytes);
  }};
  const draws=await productFixedDraws(product,'models/shape-book.json');await draws.load();
  for(const row of paint.rows){
    const bytes=blobs.find(blob=>blob.file.name===row.name)?.bytes;if(bytes===undefined)throw new Error('Missing raw original shape');
    const decoded=readBakedGeometry(bytes,0,row.geometry),before=row.geometry.expand?expandBakedGeometry(decoded):decoded,after=draws.handle(row.key).copy();
    expect(Object.keys(after.attributes)).toEqual(Object.keys(before.attributes));
    for(const[name,attribute]of Object.entries(before.attributes)){
      const actual=after.getAttribute(name);
      if(!(attribute instanceof BufferAttribute)||!(actual instanceof BufferAttribute))throw new Error('Expected native shape buffers');
      expect(actual.array).toEqual(attribute.array);expect(actual.itemSize).toBe(attribute.itemSize);expect(actual.normalized).toBe(attribute.normalized);
    }
    expect(after.index?.array??null).toEqual(before.index?.array??null);expect(after.boundingBox).toEqual(before.boundingBox);expect(after.boundingSphere).toEqual(before.boundingSphere);
    before.dispose();after.dispose();
  }
});
