// oxlint-disable-next-line import/no-nodejs-modules -- The native cook owns its output.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch stays below the lane's folder.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest redirects its temp root into owned repository scratch.
import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';
import {SHARDFILE_VERSION} from '@wildshard/format/version';
import {readTar} from '@wildshard/format/tar';
import {parseOutputIndex,assembleOutputShardfile} from '@wildshard/format/outputIndex';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {folderTarball} from '../src/cook/game/folderTarball';
import {runCookJob} from '../src/cook/game/cookJob';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {admitFolder,type FolderOptions} from '../src/client/game/shardfile/folder';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {wholeBrasscapExport} from './fixtures/brasscapExport';

// Brasscap Mesa's export, since J434 retired the handwritten Template 2 (TEMPLATE-E2E TR-10).
const fixture=wholeBrasscapExport();
const base='https://example.test/shardfiles/brasscap-mesa/';

test('the preceding additive product admits and cooks without rewriting its original',async()=>{
 const tar=folderTarball(fixture),files=readTar(tar);
 const header=files.get('shard.json');if(header===undefined)throw new Error('Missing fixture header');
 const input:unknown=JSON.parse(new TextDecoder().decode(header)),index=parseOutputIndex(input);
 expect(SHARDFILE_VERSION).toBe('0.1.0.6');
 expect(index.version).toBe('0.1');
 const originalHash=hashImmutableBytes(tar);
 const options:FolderOptions={base,offline:false,
  hash:bytes=>Promise.resolve(hashImmutableBytes(bytes)),fetch:url=>{
   const bytes=files.get(url.slice(base.length));
   return Promise.resolve(bytes===undefined?new Response(null,{status:404}):new Response(Uint8Array.from(bytes)));
  }};
 const admitted=await admitFolder(index,options);
 expect(admitted.source.version).toBe('0.1');
 const scratch=mkdtempSync(join(tmpdir(),'format-compat-'));
 try{
  const report=await runCookJob(tar,scratch,{check:(shard,assets,sections)=>checkShardfile(shard,assets,{sections}),wireBytes:(_url,bytes)=>bytes.length,now:()=>performance.now()});
  expect(report.hash).toBe(originalHash);
  expect(report.proof).not.toBe('unmeasured');
  expect(readFileSync(join(scratch,'client',report.header))).toEqual(Buffer.from(header));
  expect(hashImmutableBytes(tar)).toBe(originalHash);
 }finally{rmSync(scratch,{recursive:true,force:true});}
},60_000);


for(const version of ['0.1.0.4','0.1.1.0'])test(`future or breaking ${version} refuses before transport`,async()=>{
 const bytes=readFileSync(join(fixture,'shard.json')),input:unknown=JSON.parse(bytes.toString('utf8')),index=parseOutputIndex(input);
 let reads=0;
 const options:FolderOptions={base,offline:false,
  hash:value=>Promise.resolve(hashImmutableBytes(value)),fetch:()=>{reads++;return Promise.reject(new Error('Unexpected transport'));}};
 await expect(admitFolder({...index,version},options)).rejects.toThrow(version);
 expect(reads).toBe(0);
});


test('the canonical zero-counter alias admits through the engine reader',async()=>{
 const files=readTar(folderTarball(fixture)),header=files.get('shard.json');
 if(header===undefined)throw new Error('Missing fixture header');
 const input:unknown=JSON.parse(new TextDecoder().decode(header));
 const index=parseOutputIndex({...parseOutputIndex(input),version:'0.1.0.0'});
 const sections=new Map<string,unknown>();
 for(const row of index.sections){
  const value:unknown=JSON.parse(new TextDecoder().decode(files.get(row.path)));
  sections.set(row.name,value);
 }
 const source=assembleOutputShardfile(index,sections);
 const descriptor={...index,build:{...index.build,sourceHash:hashImmutableBytes(validationSourceBytes(source))}};
 const options:FolderOptions={base,offline:false,
  hash:bytes=>Promise.resolve(hashImmutableBytes(bytes)),fetch:url=>{
   const bytes=files.get(url.slice(base.length));
   return Promise.resolve(bytes===undefined?new Response(null,{status:404}):new Response(Uint8Array.from(bytes)));
  }};
 expect((await admitFolder(descriptor,options)).source.version).toBe('0.1.0.0');
});
