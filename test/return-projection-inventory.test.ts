import { afterEach,expect,test } from 'vitest';
import * as v from 'valibot';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned product transport fixture only.
import { mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep temporary products in the repository scratch tree.
import { resolve } from 'node:path';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import { emptyShardfile } from '../src/shared/host/author';
import { nameBlob,emitNamedBlobs } from '../src/sharddev/blobs';
import { prepareProjectOutput,mergeProjectBlobs } from '../src/sharddev/projectOutput';
import { emitPlatformSections } from '../src/sharddev/platformSections';
import { writeOutputProduct,validateOutputProduct } from '../src/sharddev/outputProduct';
import { scriptAdmissionRows,decisionModuleContracts,ReturnModulesSchema,ScriptV2ContractSchema } from '@wildshard/format/scriptContract';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { readProductDescriptor,admitProduct,type ProductOptions } from '../src/client/game/shardfile/product';
import { HeadlessSimulation } from '../src/server/host/headless';
import {titanPrograms as programs} from './fixtures/titanInlineWitness';

const owned:string[]=[];
afterEach(()=>{for(const path of owned.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/project-inventory-'));owned.push(root);
  const projection=programs.attack.v2,{hash:_hash,minor:_minor,...metadata}=projection.artifact;
  const contract=v.parse(ScriptV2ContractSchema,metadata);
  const bytes=Uint8Array.from(atob(projection.bytes),byte=>byte.codePointAt(0)??0);
  const blob=nameBlob('behaviour/project.wasm','wasm',bytes,{critical:true,script:contract});
  const module={id:'fixture.project',module:blob.file.path,side:'sim',...contract};
  const rows=v.parse(ReturnModulesSchema,[module]);
  const sections=new Map<string,unknown>([['actors/return-scripts',rows]]);
  const platform=emitPlatformSections(new Map([['actors/return-scripts',rows]]));
  const source=emptyShardfile({slug:'project-inventory',name:'Project inventory',author:'Test',revision:1,seed:2});
  source.serverBudget.memory+=131072;source.budgets.sim.resident+=131072;
  return {root,blob,bytes,contract,module,platform,sections,...mergeProjectBlobs(source,new Map(),[blob])};
}
test('project ABI survives named reconstruction, disk, browser and native without scheduling',async()=>{
  const f=fixture(),emitted=emitNamedBlobs([f.blob]);
  const rows=v.parse(ReturnModulesSchema,[f.module]);
  expect(validateNamedJsonSchema(namedJsonSchema(ReturnModulesSchema),new TextEncoder().encode(JSON.stringify(rows)))).toStrictEqual(rows);
  const prepared=await prepareProjectOutput(f.root,{platform:f.platform,namedFiles:emitted.files,assets:emitted.assets});
  expect(prepared.blobs[0]?.script).toStrictEqual(f.contract);
  const index=writeOutputProduct(f.shard,f.assets,f.root,{platform:f.platform,namedFiles:f.namedFiles});
  expect(index.files.find(row=>row.hash===f.blob.file.hash)).not.toHaveProperty('script');
  expect(validateOutputProduct(f.root).assets.get(f.blob.file.hash)).toStrictEqual(f.bytes);
  const base='https://example.test/projection/';
  const options:ProductOptions={base,offline:false,firstParty:false,hash:wire=>Promise.resolve(hashImmutableBytes(wire)),
    fetch:url=>Promise.resolve(new Response(Uint8Array.from(readFileSync(resolve(f.root,url.slice(base.length))))))};
  expect((await admitProduct(await readProductDescriptor(options),options)).assets.get(f.blob.file.hash)).toStrictEqual(f.bytes);
  const sim=await HeadlessSimulation.create(f.shard,f.assets,undefined,{deadline:'advisory',sections:f.sections});
  try{expect((await sim.step()).tick).toBe(1);}finally{await sim.dispose();}
},30000);
test('missing or mismatched project contracts refuse without guessing the ABI',async()=>{
  const f=fixture(),rows=scriptAdmissionRows(f.sections);
  await expect(prepareProjectOutput(f.root,{namedFiles:[f.blob.file],assets:f.assets})).rejects.toThrow('Missing instrumentation');
  expect(()=>validateShardfileAssets(f.shard,f.assets,hashImmutableBytes)).toThrow('Missing instrumentation');
  expect(()=>v.parse(ReturnModulesSchema,[{...f.module,lane:'view'}])).toThrow();
  expect(()=>v.parse(ReturnModulesSchema,[{...f.module,side:'view'}])).toThrow();
  expect(()=>v.parse(ReturnModulesSchema,[f.module,f.module])).toThrow();
  expect(()=>decisionModuleContracts(rows,[{...f.blob.file,hash:'0'.repeat(64)}])).toThrow('exact declared');
  const wrong=emitPlatformSections(new Map([['actors/return-scripts',[{...f.module,pages:2}]]]));
  expect(()=>writeOutputProduct(f.shard,f.assets,f.root,{platform:wrong,namedFiles:f.namedFiles})).toThrow('fixed pages');
});

test('legacy return inventories keep the original parser normalization and refusals',()=>{
  const legacy={...programs.attack.script,bodies:{},colliders:{}};
  expect(v.parse(ReturnModulesSchema,[legacy])).toStrictEqual(parseDecisionScripts([legacy]));
  expect(()=>v.parse(ReturnModulesSchema,[legacy,legacy])).toThrow();
  expect(()=>v.parse(ReturnModulesSchema,[{...legacy,reads:['unknown']}])).toThrow();
  let reads=0;
  expect(()=>v.parse(ReturnModulesSchema,[{...legacy,get id(){reads++;return legacy.id;}}])).toThrow();
  expect(reads).toBe(0);
});
