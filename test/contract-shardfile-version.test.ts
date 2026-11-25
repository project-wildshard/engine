// oxlint-disable-next-line import/no-nodejs-modules -- The native cook owns its output.
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch stays below the lane's folder.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest redirects its temp root into owned repository scratch.
import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';
import {SHARDFILE_VERSION} from '@wildshard/format/version';
import {readTar} from '@wildshard/format/tar';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {folderTarball} from '../src/cook/game/folderTarball';
import {runCookJob} from '../src/cook/game/cookJob';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {admitFolder,type FolderOptions} from '../src/client/game/shardfile/folder';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {wholeBrasscapExport} from './fixtures/brasscapExport';

// Brasscap Mesa's export, since J434 retired the handwritten Template 2 (TEMPLATE-E2E TR-10).
const fixture=wholeBrasscapExport();
// QA 11-24 row 70: format 0.79 deleted the legacy SS3 copy, the last product in the old `version` envelope (J486, at zero
// users; J507, no stored zone in tests). A preceding additive product is now a live pin (`pnpm pins`, by slug) prepared at
// an earlier format than this engine's, else Brasscap's own pin.
const preceding=readdirSync('out',{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>join('out',entry.name))
 .find(folder=>{try{return formatOf(JSON.parse(readFileSync(join(folder,'shard.json'),'utf8')))!==SHARDFILE_VERSION;}catch{return false;}})??fixture;
function formatOf(index:unknown):unknown{return typeof index==='object'&&index!==null&&'formatVersion' in index?index.formatVersion:undefined;}
const base='https://example.test/shardfiles/brasscap-mesa/';

test('the preceding additive product admits and cooks without rewriting its original',async()=>{
 const tar=folderTarball(preceding),files=readTar(tar);
 const header=files.get('shard.json');if(header===undefined)throw new Error('Missing fixture header');
 const input:unknown=JSON.parse(new TextDecoder().decode(header)),index=parseOutputIndex(input);
 expect(SHARDFILE_VERSION).toBe('0.1.0.6');
 const format=formatOf(input);
 expect(format).toMatch(/^0\.1\.0\.\d$/u);
 const originalHash=hashImmutableBytes(tar);
 const options:FolderOptions={base,offline:false,
  hash:bytes=>Promise.resolve(hashImmutableBytes(bytes)),fetch:url=>{
   const bytes=files.get(url.slice(base.length));
   return Promise.resolve(bytes===undefined?new Response(null,{status:404}):new Response(Uint8Array.from(bytes)));
  }};
 const admitted=await admitFolder(index,options);
 expect(admitted.source.version).toBe(format);
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


test('FP24 (J508): the deleted 0.1 and 0.1.0.0 are refused before transport',async()=>{
 const input:unknown=JSON.parse(readFileSync(join(fixture,'shard.json'),'utf8'));
 const {formatVersion:_formatVersion,...rest}=parseOutputIndex(input);
 let reads=0;
 const options:FolderOptions={base,offline:false,
  hash:value=>Promise.resolve(hashImmutableBytes(value)),fetch:()=>{reads++;return Promise.reject(new Error('Unexpected transport'));}};
 for(const version of ['0.1','0.1.0.0'])await expect(admitFolder({...rest,formatVersion:2,version,schemas:[]},options)).rejects.toThrow(version);
 expect(reads).toBe(0);
});
