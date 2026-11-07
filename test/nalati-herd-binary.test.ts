import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The named-file reader reads a scratch project's files.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch project paths.
import {dirname,join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The scratch project lives in the OS temp directory.
import {tmpdir} from 'node:os';
import {NALATI_PASTURE as pasture,NALATI_TITAN,NALATI_TITAN_PROGRAMS as programs} from './fixtures/nalati-titan';
import {prepareProjectOutput} from '../src/sharddev/projectOutput';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {Scope} from '../src/shared/engine/app/scope';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {lendNalatiPasture} from './fixtures/nalati-return-modules';

// GR6: the named-file reader reads the build program's bytes from a scratch project, as it reads any source
function scratchProject(files:Record<string,Uint8Array>):string{
  const root=mkdtempSync(join(tmpdir(),'nalati-titan-'));
  for(const [name,bytes] of Object.entries(files)){mkdirSync(join(root,dirname(name)),{recursive:true});writeFileSync(join(root,name),bytes);}
  return root;
}

test('the generated programme stays binary through the existing project reader and original scope',async()=>{
 const meta=programs.compiled.pasture,row=pasture.v2;
 expect(row.bytes).toBe('');expect(programs.fire.v2.bytes).toBe('');expect(programs.wind.v2.bytes).toBe('');
 expect(meta.hash).toBe(row.artifact.hash);
 const output=await prepareProjectOutput(scratchProject({[meta.source]:NALATI_TITAN.pasture.wasm}),{blobs:[{
  name:'behaviour/nalati.pasture.wasm',kind:'wasm',source:meta.source,options:{critical:true,script:{abi:2,lane:'project',
   pages:row.artifact.pages,ioBytes:row.artifact.ioBytes,compilerRevision:row.artifact.compilerRevision,admissionRevision:row.artifact.admissionRevision}}
 }]});
 const blob=output.blobs[0];if(blob===undefined)throw new Error('Missing raw programme');
 expect(blob.bytes.length).toBe(meta.bytes);expect(hashImmutableBytes(blob.bytes)).toBe(meta.hash);
 expect(blob.file.path).toBe(`blobs/wasm/${meta.hash}.wasm`);
 const owner=new Scope('original-binary-programme');
 try{lendNalatiPasture(owner);const program=ReturnProgram.page(pasture,owner);
  expect(ReturnProgram.page(programs.wind,owner)).toBe(program);expect(program.prepareGroup).toBeTypeOf('function');
  expect(program.groupBindings).toStrictEqual(row.groups);
 }finally{owner.dispose();}
});
