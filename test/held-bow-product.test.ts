import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the existing producer's actual byte stream.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scoped compiler-input fixture paths.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The recorder fixture uses the actual repository root.
import process from 'node:process';
import { captureFolderInputs } from '../scripts/shardfile-inputs.mjs';
import { build } from '../scripts/shardfile-vite.mjs';
import recurve from '../public/assets/nalati/baked/recurve-pool.json' with { type:'json' };
import { HeldBowFileSchema, HeldBowDefinitionSchema } from '@wildshard/format/weaponProfiles';
import { bindHeldBow } from '../src/client/game/weapons/heldLauncher';
import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { fixtureJsonCheck } from './fixtures/folderFile';
import { nameBlob } from '../src/sharddev/blobs';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';

const encode=(input:unknown):Uint8Array=>new TextEncoder().encode(`${JSON.stringify(input)}\n`);
const schema=registeredJsonSchema('weapons/bow-page.json');

test('the named bow retains the original bytes, pool channels and borrowed arrays',async()=>{
  const bytes=encode(recurve),named=nameBlob('weapons/bow-page.json','json',bytes,{jsonSchema:schema});
  expect(bytes).toEqual(new Uint8Array(readFileSync(new URL('../public/assets/nalati/baked/recurve-pool.json',import.meta.url))));
  expect(named.bytes).toEqual(bytes);
  if(named.file.jsonSchema===undefined)throw new Error('Missing named bow admission');
  const source=emptyShardfile({slug:'bow-fixture',name:'Bow fixture',author:'Fixture',revision:1,seed:1});
  const product=createShardFolder({slug:source.identity.slug,revision:1,shardfile:source,sections:new Map(),jsonCheck:fixtureJsonCheck,
    files:new Map([['weapons/bow-page.json',{hash:named.file.hash,url:'/bow.json',jsonSchema:named.file.jsonSchema}]]),read:()=>Promise.resolve(named.bytes)});
  const admitted=v.parse(HeldBowFileSchema,await product.json('weapons/bow-page.json'));
  expect(admitted.pool).toEqual(recurve.pool);
  const parts=new Map(Object.values(admitted.bow.parts).map(id=>{
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array([0,-0,1,2,3,4]),3));
    for(const channel of Object.values(admitted.bow.styles??{}))geometry.setAttribute(channel,new BufferAttribute(new Float32Array([.25,.5,.75,1,0,.125]),3));
    return [id,geometry] as const;
  }));
  const library={geometry:(id:string)=>parts.get(id)??null};
  const {pool:_pool,...definition}=admitted;
  const actual=bindHeldBow(definition,library),original=bindHeldBow(v.parse(v.object(HeldBowDefinitionSchema.entries),recurve),library);
  expect(actual.rows).toEqual(original.rows);
  expect(actual.profile.draw).toEqual(original.profile.draw);expect(actual.profile.projectile).toEqual(original.profile.projectile);
  expect(actual.profile.mounted).toEqual(original.profile.mounted);expect(actual.profile.quiver).toBe(original.profile.quiver);
  for(const [id,geometry] of parts){
    expect(actual.model.geometry?.get(id)).toBe(geometry);expect(original.model.geometry?.get(id)).toBe(geometry);
    expect(actual.model.geometry?.get(id)?.getAttribute('position').array).toBe(geometry.getAttribute('position').array);
    for(const channel of Object.values(admitted.bow.styles??{}))expect(actual.model.geometry?.get(id)?.getAttribute(channel).array).toBe(geometry.getAttribute(channel).array);
    geometry.dispose();
  }
});

test('actual named admission rejects malformed bow and pool bytes',async()=>{
  const invalid=[{...recurve,ignored:true},{...recurve,pool:{...recurve.pool,ignored:true}},
    {...recurve,pool:{...recurve.pool,url:'x'.repeat(513)}},
    {...recurve,pool:{...recurve.pool,parts:Array.from({length:33},()=> 'part')}},
    {...recurve,pool:{...recurve.pool,channels:[{name:'paint',source:'COLOR_0',width:8}]}},
    {...recurve,base:{...recurve.base,parent:'bad'}}];
  const source=emptyShardfile({slug:'bad-bow',name:'Bad bow',author:'Fixture',revision:1,seed:1});
  for(const input of invalid){
    const bytes=encode(input);expect(()=>nameBlob('weapons/bow-page.json','json',bytes,{jsonSchema:schema})).toThrow();
    expect(()=>validateNamedJsonSchema(schema,bytes)).toThrow();
    const product=createShardFolder({slug:source.identity.slug,revision:1,shardfile:source,sections:new Map(),jsonCheck:fixtureJsonCheck,
      files:new Map([['weapons/bow-page.json',{hash:'a'.repeat(64),url:'/bad.json',jsonSchema:schema}]]),read:()=>Promise.resolve(bytes)});
    await expect(product.json('weapons/bow-page.json')).rejects.toThrow();
  }
});


test('the product input recorder sees the raw bow and its existing producer',async()=>{
  const source='public/assets/nalati/baked/recurve-pool.json',root=process.cwd();
  const dir=mkdtempSync(resolve('tmp/held-bow-input-')),entry=resolve(dir,'entry.mjs'),receipt=resolve(dir,'inputs.json');
  writeFileSync(entry,`import rows from ${JSON.stringify(resolve(source))} with {type:'json'};export const bow=rows;`);
  try {
    await captureFolderInputs(root,receipt,async()=>{await build({root,configFile:false,publicDir:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry,formats:['es'],fileName:'bow-input'}}});});
    const captured=v.parse(v.object({inputs:v.array(v.string())}),JSON.parse(readFileSync(receipt,'utf8')));
    expect(captured.inputs.some(input=>input.slice(2)===source)).toBe(true);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
