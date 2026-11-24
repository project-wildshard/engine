// SHARD-COMPAT PR7 (J487): preparation is engine agnostic. A product prepared on an earlier engine loads on this one:
// the client admits it, the cook takes it with the rooms' own admission check, and nothing rewrites the original.
// Products: the format corpus's Brasscap Mesa export (prepared on an earlier engine); on a release candidate
// (release/* in CI) also pinned products from out/ (`pnpm pins`), each prepared on the engine of its own publish (PR7b).
// WS_AGNOSTIC_PRODUCT names one more prepared product (a folder or a .shardfile); WS_AGNOSTIC_PINS lists pinned slugs.
//   WS_AGNOSTIC_PRODUCT=<dir|file> pnpm vitest run test/agnostic-load.test.ts
// oxlint-disable-next-line import/no-nodejs-modules -- The native cook owns its output.
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch stays below the lane's folder.
import {join,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Vitest redirects its temp root into owned repository scratch.
import {tmpdir} from 'node:os';
import {expect,test} from 'vitest';
import {readTar} from '@wildshard/format/tar';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {folderTarball} from '../src/cook/game/folderTarball';
import {runCookJob} from '../src/cook/game/cookJob';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {admitFolder,type FolderOptions} from '../src/client/game/shardfile/folder';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {wholeBrasscapExport} from './fixtures/brasscapExport';

// PR7b: a release candidate loads pinned products the last releases prepared; the CI tests unit installs the pins first.
const release=(process.env['GITHUB_REF']??'').startsWith('refs/heads/release/');
const pins=(process.env['WS_AGNOSTIC_PINS']??(release?'brasscap-mesa,mirror-salt':'')).split(',').filter(Boolean);
const products=[
 wholeBrasscapExport(),
 ...pins.map(slug=>resolve('out',slug)),
 ...(process.env['WS_AGNOSTIC_PRODUCT']===undefined?[]:[resolve(process.env['WS_AGNOSTIC_PRODUCT'])]),
];
const base='https://example.test/shardfiles/agnostic/';

test.each(products.map(product=>({product,name:product.split('/').slice(-2).join('/')})))('a product prepared on an earlier engine loads here unchanged ($name)',async({product})=>{
 if(!existsSync(join(product,'shard.json'))&&!statSync(product,{throwIfNoEntry:false})?.isFile())throw new Error(`No prepared product at ${product} (pnpm pins installs the pinned ones)`);
 const tar=statSync(product).isDirectory()?folderTarball(product):new Uint8Array(readFileSync(product));
 const files=readTar(tar),header=files.get('shard.json');
 if(header===undefined)throw new Error('Missing product header');
 const index=parseOutputIndex(JSON.parse(new TextDecoder().decode(header)));
 const original=hashImmutableBytes(tar);
 // Client boot: the folder reader admits it by its own index, reading only the product's files.
 const options:FolderOptions={base,offline:false,hash:bytes=>Promise.resolve(hashImmutableBytes(bytes)),fetch:url=>{
  const bytes=files.get(url.slice(base.length));
  return Promise.resolve(bytes===undefined?new Response(null,{status:404}):new Response(Uint8Array.from(bytes)));
 }};
 const admitted=await admitFolder(index,options);
 expect(admitted.source.version).toMatch(/^0\.1(?:\.\d+)*$/u);
 // Cook with the rooms' admission check; the cook reads the original as it is and never rewrites it.
 const scratch=mkdtempSync(join(tmpdir(),'agnostic-load-'));
 try{
  const report=await runCookJob(tar,scratch,{check:(shard,assets,sections)=>checkShardfile(shard,assets,{sections}),wireBytes:(_url,bytes)=>bytes.length,now:()=>performance.now()});
  expect(report.hash).toBe(original);
  expect(readFileSync(join(scratch,'client',report.header))).toEqual(Buffer.from(header));
  expect(hashImmutableBytes(tar)).toBe(original);
 }finally{rmSync(scratch,{recursive:true,force:true});}
},240_000);
