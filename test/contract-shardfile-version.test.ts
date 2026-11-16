// oxlint-disable-next-line import/no-nodejs-modules -- The native cook owns its output.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch stays below the lane's folder.
import {resolve,join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest redirects its temp root into owned repository scratch.
import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';
import {SHARDFILE_VERSION} from '@wildshard/format/version';
import {readTar} from '@wildshard/format/tar';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {productTarball} from '../src/cook/game/productTarball';
import {runCookJob} from '../src/cook/game/cookJob';
import {validateSimulation} from '../src/server/host/headless';
import {admitProduct,type ProductOptions} from '../src/client/game/shardfile/product';
import {hashImmutableBytes} from '../src/shared/host/immutable';

const fixture=resolve('node_modules/@wildshard/format/corpus/handwritten');
const base='https://example.test/shardfiles/blender-template/';

test('the preceding additive product admits and cooks without rewriting its original',async()=>{
 const tar=productTarball(fixture),files=readTar(tar);
 const header=files.get('shard.json');if(header===undefined)throw new Error('Missing fixture header');
 const input:unknown=JSON.parse(new TextDecoder().decode(header)),index=parseOutputIndex(input);
 expect(SHARDFILE_VERSION).toBe('0.1.0.1');
 expect(index.version).toBe('0.1');
 const originalHash=hashImmutableBytes(tar);
 const options:ProductOptions={base,offline:false,firstParty:true,
  hash:bytes=>Promise.resolve(hashImmutableBytes(bytes)),fetch:url=>{
   const bytes=files.get(url.slice(base.length));
   return Promise.resolve(bytes===undefined?new Response(null,{status:404}):new Response(Uint8Array.from(bytes)));
  }};
 const admitted=await admitProduct(index,options);
 expect(admitted.source.version).toBe('0.1');
 const scratch=mkdtempSync(join(tmpdir(),'format-compat-'));
 try{
  const report=await runCookJob(tar,scratch,{prove:validateSimulation,wireBytes:(_url,bytes)=>bytes.length,now:()=>performance.now()});
  expect(report.hash).toBe(originalHash);
  expect(report.proof).not.toBe('unmeasured');
  expect(readFileSync(join(scratch,'client',report.header))).toEqual(Buffer.from(header));
  expect(hashImmutableBytes(tar)).toBe(originalHash);
 }finally{rmSync(scratch,{recursive:true,force:true});}
},60_000);


for(const version of ['0.1.0.2','0.1.1.0'])test(`future or breaking ${version} refuses before transport`,async()=>{
 const bytes=readFileSync(join(fixture,'shard.json')),input:unknown=JSON.parse(bytes.toString('utf8')),index=parseOutputIndex(input);
 let reads=0;
 const options:ProductOptions={base,offline:false,firstParty:true,
  hash:value=>Promise.resolve(hashImmutableBytes(value)),fetch:()=>{reads++;return Promise.reject(new Error('Unexpected transport'));}};
 await expect(admitProduct({...index,version},options)).rejects.toThrow(/Expected|additive format/u);
 expect(reads).toBe(0);
});
