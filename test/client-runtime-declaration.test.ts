// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own only temporary directories below repository tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The build writer receives actual fixture paths.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Generate the same manifest modules as production.
import process from 'node:process';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { RuntimeSchema } from '@wildshard/format/runtime';
import { runtimeAccountedBytes } from '@wildshard/format/runtimeCost';
import { parseManifestMetadata } from '@wildshard/format/minimap';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { emptyShardfile } from '../src/shared/host/author';
import { writeOutputProduct, validateOutputProduct } from '../src/sharddev/outputProduct';
import { writeRuntimeFiles } from '../src/sharddev/outputRuntime';
import { formatJsonSchema } from '../src/shared/host/formatJsonSchema';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';
import metadata from '../src/shards/pine-hollow/manifest.json' with {type:'json'};

const cost = { webContentMB: 500, glMB: 100, engineBaseMB: 300, rev: 'abcdef1234', device: 'Fixture', evidence: 'progress/memory/fixture.json' };
const row = { kind: 'client-plan', cost, binds: ['terrain', 'props', 'quests', 'state', 'movers'] };

test('compiled ownership retains the exact authority and measured charge with no source entry', () => {
  const parsed = v.parse(RuntimeSchema, row);
  expect(parsed).toEqual(row); expect(runtimeAccountedBytes(parsed.cost)).toBe(runtimeAccountedBytes(cost));
  // LD9: the copied-runtime `entry` arm is retired; a source entry is refused on its own as well as beside a client plan
  expect(v.safeParse(RuntimeSchema, {entry:'runtime/index.ts',cost,binds:row.binds}).success).toBe(false);
  expect(v.safeParse(RuntimeSchema, {entry:'runtime/index.ts'}).success).toBe(false);
  for (const bad of [{...row,entry:'runtime/index.ts'},{...row,kind:'arbitrary'}, {...row,cost:undefined}, {...row,binds:undefined}, {...row,binds:['state','state']}, {...row,binds:['spawns']}, {...row,load:'runtime/index.ts'}]) expect(v.safeParse(RuntimeSchema,bad).success).toBe(false);
  // The real converter must admit the defining client-plan schema.
  expect(formatJsonSchema(RuntimeSchema)).toBeDefined();
});

test('built-in manifest policy emits only the platform constructor and keeps CSS and ownership', () => {
  const rest=structuredClone(metadata);Reflect.deleteProperty(rest,'runtimeEntry');
  // Pine's program-bound rows (boot, poses, ground, ...) read the product's discovery values (f2f25523af); this case
  // composes only the bindings it checks, as page-boot-discovery does
  const plain=Object.fromEntries(Object.entries(metadata.bindings).filter(([,value])=>!JSON.stringify(value).includes('"program":true')));
  const input={...rest,bindings:{...plain,entry:{platform:'client-plan',retainHomeRuntime:true,stagesOwner:'runtime',styles:['./quest/pinehollow.css']}}};
  const parsed=parseManifestMetadata(input), source=authoredManifestSource(process.cwd(),'pine-hollow',{composed:input});
  expect(parsed.bindings.entry).toEqual(input.bindings.entry);
  expect(source).toContain('declaredClientPlanEntry({"retainHomeRuntime":true,"stagesOwner":"runtime"})');
  expect(source).toContain('await Promise.all([import("./quest/pinehollow.css")])');
  expect(source).not.toContain('runtimeModule'); expect(source).not.toContain('nativeModule'); expect(source).not.toContain('resolveTrustedRuntime');
  expect(()=>parseManifestMetadata({...input,bindings:{...input.bindings,entry:{...input.bindings.entry,legacy:'./runtime/hybrid'}}})).toThrow();
  expect(()=>authoredManifestSource(process.cwd(),'pine-hollow',{composed:{...input,runtimeEntry:'runtime/hybrid.ts'}})).toThrow('names no runtime module');
});

test('compiled output refuses real runtime code and ships no declaration stubs', () => {
  mkdirSync(resolve('tmp'),{recursive:true}); const root=mkdtempSync(resolve('tmp/client-runtime-')),project=join(root,'project'),output=join(root,'output');
  mkdirSync(join(project,'runtime'),{recursive:true});writeFileSync(join(project,'runtime','productSections.generated.d.ts'),'export interface Generated { readonly id: string }');
  try {
    expect(writeRuntimeFiles(project,output)).toEqual({files:[],lines:0});
    writeFileSync(join(project,'runtime','hidden.ts'),'export const value = 3;');
    expect(()=>writeRuntimeFiles(project,output)).toThrow('cannot contain executable source');
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('actual output transport preserves compiled cost and binds while refusing a hidden TS inventory', () => {
  mkdirSync(resolve('tmp'),{recursive:true});const root=mkdtempSync(resolve('tmp/client-runtime-product-'));
  const source=emptyShardfile({slug:'compiled-product',name:'Compiled product',author:'Fixture',revision:1,seed:7});
  source.runtime={kind:'client-plan',cost,binds:['terrain','props','movers']};
  try{
    const index=writeOutputProduct(source,new Map(),root),actual=validateOutputProduct(root);
    expect(actual.shard.runtime).toEqual(source.runtime);expect(index.runtime).toEqual({...source.runtime,trust:'first-party',files:[],lines:0});
    expect(()=>parseOutputIndex({...index,runtime:{...index.runtime,entry:'runtime/index.ts'}})).toThrow();
    expect(()=>parseOutputIndex({...index,runtime:{...index.runtime,lines:1}})).toThrow();
    expect(()=>parseOutputIndex({...index,runtime:{...index.runtime,files:[{path:'runtime/index.ts',hash:'a'.repeat(64),bytes:1,lines:1}]}})).toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});
